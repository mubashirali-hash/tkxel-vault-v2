import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { getPageContent, createKmsProvider, EnvelopeEncryption } from '@tkxel-vault/vault-core';
import { searchPages } from '@tkxel-vault/vault-core/search';
import { eq, and } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { OpenVaultStore } from './open-retrieval.js';
import crypto from 'node:crypto';

export class PostgresOpenVaultStore implements OpenVaultStore {
  /**
   * Search pages in the database using keyword and ILIKE matching on title, tags, and body.
   */
  async search(query: string, vaultId: string, limit: number = 10): Promise<Array<{ id: string; title: string; snippet: string }>> {
    const targetVault = vaultId;
    try {
      const results = await searchPages(targetVault, query, limit);
      return results.map((r: any) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet || `# ${r.title}`,
      }));
    } catch (err) {
      console.warn('Fallback in search:', err);
      return [];
    }
  }

  /**
   * Retrieve full page content, front matter, tags, and backlinks by title.
   */
  async getPage(
    title: string,
    vaultId: string
  ): Promise<{ title: string; content: string; tags: string[]; backlinks: string[] } | null> {
    const targetVault = vaultId;
    const normalizedTitle = title.trim().toLowerCase();
    const slugTitle = normalizedTitle.replace(/\s+/g, '_');

    // Find page by title or alias
    const allPages = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.vault_id, targetVault));

    const page = allPages.find(
      (p) =>
        p.title.toLowerCase() === normalizedTitle ||
        p.title.toLowerCase() === slugTitle ||
        p.title.toLowerCase().replace(/_/g, ' ') === normalizedTitle ||
        p.aliases?.some((a) => a.toLowerCase() === normalizedTitle || a.toLowerCase() === slugTitle) ||
        p.id === title
    );

    if (!page) return null;

    // Fetch backlinks strictly originating from pages within the same vault
    const fromPages = alias(schema.pages, 'from_pages');
    const incomingLinks = await db
      .select({
        from_title: fromPages.title,
      })
      .from(schema.links)
      .innerJoin(fromPages, and(eq(schema.links.from_page_id, fromPages.id), eq(fromPages.vault_id, vaultId)))
      .where(and(eq(schema.links.to_page_id, page.id), eq(schema.links.resolved, true)));

    const backlinkTitles = incomingLinks
      .map((l) => l.from_title)
      .filter((t): t is string => Boolean(t));

    const pageContentRec = await getPageContent(page.id);
    const body = pageContentRec?.content || `# ${page.title}`;

    return {
      title: page.title,
      content: body,
      tags: page.tags || [],
      backlinks: backlinkTitles,
    };
  }

  /**
   * Explore 1-hop and 2-hop bidirectional graph neighborhood around pageId.
   */
  async getLinks(
    pageId: string,
    vaultId: string,
    maxHops: number = 1
  ): Promise<{ nodes: Array<{ id: string; label: string }>; edges: Array<{ from: string; to: string }> }> {
    const allPages = await db.select().from(schema.pages).where(eq(schema.pages.vault_id, vaultId));

    // Defensively query links strictly where both endpoints are in vaultId and resolved = true
    const fromPages = alias(schema.pages, 'from_pages');
    const toPages = alias(schema.pages, 'to_pages');
    const vaultLinks = await db
      .select({
        from_page_id: schema.links.from_page_id,
        to_page_id: schema.links.to_page_id,
      })
      .from(schema.links)
      .innerJoin(fromPages, and(eq(schema.links.from_page_id, fromPages.id), eq(fromPages.vault_id, vaultId)))
      .innerJoin(toPages, and(eq(schema.links.to_page_id, toPages.id), eq(toPages.vault_id, vaultId)))
      .where(eq(schema.links.resolved, true));

    // Resolve focal page ID if title was passed
    const focal = allPages.find((p) => p.id === pageId || p.title.toLowerCase() === pageId.toLowerCase());
    if (!focal) {
      return { nodes: [], edges: [] };
    }

    const neighborhood = new Set<string>([focal.id]);

    // Hop 1
    vaultLinks.forEach((l) => {
      if (l.from_page_id === focal.id && l.to_page_id) neighborhood.add(l.to_page_id);
      if (l.to_page_id === focal.id) neighborhood.add(l.from_page_id);
    });

    // Hop 2
    if (maxHops >= 2) {
      const hop1 = Array.from(neighborhood);
      vaultLinks.forEach((l) => {
        if (hop1.includes(l.from_page_id) && l.to_page_id) neighborhood.add(l.to_page_id);
        if (l.to_page_id && hop1.includes(l.to_page_id)) neighborhood.add(l.from_page_id);
      });
    }

    const nodes = allPages
      .filter((p) => neighborhood.has(p.id))
      .map((p) => ({ id: p.id, label: p.title }));

    const edges = vaultLinks
      .filter((l) => l.to_page_id && neighborhood.has(l.from_page_id) && neighborhood.has(l.to_page_id))
      .map((l) => ({ from: l.from_page_id, to: l.to_page_id! }));

    return { nodes, edges };
  }

  /**
   * Assemble a token-budgeted Markdown context block with target page, outgoing links, and backlinks.
   */
  async getContext(
    query: string,
    vaultId: string,
    targetPage?: string,
    maxTokens: number = 4000
  ): Promise<{ markdown: string; tokenEstimate: number }> {
    let focalTitle = targetPage;

    // If no target page specified, find the most relevant via search
    if (!focalTitle) {
      const searchResults = await this.search(query, vaultId, 1);
      if (searchResults.length > 0) {
        focalTitle = searchResults[0].title;
      }
    }

    if (!focalTitle) {
      return {
        markdown: `No context documents found in the vault matching query: "${query}".`,
        tokenEstimate: 10,
      };
    }

    const pageData = await this.getPage(focalTitle, vaultId);
    if (!pageData) {
      return {
        markdown: `Document "${focalTitle}" not found in authorized knowledge hub.`,
        tokenEstimate: 10,
      };
    }

    const contextParts: string[] = [
      `# Context Document: ${pageData.title}`,
      `**Tags:** ${pageData.tags.join(', ') || 'none'}`,
      `**Referenced In (Backlinks):** ${pageData.backlinks.join(', ') || 'none'}`,
      '',
      pageData.content,
    ];

    // Append 1-hop connected notes if budget allows
    if (pageData.backlinks.length > 0) {
      contextParts.push('\n---\n## Connected Backlinks Context');
      for (const backlink of pageData.backlinks.slice(0, 3)) {
        const blData = await this.getPage(backlink, vaultId);
        if (blData) {
          const snippet = blData.content.length > 500 ? blData.content.slice(0, 500) + '...' : blData.content;
          contextParts.push(`### [[${blData.title}]]\n${snippet}`);
        }
      }
    }

    const fullMarkdown = contextParts.join('\n');
    // Approximate token count (1 token ~= 4 characters)
    const tokenEstimate = Math.min(Math.ceil(fullMarkdown.length / 4), maxTokens);

    return {
      markdown: fullMarkdown,
      tokenEstimate,
    };
  }

  /**
   * Append a note or create a draft page.
   */
  async addNote(params: {
    vaultId: string;
    title: string;
    content: string;
    tags?: string[];
    authorId: string;
  }): Promise<{ noteId: string; status: string }> {
    const pageId = crypto.randomUUID();
    const vaultId = params.vaultId;

    await db.insert(schema.pages).values({
      id: pageId,
      vault_id: vaultId,
      type: 'note',
      title: params.title,
      aliases: [],
      tags: params.tags || ['mcp-agent'],
      front_matter: {
        title: params.title,
        tags: params.tags || ['mcp-agent'],
        author: params.authorId,
      },
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Encrypt note content under Vault KMS DEK and store in versions
    try {
      const vaultRec = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultId)).limit(1);
      if (vaultRec.length > 0 && vaultRec[0].data_key_id) {
        const kms = createKmsProvider();
        const dek = await kms.unwrapKey(vaultRec[0].data_key_id);
        const encryptedBlob = EnvelopeEncryption.encrypt(params.content, dek);
        const [v] = await db.insert(schema.versions).values({
          page_id: pageId,
          number: 1,
          status: 'published',
          encrypted_blob: encryptedBlob,
          created_by: params.authorId || 'claude-mcp-agent',
          created_at: new Date(),
        }).returning({ id: schema.versions.id });
        await db.update(schema.pages).set({ current_version_id: v.id }).where(eq(schema.pages.id, pageId));
      }
    } catch (encErr) {
      console.error('Failed to encrypt note version in addNote:', encErr);
    }

    // Record audit entry
    await db.insert(schema.auditEvents).values({
      actor_id: params.authorId || 'claude-mcp-agent',
      action: 'create_page',
      target_id: pageId,
      metadata: { source: 'mcp_gateway', title: params.title },
    });

    return {
      noteId: pageId,
      status: 'created',
    };
  }
}

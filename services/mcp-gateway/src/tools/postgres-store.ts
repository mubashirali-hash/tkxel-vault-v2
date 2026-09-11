import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { eq, and, or, ilike, sql } from 'drizzle-orm';
import { OpenVaultStore } from './open-retrieval.js';
import crypto from 'node:crypto';

export class PostgresOpenVaultStore implements OpenVaultStore {
  /**
   * Search pages in the database using keyword and ILIKE matching on title, tags, and body.
   */
  async search(query: string, vaultId?: string, limit: number = 10): Promise<Array<{ id: string; title: string; snippet: string }>> {
    const targetVault = vaultId || '11111111-1111-1111-1111-111111111111';
    const cleanQuery = `%${query.trim()}%`;
    const tokens = query.trim().split(/\s+/).filter((t) => t.length > 1);

    const conditions = [
      ilike(schema.pages.title, cleanQuery),
      sql`cast(${schema.pages.tags} as text) ILIKE ${cleanQuery}`,
      sql`(${schema.pages.front_matter}->>'body') ILIKE ${cleanQuery}`
    ];

    for (const token of tokens) {
      const term = `%${token}%`;
      conditions.push(
        ilike(schema.pages.title, term),
        sql`cast(${schema.pages.tags} as text) ILIKE ${term}`,
        sql`(${schema.pages.front_matter}->>'body') ILIKE ${term}`
      );
    }

    const matches = await db
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.vault_id, targetVault),
          or(...conditions)
        )
      )
      .limit(limit);

    return matches.map((p) => {
      const body = (p.front_matter as any)?.body || '';
      const snippet = body.length > 200 ? body.slice(0, 200) + '...' : body || `# ${p.title}`;
      return {
        id: p.id,
        title: p.title,
        snippet,
      };
    });
  }

  /**
   * Retrieve full page content, front matter, tags, and backlinks by title.
   */
  async getPage(
    title: string,
    vaultId?: string
  ): Promise<{ title: string; content: string; tags: string[]; backlinks: string[] } | null> {
    const targetVault = vaultId || '11111111-1111-1111-1111-111111111111';
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

    // Fetch backlinks
    const incomingLinks = await db
      .select()
      .from(schema.links)
      .where(eq(schema.links.to_page_id, page.id));

    const backlinkTitles = incomingLinks
      .map((l) => allPages.find((p) => p.id === l.from_page_id)?.title)
      .filter((t): t is string => Boolean(t));

    const body = (page.front_matter as any)?.body || `# ${page.title}`;

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
    maxHops: number = 1
  ): Promise<{ nodes: Array<{ id: string; label: string }>; edges: Array<{ from: string; to: string }> }> {
    const allPages = await db.select().from(schema.pages);
    const allDbLinks = await db.select().from(schema.links);

    // Resolve focal page ID if title was passed
    const focal = allPages.find((p) => p.id === pageId || p.title.toLowerCase() === pageId.toLowerCase());
    if (!focal) {
      return { nodes: [], edges: [] };
    }

    const neighborhood = new Set<string>([focal.id]);

    // Hop 1
    allDbLinks.forEach((l) => {
      if (l.from_page_id === focal.id && l.to_page_id) neighborhood.add(l.to_page_id);
      if (l.to_page_id === focal.id) neighborhood.add(l.from_page_id);
    });

    // Hop 2
    if (maxHops >= 2) {
      const hop1 = Array.from(neighborhood);
      allDbLinks.forEach((l) => {
        if (hop1.includes(l.from_page_id) && l.to_page_id) neighborhood.add(l.to_page_id);
        if (l.to_page_id && hop1.includes(l.to_page_id)) neighborhood.add(l.from_page_id);
      });
    }

    const nodes = allPages
      .filter((p) => neighborhood.has(p.id))
      .map((p) => ({ id: p.id, label: p.title }));

    const edges = allDbLinks
      .filter((l) => l.to_page_id && neighborhood.has(l.from_page_id) && neighborhood.has(l.to_page_id))
      .map((l) => ({ from: l.from_page_id, to: l.to_page_id! }));

    return { nodes, edges };
  }

  /**
   * Assemble a token-budgeted Markdown context block with target page, outgoing links, and backlinks.
   */
  async getContext(
    query: string,
    targetPage?: string,
    maxTokens: number = 4000
  ): Promise<{ markdown: string; tokenEstimate: number }> {
    let focalTitle = targetPage;

    // If no target page specified, find the most relevant via search
    if (!focalTitle) {
      const searchResults = await this.search(query, undefined, 1);
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

    const pageData = await this.getPage(focalTitle);
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
        const blData = await this.getPage(backlink);
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
    const vaultId = params.vaultId || '11111111-1111-1111-1111-111111111111';

    await db.insert(schema.pages).values({
      id: pageId,
      vault_id: vaultId,
      type: 'note',
      title: params.title,
      aliases: [],
      tags: params.tags || ['mcp-agent'],
      front_matter: {
        title: params.title,
        body: params.content,
        tags: params.tags || ['mcp-agent'],
        author: params.authorId,
      },
      created_at: new Date(),
      updated_at: new Date(),
    });

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

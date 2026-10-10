import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { getPageContent, createKmsProvider, EnvelopeEncryption, appendTimelineEntry, listTimelineEntries } from '@tkxel-vault/vault-core';
import { searchPages } from '@tkxel-vault/vault-core/search';
import { eq, and, or, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { OpenVaultStore } from './open-retrieval.js';
import crypto from 'node:crypto';

export class PostgresOpenVaultStore implements OpenVaultStore {
  /**
   * Search pages in the database using keyword and ILIKE matching on title, tags, and body.
   */
  async search(
    query: string,
    vaultId: string,
    limit: number = 10,
    filters?: { types?: string[]; tags?: string[] }
  ): Promise<Array<{ id: string; title: string; snippet: string; type?: string; score?: number }>> {
    const targetVault = vaultId;
    try {
      const results = await searchPages(targetVault, query, limit, {
        publishedOnly: true,
        types: filters?.types,
        tags: filters?.tags,
      });
      return results.map((r: any) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet || `# ${r.title}`,
        type: r.type,
        score: r.score,
      }));
    } catch (err) {
      console.warn('Fallback in search:', err);
      return [];
    }
  }

  /**
   * Finds one page in a vault by ID, title or alias with an indexed query. The vault is never loaded whole.
   */
  private async findPage(reference: string, vaultId: string) {
    const ref = String(reference || '').trim();
    if (!ref) return null;

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
      const byId = await db
        .select()
        .from(schema.pages)
        .where(and(eq(schema.pages.vault_id, vaultId), eq(schema.pages.id, ref)))
        .limit(1);
      if (byId[0]) return byId[0];
    }

    const normalized = ref.toLowerCase();
    const slug = normalized.replace(/\s+/g, '_');
    const rows = await db
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.vault_id, vaultId),
          sql`(
            lower(${schema.pages.title}) IN (${normalized}, ${slug})
            OR replace(lower(${schema.pages.title}), '_', ' ') = ${normalized}
            OR EXISTS (SELECT 1 FROM unnest(${schema.pages.aliases}) AS a WHERE lower(a) IN (${normalized}, ${slug}))
          )`
        )
      )
      // An exact title match wins over an alias match; the ID makes the choice stable
      .orderBy(sql`(lower(${schema.pages.title}) = ${normalized}) DESC`, schema.pages.id)
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Retrieve full page content, front matter, tags, and backlinks by title.
   */
  async getPage(
    title: string,
    vaultId: string
  ): Promise<{
    title: string;
    content: string;
    tags: string[];
    backlinks: string[];
    id: string;
    type: string;
    front_matter: Record<string, unknown>;
    links_out: string[];
    timeline: Array<{ date: string; entry: string }>;
  } | null> {
    const page = await this.findPage(title, vaultId);

    if (!page) return null;

    // Retrieval tools only ever serve the latest published snapshot (FR-43).
    // A page with no published version is indistinguishable from a missing page.
    // The four reads are independent, so they run concurrently.
    const fromPages = alias(schema.pages, 'from_pages');
    const [pageContentRec, incomingLinks, outgoing, timelineRows] = await Promise.all([
      getPageContent(page.id, undefined, { publishedOnly: true }),
      // Backlinks strictly originating from pages within the same vault
      db
        .select({ from_title: fromPages.title })
        .from(schema.links)
        .innerJoin(fromPages, and(eq(schema.links.from_page_id, fromPages.id), eq(fromPages.vault_id, vaultId)))
        .where(and(eq(schema.links.to_page_id, page.id), eq(schema.links.resolved, true))),
      db
        .select({ raw_target: schema.links.raw_target })
        .from(schema.links)
        .where(eq(schema.links.from_page_id, page.id)),
      listTimelineEntries(vaultId, page.id),
    ]);
    if (!pageContentRec) return null;

    const backlinkTitles = incomingLinks
      .map((l) => l.from_title)
      .filter((t): t is string => Boolean(t));

    const body = pageContentRec.content || `# ${page.title}`;
    const timeline = timelineRows.map((e) => ({ date: e.date, entry: e.entry_text }));

    const { body: _legacyBody, ...frontMatter } = (page.front_matter as Record<string, unknown>) || {};

    return {
      title: page.title,
      content: body,
      tags: page.tags || [],
      backlinks: backlinkTitles,
      id: page.id,
      type: page.type,
      front_matter: { ...frontMatter, title: page.title, type: page.type, tags: page.tags || [], aliases: page.aliases || [] },
      links_out: Array.from(new Set(outgoing.map((l) => l.raw_target))),
      timeline,
    };
  }

  /**
   * Explore 1-hop and 2-hop bidirectional graph neighborhood around pageId.
   */
  async getLinks(
    pageId: string,
    vaultId: string,
    maxHops: number = 1
  ): Promise<{
    nodes: Array<{ id: string; label: string; title: string; type: string }>;
    edges: Array<{ from: string; to: string; type: string }>;
  }> {
    // Only published pages exist as far as retrieval tools are concerned (FR-43, FR-44)
    const focal = await this.findPage(pageId, vaultId);
    if (!focal || !focal.current_version_id) {
      return { nodes: [], edges: [] };
    }

    // Links are fetched hop by hop around the focal page, never the whole vault. Both endpoints are
    // joined to this vault and only resolved links count (ADR-018).
    const fromPages = alias(schema.pages, 'from_pages');
    const toPages = alias(schema.pages, 'to_pages');
    const linksTouching = async (ids: string[]) =>
      db
        .select({
          from_page_id: schema.links.from_page_id,
          to_page_id: schema.links.to_page_id,
          link_type: schema.links.link_type,
        })
        .from(schema.links)
        .innerJoin(fromPages, and(eq(schema.links.from_page_id, fromPages.id), eq(fromPages.vault_id, vaultId)))
        .innerJoin(toPages, and(eq(schema.links.to_page_id, toPages.id), eq(toPages.vault_id, vaultId)))
        .where(
          and(
            eq(schema.links.resolved, true),
            or(inArray(schema.links.from_page_id, ids), inArray(schema.links.to_page_id, ids))
          )
        );

    const neighborhood = new Set<string>([focal.id]);
    let frontier = [focal.id];
    const collected = new Map<string, { from_page_id: string; to_page_id: string | null; link_type: string | null }>();

    for (let hop = 0; hop < (maxHops >= 2 ? 2 : 1) && frontier.length > 0; hop++) {
      const next: string[] = [];
      for (const l of await linksTouching(frontier)) {
        collected.set(`${l.from_page_id}>${l.to_page_id}>${l.link_type}`, l);
        for (const id of [l.from_page_id, l.to_page_id]) {
          if (id && !neighborhood.has(id)) {
            neighborhood.add(id);
            next.push(id);
          }
        }
      }
      frontier = next;
    }

    const nodePages = await db
      .select({ id: schema.pages.id, title: schema.pages.title, type: schema.pages.type })
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.vault_id, vaultId),
          inArray(schema.pages.id, Array.from(neighborhood)),
          isNotNull(schema.pages.current_version_id)
        )
      );
    const visible = new Set(nodePages.map((p) => p.id));

    const nodes = nodePages.map((p) => ({ id: p.id, label: p.title, title: p.title, type: p.type }));
    const edges = Array.from(collected.values())
      .filter((l) => l.to_page_id && visible.has(l.from_page_id) && visible.has(l.to_page_id))
      .map((l) => ({ from: l.from_page_id, to: l.to_page_id!, type: l.link_type || 'wiki' }));

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
  ): Promise<{ markdown: string; tokenEstimate: number; pages: Array<{ title: string; body_markdown: string }> }> {
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
        markdown: 'No context documents found in the vault for this query.',
        tokenEstimate: 10,
        pages: [],
      };
    }

    const pageData = await this.getPage(focalTitle, vaultId);
    if (!pageData) {
      return {
        markdown: 'No context documents found in the vault for this query.',
        tokenEstimate: 10,
        pages: [],
      };
    }

    const pages: Array<{ title: string; body_markdown: string }> = [
      { title: pageData.title, body_markdown: pageData.content },
    ];
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
          pages.push({ title: blData.title, body_markdown: blData.content });
        }
      }
    }

    const fullMarkdown = contextParts.join('\n');
    // Approximate token count (1 token ~= 4 characters)
    const tokenEstimate = Math.min(Math.ceil(fullMarkdown.length / 4), maxTokens);

    return {
      markdown: fullMarkdown,
      tokenEstimate,
      pages,
    };
  }

  /**
   * Appends a dated entry to an existing page's timeline (FR-66). The page must belong to the vault;
   * a foreign or unknown page is reported as not_found.
   */
  async appendTimelineEntry(params: { vaultId: string; pageId: string; entry: string; authorId: string }): Promise<{ pageId: string; entryId: string }> {
    if (!/^[0-9a-f-]{36}$/i.test(params.pageId)) {
      throw new Error('not_found');
    }
    const entry = await appendTimelineEntry({
      vaultId: params.vaultId,
      pageId: params.pageId,
      entry: params.entry,
      actorId: params.authorId,
    });
    return { pageId: entry.page_id, entryId: entry.id };
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

    const vaultRec = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultId)).limit(1);
    if (!vaultRec[0]?.data_key_id) {
      throw new Error('not_found');
    }
    const kms = createKmsProvider();
    const dek = await kms.unwrapKey(vaultRec[0].data_key_id);

    try {
      const encryptedBlob = EnvelopeEncryption.encrypt(params.content, dek);

      // Page, draft version and audit event are written atomically: a note never exists without content.
      // Notes written through Claude are drafts in /inbox; only an Owner can publish them (FR-41, FR-66).
      await db.transaction(async (tx) => {
        await tx.insert(schema.pages).values({
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
            folder: 'inbox',
          },
          created_at: new Date(),
          updated_at: new Date(),
        });

        await tx.insert(schema.versions).values({
          page_id: pageId,
          number: 1,
          status: 'draft',
          encrypted_blob: encryptedBlob,
          created_by: params.authorId || 'claude-mcp-agent',
          created_at: new Date(),
        });

        await tx.insert(schema.auditEvents).values({
          actor_id: params.authorId || 'claude-mcp-agent',
          action: 'create_page',
          target_id: pageId,
          metadata: { source: 'mcp_gateway', title: params.title, status: 'draft' },
        });
      });
    } finally {
      dek.fill(0);
    }

    return {
      noteId: pageId,
      status: 'draft_created',
    };
  }
}

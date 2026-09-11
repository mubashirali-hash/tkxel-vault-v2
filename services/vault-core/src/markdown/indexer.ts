import { db } from '../db.js';
import { links, pages } from '../schema/index.js';
import { eq } from 'drizzle-orm';
import { parseMarkdown } from './parser.js';

export class LinkGraphIndexer {
  /**
   * Updates the bidirectional links for a page based on its current markdown content.
   * This parses the content, clears old links originating from this page,
   * resolves new target pages by title/alias within the vault, and inserts the new link graph.
   */
  static async updateLinksForPage(vaultId: string, pageId: string, content: string): Promise<void> {
    const parsed = parseMarkdown(content);
    
    // Clear old outgoing links
    await db.delete(links).where(eq(links.from_page_id, pageId));

    if (parsed.links.length === 0) {
      return;
    }

    const newLinks: Array<{
      from_page_id: string;
      to_page_id: string | null;
      raw_target: string;
      link_type: string | null;
      resolved: boolean;
    }> = [];

    // Resolve each target link against pages in the same vault
    // To do this efficiently, we query potential matches
    const allVaultPages = await db.query.pages.findMany({
      where: eq(pages.vault_id, vaultId),
      columns: { id: true, title: true, aliases: true }
    });

    const pageMap = new Map<string, string>();
    for (const p of allVaultPages) {
      pageMap.set(p.title.toLowerCase(), p.id);
      if (p.aliases && p.aliases.length > 0) {
        for (const alias of p.aliases) {
          pageMap.set(alias.toLowerCase(), p.id);
        }
      }
    }

    for (const link of parsed.links) {
      const targetLower = link.target.toLowerCase();
      const targetId = pageMap.get(targetLower);

      newLinks.push({
        from_page_id: pageId,
        to_page_id: targetId || null,
        raw_target: link.target,
        link_type: link.linkType || null,
        resolved: !!targetId
      });
    }

    // Insert new links
    if (newLinks.length > 0) {
      await db.insert(links).values(newLinks);
    }
  }
}

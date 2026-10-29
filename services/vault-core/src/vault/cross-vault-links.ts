import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { pages, links, vaults } from '../schema/index.js';
import { getUserAccessibleVaults } from '../auth/index.js';

export interface CrossVaultLink {
  raw_target: string;
  link_type: string;
  /** False when the target does not exist, is ambiguous, or sits in a vault the caller cannot read. */
  available: boolean;
  target?: { page_id: string; vault_id: string; vault_name: string; title: string };
}

/**
 * Resolves a page's unresolved links against the other open vaults the caller can read (FR-16).
 *
 * Stored link rows never span vaults (ADR-018), so this is computed per request, for one caller, and
 * nothing is persisted. A link is available only when exactly one readable page matches its target.
 * Every other case returns the same `available: false`, so a caller cannot tell a missing page from
 * one that exists in a vault they have no access to. Locked vaults are never consulted.
 */
export async function resolveCrossVaultLinks(params: {
  userId: string;
  vaultId: string;
  pageId: string;
}): Promise<CrossVaultLink[]> {
  const ghostLinks = await db
    .select({ raw_target: links.raw_target, link_type: links.link_type })
    .from(links)
    .innerJoin(pages, and(eq(links.from_page_id, pages.id), eq(pages.vault_id, params.vaultId)))
    .where(and(eq(links.from_page_id, params.pageId), eq(links.resolved, false)));

  if (ghostLinks.length === 0) return [];

  const readable = (await getUserAccessibleVaults(params.userId)).filter(
    (v) => v.vaultId !== params.vaultId && v.mode === 'open' && (v.role === 'owner' || v.role === 'editor' || v.role === 'reader')
  );
  const targets = Array.from(new Set(ghostLinks.map((l) => l.raw_target.trim().toLowerCase()).filter(Boolean)));

  const matchesByTarget = new Map<string, Array<{ page_id: string; vault_id: string; vault_name: string; title: string }>>();

  if (readable.length > 0 && targets.length > 0) {
    const roleByVault = new Map(readable.map((v) => [v.vaultId, v.role]));
    const targetList = sql.join(targets.map((t) => sql`${t}`), sql`, `);

    const candidates = await db
      .select({
        id: pages.id,
        title: pages.title,
        aliases: pages.aliases,
        vault_id: pages.vault_id,
        current_version_id: pages.current_version_id,
        vault_name: vaults.name,
        vault_mode: vaults.mode,
      })
      .from(pages)
      .innerJoin(vaults, eq(pages.vault_id, vaults.id))
      .where(
        and(
          inArray(pages.vault_id, readable.map((v) => v.vaultId)),
          sql`(lower(${pages.title}) IN (${targetList})
               OR EXISTS (SELECT 1 FROM unnest(${pages.aliases}) AS a WHERE lower(a) IN (${targetList})))`
        )
      );

    for (const page of candidates) {
      // Mode is re-checked on the row, and Readers only ever see published pages (FR-43)
      if (page.vault_mode !== 'open') continue;
      if (roleByVault.get(page.vault_id) === 'reader' && !page.current_version_id) continue;

      const names = [page.title, ...(page.aliases || [])].map((n) => n.trim().toLowerCase());
      for (const target of targets) {
        if (!names.includes(target)) continue;
        const list = matchesByTarget.get(target) ?? [];
        list.push({ page_id: page.id, vault_id: page.vault_id, vault_name: page.vault_name, title: page.title });
        matchesByTarget.set(target, list);
      }
    }
  }

  return ghostLinks.map((link) => {
    const matches = matchesByTarget.get(link.raw_target.trim().toLowerCase()) ?? [];
    const base = { raw_target: link.raw_target, link_type: link.link_type || 'wiki' };
    return matches.length === 1 ? { ...base, available: true, target: matches[0] } : { ...base, available: false };
  });
}

import { eq, and, ne, isNull, sql } from 'drizzle-orm';
import { db as defaultDb } from '../db.js';
import { links, pages, vaults } from '../schema/index.js';
import { parseMarkdown } from './parser.js';
import { VaultValidationError } from '../vault/create-vault.js';
import { lockPageForMutation } from '../storage/page-lock.js';

export interface ReconcileLinksOnMoveParams {
  tx: any;
  pageId: string;
  sourceVaultId: string;
  destinationVaultId: string;
  destinationMode: 'open' | 'locked';
  pageTitle: string;
  pageAliases: string[];
  latestPlaintext: string | null;
}

export class LinkGraphIndexer {
  /**
   * Updates the bidirectional links for a page based on its current markdown content.
   *
   * Invariants (Epic 6 Chunk 6.3 Hardened):
   * - Starts or joins a database transaction.
   * - Acquires lockPageForMutation row lock before reading or modifying graph.
   * - Derives authoritative vault ID and page metadata strictly from the locked page row.
   * - If an expected vault ID is accepted, treats it as an assertion and returns 'not_found' on mismatch.
   * - Resolves vault mode after locking.
   * - Performs old-link deletion and replacement atomically inside transaction.
   * - A locked-vault ID paired with a foreign page ID causes zero mutation.
   */
  static async updateLinksForPage(
    expectedVaultId: string,
    pageId: string,
    content: string,
    tx?: any
  ): Promise<void> {
    const execute = async (activeTx: any) => {
      // 1. Acquire exclusive row lock on the page and assert expectedVaultId if provided
      const pageRec = await lockPageForMutation(
        activeTx,
        pageId,
        expectedVaultId ? { expectedVaultId } : undefined
      );

      // 2. Derive authoritative vault ID from locked row
      const authoritativeVaultId = pageRec.vault_id;

      // 3. Resolve vault mode after locking
      const [vaultRec] = await activeTx
        .select({ mode: vaults.mode })
        .from(vaults)
        .where(eq(vaults.id, authoritativeVaultId))
        .limit(1);

      if (!vaultRec) {
        throw new Error('not_found');
      }

      if (vaultRec.mode === 'locked') {
        // Locked vault: zero-read graph metadata. Purge outgoing links atomically and return.
        await activeTx.delete(links).where(eq(links.from_page_id, pageId));
        return;
      }

      const parsed = parseMarkdown(content);

      // Clear old outgoing links atomically
      await activeTx.delete(links).where(eq(links.from_page_id, pageId));

      if (parsed.links.length === 0) {
        return;
      }

      // Resolve target pages strictly in the authoritative vault
      const allVaultPages = await activeTx
        .select({ id: pages.id, title: pages.title, aliases: pages.aliases })
        .from(pages)
        .where(eq(pages.vault_id, authoritativeVaultId));

      const candidateMap = new Map<string, string[]>();
      for (const p of allVaultPages) {
        const tLower = p.title.trim().toLowerCase();
        if (!candidateMap.has(tLower)) candidateMap.set(tLower, []);
        candidateMap.get(tLower)!.push(p.id);

        if (p.aliases && Array.isArray(p.aliases)) {
          for (const alias of p.aliases) {
            const aLower = alias.trim().toLowerCase();
            if (!candidateMap.has(aLower)) candidateMap.set(aLower, []);
            if (!candidateMap.get(aLower)!.includes(p.id)) {
              candidateMap.get(aLower)!.push(p.id);
            }
          }
        }
      }

      const newLinks: Array<{
        from_page_id: string;
        to_page_id: string | null;
        raw_target: string;
        link_type: string | null;
        resolved: boolean;
      }> = [];

      for (const link of parsed.links) {
        const targetLower = link.target.trim().toLowerCase();
        const matches = candidateMap.get(targetLower);
        const targetId = matches && matches.length === 1 ? matches[0] : null;

        newLinks.push({
          from_page_id: pageId,
          to_page_id: targetId,
          raw_target: link.target,
          link_type: link.linkType || 'wiki',
          resolved: Boolean(targetId),
        });
      }

      if (newLinks.length > 0) {
        await activeTx.insert(links).values(newLinks);
      }
    };

    if (tx) {
      await execute(tx);
    } else {
      await defaultDb.transaction(async (innerTx) => {
        await execute(innerTx);
      });
    }
  }

  /**
   * Resolves existing unresolved ghost links in a vault that point to a newly created
   * or moved page's title or aliases.
   *
   * Invariants (Epic 6 Chunk 6.3 Hardened):
   * - Locks and loads authoritative target page row using lockPageForMutation.
   * - Derives vault ID, title, and aliases from PostgreSQL row; never trusts caller metadata.
   * - If expectedVaultId is passed, treats it as assertion and throws 'not_found' on mismatch.
   * - Resolves only ghost links whose source pages belong to the same authoritative vault.
   * - A foreign target page never becomes to_page_id.
   */
  static async resolveIncomingGhostLinks(
    vaultIdOrTargetPageId: string,
    targetPageIdOrTx?: string | any,
    _unverifiedTitle?: string,
    _unverifiedAliases?: string[],
    tx?: any
  ): Promise<void> {
    let expectedVaultId: string | undefined;
    let targetPageId: string;
    let explicitTx: any;

    if (typeof targetPageIdOrTx === 'string') {
      expectedVaultId = vaultIdOrTargetPageId;
      targetPageId = targetPageIdOrTx;
      explicitTx = tx || (typeof _unverifiedTitle === 'object' ? _unverifiedTitle : undefined);
    } else {
      targetPageId = vaultIdOrTargetPageId;
      explicitTx = targetPageIdOrTx;
    }

    const execute = async (activeTx: any) => {
      // 1. Lock and load authoritative target page row
      const targetPage = await lockPageForMutation(
        activeTx,
        targetPageId,
        expectedVaultId ? { expectedVaultId } : undefined
      );

      // 2. Derive authoritative vault, title, and aliases strictly from database
      const authoritativeVaultId = targetPage.vault_id;
      const authoritativeTitle = targetPage.title;
      const authoritativeAliases = targetPage.aliases || [];

      // 3. Resolve vault mode after locking
      const [vaultRec] = await activeTx
        .select({ mode: vaults.mode })
        .from(vaults)
        .where(eq(vaults.id, authoritativeVaultId))
        .limit(1);

      if (!vaultRec || vaultRec.mode === 'locked') {
        // Locked vaults do not maintain incoming links
        return;
      }

      // 4. Resolve only ghost links whose source pages belong to that same authoritative vault
      const ghostLinks = await activeTx
        .select({
          id: links.id,
          from_page_id: links.from_page_id,
          raw_target: links.raw_target,
        })
        .from(links)
        .innerJoin(pages, and(eq(links.from_page_id, pages.id), eq(pages.vault_id, authoritativeVaultId)))
        .where(and(eq(links.resolved, false), isNull(links.to_page_id)));

      const matchingTargets = new Set<string>();
      if (authoritativeTitle) {
        matchingTargets.add(authoritativeTitle.trim().toLowerCase());
      }
      if (Array.isArray(authoritativeAliases)) {
        for (const a of authoritativeAliases) {
          if (a && typeof a === 'string') {
            matchingTargets.add(a.trim().toLowerCase());
          }
        }
      }

      for (const gl of ghostLinks) {
        if (gl.from_page_id === targetPageId) continue;
        if (matchingTargets.has(gl.raw_target.trim().toLowerCase())) {
          await activeTx
            .update(links)
            .set({ to_page_id: targetPageId, resolved: true })
            .where(eq(links.id, gl.id));
        }
      }
    };

    if (explicitTx) {
      await execute(explicitTx);
    } else {
      await defaultDb.transaction(async (innerTx) => {
        await execute(innerTx);
      });
    }
  }

  /**
   * Preflight validation for destination title/alias collisions before any move mutations.
   * Fails closed with generic VaultValidationError without identifying the conflicting destination page.
   */
  static async validateDestinationCollision(params: {
    tx: any;
    destinationVaultId: string;
    pageId: string;
    pageTitle: string;
    pageAliases: string[];
  }): Promise<void> {
    const { tx, destinationVaultId, pageId, pageTitle, pageAliases } = params;

    const destPages = await tx
      .select({
        id: pages.id,
        title: pages.title,
        aliases: pages.aliases,
      })
      .from(pages)
      .where(and(eq(pages.vault_id, destinationVaultId), ne(pages.id, pageId)));

    const destNormalizedSet = new Set<string>();
    for (const p of destPages) {
      destNormalizedSet.add(p.title.trim().toLowerCase());
      if (p.aliases && Array.isArray(p.aliases)) {
        for (const a of p.aliases) {
          destNormalizedSet.add(a.trim().toLowerCase());
        }
      }
    }

    const pageNormalizedTargets = new Set<string>();
    pageNormalizedTargets.add(pageTitle.trim().toLowerCase());
    if (pageAliases && Array.isArray(pageAliases)) {
      for (const a of pageAliases) {
        pageNormalizedTargets.add(a.trim().toLowerCase());
      }
    }

    for (const target of pageNormalizedTargets) {
      if (destNormalizedSet.has(target)) {
        // Return a generic VaultValidationError without identifying the conflicting destination page
        throw new VaultValidationError(
          'Validation error: title or alias collides with an existing page in destination vault'
        );
      }
    }
  }

  /**
   * Reconciles derived graph links during an atomic page move (Epic 6 Chunk 6.3).
   * Executed strictly inside the active page move transaction.
   *
   * Note: Title/alias collision validation has already been preflighted via validateDestinationCollision.
   */
  static async reconcileLinksOnPageMove(params: ReconcileLinksOnMoveParams): Promise<void> {
    const {
      tx,
      pageId,
      sourceVaultId,
      destinationVaultId,
      destinationMode,
      pageTitle,
      pageAliases,
      latestPlaintext,
    } = params;

    // 1. Fetch destination pages for graph link resolution
    const destPages = await tx
      .select({
        id: pages.id,
        title: pages.title,
        aliases: pages.aliases,
      })
      .from(pages)
      .where(and(eq(pages.vault_id, destinationVaultId), ne(pages.id, pageId)));

    const pageNormalizedTargets = new Set<string>();
    pageNormalizedTargets.add(pageTitle.trim().toLowerCase());
    if (pageAliases && Array.isArray(pageAliases)) {
      for (const a of pageAliases) {
        pageNormalizedTargets.add(a.trim().toLowerCase());
      }
    }

    // 2. Reconcile Inbound Source Links
    // All links originating from pages in sourceVaultId that pointed to pageId
    const inboundSourceLinks = await tx
      .select({
        id: links.id,
        from_page_id: links.from_page_id,
        raw_target: links.raw_target,
      })
      .from(links)
      .innerJoin(pages, and(eq(links.from_page_id, pages.id), eq(pages.vault_id, sourceVaultId)))
      .where(eq(links.to_page_id, pageId));

    if (inboundSourceLinks.length > 0) {
      const remainingSourcePages = await tx
        .select({
          id: pages.id,
          title: pages.title,
          aliases: pages.aliases,
        })
        .from(pages)
        .where(and(eq(pages.vault_id, sourceVaultId), ne(pages.id, pageId)));

      const sourceCandidateMap = new Map<string, string[]>();
      for (const p of remainingSourcePages) {
        const tLower = p.title.trim().toLowerCase();
        if (!sourceCandidateMap.has(tLower)) sourceCandidateMap.set(tLower, []);
        sourceCandidateMap.get(tLower)!.push(p.id);

        if (p.aliases && Array.isArray(p.aliases)) {
          for (const a of p.aliases) {
            const aLower = a.trim().toLowerCase();
            if (!sourceCandidateMap.has(aLower)) sourceCandidateMap.set(aLower, []);
            if (!sourceCandidateMap.get(aLower)!.includes(p.id)) {
              sourceCandidateMap.get(aLower)!.push(p.id);
            }
          }
        }
      }

      for (const link of inboundSourceLinks) {
        const targetLower = link.raw_target.trim().toLowerCase();
        const matches = sourceCandidateMap.get(targetLower);
        if (matches && matches.length === 1) {
          // Re-point to the unique remaining source-vault alternative
          await tx
            .update(links)
            .set({ to_page_id: matches[0], resolved: true })
            .where(eq(links.id, link.id));
        } else {
          // Convert to ghost link
          await tx
            .update(links)
            .set({ to_page_id: null, resolved: false })
            .where(eq(links.id, link.id));
        }
      }
    }

    // 3. Outgoing Links from pageId
    // Clear old outgoing links
    await tx.delete(links).where(eq(links.from_page_id, pageId));

    if (destinationMode === 'open' && latestPlaintext) {
      const parsed = parseMarkdown(latestPlaintext);
      if (parsed.links.length > 0) {
        // Collect all pages in destination vault (including pageId)
        const destVaultPages = [
          ...destPages,
          { id: pageId, title: pageTitle, aliases: pageAliases },
        ];

        const destCandidateMap = new Map<string, string[]>();
        for (const p of destVaultPages) {
          const tLower = p.title.trim().toLowerCase();
          if (!destCandidateMap.has(tLower)) destCandidateMap.set(tLower, []);
          destCandidateMap.get(tLower)!.push(p.id);

          if (p.aliases && Array.isArray(p.aliases)) {
            for (const a of p.aliases) {
              const aLower = a.trim().toLowerCase();
              if (!destCandidateMap.has(aLower)) destCandidateMap.set(aLower, []);
              if (!destCandidateMap.get(aLower)!.includes(p.id)) {
                destCandidateMap.get(aLower)!.push(p.id);
              }
            }
          }
        }

        const newLinks: Array<{
          from_page_id: string;
          to_page_id: string | null;
          raw_target: string;
          link_type: string;
          resolved: boolean;
        }> = [];

        for (const l of parsed.links) {
          const targetLower = l.target.trim().toLowerCase();
          const matches = destCandidateMap.get(targetLower);
          const targetId = matches && matches.length === 1 ? matches[0] : null;

          newLinks.push({
            from_page_id: pageId,
            to_page_id: targetId,
            raw_target: l.target,
            link_type: l.linkType || 'wiki',
            resolved: Boolean(targetId),
          });
        }

        if (newLinks.length > 0) {
          await tx.insert(links).values(newLinks);
        }
      }
    }

    // 4. Resolve Existing Unresolved Destination Links (Open Destination Only)
    if (destinationMode === 'open') {
      const unresolvedDestLinks = await tx
        .select({
          id: links.id,
          raw_target: links.raw_target,
        })
        .from(links)
        .innerJoin(pages, and(eq(links.from_page_id, pages.id), eq(pages.vault_id, destinationVaultId)))
        .where(and(eq(links.resolved, false), isNull(links.to_page_id)));

      for (const ul of unresolvedDestLinks) {
        if (pageNormalizedTargets.has(ul.raw_target.trim().toLowerCase())) {
          await tx
            .update(links)
            .set({ to_page_id: pageId, resolved: true })
            .where(eq(links.id, ul.id));
        }
      }
    }

    // 5. Defensive Invariant Verification
    // A. No resolved link may ever connect pages in different vaults
    const crossVaultLinks = await tx.execute(sql`
      SELECT l.id, p1.vault_id as from_vault, p2.vault_id as to_vault
      FROM ${links} l
      JOIN ${pages} p1 ON l.from_page_id = p1.id
      JOIN ${pages} p2 ON l.to_page_id = p2.id
      WHERE l.resolved = true AND p1.vault_id != p2.vault_id
      LIMIT 1
    `);

    if (crossVaultLinks.rows && crossVaultLinks.rows.length > 0) {
      throw new Error('Cross-vault link invariant violation detected: resolved link spans across vaults');
    }

    // B. No link may originate from a locked vault
    const lockedLinks = await tx.execute(sql`
      SELECT l.id
      FROM ${links} l
      JOIN ${pages} p ON l.from_page_id = p.id
      JOIN ${vaults} v ON p.vault_id = v.id
      WHERE v.mode = 'locked'
      LIMIT 1
    `);

    if (lockedLinks.rows && lockedLinks.rows.length > 0) {
      throw new Error('Locked vault graph invariant violation: link originates from a locked vault');
    }
  }
}

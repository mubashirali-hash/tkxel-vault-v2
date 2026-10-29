import { eq, and, asc, inArray, or } from 'drizzle-orm';
import { db } from '../db.js';
import { pages, vaults, versions, auditEvents } from '../schema/index.js';
import { createKmsProvider, EnvelopeEncryption } from '../crypto/kms.js';
import { MarkdownEngine } from '../markdown/parser.js';
import { LinkGraphIndexer } from '../markdown/indexer.js';
import { VaultValidationError } from './create-vault.js';

export class PageTitleConflictError extends Error {
  public readonly code = 'TITLE_CONFLICT';
  constructor() {
    // Generic by design: never identifies the conflicting page
    super('A page with this title or alias already exists in the vault.');
    this.name = 'PageTitleConflictError';
  }
}

export interface RenamePageParams {
  vaultId: string;
  pageId: string;
  newTitle: string;
  actorId: string;
  /** Optimistic concurrency guard on the renamed page; mismatch throws code CONCURRENT_MODIFICATION. */
  expectedUpdatedAt?: string;
}

export interface RenamePageResult {
  pageId: string;
  oldTitle: string;
  newTitle: string;
  renamed: boolean;
  updated_at: string;
  /** Other pages whose content was rewritten to point at the new title. */
  refactoredPages: Array<{ id: string; updated_at: string }>;
}

/**
 * Renames a page and rewrites every wiki-link that references it, in one transaction (FR-12).
 *
 * - All pages of the vault are locked in id order, so concurrent renames and saves serialize.
 * - The working draft and the current published snapshot of each referencing page are rewritten,
 *   so Editors and Readers both keep working links. Only the link target text changes.
 * - The link graph rows are rebuilt for every rewritten page and ghost links naming the new title resolve.
 * - Either everything commits or nothing does.
 */
export async function renamePage(params: RenamePageParams): Promise<RenamePageResult> {
  const newTitle = (params.newTitle || '').trim();
  if (!newTitle) {
    throw new VaultValidationError('Page title is required');
  }
  if (newTitle.length > 255) {
    throw new VaultValidationError('Page title must be 255 characters or fewer');
  }
  if (/[\[\]|\r\n]/.test(newTitle) || newTitle.includes('::')) {
    throw new VaultValidationError('Page title cannot contain [ ] | :: or line breaks');
  }

  let dek: Buffer | undefined;

  try {
    return await db.transaction(async (tx) => {
      // 1. Vault identity and mode (FOR SHARE prevents mode drift during the refactor)
      const vaultRows = await tx.select({ id: vaults.id, mode: vaults.mode, data_key_id: vaults.data_key_id })
        .from(vaults)
        .where(eq(vaults.id, params.vaultId))
        .for('share')
        .limit(1);
      const vault = vaultRows[0];
      if (!vault) {
        throw new Error('not_found');
      }
      if (vault.mode !== 'open') {
        throw new VaultValidationError('Pages can only be renamed in open vaults');
      }

      // 2. Lock every page of the vault in a deterministic order
      const vaultPages = await tx.select()
        .from(pages)
        .where(eq(pages.vault_id, params.vaultId))
        .orderBy(asc(pages.id))
        .for('update');

      const target = vaultPages.find((p) => p.id === params.pageId);
      if (!target) {
        throw new Error('not_found');
      }

      if (params.expectedUpdatedAt) {
        const currentMs = target.updated_at ? new Date(target.updated_at).getTime() : 0;
        const expectedMs = new Date(params.expectedUpdatedAt).getTime();
        if (currentMs && !isNaN(expectedMs) && currentMs !== expectedMs) {
          const conflictError = new Error('Conflict: Page was modified by another user.');
          (conflictError as any).code = 'CONCURRENT_MODIFICATION';
          throw conflictError;
        }
      }

      const oldTitle = target.title;
      if (oldTitle === newTitle) {
        return {
          pageId: target.id,
          oldTitle,
          newTitle,
          renamed: false,
          updated_at: target.updated_at.toISOString(),
          refactoredPages: [],
        };
      }

      // 3. The new title must not collide with another page's title or alias
      const newLower = newTitle.toLowerCase();
      const collides = vaultPages.some(
        (p) =>
          p.id !== target.id &&
          (p.title.trim().toLowerCase() === newLower ||
            (Array.isArray(p.aliases) && p.aliases.some((a) => a.trim().toLowerCase() === newLower)))
      );
      if (collides) {
        throw new PageTitleConflictError();
      }

      const now = new Date();

      // 4. Rename the page itself
      const frontMatter = { ...((target.front_matter as Record<string, unknown>) || {}) };
      if ('title' in frontMatter) frontMatter.title = newTitle;
      await tx.update(pages)
        .set({ title: newTitle, front_matter: frontMatter, updated_at: now })
        .where(and(eq(pages.id, target.id), eq(pages.vault_id, params.vaultId)));

      // 5. Rewrite referencing content: each other page's working draft and current published snapshot
      const otherPages = vaultPages.filter((p) => p.id !== target.id);
      const refactoredPages: Array<{ id: string; updated_at: string }> = [];

      if (otherPages.length > 0) {
        const otherIds = otherPages.map((p) => p.id);
        const publishedIds = otherPages.map((p) => p.current_version_id).filter((id): id is string => Boolean(id));
        const candidateVersions = await tx.select()
          .from(versions)
          .where(and(
            inArray(versions.page_id, otherIds),
            publishedIds.length > 0
              ? or(eq(versions.status, 'draft'), inArray(versions.id, publishedIds))
              : eq(versions.status, 'draft')
          ));

        if (candidateVersions.length > 0) {
          const kms = createKmsProvider();
          dek = await kms.unwrapKey(vault.data_key_id);
        }

        // Content the link graph should reflect per page: highest version number wins (draft over published)
        const graphSource = new Map<string, { number: number; content: string }>();
        const oldLower = oldTitle.toLowerCase();

        for (const v of candidateVersions) {
          const plaintext = EnvelopeEncryption.decryptToString(v.encrypted_blob, dek!);
          if (!plaintext.toLowerCase().includes(oldLower)) continue;

          const rewritten = MarkdownEngine.refactorLinks(plaintext, oldTitle, newTitle, { caseInsensitive: true });
          if (rewritten === plaintext) continue;

          await tx.update(versions)
            .set({ encrypted_blob: EnvelopeEncryption.encrypt(rewritten, dek!) })
            .where(eq(versions.id, v.id));

          const known = graphSource.get(v.page_id);
          if (!known || v.number > known.number) {
            graphSource.set(v.page_id, { number: v.number, content: rewritten });
          }
        }

        for (const [refPageId, source] of graphSource) {
          await tx.update(pages).set({ updated_at: now }).where(eq(pages.id, refPageId));
          await LinkGraphIndexer.updateLinksForPage(params.vaultId, refPageId, source.content, tx);
          refactoredPages.push({ id: refPageId, updated_at: now.toISOString() });
        }
      }

      // 6. Ghost links that already named the new title now resolve to this page
      await LinkGraphIndexer.resolveIncomingGhostLinks(target.id, tx);

      // 7. Audit (same transaction: a rename is never unrecorded)
      await tx.insert(auditEvents).values({
        actor_id: params.actorId,
        action: 'rename_page',
        target_id: target.id,
        metadata: { vault_id: params.vaultId, refactored_pages: refactoredPages.length },
      });

      return {
        pageId: target.id,
        oldTitle,
        newTitle,
        renamed: true,
        updated_at: now.toISOString(),
        refactoredPages,
      };
    });
  } finally {
    dek?.fill(0);
  }
}

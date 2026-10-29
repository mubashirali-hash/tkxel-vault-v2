import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db.js';
import { versions, pages, vaults, chunks, auditEvents } from '../schema/index.js';
import { lockPageForMutation } from '../storage/page-lock.js';
import { VaultValidationError } from '../vault/create-vault.js';
import { saveDraft, publishVersion, getPageContent } from './index.js';

export interface PageVersionSummary {
  id: string;
  number: number;
  /** `unpublished` marks a snapshot that was published once and has since been withdrawn. */
  status: 'draft' | 'published' | 'unpublished';
  created_by: string;
  created_at: string;
  is_current: boolean;
}

/** Full version history of a page, newest first (FR-42). Metadata only; content is fetched per version. */
export async function listPageVersions(pageId: string): Promise<PageVersionSummary[]> {
  const pageRows = await db.select({ current_version_id: pages.current_version_id })
    .from(pages)
    .where(eq(pages.id, pageId))
    .limit(1);
  if (!pageRows[0]) return [];

  const rows = await db.select({
    id: versions.id,
    number: versions.number,
    status: versions.status,
    created_by: versions.created_by,
    created_at: versions.created_at,
  })
    .from(versions)
    .where(eq(versions.page_id, pageId))
    .orderBy(desc(versions.number));

  return rows.map((v) => ({
    id: v.id,
    number: v.number,
    status: v.status as PageVersionSummary['status'],
    created_by: v.created_by,
    created_at: v.created_at.toISOString(),
    is_current: v.id === pageRows[0].current_version_id,
  }));
}

/**
 * Rolls a page back to an earlier published snapshot (FR-42).
 * History is never rewritten: the old content is published again as a new version.
 */
export async function rollbackPageToVersion(params: {
  pageId: string;
  versionId: string;
  actorId: string;
}): Promise<{ versionId: string; restoredFromNumber: number }> {
  const target = await db.select({ id: versions.id, number: versions.number, status: versions.status })
    .from(versions)
    .where(and(eq(versions.id, params.versionId), eq(versions.page_id, params.pageId)))
    .limit(1);
  if (!target[0]) {
    throw new Error('not_found');
  }
  if (target[0].status === 'draft') {
    throw new VaultValidationError('Only published versions can be restored');
  }

  const restored = await getPageContent(params.pageId, params.versionId);
  if (!restored) {
    throw new Error('not_found');
  }

  // Re-uses the normal save + publish path so the search index, link graph and audit trail all follow
  await saveDraft(params.pageId, restored.content, params.actorId);
  const versionId = await publishVersion(params.pageId, params.actorId);

  await db.insert(auditEvents).values({
    actor_id: params.actorId,
    action: 'rollback_page',
    target_id: params.pageId,
    metadata: { restored_from_version: target[0].number, new_version_id: versionId },
  });

  return { versionId, restoredFromNumber: target[0].number };
}

/**
 * Withdraws a page from Readers and every retrieval tool, effective immediately (FR-44).
 * The page, its history and any working draft remain available to Owners and Editors.
 */
export async function unpublishPage(params: { pageId: string; actorId: string }): Promise<{ withdrawn: number }> {
  return await db.transaction(async (tx) => {
    const page = await lockPageForMutation(tx, params.pageId);

    const withdrawn = await tx.update(versions)
      .set({ status: 'unpublished' })
      .where(and(eq(versions.page_id, page.id), eq(versions.status, 'published')))
      .returning({ id: versions.id });

    await tx.update(pages)
      .set({ current_version_id: null, updated_at: new Date() })
      .where(and(eq(pages.id, page.id), eq(pages.vault_id, page.vault_id)));

    // The page leaves the search index in the same transaction
    await tx.delete(chunks).where(eq(chunks.page_id, page.id));

    const vaultRows = await tx.select({ id: vaults.id }).from(vaults).where(eq(vaults.id, page.vault_id)).limit(1);
    await tx.insert(auditEvents).values({
      actor_id: params.actorId,
      action: 'unpublish_page',
      target_id: page.id,
      metadata: { vault_id: vaultRows[0]?.id ?? page.vault_id, withdrawn_versions: withdrawn.length },
    });

    return { withdrawn: withdrawn.length };
  });
}

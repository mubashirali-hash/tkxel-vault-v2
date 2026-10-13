import { eq } from 'drizzle-orm';
import { pages } from '../schema/index.js';

export interface LockPageOptions {
  expectedVaultId?: string;
}

export type LockedPageRecord = typeof pages.$inferSelect;

/**
 * Shared page-mutation locking contract.
 *
 * Acquires a page-scoped row-level exclusive lock (FOR UPDATE) inside a transaction.
 * Invariants:
 * 1. Must be executed inside a database transaction before any authoritative
 *    page/vault/key reads or mutations.
 * 2. Fails closed if the database adapter cannot provide row-level locking (typeof query.for !== 'function').
 * 3. Asserts page exists; otherwise throws uniform 'not_found'.
 * 4. If expectedVaultId is provided, asserts page.vault_id matches; otherwise throws 'not_found'.
 */
export async function lockPageForMutation(
  tx: any,
  pageId: string,
  options?: LockPageOptions
): Promise<LockedPageRecord> {
  if (!pageId || typeof pageId !== 'string') {
    throw new Error('pageId is required');
  }

  let query: any = tx.select().from(pages).where(eq(pages.id, pageId));

  if (typeof query.for !== 'function') {
    throw new Error('Database adapter cannot provide required row-level locking (FOR UPDATE). Failing closed.');
  }

  query = query.for('update');
  const rows = await query;

  if (!rows || rows.length === 0) {
    throw new Error('not_found');
  }

  const page = rows[0] as LockedPageRecord;

  if (options?.expectedVaultId && page.vault_id !== options.expectedVaultId) {
    throw new Error('not_found');
  }

  return page;
}

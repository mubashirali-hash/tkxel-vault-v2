import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db.js';
import { pages, vaults, timelineEntries, auditEvents } from '../schema/index.js';
import { createKmsProvider, EnvelopeEncryption } from '../crypto/kms.js';
import { lockPageForMutation } from '../storage/page-lock.js';
import { VaultValidationError } from './create-vault.js';

/** Marks an entry_text value as AES-256-GCM ciphertext under the vault data key (base64 after the prefix). */
export const TIMELINE_CIPHERTEXT_PREFIX = 'enc:v1:';
const MAX_ENTRY_CHARS = 4000;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface TimelineEntryRecord {
  id: string;
  page_id: string;
  date: string;
  entry_text: string;
  created_by: string;
  created_at: string;
}

function decryptEntry(stored: string, dek: Buffer): string {
  if (!stored.startsWith(TIMELINE_CIPHERTEXT_PREFIX)) {
    // Row written before timeline encryption existed
    return stored;
  }
  return EnvelopeEncryption.decryptToString(
    Buffer.from(stored.slice(TIMELINE_CIPHERTEXT_PREFIX.length), 'base64'),
    dek
  );
}

/**
 * Appends a dated entry to a page's timeline (FR-06). Entries are append-only: there is no update path,
 * and saving the page body never touches them. The text is encrypted under the vault data key (NFR-01).
 */
export async function appendTimelineEntry(params: {
  vaultId: string;
  pageId: string;
  entry: string;
  date?: string;
  actorId: string;
}): Promise<TimelineEntryRecord> {
  const entry = (params.entry || '').trim();
  if (!entry) {
    throw new VaultValidationError('Timeline entry text is required');
  }
  if (entry.length > MAX_ENTRY_CHARS) {
    throw new VaultValidationError(`Timeline entry must be ${MAX_ENTRY_CHARS} characters or fewer`);
  }
  const date = params.date ?? new Date().toISOString().slice(0, 10);
  if (!DATE_REGEX.test(date) || isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new VaultValidationError('Timeline entry date must be YYYY-MM-DD');
  }

  let dek: Buffer | undefined;
  try {
    return await db.transaction(async (tx) => {
      const page = await lockPageForMutation(tx, params.pageId, { expectedVaultId: params.vaultId });

      const vaultRows = await tx.select({ mode: vaults.mode, data_key_id: vaults.data_key_id })
        .from(vaults)
        .where(eq(vaults.id, page.vault_id))
        .for('share')
        .limit(1);
      const vault = vaultRows[0];
      if (!vault || !vault.data_key_id) {
        throw new Error('not_found');
      }
      if (vault.mode !== 'open') {
        throw new VaultValidationError('Timeline entries can only be added in open vaults');
      }

      dek = await createKmsProvider().unwrapKey(vault.data_key_id);
      const stored = TIMELINE_CIPHERTEXT_PREFIX + EnvelopeEncryption.encrypt(entry, dek).toString('base64');

      const [row] = await tx.insert(timelineEntries)
        .values({ page_id: page.id, date, entry_text: stored, created_by: params.actorId })
        .returning();

      await tx.insert(auditEvents).values({
        actor_id: params.actorId,
        action: 'add_timeline_entry',
        target_id: page.id,
        metadata: { vault_id: page.vault_id, entry_id: row.id, date },
      });

      return {
        id: row.id,
        page_id: row.page_id,
        date: row.date,
        entry_text: entry,
        created_by: row.created_by,
        created_at: row.created_at.toISOString(),
      };
    });
  } finally {
    dek?.fill(0);
  }
}

/** Returns the decrypted timeline of every page in an open vault, oldest first. Caller enforces access. */
export async function listTimelineEntries(vaultId: string, pageId?: string): Promise<TimelineEntryRecord[]> {
  const vaultRows = await db.select({ mode: vaults.mode, data_key_id: vaults.data_key_id })
    .from(vaults)
    .where(eq(vaults.id, vaultId))
    .limit(1);
  const vault = vaultRows[0];
  if (!vault || vault.mode !== 'open') {
    return [];
  }

  const rows = await db.select({
    id: timelineEntries.id,
    page_id: timelineEntries.page_id,
    date: timelineEntries.date,
    entry_text: timelineEntries.entry_text,
    created_by: timelineEntries.created_by,
    created_at: timelineEntries.created_at,
  })
    .from(timelineEntries)
    .innerJoin(pages, eq(timelineEntries.page_id, pages.id))
    .where(pageId ? and(eq(pages.vault_id, vaultId), eq(timelineEntries.page_id, pageId)) : eq(pages.vault_id, vaultId))
    .orderBy(asc(timelineEntries.date), asc(timelineEntries.created_at));

  if (rows.length === 0) return [];

  const dek = await createKmsProvider().unwrapKey(vault.data_key_id);
  try {
    return rows.map((r) => ({
      id: r.id,
      page_id: r.page_id,
      date: r.date,
      entry_text: decryptEntry(r.entry_text, dek),
      created_by: r.created_by,
      created_at: r.created_at.toISOString(),
    }));
  } finally {
    dek.fill(0);
  }
}

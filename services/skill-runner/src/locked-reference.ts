import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { EnvelopeEncryption, type KmsProvider } from '@tkxel-vault/vault-core/crypto';
import { and, eq, isNotNull, inArray, asc } from 'drizzle-orm';

/** Upper bound on reference text handed to the model for one question. */
export const MAX_REFERENCE_CHARS = 60_000;
const MAX_REFERENCE_PAGES = 200;

export interface LockedReference {
  /** Decrypted reference knowledge, formatted for a system prompt. Empty when the vault has none. */
  text: string;
  pageCount: number;
  /** True when the vault holds more published reference content than fits in one question. */
  truncated: boolean;
}

/**
 * Loads the published reference pages of a locked vault for `ask_vault` (FR-64).
 *
 * The plaintext exists only in this process, for the duration of one request: it is decrypted with the
 * vault key, placed in the model's system prompt, and never written anywhere or returned to the caller.
 * Drafts are excluded, so only content an Owner has published can influence an answer (FR-43).
 */
export async function loadLockedReference(params: {
  vaultId: string;
  wrappedKey: string;
  kms: KmsProvider;
}): Promise<LockedReference> {
  const pages = await db
    .select({ id: schema.pages.id, title: schema.pages.title, current_version_id: schema.pages.current_version_id })
    .from(schema.pages)
    .where(and(eq(schema.pages.vault_id, params.vaultId), isNotNull(schema.pages.current_version_id)))
    .orderBy(asc(schema.pages.title))
    .limit(MAX_REFERENCE_PAGES + 1);

  if (pages.length === 0) {
    return { text: '', pageCount: 0, truncated: false };
  }

  const considered = pages.slice(0, MAX_REFERENCE_PAGES);
  const versions = await db
    .select({ id: schema.versions.id, status: schema.versions.status, encrypted_blob: schema.versions.encrypted_blob })
    .from(schema.versions)
    .where(inArray(schema.versions.id, considered.map((p) => p.current_version_id!)));
  const byId = new Map(versions.map((v) => [v.id, v]));

  const dek = await params.kms.unwrapKey(params.wrappedKey);
  const sections: string[] = [];
  let used = 0;
  let truncated = pages.length > MAX_REFERENCE_PAGES;
  let included = 0;

  try {
    for (const page of considered) {
      const version = byId.get(page.current_version_id!);
      if (!version || version.status !== 'published') continue;
      const body = EnvelopeEncryption.decryptToString(version.encrypted_blob, dek);
      const section = `### ${page.title}\n${body.trim()}`;
      if (used + section.length > MAX_REFERENCE_CHARS) {
        truncated = true;
        const room = MAX_REFERENCE_CHARS - used;
        if (room > 500) {
          sections.push(section.slice(0, room));
          included++;
        }
        break;
      }
      sections.push(section);
      used += section.length + 2;
      included++;
    }
  } finally {
    dek.fill(0);
  }

  return { text: sections.join('\n\n'), pageCount: included, truncated };
}

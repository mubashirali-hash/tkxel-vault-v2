import { eq, inArray, asc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db.js';
import { vaults, pages, versions, chunks, links, timelineEntries, skills, shares, assets, auditEvents } from '../schema/index.js';
import { createKmsProvider, EnvelopeEncryption } from '../crypto/kms.js';
import { TIMELINE_CIPHERTEXT_PREFIX } from './timeline.js';
import { VaultValidationError } from './create-vault.js';

/** Stored in place of a wrapped key once a vault has been crypto-shredded. Never a valid wrapped key. */
export const SHREDDED_KEY_PREFIX = 'shredded:';

export function isVaultShredded(dataKeyId: string | null | undefined): boolean {
  return typeof dataKeyId === 'string' && dataKeyId.startsWith(SHREDDED_KEY_PREFIX);
}

export interface RekeyResult {
  vaultId: string;
  versions: number;
  chunks: number;
  timelineEntries: number;
  skills: number;
  assets: number;
}

/**
 * Replaces a vault's data encryption key and re-encrypts everything stored under it (NFR-05).
 *
 * One transaction: either every ciphertext and the wrapped key move to the new key together, or
 * nothing changes. The vault and all of its pages are locked for the duration, so no write can land
 * under the old key. Both plaintext keys exist only in memory and are zeroed afterwards (NFR-04).
 */
export async function rekeyVault(params: { vaultId: string; actorId: string }): Promise<RekeyResult> {
  let oldDek: Buffer | undefined;
  let newDek: Buffer | undefined;

  try {
    return await db.transaction(async (tx) => {
      const vaultRows = await tx.select().from(vaults).where(eq(vaults.id, params.vaultId)).for('update');
      const vault = vaultRows[0];
      if (!vault) {
        throw new Error('not_found');
      }
      if (isVaultShredded(vault.data_key_id)) {
        throw new VaultValidationError('This vault has been crypto-shredded and has no key to rotate');
      }

      const kms = createKmsProvider();
      oldDek = await kms.unwrapKey(vault.data_key_id);
      newDek = EnvelopeEncryption.generateDek();
      const wrappedNewKey = await kms.wrapKey(newDek);
      const reencrypt = (blob: Buffer) => EnvelopeEncryption.encrypt(EnvelopeEncryption.decrypt(blob, oldDek!), newDek!);

      const vaultPages = await tx.select({ id: pages.id })
        .from(pages)
        .where(eq(pages.vault_id, vault.id))
        .orderBy(asc(pages.id))
        .for('update');
      const pageIds = vaultPages.map((p) => p.id);

      const counts: RekeyResult = { vaultId: vault.id, versions: 0, chunks: 0, timelineEntries: 0, skills: 0, assets: 0 };

      if (pageIds.length > 0) {
        const versionRows = await tx.select({ id: versions.id, encrypted_blob: versions.encrypted_blob })
          .from(versions)
          .where(inArray(versions.page_id, pageIds));
        for (const v of versionRows) {
          await tx.update(versions).set({ encrypted_blob: reencrypt(v.encrypted_blob) }).where(eq(versions.id, v.id));
          counts.versions++;
        }

        const chunkRows = await tx.select({ id: chunks.id, encrypted_text: chunks.encrypted_text })
          .from(chunks)
          .where(inArray(chunks.page_id, pageIds));
        for (const c of chunkRows) {
          await tx.update(chunks).set({ encrypted_text: reencrypt(c.encrypted_text) }).where(eq(chunks.id, c.id));
          counts.chunks++;
        }

        const timelineRows = await tx.select({ id: timelineEntries.id, entry_text: timelineEntries.entry_text })
          .from(timelineEntries)
          .where(inArray(timelineEntries.page_id, pageIds));
        if (timelineRows.length > 0) {
          // Timeline rows are append-only; re-keying is the one permitted rewrite and is scoped to this transaction
          await tx.execute(sql`SELECT set_config('app.timeline_rekey', 'on', true)`);
          for (const t of timelineRows) {
            if (!t.entry_text.startsWith(TIMELINE_CIPHERTEXT_PREFIX)) continue;
            const blob = Buffer.from(t.entry_text.slice(TIMELINE_CIPHERTEXT_PREFIX.length), 'base64');
            await tx.update(timelineEntries)
              .set({ entry_text: TIMELINE_CIPHERTEXT_PREFIX + reencrypt(blob).toString('base64') })
              .where(eq(timelineEntries.id, t.id));
            counts.timelineEntries++;
          }
          await tx.execute(sql`SELECT set_config('app.timeline_rekey', 'off', true)`);
        }
      }

      const skillRows = await tx.select().from(skills).where(eq(skills.vault_id, vault.id)).for('update');
      for (const skill of skillRows) {
        const doc = (skill.tool_schema as Record<string, any>) || {};
        if (typeof doc.encrypted_payload !== 'string') continue;
        const blob = Buffer.from(doc.encrypted_payload, 'base64');
        await tx.update(skills)
          .set({ tool_schema: { ...doc, encrypted_payload: reencrypt(blob).toString('base64') } })
          .where(eq(skills.id, skill.id));
        counts.skills++;
      }

      const assetRows = await tx.select({ id: assets.id, encrypted_blob: assets.encrypted_blob })
        .from(assets)
        .where(eq(assets.vault_id, vault.id))
        .for('update');
      for (const asset of assetRows) {
        await tx.update(assets).set({ encrypted_blob: reencrypt(asset.encrypted_blob) }).where(eq(assets.id, asset.id));
        counts.assets++;
      }

      await tx.update(vaults).set({ data_key_id: wrappedNewKey }).where(eq(vaults.id, vault.id));

      await tx.insert(auditEvents).values({
        actor_id: params.actorId,
        action: 'rekey_vault',
        target_id: vault.id,
        metadata: {
          vault_id: vault.id,
          versions: counts.versions,
          chunks: counts.chunks,
          timeline_entries: counts.timelineEntries,
          skills: counts.skills,
          assets: counts.assets,
        },
      });

      return counts;
    });
  } finally {
    oldDek?.fill(0);
    newDek?.fill(0);
  }
}

/**
 * Crypto-shreds a vault (NFR-05): the wrapped data key is destroyed, which makes every ciphertext ever
 * written under it permanently unreadable, including copies in backups. Stored content, search index,
 * skills and shares are removed as well. The vault row is kept as a tombstone so the audit trail keeps
 * its subject. This cannot be undone.
 */
export async function cryptoShredVault(params: {
  vaultId: string;
  actorId: string;
  /** Must equal the vault's current name: a deliberate, typed confirmation. */
  confirmName: string;
}): Promise<{ vaultId: string; pagesRemoved: number; skillsRemoved: number; sharesRevoked: number }> {
  return await db.transaction(async (tx) => {
    const vaultRows = await tx.select().from(vaults).where(eq(vaults.id, params.vaultId)).for('update');
    const vault = vaultRows[0];
    if (!vault) {
      throw new Error('not_found');
    }
    if (isVaultShredded(vault.data_key_id)) {
      throw new VaultValidationError('This vault has already been crypto-shredded');
    }
    if ((params.confirmName || '').trim() !== vault.name) {
      throw new VaultValidationError('Confirmation does not match the vault name');
    }

    const vaultPages = await tx.select({ id: pages.id }).from(pages).where(eq(pages.vault_id, vault.id)).for('update');
    const pageIds = vaultPages.map((p) => p.id);
    if (pageIds.length > 0) {
      await tx.delete(links).where(inArray(links.from_page_id, pageIds));
      await tx.delete(pages).where(inArray(pages.id, pageIds)); // cascades versions, chunks, timeline
    }
    const removedSkills = await tx.delete(skills).where(eq(skills.vault_id, vault.id)).returning({ id: skills.id });
    await tx.delete(assets).where(eq(assets.vault_id, vault.id));
    const revoked = await tx.update(shares)
      .set({ revoked_at: new Date() })
      .where(eq(shares.vault_id, vault.id))
      .returning({ id: shares.id });

    // Destroy the only copy of the wrapped key and seal the vault
    await tx.update(vaults)
      .set({
        data_key_id: `${SHREDDED_KEY_PREFIX}${new Date().toISOString()}`,
        mode: 'locked',
        export_policy: 'strictly_forbidden',
      })
      .where(eq(vaults.id, vault.id));

    await tx.insert(auditEvents).values({
      actor_id: params.actorId,
      action: 'crypto_shred_vault',
      target_id: vault.id,
      metadata: {
        vault_id: vault.id,
        pages_removed: pageIds.length,
        skills_removed: removedSkills.length,
        shares_revoked: revoked.length,
      },
    });

    return {
      vaultId: vault.id,
      pagesRemoved: pageIds.length,
      skillsRemoved: removedSkills.length,
      sharesRevoked: revoked.length,
    };
  });
}

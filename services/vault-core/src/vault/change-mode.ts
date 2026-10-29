import { eq, and, isNull, inArray, desc, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { vaults, pages, versions, chunks, links, shares, skills, auditEvents } from '../schema/index.js';
import { createKmsProvider, EnvelopeEncryption } from '../crypto/kms.js';
import { MarkdownChunker } from '../search/chunker.js';
import { LinkGraphIndexer } from '../markdown/indexer.js';
import { VaultValidationError } from './create-vault.js';

export interface ChangeVaultModeResult {
  vaultId: string;
  mode: 'open' | 'locked';
  export_policy: string;
  changed: boolean;
  /** Shares revoked because their role does not exist in the new mode. */
  revokedShares: number;
  /** Skills returned to draft because they have no declared input contract (locked vaults require one). */
  unpublishedSkills: number;
}

/**
 * Switches a vault between Open and Locked (FR-51), atomically.
 *
 * Open -> Locked: the vault becomes zero-read. Search chunks and link metadata are purged, export is
 * forbidden, Reader shares are revoked (locked vaults have no Reader role, FR-53) and skills without a
 * declared input contract are returned to draft (FR-32).
 *
 * Locked -> Open: Consumer shares are revoked (open vaults have no Consumer role), Owner export is
 * re-enabled and the lexical search index and link graph are rebuilt from stored content.
 *
 * Tool palettes follow automatically because they are resolved from the vault mode on every request.
 */
export async function changeVaultMode(params: {
  vaultId: string;
  mode: 'open' | 'locked';
  actorId: string;
}): Promise<ChangeVaultModeResult> {
  if (params.mode !== 'open' && params.mode !== 'locked') {
    throw new VaultValidationError("Vault mode must be 'open' or 'locked'");
  }

  let dek: Buffer | undefined;
  try {
    return await db.transaction(async (tx) => {
      const vaultRows = await tx.select().from(vaults).where(eq(vaults.id, params.vaultId)).for('update');
      const vault = vaultRows[0];
      if (!vault) {
        throw new Error('not_found');
      }
      if (vault.mode === params.mode) {
        return {
          vaultId: vault.id,
          mode: params.mode,
          export_policy: vault.export_policy,
          changed: false,
          revokedShares: 0,
          unpublishedSkills: 0,
        };
      }

      // Lock every page so no save, move or rename interleaves with the transition
      const vaultPages = await tx.select().from(pages).where(eq(pages.vault_id, vault.id)).orderBy(pages.id).for('update');
      const pageIds = vaultPages.map((p) => p.id);
      const now = new Date();
      let unpublishedSkills = 0;

      if (params.mode === 'locked') {
        if (pageIds.length > 0) {
          await tx.delete(links).where(inArray(links.from_page_id, pageIds));
          await tx.delete(chunks).where(inArray(chunks.page_id, pageIds));
        }

        const vaultSkills = await tx.select().from(skills).where(eq(skills.vault_id, vault.id)).for('update');
        for (const skill of vaultSkills) {
          const doc = (skill.tool_schema as Record<string, any>) || {};
          if (doc.contract_declared !== true && doc.status !== 'draft') {
            await tx.update(skills)
              .set({ tool_schema: { ...doc, status: 'draft' }, updated_at: now })
              .where(eq(skills.id, skill.id));
            unpublishedSkills++;
          }
        }
      }

      const obsoleteRole = params.mode === 'locked' ? 'reader' : 'consumer';
      const revoked = await tx.update(shares)
        .set({ revoked_at: now })
        .where(and(eq(shares.vault_id, vault.id), eq(shares.role, obsoleteRole), isNull(shares.revoked_at)))
        .returning({ id: shares.id });

      const exportPolicy = params.mode === 'locked' ? 'strictly_forbidden' : 'allowed_for_owner';
      await tx.update(vaults).set({ mode: params.mode, export_policy: exportPolicy }).where(eq(vaults.id, vault.id));

      if (params.mode === 'open' && pageIds.length > 0) {
        // Rebuild what an open vault needs. Lexical index only; vectors are restored by a reindex.
        const allVersions = await tx.select().from(versions)
          .where(inArray(versions.page_id, pageIds))
          .orderBy(desc(versions.number));
        dek = await createKmsProvider().unwrapKey(vault.data_key_id);
        const chunker = new MarkdownChunker({ maxTokensPerChunk: 400, overlapTokens: 50 });

        for (const page of vaultPages) {
          const source = allVersions.find((v) => v.page_id === page.id && v.id === page.current_version_id)
            ?? allVersions.find((v) => v.page_id === page.id);
          if (!source) continue;
          const content = EnvelopeEncryption.decryptToString(source.encrypted_blob, dek);

          for (const c of chunker.chunk(content)) {
            await tx.insert(chunks).values({
              page_id: page.id,
              version_id: source.id,
              position: c.chunkIndex,
              encrypted_text: EnvelopeEncryption.encrypt(c.content, dek),
              tsv_content: sql`to_tsvector('english', ${c.content})`,
              embedding: null,
            });
          }
          await LinkGraphIndexer.updateLinksForPage(vault.id, page.id, content, tx);
        }
      }

      await tx.insert(auditEvents).values({
        actor_id: params.actorId,
        action: 'mode_change',
        target_id: vault.id,
        metadata: {
          vault_id: vault.id,
          from: vault.mode,
          to: params.mode,
          revoked_shares: revoked.length,
          unpublished_skills: unpublishedSkills,
        },
      });

      return {
        vaultId: vault.id,
        mode: params.mode,
        export_policy: exportPolicy,
        changed: true,
        revokedShares: revoked.length,
        unpublishedSkills,
      };
    });
  } finally {
    dek?.fill(0);
  }
}

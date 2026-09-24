import crypto from 'node:crypto';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db as defaultDb } from '../db.js';
import { pages, versions, chunks, vaults, auditEvents } from '../schema/index.js';
import { createKmsProvider, EnvelopeEncryption, KmsProvider } from '../crypto/kms.js';
import { getUserRoleForVault } from '../auth/index.js';
import { MarkdownChunker } from '../search/chunker.js';
import { getEmbeddingProvider, EmbeddingProvider, validateEmbeddingBatch, EmbeddingConfigurationError } from '../search/embedding-provider.js';
import { lockPageForMutation } from '../storage/page-lock.js';
import { LinkGraphIndexer } from '../markdown/indexer.js';

export interface MovePageOptions {
  pageId: string;
  destinationVaultId: string;
  actorId: string;
  kms?: KmsProvider;
  provider?: EmbeddingProvider;
  db?: any;
}

export interface MovePageResult {
  success: boolean;
  pageId: string;
  vaultId: string;
  unchanged?: boolean;
}

/**
 * Moves a page and all its versions atomically from a source vault to a destination vault.
 *
 * Security & Integrity Invariants (Epic 6 Chunk 6.2):
 * 1. Authorization: Requires owner or editor role on BOTH source and destination vaults.
 *    Non-members/readers on source receive uniform 'not_found' (anti-disclosure).
 * 2. Cryptographic Zero-Trust: Decrypts all versions and chunks under source DEK,
 *    re-encrypts under destination DEK. Wipes raw DEKs in memory in finally block.
 * 3. Index Lifecycle & Mode Segregation (ADR-017):
 *    - Destination is locked: purges all chunks, tsvectors, and embeddings (zero-read).
 *    - Destination is open: re-encrypts existing chunks (open->open), or generates and
 *      validates fresh chunks and embeddings from latest version (locked->open).
 * 4. Atomic Rollback: Entire mutation executed within a single db.transaction.
 *    Any decryption, re-encryption, indexing, or database error aborts and rolls back completely.
 * 5. Audit: Emits immutable append-only 'move_page' audit event.
 */
export async function movePage(options: MovePageOptions): Promise<MovePageResult> {
  const { pageId, destinationVaultId, actorId } = options;
  const activeDb = options.db || defaultDb;

  if (!pageId || typeof pageId !== 'string') {
    throw new Error('pageId is required');
  }
  if (!destinationVaultId || typeof destinationVaultId !== 'string') {
    throw new Error('destinationVaultId is required');
  }
  if (!actorId || typeof actorId !== 'string') {
    throw new Error('actorId is required');
  }

  const kms = options.kms || createKmsProvider();
  let sourceDek: Buffer | undefined;
  let destDek: Buffer | undefined;

  try {
    return await activeDb.transaction(async (tx: any) => {
      // 1. Set RLS actor context inside transaction
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${actorId}, true)`);

      // 2. Fetch and lock the page row FOR UPDATE via shared locking contract
      const pageRec = await lockPageForMutation(tx, pageId);
      const sourceVaultId = pageRec.vault_id;

      // 3. Resolve source role via tx connection with share row locking
      const sourceRole = await getUserRoleForVault(actorId, sourceVaultId, tx, true);
      if (sourceRole !== 'owner' && sourceRole !== 'editor') {
        throw new Error('not_found'); // Anti-disclosure: do not leak existence of page
      }

      // 4. Verify destination vault existence and resolve destination role via tx connection with row locking
      let destVaultQuery = tx.select().from(vaults).where(eq(vaults.id, destinationVaultId));
      if (typeof destVaultQuery.for !== 'function') {
        throw new Error('Database adapter cannot provide required row-level locking (FOR SHARE). Failing closed.');
      }
      destVaultQuery = destVaultQuery.for('share');
      const destVaultRec = await destVaultQuery;
      if (!destVaultRec[0]) {
        throw new Error('not_found'); // Destination vault does not exist
      }

      const destRole = await getUserRoleForVault(actorId, destinationVaultId, tx, true);
      if (destRole !== 'owner' && destRole !== 'editor') {
        throw new Error('not_allowed'); // Access denied on destination vault
      }

      // 5. Self-move: if page already in destination vault and authorization verified, no-op return
      if (sourceVaultId === destinationVaultId) {
        return { success: true, pageId, vaultId: destinationVaultId, unchanged: true };
      }

      // 6. Reconfirm page still belongs to expected source vault
      if (pageRec.vault_id !== sourceVaultId) {
        throw new Error('Concurrent modification detected: page vault mismatch');
      }

      // 7. Fetch source vault record via tx with row locking
      let sourceVaultQuery = tx.select().from(vaults).where(eq(vaults.id, sourceVaultId));
      if (typeof sourceVaultQuery.for !== 'function') {
        throw new Error('Database adapter cannot provide required row-level locking (FOR SHARE). Failing closed.');
      }
      sourceVaultQuery = sourceVaultQuery.for('share');
      const sourceVaultRec = await sourceVaultQuery;
      if (!sourceVaultRec[0]) {
        throw new Error('not_found');
      }

      // 8. Collision preflight: check title and aliases against destination vault
      // Executed after source/destination authorization and row locks, but BEFORE DEK unwrapping or any mutations.
      await LinkGraphIndexer.validateDestinationCollision({
        tx,
        destinationVaultId,
        pageId,
        pageTitle: pageRec.title,
        pageAliases: pageRec.aliases || [],
      });

      // 9. Unwrap KMS DEKs inside transaction context
      sourceDek = await kms.unwrapKey(sourceVaultRec[0].data_key_id);
      destDek = await kms.unwrapKey(destVaultRec[0].data_key_id);

      // 9. Re-encrypt all versions under destination DEK
      const pageVersions = await tx
        .select()
        .from(versions)
        .where(eq(versions.page_id, pageId))
        .orderBy(desc(versions.number));

      let latestPlaintext: string | null = null;
      let latestVersionId: string | null = null;

      for (let i = 0; i < pageVersions.length; i++) {
        const v = pageVersions[i];
        if (!v.encrypted_blob) {
          throw new Error(`Corrupted version ${v.id}: missing encrypted_blob`);
        }
        const plaintext = EnvelopeEncryption.decryptToString(v.encrypted_blob, sourceDek!);
        if (i === 0) {
          latestPlaintext = plaintext;
          latestVersionId = v.id;
        }
        const newCiphertext = EnvelopeEncryption.encrypt(plaintext, destDek!);
        await tx
          .update(versions)
          .set({ encrypted_blob: newCiphertext })
          .where(eq(versions.id, v.id));
      }

      // 10. Chunk and search index management based on destination vault mode (ADR-017)
      if (destVaultRec[0].mode === 'locked') {
        // Locked destination: zero-read protection. Purge all chunks, tsvectors, and embeddings.
        await tx.delete(chunks).where(eq(chunks.page_id, pageId));
      } else {
        // Open destination:
        const existingChunks = await tx.select().from(chunks).where(eq(chunks.page_id, pageId));

        if (existingChunks.length > 0) {
          // Open -> Open: re-encrypt existing chunk ciphertext under destination DEK
          for (const c of existingChunks) {
            if (!c.encrypted_text) {
              throw new Error(`Corrupted chunk ${c.id}: missing encrypted_text`);
            }
            const plaintextChunk = EnvelopeEncryption.decryptToString(c.encrypted_text, sourceDek!);
            const newChunkCipher = EnvelopeEncryption.encrypt(plaintextChunk, destDek!);
            await tx
              .update(chunks)
              .set({ encrypted_text: newChunkCipher })
              .where(eq(chunks.id, c.id));
          }
        } else if (latestPlaintext && latestVersionId) {
          // Locked -> Open: source had 0 chunks. Build fresh search index for open destination.
          const chunker = new MarkdownChunker({ maxTokensPerChunk: 400, overlapTokens: 50 });
          const docChunks = chunker.chunk(latestPlaintext);

          if (docChunks.length > 0) {
            let embeddings: number[][] | null = null;
            let skipEmbeddings = false;

            if (!options.provider) {
              try {
                const provider = getEmbeddingProvider();
                embeddings = await provider.generateEmbeddings(docChunks.map((c) => c.content));
                validateEmbeddingBatch(embeddings, docChunks.length);
              } catch (err) {
                if (err instanceof EmbeddingConfigurationError) {
                  console.warn('Embedding provider not configured during movePage, degrading to lexical tsvector only:', (err as any).message);
                  skipEmbeddings = true;
                } else {
                  throw err;
                }
              }
            } else {
              embeddings = await options.provider.generateEmbeddings(docChunks.map((c) => c.content));
              validateEmbeddingBatch(embeddings, docChunks.length);
            }

            for (let idx = 0; idx < docChunks.length; idx++) {
              const chunkContent = docChunks[idx].content;
              const encChunk = EnvelopeEncryption.encrypt(chunkContent, destDek!);
              await tx.insert(chunks).values({
                id: crypto.randomUUID(),
                page_id: pageId,
                version_id: latestVersionId,
                position: idx,
                encrypted_text: encChunk,
                tsv_content: sql`to_tsvector('english', ${chunkContent})`,
                embedding: skipEmbeddings || !embeddings ? null : embeddings[idx],
              });
            }
          }
        }
      }

      // 11. Update page with predicate containing both page ID and expected source vault ID
      const updated = await tx
        .update(pages)
        .set({ vault_id: destinationVaultId, updated_at: new Date() })
        .where(and(eq(pages.id, pageId), eq(pages.vault_id, sourceVaultId)))
        .returning({ id: pages.id });

      // Require exactly one updated row; otherwise abort and roll back
      if (!updated || updated.length !== 1) {
        throw new Error('Concurrent modification detected during page move');
      }

      // 12. Atomically reconcile derived graph links (Epic 6 Chunk 6.3)
      await LinkGraphIndexer.reconcileLinksOnPageMove({
        tx,
        pageId,
        sourceVaultId,
        destinationVaultId,
        destinationMode: destVaultRec[0].mode as 'open' | 'locked',
        pageTitle: pageRec.title,
        pageAliases: pageRec.aliases || [],
        latestPlaintext,
      });

      // 13. Emit immutable append-only audit event
      await tx.insert(auditEvents).values({
        actor_id: actorId,
        action: 'move_page',
        target_id: pageId,
        timestamp: new Date(),
        metadata: {
          source_vault_id: sourceVaultId,
          destination_vault_id: destinationVaultId,
          title: pageRec.title,
        },
      });

      return { success: true, pageId, vaultId: destinationVaultId };
    });
  } finally {
    sourceDek?.fill(0);
    destDek?.fill(0);
  }
}

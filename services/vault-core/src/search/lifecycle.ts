import { eq, and, or, desc, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { pages, vaults, chunks, versions, links } from '../schema/index.js';
import { createKmsProvider, EnvelopeEncryption } from '../crypto/kms.js';
import { MarkdownChunker } from './chunker.js';
import { getEmbeddingProvider, EmbeddingProvider, validateEmbeddingBatch } from './embedding-provider.js';
import { lockPageForMutation } from '../storage/page-lock.js';

export interface ReindexResult {
  pageId: string;
  chunkCount: number;
  status: 'indexed' | 'skipped_locked' | 'no_content';
}

/**
 * Deletes a page and all its associated chunks, versions, and links.
 * Enforces atomic cascade cleanup to guarantee zero orphaned or stale embeddings.
 */
export async function deletePage(vaultId: string, pageId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Vault check: unknown vault returns not_found immediately
    let vaultQuery: any = tx.select({ id: vaults.id, mode: vaults.mode }).from(vaults).where(eq(vaults.id, vaultId));
    if (typeof vaultQuery.for !== 'function') {
      throw new Error('Database adapter cannot provide required row-level locking (FOR SHARE). Failing closed.');
    }
    vaultQuery = vaultQuery.for('share');
    const vaultRec = await vaultQuery;
    if (!vaultRec[0]) {
      throw new Error('not_found');
    }

    // 2. Lock page FOR UPDATE with expectedVaultId
    await lockPageForMutation(tx, pageId, { expectedVaultId: vaultId });

    // 3. Atomically purge all associated chunks, links, versions, and the page itself
    await tx.delete(chunks).where(eq(chunks.page_id, pageId));
    await tx.delete(links).where(or(eq(links.from_page_id, pageId), eq(links.to_page_id, pageId)));
    await tx.delete(versions).where(eq(versions.page_id, pageId));
    const deleted = await tx.delete(pages).where(and(eq(pages.id, pageId), eq(pages.vault_id, vaultId))).returning({ id: pages.id });
    if (!deleted || deleted.length !== 1) {
      throw new Error('Concurrent modification detected during page deletion');
    }
  });
}

/**
 * Reindexes a single page's markdown content for Hybrid RAG.
 * Invariants:
 * - Locked vaults and unknown vaults trigger ZERO provider construction or calls.
 * - For locked vaults, purges any residual chunks.
 * - Embeddings are computed and validated BEFORE database mutation to prevent partial semantic state.
 * - Previous chunks are purged in an atomic transaction to prevent stale vectors.
 * - Operation is idempotent.
 */
export async function reindexPage(
  vaultId: string,
  pageId: string,
  options?: { provider?: EmbeddingProvider; db?: any }
): Promise<ReindexResult> {
  let dek: Buffer | undefined;
  const activeDb = options?.db || db;

  try {
    return await activeDb.transaction(async (tx: any) => {
      // 1. Vault existence check with row lock
      let vaultQuery: any = tx.select().from(vaults).where(eq(vaults.id, vaultId));
      if (typeof vaultQuery.for !== 'function') {
        throw new Error('Database adapter cannot provide required row-level locking (FOR SHARE). Failing closed.');
      }
      vaultQuery = vaultQuery.for('share');
      const vaultRec = await vaultQuery;
      if (!vaultRec[0]) {
        throw new Error('not_found');
      }
      const vault = vaultRec[0];

      // 2. Lock page FOR UPDATE asserting expectedVaultId
      await lockPageForMutation(tx, pageId, { expectedVaultId: vaultId });

      // 3. Locked vault: Zero-Read Invariant (ADR-017)
      // Page is verified to belong to this locked vault. Purge any residual chunks with ZERO provider calls.
      if (vault.mode === 'locked') {
        await tx.delete(chunks).where(eq(chunks.page_id, pageId));
        return {
          pageId,
          chunkCount: 0,
          status: 'skipped_locked',
        };
      }

      // 4. Retrieve latest published or draft version for open vault
      const versionRows = await tx.select()
        .from(versions)
        .where(eq(versions.page_id, pageId))
        .orderBy(desc(versions.number))
        .limit(1);

      if (!versionRows[0] || !versionRows[0].encrypted_blob) {
        await tx.delete(chunks).where(eq(chunks.page_id, pageId));
        return {
          pageId,
          chunkCount: 0,
          status: 'no_content',
        };
      }

      const targetVersion = versionRows[0];
      const kms = createKmsProvider();
      dek = await kms.unwrapKey(vault.data_key_id);

      const plaintext = EnvelopeEncryption.decryptToString(targetVersion.encrypted_blob, dek);
      const chunker = new MarkdownChunker({ maxTokensPerChunk: 400, overlapTokens: 50 });
      const docChunks = chunker.chunk(plaintext);

      if (docChunks.length === 0) {
        await tx.delete(chunks).where(eq(chunks.page_id, pageId));
        return {
          pageId,
          chunkCount: 0,
          status: 'no_content',
        };
      }

      // 5. Generate and validate all embeddings inside lock boundary
      const provider = options?.provider ?? getEmbeddingProvider();
      const texts = docChunks.map((c) => c.content);
      const embeddings = await provider.generateEmbeddings(texts);
      validateEmbeddingBatch(embeddings, docChunks.length);

      // 6. Atomically replace chunks with new embeddings and encrypted text
      await tx.delete(chunks).where(eq(chunks.page_id, pageId));

      for (let i = 0; i < docChunks.length; i++) {
        const c = docChunks[i];
        const emb = embeddings[i];
        const encChunk = EnvelopeEncryption.encrypt(c.content, dek!);

        await tx.insert(chunks).values({
          page_id: pageId,
          version_id: targetVersion.id,
          position: c.chunkIndex,
          encrypted_text: encChunk,
          tsv_content: sql`to_tsvector('english', ${c.content})`,
          embedding: emb,
        });
      }

      return {
        pageId,
        chunkCount: docChunks.length,
        status: 'indexed',
      };
    });
  } finally {
    dek?.fill(0);
  }
}

/**
 * Reindexes all pages in an open or locked vault.
 * Strictly verifies vault mode: locked vaults trigger ZERO provider calls.
 * Every page is reindexed under lockPageForMutation; stale enumerated pages are safely skipped.
 */
export async function reindexVault(
  vaultId: string,
  options?: { provider?: EmbeddingProvider; db?: any }
): Promise<ReindexResult[]> {
  const activeDb = options?.db || db;
  const vaultRec = await activeDb.select().from(vaults).where(eq(vaults.id, vaultId)).limit(1);
  if (!vaultRec[0]) {
    throw new Error('not_found');
  }

  const pageRows = await activeDb.select({ id: pages.id }).from(pages).where(eq(pages.vault_id, vaultId));
  const results: ReindexResult[] = [];

  for (const p of pageRows) {
    try {
      const res = await reindexPage(vaultId, p.id, options);
      results.push(res);
    } catch (err: any) {
      if (err?.message === 'not_found') {
        // Page was concurrently moved or deleted; safely skip stale enumerated row
        continue;
      }
      throw err;
    }
  }

  return results;
}

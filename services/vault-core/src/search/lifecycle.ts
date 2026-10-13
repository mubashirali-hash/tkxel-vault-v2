import { eq, and, or, desc, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { pages, vaults, chunks, versions, links } from '../schema/index.js';
import { createKmsProvider, EnvelopeEncryption } from '../crypto/kms.js';
import { MarkdownChunker } from './chunker.js';
import { getEmbeddingProvider, EmbeddingProvider, validateEmbeddingBatch, isSemanticSearchOff } from './embedding-provider.js';
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

      // 4. Versions to index: the newest one (what Owners and Editors search) and, when it is a
      // different one, the published version (what Readers and the retrieval tools search)
      const page = await lockPageForMutation(tx, pageId, { expectedVaultId: vaultId });
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

      const targetVersions = [versionRows[0]];
      if (page.current_version_id && page.current_version_id !== versionRows[0].id) {
        const publishedRows = await tx.select().from(versions).where(eq(versions.id, page.current_version_id)).limit(1);
        if (publishedRows[0]?.encrypted_blob) targetVersions.push(publishedRows[0]);
      }

      const kms = createKmsProvider();
      dek = await kms.unwrapKey(vault.data_key_id);
      const chunker = new MarkdownChunker({ maxTokensPerChunk: 400, overlapTokens: 50 });

      // 5. Chunk and embed everything before any row changes, inside the lock boundary
      // With semantic search explicitly switched off, the keyword index is rebuilt without vectors
      const keywordOnly = !options?.provider && isSemanticSearchOff();
      const provider = keywordOnly ? null : (options?.provider ?? getEmbeddingProvider());
      const prepared: Array<{ versionId: string; docChunks: ReturnType<MarkdownChunker['chunk']>; embeddings: number[][] }> = [];
      for (const version of targetVersions) {
        const plaintext = EnvelopeEncryption.decryptToString(version.encrypted_blob, dek);
        const versionChunks = chunker.chunk(plaintext);
        if (versionChunks.length === 0) continue;
        let embeddings: number[][] = [];
        if (provider) {
          embeddings = await provider.generateEmbeddings(versionChunks.map((c) => c.content));
          validateEmbeddingBatch(embeddings, versionChunks.length);
        }
        prepared.push({ versionId: version.id, docChunks: versionChunks, embeddings });
      }

      // 6. Atomically replace the page's index entries
      await tx.delete(chunks).where(eq(chunks.page_id, pageId));

      const docChunks = prepared.find((entry) => entry.versionId === versionRows[0].id)?.docChunks ?? [];
      if (docChunks.length === 0 && prepared.length === 0) {
        return {
          pageId,
          chunkCount: 0,
          status: 'no_content',
        };
      }

      for (const entry of prepared) {
        for (let i = 0; i < entry.docChunks.length; i++) {
          const c = entry.docChunks[i];
          await tx.insert(chunks).values({
            page_id: pageId,
            version_id: entry.versionId,
            position: c.chunkIndex,
            encrypted_text: EnvelopeEncryption.encrypt(c.content, dek!),
            tsv_content: sql`to_tsvector('english', ${c.content})`,
            embedding: entry.embeddings[i] ?? null,
          });
        }
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

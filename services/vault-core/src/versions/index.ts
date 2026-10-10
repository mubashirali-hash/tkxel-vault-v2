import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { versions, pages, vaults, chunks, auditEvents } from '../schema/index.js';
import { createKmsProvider, EnvelopeEncryption } from '../crypto/kms.js';
import { MarkdownChunker } from '../search/chunker.js';
import { getEmbeddingProvider, EmbeddingProvider, validateEmbeddingBatch, EmbeddingConfigurationError } from '../search/embedding-provider.js';
import { lockPageForMutation } from '../storage/page-lock.js';
import { LinkGraphIndexer } from '../markdown/indexer.js';

export async function saveDraft(
  pageId: string,
  content: string,
  authorId: string,
  expectedUpdatedAt?: string,
  provider?: EmbeddingProvider
) {
  let dek: Buffer | undefined;
  let draftId: string;
  const newUpdatedAt = new Date();

  try {
    return await db.transaction(async (tx) => {
      // 1. Acquire row-level exclusive lock on page
      const lockedPage = await lockPageForMutation(tx, pageId);

      // 2. Recheck expectedUpdatedAt AFTER acquiring the lock
      if (expectedUpdatedAt) {
        const currentMs = lockedPage.updated_at ? new Date(lockedPage.updated_at).getTime() : 0;
        const expectedMs = new Date(expectedUpdatedAt).getTime();
        if (currentMs && !isNaN(expectedMs) && currentMs !== expectedMs) {
          const conflictError = new Error('Conflict: Page was modified by another user.');
          (conflictError as any).code = 'CONCURRENT_MODIFICATION';
          throw conflictError;
        }
      }

      // 3. Select vault FOR SHARE to prevent mode drift
      const vaultRec = await tx.select({
        id: vaults.id,
        mode: vaults.mode,
        data_key_id: vaults.data_key_id
      })
      .from(vaults)
      .where(eq(vaults.id, lockedPage.vault_id))
      .for('share')
      .limit(1);

      if (!vaultRec || vaultRec.length === 0) {
        throw new Error('Vault not found for page');
      }
      const vault = vaultRec[0];

      // 4. Resolve DEK after locking
      const kms = createKmsProvider();
      dek = await kms.unwrapKey(vault.data_key_id);

      // 5. Encrypt draft under resolved DEK
      const encryptedBlob = EnvelopeEncryption.encrypt(content, dek);

      // 6. If open vault, chunk, embed, and validate
      let preparedChunks: Array<{
        content: string;
        chunkIndex: number;
        encText: Buffer;
        embedding: number[] | null;
      }> = [];

      if (vault.mode === 'open') {
        const chunker = new MarkdownChunker({ maxTokensPerChunk: 400, overlapTokens: 50 });
        const docChunks = chunker.chunk(content);
        if (docChunks.length > 0) {
          let embeddings: number[][] | null = null;
          let skipEmbeddings = false;

          if (!provider) {
            try {
              const embeddingProvider = getEmbeddingProvider();
              embeddings = await embeddingProvider.generateEmbeddings(docChunks.map((c) => c.content));
              validateEmbeddingBatch(embeddings, docChunks.length);
            } catch (err) {
              if (err instanceof EmbeddingConfigurationError) {
                console.warn('Embedding provider not configured during saveDraft, degrading to lexical tsvector only:', (err as any).message);
                skipEmbeddings = true;
              } else {
                throw err;
              }
            }
          } else {
            embeddings = await provider.generateEmbeddings(docChunks.map((c) => c.content));
            validateEmbeddingBatch(embeddings, docChunks.length);
          }

          preparedChunks = docChunks.map((c, i) => ({
            content: c.content,
            chunkIndex: c.chunkIndex,
            encText: EnvelopeEncryption.encrypt(c.content, dek!),
            embedding: skipEmbeddings || !embeddings ? null : embeddings[i],
          }));
        }
      }

      // 7. Update page with compound predicate: pageId and lockedPage.vault_id
      const updated = await tx.update(pages)
        .set({ updated_at: newUpdatedAt })
        .where(and(eq(pages.id, pageId), eq(pages.vault_id, lockedPage.vault_id)))
        .returning({ id: pages.id });

      if (!updated || updated.length !== 1) {
        throw new Error('Concurrent modification detected: page vault mismatch during saveDraft');
      }

      // 8. Find existing draft or calculate next number
      const existingDrafts = await tx.select()
        .from(versions)
        .where(and(eq(versions.page_id, pageId), eq(versions.status, 'draft')))
        .orderBy(desc(versions.number))
        .limit(1);

      const latestDraft = existingDrafts[0];

      if (latestDraft) {
        // Overwrite existing draft
        await tx.update(versions)
          .set({ encrypted_blob: encryptedBlob, created_by: authorId, created_at: newUpdatedAt })
          .where(eq(versions.id, latestDraft.id));
        draftId = latestDraft.id;
      } else {
        const allVersions = await tx.select()
          .from(versions)
          .where(eq(versions.page_id, pageId))
          .orderBy(desc(versions.number))
          .limit(1);

        const nextNumber = allVersions.length > 0 ? allVersions[0].number + 1 : 1;

        const inserted = await tx.insert(versions).values({
          page_id: pageId,
          number: nextNumber,
          status: 'draft',
          encrypted_blob: encryptedBlob,
          created_by: authorId,
          created_at: newUpdatedAt,
        }).returning({ id: versions.id });
        draftId = inserted[0].id;
      }

      // 9. Replace the draft's index entries. The published version's entries stay: Readers and the
      // retrieval tools keep finding the page by its published text until the draft is published (FR-43).
      await tx.delete(chunks).where(and(
        eq(chunks.page_id, pageId),
        sql`${chunks.version_id} IS DISTINCT FROM ${lockedPage.current_version_id}`
      ));

      // 10. Insert new chunks only for open vaults
      if (vault.mode === 'open' && preparedChunks.length > 0) {
        for (const pc of preparedChunks) {
          await tx.insert(chunks).values({
            page_id: pageId,
            version_id: draftId,
            position: pc.chunkIndex,
            encrypted_text: pc.encText,
            tsv_content: sql`to_tsvector('english', ${pc.content})`,
            embedding: pc.embedding,
          });
        }
      }

      // 11. Keep the link graph in step with the saved content (FR-10): outgoing links are replaced
      // atomically, and ghost links elsewhere in the vault that name this page are resolved.
      await LinkGraphIndexer.updateLinksForPage(lockedPage.vault_id, pageId, content, tx);
      await LinkGraphIndexer.resolveIncomingGhostLinks(pageId, tx);

      // 12. Append-only audit record, in the same transaction as the write it describes (FR-81)
      await tx.insert(auditEvents).values({
        actor_id: authorId,
        action: 'edit_page',
        target_id: pageId,
        metadata: { vault_id: lockedPage.vault_id, version_id: draftId!, status: 'draft', content_bytes: Buffer.byteLength(content, 'utf-8') },
      });

      return { draftId: draftId!, updated_at: newUpdatedAt.toISOString() };
    });
  } finally {
    dek?.fill(0);
  }
}

export async function publishVersion(pageId: string, authorId: string, provider?: EmbeddingProvider) {
  let dek: Buffer | undefined;

  try {
    return await db.transaction(async (tx) => {
      // 1. Acquire row-level exclusive lock on page
      const lockedPage = await lockPageForMutation(tx, pageId);

      // 2. Find latest draft
      const existingDrafts = await tx.select()
        .from(versions)
        .where(and(eq(versions.page_id, pageId), eq(versions.status, 'draft')))
        .orderBy(desc(versions.number))
        .limit(1);

      if (existingDrafts.length === 0) {
        throw new Error('No draft to publish');
      }

      const draft = existingDrafts[0];
      const draftId = draft.id;

      // 3. Resolve vault identity and lock vault FOR SHARE
      let vaultQuery: any = tx.select().from(vaults).where(eq(vaults.id, lockedPage.vault_id));
      if (typeof vaultQuery.for !== 'function') {
        throw new Error('Database adapter cannot provide required row-level locking (FOR SHARE). Failing closed.');
      }
      vaultQuery = vaultQuery.for('share');
      const vaultRec = await vaultQuery;
      if (!vaultRec[0] || !vaultRec[0].data_key_id) {
        throw new Error('Vault not found or DEK missing');
      }
      const vault = vaultRec[0];

      // 4. Resolve DEK after locking
      const kms = createKmsProvider();
      dek = await kms.unwrapKey(vault.data_key_id);

      // 5. Check if chunks already exist for this draft
      const currentChunks = await tx.select({ id: chunks.id })
        .from(chunks)
        .where(and(eq(chunks.page_id, pageId), eq(chunks.version_id, draftId)))
        .limit(1);

      let preparedChunks: Array<{
        content: string;
        chunkIndex: number;
        encText: Buffer;
        embedding: number[] | null;
      }> = [];

      if (vault.mode === 'open' && currentChunks.length === 0) {
        const plaintext = EnvelopeEncryption.decryptToString(draft.encrypted_blob, dek);
        const chunker = new MarkdownChunker({ maxTokensPerChunk: 400, overlapTokens: 50 });
        const docChunks = chunker.chunk(plaintext);
        if (docChunks.length > 0) {
          let embeddings: number[][] | null = null;
          let skipEmbeddings = false;

          if (!provider) {
            try {
              const embeddingProvider = getEmbeddingProvider();
              embeddings = await embeddingProvider.generateEmbeddings(docChunks.map((c) => c.content));
              validateEmbeddingBatch(embeddings, docChunks.length);
            } catch (err) {
              if (err instanceof EmbeddingConfigurationError) {
                console.warn('Embedding provider not configured during publishVersion, degrading to lexical tsvector only:', (err as any).message);
                skipEmbeddings = true;
              } else {
                throw err;
              }
            }
          } else {
            embeddings = await provider.generateEmbeddings(docChunks.map((c) => c.content));
            validateEmbeddingBatch(embeddings, docChunks.length);
          }

          preparedChunks = docChunks.map((c, i) => ({
            content: c.content,
            chunkIndex: c.chunkIndex,
            encText: EnvelopeEncryption.encrypt(c.content, dek!),
            embedding: skipEmbeddings || !embeddings ? null : embeddings[i],
          }));
        }
      }

      const publishedAt = new Date();

      // 6. Atomically mark published
      await tx.update(versions)
        .set({ status: 'published', created_by: authorId, created_at: publishedAt })
        .where(eq(versions.id, draftId));

      // 7. Update page current_version_id with compound predicate
      const updated = await tx.update(pages)
        .set({ current_version_id: draftId, updated_at: publishedAt })
        .where(and(eq(pages.id, pageId), eq(pages.vault_id, lockedPage.vault_id)))
        .returning({ id: pages.id });

      if (!updated || updated.length !== 1) {
        throw new Error('Concurrent modification detected: page vault mismatch during publishVersion');
      }

      // 8. Chunks alignment
      if (vault.mode === 'locked') {
        await tx.delete(chunks).where(eq(chunks.page_id, pageId));
      } else {
        // The version just published becomes the only indexed one: entries of the version it
        // replaces are removed, and its own are written now unless the draft save already did
        await tx.delete(chunks).where(and(eq(chunks.page_id, pageId), sql`${chunks.version_id} <> ${draftId}`));
        for (const pc of preparedChunks) {
          await tx.insert(chunks).values({
            page_id: pageId,
            version_id: draftId,
            position: pc.chunkIndex,
            encrypted_text: pc.encText,
            tsv_content: sql`to_tsvector('english', ${pc.content})`,
            embedding: pc.embedding,
          });
        }
      }

      // 9. Link graph alignment with the published content (covers drafts written outside saveDraft,
      // e.g. imports and notes added through Claude). Locked vaults keep no link metadata.
      const publishedContent = vault.mode === 'open'
        ? EnvelopeEncryption.decryptToString(draft.encrypted_blob, dek)
        : '';
      await LinkGraphIndexer.updateLinksForPage(lockedPage.vault_id, pageId, publishedContent, tx);
      await LinkGraphIndexer.resolveIncomingGhostLinks(pageId, tx);

      // 10. Append-only audit record, in the same transaction as the publish (FR-81)
      await tx.insert(auditEvents).values({
        actor_id: authorId,
        action: 'publish_page',
        target_id: pageId,
        metadata: { vault_id: lockedPage.vault_id, version_id: draftId, version_number: draft.number },
      });

      return draftId;
    });
  } finally {
    dek?.fill(0);
  }
}

/**
 * Decrypts a page's content.
 * With `publishedOnly` (Readers, Consumers and every retrieval tool, FR-43) only the latest published
 * snapshot is ever returned; a page that has never been published yields null.
 */
export async function getPageContent(
  pageId: string,
  versionId?: string,
  options?: { publishedOnly?: boolean }
): Promise<{ content: string; versionId: string; versionNumber: number } | null> {
  const pageRec = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!pageRec[0]) return null;

  const publishedOnly = options?.publishedOnly === true;
  const targetVersionId = versionId || pageRec[0].current_version_id;

  let versionRecord;
  if (targetVersionId) {
    // The version must belong to this page; never decrypt another page's version by id
    const vRows = await db.select().from(versions)
      .where(and(eq(versions.id, targetVersionId), eq(versions.page_id, pageId)))
      .limit(1);
    versionRecord = vRows[0];
    if (versionRecord && publishedOnly && versionRecord.status !== 'published') {
      versionRecord = undefined;
    }
  }

  if (!versionRecord) {
    // Fall back to the latest published version, or (privileged callers only) the latest of any status
    const allVersions = await db.select()
      .from(versions)
      .where(publishedOnly
        ? and(eq(versions.page_id, pageId), eq(versions.status, 'published'))
        : eq(versions.page_id, pageId))
      .orderBy(desc(versions.number))
      .limit(1);
    versionRecord = allVersions[0];
  }

  if (!versionRecord || !versionRecord.encrypted_blob) {
    return null;
  }

  const vaultRec = await db.select().from(vaults).where(eq(vaults.id, pageRec[0].vault_id)).limit(1);
  if (!vaultRec[0] || !vaultRec[0].data_key_id) throw new Error('Vault not found or DEK missing');

  const kms = createKmsProvider();
  const dek = await kms.unwrapKey(vaultRec[0].data_key_id);
  try {
    const content = EnvelopeEncryption.decryptToString(versionRecord.encrypted_blob, dek);
    return {
      content,
      versionId: versionRecord.id,
      versionNumber: versionRecord.number,
    };
  } finally {
    dek.fill(0);
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { eq, inArray, sql } from 'drizzle-orm';
import { MockKmsProvider, EnvelopeEncryption } from '../dist/crypto/kms.js';
import { searchPages } from '../dist/search/index.js';
import { saveDraft, publishVersion } from '../dist/versions/index.js';
import { deletePage, reindexPage, reindexVault } from '../dist/search/lifecycle.js';
import {
  LocalDeterministicEmbeddingProvider,
  EMBEDDING_DIMENSION,
  EmbeddingValidationError,
  validateEmbeddingBatch,
} from '../dist/search/embedding-provider.js';

test('Epic 5 Chunk 5.3 & 5.4: Semantic Retrieval, Hybrid RAG, and Lifecycle Semantics', async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalProvider = process.env.EMBEDDING_PROVIDER;
  process.env.NODE_ENV = 'test';
  process.env.EMBEDDING_PROVIDER = 'deterministic';

  const kms = new MockKmsProvider();
  const ownerId = 'retrieval.lifecycle@tkxel-vault.local';

  const vaultId = crypto.randomUUID();
  const rawDek = EnvelopeEncryption.generateDek();
  const wrappedDek = await kms.wrapKey(rawDek);

  const pageLexicalId = crypto.randomUUID();
  const pageSemanticId = crypto.randomUUID();
  const pageUpdateId = crypto.randomUUID();

  const controlledProvider = {
    name: 'ControlledSemanticProvider',
    dimension: EMBEDDING_DIMENSION,
    getVectorFor(text) {
      const lower = (text || '').toLowerCase();
      let targetIndex = 1000;
      if (lower.includes('automobile') || lower.includes('car repair') || lower.includes('engine servicing')) {
        targetIndex = 42;
      } else if (lower.includes('consensus') || lower.includes('raft') || lower.includes('paxos')) {
        targetIndex = 7;
      }
      const vec = new Array(this.dimension).fill(0.0001);
      vec[targetIndex] = 1.0;
      const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      return vec.map((v) => v / norm);
    },
    async generateEmbedding(text) {
      return this.getVectorFor(text);
    },
    async generateEmbeddings(texts) {
      return texts.map((t) => this.getVectorFor(t));
    },
  };

  try {
    // 1. Seed open vault
    await db.insert(schema.vaults).values({
      id: vaultId,
      name: 'Hybrid Retrieval Test Vault',
      mode: 'open',
      owner_id: ownerId,
      data_key_id: wrappedDek,
      export_policy: 'allowed_for_owner',
      created_at: new Date(),
    });

    await db.insert(schema.pages).values([
      {
        id: pageLexicalId,
        vault_id: vaultId,
        type: 'note',
        title: 'Distributed Systems Consensus Guide',
        tags: ['infrastructure', 'consensus'],
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: pageSemanticId,
        vault_id: vaultId,
        type: 'note',
        title: 'Automobile Fleet Service Handbook',
        tags: ['automotive', 'maintenance'],
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: pageUpdateId,
        vault_id: vaultId,
        type: 'note',
        title: 'Lifecycle Mutation Document',
        tags: ['lifecycle'],
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    // Save and publish documents with real chunks and 1536d embeddings
    await saveDraft(
      pageLexicalId,
      '# Distributed Consensus\n\nRaft and Paxos guarantee quorum agreement across replicated state machines.',
      ownerId,
      undefined,
      controlledProvider
    );
    await publishVersion(pageLexicalId, ownerId, controlledProvider);

    await saveDraft(
      pageSemanticId,
      '# Automobile Fleet Service\n\nAutomobile engine servicing and vehicle maintenance schedule with lubrication details.',
      ownerId,
      undefined,
      controlledProvider
    );
    await publishVersion(pageSemanticId, ownerId, controlledProvider);

    await t.test('28. Lexical search preserves accepted PostgreSQL ranking behavior', async () => {
      const results = await searchPages(vaultId, 'quorum agreement', 10, { mode: 'lexical' });

      assert.ok(results.length > 0);
      assert.equal(results[0].id, pageLexicalId);
      assert.equal(results[0].source, 'lexical');
      assert.ok(results[0].score > 0);
      assert.equal(results[0].snippet, '');
    });

    await t.test('29. Genuine semantic retrieval with lexically disjoint vocabulary via pgvector cosine distance', async () => {
      // Query "car repair timetable" is completely lexically disjoint from "Automobile engine servicing..."
      // 1. Prove lexical search yields 0 matches for pageSemanticId
      const lexicalResults = await searchPages(vaultId, 'car repair timetable', 10, { mode: 'lexical' });
      const matchedPageIds = lexicalResults.map((r) => r.id);
      assert.ok(!matchedPageIds.includes(pageSemanticId), 'Lexical search must not match lexically disjoint query');

      // 2. Semantic retrieval returns pageSemanticId as rank 1 via pgvector cosine distance
      const semanticResults = await searchPages(vaultId, 'car repair timetable', 10, {
        mode: 'semantic',
        provider: controlledProvider,
      });

      assert.ok(semanticResults.length > 0);
      const top = semanticResults[0];
      assert.equal(top.id, pageSemanticId);
      assert.equal(top.source, 'vector');
      assert.ok(top.score > 0.8, `Cosine similarity score ${top.score} must exceed 0.8 threshold`);

      // 3. Hybrid RAG fuses semantic ranking even when lexical yields 0 results
      const hybridResults = await searchPages(vaultId, 'car repair timetable', 10, {
        mode: 'hybrid',
        provider: controlledProvider,
      });

      assert.ok(hybridResults.length > 0);
      assert.equal(hybridResults[0].id, pageSemanticId);
      assert.equal(
        hybridResults[0].source,
        'vector',
        'Result present only in vector rankings must be labeled vector in hybrid mode'
      );
    });

    await t.test('30. Hybrid retrieval combines lexical and semantic behavior with RRF and honest source labeling', async () => {
      const results = await searchPages(vaultId, 'consensus', 10, {
        mode: 'hybrid',
        provider: controlledProvider,
      });

      assert.ok(results.length > 0);
      assert.equal(results[0].id, pageLexicalId);
      assert.equal(results[0].source, 'hybrid', 'Fused results present in both rankings must be labeled hybrid');
      assert.ok(results[0].score > 0, 'RRF score must be positive');
    });

    await t.test('31 & 32. Lexical-only fallback when semantic is unavailable: never mislabeled as hybrid', async () => {
      // Create a failing provider
      const failingProvider = {
        name: 'failing-provider',
        dimension: EMBEDDING_DIMENSION,
        generateEmbedding: async () => {
          throw new Error('Connection refused to mock provider');
        },
        generateEmbeddings: async () => {
          throw new Error('Connection refused to mock provider');
        },
      };

      const results = await searchPages(vaultId, 'consensus', 10, {
        mode: 'hybrid',
        provider: failingProvider,
      });

      assert.ok(results.length > 0);
      assert.equal(results[0].id, pageLexicalId);
      assert.equal(
        results[0].source,
        'lexical',
        'Results must be accurately labeled lexical when semantic retrieval fails'
      );
    });

    await t.test('33. Deletion removes associated embeddings completely', async () => {
      // Save draft for update page
      await saveDraft(pageUpdateId, '# Deletion Target\n\nContent to be purged.', ownerId);

      // Verify chunks exist
      const beforeChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageUpdateId));
      assert.ok(beforeChunks.length > 0);

      // Delete page
      await deletePage(vaultId, pageUpdateId);

      // Verify page and chunks are completely gone
      const afterPages = await db.select().from(schema.pages).where(eq(schema.pages.id, pageUpdateId));
      assert.equal(afterPages.length, 0);

      const afterChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageUpdateId));
      assert.equal(afterChunks.length, 0, 'Chunks and embeddings must be deleted');
    });

    await t.test('34 & 35. Reindexing is idempotent and eliminates stale vectors', async () => {
      // Initial reindex
      const res1 = await reindexPage(vaultId, pageLexicalId, { provider: controlledProvider });
      assert.equal(res1.status, 'indexed');
      assert.ok(res1.chunkCount > 0);

      const chunksAfterFirst = await db
        .select()
        .from(schema.chunks)
        .where(eq(schema.chunks.page_id, pageLexicalId));

      // Second reindex (idempotency check)
      const res2 = await reindexPage(vaultId, pageLexicalId, { provider: controlledProvider });
      assert.equal(res2.status, 'indexed');
      assert.equal(res2.chunkCount, res1.chunkCount);

      const chunksAfterSecond = await db
        .select()
        .from(schema.chunks)
        .where(eq(schema.chunks.page_id, pageLexicalId));

      assert.equal(chunksAfterSecond.length, chunksAfterFirst.length, 'No duplicate chunks after reindex');

      // Vault-wide reindex
      const vaultResults = await reindexVault(vaultId, { provider: controlledProvider });
      assert.ok(vaultResults.length >= 2);
      assert.ok(vaultResults.every((r) => r.status === 'indexed'));
    });

    await t.test('36. Failed indexing does not publish partial or invalid semantic state', async () => {
      const initialChunks = await db
        .select()
        .from(schema.chunks)
        .where(eq(schema.chunks.page_id, pageLexicalId));

      const failingProvider = {
        name: 'failing-reindexer',
        dimension: EMBEDDING_DIMENSION,
        generateEmbedding: async () => {
          throw new Error('Provider outage during reindex');
        },
        generateEmbeddings: async () => {
          throw new Error('Provider outage during reindex');
        },
      };

      await assert.rejects(
        async () => reindexPage(vaultId, pageLexicalId, { provider: failingProvider }),
        /Provider outage during reindex/
      );

      // Verify existing chunks were preserved and not corrupted or wiped
      const currentChunks = await db
        .select()
        .from(schema.chunks)
        .where(eq(schema.chunks.page_id, pageLexicalId));

      assert.equal(currentChunks.length, initialChunks.length, 'Database state must remain intact after failed indexing');
    });

    await t.test('36b. Atomic draft creation: provider failure before DB transaction rolls back completely', async () => {
      const pageAtomicityId = crypto.randomUUID();
      await db.insert(schema.pages).values({
        id: pageAtomicityId,
        vault_id: vaultId,
        type: 'note',
        title: 'Atomicity Test Page',
        created_at: new Date(),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      });

      const failingDraftProvider = {
        name: 'failing-draft-provider',
        dimension: EMBEDDING_DIMENSION,
        generateEmbedding: async () => {
          throw new Error('Provider outage during draft embedding');
        },
        generateEmbeddings: async () => {
          throw new Error('Provider outage during draft embedding');
        },
      };

      await assert.rejects(
        async () =>
          saveDraft(
            pageAtomicityId,
            '# Unsaved Draft Content\n\nThis content should not be persisted.',
            ownerId,
            undefined,
            failingDraftProvider
          ),
        /Provider outage during draft embedding/
      );

      // Verify no version record was created
      const versionRows = await db.select().from(schema.versions).where(eq(schema.versions.page_id, pageAtomicityId));
      assert.equal(versionRows.length, 0, 'No version row must be inserted when provider fails');

      // Verify page updated_at was NOT modified
      const pageRows = await db.select().from(schema.pages).where(eq(schema.pages.id, pageAtomicityId));
      assert.equal(pageRows[0].updated_at.toISOString(), '2026-01-01T00:00:00.000Z', 'Page updated_at must remain untouched');

      // Verify zero chunks exist
      const chunkRows = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageAtomicityId));
      assert.equal(chunkRows.length, 0, 'Zero chunks must exist for aborted draft');

      // Cleanup pageAtomicityId
      await db.delete(schema.pages).where(eq(schema.pages.id, pageAtomicityId));
    });

    await t.test('36c. Centralized validator rejects malformed batches and causes zero mutations', async () => {
      // 1. Direct unit verification of validateEmbeddingBatch failure modes
      // 1a. Result count mismatch
      assert.throws(
        () => validateEmbeddingBatch([[0.1]], 2),
        (err) => err instanceof EmbeddingValidationError && /Embedding count mismatch/.test(err.message)
      );
      // 1b. Missing vectors (null or non-array)
      assert.throws(
        () => validateEmbeddingBatch([null], 1),
        (err) => err instanceof EmbeddingValidationError && /Missing or malformed vector/.test(err.message)
      );
      // 1c. Dimensions other than 1536
      assert.throws(
        () => validateEmbeddingBatch([new Array(512).fill(0.1)], 1),
        (err) => err instanceof EmbeddingValidationError && /Wrong vector dimension/.test(err.message)
      );
      // 1d. Non-numeric, NaN, or infinite values
      const nanVec = new Array(EMBEDDING_DIMENSION).fill(0.1);
      nanVec[5] = NaN;
      assert.throws(
        () => validateEmbeddingBatch([nanVec], 1),
        (err) => err instanceof EmbeddingValidationError && /Non-finite numerical value/.test(err.message)
      );
      const infVec = new Array(EMBEDDING_DIMENSION).fill(0.1);
      infVec[10] = Infinity;
      assert.throws(
        () => validateEmbeddingBatch([infVec], 1),
        (err) => err instanceof EmbeddingValidationError && /Non-finite numerical value/.test(err.message)
      );

      // 2. Integration regression test: saveDraft with malformed provider
      const badPageId = crypto.randomUUID();
      const initialTimestamp = new Date('2026-02-01T12:00:00.000Z');
      await db.insert(schema.pages).values({
        id: badPageId,
        vault_id: vaultId,
        type: 'note',
        title: 'Malformed Provider Test Page',
        created_at: initialTimestamp,
        updated_at: initialTimestamp,
      });

      const badProviderNaN = {
        name: 'bad-provider-nan',
        dimension: EMBEDDING_DIMENSION,
        async generateEmbedding() {
          return nanVec;
        },
        async generateEmbeddings(texts) {
          return texts.map(() => nanVec);
        },
      };

      await assert.rejects(
        async () => saveDraft(badPageId, '# Test Title\n\nSome note content.', ownerId, undefined, badProviderNaN),
        (err) => err instanceof EmbeddingValidationError
      );

      // Verify zero mutations: page, version, timestamp, chunks untouched
      const versionsAfter = await db.select().from(schema.versions).where(eq(schema.versions.page_id, badPageId));
      assert.equal(versionsAfter.length, 0, 'Zero version rows must be inserted on malformed provider response');

      const pageAfter = await db.select().from(schema.pages).where(eq(schema.pages.id, badPageId));
      assert.equal(pageAfter[0].updated_at.toISOString(), initialTimestamp.toISOString(), 'Page updated_at must remain untouched');

      const chunksAfter = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, badPageId));
      assert.equal(chunksAfter.length, 0, 'Zero chunks must exist on malformed provider response');

      // 3. Integration regression test: reindexPage with malformed provider
      const badProvider512 = {
        name: 'bad-provider-512',
        dimension: 512,
        async generateEmbedding() {
          return new Array(512).fill(0.1);
        },
        async generateEmbeddings(texts) {
          return texts.map(() => new Array(512).fill(0.1));
        },
      };

      const chunksBeforeReindex = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageLexicalId));
      assert.ok(chunksBeforeReindex.length > 0);

      await assert.rejects(
        async () => reindexPage(vaultId, pageLexicalId, { provider: badProvider512 }),
        (err) => err instanceof EmbeddingValidationError
      );

      // Verify chunks were preserved and not cleared or corrupted
      const chunksAfterReindex = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageLexicalId));
      assert.equal(chunksAfterReindex.length, chunksBeforeReindex.length, 'Existing chunks must be untouched when reindex fails validation');

      // Cleanup badPageId
      await db.delete(schema.pages).where(eq(schema.pages.id, badPageId));
    });

    await t.test('37. Content updates do not retain obsolete vectors', async () => {
      // Update page with completely new content
      await saveDraft(
        pageSemanticId,
        '# Machine Learning Deployment\n\nModel registry, Triton inference server, and GPU utilization metrics.',
        ownerId,
        undefined,
        controlledProvider
      );

      const updatedChunks = await db
        .select()
        .from(schema.chunks)
        .where(eq(schema.chunks.page_id, pageSemanticId));

      assert.ok(updatedChunks.length > 0);

      // Search for old keywords -> must not match
      const oldSearch = await db.execute(sql`
        SELECT count(*)::int as count
        FROM ${schema.chunks}
        WHERE page_id = ${pageSemanticId}::uuid
          AND tsv_content @@ plainto_tsquery('lubrication')
      `);
      assert.equal(oldSearch.rows[0].count, 0, 'Old lexemes must be purged on update');
    });
  } finally {
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalProvider !== undefined) process.env.EMBEDDING_PROVIDER = originalProvider;
    else delete process.env.EMBEDDING_PROVIDER;

    let cleanupError = null;
    try {
      await db.delete(schema.chunks).where(inArray(schema.chunks.page_id, [pageLexicalId, pageSemanticId, pageUpdateId]));
      await db.delete(schema.versions).where(inArray(schema.versions.page_id, [pageLexicalId, pageSemanticId, pageUpdateId]));
      await db.delete(schema.pages).where(inArray(schema.pages.id, [pageLexicalId, pageSemanticId, pageUpdateId]));
      await db.delete(schema.vaults).where(eq(schema.vaults.id, vaultId));
    } catch (cleanupErr) {
      cleanupError = cleanupErr;
    }

    if (cleanupError) {
      throw new Error(`Database cleanup failed in semantic-retrieval-lifecycle.test.js: ${cleanupError.message}`);
    }
  }
});

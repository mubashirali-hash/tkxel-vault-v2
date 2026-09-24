import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { eq, inArray } from 'drizzle-orm';
import { MockKmsProvider, EnvelopeEncryption } from '../dist/crypto/kms.js';
import { searchPages } from '../dist/search/index.js';
import { saveDraft, publishVersion } from '../dist/versions/index.js';
import { reindexPage, reindexVault } from '../dist/search/lifecycle.js';

class SpyEmbeddingProvider {
  constructor() {
    this.name = 'SpyEmbeddingProvider';
    this.dimension = 1536;
    this.generateEmbeddingCalls = [];
    this.generateEmbeddingsCalls = [];
  }

  async generateEmbedding(text) {
    this.generateEmbeddingCalls.push(text);
    return new Array(1536).fill(0.01);
  }

  async generateEmbeddings(texts) {
    this.generateEmbeddingsCalls.push(texts);
    return texts.map(() => new Array(1536).fill(0.01));
  }

  totalCalls() {
    return this.generateEmbeddingCalls.length + this.generateEmbeddingsCalls.length;
  }
}

test('Epic 5 Isolation Invariants: Zero-Provider Activity on Locked and Unknown Vaults', async (t) => {
  const kms = new MockKmsProvider();
  const ownerId = 'isolation.owner@tkxel-vault.local';

  const vaultOpenId = crypto.randomUUID();
  const vaultLockedId = crypto.randomUUID();
  const unknownVaultId = crypto.randomUUID();

  const pageOpenId = crypto.randomUUID();
  const pageLockedId = crypto.randomUUID();
  const unknownPageId = crypto.randomUUID();

  const rawDekOpen = EnvelopeEncryption.generateDek();
  const wrappedDekOpen = await kms.wrapKey(rawDekOpen);

  const rawDekLocked = EnvelopeEncryption.generateDek();
  const wrappedDekLocked = await kms.wrapKey(rawDekLocked);

  const originalNodeEnv = process.env.NODE_ENV;
  const originalProvider = process.env.EMBEDDING_PROVIDER;
  const originalApiKey = process.env.OPENAI_API_KEY;

  try {
    // 1. Seed test database
    await db.insert(schema.vaults).values([
      {
        id: vaultOpenId,
        name: 'Isolation Open Vault',
        mode: 'open',
        owner_id: ownerId,
        data_key_id: wrappedDekOpen,
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      },
      {
        id: vaultLockedId,
        name: 'Isolation Locked Vault',
        mode: 'locked',
        owner_id: ownerId,
        data_key_id: wrappedDekLocked,
        export_policy: 'strictly_forbidden',
        created_at: new Date(),
      },
    ]);

    await db.insert(schema.pages).values([
      {
        id: pageOpenId,
        vault_id: vaultOpenId,
        type: 'note',
        title: 'Open Architecture Note',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: pageLockedId,
        vault_id: vaultLockedId,
        type: 'note',
        title: 'Confidential Locked Runbook',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    await t.test('21. Locked-vault search causes zero provider construction or calls', async () => {
      const spy = new SpyEmbeddingProvider();
      const results = await searchPages(vaultLockedId, 'architecture', 10, { provider: spy });

      assert.deepEqual(results, []);
      assert.equal(spy.totalCalls(), 0, 'Provider must not be called when searching locked vault');
    });

    await t.test('22. Locked-vault indexing causes zero provider calls (saveDraft & publishVersion)', async () => {
      // Deliberately corrupt environment provider configuration
      // If locked vault touches provider factory, it would fail closed with configuration error
      delete process.env.EMBEDDING_PROVIDER;
      delete process.env.OPENAI_API_KEY;

      const draftResult = await saveDraft(
        pageLockedId,
        '# Secret Skills\n\nTop secret locked instructions.',
        ownerId
      );
      assert.ok(draftResult.draftId);

      const publishedId = await publishVersion(pageLockedId, ownerId);
      assert.ok(publishedId);

      // Verify zero chunks exist in database for locked page
      const chunkCount = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageLockedId));
      assert.equal(chunkCount.length, 0, 'Zero chunks must exist for locked vault pages');
    });

    await t.test('23. Locked-vault reindexing causes zero provider calls', async () => {
      const spy = new SpyEmbeddingProvider();
      const reindexRes = await reindexPage(vaultLockedId, pageLockedId, { provider: spy });

      assert.equal(reindexRes.status, 'skipped_locked');
      assert.equal(reindexRes.chunkCount, 0);
      assert.equal(spy.totalCalls(), 0, 'Provider must never be called during locked vault reindexing');
    });

    await t.test('24. Locked-vault vault-wide reindex causes zero provider calls', async () => {
      const spy = new SpyEmbeddingProvider();
      const reindexList = await reindexVault(vaultLockedId, { provider: spy });

      assert.equal(reindexList.length, 1);
      assert.equal(reindexList[0].status, 'skipped_locked');
      assert.equal(spy.totalCalls(), 0, 'Provider must never be called during locked vault-wide reindexing');
    });

    await t.test('25. Unknown-vault search causes zero provider calls', async () => {
      const spy = new SpyEmbeddingProvider();
      const results = await searchPages(unknownVaultId, 'search term', 10, { provider: spy });

      assert.deepEqual(results, []);
      assert.equal(spy.totalCalls(), 0, 'Provider must not be called when searching unknown vault');
    });

    await t.test('26. Unknown-vault reindexing causes zero provider calls', async () => {
      const spy = new SpyEmbeddingProvider();

      await assert.rejects(
        async () => reindexPage(unknownVaultId, unknownPageId, { provider: spy }),
        (err) => err.message === 'not_found'
      );
      assert.equal(spy.totalCalls(), 0, 'Provider must not be called on unknown vault reindexPage');

      await assert.rejects(
        async () => reindexVault(unknownVaultId, { provider: spy }),
        (err) => err.message === 'not_found'
      );
      assert.equal(spy.totalCalls(), 0, 'Provider must not be called on unknown vault reindexVault');
    });

    await t.test('27. Vault existence and mode is checked before provider selection', async () => {
      // In production mode with completely missing provider configuration:
      // A locked vault search MUST succeed (returning []) because vault mode is checked first.
      process.env.NODE_ENV = 'production';
      delete process.env.EMBEDDING_PROVIDER;
      delete process.env.OPENAI_API_KEY;

      const lockedResults = await searchPages(vaultLockedId, 'check order', 10);
      assert.deepEqual(lockedResults, []);

      // Unknown vault also returns [] without throwing configuration error
      const unknownResults = await searchPages(unknownVaultId, 'check order', 10);
      assert.deepEqual(unknownResults, []);
    });
 
    await t.test('27b. Cross-vault reindexing prevents chunk deletion and fails with not_found', async () => {
      // 1. Ensure open page has chunks
      process.env.NODE_ENV = 'test';
      process.env.EMBEDDING_PROVIDER = 'deterministic';
      await saveDraft(pageOpenId, '# Open Architecture\n\nModular design principles and separation of concerns.', ownerId);
      await publishVersion(pageOpenId, ownerId);

      const openChunksBefore = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageOpenId));
      assert.ok(openChunksBefore.length > 0, 'Open page must have chunks indexed');

      // 2. Attempt to reindex open page under locked vault ID
      const spy = new SpyEmbeddingProvider();
      await assert.rejects(
        async () => reindexPage(vaultLockedId, pageOpenId, { provider: spy }),
        (err) => err.message === 'not_found',
        'Cross-vault reindex must reject with not_found'
      );
      assert.equal(spy.totalCalls(), 0, 'Provider must never be called on cross-vault reindex');

      // 3. Verify chunks for open page were NOT deleted by the locked vault reindex attempt
      const openChunksAfter = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageOpenId));
      assert.equal(openChunksAfter.length, openChunksBefore.length, 'Open page chunks must be preserved against cross-vault reindex');

      // 4. Attempt to reindex locked page under open vault ID
      await assert.rejects(
        async () => reindexPage(vaultOpenId, pageLockedId, { provider: spy }),
        (err) => err.message === 'not_found',
        'Mismatched page/vault pair must reject with not_found'
      );
      assert.equal(spy.totalCalls(), 0, 'Provider must never be called when page does not belong to vault');
    });
  } finally {
    // Restore environment
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalProvider !== undefined) process.env.EMBEDDING_PROVIDER = originalProvider;
    else delete process.env.EMBEDDING_PROVIDER;
    if (originalApiKey !== undefined) process.env.OPENAI_API_KEY = originalApiKey;
    else delete process.env.OPENAI_API_KEY;

    // Teardown database - fail closed if cleanup fails
    let cleanupError = null;
    try {
      await db.delete(schema.chunks).where(inArray(schema.chunks.page_id, [pageOpenId, pageLockedId]));
      await db.delete(schema.versions).where(inArray(schema.versions.page_id, [pageOpenId, pageLockedId]));
      await db.delete(schema.pages).where(inArray(schema.pages.id, [pageOpenId, pageLockedId]));
      await db.delete(schema.shares).where(inArray(schema.shares.vault_id, [vaultOpenId, vaultLockedId]));
      await db.delete(schema.vaults).where(inArray(schema.vaults.id, [vaultOpenId, vaultLockedId]));
    } catch (cleanupErr) {
      cleanupError = cleanupErr;
    }

    if (cleanupError) {
      throw new Error(`Database cleanup failed in search-isolation-provider.test.js: ${cleanupError.message}`);
    }
  }
});

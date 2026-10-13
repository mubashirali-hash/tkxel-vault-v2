import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, pool } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { eq } from 'drizzle-orm';
import { MockKmsProvider, EnvelopeEncryption } from '../dist/crypto/kms.js';
import { saveDraft, publishVersion } from '../dist/versions/index.js';
import { reindexPage } from '../dist/search/lifecycle.js';
import { searchPages } from '../dist/search/index.js';
import { getEmbeddingProvider, EmbeddingConfigurationError, isSemanticSearchOff } from '../dist/search/embedding-provider.js';
import { runMigrations } from '../dist/schema/migrator.js';

/**
 * A deployment without an embedding service chooses EMBEDDING_PROVIDER=none. That is an explicit
 * setting, valid in production: pages are saved, indexed and found by keywords, and nothing is
 * sent to any embedding service.
 */
test('Keyword-only search mode (EMBEDDING_PROVIDER=none)', async (t) => {
  const saved = { nodeEnv: process.env.NODE_ENV, provider: process.env.EMBEDDING_PROVIDER, key: process.env.OPENAI_API_KEY };
  await runMigrations(db);

  const kms = new MockKmsProvider();
  const owner = 'keyword.only@test.com';
  const vaultId = crypto.randomUUID();
  const pageId = crypto.randomUUID();

  try {
    await t.test('the setting is recognised and never builds a provider, in production too', () => {
      for (const nodeEnv of ['production', 'development', 'test']) {
        assert.throws(
          () => getEmbeddingProvider({ env: { NODE_ENV: nodeEnv, EMBEDDING_PROVIDER: 'none', OPENAI_API_KEY: 'sk-unused' } }),
          (error) => error instanceof EmbeddingConfigurationError && /switched off/.test(error.message)
        );
      }
      assert.equal(isSemanticSearchOff({ EMBEDDING_PROVIDER: ' None ' }), true);
      assert.equal(isSemanticSearchOff({ EMBEDDING_PROVIDER: 'openai' }), false);
      assert.equal(isSemanticSearchOff({}), false);
    });

    // The database part runs with the test key service; the production case of the setting is covered above
    process.env.NODE_ENV = 'test';
    process.env.EMBEDDING_PROVIDER = 'none';
    delete process.env.OPENAI_API_KEY;

    await db.insert(schema.vaults).values({
      id: vaultId, name: 'Keyword Only Vault', mode: 'open', owner_id: owner,
      data_key_id: await kms.wrapKey(EnvelopeEncryption.generateDek()), export_policy: 'allowed_for_owner', created_at: new Date(),
    });
    await db.insert(schema.pages).values({ id: pageId, vault_id: vaultId, type: 'note', title: 'Kestrel Runbook', aliases: [], tags: [], front_matter: {} });

    await t.test('saving and publishing index the text without vectors, and keyword search finds it', async () => {
      await saveDraft(pageId, 'Restart the kestrel ingestion workers before the nightly reconciliation.', owner);
      await publishVersion(pageId, owner);
      const rows = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.ok(rows.length > 0, 'the page is indexed');
      assert.ok(rows.every((row) => row.embedding === null), 'no vectors are stored');

      const found = await searchPages(vaultId, 'kestrel reconciliation', 5, { publishedOnly: true });
      assert.deepEqual(found.map((r) => r.title), ['Kestrel Runbook']);
      assert.equal(found[0].source, 'lexical', 'the result is not labelled as semantic');
      await assert.rejects(() => searchPages(vaultId, 'kestrel', 5, { mode: 'semantic' }), EmbeddingConfigurationError, 'a purely semantic search still fails closed');
    });

    await t.test('rebuilding the index works in this mode and still stores no vectors', async () => {
      await db.delete(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      const result = await reindexPage(vaultId, pageId);
      assert.equal(result.status, 'indexed');
      assert.ok(result.chunkCount > 0);
      const rows = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.ok(rows.length > 0 && rows.every((row) => row.embedding === null));
      assert.equal((await searchPages(vaultId, 'ingestion workers', 5, { publishedOnly: true })).length, 1);
    });
  } finally {
    if (saved.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.nodeEnv;
    if (saved.provider === undefined) delete process.env.EMBEDDING_PROVIDER; else process.env.EMBEDDING_PROVIDER = saved.provider;
    if (saved.key !== undefined) process.env.OPENAI_API_KEY = saved.key;
    await db.delete(schema.vaults).where(eq(schema.vaults.id, vaultId));
    await pool.end();
  }
});

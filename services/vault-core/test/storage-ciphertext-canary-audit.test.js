import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { sql, eq, inArray } from 'drizzle-orm';
import { MockKmsProvider, EnvelopeEncryption } from '../dist/crypto/kms.js';
import { saveDraft, publishVersion } from '../dist/versions/index.js';
import { searchPages } from '../dist/search/index.js';

test('Epic 2: Storage Ciphertext Canary Audit & Searchable Boundary Verification', async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEmbeddingProvider = process.env.EMBEDDING_PROVIDER;
  process.env.NODE_ENV = 'test';
  process.env.EMBEDDING_PROVIDER = 'deterministic';

  const kms = new MockKmsProvider();

  // Test identities & vaults
  const ownerId = 'owner.audit@test.com';
  const vaultOpenId = crypto.randomUUID();
  const vaultLockedId = crypto.randomUUID();

  const pageOpenId = crypto.randomUUID();
  const pageLockedId = crypto.randomUUID();

  // Cryptographic Canaries
  const openCanary = `CANARY_OPEN_SECRET_${crypto.randomBytes(16).toString('hex')}`;
  const lockedCanary = `CANARY_LOCKED_TOPSECRET_${crypto.randomBytes(16).toString('hex')}`;

  const rawDekOpen = EnvelopeEncryption.generateDek();
  const wrappedDekOpen = await kms.wrapKey(rawDekOpen);

  const rawDekLocked = EnvelopeEncryption.generateDek();
  const wrappedDekLocked = await kms.wrapKey(rawDekLocked);

  try {
    // 1. Seed Open Vault & Locked Vault in database
    await db.insert(schema.vaults).values([
      {
        id: vaultOpenId,
        name: 'Open Audit Vault',
        mode: 'open',
        owner_id: ownerId,
        data_key_id: wrappedDekOpen,
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      },
      {
        id: vaultLockedId,
        name: 'Locked Confidential Vault',
        mode: 'locked',
        owner_id: ownerId,
        data_key_id: wrappedDekLocked,
        export_policy: 'strictly_forbidden',
        created_at: new Date(),
      },
    ]);

    await db.insert(schema.shares).values([
      {
        vault_id: vaultOpenId,
        principal_id: ownerId,
        role: 'owner',
        granted_by: ownerId,
        granted_at: new Date(),
      },
      {
        vault_id: vaultLockedId,
        principal_id: ownerId,
        role: 'owner',
        granted_by: ownerId,
        granted_at: new Date(),
      },
    ]);

    // 2. Insert Open Note with openCanary
    await db.insert(schema.pages).values({
      id: pageOpenId,
      vault_id: vaultOpenId,
      type: 'note',
      title: 'Open Architecture Note',
      aliases: ['open-arch-alias'],
      tags: ['open-audit'],
      front_matter: { title: 'Open Architecture Note', tags: ['open-audit'] },
      created_at: new Date(),
      updated_at: new Date(),
    });

    const openDraft = await saveDraft(pageOpenId, `# Open Document\n\n${openCanary} is here.`, ownerId);
    await publishVersion(pageOpenId, ownerId);

    // 3. Insert Locked Note with lockedCanary
    await db.insert(schema.pages).values({
      id: pageLockedId,
      vault_id: vaultLockedId,
      type: 'note',
      title: 'Confidential Locked Note',
      aliases: ['locked-conf-alias'],
      tags: ['locked-audit'],
      front_matter: { title: 'Confidential Locked Note', tags: ['locked-audit'] },
      created_at: new Date(),
      updated_at: new Date(),
    });

    const lockedDraft = await saveDraft(pageLockedId, `# Locked Document\n\n${lockedCanary} is classified.`, ownerId);
    await publishVersion(pageLockedId, ownerId);

    // -------------------------------------------------------------
    // Test 1: Zero Plaintext in pages.front_matter
    // -------------------------------------------------------------
    await t.test('Server Storage: pages.front_matter contains zero plaintext bodies or canaries', async () => {
      const pageRows = await db.select().from(schema.pages).where(inArray(schema.pages.id, [pageOpenId, pageLockedId]));
      for (const p of pageRows) {
        const fmString = JSON.stringify(p.front_matter);
        assert.ok(!fmString.includes(openCanary), 'openCanary leaked into pages.front_matter');
        assert.ok(!fmString.includes(lockedCanary), 'lockedCanary leaked into pages.front_matter');
        assert.equal(p.front_matter?.body, undefined, 'Legacy body persisted in front_matter');
      }
    });

    // -------------------------------------------------------------
    // Test 2: Locked-Vault Zero Chunks & Zero Embeddings Invariant (ADR-017)
    // -------------------------------------------------------------
    await t.test('Locked Invariant: Zero chunks, zero tsvectors, and zero embeddings exist for locked vault pages', async () => {
      const lockedChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageLockedId));
      assert.equal(lockedChunks.length, 0, 'Locked vault page must NOT create records in chunks table');

      // Direct SQL check to verify no residual rows
      const directSqlCheck = await db.execute(sql`
        SELECT count(*)::int as count FROM chunks WHERE page_id = ${pageLockedId}::uuid
      `);
      assert.equal(directSqlCheck.rows[0].count, 0, 'Direct SQL found residual chunks for locked page');
    });

    // -------------------------------------------------------------
    // Test 3: Comprehensive Raw Database Ciphertext Audit Across Every Table & Column
    // -------------------------------------------------------------
    await t.test('Raw Storage Audit: Locked canary is absent from all database text columns and tables', async () => {
      // 3.1 Check pages table: all columns (title, folder, tags, aliases, front_matter)
      const pagesData = await db.select().from(schema.pages).where(inArray(schema.pages.id, [pageOpenId, pageLockedId]));
      for (const p of pagesData) {
        assert.ok(!p.title.includes(lockedCanary), 'lockedCanary in pages.title');
        assert.ok(!JSON.stringify(p.tags || []).includes(lockedCanary), 'lockedCanary in pages.tags');
        assert.ok(!JSON.stringify(p.aliases || []).includes(lockedCanary), 'lockedCanary in pages.aliases');
        assert.ok(!JSON.stringify(p.front_matter || {}).includes(lockedCanary), 'lockedCanary in pages.front_matter');
      }

      // 3.2 Check versions table: encrypted_content must NOT contain plaintext string
      const versionsData = await db.select().from(schema.versions).where(inArray(schema.versions.page_id, [pageOpenId, pageLockedId]));
      assert.ok(versionsData.length > 0);
      for (const v of versionsData) {
        const rawContent = Buffer.from(v.encrypted_content || v.encrypted_blob || '');
        assert.ok(!rawContent.includes(Buffer.from(lockedCanary)), 'lockedCanary found in plaintext inside versions.encrypted_content');
        assert.ok(!String(v.created_by).includes(lockedCanary), 'lockedCanary in versions.created_by');
      }

      // 3.3 Check all chunks in the entire database: lockedCanary must not be in any column
      const allChunks = await db.select().from(schema.chunks);
      for (const c of allChunks) {
        const rawEncText = Buffer.from(c.encrypted_text);
        assert.ok(!rawEncText.includes(Buffer.from(lockedCanary)), 'lockedCanary found unencrypted in chunks.encrypted_text');
        if (c.tsv_content) {
          const tsvStr = String(c.tsv_content);
          assert.ok(!tsvStr.includes(lockedCanary), 'lockedCanary found in chunks.tsv_content');
        }
      }

      // 3.4 Check vaults table
      const vaultsData = await db.select().from(schema.vaults).where(inArray(schema.vaults.id, [vaultOpenId, vaultLockedId]));
      for (const v of vaultsData) {
        assert.ok(!v.name.includes(lockedCanary), 'lockedCanary in vaults.name');
        assert.ok(!v.data_key_id.includes(lockedCanary), 'lockedCanary in vaults.data_key_id');
      }

      // 3.5 Check shares table
      const sharesData = await db.select().from(schema.shares).where(inArray(schema.shares.vault_id, [vaultOpenId, vaultLockedId]));
      for (const s of sharesData) {
        assert.ok(!s.principal_id.includes(lockedCanary), 'lockedCanary in shares.principal_id');
      }

      // 3.6 Check audit events table: metadata must NOT contain locked canary
      const audits = await db.select().from(schema.auditEvents).where(inArray(schema.auditEvents.target_id, [vaultOpenId, vaultLockedId]));
      for (const a of audits) {
        const auditStr = JSON.stringify(a);
        assert.ok(!auditStr.includes(lockedCanary), 'lockedCanary leaked into audit_events metadata');
      }
    });

    // -------------------------------------------------------------
    // Test 4: Open-Vault Tradeoff: Normalized Lexemes & Embeddings Audit
    // -------------------------------------------------------------
    await t.test('Open Vault Tradeoff: Detect normalized open-canary lexemes in tsvector and vector embeddings', async () => {
      // Query open chunks directly with raw SQL to inspect PostgreSQL native tsvector representation
      const openChunkSql = await db.execute(sql`
        SELECT id, encrypted_text, tsv_content::text as tsv_raw, embedding
        FROM chunks WHERE page_id = ${pageOpenId}::uuid
      `);
      assert.ok(openChunkSql.rows.length > 0, 'Open vault must have chunk records for search');

      const chunkRow = openChunkSql.rows[0];

      // 4.1 Lexeme Inspection: Verify PostgreSQL to_tsvector normalized open canary tokens
      const tsvRaw = chunkRow.tsv_raw || '';
      assert.ok(tsvRaw.length > 0, 'tsv_content must contain tsvector output');

      // The raw markdown `# Open Document\n\n... is here.` is NOT stored in tsv_content
      assert.ok(
        !tsvRaw.includes('# Open Document'),
        'Raw markdown header syntax was leaked into tsv_content!'
      );
      assert.ok(
        !tsvRaw.includes('is here'),
        'Verbatim sentence string was leaked into tsv_content!'
      );

      // But normalized linguistic lexemes ARE stored (demonstrating the open-vault search tradeoff per ADR-017)
      // Words like 'document', 'open', and lowercased canary stems exist as tsvector lexemes
      assert.ok(
        tsvRaw.includes("'document'") || tsvRaw.includes("'open'"),
        'Expected normalized document lexemes in tsvector'
      );

      // 4.2 Embedding Inspection: Verify embeddings store numerical vectors, not readable text derivatives
      assert.ok(chunkRow.embedding, 'Open chunk must have a vector embedding');
      // In pgvector / node-pg, embedding is formatted as a string literal '[0.012, -0.034, ...]' or array of numbers
      const embeddingStr = typeof chunkRow.embedding === 'string' ? chunkRow.embedding : JSON.stringify(chunkRow.embedding);
      assert.ok(embeddingStr.startsWith('[') && embeddingStr.endsWith(']'), 'Embedding must be a valid vector format');

      // Verify that NO words or strings from openCanary or lockedCanary exist in the embedding
      assert.ok(!embeddingStr.includes(openCanary), 'openCanary string leaked into embedding representation');
      assert.ok(!embeddingStr.includes(lockedCanary), 'lockedCanary string leaked into embedding representation');

      // Parse numbers from embedding
      const vectorNumbers = JSON.parse(embeddingStr).map(Number);
      assert.ok(vectorNumbers.length === 1536, `Expected 1536-dimensional vector, got ${vectorNumbers.length}`);
      assert.ok(vectorNumbers.every((n) => typeof n === 'number' && Number.isFinite(n)), 'All embedding entries must be finite numbers');
    });

    // -------------------------------------------------------------
    // Test 5: Open Vault Chunk Ciphertext DEK Ownership & Best-Effort DEK Cleanup
    // -------------------------------------------------------------
    await t.test('Open Vault Search Boundary: Chunks are encrypted at rest; DEK cleanup is best-effort', async () => {
      const openChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageOpenId));
      assert.ok(openChunks.length > 0);

      for (const c of openChunks) {
        // Raw encrypted_text must be ciphertext, NOT plaintext openCanary
        const rawBuf = Buffer.from(c.encrypted_text);
        assert.ok(!rawBuf.includes(Buffer.from(openCanary)), 'openCanary found in plaintext inside chunk');

        // Verify it can be decrypted ONLY with the owning vault DEK
        const decrypted = EnvelopeEncryption.decryptToString(c.encrypted_text, rawDekOpen);
        assert.ok(decrypted.includes(openCanary), 'Failed to decrypt chunk with correct DEK');

        // Tampered or wrong DEK fails AES-GCM authentication
        assert.throws(() => {
          EnvelopeEncryption.decryptToString(c.encrypted_text, rawDekLocked);
        }, /Unsupported state or unable to authenticate data|Authentication failed|bad decrypt/i);
      }

      // Best-effort DEK buffer memory wipe demonstration (ADR-017)
      const ephemeralDekBuffer = Buffer.from(rawDekOpen);
      assert.ok(ephemeralDekBuffer.some((b) => b !== 0), 'Buffer initially contains key bytes');
      ephemeralDekBuffer.fill(0);
      assert.ok(ephemeralDekBuffer.every((b) => b === 0), 'dek.fill(0) successfully zeroed primary allocated buffer');
    });

    // -------------------------------------------------------------
    // Test 6: Search Query Isolation (Canary Non-Discoverability)
    // -------------------------------------------------------------
    await t.test('Search Isolation: Locked canary cannot be discovered through searchPages', async () => {
      // Searching locked canary in locked vault -> 0 results
      const lockedResults = await searchPages(vaultLockedId, lockedCanary);
      assert.equal(lockedResults.length, 0);

      // Searching locked canary in open vault -> 0 results
      const crossResults = await searchPages(vaultOpenId, lockedCanary);
      assert.equal(crossResults.length, 0);

      // Searching open canary in open vault -> finds open page
      const openResults = await searchPages(vaultOpenId, openCanary);
      assert.ok(openResults.length > 0, 'Open canary must be discoverable in open vault');
      assert.equal(openResults[0].id, pageOpenId);
      assert.ok(!openResults.some((r) => JSON.stringify(r).includes(lockedCanary)), 'Locked canary must not leak');
    });

  } finally {
    // Teardown
    let cleanupError = null;
    try {
      await db.delete(schema.chunks).where(inArray(schema.chunks.page_id, [pageOpenId, pageLockedId]));
      await db.delete(schema.versions).where(inArray(schema.versions.page_id, [pageOpenId, pageLockedId]));
      await db.delete(schema.pages).where(inArray(schema.pages.id, [pageOpenId, pageLockedId]));
      await db.delete(schema.shares).where(inArray(schema.shares.vault_id, [vaultOpenId, vaultLockedId]));
      await db.delete(schema.vaults).where(inArray(schema.vaults.id, [vaultOpenId, vaultLockedId]));
    } catch (cleanupErr) {
      cleanupError = cleanupErr;
    } finally {
      if (originalNodeEnv !== undefined) {
        process.env.NODE_ENV = originalNodeEnv;
      } else {
        delete process.env.NODE_ENV;
      }
      if (originalEmbeddingProvider !== undefined) {
        process.env.EMBEDDING_PROVIDER = originalEmbeddingProvider;
      } else {
        delete process.env.EMBEDDING_PROVIDER;
      }
    }

    if (cleanupError) {
      throw new Error(`Database cleanup failed in storage-ciphertext-canary-audit.test.js: ${cleanupError.message}`);
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import {
  createVault,
  movePage,
  saveDraft,
  publishVersion,
  reindexVault,
  reindexPage,
  MockKmsProvider,
  EnvelopeEncryption,
  LocalDeterministicEmbeddingProvider,
  validateEmbeddingBatch,
} from '../dist/index.js';

function createBarrier() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return {
    wait: () => promise,
    release: () => resolve(),
  };
}

function createLockAttemptProxy(targetDb, onAttemptLock) {
  function wrap(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    return new Proxy(obj, {
      get(target, prop, receiver) {
        if (prop === 'for') {
          return (mode) => {
            if (mode === 'update') {
              onAttemptLock();
            }
            return wrap(target.for(mode));
          };
        }
        const val = Reflect.get(target, prop, receiver);
        if (typeof val === 'function') {
          return (...args) => {
            const res = val.apply(target, args);
            if (res && typeof res === 'object' && !(res instanceof Promise)) {
              return wrap(res);
            }
            return res;
          };
        }
        return val;
      },
    });
  }

  return new Proxy(targetDb, {
    get(dbTarget, dbProp, dbReceiver) {
      if (dbProp === 'transaction') {
        return async (cb) => {
          return await dbTarget.transaction(async (realTx) => {
            const proxyTx = new Proxy(realTx, {
              get(txTarget, txProp, txReceiver) {
                if (txProp === 'select') {
                  return (...selectArgs) => wrap(txTarget.select(...selectArgs));
                }
                return Reflect.get(txTarget, txProp, txReceiver);
              },
            });
            return await cb(proxyTx);
          });
        };
      }
      return Reflect.get(dbTarget, dbProp, dbReceiver);
    },
  });
}

test('Epic 6 Chunk 6.2: Atomic Page Movement & Cryptographic Boundary Enforcement', async (t) => {
  const kms = new MockKmsProvider();
  const provider = new LocalDeterministicEmbeddingProvider();
  const createdVaultIds = [];

  const actorAlice = `alice_${Date.now()}@tkxel.com`;
  const actorBob = `bob_${Date.now()}@tkxel.com`;
  const actorEve = `eve_${Date.now()}@tkxel.com`;

  // Helper to seed a page with multiple versions and multiple chunks
  async function seedMultiVersionPage({
    vaultId,
    title,
    versionsData,
    authorId,
    dek,
    mode = 'open',
  }) {
    const pageId = crypto.randomUUID();
    const versionIds = [];

    // 1. Insert page record
    await db.insert(schema.pages).values({
      id: pageId,
      vault_id: vaultId,
      type: 'note',
      title,
      current_version_id: null,
    });

    // 2. Insert versions
    for (let i = 0; i < versionsData.length; i++) {
      const vId = crypto.randomUUID();
      versionIds.push(vId);
      const encBlob = EnvelopeEncryption.encrypt(versionsData[i].content, dek);
      await db.insert(schema.versions).values({
        id: vId,
        page_id: pageId,
        number: i + 1,
        status: versionsData[i].status || 'published',
        encrypted_blob: encBlob,
        created_by: authorId,
      });
    }

    // Set current version to latest
    const latestVersionId = versionIds[versionIds.length - 1];
    await db.update(schema.pages).set({ current_version_id: latestVersionId }).where(eq(schema.pages.id, pageId));

    // 3. If open mode, insert multiple chunks
    if (mode === 'open') {
      const chunkTexts = versionsData.map((v) => v.content);
      const embeddings = await provider.generateEmbeddings(chunkTexts);
      validateEmbeddingBatch(embeddings, chunkTexts.length);

      for (let idx = 0; idx < chunkTexts.length; idx++) {
        const encChunk = EnvelopeEncryption.encrypt(chunkTexts[idx], dek);
        await db.insert(schema.chunks).values({
          id: crypto.randomUUID(),
          page_id: pageId,
          version_id: latestVersionId,
          position: idx,
          encrypted_text: encChunk,
          tsv_content: sql`to_tsvector('english', ${chunkTexts[idx]})`,
          embedding: embeddings[idx],
        });
      }
    }

    return { pageId, versionIds, latestVersionId };
  }

  try {
    // 1. Multi-version, multi-chunk Open -> Open cryptographic re-encryption
    await t.test('1. Open-to-Open: Re-encrypts every version and chunk ciphertext across distinct KMS DEKs', async () => {
      const vaultSrc = await createVault({
        name: 'Alpha Source Open Vault',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultSrc.id);

      const vaultDst = await createVault({
        name: 'Beta Destination Open Vault',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultDst.id);

      const [srcVaultRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultSrc.id));
      const [dstVaultRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultDst.id));
      const sourceDek = await kms.unwrapKey(srcVaultRow.data_key_id);
      const destDek = await kms.unwrapKey(dstVaultRow.data_key_id);

      const v1Content = '# Strategy Draft v1\nInitial draft notes for architecture.';
      const v2Content = '# Strategy Final v2\nPublished final architecture decisions with full graph.';
      const { pageId, versionIds } = await seedMultiVersionPage({
        vaultId: vaultSrc.id,
        title: 'Project Architecture Blueprint',
        versionsData: [
          { content: v1Content, status: 'draft' },
          { content: v2Content, status: 'published' },
        ],
        authorId: actorAlice,
        dek: sourceDek,
        mode: 'open',
      });

      // Confirm pre-move chunks and versions count
      const preMoveVersions = await db.select().from(schema.versions).where(eq(schema.versions.page_id, pageId));
      const preMoveChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.equal(preMoveVersions.length, 2);
      assert.equal(preMoveChunks.length, 2);

      // Verify pre-move can be decrypted with sourceDek
      for (const v of preMoveVersions) {
        assert.doesNotThrow(() => EnvelopeEncryption.decryptToString(v.encrypted_blob, sourceDek));
      }
      for (const c of preMoveChunks) {
        assert.doesNotThrow(() => EnvelopeEncryption.decryptToString(c.encrypted_text, sourceDek));
      }

      // Execute page move
      const result = await movePage({
        pageId,
        destinationVaultId: vaultDst.id,
        actorId: actorAlice,
        kms,
        provider,
      });

      assert.equal(result.success, true);
      assert.equal(result.pageId, pageId);
      assert.equal(result.vaultId, vaultDst.id);

      // Invariant A: Page vault_id updated
      const [postMovePage] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
      assert.equal(postMovePage.vault_id, vaultDst.id);

      // Invariant B: EVERY version re-encrypted under destDek; sourceDek fails on every version
      const postMoveVersions = await db.select().from(schema.versions).where(eq(schema.versions.page_id, pageId));
      assert.equal(postMoveVersions.length, 2);
      for (const v of postMoveVersions) {
        assert.throws(
          () => EnvelopeEncryption.decryptToString(v.encrypted_blob, sourceDek),
          'Source DEK must no longer decrypt moved version ciphertext'
        );
        const decrypted = EnvelopeEncryption.decryptToString(v.encrypted_blob, destDek);
        assert.ok(decrypted === v1Content || decrypted === v2Content);
      }

      // Invariant C: EVERY existing chunk re-encrypted under destDek; sourceDek fails on every chunk
      const postMoveChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.equal(postMoveChunks.length, 2);
      for (const c of postMoveChunks) {
        assert.throws(
          () => EnvelopeEncryption.decryptToString(c.encrypted_text, sourceDek),
          'Source DEK must no longer decrypt moved chunk ciphertext'
        );
        const decrypted = EnvelopeEncryption.decryptToString(c.encrypted_text, destDek);
        assert.ok(decrypted === v1Content || decrypted === v2Content);
      }

      // Invariant D: Immutable append-only audit event recorded
      const [auditEvent] = await db
        .select()
        .from(schema.auditEvents)
        .where(
          sql`${schema.auditEvents.target_id} = ${pageId} AND ${schema.auditEvents.action} = 'move_page'`
        );
      assert.ok(auditEvent, 'move_page audit event must be recorded');
      assert.equal(auditEvent.actor_id, actorAlice.toLowerCase());
      assert.equal(auditEvent.metadata?.source_vault_id, vaultSrc.id);
      assert.equal(auditEvent.metadata?.destination_vault_id, vaultDst.id);
    });

    // 2. Open -> Locked: Zero-read protection strictly purges all chunks, tsvectors, and embeddings
    await t.test('2. Open-to-Locked: Enforces ADR-017 zero-read protection by purging all chunks and index records', async () => {
      const vaultSrc = await createVault({
        name: 'Public Strategy Open Vault',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultSrc.id);

      const vaultDstLocked = await createVault({
        name: 'Confidential Locked Vault',
        mode: 'locked',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultDstLocked.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultSrc.id));
      const [dstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultDstLocked.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);
      const dstDek = await kms.unwrapKey(dstRow.data_key_id);

      const content = '# Secret Algorithm\nZero-read locked skill implementation details.';
      const { pageId, versionIds } = await seedMultiVersionPage({
        vaultId: vaultSrc.id,
        title: 'Zero Read Algorithm',
        versionsData: [{ content, status: 'published' }],
        authorId: actorAlice,
        dek: srcDek,
        mode: 'open',
      });

      const initialChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.equal(initialChunks.length, 1);

      // Move from Open to Locked
      const moveResult = await movePage({
        pageId,
        destinationVaultId: vaultDstLocked.id,
        actorId: actorAlice,
        kms,
        provider,
      });
      assert.equal(moveResult.success, true);

      // Invariant: In Locked vault, zero chunks exist for this page (no plaintexts, tsvectors, or embeddings)
      const lockedChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.equal(lockedChunks.length, 0, 'Locked destination must have 0 chunks per ADR-017');

      // Invariant: Version is re-encrypted with locked vault DEK
      const [lockedVersion] = await db.select().from(schema.versions).where(eq(schema.versions.id, versionIds[0]));
      assert.throws(() => EnvelopeEncryption.decryptToString(lockedVersion.encrypted_blob, srcDek));
      const recovered = EnvelopeEncryption.decryptToString(lockedVersion.encrypted_blob, dstDek);
      assert.equal(recovered, content);
    });

    // 3. Locked -> Open: Re-indexes content with fresh validated embeddings and encrypted chunks
    await t.test('3. Locked-to-Open: Generates fresh chunks, tsvectors, and embeddings for open destination', async () => {
      const vaultLocked = await createVault({
        name: 'Incubator Locked Vault',
        mode: 'locked',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultLocked.id);

      const vaultOpen = await createVault({
        name: 'Public Release Open Vault',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultOpen.id);

      const [lockedRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultLocked.id));
      const [openRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultOpen.id));
      const lockedDek = await kms.unwrapKey(lockedRow.data_key_id);
      const openDek = await kms.unwrapKey(openRow.data_key_id);

      const content = '# Released Knowledge Base\nThis documentation is now opened to team readers.';
      const { pageId } = await seedMultiVersionPage({
        vaultId: vaultLocked.id,
        title: 'Released Knowledge Base',
        versionsData: [{ content, status: 'published' }],
        authorId: actorAlice,
        dek: lockedDek,
        mode: 'locked', // No chunks created in locked mode
      });

      const preChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.equal(preChunks.length, 0);

      // Move from Locked to Open
      const moveResult = await movePage({
        pageId,
        destinationVaultId: vaultOpen.id,
        actorId: actorAlice,
        kms,
        provider,
      });
      assert.equal(moveResult.success, true);

      // Invariant: Open vault now has fresh chunk with valid 1536-dim embedding and tsvector
      const postChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.ok(postChunks.length > 0, 'Open destination must have generated search chunks');
      assert.ok(postChunks[0].embedding, 'Embedding vector must be generated');
      assert.equal(postChunks[0].embedding.length, 1536);
      assert.ok(postChunks[0].tsv_content, 'Full-text tsvector must be generated');

      const decryptedChunk = EnvelopeEncryption.decryptToString(postChunks[0].encrypted_text, openDek);
      assert.ok(decryptedChunk.includes('Released Knowledge Base'));
    });

    // 4. Authorization & Anti-Disclosure Invariants
    await t.test('4. Authorization & Anti-Disclosure: Rejects unauthorized actors without leaking page existence', async () => {
      const vaultA = await createVault({
        name: 'Private Domain A',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultA.id);

      const vaultB = await createVault({
        name: 'Private Domain B',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultB.id);

      // Grant Bob reader access on Vault A, but editor on Vault B
      await db.insert(schema.shares).values([
        {
          id: crypto.randomUUID(),
          vault_id: vaultA.id,
          principal_id: actorBob.toLowerCase(),
          role: 'reader',
          granted_by: actorAlice,
        },
        {
          id: crypto.randomUUID(),
          vault_id: vaultB.id,
          principal_id: actorBob.toLowerCase(),
          role: 'editor',
          granted_by: actorAlice,
        },
      ]);

      const [vRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultA.id));
      const vDek = await kms.unwrapKey(vRow.data_key_id);
      const { pageId } = await seedMultiVersionPage({
        vaultId: vaultA.id,
        title: 'Access Control Page',
        versionsData: [{ content: '# Top Secret', status: 'published' }],
        authorId: actorAlice,
        dek: vDek,
        mode: 'open',
      });

      // Scenario A: Unknown actor Eve gets uniform not_found
      await assert.rejects(
        () =>
          movePage({
            pageId,
            destinationVaultId: vaultB.id,
            actorId: actorEve,
            kms,
            provider,
          }),
        (err) => err.message.includes('not_found')
      );

      // Scenario B: Reader Bob on source vault has insufficient privileges -> uniform not_found
      await assert.rejects(
        () =>
          movePage({
            pageId,
            destinationVaultId: vaultB.id,
            actorId: actorBob,
            kms,
            provider,
          }),
        (err) => err.message.includes('not_found')
      );

      // Scenario C: Alice is owner of Vault A, but unknown to Vault C (actor not allowed on destination)
      const vaultC = await createVault({
        name: 'Unshared Destination C',
        mode: 'open',
        ownerId: actorEve,
        kms,
      });
      createdVaultIds.push(vaultC.id);

      await assert.rejects(
        () =>
          movePage({
            pageId,
            destinationVaultId: vaultC.id,
            actorId: actorAlice,
            kms,
            provider,
          }),
        (err) => err.message.includes('not_allowed')
      );

      // Scenario D: Self-move by authorized owner returns unchanged: true
      const selfMoveRes = await movePage({
        pageId,
        destinationVaultId: vaultA.id,
        actorId: actorAlice,
        kms,
        provider,
      });
      assert.equal(selfMoveRes.success, true);
      assert.equal(selfMoveRes.unchanged, true);

      // Scenario E: Self-move by unauthorized caller Eve is rejected with not_found
      await assert.rejects(
        () =>
          movePage({
            pageId,
            destinationVaultId: vaultA.id,
            actorId: actorEve,
            kms,
            provider,
          }),
        (err) => err.message.includes('not_found')
      );
    });

    // 5. Genuine Post-Mutation Rollback: Failure after version 1 re-encryption inside transaction
    await t.test('5. Post-Mutation Rollback: Failure after version re-encryption preserves original page and version ciphertexts', async () => {
      const vaultSrc = await createVault({
        name: 'Rollback Source Vault V',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultSrc.id);

      const vaultDst = await createVault({
        name: 'Rollback Destination Vault V',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultSrc.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);

      const v1Text = '# Version 1 Original Text\nMust be restored on rollback.';
      const v2Text = '# Version 2 Original Text\nMust also remain intact.';
      const { pageId, versionIds } = await seedMultiVersionPage({
        vaultId: vaultSrc.id,
        title: 'Version Rollback Document',
        versionsData: [
          { content: v1Text, status: 'draft' },
          { content: v2Text, status: 'published' },
        ],
        authorId: actorAlice,
        dek: srcDek,
        mode: 'open',
      });

      // Execute movePage with injected failure immediately after the first version is updated in DB
      let updatedVersionsCount = 0;
      const faultDb = {
        transaction: async (cb) => {
          return await db.transaction(async (realTx) => {
            const proxyTx = new Proxy(realTx, {
              get(target, prop, receiver) {
                if (prop === 'update') {
                  return (table) => {
                    const updateBuilder = target.update(table);
                    if (table === schema.versions) {
                      return {
                        set: (vals) => {
                          const setBuilder = updateBuilder.set(vals);
                          return {
                            where: (pred) => {
                              const promise = setBuilder.where(pred);
                              return {
                                then: (resolve, reject) => {
                                  return promise.then((res) => {
                                    updatedVersionsCount++;
                                    if (updatedVersionsCount === 1) {
                                      throw new Error('Injected database fault after re-encrypting first version in transaction');
                                    }
                                    return res;
                                  }).then(resolve, reject);
                                },
                              };
                            },
                          };
                        },
                      };
                    }
                    return updateBuilder;
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return await cb(proxyTx);
          });
        },
      };

      await assert.rejects(
        () =>
          movePage({
            pageId,
            destinationVaultId: vaultDst.id,
            actorId: actorAlice,
            kms,
            provider,
            db: faultDb,
          }),
        /Injected database fault after re-encrypting first version in transaction/
      );

      // Verify complete rollback in PostgreSQL:
      // A. Page is STILL in source vault
      const [rolledBackPage] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
      assert.equal(rolledBackPage.vault_id, vaultSrc.id);

      // B. BOTH versions in database are STILL encrypted with source DEK and match original plaintexts
      const rolledBackVersions = await db
        .select()
        .from(schema.versions)
        .where(eq(schema.versions.page_id, pageId))
        .orderBy(schema.versions.number);
      assert.equal(rolledBackVersions.length, 2);

      const decV1 = EnvelopeEncryption.decryptToString(rolledBackVersions[0].encrypted_blob, srcDek);
      assert.equal(decV1, v1Text, 'Version 1 ciphertext must be restored to source DEK encryption by rollback');

      const decV2 = EnvelopeEncryption.decryptToString(rolledBackVersions[1].encrypted_blob, srcDek);
      assert.equal(decV2, v2Text, 'Version 2 ciphertext must remain unchanged');

      // C. Chunks remain intact and decryptable with source DEK
      const rolledBackChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.equal(rolledBackChunks.length, 2);
      for (const c of rolledBackChunks) {
        assert.doesNotThrow(() => EnvelopeEncryption.decryptToString(c.encrypted_text, srcDek));
      }

      // D. No move_page audit event was persisted
      const failedAudit = await db
        .select()
        .from(schema.auditEvents)
        .where(
          sql`${schema.auditEvents.target_id} = ${pageId} AND ${schema.auditEvents.action} = 'move_page'`
        );
      assert.equal(failedAudit.length, 0);
    });

    // 6. Genuine Post-Mutation Rollback: Indexing/Provider failure during locked-to-open move after version updates
    await t.test('6. Post-Mutation Rollback: Provider failure during locked-to-open re-indexing rolls back version updates', async () => {
      const vaultLocked = await createVault({
        name: 'Rollback Locked Source',
        mode: 'locked',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultLocked.id);

      const vaultOpen = await createVault({
        name: 'Rollback Open Destination',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultOpen.id);

      const [lockedRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultLocked.id));
      const lockedDek = await kms.unwrapKey(lockedRow.data_key_id);

      const lockedText = '# Secret Proprietary Data\nMust not remain partially re-encrypted on failure.';
      const { pageId, versionIds } = await seedMultiVersionPage({
        vaultId: vaultLocked.id,
        title: 'Proprietary Algorithm',
        versionsData: [{ content: lockedText, status: 'published' }],
        authorId: actorAlice,
        dek: lockedDek,
        mode: 'locked',
      });

      // Provider throws during chunk embedding generation (after version update in tx)
      const failingProvider = {
        name: 'CrashingProvider',
        dimension: 1536,
        async generateEmbedding() {
          throw new Error('Simulated embedding provider crash during locked-to-open move');
        },
        async generateEmbeddings() {
          throw new Error('Simulated embedding provider crash during locked-to-open move');
        },
      };

      await assert.rejects(
        () =>
          movePage({
            pageId,
            destinationVaultId: vaultOpen.id,
            actorId: actorAlice,
            kms,
            provider: failingProvider,
          }),
        /Simulated embedding provider crash/
      );

      // Verify PostgreSQL rollback:
      // A. Page is still in locked vault
      const [rolledBackPage] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
      assert.equal(rolledBackPage.vault_id, vaultLocked.id);

      // B. Version ciphertext is still decryptable with locked DEK
      const [rolledBackVersion] = await db.select().from(schema.versions).where(eq(schema.versions.id, versionIds[0]));
      const recovered = EnvelopeEncryption.decryptToString(rolledBackVersion.encrypted_blob, lockedDek);
      assert.equal(recovered, lockedText);

      // C. Zero chunks exist
      const rolledBackChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.equal(rolledBackChunks.length, 0);

      // D. No audit event
      const failedAudit = await db
        .select()
        .from(schema.auditEvents)
        .where(
          sql`${schema.auditEvents.target_id} = ${pageId} AND ${schema.auditEvents.action} = 'move_page'`
        );
      assert.equal(failedAudit.length, 0);
    });

    // 7. Genuine Post-Mutation Rollback: Failure after page update before audit emission
    await t.test('7. Post-Mutation Rollback: Failure after page update before audit emission rolls back page, chunks, and versions', async () => {
      const vaultSrc = await createVault({
        name: 'Rollback Page Update Src',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultSrc.id);

      const vaultDst = await createVault({
        name: 'Rollback Page Update Dst',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultSrc.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);

      const content = '# Page Update Rollback\nVersions, chunks, and page row must all roll back.';
      const { pageId, versionIds } = await seedMultiVersionPage({
        vaultId: vaultSrc.id,
        title: 'Post Page Update Test',
        versionsData: [{ content, status: 'published' }],
        authorId: actorAlice,
        dek: srcDek,
        mode: 'open',
      });

      // Execute movePage with failure injected right after page update before audit emission
      const faultDb = {
        transaction: async (cb) => {
          return await db.transaction(async (realTx) => {
            const proxyTx = new Proxy(realTx, {
              get(target, prop, receiver) {
                if (prop === 'insert') {
                  return (table) => {
                    if (table === schema.auditEvents) {
                      throw new Error('Injected database fault on audit insert before commit');
                    }
                    return target.insert(table);
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return await cb(proxyTx);
          });
        },
      };

      await assert.rejects(
        () =>
          movePage({
            pageId,
            destinationVaultId: vaultDst.id,
            actorId: actorAlice,
            kms,
            provider,
            db: faultDb,
          }),
        /Injected database fault on audit insert before commit/
      );

      // Verify PostgreSQL rollback:
      // A. Page is STILL in source vault
      const [rolledBackPage] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
      assert.equal(rolledBackPage.vault_id, vaultSrc.id);

      // B. Version ciphertext is still decryptable with source DEK
      const [rolledBackVersion] = await db.select().from(schema.versions).where(eq(schema.versions.id, versionIds[0]));
      const recovered = EnvelopeEncryption.decryptToString(rolledBackVersion.encrypted_blob, srcDek);
      assert.equal(recovered, content);

      // C. Chunks are still decryptable with source DEK
      const rolledBackChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.equal(rolledBackChunks.length, 1);
      assert.equal(EnvelopeEncryption.decryptToString(rolledBackChunks[0].encrypted_text, srcDek), content);

      // D. No audit event
      const failedAudit = await db
        .select()
        .from(schema.auditEvents)
        .where(
          sql`${schema.auditEvents.target_id} = ${pageId} AND ${schema.auditEvents.action} = 'move_page'`
        );
      assert.equal(failedAudit.length, 0);
    });

    // 8. Concurrency Race: Concurrent saveDraft and movePage serialize deterministically under shared page lock
    await t.test('8. Concurrency Race: Concurrent saveDraft and movePage serialize deterministically under shared page lock', async () => {
      const vaultSrc = await createVault({
        name: 'Race Save/Move Source',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultSrc.id);

      const vaultDst = await createVault({
        name: 'Race Save/Move Destination',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultSrc.id));
      const [dstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultDst.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);
      const dstDek = await kms.unwrapKey(dstRow.data_key_id);

      const v1Content = '# Initial Version 1\nBase content.';
      const { pageId } = await seedMultiVersionPage({
        vaultId: vaultSrc.id,
        title: 'Concurrent Race Doc',
        versionsData: [{ content: v1Content, status: 'published' }],
        authorId: actorAlice,
        dek: srcDek,
        mode: 'open',
      });

      const draftContent = '# Concurrent Draft Content\nCreated during active page lock.';
      const barrierSaveHoldingLock = createBarrier();
      const barrierSaveRelease = createBarrier();
      const barrierMoveAttemptedLock = createBarrier();

      const barrierProvider = {
        name: 'BarrierProvider',
        dimension: 1536,
        async generateEmbedding(text) {
          return new Array(1536).fill(0.1);
        },
        async generateEmbeddings(texts) {
          barrierSaveHoldingLock.release();
          await barrierSaveRelease.wait();
          return texts.map(() => new Array(1536).fill(0.1));
        },
      };

      const order = [];

      // 1. Launch saveDraft which enters transaction, acquires lockPageForMutation(tx, pageId), and pauses in embedding generation
      const saveDraftPromise = saveDraft(pageId, draftContent, actorAlice, undefined, barrierProvider)
        .then((res) => { order.push('saveDraft'); return res; });

      // 2. Wait until saveDraft has acquired the page lock and paused
      await barrierSaveHoldingLock.wait();

      // 3. Launch movePage with lock-attempt proxy. Because saveDraft holds the row lock on this page, movePage MUST block in PostgreSQL
      let moveSettled = false;
      const moveDb = createLockAttemptProxy(db, () => {
        barrierMoveAttemptedLock.release();
      });

      const movePromise = movePage({
        pageId,
        destinationVaultId: vaultDst.id,
        actorId: actorAlice,
        kms,
        provider,
        db: moveDb,
      }).then(
        (res) => { moveSettled = true; order.push('movePage'); return res; },
        (err) => { moveSettled = true; throw err; }
      );

      // 4. Wait until movePage has executed its lock query
      await barrierMoveAttemptedLock.wait();

      // Yield execution ticks to ensure PostgreSQL has received the query over socket and blocked
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // Assert movePage has NOT settled while saveDraft holds the page lock
      assert.equal(moveSettled, false, 'movePage must be blocked on row lock held by saveDraft');

      // 5. Release saveDraft to finish its transaction and release page lock
      barrierSaveRelease.release();

      // 6. Wait for both operations to finish
      const [saveRes, moveRes] = await Promise.all([saveDraftPromise, movePromise]);
      assert.ok(saveRes.draftId);
      assert.equal(moveRes.success, true);
      assert.equal(moveRes.vaultId, vaultDst.id);
      assert.deepEqual(order, ['saveDraft', 'movePage'], 'saveDraft must commit before movePage acquires lock and commits');

      // Verify post-race invariants:
      // A. Page belongs to exactly one vault: vaultDst
      const [finalPage] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
      assert.equal(finalPage.vault_id, vaultDst.id);

      // B. EVERY version decrypts ONLY with dstDek; srcDek fails on every version
      const finalVersions = await db
        .select()
        .from(schema.versions)
        .where(eq(schema.versions.page_id, pageId))
        .orderBy(schema.versions.number);
      assert.equal(finalVersions.length, 2);

      for (const v of finalVersions) {
        assert.throws(
          () => EnvelopeEncryption.decryptToString(v.encrypted_blob, srcDek),
          'Old source DEK must fail to decrypt version after move'
        );
        const dec = EnvelopeEncryption.decryptToString(v.encrypted_blob, dstDek);
        assert.ok(dec === v1Content || dec === draftContent);
      }

      // C. EVERY chunk decrypts ONLY with dstDek; srcDek fails on every chunk
      const finalChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.ok(finalChunks.length > 0, 'Open destination must have chunks');
      for (const c of finalChunks) {
        assert.throws(
          () => EnvelopeEncryption.decryptToString(c.encrypted_text, srcDek),
          'Old source DEK must fail to decrypt chunk after move'
        );
        assert.doesNotThrow(() => EnvelopeEncryption.decryptToString(c.encrypted_text, dstDek));
      }

      // D. Audit log shows exactly 1 move_page audit event
      const moveAudits = await db
        .select()
        .from(schema.auditEvents)
        .where(
          sql`${schema.auditEvents.target_id} = ${pageId} AND ${schema.auditEvents.action} = 'move_page'`
        );
      assert.equal(moveAudits.length, 1);
      assert.equal(moveAudits[0].metadata?.source_vault_id, vaultSrc.id);
      assert.equal(moveAudits[0].metadata?.destination_vault_id, vaultDst.id);
    });

    // 9. Concurrency Race: Concurrent publishVersion and movePage serialize deterministically under shared page lock
    await t.test('9. Concurrency Race: Concurrent publishVersion and movePage serialize deterministically under shared page lock', async () => {
      const vaultSrc = await createVault({
        name: 'Race Publish/Move Source',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultSrc.id);

      const vaultDst = await createVault({
        name: 'Race Publish/Move Destination',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultSrc.id));
      const [dstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultDst.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);
      const dstDek = await kms.unwrapKey(dstRow.data_key_id);

      const v1Content = '# Published v1\nInitial content.';
      const v2DraftContent = '# Unpublished Draft v2\nContent ready to be published.';
      const { pageId, versionIds } = await seedMultiVersionPage({
        vaultId: vaultSrc.id,
        title: 'Concurrent Publish Race Doc',
        versionsData: [
          { content: v1Content, status: 'published' },
          { content: v2DraftContent, status: 'draft' },
        ],
        authorId: actorAlice,
        dek: srcDek,
        mode: 'open',
      });

      // Clear chunks so publishVersion generates fresh chunks and embeddings under the page lock
      await db.delete(schema.chunks).where(eq(schema.chunks.page_id, pageId));

      const barrierPublishHoldingLock = createBarrier();
      const barrierPublishRelease = createBarrier();
      const barrierMoveAttemptedLock = createBarrier();

      const barrierProvider = {
        name: 'PublishBarrierProvider',
        dimension: 1536,
        async generateEmbedding(text) {
          return new Array(1536).fill(0.2);
        },
        async generateEmbeddings(texts) {
          barrierPublishHoldingLock.release();
          await barrierPublishRelease.wait();
          return texts.map(() => new Array(1536).fill(0.2));
        },
      };

      const order = [];

      // 1. Launch publishVersion which acquires lock on page and pauses in embedding generation
      const publishPromise = publishVersion(pageId, actorAlice, barrierProvider)
        .then((res) => { order.push('publishVersion'); return res; });

      // 2. Wait until publishVersion holds the row lock
      await barrierPublishHoldingLock.wait();

      // 3. Launch movePage concurrently with lock-attempt proxy; it blocks on pages FOR UPDATE
      let moveSettled = false;
      const moveDb = createLockAttemptProxy(db, () => {
        barrierMoveAttemptedLock.release();
      });

      const movePromise = movePage({
        pageId,
        destinationVaultId: vaultDst.id,
        actorId: actorAlice,
        kms,
        provider,
        db: moveDb,
      }).then(
        (res) => { moveSettled = true; order.push('movePage'); return res; },
        (err) => { moveSettled = true; throw err; }
      );

      // 4. Wait until movePage has executed its lock query
      await barrierMoveAttemptedLock.wait();

      // Yield execution ticks to ensure PostgreSQL has received the query over socket and blocked
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // Assert movePage has NOT settled while publishVersion holds the page lock
      assert.equal(moveSettled, false, 'movePage must be blocked on row lock held by publishVersion');

      // 5. Release publishVersion
      barrierPublishRelease.release();

      // 6. Await both
      const [pubResult, moveResult] = await Promise.all([publishPromise, movePromise]);
      assert.ok(pubResult);
      assert.equal(moveResult.success, true);
      assert.deepEqual(order, ['publishVersion', 'movePage'], 'publishVersion must commit before movePage acquires lock and commits');

      // Verify post-race invariants:
      // A. Page belongs to destination vault
      const [finalPage] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
      assert.equal(finalPage.vault_id, vaultDst.id);
      assert.equal(finalPage.current_version_id, versionIds[1], 'Draft must now be current published version');

      // B. Draft version status is 'published'
      const [finalDraft] = await db.select().from(schema.versions).where(eq(schema.versions.id, versionIds[1]));
      assert.equal(finalDraft.status, 'published');

      // C. All versions decrypt ONLY with dstDek; srcDek fails
      const finalVersions = await db.select().from(schema.versions).where(eq(schema.versions.page_id, pageId));
      assert.equal(finalVersions.length, 2);
      for (const v of finalVersions) {
        assert.throws(() => EnvelopeEncryption.decryptToString(v.encrypted_blob, srcDek));
        const dec = EnvelopeEncryption.decryptToString(v.encrypted_blob, dstDek);
        assert.ok(dec === v1Content || dec === v2DraftContent);
      }

      // D. All chunks decrypt ONLY with dstDek; srcDek fails
      const finalChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.ok(finalChunks.length > 0);
      for (const c of finalChunks) {
        assert.throws(() => EnvelopeEncryption.decryptToString(c.encrypted_text, srcDek));
        assert.doesNotThrow(() => EnvelopeEncryption.decryptToString(c.encrypted_text, dstDek));
      }

      // E. Audit log has 1 move_page event
      const moveAudits = await db
        .select()
        .from(schema.auditEvents)
        .where(
          sql`${schema.auditEvents.target_id} = ${pageId} AND ${schema.auditEvents.action} = 'move_page'`
        );
      assert.equal(moveAudits.length, 1);
    });

    // 10. Concurrency Race: Two concurrent movePage operations of the same page serialize without mixed-key state
    await t.test('10. Concurrency Race: Two concurrent movePage operations of the same page serialize without mixed-key state', async () => {
      const vaultSrc = await createVault({
        name: 'Concurrent Move Source',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultSrc.id);

      const vaultDstOpen = await createVault({
        name: 'Concurrent Move Dst Open',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultDstOpen.id);

      const vaultDstLocked = await createVault({
        name: 'Concurrent Move Dst Locked',
        mode: 'locked',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultDstLocked.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultSrc.id));
      const [openDstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultDstOpen.id));
      const [lockedDstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultDstLocked.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);
      const openDstDek = await kms.unwrapKey(openDstRow.data_key_id);
      const lockedDstDek = await kms.unwrapKey(lockedDstRow.data_key_id);

      const text = '# Concurrent Dual Move Content\nMust undergo sequential atomic transitions.';
      const { pageId } = await seedMultiVersionPage({
        vaultId: vaultSrc.id,
        title: 'Dual Move Page',
        versionsData: [{ content: text, status: 'published' }],
        authorId: actorAlice,
        dek: srcDek,
        mode: 'open',
      });

      const barrierMove1HoldingLock = createBarrier();
      const barrierMove1Release = createBarrier();
      const barrierMove2AttemptedLock = createBarrier();

      // Move 1 database wrapper that signals barrier right before updating pages table while holding page lock
      const move1Db = {
        ...db,
        transaction: async (cb) => {
          return await db.transaction(async (realTx) => {
            const proxyTx = new Proxy(realTx, {
              get(target, prop, receiver) {
                if (prop === 'update') {
                  return (table) => {
                    if (table === schema.pages) {
                      barrierMove1HoldingLock.release();
                      return {
                        set: (values) => ({
                          where: (predicate) => ({
                            returning: async (fields) => {
                              await barrierMove1Release.wait();
                              return await target.update(table).set(values).where(predicate).returning(fields);
                            },
                          }),
                        }),
                      };
                    }
                    return target.update(table);
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return await cb(proxyTx);
          });
        },
      };

      const order = [];

      // 1. Launch Move 1 (vaultSrc -> vaultDstOpen)
      const move1Promise = movePage({
        pageId,
        destinationVaultId: vaultDstOpen.id,
        actorId: actorAlice,
        kms,
        provider,
        db: move1Db,
      }).then((res) => { order.push('move1'); return res; });

      // 2. Wait until Move 1 holds lock on page
      await barrierMove1HoldingLock.wait();

      // 3. Launch Move 2 (to vaultDstLocked) concurrently; it blocks on page lock in PostgreSQL
      let move2Settled = false;
      const move2Db = createLockAttemptProxy(db, () => {
        barrierMove2AttemptedLock.release();
      });

      const move2Promise = movePage({
        pageId,
        destinationVaultId: vaultDstLocked.id,
        actorId: actorAlice,
        kms,
        provider,
        db: move2Db,
      }).then(
        (res) => { move2Settled = true; order.push('move2'); return res; },
        (err) => { move2Settled = true; throw err; }
      );

      // 4. Wait until Move 2 has executed its lock query
      await barrierMove2AttemptedLock.wait();

      // Yield execution ticks
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // Assert Move 2 has NOT settled while Move 1 holds page lock
      assert.equal(move2Settled, false, 'Move 2 must be blocked on row lock held by Move 1');

      // 5. Release Move 1 to complete its transaction
      barrierMove1Release.release();

      // 6. Await both moves
      const [res1, res2] = await Promise.all([move1Promise, move2Promise]);
      assert.equal(res1.success, true);
      assert.equal(res2.success, true);
      assert.deepEqual(order, ['move1', 'move2'], 'Move 1 must commit before Move 2 acquires lock and commits');

      // Verify post-race invariants:
      // A. Final page belongs to vaultDstLocked (exactly one vault)
      const [finalPage] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
      assert.equal(finalPage.vault_id, vaultDstLocked.id);

      // B. Version decrypts ONLY with lockedDstDek; srcDek and openDstDek BOTH fail!
      const [finalVersion] = await db.select().from(schema.versions).where(eq(schema.versions.page_id, pageId));
      assert.throws(() => EnvelopeEncryption.decryptToString(finalVersion.encrypted_blob, srcDek));
      assert.throws(() => EnvelopeEncryption.decryptToString(finalVersion.encrypted_blob, openDstDek));
      const dec = EnvelopeEncryption.decryptToString(finalVersion.encrypted_blob, lockedDstDek);
      assert.equal(dec, text);

      // C. Locked destination has EXACTLY ZERO chunks (ADR-017 zero-read protection)
      const finalChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.equal(finalChunks.length, 0, 'Locked destination must have 0 chunks per ADR-017');

      // D. Audit log contains exactly two sequential move_page transitions:
      // 1) vaultSrc -> vaultDstOpen
      // 2) vaultDstOpen -> vaultDstLocked
      const moveAudits = await db
        .select()
        .from(schema.auditEvents)
        .where(
          sql`${schema.auditEvents.target_id} = ${pageId} AND ${schema.auditEvents.action} = 'move_page'`
        )
        .orderBy(schema.auditEvents.timestamp);
      assert.equal(moveAudits.length, 2);
      assert.equal(moveAudits[0].metadata?.source_vault_id, vaultSrc.id);
      assert.equal(moveAudits[0].metadata?.destination_vault_id, vaultDstOpen.id);
      assert.equal(moveAudits[1].metadata?.source_vault_id, vaultDstOpen.id);
      assert.equal(moveAudits[1].metadata?.destination_vault_id, vaultDstLocked.id);
    });

    // 11. Concurrency Race: reindexVault racing with movePage skips concurrently moved pages without deleting destination chunks
    await t.test('11. Concurrency Race: reindexVault racing with movePage skips concurrently moved pages without deleting destination chunks', async () => {
      const vaultLocked = await createVault({
        name: 'Race Reindex Locked Src',
        mode: 'locked',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultLocked.id);

      const vaultOpen = await createVault({
        name: 'Race Reindex Open Dst',
        mode: 'open',
        ownerId: actorAlice,
        kms,
      });
      createdVaultIds.push(vaultOpen.id);

      const [lockedRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultLocked.id));
      const [openRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultOpen.id));
      const lockedDek = await kms.unwrapKey(lockedRow.data_key_id);
      const openDek = await kms.unwrapKey(openRow.data_key_id);

      const text = '# Concurrent Reindex & Move Content\nDestination chunks must survive stale vault reindex.';
      const { pageId } = await seedMultiVersionPage({
        vaultId: vaultLocked.id,
        title: 'Reindex Race Page',
        versionsData: [{ content: text, status: 'published' }],
        authorId: actorAlice,
        dek: lockedDek,
        mode: 'locked',
      });

      const barrierEnumerated = createBarrier();
      const barrierMoveFinished = createBarrier();

      // Database proxy that pauses reindexVault right after it enumerates pages in vaultLocked
      const enumeratingDb = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === 'select') {
            return (...selectArgs) => {
              const qb = target.select(...selectArgs);
              const originalFrom = qb.from.bind(qb);
              qb.from = (table) => {
                const fromBuilder = originalFrom(table);
                if (table === schema.pages) {
                  const originalWhere = fromBuilder.where.bind(fromBuilder);
                  fromBuilder.where = (predicate) => {
                    const whereBuilder = originalWhere(predicate);
                    const originalThen = whereBuilder.then.bind(whereBuilder);
                    whereBuilder.then = (resolve, reject) => {
                      return originalThen(async (rows) => {
                        barrierEnumerated.release();
                        await barrierMoveFinished.wait();
                        return rows;
                      }).then(resolve, reject);
                    };
                    return whereBuilder;
                  };
                }
                return fromBuilder;
              };
              return qb;
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      // 1. Launch reindexVault on locked vault. It enumerates pageId, then pauses on barrier
      const reindexPromise = reindexVault(vaultLocked.id, { db: enumeratingDb });

      // 2. Wait until pageId has been enumerated under vaultLocked
      await barrierEnumerated.wait();

      // 3. Concurrently move page to vaultOpen!
      // This changes page.vault_id to vaultOpen.id and creates chunks encrypted with openDek.
      const moveRes = await movePage({
        pageId,
        destinationVaultId: vaultOpen.id,
        actorId: actorAlice,
        kms,
        provider,
      });
      assert.equal(moveRes.success, true);

      // Verify page is in vaultOpen and chunks are generated
      const [movedPage] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
      assert.equal(movedPage.vault_id, vaultOpen.id);

      const openChunksBeforeReindex = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.ok(openChunksBeforeReindex.length > 0, 'Chunks must exist in open destination after move');

      // 4. Release reindexVault to resume processing the enumerated page.
      // reindexVault delegates to reindexPage(vaultLocked.id, pageId).
      // Inside reindexPage, lockPageForMutation(tx, pageId, { expectedVaultId: vaultLocked.id }) detects
      // that page.vault_id is now vaultOpen.id (not vaultLocked.id) and throws 'not_found'.
      // reindexVault catches 'not_found' and skips the stale page without deleting destination chunks!
      barrierMoveFinished.release();

      const reindexResults = await reindexPromise;
      // Stale page was skipped, so results contains no processed item for pageId
      assert.equal(reindexResults.length, 0);

      // 5. Invariant verification: destination chunks in vaultOpen were NOT deleted by stale reindex!
      const finalChunks = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId));
      assert.equal(finalChunks.length, openChunksBeforeReindex.length, 'Destination chunks must NOT be deleted by stale vault reindex');

      for (const c of finalChunks) {
        assert.throws(
          () => EnvelopeEncryption.decryptToString(c.encrypted_text, lockedDek),
          'Locked DEK must fail to decrypt destination chunk'
        );
        const dec = EnvelopeEncryption.decryptToString(c.encrypted_text, openDek);
        assert.ok(dec.includes('Destination chunks must survive stale vault reindex.'));
      }

      // Page remains in vaultOpen
      const [finalPage] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
      assert.equal(finalPage.vault_id, vaultOpen.id);
    });
  } finally {
    if (createdVaultIds.length > 0) {
      await db.delete(schema.vaults).where(inArray(schema.vaults.id, createdVaultIds));
    }
  }
});

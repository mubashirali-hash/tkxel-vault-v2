import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, pool } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { eq, inArray, and } from 'drizzle-orm';
import { MockKmsProvider, EnvelopeEncryption } from '../dist/crypto/kms.js';
import { saveDraft, publishVersion, getPageContent } from '../dist/versions/index.js';
import { appendTimelineEntry, listTimelineEntries } from '../dist/vault/timeline.js';
import { rekeyVault, cryptoShredVault, isVaultShredded } from '../dist/vault/rekey.js';
import { runMigrations } from '../dist/schema/migrator.js';

test('NFR-05: on-demand re-keying and crypto-shredding', async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEmbeddingProvider = process.env.EMBEDDING_PROVIDER;
  process.env.NODE_ENV = 'test';
  process.env.EMBEDDING_PROVIDER = 'deterministic';

  await runMigrations(db);

  const kms = new MockKmsProvider();
  const owner = 'rekey.owner@test.com';
  const vaultId = crypto.randomUUID();
  const pageId = crypto.randomUUID();
  const skillId = crypto.randomUUID();
  const originalDek = EnvelopeEncryption.generateDek();
  const originalWrapped = await kms.wrapKey(originalDek);
  const skillSource = '---\nname: s\ndescription: d\n---\nSecret skill body.';

  try {
    await db.insert(schema.vaults).values({
      id: vaultId,
      name: 'Rekey Vault',
      mode: 'open',
      owner_id: owner,
      data_key_id: originalWrapped,
      export_policy: 'allowed_for_owner',
      created_at: new Date(),
    });
    await db.insert(schema.shares).values({
      vault_id: vaultId,
      principal_id: 'rekey.reader@test.com',
      role: 'reader',
      granted_by: owner,
      granted_at: new Date(),
    });
    await db.insert(schema.pages).values({
      id: pageId,
      vault_id: vaultId,
      type: 'note',
      title: 'Rekey Page',
      aliases: [],
      tags: [],
      front_matter: {},
    });
    await saveDraft(pageId, 'Published body about ospreys.', owner);
    await publishVersion(pageId, owner);
    await saveDraft(pageId, 'Newer draft body.', owner);
    await appendTimelineEntry({ vaultId, pageId, entry: 'Timeline fact', date: '2026-09-02', actorId: owner });
    await db.insert(schema.skills).values({
      id: skillId,
      vault_id: vaultId,
      name: 's',
      tool_schema: { description: 'd', encrypted_payload: EnvelopeEncryption.encrypt(skillSource, originalDek).toString('base64') },
    });

    const snapshot = async () => ({
      versions: await db.select().from(schema.versions).where(eq(schema.versions.page_id, pageId)),
      chunks: await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pageId)),
      timeline: await db.select().from(schema.timelineEntries).where(eq(schema.timelineEntries.page_id, pageId)),
      skill: (await db.select().from(schema.skills).where(eq(schema.skills.id, skillId)))[0],
      vault: (await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultId)))[0],
    });

    await t.test('re-key rotates the wrapped key and re-encrypts every ciphertext; content is unchanged', async () => {
      const before = await snapshot();
      assert.ok(before.chunks.length > 0);

      const result = await rekeyVault({ vaultId, actorId: owner });
      assert.equal(result.versions, before.versions.length);
      assert.equal(result.chunks, before.chunks.length);
      assert.equal(result.timelineEntries, 1);
      assert.equal(result.skills, 1);

      const after = await snapshot();
      assert.notEqual(after.vault.data_key_id, originalWrapped);

      // The old key no longer opens anything
      for (const v of after.versions) {
        assert.throws(() => EnvelopeEncryption.decrypt(v.encrypted_blob, originalDek));
      }
      assert.throws(() => EnvelopeEncryption.decrypt(after.chunks[0].encrypted_text, originalDek));
      assert.throws(() =>
        EnvelopeEncryption.decrypt(Buffer.from(after.skill.tool_schema.encrypted_payload, 'base64'), originalDek)
      );
      assert.notEqual(after.timeline[0].entry_text, before.timeline[0].entry_text);

      // Everything still reads correctly through the normal paths
      const published = await getPageContent(pageId, undefined, { publishedOnly: true });
      assert.equal(published.content, 'Published body about ospreys.');
      const latest = await getPageContent(pageId, after.versions.find((v) => v.status === 'draft').id);
      assert.equal(latest.content, 'Newer draft body.');
      assert.equal((await listTimelineEntries(vaultId))[0].entry_text, 'Timeline fact');

      const newDek = await kms.unwrapKey(after.vault.data_key_id);
      assert.equal(
        EnvelopeEncryption.decryptToString(Buffer.from(after.skill.tool_schema.encrypted_payload, 'base64'), newDek),
        skillSource
      );

      const audits = await db.select().from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.target_id, vaultId), eq(schema.auditEvents.action, 'rekey_vault')));
      assert.equal(audits.length, 1);
    });

    await t.test('timeline rows stay append-only outside a re-key', async () => {
      const [row] = await db.select().from(schema.timelineEntries).where(eq(schema.timelineEntries.page_id, pageId));
      await assert.rejects(
        () => db.update(schema.timelineEntries).set({ entry_text: 'enc:v1:tampered' }).where(eq(schema.timelineEntries.id, row.id)),
        (err) => /append-only/.test(String(err?.cause?.message || err?.message))
      );
      // Even with the flag, anything other than a ciphertext swap is rejected
      await assert.rejects(
        () =>
          db.transaction(async (tx) => {
            const { sql } = await import('drizzle-orm');
            await tx.execute(sql`SELECT set_config('app.timeline_rekey', 'on', true)`);
            await tx.update(schema.timelineEntries).set({ date: '1999-01-01' }).where(eq(schema.timelineEntries.id, row.id));
          }),
        (err) => /append-only/.test(String(err?.cause?.message || err?.message))
      );
    });

    await t.test('crypto-shred needs the typed vault name, destroys the key and removes content', async () => {
      await assert.rejects(() => cryptoShredVault({ vaultId, actorId: owner, confirmName: 'wrong name' }), /Confirmation/);
      const untouched = await snapshot();
      assert.equal(isVaultShredded(untouched.vault.data_key_id), false);
      assert.ok(untouched.versions.length > 0);

      const result = await cryptoShredVault({ vaultId, actorId: owner, confirmName: 'Rekey Vault' });
      assert.equal(result.pagesRemoved, 1);
      assert.equal(result.skillsRemoved, 1);
      assert.equal(result.sharesRevoked, 1);

      const after = await snapshot();
      assert.ok(isVaultShredded(after.vault.data_key_id));
      assert.equal(after.vault.mode, 'locked');
      assert.equal(after.vault.export_policy, 'strictly_forbidden');
      assert.equal(after.versions.length, 0);
      assert.equal(after.chunks.length, 0);
      assert.equal(after.timeline.length, 0);
      assert.equal(after.skill, undefined);
      await assert.rejects(() => kms.unwrapKey(after.vault.data_key_id), 'the tombstone is not a usable key');

      await assert.rejects(() => rekeyVault({ vaultId, actorId: owner }), /crypto-shredded/);
      await assert.rejects(() => cryptoShredVault({ vaultId, actorId: owner, confirmName: 'Rekey Vault' }), /already/);

      const audits = await db.select().from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.target_id, vaultId), eq(schema.auditEvents.action, 'crypto_shred_vault')));
      assert.equal(audits.length, 1);
    });
  } finally {
    try {
      await db.delete(schema.skills).where(eq(schema.skills.vault_id, vaultId));
      await db.delete(schema.pages).where(inArray(schema.pages.id, [pageId]));
      await db.delete(schema.shares).where(eq(schema.shares.vault_id, vaultId));
      await db.delete(schema.vaults).where(eq(schema.vaults.id, vaultId));
    } catch (cleanupErr) {
      console.error('Test cleanup error:', cleanupErr);
    }
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalEmbeddingProvider !== undefined) process.env.EMBEDDING_PROVIDER = originalEmbeddingProvider;
    else delete process.env.EMBEDDING_PROVIDER;
    await pool.end();
  }
});

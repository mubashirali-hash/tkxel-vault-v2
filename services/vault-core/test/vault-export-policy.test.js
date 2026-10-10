import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { db, pool } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { eq, inArray, and } from 'drizzle-orm';
import { MockKmsProvider, EnvelopeEncryption } from '../dist/crypto/kms.js';
import { saveDraft, publishVersion } from '../dist/versions/index.js';
import { appendTimelineEntry } from '../dist/vault/timeline.js';
import { exportVaultArchive, ExportNotAllowedError } from '../dist/export/vault-export.js';
import { parseMarkdown } from '../dist/markdown/parser.js';

test('FR-56 / AC-10: server-side export policy', async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEmbeddingProvider = process.env.EMBEDDING_PROVIDER;
  process.env.NODE_ENV = 'test';
  process.env.EMBEDDING_PROVIDER = 'deterministic';

  const kms = new MockKmsProvider();
  const owner = 'export.owner@test.com';
  const editor = 'export.editor@test.com';
  const openVaultId = crypto.randomUUID();
  const lockedVaultId = crypto.randomUUID();
  const pageA = crypto.randomUUID();
  const pageB = crypto.randomUUID();
  const pageDup = crypto.randomUUID();

  try {
    await db.insert(schema.vaults).values([
      {
        id: openVaultId,
        name: 'Export: Open/Vault',
        mode: 'open',
        owner_id: owner,
        data_key_id: await kms.wrapKey(EnvelopeEncryption.generateDek()),
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      },
      {
        id: lockedVaultId,
        name: 'Export Locked Vault',
        mode: 'locked',
        owner_id: owner,
        data_key_id: await kms.wrapKey(EnvelopeEncryption.generateDek()),
        export_policy: 'strictly_forbidden',
        created_at: new Date(),
      },
    ]);
    await db.insert(schema.shares).values({
      vault_id: openVaultId,
      principal_id: editor,
      role: 'editor',
      granted_by: owner,
      granted_at: new Date(),
    });
    await db.insert(schema.pages).values([
      {
        id: pageA,
        vault_id: openVaultId,
        type: 'client',
        title: 'Acme Corp',
        aliases: ['Acme'],
        tags: ['fintech', 'enterprise'],
        front_matter: { title: 'Acme Corp', folder: 'Clients/Active', owner: '[[Sara Khan]]', status: 'active' },
      },
      { id: pageB, vault_id: openVaultId, type: 'note', title: 'Sara Khan', aliases: [], tags: [], front_matter: {} },
      { id: pageDup, vault_id: openVaultId, type: 'note', title: 'Sara Khan', aliases: [], tags: [], front_matter: {} },
    ]);
    await saveDraft(pageA, 'Uses the pattern in [[Payment Architecture Reference]] and [[works_at::Sara Khan|Sara]].', owner);
    await publishVersion(pageA, owner);
    await saveDraft(pageB, 'Account lead.', owner);
    await saveDraft(pageDup, 'Second page with the same title.', owner);
    await appendTimelineEntry({ vaultId: openVaultId, pageId: pageA, entry: 'Kickoff call held', date: '2026-09-02', actorId: owner });

    await t.test('Open vault: Owner gets a ZIP of clean Markdown with full front matter, links and timeline', async () => {
      const archive = await exportVaultArchive({ vaultId: openVaultId, actorId: owner, justification: 'quarterly backup' });
      assert.equal(archive.pageCount, 3);
      assert.ok(!/[\\/:]/.test(archive.fileName), 'archive name must be a safe file name');

      const zip = await JSZip.loadAsync(archive.zipBuffer);
      const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
      assert.deepEqual(names, ['Clients/Active/Acme Corp.md', 'Sara Khan (2).md', 'Sara Khan.md']);

      const acme = await zip.file('Clients/Active/Acme Corp.md').async('string');
      const parsed = parseMarkdown(acme);
      assert.equal(parsed.frontMatter.title, 'Acme Corp');
      assert.equal(parsed.frontMatter.type, 'client');
      assert.deepEqual(parsed.frontMatter.tags, ['fintech', 'enterprise']);
      assert.deepEqual(parsed.frontMatter.aliases, ['Acme']);
      assert.equal(parsed.frontMatter.owner, '[[Sara Khan]]', 'arbitrary front matter fields must survive');
      assert.equal(parsed.frontMatter.status, 'active');
      assert.ok(acme.includes('[[Payment Architecture Reference]]'));
      assert.ok(acme.includes('[[works_at::Sara Khan|Sara]]'));
      assert.ok(acme.includes('## Timeline\n- 2026-09-02: Kickoff call held'));

      const audits = await db.select().from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.target_id, openVaultId), eq(schema.auditEvents.action, 'export_open_vault')));
      assert.equal(audits.length, 1);
      assert.equal(audits[0].actor_id, owner);
      assert.equal(audits[0].metadata.page_count, 3);
      assert.equal(audits[0].metadata.justification, 'quarterly backup');
    });

    await t.test('Open vault: non-owners and strangers are refused without detail', async () => {
      await assert.rejects(() => exportVaultArchive({ vaultId: openVaultId, actorId: editor }), ExportNotAllowedError);
      await assert.rejects(() => exportVaultArchive({ vaultId: openVaultId, actorId: 'stranger@test.com' }), ExportNotAllowedError);
      await assert.rejects(() => exportVaultArchive({ vaultId: crypto.randomUUID(), actorId: owner }), ExportNotAllowedError);
    });

    await t.test('Locked vault: export is refused for every caller, including the Owner, and each attempt is audited', async () => {
      for (const params of [
        { actorId: owner },
        { actorId: owner, treatAsOwner: true },
        { actorId: 'sysadmin@test.com', treatAsOwner: true },
        { actorId: 'stranger@test.com' },
      ]) {
        await assert.rejects(() => exportVaultArchive({ vaultId: lockedVaultId, ...params }), ExportNotAllowedError);
      }
      const denied = await db.select().from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.target_id, lockedVaultId), eq(schema.auditEvents.action, 'export_locked_denied')));
      assert.equal(denied.length, 4);
      const exported = await db.select().from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.target_id, lockedVaultId), eq(schema.auditEvents.action, 'export_open_vault')));
      assert.equal(exported.length, 0);
    });
  } finally {
    try {
      await db.delete(schema.pages).where(inArray(schema.pages.id, [pageA, pageB, pageDup]));
      await db.delete(schema.shares).where(inArray(schema.shares.vault_id, [openVaultId, lockedVaultId]));
      await db.delete(schema.vaults).where(inArray(schema.vaults.id, [openVaultId, lockedVaultId]));
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

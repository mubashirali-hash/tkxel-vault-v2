import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { db, pool } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { MockKmsProvider, EnvelopeEncryption } from '@tkxel-vault/vault-core';
import { eq, inArray } from 'drizzle-orm';

process.env.NODE_ENV = 'test';
process.env.EMBEDDING_PROVIDER = 'deterministic';
process.env.SKIP_SERVER_LISTEN = 'true';
process.env.ENABLE_DEV_AUTH_BYPASS = 'true';
process.env.RUNNER_SHARED_SECRET = 'externally-supplied-runner-secret-key-32b!';
delete process.env.REDIS_URL;

const { app } = await import('../dist/server.js');

test('FR-41 / FR-43: owner-only publish and draft confidentiality over HTTP', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const owner = 'pub.owner@test.com';
  const editor = 'pub.editor@test.com';
  const reader = 'pub.reader@test.com';

  const vaultId = crypto.randomUUID();
  const otherVaultId = crypto.randomUUID();
  const publishedPageId = crypto.randomUUID();
  const draftOnlyPageId = crypto.randomUUID();
  const importedPageId = crypto.randomUUID();
  const foreignPageId = crypto.randomUUID();
  const pageIds = [publishedPageId, draftOnlyPageId, importedPageId, foreignPageId];

  const kms = new MockKmsProvider();
  const wrappedDek = await kms.wrapKey(EnvelopeEncryption.generateDek());
  const otherWrappedDek = await kms.wrapKey(EnvelopeEncryption.generateDek());

  const apiRequest = (method, path, userEmail, body = null) =>
    new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          agent: false,
          headers: {
            Authorization: `Bearer test_user:${userEmail}`,
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            let parsed = data;
            try {
              parsed = JSON.parse(data);
            } catch {}
            resolve({ status: res.statusCode, data: parsed });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

  try {
    await db.insert(schema.vaults).values([
      {
        id: vaultId,
        name: 'Publish Policy Vault',
        mode: 'open',
        owner_id: owner,
        data_key_id: wrappedDek,
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      },
      {
        id: otherVaultId,
        name: 'Foreign Vault',
        mode: 'open',
        owner_id: 'pub.foreign.owner@test.com',
        data_key_id: otherWrappedDek,
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      },
    ]);
    await db.insert(schema.shares).values([
      { vault_id: vaultId, principal_id: editor, role: 'editor', granted_by: owner, granted_at: new Date() },
      { vault_id: vaultId, principal_id: reader, role: 'reader', granted_by: owner, granted_at: new Date() },
    ]);
    await db.insert(schema.pages).values({
      id: foreignPageId,
      vault_id: otherVaultId,
      type: 'note',
      title: 'Foreign Original Title',
      aliases: [],
      tags: [],
      front_matter: {},
      created_at: new Date(),
      updated_at: new Date(),
    });

    await t.test('Editor can save a draft but cannot publish; Owner can', async () => {
      const draft = await apiRequest('POST', `/api/pages/${publishedPageId}/draft?vaultId=${vaultId}`, editor, {
        title: 'Published Page',
        content: 'PUBLISHED-BODY-V1',
      });
      assert.equal(draft.status, 200);

      const editorPublish = await apiRequest('POST', `/api/pages/${publishedPageId}/publish`, editor, {});
      assert.equal(editorPublish.status, 404, 'Editor publish must be denied without disclosing the page');

      const rows = await db.select().from(schema.versions).where(eq(schema.versions.page_id, publishedPageId));
      assert.ok(rows.every((v) => v.status === 'draft'), 'Denied publish must not create a published version');

      const ownerPublish = await apiRequest('POST', `/api/pages/${publishedPageId}/publish`, owner, {});
      assert.equal(ownerPublish.status, 200);
    });

    await t.test('Reader never receives draft content', async () => {
      // A newer draft on the published page, and a page that has never been published
      const newerDraft = await apiRequest('POST', `/api/pages/${publishedPageId}/draft`, editor, {
        content: 'UNPUBLISHED-DRAFT-V2',
      });
      assert.equal(newerDraft.status, 200);
      const draftOnly = await apiRequest('POST', `/api/pages/${draftOnlyPageId}/draft?vaultId=${vaultId}`, editor, {
        title: 'Draft Only Page',
        content: 'NEVER-PUBLISHED-SECRET',
      });
      assert.equal(draftOnly.status, 200);

      const versions = await apiRequest('GET', `/api/pages/${publishedPageId}/versions`, reader);
      assert.equal(versions.status, 200);
      assert.equal(versions.data.draft, null, 'Reader must not receive the draft through /versions');
      assert.equal(versions.data.published, 'PUBLISHED-BODY-V1');

      const editorVersions = await apiRequest('GET', `/api/pages/${publishedPageId}/versions`, editor);
      assert.equal(editorVersions.data.draft, 'UNPUBLISHED-DRAFT-V2', 'Editor still sees the working draft');

      const single = await apiRequest('GET', `/api/pages/${publishedPageId}`, reader);
      assert.equal(single.status, 200);
      assert.equal(single.data.page.content, 'PUBLISHED-BODY-V1');

      const hidden = await apiRequest('GET', `/api/pages/${draftOnlyPageId}`, reader);
      assert.equal(hidden.status, 404);
      assert.deepEqual(hidden.data, { error: 'not_found' });

      const list = await apiRequest('GET', `/api/vaults/${vaultId}/pages`, reader);
      assert.equal(list.status, 200);
      const serialized = JSON.stringify(list.data);
      assert.ok(!serialized.includes('NEVER-PUBLISHED-SECRET'));
      assert.ok(!serialized.includes('UNPUBLISHED-DRAFT-V2'));
      assert.ok(!list.data.pages.some((p) => p.id === draftOnlyPageId), 'Never-published page must be hidden from Readers');
      assert.equal(list.data.pages.find((p) => p.id === publishedPageId).content, 'PUBLISHED-BODY-V1');

      const editorList = await apiRequest('GET', `/api/vaults/${vaultId}/pages`, editor);
      assert.ok(editorList.data.pages.some((p) => p.id === draftOnlyPageId), 'Editor still sees unpublished pages');

      // People who can edit get their saved draft back when they reopen the page; the published
      // version stays the current one until an Owner publishes
      const editorListed = editorList.data.pages.find((p) => p.id === publishedPageId);
      assert.equal(editorListed.content, 'UNPUBLISHED-DRAFT-V2');
      assert.equal(editorListed.has_unpublished_draft, true);
      const editorSingle = await apiRequest('GET', `/api/pages/${publishedPageId}`, editor);
      assert.equal(editorSingle.data.page.content, 'UNPUBLISHED-DRAFT-V2');
      assert.equal(editorSingle.data.page.has_unpublished_draft, true);
      assert.equal(editorSingle.data.page.current_version_id, editorListed.current_version_id);
      assert.equal(single.data.page.has_unpublished_draft, false, 'Readers are not told a draft exists');
    });

    await t.test('Editor import lands as draft and cannot touch pages in another vault', async () => {
      const res = await apiRequest('POST', `/api/vaults/${vaultId}/import`, editor, {
        pages: [
          { id: importedPageId, title: 'Imported By Editor', content: 'IMPORTED-DRAFT-BODY' },
          { id: foreignPageId, title: 'Hijacked Title', content: 'HIJACK-BODY' },
        ],
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.status, 'draft');
      assert.equal(res.data.count, 1, 'Page owned by another vault must be skipped');

      const imported = await db.select().from(schema.versions).where(eq(schema.versions.page_id, importedPageId));
      assert.equal(imported.length, 1);
      assert.equal(imported[0].status, 'draft');
      const importedPage = await db.select().from(schema.pages).where(eq(schema.pages.id, importedPageId));
      assert.equal(importedPage[0].current_version_id, null);

      const foreign = await db.select().from(schema.pages).where(eq(schema.pages.id, foreignPageId));
      assert.equal(foreign[0].title, 'Foreign Original Title');
      assert.equal(foreign[0].vault_id, otherVaultId);
      const foreignVersions = await db.select().from(schema.versions).where(eq(schema.versions.page_id, foreignPageId));
      assert.equal(foreignVersions.length, 0);

      const readerView = await apiRequest('GET', `/api/pages/${importedPageId}`, reader);
      assert.equal(readerView.status, 404);
    });
    await t.test('FR-10: saving a page persists its outgoing links and resolves ghost links', async () => {
      const sourceId = crypto.randomUUID();
      const targetId = crypto.randomUUID();
      pageIds.push(sourceId, targetId);

      // Link to a page that does not exist yet -> stored as an unresolved (ghost) link
      const first = await apiRequest('POST', `/api/pages/${sourceId}/draft?vaultId=${vaultId}`, owner, {
        title: 'Link Source',
        content: 'See [[Link Target]] and [[works_at::Published Page]].',
      });
      assert.equal(first.status, 200);

      let rows = await db.select().from(schema.links).where(eq(schema.links.from_page_id, sourceId));
      assert.equal(rows.length, 2);
      const ghost = rows.find((l) => l.raw_target === 'Link Target');
      assert.equal(ghost.resolved, false);
      const typed = rows.find((l) => l.raw_target === 'Published Page');
      assert.equal(typed.resolved, true);
      assert.equal(typed.to_page_id, publishedPageId);
      assert.equal(typed.link_type, 'works_at');

      // Creating the target resolves the ghost link without touching the source page
      const target = await apiRequest('POST', `/api/pages/${targetId}/draft?vaultId=${vaultId}`, owner, {
        title: 'Link Target',
        content: 'Target body.',
      });
      assert.equal(target.status, 200);
      rows = await db.select().from(schema.links).where(eq(schema.links.from_page_id, sourceId));
      const resolved = rows.find((l) => l.raw_target === 'Link Target');
      assert.equal(resolved.resolved, true);
      assert.equal(resolved.to_page_id, targetId);

      // Removing a link from the content removes it from the graph
      const edited = await apiRequest('POST', `/api/pages/${sourceId}/draft`, owner, { content: 'Only [[Link Target]] now.' });
      assert.equal(edited.status, 200);
      rows = await db.select().from(schema.links).where(eq(schema.links.from_page_id, sourceId));
      assert.equal(rows.length, 1);

      const graph = await apiRequest('GET', `/api/vaults/${vaultId}/links`, owner);
      assert.equal(graph.status, 200);
      assert.ok(JSON.stringify(graph.data).includes(targetId));
    });

    await t.test('FR-12: renaming a page rewrites every referencing page atomically on the server', async () => {
      const targetId = crypto.randomUUID();
      const refPublishedId = crypto.randomUUID();
      const refDraftId = crypto.randomUUID();
      const bystanderId = crypto.randomUUID();
      pageIds.push(targetId, refPublishedId, refDraftId, bystanderId);
      const draftOf = (id, body) => apiRequest('POST', `/api/pages/${id}/draft?vaultId=${vaultId}`, owner, body);

      assert.equal((await draftOf(targetId, { title: 'Old Client Name', content: 'Target.' })).status, 200);
      assert.equal((await draftOf(bystanderId, { title: 'Taken Title', content: 'No links here.' })).status, 200);
      assert.equal(
        (await draftOf(refPublishedId, { title: 'Ref Published', content: 'See [[Old Client Name]] and [[works_at::old client name|the client]].' })).status,
        200
      );
      assert.equal((await apiRequest('POST', `/api/pages/${refPublishedId}/publish`, owner, {})).status, 200);
      assert.equal((await draftOf(refDraftId, { title: 'Ref Draft', content: 'Draft mentions [[Old Client Name]].' })).status, 200);

      // Collision: nothing may change
      const conflict = await draftOf(targetId, { title: 'Taken Title', content: 'Target.' });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.error, 'title_conflict');
      const unchanged = await db.select().from(schema.pages).where(eq(schema.pages.id, targetId));
      assert.equal(unchanged[0].title, 'Old Client Name');

      // Rename through the normal save path
      const renamed = await draftOf(targetId, { title: 'New Client Name', content: 'Target.' });
      assert.equal(renamed.status, 200);
      assert.deepEqual(
        renamed.data.refactored_pages.map((r) => r.id).sort(),
        [refPublishedId, refDraftId].sort()
      );

      const afterTarget = await db.select().from(schema.pages).where(eq(schema.pages.id, targetId));
      assert.equal(afterTarget[0].title, 'New Client Name');

      // Readers see the rewritten published snapshot
      const readerView = await apiRequest('GET', `/api/pages/${refPublishedId}`, reader);
      assert.equal(readerView.status, 200);
      assert.equal(readerView.data.page.content, 'See [[New Client Name]] and [[works_at::New Client Name|the client]].');

      // Editors see the rewritten draft
      const editorVersions = await apiRequest('GET', `/api/pages/${refDraftId}/versions`, editor);
      assert.equal(editorVersions.data.draft, 'Draft mentions [[New Client Name]].');

      // Link graph follows: every link still resolves to the renamed page under its new name
      const linkRows = await db.select().from(schema.links)
        .where(inArray(schema.links.from_page_id, [refPublishedId, refDraftId]));
      assert.equal(linkRows.length, 3);
      for (const l of linkRows) {
        assert.equal(l.to_page_id, targetId);
        assert.equal(l.resolved, true);
        assert.equal(l.raw_target, 'New Client Name');
      }

      const bystander = await apiRequest('GET', `/api/pages/${bystanderId}/versions`, owner);
      assert.equal(bystander.data.draft, 'No links here.');
    });

    await t.test('FR-81 / FR-82: administrative actions are audited server-side; trail is Owner-only, filterable and exportable', async () => {
      const auditPageId = crypto.randomUUID();
      pageIds.push(auditPageId);
      assert.equal((await apiRequest('POST', `/api/pages/${auditPageId}/draft?vaultId=${vaultId}`, editor, { title: 'Audit Page', content: 'x' })).status, 200);
      assert.equal((await apiRequest('POST', `/api/pages/${auditPageId}/publish`, owner, {})).status, 200);
      assert.equal((await apiRequest('DELETE', `/api/pages/${auditPageId}`, owner)).status, 200);

      const trail = await apiRequest('GET', `/api/vaults/${vaultId}/audits?limit=1000`, owner);
      assert.equal(trail.status, 200);
      const forPage = trail.data.auditEvents.filter((a) => a.target_id === auditPageId).map((a) => a.action);
      for (const expected of ['edit_page', 'publish_page', 'delete_page']) {
        assert.ok(forPage.includes(expected), `server audit trail must contain ${expected} (deleted pages included)`);
      }
      const actions = new Set(trail.data.auditEvents.map((a) => a.action));
      assert.ok(actions.has('import_pages'));
      assert.ok(actions.has('rename_page'));

      const filtered = await apiRequest('GET', `/api/vaults/${vaultId}/audits?action=publish_page&actor=${encodeURIComponent(owner)}`, owner);
      assert.ok(filtered.data.auditEvents.length > 0);
      assert.ok(filtered.data.auditEvents.every((a) => a.action === 'publish_page' && a.actor_id === owner));

      for (const user of [editor, reader]) {
        const denied = await apiRequest('GET', `/api/vaults/${vaultId}/audits`, user);
        assert.equal(denied.status, 403, 'Only Owners may inspect the audit trail');
      }

      const csv = await apiRequest('GET', `/api/vaults/${vaultId}/audits?format=csv&action=delete_page`, owner);
      assert.equal(csv.status, 200);
      const lines = String(csv.data).split(String.fromCharCode(13, 10));
      assert.equal(lines[0], '"timestamp","actor","action","target_id","metadata"');
      assert.ok(lines.slice(1).some((l) => l.includes(auditPageId) && l.includes('"delete_page"')));
    });

    await t.test('FR-06: timeline entries are appended on the server, encrypted, and never mutated', async () => {
      const marker = `TIMELINE-CANARY-${crypto.randomUUID()}`;
      const add = await apiRequest('POST', `/api/pages/${publishedPageId}/timeline`, editor, {
        entry: `Kickoff call held ${marker}`,
        date: '2026-09-02',
      });
      assert.equal(add.status, 201);
      assert.equal(add.data.entry.date, '2026-09-02');
      const entryId = add.data.entry.id;

      // Ciphertext only at rest
      const stored = await db.select().from(schema.timelineEntries).where(eq(schema.timelineEntries.id, entryId));
      assert.ok(stored[0].entry_text.startsWith('enc:v1:'));
      assert.ok(!stored[0].entry_text.includes(marker));

      // Readers can read it; saving the page body leaves it untouched
      assert.equal((await apiRequest('POST', `/api/pages/${publishedPageId}/draft`, editor, { content: 'Body edited after timeline entry.' })).status, 200);
      const list = await apiRequest('GET', `/api/vaults/${vaultId}/timeline`, reader);
      assert.equal(list.status, 200);
      const found = list.data.timelineEntries.find((e) => e.id === entryId);
      assert.equal(found.entry_text, `Kickoff call held ${marker}`);
      assert.equal(found.created_by, editor);

      // Append-only: the database rejects edits, and plaintext rows can no longer be written
      await assert.rejects(
        () => db.update(schema.timelineEntries).set({ entry_text: 'enc:v1:tampered' }).where(eq(schema.timelineEntries.id, entryId)),
        (err) => /append-only/.test(String(err?.cause?.message || err?.message))
      );
      await assert.rejects(
        () => db.insert(schema.timelineEntries).values({ page_id: publishedPageId, date: '2026-09-03', entry_text: 'plaintext', created_by: owner }),
        (err) => /timeline_entry_text_is_ciphertext/.test(String(err?.cause?.message || err?.message))
      );

      // Validation and authorization
      assert.equal((await apiRequest('POST', `/api/pages/${publishedPageId}/timeline`, editor, { entry: '   ' })).status, 400);
      assert.equal((await apiRequest('POST', `/api/pages/${publishedPageId}/timeline`, editor, { entry: 'x', date: '02/09/2026' })).status, 400);
      assert.equal((await apiRequest('POST', `/api/pages/${publishedPageId}/timeline`, reader, { entry: 'reader write' })).status, 404);
    });

    await t.test('FR-42 / FR-44 / FR-20: history, rollback, unpublish and filtered search', async () => {
      const pid = crypto.randomUUID();
      pageIds.push(pid);
      const save = (content, extra = {}) =>
        apiRequest('POST', `/api/pages/${pid}/draft?vaultId=${vaultId}`, owner, { title: 'History Page', content, ...extra });
      const publish = () => apiRequest('POST', `/api/pages/${pid}/publish`, owner, {});

      assert.equal((await save('Version one mentions zebrafish.', { tags: ['biology'], type: 'project' })).status, 200);
      assert.equal((await publish()).status, 200);
      assert.equal((await save('Version two mentions quasars.')).status, 200);
      assert.equal((await publish()).status, 200);
      assert.equal((await save('Unpublished working draft.')).status, 200);

      // History lists every version, newest first, and is not available to Readers
      const history = await apiRequest('GET', `/api/pages/${pid}/history`, editor);
      assert.equal(history.status, 200);
      assert.deepEqual(history.data.versions.map((v) => v.status), ['draft', 'published', 'published']);
      assert.equal(history.data.versions.filter((v) => v.is_current).length, 1);
      assert.equal((await apiRequest('GET', `/api/pages/${pid}/history`, reader)).status, 404);

      const v1 = history.data.versions[2];
      const v1Content = await apiRequest('GET', `/api/pages/${pid}/versions/${v1.id}`, editor);
      assert.equal(v1Content.data.content, 'Version one mentions zebrafish.');
      assert.equal((await apiRequest('GET', `/api/pages/${pid}/versions/${v1.id}`, reader)).status, 404);

      // Rollback: Owners only, republished as a new version, history preserved
      assert.equal((await apiRequest('POST', `/api/pages/${pid}/rollback`, editor, { version_id: v1.id })).status, 404);
      const draftVersion = history.data.versions[0];
      assert.equal((await apiRequest('POST', `/api/pages/${pid}/rollback`, owner, { version_id: draftVersion.id })).status, 400);
      const rollback = await apiRequest('POST', `/api/pages/${pid}/rollback`, owner, { version_id: v1.id });
      assert.equal(rollback.status, 200);
      const readerAfterRollback = await apiRequest('GET', `/api/pages/${pid}`, reader);
      assert.equal(readerAfterRollback.data.page.content, 'Version one mentions zebrafish.');
      const afterHistory = await apiRequest('GET', `/api/pages/${pid}/history`, owner);
      assert.equal(afterHistory.data.versions.filter((v) => v.status === 'published').length, 3);

      // Filtered search (type, tag, date range) and cross-vault search without a vault id
      const search = (qs, user = reader) => apiRequest('GET', `/api/search?${qs}`, user);
      const hit = await search(`q=zebrafish&vaultId=${vaultId}&types=project&tags=biology`);
      assert.equal(hit.status, 200);
      assert.ok(hit.data.results.some((r) => r.id === pid && r.vault === vaultId));
      assert.ok(!(await search(`q=zebrafish&vaultId=${vaultId}&types=meeting`)).data.results.some((r) => r.id === pid));
      assert.ok(!(await search(`q=zebrafish&vaultId=${vaultId}&tags=finance`)).data.results.some((r) => r.id === pid));
      assert.ok(!(await search(`q=zebrafish&vaultId=${vaultId}&to=2000-01-01`)).data.results.some((r) => r.id === pid));
      assert.ok((await search(`q=zebrafish&vaultId=${vaultId}&from=2000-01-01`)).data.results.some((r) => r.id === pid));
      assert.ok((await search('q=zebrafish')).data.results.some((r) => r.id === pid), 'search across all readable vaults');

      // Never-published pages are not searchable by Readers
      assert.ok(!(await search(`q=${encodeURIComponent('Draft Only Page')}&vaultId=${vaultId}`)).data.results.some((r) => r.id === draftOnlyPageId));
      assert.ok((await search(`q=${encodeURIComponent('Draft Only Page')}&vaultId=${vaultId}`, editor)).data.results.some((r) => r.id === draftOnlyPageId));

      // Unpublish: Owners only; immediate for page read, list and search
      assert.equal((await apiRequest('POST', `/api/pages/${pid}/unpublish`, editor, {})).status, 404);
      assert.equal((await apiRequest('POST', `/api/pages/${pid}/unpublish`, owner, {})).status, 200);
      assert.equal((await apiRequest('GET', `/api/pages/${pid}`, reader)).status, 404);
      const readerList = await apiRequest('GET', `/api/vaults/${vaultId}/pages`, reader);
      assert.ok(!readerList.data.pages.some((p) => p.id === pid));
      assert.ok(!(await search(`q=zebrafish&vaultId=${vaultId}`)).data.results.some((r) => r.id === pid));
      const chunkRows = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, pid));
      assert.equal(chunkRows.length, 0);

      // Editors keep the page and its history; an Owner can restore it
      assert.equal((await apiRequest('GET', `/api/pages/${pid}`, editor)).status, 200);
      const withdrawn = await apiRequest('GET', `/api/pages/${pid}/history`, owner);
      assert.ok(withdrawn.data.versions.every((v) => v.status === 'unpublished'));
      assert.equal((await apiRequest('POST', `/api/pages/${pid}/rollback`, owner, { version_id: withdrawn.data.versions[0].id })).status, 200);
      assert.equal((await apiRequest('GET', `/api/pages/${pid}`, reader)).status, 200);
    });

    await t.test('FR-54 / FR-55: a user on the shared revocation list is rejected by the API at once', async () => {
      const { setRedisClientForTesting } = await import('@tkxel-vault/skill-runner');
      const revoked = new Map();
      setRedisClientForTesting({ get: async (key) => revoked.get(key) ?? null });
      try {
        assert.equal((await apiRequest('GET', '/api/vaults', editor)).status, 200);

        // Same key the MCP gateway's deprovisioning webhook writes (identity is case-insensitive)
        revoked.set(`revoked:user:${editor.toLowerCase()}`, '1');
        const denied = await apiRequest('GET', '/api/vaults', editor.toUpperCase());
        assert.equal(denied.status, 401);
        assert.equal((await apiRequest('GET', `/api/pages/${publishedPageId}`, editor)).status, 401);
        assert.equal((await apiRequest('POST', `/api/pages/${publishedPageId}/draft`, editor, { content: 'x' })).status, 401);

        // Other users are unaffected
        assert.equal((await apiRequest('GET', '/api/vaults', owner)).status, 200);

        revoked.clear();
        assert.equal((await apiRequest('GET', '/api/vaults', editor)).status, 200);
      } finally {
        setRedisClientForTesting(null);
      }
    });

    await t.test('FR-08 / FR-09 / FR-24: daily note, page templates and Owner-triggered reindex', async () => {
      // Templates cover every SRS page type
      const templates = await apiRequest('GET', '/api/templates', reader);
      assert.equal(templates.status, 200);
      assert.deepEqual(
        templates.data.templates.map((t) => t.type).sort(),
        ['client', 'decision', 'meeting', 'note', 'other', 'person', 'project', 'skill']
      );

      const fromTemplate = await apiRequest('POST', `/api/vaults/${vaultId}/pages/from-template`, editor, { title: 'Initech $& Co', type: 'client' });
      assert.equal(fromTemplate.status, 201);
      pageIds.push(fromTemplate.data.page.id);
      assert.equal(fromTemplate.data.page.type, 'client');
      assert.ok(fromTemplate.data.page.content.startsWith('# Initech $& Co'), 'title is inserted literally');
      assert.ok(fromTemplate.data.page.content.includes('## Key contacts'));
      const stored = await apiRequest('GET', `/api/pages/${fromTemplate.data.page.id}/versions`, editor);
      assert.equal(stored.data.draft, fromTemplate.data.page.content);
      assert.equal((await apiRequest('POST', `/api/vaults/${vaultId}/pages/from-template`, reader, { title: 'X', type: 'note' })).status, 403);

      // Daily note: created once, retrieved afterwards
      const first = await apiRequest('POST', `/api/vaults/${vaultId}/daily-note`, editor, { date: '2026-10-09' });
      assert.equal(first.status, 201);
      assert.equal(first.data.created, true);
      assert.equal(first.data.page.title, '2026-10-09');
      pageIds.push(first.data.page.id);
      const second = await apiRequest('POST', `/api/vaults/${vaultId}/daily-note`, owner, { date: '2026-10-09' });
      assert.equal(second.status, 200);
      assert.equal(second.data.created, false);
      assert.equal(second.data.page.id, first.data.page.id);
      assert.ok(second.data.page.content.includes('## Follow-ups'));

      // Reindex: Owners only; rebuilds chunks that were removed
      assert.equal((await apiRequest('POST', `/api/vaults/${vaultId}/reindex`, editor, {})).status, 403);
      await db.delete(schema.chunks).where(eq(schema.chunks.page_id, publishedPageId));
      const reindex = await apiRequest('POST', `/api/vaults/${vaultId}/reindex`, owner, {});
      assert.equal(reindex.status, 200);
      assert.ok(reindex.data.indexed >= 1);
      const rebuilt = await db.select().from(schema.chunks).where(eq(schema.chunks.page_id, publishedPageId));
      assert.ok(rebuilt.length > 0);
      assert.ok(rebuilt.every((c) => c.embedding !== null), 'reindex restores semantic vectors');
    });

    await t.test('FR-52: Owner shares with an SSO group and org-wide over HTTP', async () => {
      const { recordUserGroups } = await import('@tkxel-vault/vault-core');
      const groupMember = 'share.group.member@test.com';
      const stranger = 'share.stranger@test.com';
      const shareVaultId = crypto.randomUUID();
      const sharePageId = crypto.randomUUID();
      await db.insert(schema.vaults).values({
        id: shareVaultId,
        name: 'Principal Share Vault',
        mode: 'open',
        owner_id: owner,
        data_key_id: await kms.wrapKey(EnvelopeEncryption.generateDek()),
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      });

      try {
        assert.equal((await apiRequest('POST', `/api/pages/${sharePageId}/draft?vaultId=${shareVaultId}`, owner, { title: 'Shared', content: 'Group readable.' })).status, 200);
        assert.equal((await apiRequest('POST', `/api/pages/${sharePageId}/publish`, owner, {})).status, 200);

        const share = (principal_id, role) => apiRequest('POST', `/api/vaults/${shareVaultId}/shares`, owner, { principal_id, role });
        for (const bad of ['not-an-email', 'group:', 'org:everyone', 'team vault readers']) {
          const res = await share(bad, 'reader');
          assert.equal(res.status, 400, `must reject principal "${bad}"`);
          assert.equal(res.data.error, 'invalid_principal');
        }

        // Group share: applies only to users whose SSO token carried that group
        const groupShare = await share('group:Vault-Readers', 'reader');
        assert.equal(groupShare.status, 200);
        assert.equal(groupShare.data.share.principal_id, 'group:vault-readers');
        assert.equal((await apiRequest('GET', `/api/pages/${sharePageId}`, groupMember)).status, 404);
        await recordUserGroups(groupMember, ['vault-readers']);
        const asMember = await apiRequest('GET', `/api/pages/${sharePageId}`, groupMember);
        assert.equal(asMember.status, 200);
        assert.equal(asMember.data.page.content, 'Group readable.');
        assert.equal((await apiRequest('GET', `/api/pages/${sharePageId}`, stranger)).status, 404);
        assert.equal((await apiRequest('POST', `/api/pages/${sharePageId}/draft`, groupMember, { content: 'x' })).status, 404, 'a group Reader cannot write');

        // Org-wide share: any authenticated member
        assert.equal((await share('org:all', 'reader')).status, 200);
        assert.equal((await apiRequest('GET', `/api/pages/${sharePageId}`, stranger)).status, 200);
        const strangerVaults = await apiRequest('GET', '/api/vaults', stranger);
        assert.ok(strangerVaults.data.vaults.some((v) => v.id === shareVaultId && v.role === 'reader'));
      } finally {
        await db.delete(schema.userGroups).where(eq(schema.userGroups.user_id, groupMember));
        await db.delete(schema.pages).where(eq(schema.pages.id, sharePageId));
        await db.delete(schema.shares).where(eq(schema.shares.vault_id, shareVaultId));
        await db.delete(schema.vaults).where(eq(schema.vaults.id, shareVaultId));
      }
    });

    await t.test('FR-16: cross-vault links resolve only with read access to both vaults, with no metadata leak', async () => {
      const dualUser = 'xv.dual@test.com';
      const singleUser = 'xv.single@test.com';
      const vaultHere = crypto.randomUUID();
      const vaultThere = crypto.randomUUID();
      const vaultLockedX = crypto.randomUUID();
      const sourceId = crypto.randomUUID();
      const targetPublished = crypto.randomUUID();
      const targetDraftOnly = crypto.randomUUID();
      const lockedPage = crypto.randomUUID();
      const mk = async (id, name, mode) => db.insert(schema.vaults).values({
        id, name, mode, owner_id: owner,
        data_key_id: await kms.wrapKey(EnvelopeEncryption.generateDek()),
        export_policy: mode === 'open' ? 'allowed_for_owner' : 'strictly_forbidden',
        created_at: new Date(),
      });
      await mk(vaultHere, 'XV Here', 'open');
      await mk(vaultThere, 'XV There', 'open');
      await mk(vaultLockedX, 'XV Locked', 'locked');
      await db.insert(schema.shares).values([
        { vault_id: vaultHere, principal_id: dualUser, role: 'reader', granted_by: owner },
        { vault_id: vaultThere, principal_id: dualUser, role: 'reader', granted_by: owner },
        { vault_id: vaultHere, principal_id: singleUser, role: 'reader', granted_by: owner },
      ]);
      await db.insert(schema.pages).values({
        id: lockedPage, vault_id: vaultLockedX, type: 'note', title: 'Locked Playbook', aliases: [], tags: [], front_matter: {},
      });

      try {
        const draftOf = (vid, id, body) => apiRequest('POST', `/api/pages/${id}/draft?vaultId=${vid}`, owner, body);
        const publish = (id) => apiRequest('POST', `/api/pages/${id}/publish`, owner, {});
        assert.equal((await draftOf(vaultThere, targetPublished, { title: 'Payment Architecture', aliases: ['PayArch'], content: 'Target.' })).status, 200);
        assert.equal((await publish(targetPublished)).status, 200);
        assert.equal((await draftOf(vaultThere, targetDraftOnly, { title: 'Unreleased Plan', content: 'Draft target.' })).status, 200);
        assert.equal(
          (await draftOf(vaultHere, sourceId, {
            title: 'Source',
            content: 'See [[Payment Architecture]], [[uses::PayArch]], [[Unreleased Plan]], [[Locked Playbook]] and [[Nowhere Page]].',
          })).status,
          200
        );
        assert.equal((await publish(sourceId)).status, 200);

        // Stored rows never span vaults (ADR-018)
        const stored = await db.select().from(schema.links).where(eq(schema.links.from_page_id, sourceId));
        assert.equal(stored.length, 5);
        assert.ok(stored.every((l) => l.resolved === false && l.to_page_id === null));

        const byTarget = (res) => Object.fromEntries(res.data.links.map((l) => [l.raw_target, l]));

        // Access to both vaults: published targets resolve, by title or alias, with link type kept
        const dual = await apiRequest('GET', `/api/pages/${sourceId}/cross-vault-links`, dualUser);
        assert.equal(dual.status, 200);
        const d = byTarget(dual);
        assert.equal(d['Payment Architecture'].available, true);
        assert.deepEqual(d['Payment Architecture'].target, {
          page_id: targetPublished, vault_id: vaultThere, vault_name: 'XV There', title: 'Payment Architecture',
        });
        assert.equal(d['PayArch'].available, true);
        assert.equal(d['PayArch'].link_type, 'uses');
        // A Reader never learns about an unpublished page, a locked-vault page, or a missing one
        for (const hidden of ['Unreleased Plan', 'Locked Playbook', 'Nowhere Page']) {
          assert.deepEqual(d[hidden], { raw_target: hidden, link_type: 'wiki', available: false });
        }

        // Access to only this vault: every cross-vault target looks exactly like a missing page
        const single = await apiRequest('GET', `/api/pages/${sourceId}/cross-vault-links`, singleUser);
        assert.equal(single.status, 200);
        for (const link of single.data.links) {
          assert.deepEqual(Object.keys(link).sort(), ['available', 'link_type', 'raw_target']);
          assert.equal(link.available, false);
        }
        assert.ok(!JSON.stringify(single.data).includes(vaultThere));
        assert.ok(!JSON.stringify(single.data).includes('XV There'));

        // The Owner of both vaults also sees the draft-only target; the locked vault stays invisible
        const asOwner = byTarget(await apiRequest('GET', `/api/pages/${sourceId}/cross-vault-links`, owner));
        assert.equal(asOwner['Unreleased Plan'].available, true);
        assert.equal(asOwner['Locked Playbook'].available, false);

        // No access to the source vault at all
        assert.equal((await apiRequest('GET', `/api/pages/${sourceId}/cross-vault-links`, 'xv.nobody@test.com')).status, 404);
      } finally {
        await db.delete(schema.pages).where(inArray(schema.pages.id, [sourceId, targetPublished, targetDraftOnly, lockedPage]));
        await db.delete(schema.shares).where(inArray(schema.shares.vault_id, [vaultHere, vaultThere, vaultLockedX]));
        await db.delete(schema.vaults).where(inArray(schema.vaults.id, [vaultHere, vaultThere, vaultLockedX]));
      }
    });

    await t.test('FR-05: arbitrary front matter and body #tags are persisted and exported', async () => {
      const fmPageId = crypto.randomUUID();
      pageIds.push(fmPageId);
      const save = (body) => apiRequest('POST', `/api/pages/${fmPageId}/draft?vaultId=${vaultId}`, editor, { title: 'FM Page', ...body });
      const row = async () => (await db.select().from(schema.pages).where(eq(schema.pages.id, fmPageId)))[0];

      assert.equal(
        (await save({
          content: 'Kickoff notes #Onboarding and #q3/planning.\n\n```c\n#include <stdio.h>\n```\nInline `#notatag` and a # heading-like line.',
          tags: ['client'],
          folder: 'Clients',
          front_matter: { owner: '[[Sara Khan]]', status: 'active', renewal: { value: 120000 } },
        })).status,
        200
      );
      let stored = await row();
      assert.deepEqual(stored.front_matter.owner, '[[Sara Khan]]');
      assert.equal(stored.front_matter.status, 'active');
      assert.deepEqual(stored.front_matter.renewal, { value: 120000 });
      assert.equal(stored.front_matter.folder, 'Clients');
      assert.deepEqual([...stored.tags].sort(), ['Onboarding', 'client', 'q3/planning']);

      // Replacing the set removes dropped fields; folder and reserved keys survive
      assert.equal((await save({ content: 'Now only #client here.', front_matter: { status: 'won' } })).status, 200);
      stored = await row();
      assert.equal(stored.front_matter.status, 'won');
      assert.equal(stored.front_matter.owner, undefined);
      assert.equal(stored.front_matter.folder, 'Clients');
      assert.equal(stored.front_matter.title, 'FM Page');

      // Saving without front_matter leaves it alone
      assert.equal((await save({ content: 'Body only.' })).status, 200);
      assert.equal((await row()).front_matter.status, 'won');

      // Reserved keys cannot be smuggled in; malformed input is refused
      assert.equal((await save({ content: 'x', front_matter: { title: 'Hijack', body: 'plaintext body', ok: 1 } })).status, 200);
      stored = await row();
      assert.equal(stored.front_matter.title, 'FM Page');
      assert.equal(stored.front_matter.body, undefined);
      assert.equal(stored.front_matter.ok, 1);
      assert.equal((await save({ content: 'x', front_matter: ['not', 'an', 'object'] })).status, 400);
      assert.equal((await save({ content: 'x', front_matter: { 'bad key!': 1 } })).status, 400);
      assert.equal((await save({ content: 'x', front_matter: { big: 'x'.repeat(40000) } })).status, 400);
      assert.equal((await row()).front_matter.ok, 1, 'a rejected save changes nothing');
    });

    await t.test('FR-02: vault-hosted images are stored encrypted and served only to vault readers', async () => {
      const rawRequest = (path, user) =>
        new Promise((resolve, reject) => {
          const req = http.request(
            { hostname: '127.0.0.1', port, path, method: 'GET', agent: false, headers: { Authorization: `Bearer test_user:${user}` } },
            (res) => {
              const chunks = [];
              res.on('data', (c) => chunks.push(c));
              res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
            }
          );
          req.on('error', reject);
          req.end();
        });

      // Smallest valid PNG (1x1 transparent pixel)
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64'
      );
      const upload = (user, body, vid = vaultId) => apiRequest('POST', `/api/vaults/${vid}/assets`, user, body);

      const ok = await upload(editor, { file_name: 'diagram one.png', data_base64: png.toString('base64') });
      assert.equal(ok.status, 201);
      const asset = ok.data.asset;
      assert.equal(asset.mime_type, 'image/png');
      assert.equal(asset.size_bytes, png.length);
      assert.equal(asset.markdown_url, `vault-asset://${asset.id}`);

      // Ciphertext only at rest
      const [stored] = await db.select().from(schema.assets).where(eq(schema.assets.id, asset.id));
      assert.ok(!stored.encrypted_blob.includes(png.subarray(0, 8)), 'PNG signature must not appear in storage');
      assert.notEqual(stored.encrypted_blob.length, png.length);

      // Served byte-for-byte to a Reader of the vault, with safe headers
      const served = await rawRequest(`/api/assets/${asset.id}`, reader);
      assert.equal(served.status, 200);
      assert.ok(served.body.equals(png));
      assert.equal(served.headers['content-type'], 'image/png');
      assert.equal(served.headers['x-content-type-options'], 'nosniff');
      assert.match(served.headers['cache-control'], /private/);

      // No access to the vault, or no such asset: the same 404
      const stranger = await rawRequest(`/api/assets/${asset.id}`, 'img.stranger@test.com');
      const missing = await rawRequest(`/api/assets/${crypto.randomUUID()}`, reader);
      assert.equal(stranger.status, 404);
      assert.equal(missing.status, 404);
      assert.equal(stranger.body.toString(), missing.body.toString());

      // The format comes from the bytes: SVG, scripts and mislabelled files are refused
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      assert.equal((await upload(editor, { file_name: 'x.svg', data_base64: svg.toString('base64') })).status, 400);
      assert.equal((await upload(editor, { file_name: 'fake.png', data_base64: Buffer.from('not an image').toString('base64') })).status, 400);
      assert.equal((await upload(editor, { file_name: 'empty.png', data_base64: '' })).status, 400);
      assert.equal((await upload(editor, { file_name: 'big.png', data_base64: 'A'.repeat(8 * 1024 * 1024) })).status, 400);
      assert.equal((await upload(reader, { file_name: 'r.png', data_base64: png.toString('base64') })).status, 403);

      // Re-keying the vault keeps images readable
      assert.equal((await apiRequest('POST', `/api/vaults/${vaultId}/rekey`, owner, {})).status, 200);
      assert.ok((await rawRequest(`/api/assets/${asset.id}`, reader)).body.equals(png));

      // Export bundles the image and rewrites the reference to the bundled file
      const imgPageId = crypto.randomUUID();
      pageIds.push(imgPageId);
      assert.equal(
        (await apiRequest('POST', `/api/pages/${imgPageId}/draft?vaultId=${vaultId}`, owner, {
          title: 'Image Page',
          content: `Architecture:\n\n![diagram](${asset.markdown_url})`,
        })).status,
        200
      );
      const exported = await new Promise((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path: `/api/vaults/${vaultId}/export`, method: 'POST', agent: false,
            headers: { Authorization: `Bearer test_user:${owner}`, 'Content-Type': 'application/json', 'Content-Length': 2 } },
          (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
          }
        );
        req.on('error', reject);
        req.write('{}');
        req.end();
      });
      assert.equal(exported.status, 200);
      assert.equal(exported.body.subarray(0, 2).toString(), 'PK');
      assert.ok(exported.body.includes(Buffer.from(`assets/${asset.id.slice(0, 8)}-diagram one.png`)), 'image is bundled in the export');

      await db.delete(schema.assets).where(eq(schema.assets.id, asset.id));
    });

    await t.test('FR-67: Owner configures per-vault rate limits', async () => {
      const url = `/api/vaults/${vaultId}/rate-limits`;
      const initial = await apiRequest('GET', url, owner);
      assert.equal(initial.status, 200);
      assert.deepEqual(initial.data.defaults, { locked_per_hour: 60, retrieval_per_hour: 300 });
      assert.deepEqual(initial.data.rate_limits, {});

      assert.equal((await apiRequest('PUT', url, editor, { locked_per_hour: 10 })).status, 403);
      for (const bad of [{ locked_per_hour: 0 }, { retrieval_per_hour: 1.5 }, { locked_per_hour: 'many' }, { retrieval_per_hour: 1000000 }]) {
        assert.equal((await apiRequest('PUT', url, owner, bad)).status, 400);
      }
      assert.deepEqual((await apiRequest('GET', url, owner)).data.rate_limits, {}, 'rejected values change nothing');

      const set = await apiRequest('PUT', url, owner, { locked_per_hour: 20, retrieval_per_hour: 150 });
      assert.equal(set.status, 200);
      assert.deepEqual((await apiRequest('GET', url, owner)).data.rate_limits, { locked_per_hour: 20, retrieval_per_hour: 150 });

      // Clearing one value returns it to the platform default
      assert.equal((await apiRequest('PUT', url, owner, { locked_per_hour: 20 })).status, 200);
      assert.deepEqual((await apiRequest('GET', url, owner)).data.rate_limits, { locked_per_hour: 20 });

      const audits = await apiRequest('GET', `/api/vaults/${vaultId}/audits?action=edit_vault`, owner);
      assert.ok(audits.data.auditEvents.some((e) => e.metadata.change === 'rate_limits'));
    });

    await t.test('FR-52 / FR-53: share roles are validated against vault mode', async () => {
      const lockedVaultId = crypto.randomUUID();
      const consumer = 'pub.consumer@test.com';
      await db.insert(schema.vaults).values({
        id: lockedVaultId,
        name: 'Share Policy Locked Vault',
        mode: 'locked',
        owner_id: owner,
        data_key_id: await kms.wrapKey(EnvelopeEncryption.generateDek()),
        export_policy: 'strictly_forbidden',
        created_at: new Date(),
      });

      try {
        const share = (vid, principal, role) =>
          apiRequest('POST', `/api/vaults/${vid}/shares`, owner, { principal_id: principal, role });

        for (const badRole of ['owner', 'consumer', 'admin']) {
          const res = await share(vaultId, 'pub.someone@test.com', badRole);
          assert.equal(res.status, 400, `open vault must reject role ${badRole}`);
          assert.equal(res.data.error, 'invalid_role');
        }
        for (const badRole of ['owner', 'reader']) {
          const res = await share(lockedVaultId, consumer, badRole);
          assert.equal(res.status, 400, `locked vault must reject role ${badRole}`);
        }
        const none = await db.select().from(schema.shares).where(eq(schema.shares.vault_id, lockedVaultId));
        assert.equal(none.length, 0, 'Rejected roles must not create share rows');

        const ok = await share(lockedVaultId, consumer, 'consumer');
        assert.equal(ok.status, 200);

        // SRS 2.3 / NFR-04: consumers get no web vault listing or skills catalog; wrapped keys never leave the server
        const consumerVaults = await apiRequest('GET', '/api/vaults', consumer);
        assert.equal(consumerVaults.status, 200);
        assert.ok(!consumerVaults.data.vaults.some((v) => v.id === lockedVaultId));

        const consumerSkills = await apiRequest('GET', `/api/vaults/${lockedVaultId}/skills`, consumer);
        assert.equal(consumerSkills.status, 403);

        const ownerVaults = await apiRequest('GET', '/api/vaults', owner);
        const listed = ownerVaults.data.vaults.find((v) => v.id === lockedVaultId);
        assert.ok(listed, 'Owner still sees the locked vault');
        assert.equal(listed.data_key_id, undefined, 'Wrapped DEK must not be disclosed');
        assert.equal(listed.encrypted, true);
      } finally {
        // audit_events is append-only; share audit rows are intentionally left in place
        await db.delete(schema.shares).where(eq(schema.shares.vault_id, lockedVaultId));
        await db.delete(schema.vaults).where(eq(schema.vaults.id, lockedVaultId));
      }
    });
    await t.test('FR-51: Owner toggles vault mode; access, index and export follow immediately', async () => {
      const modeVaultId = crypto.randomUUID();
      const modePageA = crypto.randomUUID();
      const modePageB = crypto.randomUUID();
      const modeReader = 'mode.reader@test.com';
      const modeEditor = 'mode.editor@test.com';
      await db.insert(schema.vaults).values({
        id: modeVaultId,
        name: 'Mode Toggle Vault',
        mode: 'open',
        owner_id: owner,
        data_key_id: await kms.wrapKey(EnvelopeEncryption.generateDek()),
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      });
      await db.insert(schema.shares).values([
        { vault_id: modeVaultId, principal_id: modeReader, role: 'reader', granted_by: owner, granted_at: new Date() },
        { vault_id: modeVaultId, principal_id: modeEditor, role: 'editor', granted_by: owner, granted_at: new Date() },
      ]);

      try {
        const draftOf = (id, body) => apiRequest('POST', `/api/pages/${id}/draft?vaultId=${modeVaultId}`, owner, body);
        assert.equal((await draftOf(modePageA, { title: 'Mode A', content: 'Pelican notes link to [[Mode B]].' })).status, 200);
        assert.equal((await apiRequest('POST', `/api/pages/${modePageA}/publish`, owner, {})).status, 200);
        assert.equal((await draftOf(modePageB, { title: 'Mode B', content: 'Target.' })).status, 200);
        assert.equal((await apiRequest('GET', `/api/pages/${modePageA}`, modeReader)).status, 200);

        const setMode = (user, mode) => apiRequest('POST', `/api/vaults/${modeVaultId}/mode`, user, { mode });
        assert.equal((await setMode(modeEditor, 'locked')).status, 403, 'Only Owners change mode');
        assert.equal((await setMode(owner, 'sealed')).status, 400);

        // Open -> Locked
        const lock = await setMode(owner, 'locked');
        assert.equal(lock.status, 200);
        assert.equal(lock.data.vault.mode, 'locked');
        assert.equal(lock.data.vault.export_policy, 'strictly_forbidden');
        assert.equal(lock.data.revoked_shares, 1);

        assert.equal((await apiRequest('GET', `/api/pages/${modePageA}`, modeReader)).status, 404, 'Reader loses access at once');
        assert.equal((await apiRequest('GET', `/api/vaults/${modeVaultId}/pages`, owner)).status, 403, 'No raw page listing in a locked vault');
        assert.equal((await apiRequest('GET', `/api/search?q=Pelican&vaultId=${modeVaultId}`, owner)).status, 403);
        assert.equal((await apiRequest('POST', `/api/vaults/${modeVaultId}/export`, owner, {})).status, 403);
        const pagesInVault = [modePageA, modePageB];
        assert.equal((await db.select().from(schema.chunks).where(inArray(schema.chunks.page_id, pagesInVault))).length, 0);
        assert.equal((await db.select().from(schema.links).where(inArray(schema.links.from_page_id, pagesInVault))).length, 0);
        const lockedList = await apiRequest('GET', '/api/vaults', owner);
        assert.equal(lockedList.data.vaults.find((v) => v.id === modeVaultId).mode, 'locked');

        // Idempotent
        const again = await setMode(owner, 'locked');
        assert.equal(again.data.changed, false);

        // Locked -> Open: content, search and links come back; the revoked Reader stays revoked
        const unlock = await setMode(owner, 'open');
        assert.equal(unlock.status, 200);
        assert.equal(unlock.data.vault.export_policy, 'allowed_for_owner');
        const page = await apiRequest('GET', `/api/pages/${modePageA}`, owner);
        assert.equal(page.data.page.content, 'Pelican notes link to [[Mode B]].');
        const found = await apiRequest('GET', `/api/search?q=Pelican&vaultId=${modeVaultId}`, owner);
        assert.ok(found.data.results.some((r) => r.id === modePageA));
        const linkRows = await db.select().from(schema.links).where(eq(schema.links.from_page_id, modePageA));
        assert.equal(linkRows.length, 1);
        assert.equal(linkRows[0].to_page_id, modePageB);
        assert.equal((await apiRequest('GET', `/api/pages/${modePageA}`, modeReader)).status, 404);

        const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.target_id, modeVaultId));
        assert.equal(audits.filter((a) => a.action === 'mode_change').length, 2);
      } finally {
        await db.delete(schema.pages).where(inArray(schema.pages.id, [modePageA, modePageB]));
        await db.delete(schema.shares).where(eq(schema.shares.vault_id, modeVaultId));
        await db.delete(schema.vaults).where(eq(schema.vaults.id, modeVaultId));
      }
    });
    await t.test('NFR-05: Owner re-keys and crypto-shreds a vault over HTTP', async () => {
      const keyVaultId = crypto.randomUUID();
      const keyPageId = crypto.randomUUID();
      const keyEditor = 'key.editor@test.com';
      await db.insert(schema.vaults).values({
        id: keyVaultId,
        name: 'Key Lifecycle Vault',
        mode: 'open',
        owner_id: owner,
        data_key_id: await kms.wrapKey(EnvelopeEncryption.generateDek()),
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      });
      await db.insert(schema.shares).values({
        vault_id: keyVaultId, principal_id: keyEditor, role: 'editor', granted_by: owner, granted_at: new Date(),
      });

      try {
        assert.equal(
          (await apiRequest('POST', `/api/pages/${keyPageId}/draft?vaultId=${keyVaultId}`, owner, { title: 'Key Page', content: 'Kingfisher content.' })).status,
          200
        );
        assert.equal((await apiRequest('POST', `/api/pages/${keyPageId}/publish`, owner, {})).status, 200);
        const before = (await db.select().from(schema.vaults).where(eq(schema.vaults.id, keyVaultId)))[0].data_key_id;

        assert.equal((await apiRequest('POST', `/api/vaults/${keyVaultId}/rekey`, keyEditor, {})).status, 403);
        const rekey = await apiRequest('POST', `/api/vaults/${keyVaultId}/rekey`, owner, {});
        assert.equal(rekey.status, 200);
        assert.ok(rekey.data.reencrypted.versions >= 1);
        const after = (await db.select().from(schema.vaults).where(eq(schema.vaults.id, keyVaultId)))[0].data_key_id;
        assert.notEqual(after, before);
        const page = await apiRequest('GET', `/api/pages/${keyPageId}`, owner);
        assert.equal(page.data.page.content, 'Kingfisher content.');

        assert.equal((await apiRequest('POST', `/api/vaults/${keyVaultId}/crypto-shred`, keyEditor, { confirm_name: 'Key Lifecycle Vault' })).status, 403);
        assert.equal((await apiRequest('POST', `/api/vaults/${keyVaultId}/crypto-shred`, owner, { confirm_name: 'nope' })).status, 400);
        assert.equal((await apiRequest('GET', `/api/pages/${keyPageId}`, owner)).status, 200, 'a failed confirmation changes nothing');

        const shred = await apiRequest('POST', `/api/vaults/${keyVaultId}/crypto-shred`, owner, { confirm_name: 'Key Lifecycle Vault' });
        assert.equal(shred.status, 200);
        assert.equal(shred.data.pages_removed, 1);
        assert.equal((await db.select().from(schema.versions).where(eq(schema.versions.page_id, keyPageId))).length, 0);
        const sealed = (await db.select().from(schema.vaults).where(eq(schema.vaults.id, keyVaultId)))[0];
        assert.ok(sealed.data_key_id.startsWith('shredded:'));
      } finally {
        await db.delete(schema.pages).where(eq(schema.pages.id, keyPageId));
        await db.delete(schema.shares).where(eq(schema.shares.vault_id, keyVaultId));
        await db.delete(schema.vaults).where(eq(schema.vaults.id, keyVaultId));
      }
    });

    await t.test('FR-81 / FR-83: refused web requests are audited and repeated refusals raise a security alert', async () => {
      // Audit events are append-only, so a fresh user keeps this independent of earlier runs
      const outsider = `denied.${crypto.randomUUID()}@test.com`;
      for (let i = 0; i < 5; i++) {
        const res = await apiRequest('GET', `/api/vaults/${vaultId}/pages`, outsider);
        assert.equal(res.status, 403);
        assert.deepEqual(res.data, { error: 'not_allowed' });
      }
      // A page lookup by ID stays indistinguishable from a missing page, and is still recorded
      assert.equal((await apiRequest('GET', `/api/pages/${publishedPageId}`, outsider)).status, 404);

      const denials = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.actor_id, outsider));
      assert.equal(denials.length, 6);
      assert.ok(denials.every((e) => e.action === 'access_denied' && e.target_id === vaultId && e.metadata.source === 'web_api'));
      assert.ok(denials.some((e) => e.metadata.operation === 'GET /api/vaults/:vaultId/pages'));
      assert.ok(denials.every((e) => !JSON.stringify(e.metadata).includes(publishedPageId)), 'no request content in the record');

      const alerts = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.target_id, outsider));
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].action, 'security_alert');
      assert.equal(alerts[0].metadata.kind, 'repeated_denials');

      // The vault's Owner sees the refusals in the vault's audit trail
      const trail = await apiRequest('GET', `/api/vaults/${vaultId}/audits?action=access_denied`, owner);
      assert.equal(trail.status, 200);
      assert.ok(trail.data.auditEvents.some((e) => e.actor_id === outsider));
    });
  } finally {
    try {
      await db.delete(schema.links).where(inArray(schema.links.from_page_id, pageIds));
      await db.delete(schema.chunks).where(inArray(schema.chunks.page_id, pageIds));
      await db.delete(schema.versions).where(inArray(schema.versions.page_id, pageIds));
      await db.delete(schema.pages).where(inArray(schema.pages.id, pageIds));
      await db.delete(schema.shares).where(inArray(schema.shares.vault_id, [vaultId, otherVaultId]));
      await db.delete(schema.vaults).where(inArray(schema.vaults.id, [vaultId, otherVaultId]));
    } catch (cleanupErr) {
      console.error('Test cleanup error:', cleanupErr);
    }
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});

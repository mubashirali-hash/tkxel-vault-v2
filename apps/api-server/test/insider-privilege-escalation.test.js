import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, pool } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { MockKmsProvider, EnvelopeEncryption, saveDraft, publishVersion } from '@tkxel-vault/vault-core';
import { eq } from 'drizzle-orm';

process.env.NODE_ENV = 'test';
process.env.EMBEDDING_PROVIDER = 'deterministic';
process.env.SKIP_SERVER_LISTEN = 'true';
process.env.ENABLE_DEV_AUTH_BYPASS = 'true';
process.env.RUNNER_SHARED_SECRET = 'externally-supplied-runner-secret-key-32b!';
delete process.env.REDIS_URL;

const { app } = await import('../dist/server.js');

// The roles each route declares, read from the source: the test then checks the running server
// really refuses everyone else. A route added without a role declaration shows up in `undeclared`.
const source = fs.readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
const declared = [...source.matchAll(/^app\.(get|post|put|delete|patch)\(\s*'([^']+)',\s*requireRole\(\[([^\]]*)\]/gm)]
  .map((m) => ({ method: m[1].toUpperCase(), path: m[2], roles: m[3].split(',').map((r) => r.trim().replace(/'/g, '')).filter(Boolean) }));

test('Security: a member of a vault cannot use any route above their role', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const tag = crypto.randomUUID().slice(0, 8);
  const users = { owner: `esc.owner.${tag}@test.com`, editor: `esc.editor.${tag}@test.com`, reader: `esc.reader.${tag}@test.com`, consumer: `esc.consumer.${tag}@test.com` };
  const ids = { open: crypto.randomUUID(), locked: crypto.randomUUID(), page: crypto.randomUUID(), lockedPage: crypto.randomUUID(), skill: crypto.randomUUID() };
  const kms = new MockKmsProvider();

  const request = (method, path, user, payload = {}) =>
    new Promise((resolve, reject) => {
      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? JSON.stringify(payload) : null;
      const req = http.request({
        hostname: '127.0.0.1', port, path, method, agent: false,
        headers: { Authorization: `Bearer test_user:${user}`, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) },
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });

  const snapshot = async () => JSON.stringify({
    vaults: (await db.select().from(schema.vaults).where(eq(schema.vaults.id, ids.open))).concat(await db.select().from(schema.vaults).where(eq(schema.vaults.id, ids.locked)))
      .map((v) => [v.name, v.mode, v.owner_id, v.data_key_id, v.export_policy]),
    shares: (await db.select().from(schema.shares).where(eq(schema.shares.vault_id, ids.open))).concat(await db.select().from(schema.shares).where(eq(schema.shares.vault_id, ids.locked)))
      .map((s) => `${s.principal_id}:${s.role}:${s.revoked_at ? 'revoked' : 'active'}`).sort(),
    pages: (await db.select().from(schema.pages).where(eq(schema.pages.vault_id, ids.open))).concat(await db.select().from(schema.pages).where(eq(schema.pages.vault_id, ids.locked)))
      .map((p) => [p.id, p.title, p.current_version_id]).sort(),
    versions: (await db.select().from(schema.versions).where(eq(schema.versions.page_id, ids.page))).map((v) => [v.number, v.status]).sort(),
  });

  try {
    for (const [id, mode] of [[ids.open, 'open'], [ids.locked, 'locked']]) {
      await db.insert(schema.vaults).values({
        id, name: `Escalation ${mode} ${tag}`, mode, owner_id: users.owner,
        data_key_id: await kms.wrapKey(EnvelopeEncryption.generateDek()),
        export_policy: mode === 'open' ? 'allowed_for_owner' : 'strictly_forbidden',
      });
    }
    await db.insert(schema.shares).values([
      { vault_id: ids.open, principal_id: users.editor, role: 'editor', granted_by: users.owner, granted_at: new Date() },
      { vault_id: ids.open, principal_id: users.reader, role: 'reader', granted_by: users.owner, granted_at: new Date() },
      { vault_id: ids.locked, principal_id: users.editor, role: 'editor', granted_by: users.owner, granted_at: new Date() },
      { vault_id: ids.locked, principal_id: users.consumer, role: 'consumer', granted_by: users.owner, granted_at: new Date() },
    ]);
    await db.insert(schema.pages).values([
      { id: ids.page, vault_id: ids.open, type: 'note', title: `Escalation Page ${tag}`, tags: [], aliases: [], front_matter: {} },
      { id: ids.lockedPage, vault_id: ids.locked, type: 'note', title: `Escalation Locked Page ${tag}`, tags: [], aliases: [], front_matter: {} },
    ]);
    await saveDraft(ids.page, '# Published text', users.owner);
    await publishVersion(ids.page, users.owner);
    await saveDraft(ids.page, '# Draft only text ESCALATION-DRAFT-MARKER', users.owner);

    assert.ok(declared.length >= 35, `expected the declared-role route table, found ${declared.length}`);
    const before = await snapshot();

    const concrete = (path, vaultId, pageId) => path
      .replace(':vaultId', vaultId).replace(':pageId', pageId).replace(':skillId', ids.skill)
      .replace(':principalId', encodeURIComponent(users.owner)).replace(/:id\b/, pageId).replace(/:[A-Za-z]+/g, crypto.randomUUID());

    // A body that tries the obvious escalations, sent with every request
    const hostile = {
      role: 'owner', principal_id: users.reader, principalId: users.reader, owner_id: users.reader, vault_id: ids.locked, vaultId: ids.locked,
      mode: 'open', export_policy: 'allowed_for_owner', confirm_name: `Escalation open ${tag}`, title: 'pwned', content: 'pwned', status: 'published',
    };

    const failures = [];
    let checked = 0;
    const members = [
      { role: 'reader', user: users.reader, vaultId: ids.open, pageId: ids.page },
      { role: 'editor', user: users.editor, vaultId: ids.open, pageId: ids.page },
      { role: 'editor', user: users.editor, vaultId: ids.locked, pageId: ids.lockedPage },
      { role: 'consumer', user: users.consumer, vaultId: ids.locked, pageId: ids.lockedPage },
    ];
    for (const route of declared) {
      for (const member of members) {
        if (route.roles.includes(member.role)) continue;
        const res = await request(route.method, concrete(route.path, member.vaultId, member.pageId), member.user, hostile);
        checked++;
        if (![403, 404].includes(res.status)) {
          failures.push(`${member.role} ${route.method} ${route.path} [${member.vaultId === ids.open ? 'open' : 'locked'}] -> ${res.status}`);
        }
        if (/ESCALATION-DRAFT-MARKER/.test(res.body)) failures.push(`${member.role} ${route.method} ${route.path} leaked draft text`);
      }
    }
    assert.deepEqual(failures, [], 'routes that did not refuse a member acting above their role');
    assert.ok(checked >= 60, `only ${checked} role checks ran`);
    assert.equal(await snapshot(), before, 'nothing changed: vault settings, shares, pages and versions are as before');
    t.diagnostic(`${declared.length} role-protected routes, ${checked} above-role requests refused`);

    // Routes that a Reader may call must still not hand over the draft
    for (const route of declared.filter((r) => r.method === 'GET' && r.roles.includes('reader'))) {
      const res = await request('GET', concrete(route.path, ids.open, ids.page), users.reader);
      assert.ok(!/ESCALATION-DRAFT-MARKER/.test(res.body), `Reader received draft text from GET ${route.path}`);
      assert.ok(res.status < 500, `GET ${route.path} failed with ${res.status} for a Reader`);
    }

    // Hostile input in the search and lookup parameters: no server error, nothing from another vault
    const payloads = ["' OR '1'='1", "'; DROP TABLE pages; --", '%27%20UNION%20SELECT%20*%20FROM%20vaults--', '\u0000', 'a'.repeat(5000), '../../etc/passwd', '{{7*7}}', '<script>alert(1)</script>'];
    for (const payload of payloads) {
      const encoded = encodeURIComponent(payload);
      for (const url of [
        `/api/search?q=${encoded}&vaultId=${ids.open}`,
        `/api/search?q=text&vaultId=${ids.open}&types=${encoded}&tags=${encoded}&from=${encoded}`,
        `/api/search?q=text&vaultId=${encoded}`,
        `/api/vaults/${encoded}/pages`,
        `/api/pages/${encoded}`,
        `/api/assets/${encoded}`,
      ]) {
        const res = await request('GET', url, users.reader);
        assert.ok(res.status < 500, `GET ${url.slice(0, 60)} answered ${res.status}`);
        assert.ok(!/Escalation Locked Page|ESCALATION-DRAFT-MARKER/.test(res.body), `hostile input reached other data via ${url.slice(0, 60)}`);
      }
    }
    assert.equal((await db.select().from(schema.pages).where(eq(schema.pages.id, ids.page))).length, 1, 'the pages table is intact');
  } finally {
    await db.delete(schema.vaults).where(eq(schema.vaults.id, ids.open)).catch(() => {});
    await db.delete(schema.vaults).where(eq(schema.vaults.id, ids.locked)).catch(() => {});
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});

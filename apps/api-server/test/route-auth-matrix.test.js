import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { db, pool } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { MockKmsProvider, EnvelopeEncryption } from '@tkxel-vault/vault-core';
import { eq } from 'drizzle-orm';

process.env.NODE_ENV = 'test';
process.env.EMBEDDING_PROVIDER = 'deterministic';
process.env.SKIP_SERVER_LISTEN = 'true';
process.env.ENABLE_DEV_AUTH_BYPASS = 'true';
process.env.RUNNER_SHARED_SECRET = 'externally-supplied-runner-secret-key-32b!';
delete process.env.REDIS_URL;

const { app } = await import('../dist/server.js');

/** Every route registered on the Express app, read from the router itself so new routes are covered automatically. */
function listRoutes() {
  const routes = [];
  const walk = (stack, prefix = '') => {
    for (const layer of stack || []) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          for (const path of [].concat(layer.route.path)) routes.push({ method: method.toUpperCase(), path: `${prefix}${path}` });
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, prefix);
      }
    }
  };
  walk((app._router || app.router)?.stack);
  return routes.filter((r) => r.method !== '_ALL' && typeof r.path === 'string');
}

// Routes that are meant to answer without a session. /api/auth/mock is the local development sign-in:
// it is only registered when the dev bypass is switched on, which production refuses (auth-hardening.test.js).
const PUBLIC = new Set(['GET /api/health', 'POST /api/auth/mock']);

test('Security: every API route refuses anonymous callers and never serves a signed-in outsider', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const owner = `matrix.owner.${crypto.randomUUID()}@test.com`;
  const outsider = `matrix.outsider.${crypto.randomUUID()}@test.com`;
  const kms = new MockKmsProvider();
  const ids = {
    open: crypto.randomUUID(), locked: crypto.randomUUID(), page: crypto.randomUUID(), lockedPage: crypto.randomUUID(),
    skill: crypto.randomUUID(), version: crypto.randomUUID(),
  };

  const request = (method, path, user) =>
    new Promise((resolve, reject) => {
      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? '{}' : null;
      const req = http.request({
        hostname: '127.0.0.1', port, path, method, agent: false,
        headers: {
          ...(user ? { Authorization: `Bearer test_user:${user}` } : {}),
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });

  try {
    for (const [id, mode] of [[ids.open, 'open'], [ids.locked, 'locked']]) {
      await db.insert(schema.vaults).values({
        id, name: `Route Matrix ${mode} ${id.slice(0, 8)}`, mode, owner_id: owner,
        data_key_id: await kms.wrapKey(EnvelopeEncryption.generateDek()),
        export_policy: mode === 'open' ? 'allowed_for_owner' : 'strictly_forbidden',
      });
    }
    await db.insert(schema.pages).values([
      { id: ids.page, vault_id: ids.open, type: 'note', title: 'Matrix Secret Page', tags: [], aliases: [], front_matter: {} },
      { id: ids.lockedPage, vault_id: ids.locked, type: 'note', title: 'Matrix Locked Reference', tags: [], aliases: [], front_matter: {} },
    ]);

    const routes = listRoutes().filter((r) => r.path.startsWith('/api'));
    assert.ok(routes.length >= 40, `expected the full route table, found ${routes.length}`);

    // One concrete URL per route and vault: every parameter points at something real that the outsider must not reach
    const concrete = (path, vaultId, pageId) => path
      .replace(':vaultId', vaultId).replace(':pageId', pageId).replace(':skillId', ids.skill).replace(':skillName', 'matrix_skill')
      .replace(':versionId', ids.version).replace(':requestId', crypto.randomUUID()).replace(':assetId', crypto.randomUUID())
      .replace(':principalId', encodeURIComponent(outsider)).replace(/:id\b/, pageId).replace(/:[A-Za-z]+/g, crypto.randomUUID());

    const anonymousFailures = [];
    const outsiderFailures = [];
    let checked = 0;
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      for (const [vaultId, pageId] of [[ids.open, ids.page], [ids.locked, ids.lockedPage]]) {
        const url = concrete(route.path, vaultId, pageId) + (route.path === '/api/search' ? `?q=matrix&vaultId=${vaultId}` : '');
        if (!PUBLIC.has(key)) {
          const anonymous = await request(route.method, url, null);
          if (anonymous.status !== 401) anonymousFailures.push(`${key} -> ${anonymous.status}`);
        }
        const res = await request(route.method, url, outsider);
        checked++;
        // A signed-in outsider gets a refusal or a validation error; a 5xx would be a fail-open risk
        // and a 2xx is only acceptable when the answer contains nothing from these vaults
        const leaked = /Matrix Secret Page|Matrix Locked Reference|Route Matrix/.test(res.body);
        const serverError = res.status >= 500;
        const success = res.status >= 200 && res.status < 300;
        const touchesVault = /:vaultId|:pageId|:id\b|:skillId|:versionId|:requestId|:assetId/.test(route.path);
        if (leaked || serverError || (success && touchesVault && !PUBLIC.has(key))) {
          outsiderFailures.push(`${key} [${vaultId === ids.open ? 'open' : 'locked'}] -> ${res.status}${leaked ? ' LEAK' : ''}`);
        }
      }
    }

    assert.deepEqual(anonymousFailures, [], 'routes that answered an anonymous caller with something other than 401');
    assert.deepEqual(outsiderFailures, [], 'routes that served, leaked to, or failed open for a signed-in outsider');
    t.diagnostic(`${routes.length} routes, ${checked} outsider requests`);

    // The outsider changed nothing
    assert.equal((await db.select().from(schema.pages).where(eq(schema.pages.id, ids.page))).length, 1);
    assert.equal((await db.select().from(schema.pages).where(eq(schema.pages.id, ids.lockedPage))).length, 1);
    assert.equal((await db.select().from(schema.vaults).where(eq(schema.vaults.id, ids.open)))[0].mode, 'open');
    assert.equal((await db.select().from(schema.shares).where(eq(schema.shares.vault_id, ids.open))).length, 0);
  } finally {
    await db.delete(schema.vaults).where(eq(schema.vaults.id, ids.open)).catch(() => {});
    await db.delete(schema.vaults).where(eq(schema.vaults.id, ids.locked)).catch(() => {});
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});

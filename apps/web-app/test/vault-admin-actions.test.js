import { register } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

register(new URL('./helpers/tsx-loader.js', import.meta.url).href, import.meta.url);

const actions = await import('../src/operations/vault-admin-actions.ts');

function stub(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift() ?? { status: 200, body: {} };
    return { ok: next.status < 400, status: next.status, json: async () => next.body };
  };
  return { calls, options: { fetchImpl, baseUrl: 'http://api.test', token: 'tok' } };
}

test('Vault admin actions call the documented server routes with the session token', async () => {
  const { calls, options } = stub([
    { status: 200, body: { rate_limits: { locked_per_hour: 10 }, defaults: { locked_per_hour: 60, retrieval_per_hour: 300 } } },
    { status: 200, body: { rate_limits: {} } },
    { status: 200, body: { reencrypted: { versions: 3, chunks: 4, timeline_entries: 1, skills: 0 } } },
    { status: 200, body: { pages_removed: 2, skills_removed: 1, shares_revoked: 5 } },
    { status: 200, body: { requests: [{ id: 'r1', status: 'pending' }] } },
    { status: 201, body: { request: { id: 'r2', status: 'pending' } } },
    { status: 200, body: { request: { id: 'r2', status: 'approved' } } },
  ]);

  assert.equal((await actions.getVaultRateLimitsApi('v1', options)).rate_limits.locked_per_hour, 10);
  await actions.setVaultRateLimitsApi('v1', { locked_per_hour: 20, retrieval_per_hour: undefined }, options);
  assert.equal((await actions.rekeyVaultApi('v1', options)).reencrypted.versions, 3);
  assert.equal((await actions.cryptoShredVaultApi('v1', 'Exact Vault Name', options)).shares_revoked, 5);
  assert.equal((await actions.listBreakGlassApi('v1', options)).length, 1);
  assert.equal((await actions.requestBreakGlassApi('v1', 'Incident 4471: need to inspect the skill.', options)).id, 'r2');
  assert.equal((await actions.decideBreakGlassApi('r2', 'approve', options)).status, 'approved');

  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace('http://api.test', '')}`), [
    'GET /api/vaults/v1/rate-limits',
    'PUT /api/vaults/v1/rate-limits',
    'POST /api/vaults/v1/rekey',
    'POST /api/vaults/v1/crypto-shred',
    'GET /api/vaults/v1/break-glass',
    'POST /api/vaults/v1/break-glass',
    'POST /api/break-glass/r2/approve',
  ]);
  assert.ok(calls.every((c) => c.headers.Authorization === 'Bearer tok'));
  // An emptied field is omitted, which the server reads as "back to the default"
  assert.deepEqual(calls[1].body, { locked_per_hour: 20 });
  assert.deepEqual(calls[3].body, { confirm_name: 'Exact Vault Name' });
});

test('Vault admin actions surface server refusals without inventing detail', async () => {
  const refused = stub([{ status: 403, body: { error: 'not_allowed' } }]);
  await assert.rejects(actions.rekeyVaultApi('v1', refused.options), /not allowed to do this/);
  const invalid = stub([{ status: 400, body: { error: 'locked_per_hour must be a whole number between 1 and 10000' } }]);
  await assert.rejects(actions.setVaultRateLimitsApi('v1', { locked_per_hour: 0 }, invalid.options), /whole number between 1 and 10000/);
});

test('Vault settings dialog: destruction needs the exact vault name and is offered to Owners only', () => {
  const modal = fs.readFileSync(new URL('../src/components/vault/VaultSettingsModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /disabled=\{busy !== null \|\| shredName !== vault\.name\}/);
  assert.match(modal, /A second person|second person/);
  assert.doesNotMatch(modal, /window\.(alert|confirm)/);
  const shell = fs.readFileSync(new URL('../src/components/layout/AppShell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /currentRole === 'owner' && onOpenVaultSettings/);
});

test('Locked reference pages: the routes are called as documented and content is not kept after closing', async () => {
  const { calls, options } = stub([
    { status: 200, body: { pages: [{ id: 'p1', title: 'Pricing', published: true, has_draft: false }] } },
    { status: 200, body: { page: { id: 'p1', title: 'Pricing', content: 'secret', published: true } } },
    { status: 200, body: { page_id: 'p1', draft_id: 'd1' } },
    { status: 200, body: { version_id: 'v2' } },
    { status: 200, body: { success: true } },
  ]);
  assert.equal((await actions.listLockedPagesApi('v1', options))[0].title, 'Pricing');
  assert.equal((await actions.getLockedPageApi('v1', 'p1', options)).content, 'secret');
  await actions.saveLockedPageApi('v1', 'p1', { title: 'Pricing', content: 'new text' }, options);
  await actions.publishLockedPageApi('v1', 'p1', options);
  await actions.deleteLockedPageApi('v1', 'p1', options);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace('http://api.test', '')}`), [
    'GET /api/vaults/v1/locked-pages',
    'GET /api/vaults/v1/locked-pages/p1',
    'PUT /api/vaults/v1/locked-pages/p1',
    'POST /api/vaults/v1/locked-pages/p1/publish',
    'DELETE /api/vaults/v1/locked-pages/p1',
  ]);
  assert.deepEqual(calls[2].body, { title: 'Pricing', content: 'new text' });

  const modal = fs.readFileSync(new URL('../src/components/vault/LockedPagesModal.tsx', import.meta.url), 'utf8');
  // Protected content never goes to browser storage and is dropped when the dialog closes
  assert.doesNotMatch(modal, /localStorage|sessionStorage|indexedDB/);
  assert.match(modal, /if \(!isOpen\) \{[\s\S]{0,160}setDraft\(null\);/);
  assert.match(modal, /canPublish && page\.has_draft/);
  const shell = fs.readFileSync(new URL('../src/components/layout/AppShell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /!isOpenVault && \(currentRole === 'owner' \|\| currentRole === 'editor'\) && onOpenLockedPages/);
});

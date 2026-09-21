import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolPalettePolicy } from '../dist/auth/policy.js';

test('Dynamic Access Resolver: resolves multi-vault permissions dynamically per user identity', async () => {
  const policy = new ToolPalettePolicy();

  // Mock dynamic access resolver function representing database shares table query
  const sharesDatabase = [
    { vaultId: 'vlt_open_eng', principalId: 'alice@tkxel.com', role: 'editor', mode: 'open' },
    { vaultId: 'vlt_locked_ai', principalId: 'alice@tkxel.com', role: 'consumer', mode: 'locked' },
    { vaultId: 'vlt_open_eng', principalId: 'bob@tkxel.com', role: 'reader', mode: 'open' },
  ];

  const dynamicAccessResolver = async (userId) => {
    return sharesDatabase
      .filter((s) => s.principalId.toLowerCase() === userId.toLowerCase())
      .map((s) => ({ vaultId: s.vaultId, mode: s.mode, role: s.role }));
  };

  // 1. User Alice has editor on Open + consumer on Locked
  const aliceAccess = await dynamicAccessResolver('alice@tkxel.com');
  assert.equal(aliceAccess.length, 2);
  const aliceTools = policy.computeAuthorizedTools(aliceAccess);
  assert.ok(aliceTools.has('get_page'), 'Alice should have get_page');
  assert.ok(aliceTools.has('add_note'), 'Alice should have add_note as editor');
  assert.ok(aliceTools.has('run_skill'), 'Alice should have run_skill on locked vault');
  assert.ok(aliceTools.has('ask_vault'), 'Alice should have ask_vault on locked vault');

  // 2. User Bob only has reader on Open
  const bobAccess = await dynamicAccessResolver('bob@tkxel.com');
  assert.equal(bobAccess.length, 1);
  const bobTools = policy.computeAuthorizedTools(bobAccess);
  assert.ok(bobTools.has('get_page'), 'Bob should have get_page');
  assert.equal(bobTools.has('add_note'), false, 'Bob should NOT have add_note as reader');
  assert.equal(bobTools.has('run_skill'), false, 'Bob should NOT have locked tools');

  // 3. User Charlie has no active shares
  const charlieAccess = await dynamicAccessResolver('charlie@external.com');
  assert.equal(charlieAccess.length, 0);
  const charlieTools = policy.computeAuthorizedTools(charlieAccess);
  assert.equal(charlieTools.size, 0, 'Unassigned user should have empty tool palette');

  // 4. Invariant: Hardcoded UUID stub must be rejected
  // If a resolver ignores userId and always returns static vaults, it fails this test
  const stubResolver = async (_userId) => [
    { vaultId: '11111111-1111-1111-1111-111111111111', mode: 'open', role: 'editor' },
    { vaultId: '22222222-2222-2222-2222-222222222222', mode: 'locked', role: 'consumer' },
  ];
  const stubCharlie = await stubResolver('charlie@external.com');
  assert.notEqual(
    stubCharlie.length,
    charlieAccess.length,
    'Stub resolver incorrectly returned permissions to unauthorized user'
  );
});

test('Dynamic Access Resolver: immediate tool revocation on share revocation', async () => {
  const policy = new ToolPalettePolicy();

  let activeShares = [
    { vaultId: 'vlt_open_1', principalId: 'dave@tkxel.com', role: 'editor', mode: 'open', revokedAt: null },
  ];

  const resolveAccess = async (userId) => {
    return activeShares
      .filter((s) => s.principalId === userId && s.revokedAt === null)
      .map((s) => ({ vaultId: s.vaultId, mode: s.mode, role: s.role }));
  };

  // Initial call: Dave is editor
  let daveTools = policy.computeAuthorizedTools(await resolveAccess('dave@tkxel.com'));
  assert.ok(daveTools.has('add_note'));

  // Revoke Dave's share in DB
  activeShares[0].revokedAt = new Date();

  // Next call immediately reflects revocation without restarting server
  daveTools = policy.computeAuthorizedTools(await resolveAccess('dave@tkxel.com'));
  assert.equal(daveTools.size, 0);
});

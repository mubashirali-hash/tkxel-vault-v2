import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolPalettePolicy } from '../dist/auth/policy.js';

test('Dynamic Tool Palette: Reader on Open Vault receives open retrieval tools only', () => {
  const policy = new ToolPalettePolicy();

  const tools = policy.computeAuthorizedTools([
    { vaultId: 'vlt_open_1', mode: 'open', role: 'reader' },
  ]);

  assert.ok(tools.has('search'));
  assert.ok(tools.has('get_page'));
  assert.ok(tools.has('get_links'));
  assert.ok(tools.has('get_context'));

  assert.equal(tools.has('add_note'), false);
  assert.equal(tools.has('run_skill'), false);
  assert.equal(tools.has('ask_vault'), false);
  assert.equal(tools.has('list_skills'), false);
});

test('Dynamic Tool Palette: Editor on Open Vault receives open retrieval tools plus add_note', () => {
  const policy = new ToolPalettePolicy();

  const tools = policy.computeAuthorizedTools([
    { vaultId: 'vlt_open_1', mode: 'open', role: 'editor' },
  ]);

  assert.ok(tools.has('search'));
  assert.ok(tools.has('get_page'));
  assert.ok(tools.has('get_links'));
  assert.ok(tools.has('get_context'));
  assert.ok(tools.has('add_note'));

  assert.equal(tools.has('run_skill'), false);
});

test('Dynamic Tool Palette: Consumer on Locked Vault receives locked tools only', () => {
  const policy = new ToolPalettePolicy();

  const tools = policy.computeAuthorizedTools([
    { vaultId: 'vlt_locked_1', mode: 'locked', role: 'consumer' },
  ]);

  assert.ok(tools.has('list_skills'));
  assert.ok(tools.has('run_skill'));
  assert.ok(tools.has('ask_vault'));

  // Zero open retrieval tools exposed
  assert.equal(tools.has('search'), false);
  assert.equal(tools.has('get_page'), false);
  assert.equal(tools.has('get_links'), false);
  assert.equal(tools.has('get_context'), false);
  assert.equal(tools.has('add_note'), false);
});

test('Dynamic Tool Palette: User with dual roles across Open and Locked receives union of tools', () => {
  const policy = new ToolPalettePolicy();

  const tools = policy.computeAuthorizedTools([
    { vaultId: 'vlt_open_wiki', mode: 'open', role: 'reader' },
    { vaultId: 'vlt_locked_ip', mode: 'locked', role: 'consumer' },
  ]);

  assert.ok(tools.has('search'));
  assert.ok(tools.has('get_context'));
  assert.ok(tools.has('run_skill'));
  assert.ok(tools.has('ask_vault'));
});

test('Dynamic Tool Palette: User with zero permissions receives empty tool palette', () => {
  const policy = new ToolPalettePolicy();
  const tools = policy.computeAuthorizedTools([]);
  assert.equal(tools.size, 0);
});

test('Error Masking: suppresses resource existence details on access denial (FR-68)', () => {
  const policy = new ToolPalettePolicy();
  const err = policy.maskAccessDenial('secret-vault');
  assert.match(err.message, /not found or access not allowed/);
  assert.equal(err.message.includes('exists'), false);
});

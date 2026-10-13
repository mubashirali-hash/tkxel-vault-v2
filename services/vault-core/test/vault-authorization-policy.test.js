import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getConfiguredGlobalOwners,
  isVaultOperationAllowed,
} from '../dist/auth/index.js';

test('vault authorization policy permits open retrieval only for open-vault readers and editors', () => {
  for (const role of ['owner', 'editor', 'reader']) {
    assert.equal(isVaultOperationAllowed('open', role, 'read_open_content'), true);
  }
  assert.equal(isVaultOperationAllowed('open', 'consumer', 'read_open_content'), false);
  assert.equal(isVaultOperationAllowed('locked', 'owner', 'read_open_content'), false);
  assert.equal(isVaultOperationAllowed('locked', 'consumer', 'read_open_content'), false);
});

test('vault authorization policy keeps locked execution inside locked vaults', () => {
  for (const role of ['owner', 'editor', 'consumer']) {
    assert.equal(isVaultOperationAllowed('locked', role, 'execute_locked_skill'), true);
    assert.equal(isVaultOperationAllowed('locked', role, 'list_locked_skills'), true);
  }
  assert.equal(isVaultOperationAllowed('locked', 'reader', 'execute_locked_skill'), false);
  assert.equal(isVaultOperationAllowed('open', 'consumer', 'execute_locked_skill'), false);
  assert.equal(isVaultOperationAllowed('open', 'owner', 'execute_locked_skill'), false);
});

test('vault authorization policy restricts open writes and vault management', () => {
  assert.equal(isVaultOperationAllowed('open', 'owner', 'write_open_content'), true);
  assert.equal(isVaultOperationAllowed('open', 'editor', 'write_open_content'), true);
  assert.equal(isVaultOperationAllowed('open', 'reader', 'write_open_content'), false);
  assert.equal(isVaultOperationAllowed('locked', 'editor', 'write_open_content'), false);
  assert.equal(isVaultOperationAllowed('open', 'owner', 'manage_vault'), true);
  assert.equal(isVaultOperationAllowed('locked', 'owner', 'manage_vault'), true);
  assert.equal(isVaultOperationAllowed('open', 'editor', 'manage_vault'), false);
});

test('global owner configuration has no hardcoded production identities', () => {
  assert.deepEqual(getConfiguredGlobalOwners({}), []);
  assert.deepEqual(
    getConfiguredGlobalOwners({ VAULT_OWNER_EMAIL: 'Alice@Example.com, bob@example.com ' }),
    ['alice@example.com', 'bob@example.com'],
  );
});


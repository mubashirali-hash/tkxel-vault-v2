import test from 'node:test';
import assert from 'node:assert/strict';

function evaluateUiExportPolicy(vaultMode, userRole) {
  const isLocked = vaultMode === 'locked';
  const isOwner = userRole === 'owner';
  const canExport = !isLocked && isOwner;

  let message = '';
  if (isLocked) {
    message = 'Export Strictly Prohibited: Locked Vault contains zero-read IP.';
  } else if (!isOwner) {
    message = 'Owner Privilege Required: Only Vault Owners can export open vaults.';
  } else {
    message = 'Export permitted with mandatory compliance justification.';
  }

  return { canExport, message };
}

test('Web App Export UI Policy: Open Vault permits export ONLY for Owner', () => {
  // Owner on Open Vault
  const ownerResult = evaluateUiExportPolicy('open', 'owner');
  assert.equal(ownerResult.canExport, true);
  assert.ok(ownerResult.message.includes('Export permitted'));

  // Editor on Open Vault
  const editorResult = evaluateUiExportPolicy('open', 'editor');
  assert.equal(editorResult.canExport, false);
  assert.ok(editorResult.message.includes('Owner Privilege Required'));

  // Reader on Open Vault
  const readerResult = evaluateUiExportPolicy('open', 'reader');
  assert.equal(readerResult.canExport, false);
});

test('Web App Export UI Policy: Locked Vault strictly forbids export for ALL roles including Owner', () => {
  // Owner on Locked Vault
  const lockedOwner = evaluateUiExportPolicy('locked', 'owner');
  assert.equal(lockedOwner.canExport, false);
  assert.ok(lockedOwner.message.includes('Export Strictly Prohibited'));

  // Consumer on Locked Vault
  const lockedConsumer = evaluateUiExportPolicy('locked', 'consumer');
  assert.equal(lockedConsumer.canExport, false);
  assert.ok(lockedConsumer.message.includes('Export Strictly Prohibited'));
});

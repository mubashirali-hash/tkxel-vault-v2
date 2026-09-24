import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvelopeEncryption } from '../dist/crypto/kms.js';

test('Vault-to-Vault Page Move: Re-encrypts version ciphertext across distinct KMS DEKs', async () => {
  // Source Vault DEK vs Destination Vault DEK
  const sourceDek = EnvelopeEncryption.generateDek();
  const destDek = EnvelopeEncryption.generateDek();

  const originalContent = '# Proprietary Strategy\nMigrating from open vault to highly protected locked vault.';

  // Version encrypted in Source Vault
  const sourceCiphertext = EnvelopeEncryption.encrypt(originalContent, sourceDek);

  // Moving page: decrypt under sourceDek, re-encrypt under destDek
  const reencryptVersion = (encryptedBlob, srcDek, dstDek) => {
    const plaintext = EnvelopeEncryption.decryptToString(encryptedBlob, srcDek);
    return EnvelopeEncryption.encrypt(plaintext, dstDek);
  };

  const destCiphertext = reencryptVersion(sourceCiphertext, sourceDek, destDek);

  // 1. Invariant: Source DEK can NO LONGER decrypt the migrated version
  assert.throws(() => {
    EnvelopeEncryption.decryptToString(destCiphertext, sourceDek);
  });

  // 2. Invariant: Destination DEK cleanly decrypts the version
  const recoveredContent = EnvelopeEncryption.decryptToString(destCiphertext, destDek);
  assert.equal(recoveredContent, originalContent);

  // 3. Invariant: Ciphertext changed completely (re-randomized IV + distinct key)
  assert.notEqual(sourceCiphertext.toString('base64'), destCiphertext.toString('base64'));
});

test('Vault-to-Vault Page Move: Audit event emission and cross-vault boundary checks', () => {
  const auditLogs = [];

  const executeVaultMove = (params) => {
    if (!params.actorRoles.source.includes('owner') && !params.actorRoles.source.includes('editor')) {
      throw new Error('Forbidden: Insufficient permissions on source vault');
    }
    if (!params.actorRoles.destination.includes('owner') && !params.actorRoles.destination.includes('editor')) {
      throw new Error('Forbidden: Insufficient permissions on destination vault');
    }

    auditLogs.push({
      actor_id: params.actorId,
      action: 'move_page',
      target_id: params.pageId,
      metadata: {
        source_vault_id: params.sourceVaultId,
        destination_vault_id: params.destinationVaultId,
      },
    });

    return { success: true, pageId: params.pageId, vaultId: params.destinationVaultId };
  };

  // 1. Authorized move succeeds
  const res = executeVaultMove({
    pageId: 'pg_123',
    sourceVaultId: 'vlt_src',
    destinationVaultId: 'vlt_dst',
    actorId: 'admin@tkxel.com',
    actorRoles: { source: 'owner', destination: 'editor' },
  });

  assert.equal(res.success, true);
  assert.equal(res.vaultId, 'vlt_dst');
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, 'move_page');
  assert.equal(auditLogs[0].metadata.source_vault_id, 'vlt_src');
  assert.equal(auditLogs[0].metadata.destination_vault_id, 'vlt_dst');

  // 2. Reader on destination cannot execute move
  assert.throws(() => {
    executeVaultMove({
      pageId: 'pg_123',
      sourceVaultId: 'vlt_src',
      destinationVaultId: 'vlt_dst',
      actorId: 'reader@tkxel.com',
      actorRoles: { source: 'owner', destination: 'reader' },
    });
  });
});

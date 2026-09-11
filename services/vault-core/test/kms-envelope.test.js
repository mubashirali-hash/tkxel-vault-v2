import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MockKmsProvider,
  EnvelopeEncryption,
} from '../dist/crypto/kms.js';

test('KMS Envelope Encryption: generates, encrypts, and decrypts data with AES-256-GCM', async () => {
  const kms = new MockKmsProvider();

  // 1. Generate per-vault DEK (32 bytes)
  const dek = EnvelopeEncryption.generateDek();
  assert.equal(dek.length, 32);

  // 2. Wrap DEK with KMS
  const wrappedKey = await kms.wrapKey(dek);
  assert.ok(typeof wrappedKey === 'string');
  assert.ok(wrappedKey.length > 0);

  // 3. Unwrap DEK with KMS
  const unwrappedDek = await kms.unwrapKey(wrappedKey);
  assert.deepEqual(unwrappedDek, dek);

  // 4. Encrypt document content using DEK
  const plaintext = '# Secret Strategy\nThis is proprietary confidential company data.';
  const encryptedPayload = EnvelopeEncryption.encrypt(plaintext, unwrappedDek);

  assert.ok(encryptedPayload.length > 28);
  assert.notEqual(encryptedPayload.toString('utf8'), plaintext);

  // 5. Decrypt document content using DEK
  const decrypted = EnvelopeEncryption.decryptToString(encryptedPayload, unwrappedDek);
  assert.equal(decrypted, plaintext);
});

test('KMS Envelope Encryption: tampering with ciphertext or auth tag fails authentication', async () => {
  const dek = EnvelopeEncryption.generateDek();
  const plaintext = 'Critical financial record.';
  const encryptedPayload = EnvelopeEncryption.encrypt(plaintext, dek);

  // Tamper with a byte in the payload
  const corruptedPayload = Buffer.from(encryptedPayload);
  corruptedPayload[corruptedPayload.length - 1] ^= 0xff;

  assert.throws(
    () => {
      EnvelopeEncryption.decrypt(corruptedPayload, dek);
    },
    /Unsupported state or unable to authenticate data/
  );
});

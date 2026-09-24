import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvelopeEncryption, MockKmsProvider } from '../dist/crypto/kms.js';
import { VersioningService } from '../dist/versioning/index.js';

test('Single Storage Path: Page content encrypted into version blob and excluded from front_matter', async () => {
  const kms = new MockKmsProvider();
  const dek = EnvelopeEncryption.generateDek();

  const secretText = '# Executive Strategy Note\nConfidential system metrics and financial projections for 2026.';

  // Simulate encrypting document body for version storage
  const encryptedBlob = EnvelopeEncryption.encrypt(secretText, dek);

  // Front matter must only hold document attributes (tags, folder, title), NEVER plaintext body
  const frontMatter = {
    title: 'Executive Strategy Note',
    tags: ['strategy', 'confidential'],
    author: 'ceo@tkxel.com',
  };

  const page = {
    id: 'page_exec_01',
    vault_id: 'vault_open_01',
    title: 'Executive Strategy Note',
    type: 'note',
    tags: ['strategy', 'confidential'],
    aliases: ['exec-strat'],
    front_matter: frontMatter,
    current_version_id: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  // 1. Invariant: front_matter.body MUST be undefined in storage
  assert.equal(page.front_matter.body, undefined);
  assert.doesNotMatch(JSON.stringify(page.front_matter), /Confidential system metrics/);

  // 2. Invariant: Raw storage representation contains zero plaintext
  const rawCiphertextString = encryptedBlob.toString('utf-8');
  assert.doesNotMatch(rawCiphertextString, /Confidential system metrics/);

  // 3. Invariant: Decrypting requires the vault's KMS DEK
  const decrypted = EnvelopeEncryption.decryptToString(encryptedBlob, dek);
  assert.equal(decrypted, secretText);

  // 4. Invariant: Decrypting with wrong DEK fails with authentication tag mismatch
  const wrongDek = EnvelopeEncryption.generateDek();
  assert.throws(() => {
    EnvelopeEncryption.decryptToString(encryptedBlob, wrongDek);
  });
});

test('Single Storage Path: VersioningService manages encrypted blobs without storing body in metadata', () => {
  const service = new VersioningService();
  const dek = EnvelopeEncryption.generateDek();
  const rawBody = '## Proprietary Algorithm\nStep 1: Compute matrix\nStep 2: Return cipher';
  const encryptedBlob = EnvelopeEncryption.encrypt(rawBody, dek);

  const page = {
    id: 'pg_crypto_01',
    vault_id: 'vlt_01',
    type: 'note',
    title: 'Proprietary Algorithm',
    aliases: [],
    tags: ['algo'],
    front_matter: { title: 'Proprietary Algorithm', tags: ['algo'] },
    current_version_id: null,
    created_at: new Date(),
  };

  const published = service.publishVersion(page, encryptedBlob, 0, 'usr_author_1');
  assert.equal(published.newVersion.number, 1);
  assert.equal(published.page.front_matter.body, undefined);

  // Decrypt published version
  const decryptedContent = EnvelopeEncryption.decryptToString(published.newVersion.encrypted_blob, dek);
  assert.equal(decryptedContent, rawBody);
});

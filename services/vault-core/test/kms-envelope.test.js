import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MockKmsProvider,
  AzureKeyVaultProvider,
  HttpKmsProvider,
  createKmsProvider,
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

test('Regression: createKmsProvider blocks KMS_PROVIDER=http in production without ACCEPTANCE_TESTING=true', () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origProvider = process.env.KMS_PROVIDER;
  const origAcceptance = process.env.ACCEPTANCE_TESTING;
  const origEndpoint = process.env.KMS_ENDPOINT;

  try {
    process.env.NODE_ENV = 'production';
    process.env.KMS_PROVIDER = 'http';
    process.env.KMS_ENDPOINT = 'http://127.0.0.1:9999';
    delete process.env.ACCEPTANCE_TESTING;

    assert.throws(
      () => {
        createKmsProvider();
      },
      /FATAL: HTTP KMS provider is acceptance-only and not permitted in production/
    );

    // Permitted only when explicit acceptance testing flag is set
    process.env.ACCEPTANCE_TESTING = 'true';
    const kms = createKmsProvider();
    assert.ok(kms instanceof HttpKmsProvider);
  } finally {
    if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv; else delete process.env.NODE_ENV;
    if (origProvider !== undefined) process.env.KMS_PROVIDER = origProvider; else delete process.env.KMS_PROVIDER;
    if (origAcceptance !== undefined) process.env.ACCEPTANCE_TESTING = origAcceptance; else delete process.env.ACCEPTANCE_TESTING;
    if (origEndpoint !== undefined) process.env.KMS_ENDPOINT = origEndpoint; else delete process.env.KMS_ENDPOINT;
  }
});

test('Azure Key Vault provider: production factory constructs a cloud provider with workload identity configuration', () => {
  const original = {
    nodeEnv: process.env.NODE_ENV,
    provider: process.env.KMS_PROVIDER,
    vaultUrl: process.env.AZURE_KEY_VAULT_URL,
    keyName: process.env.AZURE_KEY_VAULT_KEY_NAME,
    bearerToken: process.env.AZURE_KEY_VAULT_BEARER_TOKEN,
    endpoint: process.env.KMS_ENDPOINT,
  };

  try {
    process.env.NODE_ENV = 'production';
    process.env.KMS_PROVIDER = 'azure';
    process.env.AZURE_KEY_VAULT_URL = 'https://tkxel-acceptance.vault.azure.net';
    process.env.AZURE_KEY_VAULT_KEY_NAME = 'vault-kek';
    process.env.AZURE_KEY_VAULT_BEARER_TOKEN = 'workload-identity-token';
    delete process.env.KMS_ENDPOINT;

    assert.ok(createKmsProvider() instanceof AzureKeyVaultProvider);
  } finally {
    if (original.nodeEnv !== undefined) process.env.NODE_ENV = original.nodeEnv; else delete process.env.NODE_ENV;
    if (original.provider !== undefined) process.env.KMS_PROVIDER = original.provider; else delete process.env.KMS_PROVIDER;
    if (original.vaultUrl !== undefined) process.env.AZURE_KEY_VAULT_URL = original.vaultUrl; else delete process.env.AZURE_KEY_VAULT_URL;
    if (original.keyName !== undefined) process.env.AZURE_KEY_VAULT_KEY_NAME = original.keyName; else delete process.env.AZURE_KEY_VAULT_KEY_NAME;
    if (original.bearerToken !== undefined) process.env.AZURE_KEY_VAULT_BEARER_TOKEN = original.bearerToken; else delete process.env.AZURE_KEY_VAULT_BEARER_TOKEN;
    if (original.endpoint !== undefined) process.env.KMS_ENDPOINT = original.endpoint; else delete process.env.KMS_ENDPOINT;
  }
});

test('Acceptance HTTP KMS: rejects non-loopback endpoints', () => {
  const original = {
    provider: process.env.KMS_PROVIDER,
    endpoint: process.env.KMS_ENDPOINT,
    acceptance: process.env.ACCEPTANCE_TESTING,
  };

  try {
    process.env.KMS_PROVIDER = 'http';
    process.env.KMS_ENDPOINT = 'https://kms.example.test';
    process.env.ACCEPTANCE_TESTING = 'true';
    assert.throws(
      () => createKmsProvider(),
      /acceptance HTTP KMS must use a loopback contract-test-double endpoint/
    );
  } finally {
    if (original.provider !== undefined) process.env.KMS_PROVIDER = original.provider; else delete process.env.KMS_PROVIDER;
    if (original.endpoint !== undefined) process.env.KMS_ENDPOINT = original.endpoint; else delete process.env.KMS_ENDPOINT;
    if (original.acceptance !== undefined) process.env.ACCEPTANCE_TESTING = original.acceptance; else delete process.env.ACCEPTANCE_TESTING;
  }
});

test('Azure Key Vault provider: uses the documented wrap and unwrap REST operations', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const request = JSON.parse(options.body);
    return new Response(
      JSON.stringify({ value: request.value }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const provider = new AzureKeyVaultProvider(
      'https://tkxel-acceptance.vault.azure.net/',
      'vault-kek',
      'workload-identity-token'
    );
    const dek = Buffer.alloc(32, 7);
    const wrapped = await provider.wrapKey(dek);
    const unwrapped = await provider.unwrapKey(wrapped);

    assert.deepEqual(unwrapped, dek);
    assert.match(requests[0].url, /\/keys\/vault-kek\/wrapkey\?api-version=7\.4$/);
    assert.match(requests[1].url, /\/keys\/vault-kek\/unwrapkey\?api-version=7\.4$/);
    assert.equal(requests[0].options.headers.Authorization, 'Bearer workload-identity-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

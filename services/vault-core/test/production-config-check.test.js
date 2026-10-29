import test from 'node:test';
import assert from 'node:assert/strict';
import { productionConfigErrors } from '../dist/config/production-check.js';

const good = {
  NODE_ENV: 'production',
  KMS_PROVIDER: 'aws',
  AWS_KMS_KEY_ID: 'arn:aws:kms:eu-west-1:000000000000:key/example',
  GOOGLE_CLIENT_ID: 'example.apps.googleusercontent.com',
  EMBEDDING_PROVIDER: 'none',
};
const all = { requireSignIn: true, requireSearchMode: true };
const errorsFor = (changes, options = all) => {
  const env = { ...good, ...changes };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return productionConfigErrors(env, options);
};

test('production start-up check: a complete configuration passes', () => {
  assert.deepEqual(errorsFor({}), []);
  assert.deepEqual(errorsFor({ EMBEDDING_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-example' }), []);
  assert.deepEqual(errorsFor({ GOOGLE_CLIENT_ID: undefined, OIDC_ISSUER: 'https://login.example/v2.0', OIDC_AUDIENCE: 'api://vault' }), []);
  assert.deepEqual(
    errorsFor({ KMS_PROVIDER: 'azure', AWS_KMS_KEY_ID: undefined, AZURE_KEY_VAULT_URL: 'https://kv.example', AZURE_KEY_VAULT_KEY_NAME: 'k', AZURE_KEY_VAULT_BEARER_TOKEN: 't' }),
    []
  );
});

test('production start-up check: nothing is checked outside production', () => {
  assert.deepEqual(productionConfigErrors({ NODE_ENV: 'development' }, all), []);
  assert.deepEqual(productionConfigErrors({ NODE_ENV: 'test', KMS_PROVIDER: 'mock' }, all), []);
});

test('production start-up check: the key service must be real and fully configured', () => {
  assert.match(errorsFor({ KMS_PROVIDER: undefined })[0], /approved key service/);
  assert.match(errorsFor({ KMS_PROVIDER: 'mock' })[0], /approved key service/);
  assert.match(errorsFor({ AWS_KMS_KEY_ID: undefined })[0], /AWS_KMS_KEY_ID/);
  assert.match(errorsFor({ KMS_PROVIDER: 'azure' })[0], /AZURE_KEY_VAULT_URL/);
  assert.match(errorsFor({ KMS_PROVIDER: 'http' })[0], /approved key service/, 'the contract-test double is refused outside acceptance runs');
  assert.ok(errorsFor({ ALLOW_DEV_MOCK_KMS: 'true' }).some((e) => /ALLOW_DEV_MOCK_KMS/.test(e)));
});

test('production start-up check: sign-in, development shortcuts and the search mode', () => {
  assert.ok(errorsFor({ GOOGLE_CLIENT_ID: undefined }).some((e) => /sign-in provider/.test(e)));
  assert.ok(errorsFor({ GOOGLE_CLIENT_ID: 'replace_with_your_client_id_here' }).some((e) => /sign-in provider/.test(e)));
  assert.ok(errorsFor({ GOOGLE_CLIENT_ID: undefined, OIDC_ISSUER: 'https://login.example' }).some((e) => /sign-in provider/.test(e)), 'an issuer without an audience is not enough');
  assert.deepEqual(errorsFor({ GOOGLE_CLIENT_ID: undefined }, { requireSearchMode: true }), [], 'a service that does not sign people in is not asked for a provider');
  assert.ok(errorsFor({ ENABLE_DEV_AUTH_BYPASS: 'true' }).some((e) => /ENABLE_DEV_AUTH_BYPASS/.test(e)));
  assert.ok(errorsFor({ EMBEDDING_PROVIDER: undefined }).some((e) => /EMBEDDING_PROVIDER/.test(e)));
  assert.ok(errorsFor({ EMBEDDING_PROVIDER: 'deterministic' }).some((e) => /EMBEDDING_PROVIDER/.test(e)), 'the test-only provider is refused');
  assert.ok(errorsFor({ EMBEDDING_PROVIDER: 'openai' }).some((e) => /OPENAI_API_KEY/.test(e)));
});

test('production start-up check: every problem is reported at once', () => {
  const errors = productionConfigErrors({ NODE_ENV: 'production' }, all);
  assert.equal(errors.length, 3);
});

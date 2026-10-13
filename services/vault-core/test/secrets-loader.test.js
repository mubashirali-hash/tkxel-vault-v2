import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSecretsIntoEnv, SecretsConfigurationError } from '../dist/config/secrets.js';

const never = async () => {
  throw new Error('must not be called');
};

test('NFR-09: without SECRETS_PROVIDER nothing is fetched and the environment is untouched', async () => {
  const env = { DATABASE_URL: 'postgres://local' };
  const result = await loadSecretsIntoEnv(env, { fetchAwsSecret: never, fetchAzureSecret: never, getAzureToken: never });
  assert.deepEqual(result, { provider: null, loaded: [] });
  assert.deepEqual(env, { DATABASE_URL: 'postgres://local' });
});

test('NFR-09: AWS Secrets Manager secrets fill the environment and replace stale values', async () => {
  const asked = [];
  const env = {
    SECRETS_PROVIDER: 'aws',
    SECRETS_AWS_SECRET_IDS: 'vault/app, arn:aws:secretsmanager:eu-west-1:1:secret:vault/providers',
    AWS_REGION: 'eu-west-1',
    JWT_SECRET: 'stale-value-from-an-old-env-file',
  };
  const result = await loadSecretsIntoEnv(env, {
    fetchAwsSecret: async (id, region) => {
      asked.push([id, region]);
      return id === 'vault/app'
        ? JSON.stringify({ DATABASE_URL: 'postgres://u:p@db/v', JWT_SECRET: 'fresh', DB_POOL_MAX: 30 })
        : JSON.stringify({ ANTHROPIC_API_KEY: 'key-1' });
    },
  });
  assert.deepEqual(asked, [['vault/app', 'eu-west-1'], ['arn:aws:secretsmanager:eu-west-1:1:secret:vault/providers', 'eu-west-1']]);
  assert.deepEqual(result, { provider: 'aws', loaded: ['DATABASE_URL', 'JWT_SECRET', 'DB_POOL_MAX', 'ANTHROPIC_API_KEY'] });
  assert.equal(env.JWT_SECRET, 'fresh');
  assert.equal(env.DB_POOL_MAX, '30');
  assert.equal(env.ANTHROPIC_API_KEY, 'key-1');
});

test('NFR-09: Azure Key Vault secrets are read by hyphenated name with a managed identity token', async () => {
  const asked = [];
  const env = {
    SECRETS_PROVIDER: 'azure',
    SECRETS_AZURE_VAULT_URL: 'https://tkxel-prod.vault.azure.net/',
    SECRETS_AZURE_SECRET_NAMES: 'DATABASE_URL, JWT_SECRET',
  };
  const result = await loadSecretsIntoEnv(env, {
    getAzureToken: async () => 'token-1',
    fetchAzureSecret: async (vaultUrl, name, token) => {
      asked.push([vaultUrl, name, token]);
      return `value-of-${name}`;
    },
  });
  assert.deepEqual(asked, [
    ['https://tkxel-prod.vault.azure.net', 'DATABASE-URL', 'token-1'],
    ['https://tkxel-prod.vault.azure.net', 'JWT-SECRET', 'token-1'],
  ]);
  assert.deepEqual(result, { provider: 'azure', loaded: ['DATABASE_URL', 'JWT_SECRET'] });
  assert.equal(env.DATABASE_URL, 'value-of-DATABASE-URL');
});

test('NFR-09: a misconfigured or failing secrets manager stops start-up and never leaks a value', async () => {
  const rejects = (env, deps, pattern) => assert.rejects(loadSecretsIntoEnv(env, deps), (err) => {
    assert.ok(err instanceof SecretsConfigurationError);
    assert.match(err.message, pattern);
    assert.ok(!err.message.includes('s3cr3t-value'));
    return true;
  });

  await rejects({ SECRETS_PROVIDER: 'gcp' }, {}, /Unknown SECRETS_PROVIDER/);
  await rejects({ SECRETS_PROVIDER: 'aws' }, { fetchAwsSecret: never }, /requires SECRETS_AWS_SECRET_IDS/);
  await rejects({ SECRETS_PROVIDER: 'aws', SECRETS_AWS_SECRET_IDS: 'a' }, { fetchAwsSecret: async () => { const e = new Error('s3cr3t-value in message'); e.name = 'AccessDeniedException'; throw e; } }, /Could not read AWS secret "a": AccessDeniedException/);
  await rejects({ SECRETS_PROVIDER: 'aws', SECRETS_AWS_SECRET_IDS: 'a' }, { fetchAwsSecret: async () => 's3cr3t-value' }, /not a JSON object/);
  await rejects({ SECRETS_PROVIDER: 'aws', SECRETS_AWS_SECRET_IDS: 'a' }, { fetchAwsSecret: async () => '{"BAD NAME":"s3cr3t-value"}' }, /not a valid environment variable name/);
  await rejects({ SECRETS_PROVIDER: 'aws', SECRETS_AWS_SECRET_IDS: 'a' }, { fetchAwsSecret: async () => '{"NODE_OPTIONS":"--require /tmp/x.js"}' }, /may not set NODE_OPTIONS/);
  await rejects({ SECRETS_PROVIDER: 'aws', SECRETS_AWS_SECRET_IDS: 'a' }, { fetchAwsSecret: async () => '{"SECRETS_PROVIDER":"azure"}' }, /may not set SECRETS_PROVIDER/);
  await rejects({ SECRETS_PROVIDER: 'aws', SECRETS_AWS_SECRET_IDS: 'a' }, { fetchAwsSecret: async () => '{"A":{"nested":"s3cr3t-value"}}' }, /must be text/);
  await rejects({ SECRETS_PROVIDER: 'azure', SECRETS_AZURE_VAULT_URL: 'http://169.254.169.254', SECRETS_AZURE_SECRET_NAMES: 'A' }, { getAzureToken: never, fetchAzureSecret: never }, /requires SECRETS_AZURE_VAULT_URL/);
  await rejects({ SECRETS_PROVIDER: 'azure', SECRETS_AZURE_VAULT_URL: 'https://v.vault.azure.net' }, { getAzureToken: never, fetchAzureSecret: never }, /requires SECRETS_AZURE_SECRET_NAMES/);
  await rejects(
    { SECRETS_PROVIDER: 'azure', SECRETS_AZURE_VAULT_URL: 'https://v.vault.azure.net', SECRETS_AZURE_SECRET_NAMES: 'A' },
    { getAzureToken: async () => 't', fetchAzureSecret: async () => { throw new Error('HTTP 403'); } },
    /Could not read Azure Key Vault secret "A": HTTP 403/
  );
});

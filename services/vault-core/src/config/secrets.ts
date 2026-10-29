/**
 * Secrets manager integration (NFR-09). Services read their configuration from process.env; this
 * loader fills process.env from AWS Secrets Manager or Azure Key Vault at start-up, so secrets do
 * not have to be written to an .env file or passed on a command line.
 *
 *   SECRETS_PROVIDER=aws    SECRETS_AWS_SECRET_IDS=<id-or-arn>[,<id-or-arn>...]  [AWS_REGION]
 *     Each secret is a JSON object of NAME -> value (the format the CloudFormation stack creates).
 *
 *   SECRETS_PROVIDER=azure  SECRETS_AZURE_VAULT_URL=https://<vault>.vault.azure.net
 *                           SECRETS_AZURE_SECRET_NAMES=<NAME>[,<NAME>...]
 *     Key Vault names cannot contain underscores, so DATABASE_URL is stored as DATABASE-URL.
 *     Authenticates with the managed identity of the host, or AZURE_KEY_VAULT_TOKEN when set.
 *
 * Values from the secrets manager replace values already in the environment. Secret values are
 * never logged; only the names that were loaded are.
 */

export type SecretsProviderName = 'aws' | 'azure';

export interface SecretsLoadResult {
  provider: SecretsProviderName | null;
  /** Names of the environment variables that were set. */
  loaded: string[];
}

export interface SecretsLoaderDeps {
  /** Returns the SecretString of an AWS secret. */
  fetchAwsSecret?: (secretId: string, region?: string) => Promise<string>;
  /** Returns the value of one Azure Key Vault secret. */
  fetchAzureSecret?: (vaultUrl: string, secretName: string, token: string) => Promise<string>;
  /** Returns a bearer token for Azure Key Vault. */
  getAzureToken?: () => Promise<string>;
}

export class SecretsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsConfigurationError';
  }
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Settings that decide where secrets come from must not be changed by the secrets themselves
const PROTECTED = new Set(['SECRETS_PROVIDER', 'SECRETS_AWS_SECRET_IDS', 'SECRETS_AZURE_VAULT_URL', 'SECRETS_AZURE_SECRET_NAMES', 'NODE_ENV', 'NODE_OPTIONS', 'PATH']);

const list = (value: string | undefined): string[] =>
  (value || '').split(',').map((item) => item.trim()).filter(Boolean);

async function defaultFetchAwsSecret(secretId: string, region?: string): Promise<string> {
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient(region ? { region } : {});
  try {
    const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (typeof result.SecretString !== 'string') {
      throw new SecretsConfigurationError(`AWS secret "${secretId}" has no text value.`);
    }
    return result.SecretString;
  } finally {
    client.destroy();
  }
}

async function request(url: string, headers: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function defaultGetAzureToken(): Promise<string> {
  // Azure Instance Metadata Service: available to VMs and container hosts with a managed identity
  const body = await request(
    'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fvault.azure.net',
    { Metadata: 'true' }
  );
  if (typeof body?.access_token !== 'string') throw new Error('no access token in the managed identity response');
  return body.access_token;
}

async function defaultFetchAzureSecret(vaultUrl: string, secretName: string, token: string): Promise<string> {
  const body = await request(`${vaultUrl}/secrets/${encodeURIComponent(secretName)}?api-version=7.4`, {
    Authorization: `Bearer ${token}`,
  });
  if (typeof body?.value !== 'string') throw new Error('secret has no value');
  return body.value;
}

/**
 * Loads secrets into `env`. Does nothing when SECRETS_PROVIDER is not set. Any failure throws, so a
 * service configured to use a secrets manager never starts with missing or stale secrets.
 */
export async function loadSecretsIntoEnv(
  env: Record<string, string | undefined> = process.env,
  deps: SecretsLoaderDeps = {}
): Promise<SecretsLoadResult> {
  const provider = (env.SECRETS_PROVIDER || '').trim().toLowerCase();
  if (!provider) return { provider: null, loaded: [] };

  const loaded: string[] = [];
  const assign = (name: string, value: unknown, origin: string) => {
    if (!ENV_NAME.test(name)) {
      throw new SecretsConfigurationError(`${origin} contains "${name}", which is not a valid environment variable name.`);
    }
    if (PROTECTED.has(name)) {
      throw new SecretsConfigurationError(`${origin} may not set ${name}.`);
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new SecretsConfigurationError(`${origin}: the value of ${name} must be text.`);
    }
    env[name] = String(value);
    if (!loaded.includes(name)) loaded.push(name);
  };

  if (provider === 'aws') {
    const ids = list(env.SECRETS_AWS_SECRET_IDS);
    if (ids.length === 0) throw new SecretsConfigurationError('SECRETS_PROVIDER=aws requires SECRETS_AWS_SECRET_IDS.');
    const fetchSecret = deps.fetchAwsSecret ?? defaultFetchAwsSecret;
    for (const id of ids) {
      let text: string;
      try {
        text = await fetchSecret(id, env.AWS_REGION || env.AWS_DEFAULT_REGION);
      } catch (err: any) {
        if (err instanceof SecretsConfigurationError) throw err;
        throw new SecretsConfigurationError(`Could not read AWS secret "${id}": ${err?.name || 'error'}`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new SecretsConfigurationError(`AWS secret "${id}" is not a JSON object of NAME to value.`);
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new SecretsConfigurationError(`AWS secret "${id}" is not a JSON object of NAME to value.`);
      }
      for (const [name, value] of Object.entries(parsed)) assign(name, value, `AWS secret "${id}"`);
    }
    return { provider: 'aws', loaded };
  }

  if (provider === 'azure') {
    const vaultUrl = (env.SECRETS_AZURE_VAULT_URL || '').trim().replace(/\/+$/, '');
    const names = list(env.SECRETS_AZURE_SECRET_NAMES);
    if (!/^https:\/\/[a-z0-9-]+\.vault\.(azure\.net|azure\.cn|usgovcloudapi\.net)$/i.test(vaultUrl)) {
      throw new SecretsConfigurationError('SECRETS_PROVIDER=azure requires SECRETS_AZURE_VAULT_URL (https://<name>.vault.azure.net).');
    }
    if (names.length === 0) throw new SecretsConfigurationError('SECRETS_PROVIDER=azure requires SECRETS_AZURE_SECRET_NAMES.');
    let token = (env.AZURE_KEY_VAULT_TOKEN || '').trim();
    if (!token) {
      try {
        token = await (deps.getAzureToken ?? defaultGetAzureToken)();
      } catch (err: any) {
        throw new SecretsConfigurationError(`Could not obtain a managed identity token for Azure Key Vault: ${err?.message || 'error'}`);
      }
    }
    const fetchSecret = deps.fetchAzureSecret ?? defaultFetchAzureSecret;
    for (const name of names) {
      // Key Vault secret names use hyphens where environment variables use underscores
      const secretName = name.replace(/_/g, '-');
      let value: string;
      try {
        value = await fetchSecret(vaultUrl, secretName, token);
      } catch (err: any) {
        throw new SecretsConfigurationError(`Could not read Azure Key Vault secret "${secretName}": ${err?.message || 'error'}`);
      }
      assign(name, value, `Azure Key Vault secret "${secretName}"`);
    }
    return { provider: 'azure', loaded };
  }

  throw new SecretsConfigurationError(`Unknown SECRETS_PROVIDER "${provider}". Use "aws" or "azure".`);
}

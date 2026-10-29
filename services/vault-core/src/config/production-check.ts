/**
 * Start-up checks for a production deployment. A service that would only fail on its first real
 * request (no usable key service, no way to sign in) refuses to start instead, so a misconfigured
 * deployment is caught when it is launched and not by its first user.
 *
 * Outside production this returns nothing: development and test runs use local stand-ins.
 */
export interface ProductionCheckOptions {
  /** The service needs a sign-in provider (the API server and the MCP gateway do). */
  requireSignIn?: boolean;
  /** The service reads or writes search indexes, so the search mode must be chosen explicitly. */
  requireSearchMode?: boolean;
}

type Env = Record<string, string | undefined>;

const isSet = (value: string | undefined): boolean => Boolean(value && value.trim());

export function productionConfigErrors(env: Env = process.env, options: ProductionCheckOptions = {}): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const errors: string[] = [];

  // Encryption keys: only a real key service, fully configured
  const kms = (env.KMS_PROVIDER || '').trim().toLowerCase();
  if (kms === 'http' && env.ACCEPTANCE_TESTING === 'true') {
    if (!isSet(env.KMS_ENDPOINT)) errors.push('HTTP KMS contract-test double requires KMS_ENDPOINT.');
  } else if (kms !== 'aws' && kms !== 'azure') {
    errors.push('Production mode requires an approved key service: KMS_PROVIDER=aws (AWS KMS) or KMS_PROVIDER=azure (Azure Key Vault). The mock key service is forbidden.');
  } else if (kms === 'aws' && !isSet(env.AWS_KMS_KEY_ID)) {
    errors.push('AWS KMS requires AWS_KMS_KEY_ID in production mode.');
  } else if (kms === 'azure' && !(isSet(env.AZURE_KEY_VAULT_URL) && isSet(env.AZURE_KEY_VAULT_KEY_NAME) && isSet(env.AZURE_KEY_VAULT_BEARER_TOKEN))) {
    errors.push('Azure Key Vault requires AZURE_KEY_VAULT_URL, AZURE_KEY_VAULT_KEY_NAME and AZURE_KEY_VAULT_BEARER_TOKEN in production mode.');
  }
  if (env.ALLOW_DEV_MOCK_KMS === 'true') {
    errors.push('ALLOW_DEV_MOCK_KMS must not be set in production mode.');
  }

  // Development sign-in shortcuts are ignored in production; having them set means the wrong
  // configuration was deployed, which is worth stopping for
  if (env.ENABLE_DEV_AUTH_BYPASS === 'true') {
    errors.push('ENABLE_DEV_AUTH_BYPASS must not be set in production mode.');
  }

  if (options.requireSignIn) {
    const google = (env.GOOGLE_CLIENT_ID || '').trim();
    const hasGoogle = google !== '' && google !== 'replace_with_your_client_id_here';
    const hasOidc = isSet(env.OIDC_ISSUER) && isSet(env.OIDC_AUDIENCE);
    if (!hasGoogle && !hasOidc) {
      errors.push('Production mode requires a sign-in provider: GOOGLE_CLIENT_ID, or OIDC_ISSUER with OIDC_AUDIENCE.');
    }
  }

  if (options.requireSearchMode) {
    const provider = (env.EMBEDDING_PROVIDER || '').trim().toLowerCase();
    if (provider === 'openai') {
      if (!isSet(env.OPENAI_API_KEY)) errors.push('EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY.');
    } else if (provider !== 'none') {
      errors.push('Production mode requires EMBEDDING_PROVIDER to be "openai" (semantic search) or "none" (keyword search only).');
    }
  }

  return errors;
}

/** Prints the problems and stops the process when a production deployment is misconfigured. */
export function assertProductionConfig(service: string, options: ProductionCheckOptions = {}, env: Env = process.env): void {
  const errors = productionConfigErrors(env, options);
  if (errors.length === 0) return;
  console.error(`[FATAL] ${service}: production configuration validation failed:`);
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

import { loadSecretsIntoEnv } from './secrets.js';

// Imported first by each service entry point. Modules that are imported after this one read
// process.env only once the secrets are in place. Without SECRETS_PROVIDER this does nothing.
const result = await loadSecretsIntoEnv();
if (result.provider) {
  console.log(`Loaded ${result.loaded.length} setting(s) from ${result.provider} secrets manager: ${result.loaded.join(', ')}`);
}

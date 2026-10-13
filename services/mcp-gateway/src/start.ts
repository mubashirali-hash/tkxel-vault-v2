// Must stay the first import: fills process.env from the secrets manager before other modules read it (NFR-09)
import '@tkxel-vault/vault-core/secrets-preload';
import { McpGatewayServer } from './server.js';
import { OAuthValidator, RedisRevocationStore, RevocationStore } from './auth/oauth.js';
import { Redis } from 'ioredis';
import { createPostgresToolAuditSink } from './audit/tool-audit.js';
import { withAnomalyDetection, createPostgresAnomalyBackend } from './audit/anomaly.js';
import { PostgresOpenVaultStore } from './tools/postgres-store.js';
import { getUserAccessibleVaults, createOidcVerifierFromEnv, getVaultRateLimits, assertProductionConfig } from '@tkxel-vault/vault-core';
import { RedisRateLimiter, type RateLimiter } from './rate-limiting/index.js';

// A production deployment without a real key service or a chosen search mode stops here (the
// sign-in provider is checked below, where the token verifier is built)
assertProductionConfig('MCP gateway', { requireSignIn: true, requireSearchMode: true });

const port = Number(process.env.PORT || 3001);
const vaultStore = new PostgresOpenVaultStore();

// Locally signed tokens are accepted only outside production, with the dev bypass explicitly enabled
// and an operator-supplied secret. There is no built-in default secret.
const devAuthEnabled = process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_AUTH_BYPASS === 'true';
const devHmacSecret = devAuthEnabled ? process.env.MCP_DEV_HMAC_SECRET : undefined;
if (devHmacSecret !== undefined && devHmacSecret.length < 32) {
  console.error('MCP_DEV_HMAC_SECRET must be at least 32 characters.');
  process.exit(1);
}

// Revocation must be shared by every gateway replica and the API server (FR-54, FR-55).
// Production refuses to start on a per-process store; a Redis outage rejects tokens (fail closed).
let revocationStore: RevocationStore | undefined;
// Rate limits are shared across replicas through the same Redis (FR-67)
let rateLimiter: RateLimiter | undefined;
if (process.env.REDIS_URL) {
  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on('error', (err: Error) => console.error('Revocation store (Redis) error:', err.message));
  revocationStore = new RedisRevocationStore(redis);
  rateLimiter = new RedisRateLimiter(redis as any);
} else if (process.env.NODE_ENV === 'production') {
  console.error('REDIS_URL is required in production: revocation must be shared across services.');
  process.exit(1);
}
const oauthValidator = new OAuthValidator(devHmacSecret, revocationStore, {
  // Set OIDC_ISSUER and OIDC_AUDIENCE to accept tokens from Microsoft Entra ID or another OIDC provider
  oidcVerifier: createOidcVerifierFromEnv() ?? undefined,
});
if (!oauthValidator.hasVerifier()) {
  console.error(
    'No token verifier configured. Set GOOGLE_CLIENT_ID or OIDC_ISSUER + OIDC_AUDIENCE, or for local development set ' +
      'ENABLE_DEV_AUTH_BYPASS=true and MCP_DEV_HMAC_SECRET (non-production only).'
  );
  process.exit(1);
}

const server = new McpGatewayServer({
  port,
  vaultStore,
  oauthValidator,
  rateLimiter,
  // Owner-configured limits, cached briefly so a limit change applies within half a minute
  vaultRateLimitResolver: (() => {
    const cache = new Map<string, { at: number; value: Awaited<ReturnType<typeof getVaultRateLimits>> }>();
    return async (vaultId: string) => {
      const hit = cache.get(vaultId);
      if (hit && Date.now() - hit.at < 30_000) return hit.value;
      const value = await getVaultRateLimits(vaultId);
      cache.set(vaultId, { at: Date.now(), value });
      return value;
    };
  })(),
  // Every tool call is audited, then checked for volume spikes and repeated denials (FR-80, FR-83)
  toolAuditSink: withAnomalyDetection(createPostgresToolAuditSink(), createPostgresAnomalyBackend()),
  accessResolver: async (userId: string) => {
    try {
      // Someone with no vault access gets no tools, in every mode: there is no placeholder access
      return await getUserAccessibleVaults(userId);
    } catch (err) {
      console.error('Error resolving vault access for user:', userId, err);
      return [];
    }
  },
});

async function main() {
  await server.listen();
  console.log(`\n======================================================`);
  console.log(`🚀 tkxel Vault MCP Gateway listening on http://localhost:${port}`);
  console.log(`📡 Transport: Anthropic Streamable HTTP (MCP 2025-11-25) & Stdio`);
  console.log(`🔒 Endpoints:`);
  console.log(`   - GET  http://localhost:${port}/health`);
  console.log(`   - POST http://localhost:${port}/mcp (Streamable HTTP JSON-RPC 2.0)`);
  console.log(`   - POST http://localhost:${port}/api/sso/deprovision`);
  console.log(`🛠️ Active Tools: list_vaults, search, get_page, get_links, get_context, add_note, list_skills, run_skill, ask_vault`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error('Failed to start MCP Gateway:', err);
  process.exit(1);
});

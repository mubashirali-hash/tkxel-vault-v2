/**
 * Dev auth bypass policy (FR-50): never in production, and only with an explicit opt-in flag.
 */
export function isDevAuthBypassEnabled(
  env: { NODE_ENV?: string; ENABLE_DEV_AUTH_BYPASS?: string } = process.env,
): boolean {
  return env.NODE_ENV !== 'production' && env.ENABLE_DEV_AUTH_BYPASS === 'true';
}

/**
 * SSO audience the API verifies ID tokens against. Returns null when unset so callers fail closed
 * instead of verifying a token without an audience check.
 */
export function getSsoAudience(env: { GOOGLE_CLIENT_ID?: string } = process.env): string | null {
  const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId || clientId === 'replace_with_your_client_id_here') return null;
  return clientId;
}

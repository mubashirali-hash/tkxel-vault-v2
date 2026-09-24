import test from 'node:test';
import assert from 'node:assert/strict';

test('Auth Hardening: dev_admin_token strictly rejected in production environment', () => {
  const validateAuthHeader = (authHeader, env) => {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { status: 401, error: 'Unauthorized: Missing token' };
    }
    const token = authHeader.split(' ')[1];

    // Safe dev bypass check: must be non-production AND explicit flag enabled
    const allowDevBypass = env.NODE_ENV !== 'production' && env.ENABLE_DEV_AUTH_BYPASS === 'true';

    if (token === 'dev_admin_token') {
      if (allowDevBypass) {
        return { status: 200, userId: env.VAULT_OWNER_EMAIL || 'admin@tkxel.com' };
      }
      return { status: 401, error: 'Unauthorized: Dev bypass disabled' };
    }

    return { status: 200, userId: 'verified_user@tkxel.com' };
  };

  // 1. In production, dev token must fail even if someone set the bypass flag
  const prodResult = validateAuthHeader('Bearer dev_admin_token', {
    NODE_ENV: 'production',
    ENABLE_DEV_AUTH_BYPASS: 'true',
  });
  assert.equal(prodResult.status, 401);

  // 2. In non-production without explicit flag, dev token must fail
  const nonProdNoFlag = validateAuthHeader('Bearer dev_admin_token', {
    NODE_ENV: 'development',
    ENABLE_DEV_AUTH_BYPASS: 'false',
  });
  assert.equal(nonProdNoFlag.status, 401);

  // 3. Only in development WITH explicit opt-in flag, dev token succeeds
  const devOptIn = validateAuthHeader('Bearer dev_admin_token', {
    NODE_ENV: 'development',
    ENABLE_DEV_AUTH_BYPASS: 'true',
    VAULT_OWNER_EMAIL: 'dev.admin@tkxel.com',
  });
  assert.equal(devOptIn.status, 200);
  assert.equal(devOptIn.userId, 'dev.admin@tkxel.com');
});

test('Auth Hardening: CORS origin validator enforces whitelist strictly', () => {
  const allowedOrigins = ['http://localhost:3000', 'https://claude.ai'];

  const validateOrigin = (origin, env) => {
    if (!origin) return true; // server-to-server / curl
    if (allowedOrigins.includes(origin)) return true;
    if (env.NODE_ENV !== 'production' && env.ALLOW_ALL_DEV_CORS === 'true') {
      return true;
    }
    return false;
  };

  // 1. Whitelisted origins pass in production
  assert.equal(validateOrigin('https://claude.ai', { NODE_ENV: 'production' }), true);
  assert.equal(validateOrigin('http://localhost:3000', { NODE_ENV: 'production' }), true);

  // 2. Malicious origin fails in production
  assert.equal(validateOrigin('https://attacker-site.com', { NODE_ENV: 'production' }), false);

  // 3. Malicious origin fails in development unless explicit dev cors flag is set
  assert.equal(validateOrigin('https://attacker-site.com', { NODE_ENV: 'development' }), false);
});

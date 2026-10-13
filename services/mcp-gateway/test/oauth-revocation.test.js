import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OAuthValidator,
  InMemoryRevocationStore,
} from '../dist/auth/oauth.js';

test('OAuth Validator: validates valid JWT with claims and extracts identity', async () => {
  const store = new InMemoryRevocationStore();
  const validator = new OAuthValidator('test-secret-key-32b-length-ok!!!', store);

  const token = validator.createToken({
    userId: 'usr_eng_123',
    email: 'alice@tkxel.com',
    groups: ['engineering', 'vault-readers'],
    expiresInSeconds: 300,
    tokenId: 'tok_test_1',
  });

  const claims = await validator.validateToken(`Bearer ${token}`);
  assert.equal(claims.userId, 'usr_eng_123');
  assert.equal(claims.email, 'alice@tkxel.com');
  assert.deepEqual(claims.groups, ['engineering', 'vault-readers']);
  assert.equal(claims.tokenId, 'tok_test_1');
});

test('OAuth Validator: rejects expired token or invalid signature', async () => {
  const validator = new OAuthValidator('test-secret-key-32b-length-ok!!!');

  // Expired token
  const expiredToken = validator.createToken({
    userId: 'usr_old',
    email: 'old@tkxel.com',
    expiresInSeconds: -10, // expired in past
  });

  await assert.rejects(
    async () => {
      await validator.validateToken(`Bearer ${expiredToken}`);
    },
    /Token has expired/
  );

  // Tampered token
  const validToken = validator.createToken({
    userId: 'usr_tamper',
    email: 'tamper@tkxel.com',
  });
  const tamperedToken = validToken.slice(0, -5) + 'xxxxx';

  await assert.rejects(
    async () => {
      await validator.validateToken(`Bearer ${tamperedToken}`);
    },
    /Invalid token signature/
  );
});

test('OAuth Fast Revocation: immediate token or user deprovisioning terminates session (<60s SLA)', async () => {
  const store = new InMemoryRevocationStore();
  const validator = new OAuthValidator('test-secret-key-32b-length-ok!!!', store);

  const token = validator.createToken({
    userId: 'usr_departing_employee',
    email: 'departing@tkxel.com',
    tokenId: 'tok_dep_1',
  });

  // 1. Initial call passes
  const claims = await validator.validateToken(`Bearer ${token}`);
  assert.equal(claims.userId, 'usr_departing_employee');

  // 2. Token-level revocation (e.g. user logout)
  await store.revokeToken('tok_dep_1');
  await assert.rejects(
    async () => {
      await validator.validateToken(`Bearer ${token}`);
    },
    /Token or user access has been revoked/
  );

  // 3. User-level revocation (e.g. corporate SSO deprovisioning webhook)
  const userToken2 = validator.createToken({
    userId: 'usr_departing_employee',
    email: 'departing@tkxel.com',
    tokenId: 'tok_dep_2',
  });

  await store.revokeUser('usr_departing_employee');
  await assert.rejects(
    async () => {
      await validator.validateToken(`Bearer ${userToken2}`);
    },
    /Token or user access has been revoked/
  );
});

test('Redis Revocation Store: enforces atomic revocation against live/mock Redis', async () => {
  const { RedisRevocationStore } = await import('../dist/auth/oauth.js');

  // Test with in-memory map mock of Redis key-value store
  const redisMap = new Map();
  const mockRedis = {
    async get(k) { return redisMap.get(k) || null; },
    async set(k, v) { redisMap.set(k, v); return 'OK'; },
  };

  const redisStore = new RedisRevocationStore(mockRedis);
  const validator = new OAuthValidator('test-secret-key-32b-length-ok!!!', redisStore);

  const token = validator.createToken({
    userId: 'usr_redis_test',
    email: 'redis@tkxel.com',
    tokenId: 'tok_redis_1',
  });

  // 1. Initial valid
  const claims = await validator.validateToken(`Bearer ${token}`);
  assert.equal(claims.userId, 'usr_redis_test');

  // 2. Revoke token
  await redisStore.revokeToken('tok_redis_1');
  assert.equal(await redisStore.isRevoked('usr_redis_test', 'tok_redis_1'), true);
  await assert.rejects(
    async () => {
      await validator.validateToken(`Bearer ${token}`);
    },
    /Token or user access has been revoked/
  );

  // 3. Revoke user
  const token2 = validator.createToken({
    userId: 'usr_redis_user_2',
    email: 'redis2@tkxel.com',
    tokenId: 'tok_redis_2',
  });
  await redisStore.revokeUser('usr_redis_user_2');
  assert.equal(await redisStore.isRevoked('usr_redis_user_2', 'tok_redis_2'), true);
  await assert.rejects(
    async () => {
      await validator.validateToken(`Bearer ${token2}`);
    },
    /Token or user access has been revoked/
  );
});

test('Regression 15.1: validator without an HMAC secret rejects locally signed tokens, including the former built-in default', async () => {
  const origClientId = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    const forged = new OAuthValidator('tkxel-vault-dev-sso-jwt-secret-key-32b').createToken({
      userId: 'victim@tkxel.com',
      email: 'victim@tkxel.com',
    });

    const validator = new OAuthValidator();
    assert.equal(validator.hasVerifier(), false);
    await assert.rejects(() => validator.validateToken(`Bearer ${forged}`), /Token verification failed/);
    assert.throws(
      () => validator.createToken({ userId: 'u', email: 'u@tkxel.com' }),
      /Local token signing is disabled/
    );
  } finally {
    if (origClientId) process.env.GOOGLE_CLIENT_ID = origClientId;
  }
});

test('Regression 15.1: locally signed token without exp is rejected', async () => {
  const crypto = await import('node:crypto');
  const secret = 'test-secret-key-32b-length-ok!!!';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: 'u', email: 'u@tkxel.com' })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');

  const validator = new OAuthValidator(secret);
  await assert.rejects(() => validator.validateToken(`Bearer ${header}.${body}.${sig}`), /Token has expired/);
});

test('Regression 15.25: Redis revocation keys are identity-normalized so gateway and API server agree', async () => {
  const { RedisRevocationStore, revokedUserKey } = await import('../dist/auth/oauth.js');
  const data = new Map();
  const fakeRedis = {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
      return 'OK';
    },
  };
  const store = new RedisRevocationStore(fakeRedis);
  const validator = new OAuthValidator('test-secret-key-32b-length-ok!!!', store);
  const token = validator.createToken({ userId: 'Alice@Tkxel.com', email: 'Alice@Tkxel.com' });

  await validator.validateToken(`Bearer ${token}`);
  await store.revokeUser('ALICE@tkxel.com');

  assert.equal(revokedUserKey(' Alice@Tkxel.com '), 'revoked:user:alice@tkxel.com');
  assert.ok(data.has('revoked:user:alice@tkxel.com'));
  await assert.rejects(() => validator.validateToken(`Bearer ${token}`), /revoked/);
});

test('Regression 15.25: an unreachable revocation store rejects the token (fail closed)', async () => {
  const { RedisRevocationStore } = await import('../dist/auth/oauth.js');
  const store = new RedisRevocationStore({
    get: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  const validator = new OAuthValidator('test-secret-key-32b-length-ok!!!', store);
  const token = validator.createToken({ userId: 'bob@tkxel.com', email: 'bob@tkxel.com' });
  await assert.rejects(() => validator.validateToken(`Bearer ${token}`));
});

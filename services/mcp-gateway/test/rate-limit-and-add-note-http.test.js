import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { McpGatewayServer } from '../dist/server.js';
import { OAuthValidator, InMemoryRevocationStore } from '../dist/auth/oauth.js';
import { SlidingWindowRateLimiter } from '../dist/rate-limiting/index.js';

const VAULT_OPEN = '11111111-2222-4333-8444-000000000001';
const VAULT_LOCKED = '11111111-2222-4333-8444-000000000002';

function post(port, token, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function buildServer(port, overrides = {}) {
  const oauth = new OAuthValidator('test-key-32b-gateway-secret-ok!', new InMemoryRevocationStore());
  const calls = [];
  const server = new McpGatewayServer({
    port,
    oauthValidator: oauth,
    vaultStore: {
      search: async () => [],
      getPage: async () => null,
      getLinks: async () => ({ nodes: [], edges: [] }),
      getContext: async () => ({ markdown: '', tokenEstimate: 0 }),
      addNote: async (params) => {
        calls.push(['addNote', params]);
        return { noteId: 'note_1', status: 'draft_created' };
      },
      appendTimelineEntry: async (params) => {
        calls.push(['appendTimelineEntry', params]);
        return { pageId: params.pageId, entryId: 'entry_1' };
      },
    },
    accessResolver: async () => [
      { vaultId: VAULT_OPEN, mode: 'open', role: 'editor' },
      { vaultId: VAULT_LOCKED, mode: 'locked', role: 'consumer' },
    ],
    ...overrides,
  });
  return { server, oauth, calls };
}

const call = (name, args, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

test('FR-67: locked tools and retrieval tools have separate per-user limits; protocol traffic is not counted', async () => {
  const { server, oauth } = buildServer(3895, {
    rateLimiter: new SlidingWindowRateLimiter({
      open: { maxRequests: 3, windowMs: 60_000 },
      locked: { maxRequests: 2, windowMs: 60_000 },
    }),
  });
  await server.listen();
  const alice = oauth.createToken({ userId: 'alice@tkxel.com', email: 'alice@tkxel.com' });
  const bob = oauth.createToken({ userId: 'bob@tkxel.com', email: 'bob@tkxel.com' });

  try {
    // initialize / tools/list never consume quota
    for (let i = 0; i < 10; i++) {
      assert.equal((await post(3895, alice, { jsonrpc: '2.0', id: i, method: 'tools/list' })).status, 200);
    }

    // Locked budget: 2
    assert.equal((await post(3895, alice, call('list_skills', { vaultId: VAULT_LOCKED }))).status, 200);
    assert.equal((await post(3895, alice, call('ask_vault', { vaultId: VAULT_LOCKED, query: 'x' }))).status, 200);
    const lockedBlocked = await post(3895, alice, call('run_skill', { vaultId: VAULT_LOCKED, skillName: 's' }));
    assert.equal(lockedBlocked.status, 429);
    assert.equal(lockedBlocked.json.error.message, 'rate_limited');

    // Retrieval budget is independent: 3
    for (let i = 0; i < 3; i++) {
      assert.equal((await post(3895, alice, call('search', { query: 'q', vault_id: VAULT_OPEN }))).status, 200);
    }
    assert.equal((await post(3895, alice, call('search', { query: 'q', vault_id: VAULT_OPEN }))).status, 429);

    // Limits are per user
    assert.equal((await post(3895, bob, call('list_skills', { vaultId: VAULT_LOCKED }))).status, 200);
  } finally {
    await server.close();
  }
});

test('FR-66: add_note appends to a page timeline when page_id is given, otherwise saves an /inbox draft', async () => {
  const { server, oauth, calls } = buildServer(3894);
  await server.listen();
  const token = oauth.createToken({ userId: 'alice@tkxel.com', email: 'alice@tkxel.com' });
  const pageId = '22222222-2222-4333-8444-000000000009';

  try {
    const timeline = await post(3894, token, call('add_note', { vault_id: VAULT_OPEN, page_id: pageId, entry: 'Kickoff call held' }));
    assert.equal(timeline.status, 200);
    assert.ok(!timeline.json.result.isError);
    assert.deepEqual(JSON.parse(timeline.json.result.content[0].text), {
      page_id: pageId,
      entry_id: 'entry_1',
      status: 'timeline_entry_added',
    });
    assert.deepEqual(calls[0], ['appendTimelineEntry', { vaultId: VAULT_OPEN, pageId, entry: 'Kickoff call held', authorId: 'alice@tkxel.com' }]);

    const draft = await post(3894, token, call('add_note', { vault_id: VAULT_OPEN, title: 'Meeting notes', entry: 'Body text' }));
    assert.ok(!draft.json.result.isError);
    assert.equal(calls[1][0], 'addNote');
    assert.equal(calls[1][1].title, 'Meeting notes');
    assert.equal(calls[1][1].content, 'Body text');

    // `content` remains accepted as an alias of `entry`
    await post(3894, token, call('add_note', { vault_id: VAULT_OPEN, title: 'Alias', content: 'Via content' }));
    assert.equal(calls[2][1].content, 'Via content');

    const noEntry = await post(3894, token, call('add_note', { vault_id: VAULT_OPEN, title: 'Empty' }));
    assert.equal(noEntry.json.result.isError, true);
    const noTitle = await post(3894, token, call('add_note', { vault_id: VAULT_OPEN, entry: 'orphan' }));
    assert.equal(noTitle.json.result.isError, true);
    assert.equal(calls.length, 3, 'Invalid requests must not reach the store');

    // Locked vault is never a valid destination
    const locked = await post(3894, token, call('add_note', { vault_id: VAULT_LOCKED, page_id: pageId, entry: 'x' }));
    assert.equal(locked.json.result.isError, true);
    assert.equal(calls.length, 3);
  } finally {
    await server.close();
  }
});

test('FR-67: an Owner-configured vault limit applies per user and per vault', async () => {
  const VAULT_OTHER = '11111111-2222-4333-8444-000000000003';
  const oauth = new OAuthValidator('test-key-32b-gateway-secret-ok!', new InMemoryRevocationStore());
  const server = new McpGatewayServer({
    port: 3892,
    oauthValidator: oauth,
    vaultStore: {
      search: async () => [],
      getPage: async () => null,
      getLinks: async () => ({ nodes: [], edges: [] }),
      getContext: async () => ({ markdown: '', tokenEstimate: 0 }),
      addNote: async () => ({ noteId: 'n', status: 'draft_created' }),
    },
    accessResolver: async () => [
      { vaultId: VAULT_OPEN, mode: 'open', role: 'reader' },
      { vaultId: VAULT_OTHER, mode: 'open', role: 'reader' },
    ],
    // The Owner of VAULT_OPEN lowered retrieval to 2 per hour; VAULT_OTHER keeps the platform default
    vaultRateLimitResolver: async (vaultId) => (vaultId === VAULT_OPEN ? { retrieval_per_hour: 2 } : {}),
  });
  await server.listen();
  const alice = oauth.createToken({ userId: 'alice@tkxel.com', email: 'alice@tkxel.com' });
  const bob = oauth.createToken({ userId: 'bob@tkxel.com', email: 'bob@tkxel.com' });
  const search = (token, vault) => post(3892, token, call('search', { query: 'q', vault_id: vault }));

  try {
    assert.equal((await search(alice, VAULT_OPEN)).status, 200);
    assert.equal((await search(alice, VAULT_OPEN)).status, 200);
    assert.equal((await search(alice, VAULT_OPEN)).status, 429, 'the vault limit of 2 is enforced');

    // A different vault has its own budget, and so does a different user
    assert.equal((await search(alice, VAULT_OTHER)).status, 200);
    assert.equal((await search(bob, VAULT_OPEN)).status, 200);
  } finally {
    await server.close();
  }
});

test('FR-67: Redis limiter is a shared, atomic sliding window and fails closed', async () => {
  const { Redis } = await import('ioredis');
  const { RedisRateLimiter, RateLimitExceededError } = await import('../dist/rate-limiting/index.js');
  const redis = new Redis(process.env.REDIS_TEST_URL || process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
  });
  const user = `ratelimit-test-${Date.now()}-${Math.random().toString(36).slice(2)}@tkxel.com`;

  try {
    // Two limiter instances stand in for two gateway replicas sharing one budget
    const limits = { locked: { maxRequests: 3, windowMs: 60_000 }, open: { maxRequests: 50, windowMs: 60_000 } };
    const replicaA = new RedisRateLimiter(redis, limits);
    const replicaB = new RedisRateLimiter(redis, limits);

    await replicaA.checkLimit(user, 'locked');
    await replicaB.checkLimit(user, 'locked');
    await replicaA.checkLimit(user, 'locked');
    await assert.rejects(() => replicaB.checkLimit(user, 'locked'), RateLimitExceededError);

    // Classes and scopes are independent budgets; a per-call ceiling overrides the default
    await replicaA.checkLimit(user, 'open');
    await replicaA.checkLimit(user, 'locked', { scope: 'vault-1' });
    await replicaA.checkLimit(user, 'open', { scope: 'vault-2', maxRequests: 1 });
    await assert.rejects(() => replicaA.checkLimit(user, 'open', { scope: 'vault-2', maxRequests: 1 }), RateLimitExceededError);

    // Concurrent calls can never overshoot the limit
    const burstUser = `${user}-burst`;
    const burst = await Promise.allSettled(Array.from({ length: 20 }, () => replicaA.checkLimit(burstUser, 'locked')));
    assert.equal(burst.filter((r) => r.status === 'fulfilled').length, 3);

    // Store unreachable -> the call is refused
    const broken = new RedisRateLimiter({ eval: async () => { throw new Error('ECONNREFUSED'); } }, limits);
    await assert.rejects(() => broken.checkLimit(user, 'open'), RateLimitExceededError);
  } finally {
    const keys = await redis.keys(`ratelimit:${user.toLowerCase()}*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  }
});

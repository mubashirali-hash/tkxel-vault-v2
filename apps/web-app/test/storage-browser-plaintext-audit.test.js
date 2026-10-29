import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Setup Mock localStorage and sessionStorage for Node environment
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) || null,
  setItem: (key, val) => store.set(key, String(val)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  get length() {
    return store.size;
  },
  key: (i) => Array.from(store.keys())[i] || null,
};

const sessionStore = new Map();
globalThis.sessionStorage = {
  getItem: (key) => sessionStore.get(key) || null,
  setItem: (key, val) => sessionStore.set(key, String(val)),
  removeItem: (key) => sessionStore.delete(key),
  clear: () => sessionStore.clear(),
  get length() {
    return sessionStore.size;
  },
  key: (i) => Array.from(sessionStore.keys())[i] || null,
};

// Import storage functions
const { saveVaultLocalCache, getVaultLocalCache, clearVaultState, getAuthToken, setAuthToken, removeAuthToken } = await import('../src/utils/storage.ts');

test('Epic 2.3: Browser Persistence Plaintext Canary & Locked Vault Audit', async (t) => {
  const vaultOpenId = randomUUID();
  const vaultLockedId = randomUUID();
  const openCanary = `CANARY_BROWSER_OPEN_${randomUUID()}`;
  const lockedCanary = `CANARY_BROWSER_LOCKED_${randomUUID()}`;

  // -------------------------------------------------------------------------
  // Test 1: saveVaultLocalCache strips plaintext note content from localStorage
  // -------------------------------------------------------------------------
  await t.test('Browser Storage: Plaintext note bodies and canaries are never stored in localStorage', () => {
    store.clear();

    const samplePage = {
      id: randomUUID(),
      vault_id: vaultOpenId,
      type: 'note',
      title: 'Confidential Strategy',
      folder: 'Internal',
      tags: ['strategy', 'roadmap'],
      content: `# Secret Heading\n\n${openCanary} must never be cached in localStorage.`,
      front_matter: {
        title: 'Confidential Strategy',
        folder: 'Internal',
        body: openCanary,
      },
      created_at: new Date(),
      updated_at: new Date(),
    };

    saveVaultLocalCache(vaultOpenId, { pages: [samplePage] }, 'open');

    const rawCache = store.get(`tkxel_vault_cache_${vaultOpenId}`);
    assert.ok(rawCache, 'Cache record should be created for open vault');

    // Canary must NOT exist in the serialized raw JSON string
    assert.ok(
      !rawCache.includes(openCanary),
      `Plaintext canary ${openCanary} found in localStorage!`
    );

    // Parsed inspection
    const parsed = JSON.parse(rawCache);
    assert.equal(parsed.pages[0].content, undefined, 'page.content must not be persisted');
    assert.equal(parsed.pages[0].front_matter?.body, undefined, 'front_matter.body must not be persisted');
    assert.equal(parsed.pages[0].title, 'Confidential Strategy', 'metadata like title should be retained');
  });

  // -------------------------------------------------------------------------
  // Test 2: Locked skills are never cached in localStorage
  // -------------------------------------------------------------------------
  await t.test('Browser Storage: lockedSkills are excluded from localStorage persistence', () => {
    store.clear();

    const mockSkill = {
      id: randomUUID(),
      name: 'AuditSkill',
      version: '1.0.0',
      description: 'Zero-read runner',
      runtime: 'node20',
      timeout_seconds: 30,
      system_instructions: 'Super confidential skill instructions',
      created_at: new Date(),
    };

    saveVaultLocalCache(vaultOpenId, { lockedSkills: [mockSkill] }, 'open');

    const rawCache = store.get(`tkxel_vault_cache_${vaultOpenId}`);
    if (rawCache) {
      const parsed = JSON.parse(rawCache);
      assert.ok(!parsed.lockedSkills || parsed.lockedSkills.length === 0, 'lockedSkills must not be persisted');
    }
  });

  // -------------------------------------------------------------------------
  // Test 3: Locked vaults are NEVER stored in localStorage
  // -------------------------------------------------------------------------
  await t.test('Locked Vault Invariant: Locked vault mode purges cache and permits zero browser storage', () => {
    store.clear();

    // Pre-populate stale cache to test purge
    store.set(`tkxel_vault_cache_${vaultLockedId}`, JSON.stringify({ stale: true }));

    const lockedPage = {
      id: randomUUID(),
      vault_id: vaultLockedId,
      type: 'note',
      title: 'Classified IP',
      content: lockedCanary,
      created_at: new Date(),
    };

    saveVaultLocalCache(vaultLockedId, { pages: [lockedPage] }, 'locked');

    // Locked vault cache MUST be purged / null
    assert.equal(
      localStorage.getItem(`tkxel_vault_cache_${vaultLockedId}`),
      null,
      'Locked vault cache was not purged from localStorage'
    );
  });

  // -------------------------------------------------------------------------
  // Test 4: getVaultLocalCache returns sanitized empty content
  // -------------------------------------------------------------------------
  await t.test('Browser Retrieval: getVaultLocalCache returns empty note content and empty lockedSkills', () => {
    store.clear();

    // Store dummy entry directly simulating legacy or sanitized cache
    store.set(`tkxel_vault_cache_${vaultOpenId}`, JSON.stringify({
      pages: [
        {
          id: 'pg_1',
          vault_id: vaultOpenId,
          title: 'Cached Note',
          created_at: new Date().toISOString(),
          content: 'legacy leaked content',
        },
      ],
      lockedSkills: [
        { id: 'sk_1', name: 'LeakedSkill' }
      ],
    }));

    const result = getVaultLocalCache(vaultOpenId);
    assert.ok(result);
    assert.equal(result.pages[0].content, '', 'getVaultLocalCache must return empty string for note content');
    assert.deepEqual(result.lockedSkills, [], 'getVaultLocalCache must return empty array for lockedSkills');
  });

  // -------------------------------------------------------------------------
  // Test 5: clearVaultState purges all tkxel_vault_cache_* keys
  // -------------------------------------------------------------------------
  await t.test('Cache Eviction: clearVaultState clears all vault cache entries', async () => {
    store.clear();
    store.set('tkxel_vault_storage_v1', 'old_data');
    store.set('tkxel_vault_cache_v1', 'cache_1');
    store.set('tkxel_vault_cache_v2', 'cache_2');
    store.set('unrelated_key', 'keep_me');

    await clearVaultState();

    assert.equal(localStorage.getItem('tkxel_vault_storage_v1'), null);
    assert.equal(localStorage.getItem('tkxel_vault_cache_v1'), null);
    assert.equal(localStorage.getItem('tkxel_vault_cache_v2'), null);
    assert.equal(localStorage.getItem('unrelated_key'), 'keep_me');
  });

  // -------------------------------------------------------------------------
  // Test 6: Bearer token is stored in sessionStorage and NOT localStorage
  // -------------------------------------------------------------------------
  await t.test('Auth Token Security: ssoToken resides in sessionStorage and is purged from localStorage', () => {
    store.clear();
    sessionStore.clear();

    const sampleJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.do_not_persist_in_localstorage';

    // Set token using secure helper
    setAuthToken(sampleJwt);

    // Assert: NEVER in localStorage
    assert.equal(
      localStorage.getItem('ssoToken'),
      null,
      'Bearer token must NEVER be written to localStorage!'
    );

    // Assert: Stored in sessionStorage
    assert.equal(
      sessionStorage.getItem('ssoToken'),
      sampleJwt,
      'Bearer token must reside in sessionStorage'
    );

    // Assert: getAuthToken retrieves it
    assert.equal(getAuthToken(), sampleJwt);

    // Test legacy migration: if token somehow existed in localStorage, reading it purges it from localStorage
    localStorage.setItem('ssoToken', 'legacy_leaked_token');
    const migrated = getAuthToken();
    assert.equal(localStorage.getItem('ssoToken'), null, 'getAuthToken must scrub legacy token from localStorage');

    // Test removeAuthToken: clears both stores
    removeAuthToken();
    assert.equal(localStorage.getItem('ssoToken'), null);
    assert.equal(sessionStorage.getItem('ssoToken'), null);
  });
});

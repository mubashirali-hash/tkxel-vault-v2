import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpenRetrievalHandlers } from '../dist/tools/open-retrieval.js';

const VAULT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VAULT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function createRecordingStore() {
  const calls = [];
  return {
    calls,
    search: async (...args) => {
      calls.push(['search', ...args]);
      return [{ id: 'page-a', title: 'Allowed', snippet: 'allowed' }];
    },
    getPage: async (...args) => {
      calls.push(['getPage', ...args]);
      return { title: 'Allowed', content: 'allowed', tags: [], backlinks: [] };
    },
    getLinks: async (...args) => {
      calls.push(['getLinks', ...args]);
      return { nodes: [], edges: [] };
    },
    getContext: async (...args) => {
      calls.push(['getContext', ...args]);
      return { markdown: 'allowed', tokenEstimate: 1 };
    },
    addNote: async (...args) => {
      calls.push(['addNote', ...args]);
      return { noteId: 'note-a', status: 'created' };
    },
  };
}

const readerContext = {
  userId: 'reader@example.com',
  roles: new Map([[VAULT_A, 'reader']]),
  vaultModes: new Map([[VAULT_A, 'open']]),
};

test('open retrieval authorizes the exact requested vault before calling storage', async () => {
  const store = createRecordingStore();
  const handlers = createOpenRetrievalHandlers(store);

  const allowed = await handlers.handleSearch(
    { query: 'policy', vault_id: VAULT_A },
    readerContext,
  );
  assert.equal(JSON.parse(allowed.content[0].text)[0].id, 'page-a');
  assert.equal(store.calls.length, 1);

  await assert.rejects(
    handlers.handleSearch(
      { query: 'merger', vault_id: VAULT_B },
      readerContext,
    ),
    { message: 'not_allowed' },
  );
  assert.equal(store.calls.length, 1, 'unauthorized requests must not reach storage');
});

test('every open read handler rejects a vault not present in caller roles', async () => {
  const store = createRecordingStore();
  const handlers = createOpenRetrievalHandlers(store);

  const attempts = [
    () => handlers.handleGetPage({ title: 'Secret', vault_id: VAULT_B }, readerContext),
    () => handlers.handleGetLinks({ page_id: 'secret-page', vault_id: VAULT_B }, readerContext),
    () => handlers.handleGetContext({ query: 'secret', vault_id: VAULT_B }, readerContext),
  ];

  for (const attempt of attempts) {
    await assert.rejects(attempt(), { message: 'not_allowed' });
  }
  assert.equal(store.calls.length, 0, 'unauthorized requests must not reach storage');
});

test('open retrieval requires explicit vault_id instead of using a default vault', async () => {
  const store = createRecordingStore();
  const handlers = createOpenRetrievalHandlers(store);

  await assert.rejects(
    handlers.handleSearch({ query: 'policy' }, readerContext),
    { message: 'not_allowed' },
  );
  assert.equal(store.calls.length, 0);
});

test('add_note requires owner or editor on the exact requested vault', async () => {
  const store = createRecordingStore();
  const handlers = createOpenRetrievalHandlers(store);

  await assert.rejects(
    handlers.handleAddNote(
      { vault_id: VAULT_A, title: 'Denied', content: 'No write' },
      readerContext,
    ),
    { message: 'not_allowed' },
  );
  assert.equal(store.calls.length, 0);

  const editorContext = {
    userId: 'editor@example.com',
    roles: new Map([[VAULT_A, 'editor']]),
    vaultModes: new Map([[VAULT_A, 'open']]),
  };
  const result = await handlers.handleAddNote(
    { vault_id: VAULT_A, title: 'Allowed', content: 'Write' },
    editorContext,
  );
  assert.match(result.content[0].text, /note-a/);
  assert.equal(store.calls.length, 1);
});

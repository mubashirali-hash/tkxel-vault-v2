import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRetrievalHandlers, SEARCH_TOOL, GET_PAGE_TOOL, GET_LINKS_TOOL } from '../dist/tools/open-retrieval.js';
import { RUN_SKILL_TOOL, ASK_VAULT_TOOL, ASK_VAULT_MAX_CHARS, toLockedToolErrorCode } from '../dist/tools/locked-tools.js';

const VAULT_A = 'vault-a';
const VAULT_B = 'vault-b';
const VAULT_C = 'vault-c-not-shared';

const context = {
  userId: 'reader@example.com',
  roles: new Map([[VAULT_A, 'reader'], [VAULT_B, 'editor']]),
  vaultModes: new Map([[VAULT_A, 'open'], [VAULT_B, 'open']]),
};

function makeStore() {
  const calls = [];
  return {
    calls,
    search: async (query, vaultId, limit, filters) => {
      calls.push(['search', vaultId, filters]);
      return vaultId === VAULT_A
        ? [{ id: 'p1', title: 'Acme Corp', snippet: '', type: 'client', score: 0.4 }]
        : [{ id: 'p2', title: 'Acme Proposal', snippet: '', type: 'project', score: 0.9 }];
    },
    getPage: async (reference, vaultId) => {
      calls.push(['getPage', reference, vaultId]);
      return {
        id: 'p1',
        title: 'Acme Corp',
        type: 'client',
        content: 'Body with [[Sara Khan]].',
        tags: ['fintech'],
        backlinks: ['Acme Proposal'],
        front_matter: { title: 'Acme Corp', status: 'active' },
        links_out: ['Sara Khan'],
        timeline: [{ date: '2026-09-02', entry: 'Kickoff call held' }],
      };
    },
    getLinks: async (pageId, vaultId, maxHops) => {
      calls.push(['getLinks', pageId, vaultId, maxHops]);
      return {
        nodes: [{ id: 'p1', label: 'Acme Corp', title: 'Acme Corp', type: 'client' }, { id: 'p2', label: 'Legacy Node' }],
        edges: [{ from: 'p1', to: 'p2', type: 'works_at' }, { from: 'p2', to: 'p1' }],
      };
    },
    getContext: async () => ({
      markdown: 'M'.repeat(5000),
      tokenEstimate: 1250,
      pages: [
        { title: 'Acme Corp', body_markdown: 'A'.repeat(600) },
        { title: 'Acme Proposal', body_markdown: 'B'.repeat(600) },
      ],
    }),
    addNote: async () => ({ noteId: 'n1', status: 'draft_created' }),
  };
}

test('SRS 5.1 search: `vaults`, `types` and `tags` are honoured and results carry page_id, vault, type, score', async () => {
  const store = makeStore();
  const handlers = createOpenRetrievalHandlers(store);

  const result = await handlers.handleSearch(
    { query: 'acme', vaults: [VAULT_A, VAULT_B], types: ['client', 'project'], tags: ['fintech'], limit: 5 },
    context
  );
  const rows = JSON.parse(result.content[0].text);
  assert.deepEqual(rows.map((r) => [r.page_id, r.vault, r.type, r.score]), [
    ['p2', VAULT_B, 'project', 0.9],
    ['p1', VAULT_A, 'client', 0.4],
  ]);
  assert.deepEqual(result.structuredContent.results, rows);
  assert.deepEqual(store.calls[0][2], { types: ['client', 'project'], tags: ['fintech'] });

  // One unauthorized vault in the list denies the whole call before storage is touched
  const before = store.calls.length;
  await assert.rejects(
    handlers.handleSearch({ query: 'acme', vaults: [VAULT_A, VAULT_C] }, context),
    { message: 'not_allowed' }
  );
  assert.equal(store.calls.length, before);

  assert.ok(SEARCH_TOOL.inputSchema.properties.vaults && SEARCH_TOOL.inputSchema.properties.types);
});

test('SRS 5.1 get_page / get_links / get_context: SRS argument names and structured results', async () => {
  const store = makeStore();
  const handlers = createOpenRetrievalHandlers(store);

  const page = await handlers.handleGetPage({ page_id: 'p1', vault_id: VAULT_A }, context);
  assert.deepEqual(store.calls[0], ['getPage', 'p1', VAULT_A]);
  assert.deepEqual(Object.keys(page.structuredContent).sort(), [
    'backlinks', 'body_markdown', 'front_matter', 'links_out', 'timeline', 'title', 'type',
  ]);
  assert.equal(page.structuredContent.body_markdown, 'Body with [[Sara Khan]].');
  assert.equal(page.structuredContent.timeline[0].date, '2026-09-02');
  assert.ok(GET_PAGE_TOOL.inputSchema.properties.page_id);

  const links = await handlers.handleGetLinks({ page_id: 'p1', vault_id: VAULT_A, depth: 2 }, context);
  assert.equal(store.calls[1][3], 2, '`depth` is the SRS name for traversal depth');
  assert.deepEqual(links.structuredContent.nodes[0], { id: 'p1', title: 'Acme Corp', type: 'client', label: 'Acme Corp' });
  assert.deepEqual(links.structuredContent.nodes[1], { id: 'p2', title: 'Legacy Node', type: 'note', label: 'Legacy Node' });
  assert.deepEqual(links.structuredContent.edges, [
    { from: 'p1', to: 'p2', type: 'works_at' },
    { from: 'p2', to: 'p1', type: 'wiki' },
  ]);
  assert.ok(GET_LINKS_TOOL.inputSchema.properties.depth);

  // max_tokens is a real budget (about 4 characters per token)
  const ctx = await handlers.handleGetContext({ query: 'acme', vault_id: VAULT_A, max_tokens: 200 }, context);
  assert.ok(ctx.content[0].text.length <= 800 + 60);
  const totalBody = ctx.structuredContent.pages.reduce((n, p) => n + p.body_markdown.length, 0);
  assert.ok(totalBody <= 800);
  assert.equal(ctx.structuredContent.pages[0].title, 'Acme Corp');
});

test('SRS 5.2 locked tools: SRS argument names are declared and failures map to SRS error codes', () => {
  assert.ok(RUN_SKILL_TOOL.inputSchema.properties.skill && RUN_SKILL_TOOL.inputSchema.properties.inputs);
  assert.ok(ASK_VAULT_TOOL.inputSchema.properties.vault && ASK_VAULT_TOOL.inputSchema.properties.question);
  assert.equal(ASK_VAULT_MAX_CHARS, 1500);

  assert.equal(toLockedToolErrorCode('aborted'), 'timeout');
  assert.equal(toLockedToolErrorCode(504), 'timeout');
  assert.equal(toLockedToolErrorCode(429), 'rate_limited');
  assert.equal(toLockedToolErrorCode(400), 'invalid_input');
  assert.equal(toLockedToolErrorCode(403), 'not_allowed');
  assert.equal(toLockedToolErrorCode(404), 'not_allowed');
  assert.equal(toLockedToolErrorCode(500), 'execution_failed');
});

test('FR-93: list_vaults lets a client discover usable vault IDs, limited to the caller\'s own access', async () => {
  const { createVaultDiscoveryHandler, LIST_VAULTS_TOOL } = await import('../dist/tools/vault-discovery.js');
  const { ToolPalettePolicy } = await import('../dist/auth/policy.js');

  const asked = [];
  const handler = createVaultDiscoveryHandler(async (ids) => {
    asked.push(...ids);
    return new Map([['v-open', 'Engineering Wiki'], ['v-locked', 'Delivery Skills'], ['v-edit', 'Client Notes']]);
  });

  const result = await handler({}, {
    userId: 'u@example.com',
    roles: new Map([['v-open', 'reader'], ['v-edit', 'editor'], ['v-locked', 'consumer'], ['v-odd', 'reader']]),
    // v-odd is a locked vault with a role that grants nothing there
    vaultModes: new Map([['v-open', 'open'], ['v-edit', 'open'], ['v-locked', 'locked'], ['v-odd', 'locked']]),
  });

  assert.deepEqual(result.structuredContent.vaults, [
    { vault_id: 'v-edit', name: 'Client Notes', mode: 'open', role: 'editor', tools: ['search', 'get_page', 'get_links', 'get_context', 'add_note'] },
    { vault_id: 'v-locked', name: 'Delivery Skills', mode: 'locked', role: 'consumer', tools: ['list_skills', 'run_skill', 'ask_vault'] },
    { vault_id: 'v-open', name: 'Engineering Wiki', mode: 'open', role: 'reader', tools: ['search', 'get_page', 'get_links', 'get_context'] },
  ]);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent.vaults);
  assert.deepEqual(asked.sort(), ['v-edit', 'v-locked', 'v-open'], 'names are only looked up for vaults the caller can use');
  assert.deepEqual(LIST_VAULTS_TOOL.inputSchema.required, []);

  const policy = new ToolPalettePolicy();
  assert.equal(policy.computeAuthorizedTools([]).has('list_vaults'), false, 'nothing to discover without access');
  assert.ok(policy.computeAuthorizedTools([{ vaultId: 'v', mode: 'locked', role: 'consumer' }]).has('list_vaults'));
  assert.ok(policy.computeAuthorizedTools([{ vaultId: 'v', mode: 'open', role: 'reader' }]).has('list_vaults'));
});

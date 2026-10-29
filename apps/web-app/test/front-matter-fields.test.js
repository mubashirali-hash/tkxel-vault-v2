import { register } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

register(new URL('./helpers/tsx-loader.js', import.meta.url).href, import.meta.url);

const { extractCustomFields, customFieldsToYaml, parseCustomFieldsYaml } = await import('../src/utils/front-matter-fields.ts');
const { applyPageSave } = await import('../src/operations/index.js');

test('FR-05: custom front matter fields are separated from the reserved keys', () => {
  const custom = extractCustomFields({
    title: 'Acme Corp',
    type: 'client',
    tags: ['fintech'],
    aliases: ['Acme'],
    folder: 'Clients',
    body: 'legacy',
    owner: '[[Sara Khan]]',
    status: 'active',
    renewal: { date: '2027-01-01', value: 120000 },
  });
  assert.deepEqual(custom, { owner: '[[Sara Khan]]', status: 'active', renewal: { date: '2027-01-01', value: 120000 } });
  assert.deepEqual(extractCustomFields(undefined), {});
});

test('FR-05: YAML round-trips losslessly, including wiki-links, nesting and lists', () => {
  const fields = { owner: '[[Sara Khan]]', status: 'active', stakeholders: ['[[Ali]]', '[[Noor]]'], renewal: { date: '2027-01-01', value: 120000 } };
  const yaml = customFieldsToYaml(fields);
  const parsed = parseCustomFieldsYaml(yaml);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.fields, fields);
  assert.equal(customFieldsToYaml({}), '');
  assert.deepEqual(parseCustomFieldsYaml('   '), { ok: true, fields: {} });
});

test('FR-05: invalid or conflicting input is reported, never silently applied', () => {
  assert.equal(parseCustomFieldsYaml('status: [unclosed').ok, false);
  assert.equal(parseCustomFieldsYaml('- just\n- a list').ok, false);
  assert.equal(parseCustomFieldsYaml('plain text').ok, false);
  const reserved = parseCustomFieldsYaml('title: Hijack\nstatus: active');
  assert.equal(reserved.ok, false);
  assert.match(reserved.error, /title/);
  assert.equal(parseCustomFieldsYaml('a: ' + 'x'.repeat(20000)).ok, false);
});

test('FR-05: saving a page replaces its custom fields and keeps the reserved ones', () => {
  const page = {
    id: 'p1',
    vault_id: 'v1',
    type: 'client',
    title: 'Acme Corp',
    aliases: [],
    tags: ['fintech'],
    content: 'Body',
    front_matter: { title: 'Acme Corp', type: 'client', status: 'prospect', dropped: 'old value' },
    created_at: new Date(),
  };
  const result = applyPageSave({
    pages: [page],
    activePage: page,
    updated: { title: 'Acme Corp', content: 'Body', tags: ['fintech'], type: 'client', frontMatter: { status: 'active', owner: '[[Sara Khan]]' } },
  });
  const fm = result.updatedActivePage.front_matter;
  assert.equal(fm.status, 'active');
  assert.equal(fm.owner, '[[Sara Khan]]');
  assert.equal(fm.dropped, undefined, 'a removed field is removed');
  assert.equal(fm.title, 'Acme Corp');
  assert.equal(fm.type, 'client');

  // Without custom fields in the payload (older callers), existing fields are left alone
  const untouched = applyPageSave({
    pages: [page],
    activePage: page,
    updated: { title: 'Acme Corp', content: 'Body', tags: ['fintech'], type: 'client' },
  });
  assert.equal(untouched.updatedActivePage.front_matter.dropped, 'old value');
});

test('FR-42: side-by-side comparison aligns unchanged lines and marks additions and removals', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.sessionStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const { alignLines } = await import('../src/components/editor/VersionHistoryPanel.tsx');

  const rows = alignLines('# Title\nold line\nshared tail', '# Title\nnew line\nextra line\nshared tail');
  assert.deepEqual(rows, [
    { left: '# Title', right: '# Title', changed: false },
    { left: 'old line', right: null, changed: true },
    { left: null, right: 'new line', changed: true },
    { left: null, right: 'extra line', changed: true },
    { left: 'shared tail', right: 'shared tail', changed: false },
  ]);

  // Identical texts produce no changed rows; every line of both sides is always represented
  assert.ok(alignLines('a\nb', 'a\nb').every((r) => !r.changed));
  const mixed = alignLines('a\nb\nc', 'b\nc\nd');
  assert.deepEqual(mixed.map((r) => r.left).filter((v) => v !== null), ['a', 'b', 'c']);
  assert.deepEqual(mixed.map((r) => r.right).filter((v) => v !== null), ['b', 'c', 'd']);
});

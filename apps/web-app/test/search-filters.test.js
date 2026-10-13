import { register } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

register(new URL('./helpers/tsx-loader.js', import.meta.url).href, import.meta.url);

const { NO_FILTERS, hasActiveFilters, buildSearchQuery, matchesFilters } = await import('../src/utils/search-filters.ts');

test('FR-20: search filters are sent with the parameter names the server reads', () => {
  assert.equal(hasActiveFilters(NO_FILTERS), false);
  assert.equal(buildSearchQuery('v1', 'renewal plan', NO_FILTERS), 'vaultId=v1&q=renewal+plan');
  const filters = { type: 'client', tag: 'q3 & beyond', updatedFrom: '2026-09-01' };
  assert.equal(hasActiveFilters(filters), true);
  const params = new URLSearchParams(buildSearchQuery('v1', 'a&b=c', filters));
  assert.deepEqual(Object.fromEntries(params), { vaultId: 'v1', q: 'a&b=c', types: 'client', tags: 'q3 & beyond', from: '2026-09-01' });

  const server = fs.readFileSync(new URL('../../api-server/src/server.ts', import.meta.url), 'utf8');
  for (const name of ['req.query.types', 'req.query.tags', 'req.query.from']) assert.ok(server.includes(name), `${name} is read by the server`);
});

test('FR-20: the same filters narrow pages already in the browser', () => {
  const pages = [
    { title: 'Acme', type: 'client', tags: ['Enterprise', 'renewal'], updated_at: new Date('2026-09-15T10:00:00') },
    { title: 'Kickoff', type: 'meeting', tags: ['renewal'], updated_at: '2026-08-01T10:00:00' },
    { title: 'Loose note', tags: [], created_at: new Date('2026-09-20T08:00:00') },
  ];
  const titles = (filters) => pages.filter((p) => matchesFilters(p, { ...NO_FILTERS, ...filters })).map((p) => p.title);
  assert.deepEqual(titles({}), ['Acme', 'Kickoff', 'Loose note']);
  assert.deepEqual(titles({ type: 'client' }), ['Acme']);
  assert.deepEqual(titles({ type: 'note' }), ['Loose note'], 'a page without a type is a note');
  assert.deepEqual(titles({ tag: 'RENEWAL' }), ['Acme', 'Kickoff'], 'tags match whole, ignoring case');
  assert.deepEqual(titles({ tag: 'renew' }), []);
  assert.deepEqual(titles({ updatedFrom: '2026-09-01' }), ['Acme', 'Loose note'], 'falls back to the creation date');
  assert.deepEqual(titles({ tag: 'renewal', updatedFrom: '2026-09-01' }), ['Acme']);
  assert.deepEqual(titles({ updatedFrom: 'not-a-date' }), []);
});

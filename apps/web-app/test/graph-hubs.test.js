import { register } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

register(new URL('./helpers/tsx-loader.js', import.meta.url).href, import.meta.url);

const { pickHubIds, MAX_HUB_LABELS } = await import('../src/utils/graph-hubs.ts');

test('graph hub labels: a small graph labels every note with three or more connections', () => {
  const degree = new Map([['a', 5], ['b', 3], ['c', 2], ['d', 0]]);
  assert.deepEqual([...pickHubIds(['a', 'b', 'c', 'd'], degree)].sort(), ['a', 'b']);
});

test('graph hub labels: a large graph labels only the most connected notes', () => {
  const ids = Array.from({ length: 700 }, (_, index) => `n${index}`);
  // Every note is well connected; a few are far more connected than the rest
  const degree = new Map(ids.map((id, index) => [id, index >= 690 ? 50 : 4]));
  const hubs = pickHubIds(ids, degree);
  assert.equal(hubs.size, MAX_HUB_LABELS);
  for (let index = 690; index < 700; index++) assert.ok(hubs.has(`n${index}`), 'the most connected notes are always labelled');
  assert.ok(hubs.has('n0') && !hubs.has('n100'), 'ties keep their original order');
});

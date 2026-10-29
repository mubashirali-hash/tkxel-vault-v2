import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const markdownEntry = readFileSync(
  new URL('../../../services/vault-core/src/markdown/index.ts', import.meta.url),
  'utf8',
);
const serverEntry = readFileSync(
  new URL('../../../services/vault-core/src/index.ts', import.meta.url),
  'utf8',
);

test('browser markdown entry excludes the server-only database indexer', () => {
  assert.doesNotMatch(markdownEntry, /indexer\.js/);
  assert.match(serverEntry, /markdown\/indexer\.js/);
});

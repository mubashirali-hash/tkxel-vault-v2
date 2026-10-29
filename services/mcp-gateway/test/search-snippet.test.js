import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSnippet } from '../dist/tools/postgres-store.js';

const note = [
  '---',
  'title: Decision: Phased Go-Live',
  'tags: [atlas]',
  '---',
  '# Decision: Phased Go-Live',
  '',
  'Background paragraph that sets the scene for the programme and explains who was involved in the discussion, which ran over several weeks and several meetings before anything was settled by the steering committee.',
  '',
  '**Why:** limits exposure if reconciliation fails, and lets each region learn from the one before it.',
].join('\n');

test('search snippets show the matching passage, not the front matter or the title heading', () => {
  const snippet = makeSnippet(note, ['reconciliation']);
  assert.match(snippet, /reconciliation fails/);
  assert.doesNotMatch(snippet, /^---|title:|# Decision/);
  assert.ok(snippet.startsWith('… '), 'a passage cut from the middle is marked as such');
  assert.ok(snippet.length <= 250);
});

test('search snippets fall back to the opening text when no query word appears', () => {
  const snippet = makeSnippet(note, ['zebra']);
  assert.ok(snippet.startsWith('Background paragraph'));
  assert.ok(snippet.endsWith(' …'));
});

test('search snippets return a short page whole and an empty page as empty', () => {
  assert.equal(makeSnippet('# Title\n\nShort body.', ['body']), 'Short body.');
  assert.equal(makeSnippet('# Only A Title\n', ['title']), '');
});

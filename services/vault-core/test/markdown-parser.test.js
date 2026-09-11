import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MarkdownEngine,
  parseMarkdown,
  stringifyMarkdown,
} from '../dist/markdown/parser.js';

test('Markdown Parser: extracts YAML front matter, tags, and wiki-links cleanly', () => {
  const markdown = `---
title: Project Titan
author: Alice
tags:
  - enterprise
  - internal
---

# Project Titan Overview
Meeting with [[Client Alpha]] regarding #roadmap and [[works_at::Bob Jones]].
Also check out [[Architecture V2|the system design doc]].
`;

  const parsed = parseMarkdown(markdown);

  assert.equal(parsed.frontMatter.title, 'Project Titan');
  assert.equal(parsed.frontMatter.author, 'Alice');
  assert.deepEqual(parsed.tags.sort(), ['enterprise', 'internal', 'roadmap'].sort());

  assert.equal(parsed.links.length, 3);

  // [[Client Alpha]]
  assert.equal(parsed.links[0].target, 'Client Alpha');
  assert.equal(parsed.links[0].alias, undefined);

  // [[works_at::Bob Jones]]
  assert.equal(parsed.links[1].target, 'Bob Jones');
  assert.equal(parsed.links[1].linkType, 'works_at');

  // [[Architecture V2|the system design doc]]
  assert.equal(parsed.links[2].target, 'Architecture V2');
  assert.equal(parsed.links[2].alias, 'the system design doc');
});

test('Markdown Stringifier: preserves clean front matter and markdown body', () => {
  const frontMatter = { title: 'Q3 Review', rating: 5 };
  const body = 'Summary of quarter results.';
  const stringified = stringifyMarkdown(frontMatter, body);

  assert.ok(stringified.startsWith('---\n'));
  assert.ok(stringified.includes('title: Q3 Review'));
  assert.ok(stringified.includes('Summary of quarter results.'));
});

test('Markdown Link Refactoring: automatically updates target wiki-links on rename', () => {
  const content = `Consult [[Project Titan]] or [[works_at::Project Titan]] or [[Project Titan|Titan Specs]].`;
  const updated = MarkdownEngine.refactorLinks(content, 'Project Titan', 'Project Apollo');

  assert.equal(
    updated,
    `Consult [[Project Apollo]] or [[works_at::Project Apollo]] or [[Project Apollo|Titan Specs]].`
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownEngine } from '@tkxel-vault/vault-core/markdown';

test('Web App Editor: round-trip front matter and markdown body preserves integrity', () => {
  const original = `---
title: System Architecture
type: project
tags:
  - backend
  - cloud
---

# System Architecture
Consult [[Security Model]] for invariants and [[Database Schema]].`;

  const parsed = MarkdownEngine.parse(original);
  assert.equal(parsed.frontMatter.title, 'System Architecture');
  assert.equal(parsed.frontMatter.type, 'project');
  assert.deepEqual(parsed.tags.sort(), ['backend', 'cloud'].sort());
  assert.equal(parsed.links.length, 2);

  // Stringify back
  const serialized = MarkdownEngine.stringify(parsed.frontMatter, parsed.body);
  assert.ok(serialized.includes('title: System Architecture'));
  assert.ok(serialized.includes('[[Security Model]]'));
});

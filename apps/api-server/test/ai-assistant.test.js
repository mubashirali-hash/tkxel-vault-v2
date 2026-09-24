import test from 'node:test';
import assert from 'node:assert/strict';
import { NotesAssistant } from '../dist/ai/notes-assistant.js';
import { MockLlmProvider } from '../dist/ai/llm-provider.js';

test('NotesAssistant: suggests relevant wiki-links and omits already linked notes', async () => {
  const assistant = new NotesAssistant(new MockLlmProvider());

  const activeTitle = 'Architecture Overview';
  const activeContent = `
# Architecture Overview
This system relies on [[Existing Note]] for basic settings.
We also discuss the security model, KMS envelope encryption, and how database schema tables are populated.
`;

  const vaultNotes = [
    { id: '1', title: 'Existing Note' }, // already linked
    { id: '2', title: 'Security Model', tags: ['security', 'crypto'] },
    { id: '3', title: 'Database Schema', tags: ['database', 'postgres'] },
    { id: '4', title: 'Unrelated Cook Recipe', tags: ['cooking'] },
    { id: '5', title: 'Architecture Overview' }, // self
  ];

  const suggestions = await assistant.suggestLinks({
    activeNoteTitle: activeTitle,
    activeNoteContent: activeContent,
    vaultNotes,
  });

  // Must omit self
  assert.ok(!suggestions.some((s) => s.targetTitle === 'Architecture Overview'));
  // Must omit already linked note
  assert.ok(!suggestions.some((s) => s.targetTitle === 'Existing Note'));
  // Must recommend Security Model or Database Schema
  assert.ok(suggestions.some((s) => s.targetTitle === 'Security Model'));
  assert.ok(suggestions.some((s) => s.targetTitle === 'Database Schema'));

  const secLink = suggestions.find((s) => s.targetTitle === 'Security Model');
  assert.ok(secLink);
  assert.ok(secLink.confidence > 0.7);
  assert.ok(secLink.rationale.length > 5);
});

test('NotesAssistant: sorts and categorizes note into valid taxonomy and cluster', async () => {
  const assistant = new NotesAssistant(new MockLlmProvider());

  const decisionNote = `
# ADR-009: Hybrid Search Mechanism
## Status: Accepted
## Rationale
We decided to adopt pgvector alongside BM25 full-text indexing.
`;

  const result = await assistant.sortAndCategorize({
    title: 'ADR-009: Hybrid Search Mechanism',
    content: decisionNote,
  });

  assert.equal(result.category, 'decision');
  assert.equal(result.clusterName, 'Architecture Decisions');
  assert.ok(result.suggestedTags.includes('decision') || result.suggestedTags.includes('adr'));
  assert.ok(result.summary.length > 10);
});

test('NotesAssistant: answers question grounded in note context with citations', async () => {
  const assistant = new NotesAssistant(new MockLlmProvider());

  const answer = await assistant.askNote({
    question: 'How is data encrypted at rest?',
    activeNoteTitle: 'Security Model',
    activeNoteContent: 'Data is protected using AES-256-GCM envelope encryption with per-vault keys.',
  });

  assert.ok(answer.answer.length > 10);
  assert.ok(answer.citations.includes('[[Security Model]]'));
  assert.ok(answer.confidence > 0.8);
});

test('NotesAssistant: drafts valid locked SKILL.md manifest with tools and instructions', async () => {
  const assistant = new NotesAssistant(new MockLlmProvider());

  const note = `
# Architecture Audit Checklist
Review all incoming pull requests against the 3 core architectural invariants.
Verify that all access checks are performed server-side.
`;

  const draft = await assistant.draftSkill({
    title: 'Architecture Audit',
    content: note,
  });

  assert.equal(draft.name, 'architecture-audit');
  assert.ok(draft.skillMdContent.includes('name: architecture-audit'));
  assert.ok(draft.skillMdContent.includes('# Instructions'));
  assert.ok(draft.suggestedTools.length > 0);
});

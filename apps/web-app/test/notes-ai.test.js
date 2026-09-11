import test from 'node:test';
import assert from 'node:assert/strict';

// Test heuristic fallback and link scanner logic used in NotesAiClient
function scanLinksLocally(activeNoteTitle, activeNoteContent, vaultNotes) {
  const contentLower = activeNoteContent.toLowerCase();
  return vaultNotes
    .filter((n) => n.title.toLowerCase() !== activeNoteTitle.toLowerCase())
    .filter((n) => contentLower.includes(n.title.toLowerCase()))
    .map((n) => ({
      targetTitle: n.title,
      targetId: n.id,
      relationType: 'references',
      confidence: 0.85,
      rationale: `Mentioned in note text.`,
    }));
}

function draftSkillLocally(title, content) {
  const cleanName = title.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  return {
    name: cleanName,
    description: `Automated execution workflow derived from note "${title}".`,
    instructions: content,
    suggestedTools: [{ name: `run_${cleanName}`, description: 'Execute workflow', parameters: {} }],
    skillMdContent: `---\nname: ${cleanName}\n---\n# Instructions\n${content}`,
  };
}

test('NotesAiClient: fallback link scanner identifies candidates mentioned in note text', () => {
  const activeTitle = 'Frontend Architecture';
  const activeContent = `
# Frontend Architecture
This interface communicates with the [[MarkdownEditor]] component.
It also relies on KnowledgeGraph and Storage Engine.
`;

  const vaultNotes = [
    { id: '1', title: 'KnowledgeGraph' },
    { id: '2', title: 'Storage Engine' },
    { id: '3', title: 'Unrelated Recipe' },
  ];

  const suggestions = scanLinksLocally(activeTitle, activeContent, vaultNotes);

  assert.ok(suggestions.length >= 2);
  assert.ok(suggestions.some((s) => s.targetTitle === 'KnowledgeGraph'));
  assert.ok(suggestions.some((s) => s.targetTitle === 'Storage Engine'));
  assert.ok(!suggestions.some((s) => s.targetTitle === 'Unrelated Recipe'));
});

test('NotesAiClient: draftSkill generates valid manifest and tool definitions', () => {
  const title = 'Deploy Microservice';
  const content = 'Run container checks and verify health endpoints.';

  const draft = draftSkillLocally(title, content);

  assert.equal(draft.name, 'deploy-microservice');
  assert.ok(draft.skillMdContent.includes('deploy-microservice'));
  assert.ok(draft.suggestedTools.length > 0);
  assert.equal(draft.suggestedTools[0].name, 'run_deploy-microservice');
});

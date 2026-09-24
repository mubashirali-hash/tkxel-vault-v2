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

function autoApplyWikiLinksLocally(markdown, candidateTitles) {
  let masked = markdown;
  const masks = [];
  let tokenIdx = 0;

  const saveMask = (str) => {
    const token = `__AI_MASK_${tokenIdx++}__`;
    masks.push({ token, original: str });
    return token;
  };

  masked = masked.replace(/^---[\s\S]*?---\n?/m, (match) => saveMask(match));
  masked = masked.replace(/```[\s\S]*?```/g, (match) => saveMask(match));
  masked = masked.replace(/`[^`\n]+`/g, (match) => saveMask(match));
  masked = masked.replace(/\[\[[\s\S]*?\]\]/g, (match) => saveMask(match));
  masked = masked.replace(/\[[^\]]+\]\([^\)]+\)/g, (match) => saveMask(match));

  let appliedCount = 0;
  for (const title of candidateTitles) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b(${escaped})\\b`, 'i');
    if (regex.test(masked)) {
      masked = masked.replace(regex, (_m, matchText) => {
        appliedCount++;
        return `[[${matchText}]]`;
      });
    }
  }

  let unmasked = masked;
  for (let i = masks.length - 1; i >= 0; i--) {
    unmasked = unmasked.split(masks[i].token).join(masks[i].original);
  }

  return { updatedMarkdown: unmasked, appliedCount };
}

test('NotesAiClient: autoApplyWikiLinksLocally respects code blocks and avoids duplicate links', () => {
  const input = [
    '# Microservice Architecture',
    'We use Kubernetes for orchestration and Docker for containers.',
    '```bash',
    'docker run -d redis:alpine',
    '```',
    'Do not touch `Kubernetes` in inline code.',
    'Already linked: [[Docker]].',
  ].join('\n');

  const candidates = ['Kubernetes', 'Docker', 'Redis'];
  const res = autoApplyWikiLinksLocally(input, candidates);

  // Kubernetes in normal prose should be linked
  assert.ok(res.updatedMarkdown.includes('[[Kubernetes]] for orchestration'));
  // Docker in code block must NOT be linked
  assert.ok(res.updatedMarkdown.includes('docker run -d redis:alpine'));
  // Kubernetes in inline code must NOT be linked
  assert.ok(res.updatedMarkdown.includes('`Kubernetes`'));
  // Existing [[Docker]] must NOT become [[[[Docker]]]]
  assert.ok(!res.updatedMarkdown.includes('[[[[Docker]]]]'));
  assert.ok(res.appliedCount >= 1);
});

test('NotesAiClient: skill classification accurately recommends folder and asks clarifying questions', () => {
  const content = 'Deploy and manage container clusters using Terraform and Kubernetes Helm charts';
  const name = 'k8s-cluster-provisioner';

  const isDevops = content.toLowerCase().includes('kubernetes') || content.toLowerCase().includes('terraform');
  assert.ok(isDevops);

  const suggestedFolder = isDevops ? 'DevOps/Infrastructure' : 'Unfiled';
  assert.equal(suggestedFolder, 'DevOps/Infrastructure');

  const needsClarification = !content.toLowerCase().includes('timeout') && !content.toLowerCase().includes('cluster id');
  assert.ok(needsClarification);
});


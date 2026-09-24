import test from 'node:test';
import assert from 'node:assert/strict';

// Import or recreate heuristic logic from ai-client for unit verification
function localHeuristicAsk(params) {
  const query = params.question.trim();
  const qLower = query.toLowerCase();
  const vaultNotes = params.vaultNotes || [];
  const activeTitle = params.activeNoteTitle;
  const activeContent = params.activeNoteContent;

  // 1. CREATE FOLDER
  const createFolderMatch =
    qLower.match(/(?:create|make|add|new)\s+folder\s+(?:named\s+|called\s+)?["']?([a-zA-Z0-9_\-\s]+)["']?/i) ||
    qLower.match(/folder\s+for\s+["']?([a-zA-Z0-9_\-\s]+)["']?/i);

  if (createFolderMatch) {
    const rawFolderName = createFolderMatch[1].trim().replace(/^["']|["']$/g, '');
    const folderName = rawFolderName.charAt(0).toUpperCase() + rawFolderName.slice(1);
    return {
      answer: `I've prepared an action to create the folder **"${folderName}"**. Click the action button below to create it in your sidebar navigation:`,
      citations: [activeTitle],
      actions: [
        {
          type: 'create_folder',
          folderName,
          rationale: `User requested creation of folder "${folderName}".`,
        },
      ],
    };
  }

  // 2. ORGANIZE VAULT / MOVE NOTES
  if (
    qLower.includes('organize') ||
    qLower.includes('group notes') ||
    qLower.includes('move notes') ||
    qLower.includes('sort notes')
  ) {
    const unfiledNotes = vaultNotes.filter((n) => !n.folder || n.folder.trim() === '');
    const actions = [];

    const notesToProcess = unfiledNotes.length > 0 ? unfiledNotes : vaultNotes;

    for (const note of notesToProcess) {
      const text = `${note.title} ${note.content || ''} ${(note.tags || []).join(' ')}`.toLowerCase();
      let targetFolder = 'Projects';

      if (text.includes('agent') || text.includes('orchestrat') || text.includes('bot') || text.includes('ai')) {
        targetFolder = 'Agents';
      } else if (text.includes('client') || text.includes('customer') || text.includes('tenant') || text.includes('account')) {
        targetFolder = 'Clients';
      } else if (text.includes('architect') || text.includes('system') || text.includes('schema') || text.includes('mcp') || text.includes('db')) {
        targetFolder = 'Architecture';
      } else if (text.includes('decision') || text.includes('adr') || text.includes('proposal')) {
        targetFolder = 'Decisions';
      }

      if (note.folder !== targetFolder) {
        actions.push({
          type: 'move_note',
          noteId: note.id,
          noteTitle: note.title,
          targetFolder,
          rationale: `Classified as ${targetFolder} based on note content analysis.`,
        });
      }
    }

    if (actions.length > 0) {
      return {
        answer: `I analyzed **${unfiledNotes.length} unfiled note(s)** across your vault and grouped them into thematic folders based on their content. Review and apply the moves below:`,
        citations: actions.map((a) => a.noteTitle),
        actions,
      };
    }
  }

  // 3. EDIT NOTE / MERMAID DIAGRAM
  if (
    qLower.includes('flowchart') ||
    qLower.includes('diagram') ||
    qLower.includes('mermaid') ||
    qLower.includes('chart')
  ) {
    const mermaidSnippet = `\n\n\`\`\`mermaid\ngraph TD\n    A[${activeTitle}] --> B(Context Retrieval)\n    B --> C{Locked Vault?}\n    C -->|Yes| D[Zero-Read Skill Execution]\n    C -->|No| E[Open Knowledge Graph Query]\n    D --> F[Encrypted Response]\n    E --> F\n\`\`\`\n`;

    return {
      answer: `I generated an architecture flowchart tailored to **[[${activeTitle}]]**. You can apply this edit directly to update the document:`,
      citations: [activeTitle],
      actions: [
        {
          type: 'edit_note',
          noteTitle: activeTitle,
          mode: 'append',
          content: mermaidSnippet,
          diffSummary: `Appends a Mermaid flowchart diagram to "${activeTitle}".`,
        },
      ],
    };
  }

  // 4. CROSS-NOTE SEARCH / QA
  const matchingNotes = vaultNotes.filter((n) => {
    const text = `${n.title} ${n.content || ''}`.toLowerCase();
    const queryWords = qLower.split(/\s+/).filter((w) => w.length > 3);
    return queryWords.some((w) => text.includes(w));
  });

  return {
    answer: `Found ${matchingNotes.length} matching notes.`,
    citations: matchingNotes.map((n) => n.title),
    actions: [],
  };
}

test('AI Vault Actions: intent engine generates create_folder action for explicit prompt', () => {
  const result = localHeuristicAsk({
    question: 'Create folder named Architecture',
    activeNoteTitle: 'System Overview',
    activeNoteContent: '# System Overview\nContent here',
    vaultNotes: [],
  });

  assert.ok(result.actions && result.actions.length === 1);
  assert.equal(result.actions[0].type, 'create_folder');
  assert.equal(result.actions[0].folderName, 'Architecture');
  assert.ok(result.answer.includes('Architecture'));
});

test('AI Vault Actions: intent engine detects unfiled notes and generates move_note actions', () => {
  const vaultNotes = [
    {
      id: 'p1',
      title: 'Agent Orchestration Blueprint',
      content: 'Autonomous AI agent execution loop with tool invocation.',
      tags: ['agents'],
      folder: undefined,
    },
    {
      id: 'p2',
      title: 'Acme Corp Tenant Contract',
      content: 'Client onboarding SLA and rate limits for customer.',
      tags: ['clients'],
      folder: undefined,
    },
    {
      id: 'p3',
      title: 'Database Schema ADR',
      content: 'Postgres pgvector table architecture and schema design.',
      tags: ['db'],
      folder: 'Architecture', // already filed
    },
  ];

  const result = localHeuristicAsk({
    question: 'Organize all notes in my vault into folders',
    activeNoteTitle: 'Agent Orchestration Blueprint',
    activeNoteContent: 'Autonomous AI agent execution loop',
    vaultNotes,
  });

  assert.ok(result.actions && result.actions.length >= 2);
  const p1Move = result.actions.find((a) => a.noteId === 'p1');
  assert.ok(p1Move);
  assert.equal(p1Move.type, 'move_note');
  assert.equal(p1Move.targetFolder, 'Agents');

  const p2Move = result.actions.find((a) => a.noteId === 'p2');
  assert.ok(p2Move);
  assert.equal(p2Move.type, 'move_note');
  assert.equal(p2Move.targetFolder, 'Clients');
});

test('AI Vault Actions: intent engine generates edit_note action with Mermaid diagram', () => {
  const result = localHeuristicAsk({
    question: 'Add a mermaid flowchart diagram to this note',
    activeNoteTitle: 'Authentication Gateway',
    activeNoteContent: '# Authentication Gateway\nOAuth 2.1 PKCE verification.',
    vaultNotes: [],
  });

  assert.ok(result.actions && result.actions.length === 1);
  const action = result.actions[0];
  assert.equal(action.type, 'edit_note');
  assert.equal(action.noteTitle, 'Authentication Gateway');
  assert.equal(action.mode, 'append');
  assert.ok(action.content.includes('```mermaid'));
  assert.ok(action.content.includes('Authentication Gateway'));
});

test('AI Vault Actions: cross-note search scans note body contents across vault', () => {
  const vaultNotes = [
    {
      id: 'n1',
      title: 'KMS Key Rotation',
      content: 'Envelope encryption uses AWS KMS CMK with AES-256-GCM data encryption keys.',
      tags: ['security'],
    },
    {
      id: 'n2',
      title: 'Editor Guidelines',
      content: 'Markdown WYSIWYG editor shortcuts and formatting conventions.',
      tags: ['docs'],
    },
  ];

  const result = localHeuristicAsk({
    question: 'What encryption algorithm is used for keys?',
    activeNoteTitle: 'Editor Guidelines',
    activeNoteContent: 'Markdown shortcuts',
    vaultNotes,
  });

  assert.ok(result.citations.includes('KMS Key Rotation'));
  assert.ok(!result.citations.includes('Editor Guidelines'));
});

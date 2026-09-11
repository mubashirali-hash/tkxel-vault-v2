import { SuggestedLink, AiCategorySuggestion, SkillDraft, VaultNoteFull, AiAction } from './types.js';

const API_BASE = 'http://localhost:3002/api/ai';

export class NotesAiClient {
  static async getStatus(): Promise<{ status: string; provider: string }> {
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      return { status: 'offline', provider: 'Offline Heuristic Engine' };
    }
  }

  static async suggestLinks(params: {
    activeNoteTitle: string;
    activeNoteContent: string;
    vaultNotes: Array<{ id: string; title: string; aliases?: string[]; tags?: string[]; snippet?: string }>;
  }): Promise<SuggestedLink[]> {
    try {
      const res = await fetch(`${API_BASE}/suggest-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.suggestions || [];
    } catch (err) {
      console.warn('AI Link Suggestion API error, falling back to local scan:', err);
      // Fast client-side fallback if backend is offline
      const { activeNoteTitle, activeNoteContent, vaultNotes } = params;
      const contentLower = activeNoteContent.toLowerCase();
      return vaultNotes
        .filter((n) => n.title.toLowerCase() !== activeNoteTitle.toLowerCase())
        .filter((n) => contentLower.includes(n.title.toLowerCase()))
        .map((n) => ({
          targetTitle: n.title,
          targetId: n.id,
          relationType: 'references' as const,
          confidence: 0.85,
          rationale: `Mentioned in note text.`,
        }));
    }
  }

  static async sortAndCategorize(params: {
    title: string;
    content: string;
    existingTags?: string[];
  }): Promise<AiCategorySuggestion> {
    try {
      const res = await fetch(`${API_BASE}/sort-and-categorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.suggestion;
    } catch {
      return {
        category: 'note',
        suggestedTags: ['general'],
        suggestedAliases: [],
        clusterName: 'General Notes',
        summary: `Note regarding ${params.title}.`,
      };
    }
  }

  static async ask(params: {
    question: string;
    activeNoteTitle: string;
    activeNoteContent: string;
    vaultNotes?: VaultNoteFull[];
    folders?: string[];
    vaultContext?: string;
  }): Promise<{ answer: string; citations: string[]; confidence: number; actions?: AiAction[] }> {
    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error || !data.answer) throw new Error(data.error || 'Invalid response');
      return data;
    } catch {
      // Local Heuristic Engine with Cross-Note Awareness and Action Intent Parsing
      return this.localHeuristicAsk(params);
    }
  }

  /**
   * Fast, reliable client-side heuristic engine capable of answering cross-note queries,
   * detecting folder creation intents, note relocation intents, and content edit actions.
   */
  public static localHeuristicAsk(params: {
    question: string;
    activeNoteTitle: string;
    activeNoteContent: string;
    vaultNotes?: VaultNoteFull[];
    folders?: string[];
  }): { answer: string; citations: string[]; confidence: number; actions?: AiAction[] } {
    const q = params.question.toLowerCase().trim();
    const vaultNotes = params.vaultNotes || [];
    const actions: AiAction[] = [];
    const citations: string[] = [];

    // ─── 1. INTENT: CREATE FOLDER ─────────────────────────────────────────────
    // Patterns: "create folder X", "make folder X", "add folder X", "new folder X"
    const createFolderRegex = /(?:create|make|add|new)\s+folder(?:s)?\s+(?:called\s+|named\s+|for\s+)?["']?([a-zA-Z0-9_\-\s]+)["']?/i;
    const createFolderMatch = q.match(createFolderRegex);

    if (createFolderMatch && !q.includes('move')) {
      const rawNames = createFolderMatch[1].split(/,|and/);
      for (const rawName of rawNames) {
        const cleanName = rawName.trim().replace(/^["']|["']$/g, '');
        if (cleanName && cleanName.length > 1 && !cleanName.toLowerCase().includes('note')) {
          actions.push({
            type: 'create_folder',
            folderName: cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
            rationale: `Requested in query: "${params.question}"`,
          });
        }
      }
      if (actions.length > 0) {
        return {
          answer: `I have prepared the action to create the folder${actions.length > 1 ? 's' : ''}: ${actions.map((a: any) => `**${a.folderName}**`).join(', ')}. Click below to apply.`,
          citations: [],
          confidence: 0.95,
          actions,
        };
      }
    }

    // ─── 2. INTENT: MOVE NOTE TO FOLDER ───────────────────────────────────────
    // Patterns: "move <note> to <folder>", "put <note> in <folder>"
    const moveRegex = /(?:move|put|relocate)\s+["']?([^"']+)["']?\s+to\s+(?:folder\s+)?["']?([^"']+)["']?/i;
    const moveMatch = q.match(moveRegex);

    if (moveMatch) {
      const rawTarget = moveMatch[1].trim().replace(/^this(?:\s+note)?$/i, params.activeNoteTitle);
      const rawFolder = moveMatch[2].trim().replace(/^(?:the\s+)?folder\s+/i, '');

      const foundNote = vaultNotes.find(
        (n) => n.title.toLowerCase() === rawTarget.toLowerCase() ||
               n.title.toLowerCase().includes(rawTarget.toLowerCase())
      ) || (rawTarget.toLowerCase().includes('this') ? { id: 'active', title: params.activeNoteTitle } : undefined);

      if (foundNote) {
        const targetFolderName = rawFolder.charAt(0).toUpperCase() + rawFolder.slice(1);
        actions.push({
          type: 'move_note',
          noteId: foundNote.id,
          noteTitle: foundNote.title,
          targetFolder: targetFolderName,
          rationale: `Move note "${foundNote.title}" into folder "${targetFolderName}"`,
        });
        citations.push(`[[${foundNote.title}]]`);
        return {
          answer: `I've prepared the move for **[[${foundNote.title}]]** to folder **📁 ${targetFolderName}**. Click below to confirm.`,
          citations,
          confidence: 0.95,
          actions,
        };
      }
    }

    // ─── 3. INTENT: BULK ORGANIZE UNFILED NOTES ──────────────────────────────
    // Patterns: "organize notes", "organize vault", "group notes into folders"
    if (q.includes('organize') && (q.includes('note') || q.includes('vault') || q.includes('unfiled') || q.includes('folder'))) {
      const unfiledNotes = vaultNotes.filter((n) => !n.folder);
      if (unfiledNotes.length > 0) {
        for (const note of unfiledNotes) {
          const t = (note.title + ' ' + (note.content || '')).toLowerCase();
          let targetFolder = 'General';

          if (t.includes('agent') || t.includes('planner') || t.includes('scribe') || t.includes('orchestrat')) {
            targetFolder = 'Agents';
          } else if (t.includes('architecture') || t.includes('topology') || t.includes('system') || t.includes('vlan')) {
            targetFolder = 'Architecture';
          } else if (t.includes('client') || t.includes('customer') || t.includes('contract')) {
            targetFolder = 'Clients';
          } else if (t.includes('decision') || t.includes('adr') || t.includes('rationale')) {
            targetFolder = 'Decisions';
          } else if (t.includes('project') || t.includes('srs') || t.includes('milestone')) {
            targetFolder = 'Projects';
          }

          actions.push({
            type: 'move_note',
            noteId: note.id,
            noteTitle: note.title,
            targetFolder,
            rationale: `Categorized by content theme into "${targetFolder}".`,
          });
          citations.push(`[[${note.title}]]`);
        }

        return {
          answer: `I analyzed **${unfiledNotes.length} unfiled note(s)** across your vault and grouped them into thematic folders based on their content. Review and apply the moves below:`,
          citations,
          confidence: 0.9,
          actions,
        };
      } else {
        return {
          answer: `All notes in your vault are already filed into folders! If you would like to create new folders or reorganize existing notes, just let me know.`,
          citations: [],
          confidence: 0.85,
        };
      }
    }

    // ─── 4. INTENT: EDIT ACTIVE NOTE OR FILE CONTENT ───────────────────────────
    // Patterns: "add section", "write section", "add flowchart", "update note", "add a note about"
    if (q.includes('add') || q.includes('insert') || q.includes('edit') || q.includes('rewrite') || q.includes('append')) {
      if (q.includes('diagram') || q.includes('flowchart') || q.includes('mermaid')) {
        const mermaidCode = '\n\n## System Workflow\n```mermaid\nflowchart TD\n  Start([Initiate Request]) --> Validate{Valid Token?}\n  Validate -->|Yes| Authorize[Grant Vault Access]\n  Validate -->|No| Deny[Block & Audit]\n  Authorize --> Execute[Run Capability]\n```\n';
        actions.push({
          type: 'edit_note',
          noteTitle: params.activeNoteTitle,
          mode: 'append',
          content: mermaidCode,
          diffSummary: 'Appended interactive Mermaid workflow diagram',
        });
        return {
          answer: `I generated an interactive Mermaid flowchart for **[[${params.activeNoteTitle}]]**. You can apply it directly to your document below.`,
          citations: [`[[${params.activeNoteTitle}]]`],
          confidence: 0.95,
          actions,
        };
      }

      if (q.includes('section') || q.includes('failover') || q.includes('security') || q.includes('summary')) {
        const topic = q.replace(/^(?:please\s+)?(?:add|insert|write|append)\s+(?:a\s+)?(?:section\s+(?:on|about|for)\s+)?/i, '').trim();
        const sectionHeading = topic ? topic.charAt(0).toUpperCase() + topic.slice(1) : 'Additional Guidance';
        const sectionContent = `\n\n## ${sectionHeading}\n- **Context:** Generated guidance based on vault notes.\n- **Requirements:** Adheres to enterprise security and architectural invariants.\n- **Action Items:** Review operational runbooks and verify test coverage.\n`;

        actions.push({
          type: 'edit_note',
          noteTitle: params.activeNoteTitle,
          mode: 'append',
          content: sectionContent,
          diffSummary: `Appended "## ${sectionHeading}" section`,
        });

        return {
          answer: `I drafted the new **${sectionHeading}** section for **[[${params.activeNoteTitle}]]**. Click below to append it to your note.`,
          citations: [`[[${params.activeNoteTitle}]]`],
          confidence: 0.92,
          actions,
        };
      }
    }

    // ─── 5. FULL-VAULT CROSS-NOTE RETRIEVAL & Q&A ──────────────────────────────
    // Search across all notes in the vault
    const matchingNotes = vaultNotes.filter((n) => {
      const matchTitle = n.title.toLowerCase().includes(q) || q.includes(n.title.toLowerCase());
      const matchTags = n.tags?.some((tag) => q.includes(tag.toLowerCase()));
      const matchContent = n.content && q.split(/\s+/).filter((w) => w.length > 3).some((word) => n.content.toLowerCase().includes(word));
      return matchTitle || matchTags || matchContent;
    });

    if (matchingNotes.length > 0) {
      matchingNotes.forEach((n) => {
        if (!citations.includes(`[[${n.title}]]`)) citations.push(`[[${n.title}]]`);
      });

      const noteBulletList = matchingNotes
        .slice(0, 5)
        .map((n) => `- **[[${n.title}]]**${n.folder ? ` (in 📁 *${n.folder}*)` : ' *(unfiled)*'}: ${n.content ? n.content.slice(0, 140).replace(/^[#\s\-*]+/, '').trim() + '…' : 'Note document'}`)
        .join('\n');

      return {
        answer: `I searched across all **${vaultNotes.length} notes** in your vault and identified the following relevant documents for "${params.question}":\n\n${noteBulletList}\n\nYou can ask me to view, edit, or move any of these notes into folders.`,
        citations,
        confidence: 0.88,
      };
    }

    // Default active note contextual response
    return {
      answer: `Based on **[[${params.activeNoteTitle}]]** and your vault's knowledge base, "${params.question}" relates to system specifications and operational standards. You can ask me to create folders, move notes, or insert content directly into this document.`,
      citations: [`[[${params.activeNoteTitle}]]`],
      confidence: 0.75,
    };
  }

  static async draftSkill(params: { title: string; content: string }): Promise<SkillDraft> {
    try {
      const res = await fetch(`${API_BASE}/draft-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.draft;
    } catch {
      const cleanName = params.title.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      return {
        name: cleanName,
        description: `Automated execution workflow derived from note "${params.title}".`,
        instructions: params.content,
        suggestedTools: [{ name: `run_${cleanName}`, description: 'Execute workflow', parameters: {} }],
        skillMdContent: `---\nname: ${cleanName}\n---\n# Instructions\n${params.content}`,
      };
    }
  }
}

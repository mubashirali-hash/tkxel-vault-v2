export interface VaultNoteFull {
  id: string;
  title: string;
  folder?: string;
  tags: string[];
  aliases?: string[];
  type?: string;
  content: string;
}

export interface SuggestedLink {
  targetTitle: string;
  targetId?: string;
  relationType: 'references' | 'extends' | 'architecture_for' | 'implements' | 'prerequisite_of' | 'related_to';
  confidence: number;
  rationale: string;
  snippet?: string;
}

export interface AiCategorySuggestion {
  category: 'architecture' | 'decision' | 'meeting' | 'concept' | 'skill-candidate' | 'reference' | 'note';
  suggestedTags: string[];
  suggestedAliases: string[];
  clusterName: string;
  summary: string;
}

export type AiAction =
  | {
      type: 'create_folder';
      folderName: string;
      rationale?: string;
    }
  | {
      type: 'move_note';
      noteId: string;
      noteTitle: string;
      targetFolder: string;
      rationale?: string;
    }
  | {
      type: 'edit_note';
      noteId?: string;
      noteTitle: string;
      mode: 'replace' | 'append' | 'insert';
      content: string;
      diffSummary?: string;
    };

export interface AiChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  citations?: string[];
  actions?: AiAction[];
  actionStatuses?: Record<number, 'applied' | 'dismissed'>;
  timestamp: Date;
}

export interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
  suggestedTools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  skillMdContent: string;
}

export interface SkillClarification {
  question: string;
  options?: string[];
  field: string;
  defaultAnswer?: string;
}

export interface SkillClassification {
  name: string;
  description: string;
  category: 'devops' | 'security' | 'code-review' | 'data-extraction' | 'architecture' | 'utility';
  suggestedFolder: string;
  runtime: 'python3' | 'nodejs' | 'bash';
  recommendedVaultMode: 'locked' | 'open';
  parameterSchema: Record<string, unknown>;
  systemInstructions: string;
  clarifications: SkillClarification[];
}

export interface AutoApplyWikiLinksResult {
  modifiedContent: string;
  linksApplied: Array<{ targetTitle: string; matchedText: string }>;
  count: number;
}

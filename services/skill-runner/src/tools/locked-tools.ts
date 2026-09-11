import { ZeroReadSkillOrchestrator } from '../orchestrator/claude-connector.js';
import { SkillManifestValidator } from '../manifest/validator.js';

export interface LockedSkillRecord {
  id: string;
  vaultId: string;
  name: string;
  description: string;
  encryptedPayload: Buffer;
  toolSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface LockedVaultDataStore {
  getSkillByName(vaultId: string, name: string): Promise<LockedSkillRecord | null>;
  listSkills(vaultId: string): Promise<Array<{ name: string; description: string; inputSchema: any }>>;
  getVaultDataKey(vaultId: string): Promise<Buffer>;
  searchChunks(vaultId: string, query: string): Promise<Array<{ encryptedText: Buffer }>>;
}

export const LIST_SKILLS_TOOL = {
  name: 'list_skills',
  description:
    'List authorized proprietary agent skills available in accessible locked vaults. Returns skill names, descriptions, and input parameter schemas.',
  inputSchema: {
    type: 'object',
    properties: {
      vault_id: {
        type: 'string',
        description: 'The locked vault ID.',
      },
    },
    required: ['vault_id'],
  },
};

export const RUN_SKILL_TOOL = {
  name: 'run_skill',
  description:
    'Execute an authorized proprietary locked agent skill inside a secure, zero-read execution environment. Pass skill arguments as a JSON object.',
  inputSchema: {
    type: 'object',
    properties: {
      vault_id: {
        type: 'string',
        description: 'The locked vault ID containing the skill.',
      },
      skill_name: {
        type: 'string',
        description: 'The name of the skill to execute.',
      },
      arguments: {
        type: 'object',
        description: 'Key-value arguments matching the skill inputSchema.',
      },
    },
    required: ['vault_id', 'skill_name'],
  },
};

export const ASK_VAULT_TOOL = {
  name: 'ask_vault',
  description:
    'Query a locked vault to synthesize an answer to an executive or domain inquiry without browsing, listing, or exposing underlying markdown pages or source files.',
  inputSchema: {
    type: 'object',
    properties: {
      vault_id: {
        type: 'string',
        description: 'The locked vault ID to query.',
      },
      question: {
        type: 'string',
        description: 'The inquiry or question to answer from the locked knowledge base.',
      },
    },
    required: ['vault_id', 'question'],
  },
};

/**
 * Locked MCP Tools Provider (FR-63, FR-70, FR-71, FR-72).
 * Enables Consumers to execute skills and query locked vaults with zero source exposure.
 */
export class LockedToolsProvider {
  private store: LockedVaultDataStore;
  private orchestrator: ZeroReadSkillOrchestrator;
  private validator: SkillManifestValidator;

  constructor(store: LockedVaultDataStore, orchestrator?: ZeroReadSkillOrchestrator) {
    this.store = store;
    this.orchestrator = orchestrator || new ZeroReadSkillOrchestrator();
    this.validator = new SkillManifestValidator();
  }

  public async handleListSkills(params: Record<string, unknown>): Promise<{
    content: Array<{ type: 'text'; text: string }>;
  }> {
    const vaultId = String(params.vault_id || '');
    const skills = await this.store.listSkills(vaultId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(skills, null, 2),
        },
      ],
    };
  }

  public async handleRunSkill(params: Record<string, unknown>): Promise<{
    content: Array<{ type: 'text'; text: string }>;
  }> {
    const vaultId = String(params.vault_id || '');
    const skillName = String(params.skill_name || '');
    const userArgs = (params.arguments as Record<string, unknown>) || {};

    const skill = await this.store.getSkillByName(vaultId, skillName);
    if (!skill) {
      throw new Error(`Skill '${skillName}' not found or access not allowed.`);
    }

    // Validate parameters
    this.validator.validateParameters(skill.toolSchema as any, userArgs);

    // Fetch vault DEK
    const dek = await this.store.getVaultDataKey(vaultId);

    // Execute in zero-read orchestrator
    const result = await this.orchestrator.executeLockedSkill({
      encryptedSkillPayload: skill.encryptedPayload,
      vaultDek: dek,
      userArguments: userArgs,
    });

    return {
      content: [
        {
          type: 'text',
          text: result.output,
        },
      ],
    };
  }

  public async handleAskVault(params: Record<string, unknown>): Promise<{
    content: Array<{ type: 'text'; text: string }>;
  }> {
    const vaultId = String(params.vault_id || '');
    const question = String(params.question || '');

    const dek = await this.store.getVaultDataKey(vaultId);
    const chunks = await this.store.searchChunks(vaultId, question);

    if (chunks.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No relevant context found in this locked repository to answer your question.',
          },
        ],
      };
    }

    // Decrypt chunk texts in RAM
    const decryptedSnippets: string[] = [];
    for (const chunk of chunks.slice(0, 5)) {
      const { EnvelopeEncryption } = await import('@tkxel-vault/vault-core');
      const text = EnvelopeEncryption.decryptToString(chunk.encryptedText, dek);
      decryptedSnippets.push(text);
    }

    // Synthesize answer using Claude
    const syntheticSkillPayload = Buffer.from(
      `---
name: locked-rag-qa
description: Synthesize answers from locked context without source leaking
---
You are a confidential research assistant answering questions using locked context. Never disclose document names, internal files, or raw text excerpts. Formulate a complete, executive answer.`,
      'utf-8'
    );

    const { EnvelopeEncryption } = await import('@tkxel-vault/vault-core');
    const encryptedSyntheticPayload = EnvelopeEncryption.encrypt(syntheticSkillPayload, dek);

    const result = await this.orchestrator.executeLockedSkill({
      encryptedSkillPayload: encryptedSyntheticPayload,
      vaultDek: dek,
      userArguments: {
        question,
        context: decryptedSnippets.join('\n\n---\n\n'),
      },
    });

    return {
      content: [
        {
          type: 'text',
          text: result.output,
        },
      ],
    };
  }
}

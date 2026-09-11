import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvelopeEncryption } from '@tkxel-vault/vault-core';
import {
  LockedToolsProvider,
  LIST_SKILLS_TOOL,
  RUN_SKILL_TOOL,
  ASK_VAULT_TOOL,
} from '../dist/tools/locked-tools.js';
import {
  ZeroReadSkillOrchestrator,
  MockClaudeClient,
} from '../dist/orchestrator/claude-connector.js';

test('Locked MCP Tools: list_skills returns metadata only, zero raw paths or code', async () => {
  const mockStore = {
    getSkillByName: async () => null,
    listSkills: async () => [
      {
        name: 'cloud-cost-optimizer',
        description: 'Analyzes AWS spend and identifies unused resources.',
        inputSchema: { type: 'object', properties: { max_recommendations: { type: 'number' } } },
      },
    ],
    getVaultDataKey: async () => Buffer.alloc(32),
    searchChunks: async () => [],
  };

  const provider = new LockedToolsProvider(mockStore);
  const result = await provider.handleListSkills({ vault_id: 'vlt_locked_1' });

  const skills = JSON.parse(result.content[0].text);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'cloud-cost-optimizer');
  assert.equal(skills[0].path, undefined);
  assert.equal(skills[0].instructions, undefined);
});

test('Locked MCP Tools: run_skill executes locked skill through in-memory orchestrator', async () => {
  const dek = EnvelopeEncryption.generateDek();
  const rawSkill = `---
name: proprietary-estimator
description: Estimates engineering effort using historical proprietary data.
---
Estimate hours for features accurately.`;

  const encryptedSkill = EnvelopeEncryption.encrypt(rawSkill, dek);

  const mockStore = {
    getSkillByName: async () => ({
      id: 'skl_01',
      vaultId: 'vlt_locked_1',
      name: 'proprietary-estimator',
      description: 'Estimates engineering effort.',
      encryptedPayload: encryptedSkill,
      toolSchema: {
        type: 'object',
        properties: {
          feature_spec: { type: 'string' },
        },
        required: ['feature_spec'],
      },
    }),
    listSkills: async () => [],
    getVaultDataKey: async () => dek,
    searchChunks: async () => [],
  };

  const mockClaude = new MockClaudeClient(
    'Estimation summary: Estimated 120 story points based on proprietary models.'
  );
  const orchestrator = new ZeroReadSkillOrchestrator(mockClaude);
  const provider = new LockedToolsProvider(mockStore, orchestrator);

  const response = await provider.handleRunSkill({
    vault_id: 'vlt_locked_1',
    skill_name: 'proprietary-estimator',
    arguments: {
      feature_spec: 'Real-time WebSocket notifications engine',
    },
  });

  assert.ok(response.content[0].text.includes('120 story points'));
  assert.equal(response.content[0].text.includes('Estimate hours for features'), false);
});

test('Locked MCP Tools: ask_vault synthesizes executive answer without disclosing markdown files', async () => {
  const dek = EnvelopeEncryption.generateDek();
  const chunkText = 'Confidential Board Resolution 2026: Approved European expansion with $15M budget.';
  const encryptedChunk = EnvelopeEncryption.encrypt(chunkText, dek);

  const mockStore = {
    getSkillByName: async () => null,
    listSkills: async () => [],
    getVaultDataKey: async () => dek,
    searchChunks: async () => [{ encryptedText: encryptedChunk }],
  };

  const mockClaude = new MockClaudeClient(
    'The company board approved the European expansion initiative with a total allocation of $15 million.'
  );
  const orchestrator = new ZeroReadSkillOrchestrator(mockClaude);
  const provider = new LockedToolsProvider(mockStore, orchestrator);

  const response = await provider.handleAskVault({
    vault_id: 'vlt_board_locked',
    question: 'What was the budget approved for European expansion?',
  });

  assert.ok(response.content[0].text.includes('$15 million'));
  // Ensure no page titles or raw markdown chunks are leaked
  assert.equal(response.content[0].text.includes('Confidential Board Resolution 2026:'), false);
});

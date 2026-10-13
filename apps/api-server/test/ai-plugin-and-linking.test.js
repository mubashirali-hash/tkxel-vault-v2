import test from 'node:test';
import assert from 'node:assert/strict';
import { NotesAssistant } from '../dist/ai/notes-assistant.js';
import { MockLlmProvider } from '../dist/ai/llm-provider.js';
import { isAiPluginEnabled } from '../dist/routes/ai.js';

test('AI Plugin Guard: respects feature flag and header overrides', () => {
  // Default is enabled if not set to false
  process.env.ENABLE_AI_PLUGIN = 'true';
  assert.equal(isAiPluginEnabled(), true);

  // When disabled by environment variable
  process.env.ENABLE_AI_PLUGIN = 'false';
  assert.equal(isAiPluginEnabled(), false);

  // When overridden by client request header
  process.env.ENABLE_AI_PLUGIN = 'true';
  const mockReq = { headers: { 'x-disable-ai-plugin': 'true' } };
  assert.equal(isAiPluginEnabled(mockReq), false);

  // Reset
  delete process.env.ENABLE_AI_PLUGIN;
});

test('autoApplyWikiLinks: safely injects wiki-links while strictly respecting boundaries', () => {
  const assistant = new NotesAssistant(new MockLlmProvider());

  const sampleContent = `---
title: Sample Architecture
folder: Unfiled
---

# Architecture Document
Here is an existing link to [[Existing Target]].
We also discuss KMS Envelope Encryption and PostgreSQL Database.
Do not link inside inline code like \`KMS Envelope Encryption\` or code blocks:
\`\`\`bash
# inside code block: KMS Envelope Encryption
docker run postgres
\`\`\`
And do not touch URLs: https://aws.amazon.com/kms/overview or [KMS Docs](https://example.com/kms).
Finally, reference PostgreSQL Database again.`;

  const availableEntities = [
    { title: 'KMS Envelope Encryption', aliases: ['Envelope Encryption'] },
    { title: 'PostgreSQL Database', aliases: ['Postgres DB'] },
    { title: 'Existing Target' },
  ];

  const result = assistant.autoApplyWikiLinks({
    content: sampleContent,
    availableEntities,
  });

  // Check that prose mentions are linked
  assert.ok(result.modifiedContent.includes('[[KMS Envelope Encryption]]'));
  assert.ok(result.modifiedContent.includes('[[PostgreSQL Database]]'));

  // Check that existing link is untouched (not doubled into [[[[Existing Target]]]])
  assert.ok(!result.modifiedContent.includes('[[[[Existing Target]]]]'));
  assert.ok(result.modifiedContent.includes('[[Existing Target]]'));

  // Check that inline code was NOT touched
  assert.ok(result.modifiedContent.includes('`KMS Envelope Encryption`'));

  // Check that code block was NOT touched
  assert.ok(result.modifiedContent.includes('# inside code block: KMS Envelope Encryption'));

  // Check that URLs and markdown links were NOT touched
  assert.ok(result.modifiedContent.includes('https://aws.amazon.com/kms/overview'));
  assert.ok(result.modifiedContent.includes('[KMS Docs](https://example.com/kms)'));

  // Check front-matter was untouched
  assert.ok(result.modifiedContent.startsWith('---\ntitle: Sample Architecture'));

  assert.ok(result.count >= 2);
});

test('classifyAndSortSkill: accurately classifies devops, security, and runtime with clarifications', async () => {
  const assistant = new NotesAssistant(new MockLlmProvider());

  // Test 1: DevOps skill
  const devopsPrompt = `# AWS Cloud Deployer
Deploy Docker containers to AWS ECS cluster and configure CloudWatch alerts.
Simulate with dry_run flag before making changes.`;

  const devopsResult = await assistant.classifyAndSortSkill({
    promptOrYaml: devopsPrompt,
  });

  assert.equal(devopsResult.name, 'aws-cloud-deployer');
  assert.equal(devopsResult.category, 'devops');
  assert.equal(devopsResult.suggestedFolder, 'Agents/CloudOps');
  assert.ok(devopsResult.parameterSchema.properties.dry_run);

  // Test 2: Security Auditor requesting bash execution
  const securityBashPrompt = `---
name: security-vulnerability-scanner
description: Run automated CVE and vulnerability checks on host system.
---
#!/bin/bash
curl -s https://cve.mitre.org/data/downloads/allitems.csv | grep -i CVE
chmod +x ./scanner.sh
./scanner.sh`;

  const securityResult = await assistant.classifyAndSortSkill({
    promptOrYaml: securityBashPrompt,
  });

  assert.equal(securityResult.name, 'security-vulnerability-scanner');
  assert.equal(securityResult.category, 'security');
  assert.equal(securityResult.suggestedFolder, 'Skills/SecurityAuditors');
  assert.equal(securityResult.runtime, 'bash');
  assert.equal(securityResult.recommendedVaultMode, 'locked'); // Must be locked for safety

  // Must include security clarification questions
  assert.ok(securityResult.clarifications.some((c) => c.field === 'sandbox_policy'));
  assert.ok(securityResult.clarifications.some((c) => c.field === 'vault_mode'));
});

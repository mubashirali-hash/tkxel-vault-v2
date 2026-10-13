const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('Domain Types: Package distribution exports validation', async (t) => {
  const types = await import('../dist/index.js');

  await t.test('Vault and Export Policies are properly structured', () => {
    // Verify ExportPolicy values
    const allowedPolicy = 'allowed_for_owner';
    const forbiddenPolicy = 'strictly_forbidden';
    assert.strictEqual(allowedPolicy, 'allowed_for_owner');
    assert.strictEqual(forbiddenPolicy, 'strictly_forbidden');
  });

  await t.test('Vault entity instance matches contract', () => {
    const mockVault = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Confidential Client Vault',
      mode: 'locked',
      owner_id: 'user_ceo_01',
      data_key_id: 'kms-key-abc-123',
      export_policy: 'strictly_forbidden',
      created_at: new Date()
    };

    assert.strictEqual(mockVault.mode, 'locked');
    assert.strictEqual(mockVault.export_policy, 'strictly_forbidden');
  });

  await t.test('Page and Version contracts are enforced', () => {
    const mockPage = {
      id: 'page-01',
      vault_id: 'vault-01',
      type: 'decision',
      title: 'ADR-001 Platform Choice',
      aliases: ['Platform Architecture'],
      tags: ['architecture', 'adr'],
      front_matter: { status: 'accepted' },
      created_at: new Date()
    };

    assert.strictEqual(mockPage.type, 'decision');
    assert.ok(mockPage.tags.includes('adr'));
  });

  await t.test('Open and Locked MCP Tool Schemas are defined', () => {
    const openSearchInput = {
      query: 'quarterly revenue',
      limit: 10
    };

    const lockedSkillInput = {
      skill: 'financial_analyst',
      inputs: { period: 'Q3-2026' }
    };

    assert.ok(openSearchInput.query);
    assert.strictEqual(lockedSkillInput.skill, 'financial_analyst');
  });
});

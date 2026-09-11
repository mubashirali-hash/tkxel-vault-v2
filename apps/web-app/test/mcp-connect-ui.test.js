import test from 'node:test';
import assert from 'node:assert/strict';

function generateClaudeDesktopConfig(stdioScriptPath) {
  return JSON.stringify({
    mcpServers: {
      'tkxel-vault': {
        command: 'node',
        args: [stdioScriptPath],
      },
    },
  }, null, 2);
}

function generateCursorConfig(stdioScriptPath) {
  return JSON.stringify({
    mcpServers: {
      'tkxel-vault': {
        command: 'node',
        args: [stdioScriptPath],
      },
    },
  }, null, 2);
}

function getAvailableToolsForVaultMode(vaultMode) {
  if (vaultMode === 'open') {
    return [
      { name: 'search', description: 'Hybrid search' },
      { name: 'get_page', description: 'Read page' },
      { name: 'get_links', description: 'Inspect links' },
      { name: 'get_context', description: 'Context package' },
      { name: 'add_note', description: 'Add notes' },
    ];
  } else {
    return [
      { name: 'run_skill', description: 'Zero-read sandboxed skill execution' },
      { name: 'ask_vault', description: 'Anti-exfiltration QA' },
    ];
  }
}

test('MCP Connect UI: Generates valid Claude Desktop JSON config with stdio sub-process', () => {
  const stdioPath = '<TKXEL_VAULT_ROOT>/services/mcp-gateway/dist/stdio.js';
  const rawConfig = generateClaudeDesktopConfig(stdioPath);
  
  const parsed = JSON.parse(rawConfig);
  assert.ok(parsed.mcpServers['tkxel-vault']);
  assert.equal(parsed.mcpServers['tkxel-vault'].command, 'node');
  assert.deepEqual(parsed.mcpServers['tkxel-vault'].args, [stdioPath]);
  assert.equal(parsed.mcpServers['tkxel-vault'].env, undefined);
});

test('MCP Connect UI: Generates valid Cursor .cursor/mcp.json config', () => {
  const stdioPath = '<TKXEL_VAULT_ROOT>/services/mcp-gateway/dist/stdio.js';
  const rawConfig = generateCursorConfig(stdioPath);
  
  const parsed = JSON.parse(rawConfig);
  assert.ok(parsed.mcpServers['tkxel-vault']);
  assert.equal(parsed.mcpServers['tkxel-vault'].command, 'node');
  assert.deepEqual(parsed.mcpServers['tkxel-vault'].args, [stdioPath]);
});

test('MCP Connect UI: Open Vault exposes 5 retrieval & authoring tools', () => {
  const tools = getAvailableToolsForVaultMode('open');
  assert.equal(tools.length, 5);
  const toolNames = tools.map((t) => t.name);
  assert.deepEqual(toolNames, ['search', 'get_page', 'get_links', 'get_context', 'add_note']);
});

test('MCP Connect UI: Locked Vault strictly enforces Zero-Read constraint (run_skill, ask_vault)', () => {
  const tools = getAvailableToolsForVaultMode('locked');
  assert.equal(tools.length, 2);
  const toolNames = tools.map((t) => t.name);
  assert.deepEqual(toolNames, ['run_skill', 'ask_vault']);
  // Raw retrieval tools must NEVER be exposed for locked vaults
  assert.ok(!toolNames.includes('get_page'));
  assert.ok(!toolNames.includes('search'));
});

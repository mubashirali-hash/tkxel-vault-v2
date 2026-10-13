import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8');
const integrationSource = readFileSync(new URL('../src/components/mcp/McpConnectModal.tsx', import.meta.url), 'utf8');
const conversionSource = readFileSync(new URL('../src/components/skills/ConvertNoteToSkillModal.tsx', import.meta.url), 'utf8');

test('UXR-07 uses one protected-skills catalog with concise expandable protection guidance', () => {
  assert.match(appSource, /className="protected-catalog"/);
  assert.match(appSource, /How zero-read protection works/);
  assert.match(appSource, /raw content, file listings, graph data, and export remain unavailable/);
  assert.doesNotMatch(sidebarSource, /lockedSkills\.map|Available Skills in Catalog/);
});

test('UXR-07 keeps management role-gated, audited, and client neutral', () => {
  assert.match(appSource, /currentRole === 'owner' \|\| currentRole === 'editor'/);
  assert.match(appSource, /action: 'delete_skill'/);
  assert.match(appSource, /Copy invocation/);
  assert.doesNotMatch(appSource, /Copy Claude Prompt/);
});

test('UXR-07 integration examples are portable and contain no workstation path or plaintext database credential', () => {
  assert.match(integrationSource, /<TKXEL_VAULT_ROOT>/);
  assert.match(integrationSource, /&lt;MCP_GATEWAY_URL&gt;/);
  assert.match(integrationSource, /Cursor \/ Codex \/ IDEs/);
  assert.doesNotMatch(integrationSource, /C:\\\\Users\\\\/);
  assert.doesNotMatch(integrationSource, /postgrespassword|DATABASE_URL/);
});

test('UXR-07 never derives public catalog descriptions from protected note instructions', () => {
  assert.match(appSource, /safeSkillSummary/);
  assert.match(conversionSource, /Use public catalog metadata without copying protected note content/);
  assert.doesNotMatch(conversionSource, /extractedDesc|slice\(0, 160\)/);
});

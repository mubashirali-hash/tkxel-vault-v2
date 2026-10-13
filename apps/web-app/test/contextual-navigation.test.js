import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../src/components/layout/AppShell.tsx', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('../src/components/editor/MarkdownEditor.tsx', import.meta.url), 'utf8');
const auditSource = readFileSync(new URL('../src/components/audit/AuditViewer.tsx', import.meta.url), 'utf8');
const integrationSource = readFileSync(new URL('../src/components/mcp/McpConnectModal.tsx', import.meta.url), 'utf8');

test('UXR-03 renders notes navigation only inside the open-vault editor', () => {
  assert.match(appSource, /\{!isLocked && currentTab === 'editor' && <Sidebar/);
  assert.match(appSource, /navigationAvailable=\{!isLocked && currentTab === 'editor'\}/);
  assert.doesNotMatch(sidebarSource, /TEAM ACCESS|Connect LLM|Zero-Read Protected Vault|Add Locked Skill/);
});

test('UXR-03 keeps vault administration in one role-aware workspace menu', () => {
  assert.match(shellSource, /label: 'Import notes'/);
  assert.match(shellSource, /label: 'Share and access'/);
  assert.match(shellSource, /label: 'Integrations'/);
  assert.match(shellSource, /label: 'Export vault'/);
});

test('UXR-03 uses plain-language navigation while retaining technical detail in context', () => {
  assert.match(auditSource, /Activity (?:&amp;|&) Audit/);
  assert.match(integrationSource, />\s*Integrations\s*</);
  assert.match(integrationSource, /MCP 2025-11-25/);
  assert.match(editorSource, /label: 'Create protected skill'/);
  assert.doesNotMatch(editorSource, />\s*Promote to Locked Skill\s*</);
});

test('UXR-03 reduces the persistent editor action hierarchy', () => {
  assert.match(editorSource, /<ActionMenu[\s\S]*label="More note actions"/);
  assert.match(editorSource, /Save Draft/);
  assert.match(editorSource, /Publish/);
  assert.match(editorSource, /AI Co-Pilot/);
});

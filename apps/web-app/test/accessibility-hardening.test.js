import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const legacyDialogs = [
  '../src/components/export/ExportModal.tsx',
  '../src/components/ingestion/ImporterModal.tsx',
  '../src/components/sharing/SharingModal.tsx',
  '../src/components/skills/AddSkillModal.tsx',
  '../src/components/skills/ConvertNoteToSkillModal.tsx',
  '../src/components/mcp/McpConnectModal.tsx',
];

test('UXR-08 shared modal behavior traps and restores keyboard focus', () => {
  const hook = readSource('../src/components/ui/useModalAccessibility.ts');
  const drawer = readSource('../src/components/ui/Drawer.tsx');

  assert.match(hook, /event\.key !== 'Tab'/);
  assert.match(hook, /event\.key === 'Escape'/);
  assert.match(hook, /previouslyFocused\?\.focus\(\)/);
  assert.match(drawer, /useModalAccessibility/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /tabIndex=\{-1\}/);
});

test('UXR-08 all legacy overlays expose dialog semantics and shared focus handling', () => {
  for (const dialogPath of legacyDialogs) {
    const source = readSource(dialogPath);
    assert.match(source, /useModalAccessibility/);
    assert.match(source, /role="dialog"/);
    assert.match(source, /aria-modal="true"/);
    assert.match(source, /aria-label=/);
    assert.match(source, /tabIndex=\{-1\}/);
  }
});

test('UXR-08 menus, tabs, and importer have complete keyboard alternatives', () => {
  const menu = readSource('../src/components/ui/ActionMenu.tsx');
  const integrations = readSource('../src/components/mcp/McpConnectModal.tsx');
  const importer = readSource('../src/components/ingestion/ImporterModal.tsx');

  assert.match(menu, /event\.key === 'ArrowDown'/);
  assert.match(menu, /event\.key === 'ArrowUp'/);
  assert.match(menu, /event\.key === 'Home'/);
  assert.match(menu, /triggerRef\.current\?\.focus\(\)/);
  assert.match(integrations, /role="tablist"/);
  assert.equal((integrations.match(/aria-selected=\{activeTab ===/g) ?? []).length, 4);
  assert.equal((integrations.match(/role="tabpanel"/g) ?? []).length, 4);
  assert.match(importer, /aria-label="Choose Markdown files or a ZIP archive to import"/);
  assert.match(importer, /e\.key === 'Enter' \|\| e\.key === ' '/);
});

test('UXR-08 global styles support reduced motion, zoom, and long content', () => {
  const styles = readSource('../src/styles/index.css');

  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /max-width: calc\(100vw - 32px\)/);
  assert.match(styles, /max-height: calc\(100vh - 32px\)/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /@media \(max-width: 480px\), \(max-height: 560px\)/);
});

test('UXR-08 avoids blocking browser alerts and confirmations', () => {
  const appSources = [
    readSource('../src/App.tsx'),
    ...legacyDialogs.map(readSource),
  ].join('\n');

  assert.doesNotMatch(appSources, /window\.(alert|confirm)\s*\(/);
});

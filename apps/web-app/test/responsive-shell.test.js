import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSource = readFileSync(new URL('../src/components/layout/AppShell.tsx', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8');
const aiInspectorSource = readFileSync(new URL('../src/features/notes-ai/NotesAiDrawer.tsx', import.meta.url), 'utf8');
const responsiveCss = readFileSync(new URL('../src/styles/shell.css', import.meta.url), 'utf8');

test('UXR-02 provides adaptive header, mobile navigation, and safe viewport sizing', () => {
  assert.match(responsiveCss, /height:\s*100dvh/);
  assert.match(responsiveCss, /@media \(max-width: 899px\)/);
  assert.match(shellSource, /className="app-mobile-nav"/);
  assert.match(shellSource, /aria-label="Primary workspace navigation"/);
  assert.match(shellSource, /aria-current=/);
});

test('UXR-02 moves secondary actions into a role-aware overflow menu', () => {
  assert.match(shellSource, /<ActionMenu label="Workspace actions"/);
  assert.match(shellSource, /isOpenVault && currentRole === 'owner'/);
  assert.match(shellSource, /isOpenVault && currentRole !== 'reader'/);
  assert.doesNotMatch(shellSource, /Export strictly forbidden on Locked Vaults/);
});

test('UXR-02 sidebar becomes a closable, focus-contained mobile drawer', () => {
  assert.match(sidebarSource, /className="workspace-sidebar notes-sidebar"/);
  assert.match(sidebarSource, /querySelectorAll<HTMLElement>/);
  assert.match(sidebarSource, /event\.key !== 'Tab'/);
  assert.match(sidebarSource, /previouslyFocused\?\.focus\(\)/);
  assert.match(responsiveCss, /\.workspace-sidebar\[data-open='true'\]/);
});

test('UXR-02 AI assistant becomes a narrow-screen sheet with keyboard containment', () => {
  assert.match(aiInspectorSource, /className="notes-ai-inspector"/);
  assert.match(aiInspectorSource, /aria-modal="true"/);
  assert.match(aiInspectorSource, /window\.matchMedia\('\(max-width: 899px\)'\)/);
  assert.match(responsiveCss, /\.notes-ai-inspector[\s\S]*position:\s*fixed/);
});

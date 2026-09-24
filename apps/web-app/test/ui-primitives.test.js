import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('UXR-01 provides consistent button variants and loading semantics', () => {
  const source = readSource('../src/components/ui/Button.tsx');
  const styles = readSource('../src/styles/ui.css');

  assert.match(source, /'primary' \| 'secondary' \| 'quiet' \| 'danger'/);
  assert.match(source, /aria-busy/);
  assert.match(source, /disabled=\{disabled \|\| loading\}/);
  assert.match(styles, /\.ui-button--primary/);
  assert.match(styles, /\.ui-button--danger/);
  assert.match(styles, /\.ui-button:disabled/);
});

test('UXR-01 icon controls require accessible labels', () => {
  const source = readSource('../src/components/ui/IconButton.tsx');
  assert.match(source, /label: string/);
  assert.match(source, /aria-label=\{label\}/);
});

test('UXR-01 dialog and menu primitives expose keyboard behavior', () => {
  const dialog = readSource('../src/components/ui/Dialog.tsx');
  const menu = readSource('../src/components/ui/ActionMenu.tsx');

  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /event\.key === 'Escape'/);
  assert.match(dialog, /event\.key !== 'Tab'/);
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /event\.key === 'Escape'/);
});

test('UXR-01 defines reusable spacing, controls, layout, and reduced-motion tokens', () => {
  const tokens = readSource('../src/styles/tokens.css');
  const globalStyles = readSource('../src/styles/index.css');

  assert.match(tokens, /--space-1:/);
  assert.match(tokens, /--control-height-touch: 44px/);
  assert.match(tokens, /--sidebar-width:/);
  assert.match(tokens, /--focus-ring:/);
  assert.match(globalStyles, /prefers-reduced-motion: reduce/);
  assert.match(globalStyles, /:focus-visible/);
});

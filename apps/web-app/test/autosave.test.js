import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editorSource = readFileSync(new URL('../src/components/editor/MarkdownEditor.tsx', import.meta.url), 'utf8');
const editorCss = readFileSync(new URL('../src/styles/editor.css', import.meta.url), 'utf8');

test('Autosave: MarkdownEditor implements debounced auto-saving', () => {
  assert.match(editorSource, /autoSaveTimerRef/);
  assert.match(editorSource, /handleSaveDocument\(true,\s*true\)/);
  assert.match(editorSource, /1500\);/);
});

test('Autosave: supports user toggle with localStorage persistence', () => {
  assert.match(editorSource, /tkxel_vault_autosave_enabled/);
  assert.match(editorSource, /autoSaveEnabled/);
  assert.match(editorSource, /Autosave on/);
  assert.match(editorSource, /Autosave off/);
  assert.match(editorSource, /Disable Autosave/);
  assert.match(editorSource, /Enable Autosave/);
});

test('Autosave: supports Ctrl+S and Cmd+S keyboard shortcut', () => {
  assert.match(editorSource, /\(e\.ctrlKey\s*\|\|\s*e\.metaKey\)\s*&&\s*e\.key\.toLowerCase\(\)\s*===\s*'s'/);
  assert.match(editorSource, /e\.preventDefault\(\)/);
  assert.match(editorSource, /handleSaveDocument\(true,\s*false\)/);
});

test('Autosave: provides visual feedback and maintains UI contracts', () => {
  assert.match(editorSource, /isAutoSaving/);
  assert.match(editorSource, /Saving\.\.\./);
  assert.match(editorSource, /lastSavedAt/);
  assert.match(editorCss, /\.markdown-editor__save-state\[data-state='saving'\]/);
  assert.match(editorCss, /\.spin-animate/);

  assert.match(editorSource, /Unsaved draft/);
  assert.match(editorSource, /Draft saved/);
  assert.match(editorSource, /Offline — changes stay here/);
  assert.match(editorSource, /Save Draft/);
  assert.match(editorSource, /Publish/);
});

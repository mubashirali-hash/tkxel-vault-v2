import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editorSource = readFileSync(new URL('../src/components/editor/MarkdownEditor.tsx', import.meta.url), 'utf8');
const inspectorSource = readFileSync(new URL('../src/components/editor/NoteInspector.tsx', import.meta.url), 'utf8');
const pickerSource = readFileSync(new URL('../src/components/editor/WikiLinkPicker.tsx', import.meta.url), 'utf8');
const diffSource = readFileSync(new URL('../src/components/editor/DiffViewer.tsx', import.meta.url), 'utf8');

test('UXR-04 keeps writing primary and moves supporting information into the inspector', () => {
  assert.match(editorSource, /className="note-summary"/);
  assert.match(editorSource, /<NoteInspector/);
  assert.match(inspectorSource, /'properties' \| 'links' \| 'graph' \| 'timeline'/);
  assert.match(inspectorSource, /Links to this note/);
  assert.match(inspectorSource, /Links from this note/);
  assert.match(inspectorSource, /<LocalGraphView/);
  assert.match(inspectorSource, /<TimelineView/);
});

test('UXR-04 positions wiki-link suggestions at the caret and supports ghost links safely', () => {
  assert.match(editorSource, /coordsAtPos/);
  assert.match(editorSource, /wiki-link-picker-anchor/);
  assert.match(editorSource, /Create linked note\?/);
  assert.match(editorSource, /onCreateGhostPage/);
  assert.match(pickerSource, /role="listbox"/);
  assert.match(pickerSource, /role="option"/);
});

test('UXR-04 uses application dialogs for destructive actions and readable line diffs', () => {
  assert.doesNotMatch(editorSource, /window\.confirm/);
  assert.doesNotMatch(diffSource, /window\.confirm/);
  assert.match(editorSource, /title="Delete this note\?"/);
  assert.match(diffSource, /buildLineDiff/);
  assert.match(diffSource, /data-kind=\{row\.kind\}/);
});

test('UXR-04 makes draft, publish, insert, and connectivity states explicit', () => {
  assert.match(editorSource, /Unsaved draft/);
  assert.match(editorSource, /Draft saved/);
  assert.match(editorSource, /Offline — changes stay here/);
  assert.match(editorSource, /Save Draft/);
  assert.match(editorSource, /Publish/);
  assert.match(editorSource, /label="Insert"/);
  assert.match(editorSource, /Task checklist/);
  assert.match(editorSource, /Timeline entry/);
});

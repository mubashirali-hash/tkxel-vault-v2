import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MarkdownImporter } from '@tkxel-vault/vault-core/markdown';

const sidebarSource = readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8');
const inspectorSource = readFileSync(new URL('../src/components/editor/NoteInspector.tsx', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('../src/components/editor/MarkdownEditor.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('Folder System: Sidebar supports folder creation, grouping, and note movement', () => {
  assert.match(sidebarSource, /New folder/);
  assert.match(sidebarSource, /onCreateFolder/);
  assert.match(sidebarSource, /onMoveNoteToFolder/);
  assert.match(sidebarSource, /notes-sidebar__folder-group/);
  assert.match(sidebarSource, /notes-sidebar__folder-toggle/);
  assert.match(sidebarSource, /Create new folder/);
  assert.match(sidebarSource, /Move to /);
});

test('Folder System: Sidebar supports drag-and-drop notes into folders and unfiled section', () => {
  assert.match(sidebarSource, /draggable=\{canEdit\}/);
  assert.match(sidebarSource, /onDragStart/);
  assert.match(sidebarSource, /handleFolderDrop/);
  assert.match(sidebarSource, /data-dragover/);
  assert.match(sidebarSource, /data-dragging/);
  assert.match(sidebarSource, /notes-sidebar__drag-handle/);
});

test('Folder System: NoteInspector allows viewing and assigning folders', () => {
  assert.match(inspectorSource, /<label>Folder/);
  assert.match(inspectorSource, /onChangeFolder/);
  assert.match(inspectorSource, /\(None \/ Unfiled\)/);
  assert.match(inspectorSource, /\+ New/);
});

test('Folder System: MarkdownEditor displays folder breadcrumb in document header', () => {
  assert.match(editorSource, /📁 \{folder \|\| 'Unfiled'\}/);
  assert.match(editorSource, /onChangeFolder/);
});

test('Folder System: MarkdownImporter extracts folders from nested directory paths', () => {
  const importer = new MarkdownImporter();
  const fileMap = new Map([
    ['agents/planner.md', '---\ntitle: Master Planner\n---\n# Master Planner\n\nPlans tasks.'],
    ['projects/cloud-gateway.md', '---\ntitle: Cloud Gateway\n---\n# Cloud Gateway\n\nGateway docs.'],
    ['root-note.md', '# Root Note\n\nTop level note.'],
  ]);

  const result = importer.importFromMap(fileMap);
  assert.equal(result.pages.length, 3);

  const agentPage = result.pages.find((p) => p.title === 'Master Planner');
  assert.equal(agentPage?.folder, 'agents');

  const projectPage = result.pages.find((p) => p.title === 'Cloud Gateway');
  assert.equal(projectPage?.folder, 'projects');

  const rootPage = result.pages.find((p) => p.slug === 'root-note');
  assert.equal(rootPage?.folder, undefined);
});

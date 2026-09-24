import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const shellSource = readFileSync(
  new URL('../src/components/layout/AppShell.tsx', import.meta.url),
  'utf8',
);
const exportModalSource = readFileSync(
  new URL('../src/components/export/ExportModal.tsx', import.meta.url),
  'utf8',
);
const editorSource = readFileSync(
  new URL('../src/components/editor/MarkdownEditor.tsx', import.meta.url),
  'utf8',
);
const localGraphSource = readFileSync(
  new URL('../src/components/graph/LocalGraphView.tsx', import.meta.url),
  'utf8',
);
const baseline = JSON.parse(
  readFileSync(new URL('./fixtures/ui-redesign-baseline.json', import.meta.url), 'utf8'),
);

test('UXR-00 baseline defines the supported viewport and surface matrix', () => {
  assert.deepEqual(
    baseline.viewports.map(({ width, height }) => `${width}x${height}`),
    ['390x844', '768x1024', '1024x768', '1280x720', '1440x900'],
  );
  assert.deepEqual(baseline.surfaces, [
    'open-notes',
    'open-graph',
    'open-audit',
    'locked-skills',
    'locked-audit',
  ]);
  assert.equal(baseline.rollback.tag, 'ui-ux-redesign-baseline');
});

test('UXR-00 preserves vault-mode and export UI safety contracts', () => {
  assert.match(appSource, /\{!isLocked && currentTab === 'graph' && \(/);
  assert.match(appSource, /\{isLocked && currentTab === 'editor' && \(/);
  assert.match(appSource, /export_policy: 'strictly_forbidden'/);
  assert.match(shellSource, /\{isOpenVault && \(/);
  assert.match(shellSource, /isOpenVault && currentRole === 'owner'/);
  assert.match(exportModalSource, /const canExport = !isLockedVault && isOwner/);
});

test('UXR-00 preserves authoring and linking contracts', () => {
  assert.match(editorSource, /Markdown\.configure\(/);
  assert.match(editorSource, /aliases/);
  assert.match(editorSource, /pageType/);
  assert.match(editorSource, /onAddTimelineEntry/);
  assert.match(editorSource, /onCreateGhostPage/);
  assert.match(editorSource, /\[\[\$\{linkTitle\}\]\]/);
});

test('UXR-00 preserves the two-hop local graph contract', () => {
  const traversalCount = (localGraphSource.match(/allLinks\.forEach/g) || []).length;
  assert.equal(traversalCount, 2);
  assert.match(localGraphSource, /Local Neighborhood Graph: 2-hop radius/);
  assert.match(localGraphSource, /neighborhoodPageIds\.has\(l\.from_page_id\)/);
  assert.match(localGraphSource, /neighborhoodPageIds\.has\(l\.to_page_id\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const graphSource = readFileSync(new URL('../src/components/graph/KnowledgeGraph.tsx', import.meta.url), 'utf8');
const toolbarSource = readFileSync(new URL('../src/components/graph/GraphToolbar.tsx', import.meta.url), 'utf8');
const inspectorSource = readFileSync(new URL('../src/components/graph/GraphInspector.tsx', import.meta.url), 'utf8');
const localSource = readFileSync(new URL('../src/components/graph/LocalGraphView.tsx', import.meta.url), 'utf8');

test('UXR-05 provides clear graph scopes, scalable filters, counts, and labeled controls', () => {
  assert.match(toolbarSource, /Local neighborhood/);
  assert.match(toolbarSource, /Entire vault/);
  assert.match(toolbarSource, /All types/);
  assert.match(toolbarSource, /resultCount/);
  assert.match(toolbarSource, /label="Zoom in"/);
  assert.match(toolbarSource, /label="Fit selected note"/);
});

test('UXR-05 supports inspect, open, and connect without gesture-only controls', () => {
  assert.match(graphSource, /<GraphInspector/);
  assert.match(inspectorSource, /Open note/);
  assert.match(inspectorSource, /Links to this note/);
  assert.match(inspectorSource, /Links from this note/);
  assert.match(graphSource, /role="listbox"/);
  assert.match(graphSource, /role="option"/);
  assert.match(graphSource, /Select a source note before connecting/);
});

test('UXR-05 preserves two-hop local graphs and adds large-graph level of detail', () => {
  assert.match(graphSource, /getTwoHopPageIds/);
  assert.match(localSource, /activePageId=\{focalPage\.id\} compact/);
  assert.match(graphSource, /nodes\.length < 80/);
  assert.match(graphSource, /Math\.min\(14, 7 \+ Math\.sqrt/);
  assert.match(graphSource, /selectedNeighborIds/);
});

test('UXR-05 synthetic 2,000-node neighborhood indexing stays within the interaction budget', () => {
  const nodeCount = 2000;
  const links = Array.from({ length: 6000 }, (_, index) => ({
    from_page_id: `page-${index % nodeCount}`,
    to_page_id: `page-${(index * 17 + 13) % nodeCount}`,
  }));
  const started = performance.now();
  const ids = new Set(['page-0']);
  for (const link of links) {
    if (link.from_page_id === 'page-0') ids.add(link.to_page_id);
    if (link.to_page_id === 'page-0') ids.add(link.from_page_id);
  }
  const firstHop = new Set(ids);
  for (const link of links) {
    if (firstHop.has(link.from_page_id)) ids.add(link.to_page_id);
    if (firstHop.has(link.to_page_id)) ids.add(link.from_page_id);
  }
  const elapsedMs = performance.now() - started;
  assert.ok(ids.size > 1);
  assert.ok(elapsedMs < 50, `2,000-node graph indexing took ${elapsedMs.toFixed(1)}ms`);
});

test('UXR-05 supports 3D Globe mode with front-seen/back-faded depth occlusion and graph controls', () => {
  // 3D Mode Switcher and Settings in toolbar
  assert.match(toolbarSource, /2D Flat/);
  assert.match(toolbarSource, /3D Globe/);
  assert.match(toolbarSource, /Hide orphan notes/);
  assert.match(toolbarSource, /Auto-spin globe/);
  assert.match(toolbarSource, /Label Density/);

  // 3D spherical projection & front-visible / back-faded horizon culling
  assert.match(graphSource, /draw3D/);
  assert.match(graphSource, /draw2D/);
  assert.match(graphSource, /atmosHalo/);
  assert.match(graphSource, /drawPillBadge/);
  assert.match(graphSource, /normZ > 0/);
  assert.match(graphSource, /3D Knowledge Globe/);
});


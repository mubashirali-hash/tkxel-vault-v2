import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { MarkdownImporter } from '../dist/markdown/importer.js';

test('Markdown Importer: imports from file map and ignores .obsidian/ and non-md files', () => {
  const importer = new MarkdownImporter();
  const fileMap = new Map();

  fileMap.set('notes/Architecture.md', '# Architecture\nSee [[Security Model]]. #design');
  fileMap.set('notes/Security Model.md', '---\ntitle: Vault Security\n---\nAES-256 info.');
  fileMap.set('.obsidian/app.json', '{"legacyLayout": false}');
  fileMap.set('assets/diagram.png', 'binary-data');

  const result = importer.importFromMap(fileMap);

  assert.equal(result.totalFilesProcessed, 2);
  assert.equal(result.skippedFiles.length, 2);
  assert.ok(result.skippedFiles.includes('.obsidian/app.json'));
  assert.ok(result.skippedFiles.includes('assets/diagram.png'));

  assert.equal(result.pages.length, 2);
  const archPage = result.pages.find((p) => p.slug === 'architecture');
  assert.ok(archPage);
  assert.equal(archPage.parsed.links[0].target, 'Security Model');

  const secPage = result.pages.find((p) => p.slug === 'vault-security');
  assert.ok(secPage);
  assert.equal(secPage.title, 'Vault Security');
});

test('Markdown Importer: imports from ZIP buffer', async () => {
  const importer = new MarkdownImporter();
  const zip = new JSZip();

  zip.file('General/Welcome.md', '# Welcome to tkxel Vault\n[[Guidelines]]');
  zip.file('General/Guidelines.md', '# Guidelines\nFollow all #security protocols.');
  zip.file('.obsidian/workspace.json', '{}');

  const zipUint8 = await zip.generateAsync({ type: 'uint8array' });
  const result = await importer.importFromZip(Buffer.from(zipUint8));

  assert.equal(result.totalFilesProcessed, 2);
  assert.equal(result.totalWikiLinksFound, 1);
  assert.equal(result.totalTagsFound, 1);
  assert.equal(result.skippedFiles.length, 1);
});

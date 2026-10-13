import { register } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

register(new URL('./helpers/tsx-loader.js', import.meta.url).href, import.meta.url);

const { companionFilePaths, createSkillApi } = await import('../src/operations/skill-actions.ts');

test('Skill bundle: companion files are taken from beside SKILL.md, relative to its folder', () => {
  const entries = [
    'case-study/',
    'case-study/SKILL.md',
    'case-study/tool.json',
    'case-study/scripts/',
    'case-study/scripts/render.py',
    'case-study/templates/layout.md',
    'case-study/.DS_Store',
    'case-study/.git/config',
    '__MACOSX/case-study/._SKILL.md',
    'other-folder/notes.txt',
  ];
  assert.deepEqual(companionFilePaths(entries, 'case-study/SKILL.md', 'case-study/tool.json'), [
    { zipPath: 'case-study/scripts/render.py', relativePath: 'scripts/render.py' },
    { zipPath: 'case-study/templates/layout.md', relativePath: 'templates/layout.md' },
  ]);

  // SKILL.md at the top of the archive, no tool.json
  assert.deepEqual(companionFilePaths(['SKILL.md', 'helper.py', '__MACOSX/._helper.py', '.env'], 'SKILL.md'), [
    { zipPath: 'helper.py', relativePath: 'helper.py' },
  ]);
  assert.deepEqual(companionFilePaths(['SKILL.md', 'tool.json'], 'SKILL.md', 'tool.json'), []);
});

test('Skill bundle: companion files are sent to the server and not kept in browser state', async () => {
  let sent;
  const fetchImpl = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ skill: { id: 's1', name: sent.name } }) };
  };
  await createSkillApi('vault-1', { name: 'case-study', description: 'd', files: { 'scripts/render.py': 'print(1)' } }, { fetchImpl, baseUrl: 'http://api.test' });
  assert.deepEqual(sent.files, { 'scripts/render.py': 'print(1)' });

  const modal = fs.readFileSync(new URL('../src/components/skills/AddSkillModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /companionFilePaths\(Object\.keys\(zip\.files\), skillMdFile\.name, toolJsonFile\?\.name\)/);
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /const \{ files: _uploadedFiles, \.\.\.skillWithoutFiles \} = skillData;/);
});

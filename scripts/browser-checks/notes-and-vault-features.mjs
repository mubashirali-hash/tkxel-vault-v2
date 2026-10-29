// Browser click-through of features that had only been covered by server tests.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, api, check, expect, open, switchVault, openNote, noteMenu, workspaceMenu, describeDialog, typeAtEnd, waitSaved, summary, shots } from './lib.mjs';

fs.mkdirSync(shots, { recursive: true });
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);

// ---------------------------------------------------------------- fixture
const existing = (await api('/vaults')).data.vaults || [];
for (const v of existing.filter((x) => /^QA (Feature Check|Move Target)$/.test(x.name))) await api(`/vaults/${v.id}`, { method: 'DELETE' });
const main = (await api('/vaults', { method: 'POST', body: { name: 'QA Feature Check', mode: 'open' } })).data.vault;
const target = (await api('/vaults', { method: 'POST', body: { name: 'QA Move Target', mode: 'open' } })).data.vault;
const ids = { alpha: crypto.randomUUID(), mover: crypto.randomUUID(), beta: crypto.randomUUID() };
await api(`/vaults/${main.id}/import`, { method: 'POST', body: { pages: [
  { id: ids.alpha, title: 'QA Alpha', type: 'note', tags: ['qa'], content: '# QA Alpha\n\nFIRST-VERSION text of the alpha note.' },
  { id: ids.mover, title: 'QA Mover', type: 'note', tags: ['qa'], content: '# QA Mover\n\nThis note will be moved.' },
  { id: ids.beta, title: 'QA Beta', type: 'note', tags: ['qa'], content: '# QA Beta\n\nLinks to [[QA Alpha]].' },
], links: [] } });
console.log('fixture ready:', main.id);

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const { page } = await open(browser);
await switchVault(page, 'QA Feature Check');

const published = async (id) => (await api(`/pages/${id}/versions?vaultId=${main.id}`)).data.published;
const openInspectorTab = async (tab) => {
  if (!(await page.locator('.note-inspector').count())) await noteMenu(page, 'Note details');
  await page.locator('.note-inspector [role=tab]', { hasText: tab }).click();
  await page.waitForTimeout(900);
};

if (want('history')) {
  await check('edit, autosave and publish a second version', async () => {
    await openNote(page, 'QA Alpha');
    await typeAtEnd(page, ' SECOND-EDIT');
    await waitSaved(page);
    await page.locator('.markdown-editor__actions').getByRole('button', { name: 'Publish' }).click();
    await page.waitForTimeout(2500);
    const text = await published(ids.alpha);
    expect(/SECOND-EDIT/.test(text), `published text is: ${String(text).slice(0, 80)}`);
  });
  await check('history lists the versions and shows a comparison', async () => {
    await openInspectorTab('History');
    const versions = await page.locator('.note-inspector button[aria-pressed]').count();
    expect(versions >= 2, `only ${versions} version buttons`);
    await page.locator('.note-inspector button[aria-pressed]').last().click();
    await page.waitForTimeout(1200);
    const body = await page.locator('.note-inspector').textContent();
    expect(/FIRST-VERSION/.test(body), 'the older version text is not shown');
    await page.screenshot({ path: path.join(shots, 'history.png') });
    return `${versions} versions`;
  });
  await check('restoring the first version publishes it again', async () => {
    await page.locator('.note-inspector').getByRole('button', { name: /^Restore v/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Restore and publish' }).click();
    await page.waitForTimeout(2500);
    const text = await published(ids.alpha);
    expect(text && !/SECOND-EDIT/.test(text) && /FIRST-VERSION/.test(text), `published text is: ${String(text).slice(0, 80)}`);
    const shown = await page.locator('.ProseMirror').textContent();
    expect(!/SECOND-EDIT/.test(shown), 'the editor still shows the newer text after the restore');
  });
}

if (want('timeline')) {
  await check('adding a timeline entry stores it on the server', async () => {
    await openNote(page, 'QA Alpha');
    await openInspectorTab('Timeline');
    const field = page.locator('.note-inspector [placeholder^="Add update or observation"]');
    await field.fill('QA timeline entry 4471');
    await field.press('Enter');
    await page.waitForTimeout(600);
    const add = page.locator('.note-inspector').getByRole('button', { name: /add|log|save/i });
    if (await add.count()) { await add.first().click().catch(() => {}); }
    await page.waitForTimeout(1800);
    const timeline = (await api(`/vaults/${main.id}/timeline`)).data;
    expect(JSON.stringify(timeline).includes('QA timeline entry 4471'), 'entry not found through the API');
    const shown = await page.locator('.note-inspector').textContent();
    expect(shown.includes('QA timeline entry 4471'), 'entry not shown in the panel');
  });
}

if (want('image')) {
  await check('inserting an image stores it in the vault and shows it', async () => {
    await openNote(page, 'QA Beta');
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Control+End');
    // 1x1 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.locator('input[aria-label="Choose an image to insert"]').setInputFiles({ name: 'qa-pixel.png', mimeType: 'image/png', buffer: png });
    await page.waitForTimeout(3000);
    const images = await page.locator('.ProseMirror img').count();
    const error = await page.locator('.markdown-editor__toolbar [role=alert]').textContent().catch(() => '');
    expect(images >= 1, `no image in the editor${error ? ` (message: ${error})` : ''}`);
    const src = await page.locator('.ProseMirror img').first().getAttribute('src');
    const loaded = await page.locator('.ProseMirror img').first().evaluate((img) => img.complete && img.naturalWidth > 0);
    expect(loaded, `image did not load (src ${String(src).slice(0, 60)})`);
    await waitSaved(page);
    return String(src).slice(0, 50);
  });
}

if (want('move')) {
  await check('moving a note to another vault', async () => {
    await openNote(page, 'QA Mover');
    await noteMenu(page, 'Move to another vault');
    const dialog = await describeDialog(page);
    console.log('   move dialog:', JSON.stringify(dialog));
    const select = page.locator('[role=dialog] select');
    await select.first().selectOption({ label: 'QA Move Target (Open Knowledge Hub)' });
    await page.waitForTimeout(400);
    await page.locator('[role=dialog]').getByRole('button', { name: 'Confirm Move' }).click();
    await page.waitForTimeout(3000);
    const inTarget = ((await api(`/vaults/${target.id}/pages`)).data.pages || []).some((p) => p.title === 'QA Mover');
    const inSource = ((await api(`/vaults/${main.id}/pages`)).data.pages || []).some((p) => p.title === 'QA Mover');
    expect(inTarget && !inSource, `in target: ${inTarget}, still in source: ${inSource}`);
    const sidebar = await page.locator('.notes-sidebar__list').textContent();
    expect(!sidebar.includes('QA Mover'), 'the moved note is still listed in the source vault');
  });
}

if (want('export')) {
  await check('exporting an open vault downloads an archive', async () => {
    await workspaceMenu(page, 'Export vault');
    const dialog = await describeDialog(page);
    console.log('   export dialog:', JSON.stringify(dialog));
    const reason = page.locator('[role=dialog] [placeholder^="e.g. Offline backup"]');
    if (await reason.count()) await reason.fill('QA export check');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.locator('[role=dialog]').getByRole('button', { name: /export|download/i }).last().click(),
    ]);
    const file = path.join(shots, 'qa-export.zip');
    await download.saveAs(file);
    const size = fs.statSync(file).size;
    expect(size > 200, `archive is ${size} bytes`);
    const head = fs.readFileSync(file).subarray(0, 2).toString('latin1');
    expect(head === 'PK', 'the download is not a zip archive');
    return `${download.suggestedFilename()} ${size} bytes`;
  });
}

if (want('skill')) {
  await check('create protected skill dialog opens from a note', async () => {
    await page.keyboard.press('Escape');
    await openNote(page, 'QA Alpha');
    await noteMenu(page, 'Create protected skill');
    const dialog = await describeDialog(page);
    console.log('   skill dialog:', JSON.stringify(dialog));
    expect(dialog && /skill/i.test(dialog.text), 'no dialog');
    await page.screenshot({ path: path.join(shots, 'convert-skill.png') });
    await page.keyboard.press('Escape');
  });
}

await browser.close();
// Leave nothing behind
await api(`/vaults/${main.id}`, { method: 'DELETE' });
await api(`/vaults/${target.id}`, { method: 'DELETE' });
process.exitCode = summary() ? 1 : 0;

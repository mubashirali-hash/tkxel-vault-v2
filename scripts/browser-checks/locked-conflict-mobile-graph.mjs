// Second batch: locked-vault reference pages, two people editing, an unreadable vault, phone layout, a 2,000-note graph.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, api, check, expect, open, switchVault, openNote, workspaceMenu, describeDialog, typeAtEnd, waitSaved, summary, shots } from './lib.mjs';

fs.mkdirSync(shots, { recursive: true });
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });

const vaults = async () => (await api('/vaults')).data.vaults || [];
const removeVaults = async (pattern) => { for (const v of (await vaults()).filter((x) => pattern.test(x.name))) await api(`/vaults/${v.id}`, { method: 'DELETE' }); };
const psql = (statement) => execFileSync('docker', ['exec', 'tkxel-vault-postgres', 'psql', '-U', 'postgres', '-d', 'tkxel_vault', '-At', '-c', statement], { encoding: 'utf8' }).trim();

// ---------------------------------------------------------------- reference pages in a locked vault
if (want('reference')) {
  await removeVaults(/^QA Locked Check$/);
  const locked = (await api('/vaults', { method: 'POST', body: { name: 'QA Locked Check', mode: 'locked' } })).data.vault;
  const { context, page } = await open(browser);
  await switchVault(page, 'QA Locked Check');
  await check('locked vault: create, save, publish and delete a reference page', async () => {
    await workspaceMenu(page, 'Reference pages');
    await page.locator('[role=dialog]').getByRole('button', { name: 'New reference page' }).click();
    await page.waitForTimeout(500);
    await page.locator('[role=dialog] input[type=text]').first().fill('QA Reference Policy');
    await page.locator('[role=dialog] textarea').first().fill('# QA Reference Policy\n\nRefunds above 500 need a second approver. MARKER-REF-7731');
    await page.locator('[role=dialog]').getByRole('button', { name: 'Save draft' }).click();
    await page.waitForTimeout(2000);
    let listing = (await api(`/vaults/${locked.id}/locked-pages`)).data;
    expect(JSON.stringify(listing).includes('QA Reference Policy'), `not saved: ${JSON.stringify(listing).slice(0, 160)}`);
    expect(!JSON.stringify(listing).includes('MARKER-REF-7731'), 'the page list exposes page content');
    const publish = page.locator('[role=dialog]').getByRole('button', { name: 'Publish' });
    await publish.first().click();
    await page.waitForTimeout(2000);
    listing = (await api(`/vaults/${locked.id}/locked-pages`)).data;
    const entry = (listing.pages || listing).find?.((p) => p.title === 'QA Reference Policy');
    console.log('   after publish:', JSON.stringify(entry).slice(0, 200));
    expect(entry && (entry.published === true || entry.status === 'published' || entry.has_published || entry.current_version_id), 'page is not marked as published');
    await page.screenshot({ path: path.join(shots, 'reference-pages.png') });
    // Readers of the vault as a whole must not get it through the open-vault endpoints
    const openRoute = await api(`/vaults/${locked.id}/pages`);
    expect(openRoute.status >= 400 || !JSON.stringify(openRoute.data).includes('MARKER-REF-7731'), 'reference page content is readable through the open-vault page list');
    const back = page.locator('[role=dialog]').getByRole('button', { name: 'Back to list' });
    if (await back.count()) { await back.click(); await page.waitForTimeout(600); }
    await page.locator('[role=dialog]').getByRole('button', { name: 'Delete' }).first().click();
    await page.waitForTimeout(400);
    await page.locator('[role=dialog]').getByRole('button', { name: 'Confirm delete' }).click();
    await page.waitForTimeout(1800);
    listing = (await api(`/vaults/${locked.id}/locked-pages`)).data;
    expect(!JSON.stringify(listing).includes('QA Reference Policy'), 'page still listed after delete');
  });
  await context.close();
  await removeVaults(/^QA Locked Check$/);
}

// ---------------------------------------------------------------- two people on one note
if (want('conflict')) {
  await removeVaults(/^QA Conflict Check$/);
  const vault = (await api('/vaults', { method: 'POST', body: { name: 'QA Conflict Check', mode: 'open' } })).data.vault;
  const pageId = crypto.randomUUID();
  await api(`/vaults/${vault.id}/import`, { method: 'POST', body: { pages: [{ id: pageId, title: 'Shared Note', content: '# Shared Note\n\nOriginal line.' }], links: [] } });
  await api(`/vaults/${vault.id}/shares`, { method: 'POST', body: { principal_id: 'qa.second.editor@test.com', email: 'qa.second.editor@test.com', role: 'editor' } });
  const a = await open(browser);
  const b = await open(browser, { user: 'qa.second.editor@test.com' });
  await switchVault(a.page, 'QA Conflict Check');
  await switchVault(b.page, 'QA Conflict Check');
  await openNote(a.page, 'Shared Note');
  await openNote(b.page, 'Shared Note');
  await check('two editors: the second save does not silently overwrite the first', async () => {
    await typeAtEnd(a.page, ' FROM-PERSON-A');
    await waitSaved(a.page);
    await typeAtEnd(b.page, ' FROM-PERSON-B');
    await b.page.waitForTimeout(5000);
    const stateB = (await b.page.locator('.markdown-editor__save-state').textContent()).trim();
    const noticeB = await describeDialog(b.page);
    const saved = (await api(`/pages/${pageId}?vaultId=${vault.id}`)).data.page.content;
    console.log('   person B status:', JSON.stringify(stateB), '| notice:', noticeB ? noticeB.text.slice(0, 160) : 'none');
    console.log('   server text:', JSON.stringify(saved));
    const hasA = saved.includes('FROM-PERSON-A');
    const hasB = saved.includes('FROM-PERSON-B');
    expect(hasA || !hasB, "person A's saved text was replaced by person B's without warning");
    if (hasA && hasB) return 'both edits kept';
    expect(/failed|conflict|changed|reload|Unsaved/i.test(stateB + (noticeB?.text || '')), 'person B was refused but is not told');
    return "person B's save was refused and they are told";
  });
  await a.context.close();
  await b.context.close();
  await removeVaults(/^QA Conflict Check$/);
}

// ---------------------------------------------------------------- a vault whose key cannot be unwrapped
if (want('unreadable')) {
  psql("DELETE FROM vaults WHERE name = 'QA Unreadable Check'");
  const vaultId = crypto.randomUUID();
  psql(`INSERT INTO vaults (id, name, mode, owner_id, data_key_id, export_policy) VALUES ('${vaultId}', 'QA Unreadable Check', 'open', 'mubashir.ali@camp1.tkxel.com', 'bm90LWEtcmVhbC13cmFwcGVkLWtleS1mb3ItcWE=', 'allowed_for_owner')`);
  const { context, page } = await open(browser);
  await switchVault(page, 'QA Unreadable Check');
  await check('a vault with an unusable key says it cannot be edited here', async () => {
    await page.locator('.notes-sidebar__controls').getByRole('button', { name: 'New Note' }).click();
    await page.waitForTimeout(1500);
    await typeAtEnd(page, ' text that cannot be saved');
    await page.waitForTimeout(5000);
    const notice = await describeDialog(page);
    const state = (await page.locator('.markdown-editor__save-state').textContent()).trim();
    console.log('   status:', JSON.stringify(state), '| notice:', notice ? notice.text.slice(0, 200) : 'none');
    expect(notice && /cannot be edited here|encryption key/i.test(notice.text), 'no explanation shown');
    await page.screenshot({ path: path.join(shots, 'unreadable-vault.png') });
  });
  await context.close();
  psql(`DELETE FROM vaults WHERE id = '${vaultId}'`);
}

// ---------------------------------------------------------------- phone-sized screen
if (want('mobile')) {
  const { context, page } = await open(browser, { viewport: { width: 390, height: 844 } });
  await switchVault(page, 'Atlas Programme Hub').catch(() => {});
  await check('phone layout: no sideways scrolling on notes, graph and activity', async () => {
    const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const seen = [];
    for (const label of ['Notes', 'Graph', 'Activity']) {
      const button = page.locator('nav button, .app-view-tab, .app-mobile-nav button', { hasText: label }).last();
      if (await button.count()) { await button.click().catch(() => {}); await page.waitForTimeout(1500); }
      const extra = await overflow();
      seen.push(`${label}:${extra}`);
      await page.screenshot({ path: path.join(shots, `mobile-${label.toLowerCase()}.png`) });
      expect(extra <= 1, `${label} is ${extra}px wider than the screen`);
    }
    return seen.join(' ');
  });
  await context.close();
}

// ---------------------------------------------------------------- the graph at the size the spec names
if (want('graph')) {
  await removeVaults(/^QA Graph 2000$/);
  const vault = (await api('/vaults', { method: 'POST', body: { name: 'QA Graph 2000', mode: 'open' } })).data.vault;
  const N = 2000;
  const titles = Array.from({ length: N }, (_, i) => `Node ${String(i).padStart(4, '0')}`);
  const pages = titles.map((title, i) => ({ id: crypto.randomUUID(), title, type: 'note', tags: [`group${i % 8}`], content: `# ${title}\n\nSee [[${titles[(i * 7 + 1) % N]}]] and [[${titles[Math.floor(i / 10) * 10]}]].` }));
  const started = Date.now();
  for (let i = 0; i < N; i += 100) {
    const res = await api(`/vaults/${vault.id}/import`, { method: 'POST', body: { pages: pages.slice(i, i + 100), links: [] } });
    if (res.status !== 200) { console.log('   import batch failed:', res.status, JSON.stringify(res.data).slice(0, 120)); break; }
  }
  console.log(`   imported ${N} notes in ${Math.round((Date.now() - started) / 1000)}s`);
  const { context, page } = await open(browser);
  await check('graph with 2,000 notes: everything is drawn and the page stays responsive', async () => {
    const t0 = Date.now();
    await switchVault(page, 'QA Graph 2000');
    await page.waitForFunction(() => /2000/.test(document.querySelector('.notes-sidebar__list')?.textContent || ''), null, { timeout: 60000 });
    const loadSeconds = ((Date.now() - t0) / 1000).toFixed(1);
    await page.evaluate(() => {
      window.__long = [];
      new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
    });
    const g0 = Date.now();
    await page.locator('.app-view-tab', { hasText: 'Graph' }).first().click();
    await page.waitForFunction(() => /2000 of 2000/.test(document.querySelector('.graph-toolbar__count')?.textContent || ''), null, { timeout: 60000 });
    const shownSeconds = ((Date.now() - g0) / 1000).toFixed(1);
    await page.waitForTimeout(9000);
    const long = await page.evaluate(() => window.__long);
    const label = await page.locator('[aria-label^="Knowledge graph"]').getAttribute('aria-label');
    await page.screenshot({ path: path.join(shots, 'graph-2000.png') });
    const worst = long.length ? Math.max(...long) : 0;
    console.log(`   vault opened in ${loadSeconds}s, graph shown in ${shownSeconds}s, long tasks: ${long.length}, longest ${worst}ms, ${label}`);
    expect(/2000 notes/.test(label || ''), `graph reports: ${label}`);
    expect(Number(shownSeconds) <= 3, `graph took ${shownSeconds}s to appear (target: 3s)`);
    expect(worst < 1500, `the page froze for ${worst}ms while drawing`);
    return `${shownSeconds}s, longest pause ${worst}ms`;
  });
  await context.close();
  await removeVaults(/^QA Graph 2000$/);
}

await browser.close();
process.exitCode = summary() ? 1 : 0;

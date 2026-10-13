// Emergency access (break-glass) through the web app: an administrator who does not own a locked vault
// asks for access with a reason, the Owner approves, the administrator then sees the vault, the Owner revokes.
// A second API instance is started for this check with an administrator configured; the browser's API
// calls are pointed at it.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, check, expect, workspaceMenu, describeDialog, summary, shots, APP, API } from './lib.mjs';
import fs from 'node:fs';
fs.mkdirSync(shots, { recursive: true });

const REPO = path.resolve(import.meta.dirname, '../..');
const PORT = 3013;
const QA_API = `http://localhost:${PORT}/api`;
const ADMIN = 'qa.breakglass.admin@test.com';
const OWNER = 'qa.breakglass.owner@test.com';

const server = spawn(process.execPath, ['apps/api-server/dist/server.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development', ENABLE_DEV_AUTH_BYPASS: 'true', ALLOW_ALL_DEV_CORS: 'true', RUN_MIGRATIONS_ON_START: 'false', VAULT_OWNER_EMAIL: ADMIN },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const call = async (pathname, user, { method = 'GET', body } = {}) => {
  const res = await fetch(QA_API + pathname, { method, headers: { Authorization: `Bearer test_user:${user}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${QA_API}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

let vault;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const session = async (user) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Only calls to the normal API are sent to the instance started above
  const apiPort = new URL(API).port;
  await context.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.port !== apiPort) return route.continue();
    url.port = String(PORT);
    return route.continue({ url: url.toString() });
  });
  const page = await context.newPage();
  await page.goto(APP);
  await page.waitForTimeout(1500);
  await page.locator('[aria-label="Local test user email"]').fill(user);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForTimeout(3000);
  return { context, page };
};
const vaultNames = async (page) => {
  await page.locator('.app-vault-switcher__trigger').click();
  await page.waitForTimeout(500);
  const names = await page.locator('.app-vault-menu__item-name').allTextContents();
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 700, y: 500 } });
  return names.map((n) => n.trim());
};
const openVault = async (page, name) => {
  await page.locator('.app-vault-switcher__trigger').click();
  await page.waitForTimeout(500);
  await page.locator('.app-vault-menu__item-btn', { hasText: name }).first().click();
  await page.waitForTimeout(2500);
};

try {
  const stale = (await call('/vaults', OWNER)).data.vaults || [];
  for (const v of stale.filter((x) => x.name === 'QA Break Glass')) await call(`/vaults/${v.id}`, OWNER, { method: 'DELETE' });
  vault = (await call('/vaults', OWNER, { method: 'POST', body: { name: 'QA Break Glass', mode: 'locked' } })).data.vault;
  console.log('locked vault owned by', vault.owner_id);

  const admin = await session(ADMIN);
  const owner = await session(OWNER);

  await check('an administrator has no standing access to a locked vault they do not own', async () => {
    const names = await vaultNames(admin.page);
    expect(!names.includes('QA Break Glass'), 'the locked vault is listed for the administrator before any approval');
    const direct = await call(`/vaults/${vault.id}/skills`, ADMIN);
    expect(direct.status === 403 || direct.status === 404, `skills route answered ${direct.status}`);
    return `${names.length} vaults listed, direct call ${direct.status}`;
  });

  await check('the administrator asks for emergency access from the web app', async () => {
    await workspaceMenu(admin.page, 'Emergency access');
    const dialog = admin.page.locator('[role=dialog]');
    await admin.page.waitForTimeout(800);
    expect((await dialog.textContent()).includes('QA Break Glass'), 'the locked vault is not offered');
    const row = dialog.locator('div[style*="border"]', { hasText: 'QA Break Glass' }).last();
    await row.getByRole('button', { name: 'Request access' }).click();
    const reason = dialog.locator('textarea[aria-label="Reason for emergency access to QA Break Glass"]');
    await reason.fill('too short');
    expect(await dialog.getByRole('button', { name: 'Send request' }).isDisabled(), 'a short reason can be sent');
    await reason.fill('Production incident 5512: skill output corrupted, need to inspect.');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await admin.page.waitForTimeout(2000);
    const text = await dialog.textContent();
    await admin.page.screenshot({ path: path.join(shots, 'emergency-access-admin.png') });
    expect(/Request sent/.test(text) && /Waiting for a second person/.test(text), `dialog says: ${text.slice(0, 200)}`);
    const requests = (await call(`/vaults/${vault.id}/break-glass`, OWNER)).data.requests || [];
    expect(requests.length === 1 && requests[0].status === 'pending', `server holds ${requests.length} request(s)`);
    const selfApprove = await call(`/break-glass/${requests[0].id}/approve`, ADMIN, { method: 'POST', body: {} });
    expect(selfApprove.status >= 400, 'the requester could approve their own request');
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    return `pending on the server, self-approval refused (${selfApprove.status})`;
  });

  await check('someone who is not an administrator is not offered emergency access', async () => {
    const outsider = await call('/break-glass/vaults', 'qa.nobody@test.com');
    expect(outsider.status === 200 && Array.isArray(outsider.data.vaults) && outsider.data.vaults.length === 0, `answered ${outsider.status} ${JSON.stringify(outsider.data).slice(0, 80)}`);
    await owner.page.locator('[aria-label="Workspace actions"]').click();
    await owner.page.waitForTimeout(400);
    const items = await owner.page.locator('.ui-menu__item').allTextContents();
    await owner.page.reload();
    await owner.page.waitForTimeout(3000);
    expect(!items.some((item) => /emergency/i.test(item)), 'the vault Owner (not an administrator) sees the menu item');
  });

  await check("the Owner sees the request in vault settings and approves it", async () => {
    if ((await owner.page.locator('.app-vault-switcher__name').textContent()).trim() !== 'QA Break Glass') await openVault(owner.page, 'QA Break Glass');
    await workspaceMenu(owner.page, 'Vault settings');
    await owner.page.waitForTimeout(1200);
    const dialog = await describeDialog(owner.page);
    expect(/Production incident 5512/.test(dialog.text) || /incident 5512/.test(await owner.page.locator('[role=dialog]').textContent()), 'the request is not shown to the Owner');
    await owner.page.screenshot({ path: path.join(shots, 'break-glass-owner.png') });
    await owner.page.locator('[role=dialog]').getByRole('button', { name: 'Approve' }).click();
    await owner.page.waitForTimeout(2000);
    const after = await owner.page.locator('[role=dialog]').textContent();
    expect(/approved|Revoke now|active/i.test(after), 'no sign of approval in the dialog');
  });

  await check('after approval the administrator sees the vault, and loses it again on revoke', async () => {
    await admin.page.reload();
    await admin.page.waitForTimeout(3500);
    let names = await vaultNames(admin.page);
    expect(names.includes('QA Break Glass'), `vault not listed after approval: ${JSON.stringify(names)}`);
    await owner.page.locator('[role=dialog]').getByRole('button', { name: 'Revoke now' }).click();
    await owner.page.waitForTimeout(2000);
    await admin.page.reload();
    await admin.page.waitForTimeout(3500);
    names = await vaultNames(admin.page);
    expect(!names.includes('QA Break Glass'), 'vault still listed after the grant was revoked');
    const audit = await call(`/vaults/${vault.id}/audits`, OWNER);
    const actions = (audit.data.auditEvents || []).map?.((e) => e.action) || [];
    console.log('   audit actions:', JSON.stringify([...new Set(actions)]));
    expect(actions.some((a) => /break_glass/.test(a)), 'no emergency-access events in the audit trail');
  });

  await admin.context.close();
  await owner.context.close();
} finally {
  if (vault) await call(`/vaults/${vault.id}`, OWNER, { method: 'DELETE' });
  await browser.close();
  server.kill();
}
process.exitCode = summary() ? 1 : 0;

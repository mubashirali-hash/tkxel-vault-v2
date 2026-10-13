// Shared helpers for browser checks of the local dev app.
// They need the web app and API running in development mode with the local sign-in enabled
// (VITE_ENABLE_DEV_AUTH_BYPASS=true, ENABLE_DEV_AUTH_BYPASS=true); override the addresses with APP_URL and API_URL.
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
// Playwright is not a dependency of this repository. Point PLAYWRIGHT_MODULE_DIR at a folder whose
// node_modules holds playwright-core (any recent version; the checks drive the installed Chrome).
const require = createRequire(process.env.PLAYWRIGHT_MODULE_DIR ? path.join(process.env.PLAYWRIGHT_MODULE_DIR, 'x.js') : import.meta.url);
export const { chromium } = require('playwright-core');

export const APP = process.env.APP_URL || 'http://localhost:3000';
export const API = process.env.API_URL || 'http://localhost:3012/api';
export const ADMIN = 'dev_admin_token';
export const shots = process.env.BROWSER_CHECK_SHOTS || path.join(os.tmpdir(), 'tkxel-browser-checks');

export async function api(pathname, { token = ADMIN, method = 'GET', body } = {}) {
  const res = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

export const results = [];
export async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${detail ? `  [${detail}]` : ''}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}  -> ${String(error.message).split('\n')[0]}`);
  }
}
export function expect(condition, message) { if (!condition) throw new Error(message); }

export async function open(browser, { user, viewport = { width: 1440, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('   page error:', e.message.split('\n')[0]));
  await page.goto(APP);
  await page.waitForTimeout(1500);
  if (user) {
    await page.locator('[aria-label="Local test user email"]').fill(user);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  } else {
    await page.getByRole('button', { name: /Continue as Workspace Administrator/ }).click();
  }
  await page.waitForTimeout(2500);
  return { context, page };
}
export async function switchVault(page, name) {
  const current = await page.locator('.app-vault-switcher__name').textContent().catch(() => '');
  if ((current || '').trim() === name) return;
  await page.locator('.app-vault-switcher__trigger').click();
  await page.waitForTimeout(400);
  await page.locator('.app-vault-menu__item-btn', { hasText: name }).first().click();
  await page.waitForTimeout(2500);
}
export async function openNote(page, title) {
  await page.locator('.notes-sidebar__list').getByText(title, { exact: true }).first().click();
  await page.waitForTimeout(1500);
}
export async function noteMenu(page, item) {
  await page.locator('[aria-label="More note actions"]').click();
  await page.waitForTimeout(300);
  await page.locator('.ui-menu__item', { hasText: item }).first().click();
  await page.waitForTimeout(900);
}
export async function workspaceMenu(page, item) {
  await page.locator('[aria-label="Workspace actions"]').click();
  await page.waitForTimeout(300);
  await page.locator('.ui-menu__item', { hasText: item }).first().click();
  await page.waitForTimeout(900);
}
export async function describeDialog(page) {
  return page.evaluate(() => {
    const d = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].pop();
    if (!d) return null;
    return {
      text: d.textContent.replace(/\s+/g, ' ').slice(0, 500),
      controls: [...d.querySelectorAll('button,input,select,textarea')].map((e) => `${e.tagName.toLowerCase()}:${(e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.textContent || e.type || '').trim().slice(0, 40)}`),
    };
  });
}
export async function typeAtEnd(page, text) {
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text, { delay: 15 });
}
export async function waitSaved(page) {
  await page.waitForFunction(() => /Draft saved/.test(document.querySelector('.markdown-editor__save-state')?.textContent || ''), null, { timeout: 12000 });
}
export function summary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  return failed.length;
}

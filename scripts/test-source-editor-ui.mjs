// Isolated headless fixture: no user database, native process, real provider or
// live app. Browser tools are intentionally not used by this delegated task.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const { chromium } = await import(process.env.FRONDOSE_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(join(tmpdir(), 'frondose-editor-ui-'));
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, cacheDir: join(directory, 'vite-cache'), plugins: [react()], server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.FRONDOSE_BROWSER_CHANNEL ? { channel: process.env.FRONDOSE_BROWSER_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }), errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', route => { requests.push({ method: route.request().method(), url: route.request().url() }); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: { connected: false, bindingVersion: 'root-v1', version: 'git-v1', threads: [], next_offset: null } }) }); });
try {
  await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/source-editor.html`);
  const editor = page.getByRole('textbox', { name: 'Source of src/fixture.ts', exact: true });
  await editor.waitFor(); await page.waitForFunction(() => document.querySelector('.cm-line span'));
  assert.ok(await page.locator('.cm-lineNumbers').count());
  assert.equal(await page.locator('.cm-line span').evaluateAll(nodes => nodes.some(node => getComputedStyle(node).color !== 'rgb(238, 238, 238)')), true, 'parsed syntax is coloured');
  await editor.click();
  assert.equal(await page.locator('.cm-editor').evaluate(element => getComputedStyle(element).outlineStyle), 'none');
  await page.locator('.cm-scroller').evaluate(element => { element.scrollTop = 16000; });
  await page.waitForTimeout(100); const scroll = await page.locator('.cm-scroller').evaluate(element => element.scrollTop);
  for (let count = 0; count < 5; count++) { await page.evaluate(() => window.fixtureEditor.rerender()); await page.waitForTimeout(30); }
  assert.equal(await page.locator('.cm-scroller').evaluate(element => element.scrollTop), scroll, 'scroll remains stable after parent rerenders');
  assert.equal(await page.evaluate(() => window.fixtureEditor.drafts.get('fixture-file').scrollTop), scroll);
  await page.evaluate(() => window.fixtureEditor.editor.current.jumpToLine(1));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press('Home'); await page.keyboard.insertText('// 中😀\n');
  await page.waitForFunction(() => window.fixtureEditor.drafts.get('fixture-file').content.startsWith('// 中😀'));
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(() => window.fixtureEditor.drafts.get('fixture-file').content.startsWith('export async'));
  await page.evaluate(() => { localStorage.setItem('rumbo.codeAppearance.v1', JSON.stringify({ fontSize: 18, lineNumbers: false, syntax: false, wrap: true })); window.dispatchEvent(new Event('rumbo-code-appearance')); });
  await page.waitForFunction(() => !document.querySelector('.cm-lineNumbers'));
  assert.equal(await page.locator('.cm-editor').evaluate(element => getComputedStyle(element).fontSize), '18px');
  await page.evaluate(() => { localStorage.removeItem('rumbo.codeAppearance.v1'); window.dispatchEvent(new Event('rumbo-code-appearance')); });
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  assert.equal(await page.getByRole('menuitemradio', { name: /Blame/ }).isDisabled(), true);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.getByRole('region', { name: 'Recent observed file changes' }).waitFor();
  assert.match(await page.getByRole('region', { name: 'Recent observed file changes' }).innerText(), /Tracking covers only/);
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await editor.waitFor(); await page.evaluate(() => window.fixtureEditor.setWidth(300)); await page.waitForTimeout(100);
  assert.equal(await page.locator('#root').evaluate(element => element.scrollWidth > element.clientWidth), false, '300px split pane does not overflow');
  await page.evaluate(() => window.fixtureEditor.setWidth(900));
  await page.evaluate(() => window.fixtureEditor.editor.current.jumpToLine(1));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
  await page.getByRole('button', { name: 'Drag selected lines to AI CLI' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Drag selected lines to AI CLI' }).dragTo(page.locator('#context-target'));
  await page.waitForFunction(() => window.droppedContext?.kind === 'selection');
  assert.equal(await page.evaluate(() => window.droppedContext.path), 'src/fixture.ts');
  assert.equal(await page.evaluate(() => window.droppedContext.startLine), 1);
  assert.equal(requests.every(request => request.method === 'GET'), true, 'selection and editor operations do not write or call providers');
  assert.deepEqual(errors, []);
  console.log('Source editor UI passed: syntax, line numbers, focus, 3,005-line scroll/rerender stability, Unicode edit/undo, shared settings, Recent/disabled Blame keyboard menu, 300px pane, real scoped selection drag.');
} catch (error) {
  console.error('Editor fixture diagnostic:', await page.evaluate(() => ({ selection: window.fixtureEditor?.drafts.get('fixture-file') && { start: window.fixtureEditor.drafts.get('fixture-file').selectionStart, end: window.fixtureEditor.drafts.get('fixture-file').selectionEnd, scroll: window.fixtureEditor.drafts.get('fixture-file').scrollTop }, active: document.activeElement?.outerHTML.slice(0, 200), toolbar: document.querySelector('.directory-selection-tools')?.outerHTML, browserSelection: getSelection()?.toString().slice(0, 200), errors: document.querySelector('vite-error-overlay')?.outerHTML.slice(0, 300) })));
  throw error;
} finally { await browser.close(); await server.close(); await rm(directory, { recursive: true, force: true }); }

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createLocalApi } from '../server/local-api.mjs';

const { chromium } = await import(process.env.TALVORI_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(join(tmpdir(), 'rumbo-commands-ui-'));
const projectRoot = join(directory, 'project');
await mkdir(projectRoot);
await writeFile(join(projectRoot, 'README.md'), '# Isolated command QA\n');
const prohibited = () => { throw new Error('AI and external connections are prohibited during command QA'); };
const api = createLocalApi({ dataDir: join(directory, 'data'), integrationOptions: { env: {}, execute: prohibited, spawnProcess: prohibited, fetchImpl: prohibited } });
const server = await createServer({
  root: new URL('../', import.meta.url).pathname,
  cacheDir: join(directory, 'vite-cache'),
  configFile: false,
  plugins: [react(), { name: 'command-qa-api', configureServer(vite) { vite.middlewares.use(api.middleware); } }],
  server: { host: '127.0.0.1', port: 4195, strictPort: true },
});
await server.listen();
const base = 'http://127.0.0.1:4195';
const post = async (path, body) => {
  const response = await fetch(`${base}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json();
  assert.ok(response.ok, JSON.stringify(payload));
  return payload;
};
const workspace = (await post('/workspaces', { name: 'Command QA' })).workspace;
const project = (await post('/projects', { workspace_id: workspace.id, name: 'Command surface', local_path: projectRoot })).project;
const chat = (await post('/chats', { workspace_id: workspace.id, project_id: project.id, title: 'Slash commands' })).chat;
await post('/agents', { workspace_id: workspace.id, name: 'Reviewer', provider: 'codex' });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(`${base}/#/chats/${chat.id}?project=${project.id}`);
  const composer = page.getByRole('textbox', { name: 'Message' });
  await composer.waitFor();
  await composer.fill('/');
  await page.getByRole('listbox', { name: 'Slash commands' }).waitFor();
  assert.ok(await page.getByRole('option').count() > 4);
  await composer.fill('/help');
  await composer.press('Enter');
  await page.getByRole('dialog').getByRole('heading', { name: 'Talvori commands', exact: true }).waitFor();
  await page.getByRole('dialog').getByPlaceholder('Search all commands…').fill('git status');
  await page.getByRole('dialog').getByText('/git status', { exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  await composer.fill('/route new');
  await composer.press('Enter');
  await page.getByRole('dialog').getByRole('heading', { name: 'New route', exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  await page.goto(`${base}/#/workbench/${project.id}`);
  await page.getByRole('tab', { name: /Terminals/ }).click();
  const launcher = page.getByRole('textbox', { name: 'Talvori terminal command' });
  await launcher.fill('/git status');
  await launcher.press('Enter');
  const review = page.getByRole('dialog');
  await review.getByRole('heading', { name: 'Review command before running', exact: true }).waitFor();
  assert.equal(await review.getByRole('button', { name: 'Run command', exact: true }).isDisabled(), true);
  assert.match(await review.getByRole('textbox', { name: /Command \(optional/ }).inputValue(), /^git status/);
  assert.equal(api.snapshot().runs.length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: chat command search/actions and Workbench review-before-run launcher; no provider or agent calls.');
} finally {
  await browser.close();
  await server.close();
  api.close();
  await rm(directory, { recursive: true, force: true });
}

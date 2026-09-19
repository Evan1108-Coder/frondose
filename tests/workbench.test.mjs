import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createWorkbenchService } from '../server/workbench-service.mjs';

async function fixture(callback, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-workbench-test-'));
  const root = join(directory, 'project'), privateDir = join(directory, 'storage');
  await mkdir(root); await mkdir(privateDir);
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE workspaces (id TEXT PRIMARY KEY,archived_at TEXT); CREATE TABLE projects (id TEXT PRIMARY KEY,workspace_id TEXT,local_path TEXT,archived_at TEXT); INSERT INTO workspaces VALUES ('ws',NULL),('other',NULL);`);
  db.prepare('INSERT INTO projects VALUES (?,?,?,NULL)').run('project', 'ws', root);
  const service = createWorkbenchService({ db, dataDir: privateDir, ...options });
  const project = service.scope('ws', 'project');
  const call = (action = '', method = 'GET', body = {}, query = {}) => service.dispatch(project, action, method, body, new URL(`http://127.0.0.1/api/workbench?${new URLSearchParams(query)}`));
  try { await callback({ directory, root, privateDir, db, service, project, call }); }
  finally { service.close(); db.close(); await rm(directory, { recursive: true, force: true }); }
}

test('Workbench file APIs stay in explicit project scope and hide credentials', async () => fixture(async ({ root, directory, service, call }) => {
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'hello.txt'), 'Hello from project');
  await writeFile(join(root, '.env'), 'TOKEN=secret');
  await writeFile(join(directory, 'outside.txt'), 'Private outside content');
  await symlink(join(directory, 'outside.txt'), join(root, 'outside-link'));
  await symlink(join(root, '.env'), join(root, 'hidden-link'));
  assert.throws(() => service.scope('other', 'project'), /active project/);
  const tree = await call('tree');
  assert.ok(tree.entries.some(item => item.name === 'src'));
  assert.ok(!tree.entries.some(item => item.name === '.env'));
  const file = await call('file', 'GET', {}, { path: 'src/hello.txt' });
  assert.equal(file.content, 'Hello from project');
  for (const path of ['../outside.txt', '/etc/passwd', '.env', 'outside-link', 'hidden-link']) await assert.rejects(call('file', 'GET', {}, { path }), /outside|private/i);
  const found = await call('search', 'GET', {}, { q: 'hello' });
  assert.equal(found.entries[0].path, 'src/hello.txt');
}));

test('Research workbench works without a folder and never falls back to home', async () => fixture(async ({ db, service }) => {
  db.prepare('UPDATE projects SET local_path=NULL WHERE id=?').run('project');
  const project = service.scope('ws', 'project');
  const summary = await service.summary(project);
  assert.equal(summary.root, null);
  assert.deepEqual(summary.terminals, []);
  await assert.rejects(service.dispatch(project, 'tree', 'GET', {}, new URL('http://127.0.0.1')), /Link a project folder/);
}));

test('Workbench preferences, commands and package script discovery are persisted without executing', async () => fixture(async ({ root, call }) => {
  const settings = await call('settings', 'PATCH', { showHiddenFiles: true, wrapFiles: true, maxTerminals: 2, terminalFontSize: 18 });
  assert.equal(settings.settings.wrapFiles, true);
  await assert.rejects(call('settings', 'PATCH', { maxTerminals: 99 }), /between/);
  const command = await call('commands', 'POST', { name: 'Build', command: 'npm run build' });
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'echo built', 'bad;command': 'bad' } }));
  const scripts = await call('scripts');
  assert.deepEqual(scripts.scripts, [{ name: 'build', script: 'echo built', command: 'npm run build' }]);
  assert.equal((await call()).commands[0].id, command.id);
  assert.equal((await call()).terminals.length, 0);
  await call(`commands/${command.id}`, 'DELETE');
  assert.equal((await call()).commands.length, 0);
}));

test('Git inspection, private diff protection and explicit worktree creation', async () => fixture(async ({ root, call, service, project, db }) => {
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  await writeFile(join(root, 'hello.txt'), 'Before\n');
  execFileSync('git', ['add', 'hello.txt'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Workbench test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Initial'], { cwd: root });
  await writeFile(join(root, 'hello.txt'), 'After\n');
  await writeFile(join(root, '.env'), 'secret');
  const state = await call('git');
  assert.equal(state.branch, 'main');
  assert.deepEqual(state.files, [{ path: 'hello.txt', status: ' M' }]);
  const diff = await call('diff', 'GET', {}, { path: 'hello.txt' });
  assert.match(diff.content, /\+After/);
  await assert.rejects(call('diff', 'GET', {}, { path: '.env' }), /private/);
  await assert.rejects(call('worktrees', 'POST', { branch: 'rumbo/test' }), /Confirm/);
  await assert.rejects(call('worktrees', 'POST', { branch: 'rumbo/test;bad', confirm_create: true }), /branch/);
  const environment = await call('worktrees', 'POST', { branch: 'rumbo/test', name: 'Isolated work', confirm_create: true });
  const file = await call('file', 'GET', {}, { environment_id: environment.id, path: 'hello.txt' });
  assert.equal(file.content, 'Before\n');
  assert.equal((await call()).environments.length, 1);
  await mkdir(join(root, 'nested'));
  db.prepare('UPDATE projects SET local_path=? WHERE id=?').run(join(root, 'nested'), 'project');
  const nested = service.scope('ws', 'project');
  const nestedGit = await service.dispatch(nested, 'git', 'GET', {}, new URL('http://127.0.0.1'));
  assert.equal(nestedGit.repository, false);
}));

test('Only explicitly confirmed terminals start; history, resizing and scoped stop work', async () => {
  const instances = [];
  const factory = { spawn(shell, args, options) {
    const terminal = { shell, args, options, onData(callback) { this.data = callback; }, onExit(callback) { this.exit = callback; }, write(value) { this.lastInput = value; this.data(`echo:${value}`); }, resize(cols, rows) { this.size = [cols, rows]; }, kill() { this.exit({ exitCode: 0 }); } };
    instances.push(terminal); return terminal;
  } };
  await fixture(async ({ call, service, db, project }) => {
    await assert.rejects(call('terminals', 'POST', { name: 'Test' }), /Confirm/);
    const terminal = await call('terminals', 'POST', { name: 'Test', confirm_execution: true });
    assert.equal(instances.length, 1);
    assert.equal(instances[0].options.env.OPENAI_API_KEY, undefined);
    await call(`terminals/${terminal.id}/input`, 'POST', { data: 'hello\r' });
    const output = await call(`terminals/${terminal.id}`);
    assert.equal(output.output, 'echo:hello\r');
    assert.equal((await call(`terminals/${terminal.id}`, 'GET', {}, { cursor: output.cursor })).output, '');
    await call(`terminals/${terminal.id}/resize`, 'POST', { cols: 90, rows: 20 });
    assert.deepEqual(instances[0].size, [90, 20]);
    await call(`terminals/${terminal.id}`, 'PATCH', { name: 'Renamed' });
    assert.equal((await call()).terminals[0].name, 'Renamed');
    db.prepare('INSERT INTO projects VALUES (?,?,?,NULL)').run('other-project', 'ws', project.local_path);
    await assert.rejects(service.dispatch(service.scope('ws', 'other-project'), `terminals/${terminal.id}`, 'GET', {}, new URL('http://127.0.0.1')), /does not belong/);
    await call(`terminals/${terminal.id}/stop`, 'POST');
    assert.equal((await call(`terminals/${terminal.id}`)).status, 'stopped');
    await assert.rejects(call(`terminals/${terminal.id}/input`, 'POST', { data: 'no' }), /has ended/);
  }, { ptyFactory: factory });
});

test('Terminal launch reservations enforce limits even with parallel requests', async () => {
  const factory = { spawn() { return { onData() {}, onExit() {}, kill() {}, write() {}, resize() {} }; } };
  await fixture(async ({ call }) => {
    await call('settings', 'PATCH', { maxTerminals: 1 });
    const results = await Promise.allSettled([call('terminals', 'POST', { confirm_execution: true }), call('terminals', 'POST', { confirm_execution: true })]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter(item => item.status === 'rejected').length, 1);
  }, { ptyFactory: factory });
});

test('Preview verifies only an explicit local unprivileged port', async () => fixture(async ({ call }) => {
  const server = createServer((req, res) => res.end('Test preview'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const preview = await call('preview', 'POST', { port });
    assert.equal(preview.url, `http://127.0.0.1:${port}/`);
    await assert.rejects(call('preview', 'POST', { port: 22 }), /between/);
  } finally { await new Promise(resolve => server.close(resolve)); }
}));

test('An actual PTY command runs only in the fixture and output survives service reads', { skip: process.platform === 'win32' }, async () => fixture(async ({ call, root }) => {
  const terminal = await call('terminals', 'POST', { name: 'Real fixture', command: 'printf real-pty-check; pwd', confirm_execution: true });
  let output;
  for (let i = 0; i < 100; i++) {
    output = await call(`terminals/${terminal.id}`);
    if (output.status === 'exited') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(output.status, 'exited');
  assert.equal(output.exit_code, 0);
  assert.match(output.output, /real-pty-check/);
  assert.ok(output.output.includes(root.replace(/^\/var\//, '/private/var/')) || output.output.includes(root));
  assert.match((await call(`terminals/${terminal.id}`)).output, /real-pty-check/);
}));

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createWorkbenchService } from '../server/workbench-service.mjs';

async function fixture(callback, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-home-terminal-test-'));
  const home = join(directory, 'owner-home'), root = join(directory, 'project'), dataDir = join(directory, 'private');
  await Promise.all([home, root, dataDir].map(path => mkdir(path)));
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id),local_path TEXT,archived_at TEXT);
    INSERT INTO workspaces VALUES ('ws',NULL),('other',NULL);`);
  const spawned = [];
  const ptyFactory = { spawn(command, args, spawnOptions) {
    const exits = new Set();
    const terminal = { command, args, options: spawnOptions, onData(callback) { this.data = callback; }, onExit(callback) { exits.add(callback); }, exit(code = 0) { for (const callback of exits) callback({ exitCode: code }); }, resize() {}, write() {}, kill() { this.exit(); } };
    spawned.push(terminal); return terminal;
  } };
  const service = createWorkbenchService({ db, dataDir, ptyFactory, terminalHome: () => home, terminalPlatform: 'linux', terminalEnv: { HOME: home, PATH: '/bin' }, terminalResolveExecutable: async command => ({ path: `/bin/${command}` }), ...options });
  const call = async (action = '', method = 'GET', body = {}, query = {}, actor = { id: 'local-owner' }) => {
    const url = new URL(`http://127.0.0.1/api/workbench?${new URLSearchParams({ workspace_id: 'ws', host_scope: 'workspace', ...query })}`);
    let response;
    assert.equal(await service.handle({ req: { method }, path: `/workbench${action ? `/${action}` : ''}`, url, res: {}, readBody: async () => body, send: (_res, status, payload) => { response = { status, payload }; }, actor }), true);
    assert.equal(response.status, 200); return response.payload.result;
  };
  try { await callback({ service, call, spawned, home, root, db }); }
  finally { service.close(); db.close(); await rm(directory, { recursive: true, force: true }); }
}

test('zero-project workspace discovery/restore never launches or silently binds home', async () => fixture(async ({ call, spawned, home, db }) => {
  const result = await call();
  assert.equal(result.root, null); assert.equal(result.terminalRoot, await realpath(home));
  assert.equal(result.project_id, null); assert.equal(result.host_scope, 'workspace');
  assert.deepEqual(result.terminals, []); assert.equal(spawned.length, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='directory_workspaces'").get().n, 0);
  const inventory = await call('terminal-providers'); assert.equal(inventory.providers.find(provider => provider.id === 'codex').installed, true);
  assert.equal(spawned.length, 0);
}));

test('explicit workspace shell/AI opening uses server home and keeps project rows untouched', async () => fixture(async ({ call, service, spawned, home, db }) => {
  const terminal = await call('terminals', 'POST', { confirm_execution: true, view_id: 'view-home' });
  assert.equal(terminal.project_id, null); assert.equal(terminal.host_scope, 'workspace');
  assert.equal(spawned[0].options.cwd, await realpath(home)); assert.equal(spawned[0].options.env.HOME, home);
  const cli = await call('terminals', 'POST', { confirm_execution: true, view_id: 'view-cli', provider_id: 'codex' });
  assert.deepEqual(spawned[1].args, []); assert.equal(spawned[1].options.cwd, await realpath(home));
  assert.equal((await call()).terminals.length, 2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM workbench_terminals').get().n, 0);
  assert.equal(service.activeSessionsFor('workspaces', 'ws').length, 2);
  assert.equal(service.activeSessionsFor('workspaces', 'other').length, 0);
  assert.equal(service.activeSessionsFor('projects', 'ws').length, 0);
  assert.equal((await call(`terminals/${cli.id}`)).id, cli.id);
}));

test('workspace host scope rejects other owners, project/agent authority and all file/Git routes', async () => fixture(async ({ call, spawned }) => {
  await assert.rejects(call('', 'GET', {}, {}, { id: 'not-local-owner' }), /only to the local owner/);
  for (const action of ['tree', 'file', 'git', 'changes', 'worktrees', 'checkpoint', 'preview', 'native-agent-preview']) await assert.rejects(call(action), /terminals and Quick Commands only/);
  for (const body of [{ project_id: 'project' }, { environment_id: 'environment' }, { agent_id: 'agent' }]) await assert.rejects(call('terminals', 'POST', { confirm_execution: true, ...body }), /cannot select/);
  for (const key of ['cwd', 'path', 'env', 'environment', 'root', 'local_path', 'executable', 'args']) await assert.rejects(call('terminals', 'POST', { confirm_execution: true, [key]: '/untrusted' }), /selected by the local server/);
  await assert.rejects(call('', 'GET', {}, { workspace_id: 'missing' }), /active workspace/);
  await assert.rejects(call('', 'GET', {}, { project_id: 'project' }), /cannot select/);
  assert.equal(spawned.length, 0);
}));

test('workspace Quick Commands are isolated by workspace and saving never runs text', async () => fixture(async ({ call, spawned }) => {
  const command = await call('commands', 'POST', { name: 'Inspect', command: 'git status --short' });
  assert.equal((await call()).commands.length, 1);
  assert.equal((await call('', 'GET', {}, { workspace_id: 'other' })).commands.length, 0);
  await assert.rejects(call(`commands/${command.id}`, 'PATCH', { name: 'Other', command: 'pwd' }, { workspace_id: 'other' }), /unavailable/);
  await call(`commands/${command.id}`, 'PATCH', { name: 'Location', command: 'pwd' });
  assert.equal((await call()).commands[0].command, 'pwd');
  await call(`commands/${command.id}`, 'DELETE'); assert.equal((await call()).commands.length, 0);
  assert.equal(spawned.length, 0);
}));

test('workspace-host owned stops still require fresh exact session review and preserve output', async () => fixture(async ({ call, spawned }) => {
  const terminal = await call('terminals', 'POST', { confirm_execution: true, view_id: 'owned-home' });
  spawned[0].data('retained home output');
  const status = await call('terminal-views/owned-home'); assert.equal(status.state, 'running'); assert.equal(status.project_id, null);
  await assert.rejects(call('terminal-views/owned-home/stop', 'POST', { confirmed: true, expected_session_ids: [], fingerprint: status.fingerprint }), /changed or ownership/);
  const stopped = await call('terminal-views/owned-home/stop', 'POST', { confirmed: true, expected_session_ids: [terminal.id], fingerprint: status.fingerprint });
  assert.equal(stopped.stopped, true); assert.equal(stopped.project_id, null);
  assert.equal((await call(`terminals/${terminal.id}`)).output, 'retained home output');
}));

test('bound workspace host launches in its validated project directory without rebinding home', async () => fixture(async ({ call, spawned, root, db }) => {
  db.prepare('INSERT INTO projects VALUES (?,?,?,NULL)').run('project', 'ws', await realpath(root));
  const info = await stat(root, { bigint: true });
  db.exec('CREATE TABLE directory_workspaces(workspace_id TEXT PRIMARY KEY,project_id TEXT,path TEXT,root_identity TEXT,version TEXT)');
  db.prepare('INSERT INTO directory_workspaces VALUES (?,?,?,?,?)').run('ws', 'project', await realpath(root), `${info.dev}:${info.ino}`, 'epoch-one');
  await call('terminals', 'POST', { confirm_execution: true });
  assert.equal(spawned[0].options.cwd, await realpath(root));
  db.prepare('UPDATE directory_workspaces SET root_identity=?').run('replaced');
  await assert.rejects(call('terminals', 'POST', { confirm_execution: true }), /directory changed/);
  assert.equal(spawned.length, 1);
  assert.equal(db.prepare('SELECT path FROM directory_workspaces').get().path, await realpath(root));
}));

test('folderless home fallback refuses filesystem root and never falls back from a stale binding', async () => fixture(async ({ call, spawned }) => {
  const summary = await call(); assert.equal(summary.terminalRoot, null); assert.match(summary.folderError, /No safe OS home/);
  await assert.rejects(call('terminals', 'POST', { confirm_execution: true }), /No safe OS home/);
  assert.equal(spawned.length, 0);
}, { terminalHome: () => '/' }));

test('workspace terminal starts reserve active work before async provider discovery and respect Git locks', async () => {
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; }), paused = new Promise(resolve => { release = resolve; });
  await fixture(async ({ call, service }) => {
    const pending = call('terminals', 'POST', { confirm_execution: true, provider_id: 'codex' });
    await ready;
    assert.equal(service.activeSessionsFor('workspaces', 'ws')[0].status, 'starting');
    release(); await pending;
  }, { terminalResolveExecutable: async command => { entered(); await paused; return { path: `/bin/${command}` }; } });
  await fixture(async ({ call, spawned, service }) => {
    await assert.rejects(call('terminals', 'POST', { confirm_execution: true }), /branch pending/);
    assert.equal(spawned.length, 0); assert.deepEqual(service.activeSessionsFor('workspaces', 'ws'), []);
  }, { assertDirectoryMutable: () => { throw Error('branch pending'); } });
});

test('opaque native history selection supplies server-validated argv and retains reservation until exit', async () => {
  let released = 0, selected;
  await fixture(async ({ call, spawned }) => {
    const terminal = await call('terminals', 'POST', { confirm_execution: true, provider_id: 'codex', resume: true, history_result_id: 'history-result', view_id: 'resumed-home' });
    assert.equal(selected.projectId, null); assert.equal(selected.workspaceId, 'ws'); assert.equal(selected.actor.id, 'local-owner');
    assert.deepEqual(spawned[0].args, ['resume', 'trusted-session-id']); assert.equal(released, 0);
    spawned[0].exit(); assert.equal(released, 1);
    await call(`terminals/${terminal.id}/stop`, 'POST'); assert.equal(released, 1);
  }, { authorizeTerminalResume: async context => { selected = context; return { sessionId: 'trusted-session-id', providerId: context.providerId, release: () => { released++; } }; } });
});

test('home terminal ids cannot be adopted by other workspace hosts or project-scoped APIs', async () => fixture(async ({ call, service, root, db }) => {
  const terminal = await call('terminals', 'POST', { confirm_execution: true, view_id: 'owned' });
  await assert.rejects(call(`terminals/${terminal.id}`, 'GET', {}, { workspace_id: 'other' }), /does not belong/);
  db.prepare('INSERT INTO projects VALUES (?,?,?,NULL)').run('project', 'ws', root);
  const project = service.scope('ws', 'project');
  await assert.rejects(service.dispatch(project, `terminals/${terminal.id}`, 'GET', {}, new URL('http://127.0.0.1/api/workbench'), { actor: { id: 'local-owner' } }), /does not belong/);
  const foreignView = await call('terminal-views/foreign', 'GET', {}, { visible_ids: JSON.stringify([terminal.id]) });
  assert.equal(foreignView.verified, false); assert.equal(foreignView.can_stop, false);
}));

test('external home-root replacement during provider lookup fails before native spawn', async () => {
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; }), paused = new Promise(resolve => { release = resolve; });
  await fixture(async ({ call, spawned, home }) => {
    const pending = call('terminals', 'POST', { confirm_execution: true, provider_id: 'codex' });
    await ready;
    await rename(home, `${home}-old`); await mkdir(home); release();
    await assert.rejects(pending, /terminal directory changed/); assert.equal(spawned.length, 0);
  }, { terminalResolveExecutable: async command => { entered(); await paused; return { path: `/bin/${command}` }; } });
});

test('failed exact resume preparation releases selection and never accepts browser-native ids', async () => {
  let released = 0;
  await fixture(async ({ call, spawned }) => {
    for (const key of ['session_id', 'resumeSessionId']) await assert.rejects(call('terminals', 'POST', { confirm_execution: true, provider_id: 'codex', resume: true, [key]: 'untrusted' }), /selected by the local server/);
    await assert.rejects(call('terminals', 'POST', { confirm_execution: true, provider_id: 'codex', resume: true, history_result_id: 'history-result' }), /not found/);
    assert.equal(released, 1); assert.equal(spawned.length, 0);
  }, { terminalResolveExecutable: async () => null, authorizeTerminalResume: async context => ({ sessionId: 'trusted-session', providerId: context.providerId, release: () => { released++; } }) });
});

test('uncertain cleanup after a resumed terminal save failure keeps its exact-session reservation', async () => {
  let released = 0, claimedProcess;
  await fixture(async ({ call, db }) => {
    db.exec("CREATE TRIGGER reject_terminal_save BEFORE INSERT ON local_workspace_terminals BEGIN SELECT RAISE(FAIL,'fixture storage failure'); END");
    await assert.rejects(call('terminals', 'POST', { confirm_execution: true, provider_id: 'codex', resume: true, history_result_id: 'history-result' }), /fixture storage failure/);
    assert.equal(released, 0);
    claimedProcess.exit(); assert.equal(released, 1);
  }, { authorizeTerminalResume: async context => ({ sessionId: 'trusted-session', providerId: context.providerId, release: () => { released++; } }), ptyFactory: { spawn() { const exits = new Set(); claimedProcess = { onData() {}, onExit(callback) { exits.add(callback); }, kill() { throw Error('cleanup uncertain'); }, exit() { for (const callback of exits) callback({ exitCode: 0 }); } }; return claimedProcess; } } });
});

test('actual native PTY can start in an isolated server-home fixture without creating a project', { skip: !['darwin', 'linux'].includes(process.platform), timeout: 10000 }, async () => fixture(async ({ call, home, db }) => {
  const terminal = await call('terminals', 'POST', { confirm_execution: true, view_id: 'real-home-pty', command: 'printf frondose-home-pty-check; pwd' });
  let result;
  for (let attempt = 0; attempt < 100; attempt++) {
    result = await call(`terminals/${terminal.id}`, 'GET', {}, { wait_ms: 80 });
    if (result.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(result.status, 'exited'); assert.equal(result.exit_code, 0);
  assert.ok(result.output.includes('frondose-home-pty-check'));
  assert.ok(result.output.includes(await realpath(home)));
  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n, 0);
}, { ptyFactory: undefined, terminalPlatform: process.platform }));

test('optional terminal settings epoch guard rejects stale host/project targets without granting directory authority', async () => fixture(async ({ call, service, root, db, spawned }) => {
  assert.equal((await call('settings', 'PATCH', { expected_binding_version: null, terminalFontSize: 15 })).settings.terminalFontSize, 15);
  db.prepare('INSERT INTO projects VALUES (?,?,?,NULL)').run('project', 'ws', root);
  db.exec('CREATE TABLE directory_workspaces(workspace_id TEXT PRIMARY KEY,project_id TEXT,path TEXT,root_identity TEXT,version TEXT)');
  db.prepare('INSERT INTO directory_workspaces VALUES (?,?,?,?,?)').run('ws', 'project', root, 'fixture-root', 'binding-one');
  for (const expected_binding_version of [null, 'binding-one', 'binding-old']) await assert.rejects(call('settings', 'PATCH', { expected_binding_version, terminalFontSize: 18 }), error => error.statusCode === 409 && error.code === 'directory_conflict');
  const project = service.scope('ws', 'project');
  const projectSettings = body => service.dispatch(project, 'settings', 'PATCH', body, new URL('http://127.0.0.1/api/workbench'), { actor: { id: 'local-owner' } });
  assert.equal((await projectSettings({ expected_binding_version: 'binding-one', terminalFontSize: 16 })).settings.terminalFontSize, 16);
  for (const expected_binding_version of [null, 'binding-old', undefined]) await assert.rejects(projectSettings({ expected_binding_version, terminalFontSize: 22 }), error => error.statusCode === 409);
  db.prepare('UPDATE directory_workspaces SET project_id=?').run('other-project');
  await assert.rejects(projectSettings({ expected_binding_version: 'binding-one', terminalFontSize: 22 }), error => error.statusCode === 409);
  assert.equal((await service.summary(project)).settings.terminalFontSize, 16);
  // Existing callers without a UI preflight keep the historical preferences API.
  assert.equal((await call('settings', 'PATCH', { terminalFontSize: 17 })).settings.terminalFontSize, 17);
  assert.equal(spawned.length, 0);
}));

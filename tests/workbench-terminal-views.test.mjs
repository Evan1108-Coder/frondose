import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createWorkbenchService } from '../server/workbench-service.mjs';

async function fixture(callback, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-terminal-view-test-')), root = join(directory, 'project'), dataDir = join(directory, 'private');
  await mkdir(root); await mkdir(dataDir);
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT); CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,local_path TEXT,archived_at TEXT); INSERT INTO workspaces VALUES ('ws',NULL),('other',NULL);`);
  db.prepare('INSERT INTO projects VALUES (?,?,?,NULL)').run('project', 'ws', root); db.prepare('INSERT INTO projects VALUES (?,?,?,NULL)').run('other-project', 'other', root);
  const instances = [];
  const factory = { spawn() { const terminal = { killed: 0, onData(callback) { this.data = callback; }, onExit(callback) { this.exit = callback; }, write() {}, resize() {}, kill() { this.killed++; if (this.rejectKill) throw new Error('fixture refusal'); if (!this.holdExit) this.exit?.({ exitCode: 0 }); } }; instances.push(terminal); return terminal; } };
  const service = createWorkbenchService({ db, dataDir, ptyFactory: factory, ...options }), project = service.scope('ws', 'project');
  const call = (action, method = 'GET', body = {}, query = {}, scope = project) => service.dispatch(scope, action, method, body, new URL(`http://127.0.0.1/api/workbench?${new URLSearchParams(query)}`), { actor: { id: 'local-owner' } });
  const launch = view_id => call('terminals', 'POST', { name: 'Fixture CLI', confirm_execution: true, ...(view_id === undefined ? {} : { view_id }) });
  const status = (view, visible = []) => call(`terminal-views/${view}`, 'GET', {}, { visible_ids: JSON.stringify(visible) });
  const stop = (view, snapshot, change = {}) => call(`terminal-views/${view}/stop`, 'POST', { confirmed: true, expected_session_ids: snapshot.stop_session_ids, fingerprint: snapshot.fingerprint, visible_ids: [], ...change });
  try { await callback({ service, db, call, launch, status, stop, instances, project }); }
  finally { for (const item of instances) { item.rejectKill = false; item.holdExit = false; } service.close(); db.close(); await rm(directory, { recursive: true, force: true }); }
}

test('fresh terminal views are verified idle and reading them does not launch or claim terminals', async () => fixture(async ({ status, instances, db }) => {
  const result = await status('view_a'); assert.equal(result.state, 'idle'); assert.equal(result.verified, true); assert.equal(result.can_stop, false);
  assert.equal(instances.length, 0); assert.equal(db.prepare('SELECT count(*) AS n FROM workbench_terminal_view_ownership').get().n, 0);
}));

test('server-created view ownership survives layout absence and covers multiple inactive split PTYs only', async () => fixture(async ({ launch, status, stop, instances }) => {
  const a1 = await launch('view_a'), a2 = await launch('view_a'), b = await launch('view_b');
  const before = await status('view_a'); assert.equal(before.state, 'running'); assert.deepEqual(before.stop_session_ids, [a1.id, a2.id].sort());
  const result = await stop('view_a', before); assert.equal(result.stopped, true); assert.deepEqual(result.stopped_session_ids, [a1.id, a2.id].sort());
  assert.deepEqual(instances.map(item => item.killed), [1, 1, 0]); assert.equal((await status('view_b')).stop_session_ids[0], b.id);
}));

test('a selected foreign-view attachment never transfers ownership or becomes an allowed stop target', async () => fixture(async ({ launch, status, stop, instances, db }) => {
  const own = await launch('view_a'), other = await launch('view_b');
  const attached = await status('view_a', [other.id]); assert.equal(attached.state, 'unknown'); assert.equal(attached.can_stop, false); assert.deepEqual(attached.stop_session_ids, [own.id]);
  await assert.rejects(stop('view_a', attached, { visible_ids: [other.id] }), /ownership is uncertain/);
  assert.deepEqual(instances.map(item => item.killed), [0, 0]); assert.equal(db.prepare('SELECT view_id FROM workbench_terminal_view_ownership WHERE terminal_id=?').get(other.id).view_id, 'view_b');
}));

test('legacy/unowned or unavailable saved IDs warn without stopping any project-wide fallback', async () => fixture(async ({ launch, status, stop, instances }) => {
  const legacy = await launch();
  const result = await status('old_view', [legacy.id]); assert.equal(result.state, 'unknown'); assert.equal(result.can_stop, false); assert.deepEqual(result.stop_session_ids, []);
  await assert.rejects(stop('old_view', result), /ownership is uncertain/);
  const missing = await status('view_a', ['term_missing']); assert.equal(missing.state, 'unknown'); assert.match(missing.reason, /attachment_unavailable/);
  assert.equal(instances[0].killed, 0);
}));

test('stale target lists or fingerprints fail before any kill, including a newly added split', async () => fixture(async ({ launch, status, stop, instances }) => {
  const first = await launch('view_a'), before = await status('view_a');
  await assert.rejects(stop('view_a', before, { confirmed: false }), /Explicitly confirm/);
  await assert.rejects(stop('view_a', before, { expected_session_ids: ['term_wrong'] }), /changed/);
  await assert.rejects(stop('view_a', before, { fingerprint: '0'.repeat(64) }), /changed/);
  await launch('view_a'); await assert.rejects(stop('view_a', before), /changed/);
  assert.deepEqual(instances.map(item => item.killed), [0, 0]); assert.ok((await status('view_a')).stop_session_ids.includes(first.id));
}));

test('cross-workspace and cross-project view requests cannot resolve or stop another scope’s terminal', async () => fixture(async ({ service, call, launch, status, instances }) => {
  const terminal = await launch('view_a'), before = await status('view_a'), other = service.scope('other', 'other-project');
  const result = await call('terminal-views/view_a', 'GET', {}, { visible_ids: JSON.stringify([terminal.id]) }, other);
  assert.equal(result.state, 'unknown'); assert.deepEqual(result.stop_session_ids, []);
  await assert.rejects(call('terminal-views/view_a/stop', 'POST', { confirmed: true, expected_session_ids: [terminal.id], fingerprint: before.fingerprint }, {}, other), /changed/);
  assert.equal(instances[0].killed, 0);
}));

test('an in-flight launch with no terminal ID produces unknown status and cannot be silently closed as stopped', async () => {
  let release, entered; const ready = new Promise(resolve => { entered = resolve; }), wait = new Promise(resolve => { release = resolve; });
  await fixture(async ({ call, status, stop, instances }) => {
    const launching = call('terminals', 'POST', { confirm_execution: true, provider_id: 'codex', view_id: 'view_a' });
    await ready; const before = await status('view_a');
    assert.equal(before.state, 'unknown'); assert.equal(before.pending_count, 1); assert.deepEqual(before.stop_session_ids, []);
    await assert.rejects(stop('view_a', before), /ownership is uncertain/); assert.equal(instances.length, 0);
    release(); await launching; assert.equal((await status('view_a')).state, 'running');
  }, { terminalPlatform: 'linux', terminalEnv: {}, terminalResolveExecutable: async () => { entered(); await wait; return { path: '/bin/codex' }; } });
});

test('stop waits for actual exit confirmation and keeps ownership uncertain on timeout', async () => fixture(async ({ launch, status, stop, instances }) => {
  await launch('view_a'); instances[0].holdExit = true;
  await assert.rejects(stop('view_a', await status('view_a')), /exit is not confirmed/);
  assert.equal(instances[0].killed, 1); assert.equal((await status('view_a')).sessions[0].status, 'stopping');
}));

test('partial stop failure never claims the tab stopped and does not kill another view', async () => fixture(async ({ launch, status, stop, instances }) => {
  const a1 = await launch('view_a'), a2 = await launch('view_a'); await launch('view_b');
  const ordered = [a1.id, a2.id].sort(); instances[[a1.id, a2.id].indexOf(ordered[1])].rejectKill = true;
  await assert.rejects(stop('view_a', await status('view_a')), /could not be stopped/); assert.equal(instances[2].killed, 0);
  assert.equal((await status('view_a')).state, 'running');
}));

test('ended sessions are verified idle, interrupted sessions are not asserted stopped', async () => fixture(async ({ launch, status, instances, db }) => {
  const ended = await launch('view_a'); instances[0].exit({ exitCode: 0 });
  assert.equal((await status('view_a')).state, 'idle');
  db.prepare("UPDATE workbench_terminals SET status='interrupted' WHERE id=?").run(ended.id);
  const uncertain = await status('view_a'); assert.equal(uncertain.state, 'unknown'); assert.equal(uncertain.can_stop, false);
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authorizeNativeAgentBinding } from '../server/native-agent-authorization.mjs';
import { createLocalApi } from '../server/local-api.mjs';

function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE workspaces(id TEXT,archived_at TEXT);
    CREATE TABLE projects(id TEXT,workspace_id TEXT,team_id TEXT,archived_at TEXT);
    CREATE TABLE teams(id TEXT,workspace_id TEXT,archived_at TEXT);
    CREATE TABLE agents(id TEXT,workspace_id TEXT,name TEXT,provider TEXT,version INTEGER,instructions TEXT,status TEXT,archived_at TEXT,provider_connection_id TEXT,permission_policy TEXT);
    CREATE TABLE connections(id TEXT,provider TEXT,state TEXT,mode TEXT,updated_at TEXT,metadata_json TEXT);
    CREATE TABLE agent_runner_settings(agent_id TEXT,workspace_id TEXT,enabled INTEGER,connection_method TEXT,runner_id TEXT,version INTEGER);
    CREATE TABLE agent_runner_settings_audit(agent_id TEXT,workspace_id TEXT,version INTEGER);
    INSERT INTO workspaces VALUES('ws',NULL),('other',NULL);
    INSERT INTO projects VALUES('project','ws',NULL,NULL),('foreign','other',NULL,NULL);
    INSERT INTO agents VALUES('agent','ws','Named helper','codex',3,'Keep a useful result.','available',NULL,'conn_codex','review');
    INSERT INTO connections VALUES('conn_codex','codex','connected','local','2026-10-25T00:00:00Z','{"token":"must-not-leak"}');`);
  const status = { state: 'connected', method: 'existing', transport: 'cli-exec', checkedAt: '2026-10-25T00:00:00Z' }, calls = [];
  const context = { db, local: true, workspaceId: 'ws', projectId: 'project', agentId: 'agent', providerId: 'codex', actor: { id: 'local-owner' }, allowed: (_workspace, _actor, permission, scope) => { calls.push({ permission, scope }); return true; }, providerState: () => status };
  return { db, context, status, calls, authorize: patch => authorizeNativeAgentBinding({ ...context, ...patch }) };
}

test('native authorization returns current profile plus bounded non-secret binding revision without probes', t => {
  const { authorize, calls } = fixture(t);
  const result = authorize();
  assert.equal(result.name, 'Named helper'); assert.equal(result.version, 3); assert.equal(result.instructions, 'Keep a useful result.');
  assert.ok(result.native_binding_revision.length < 2000); assert.doesNotMatch(JSON.stringify(result), /must-not-leak|metadata_json/);
  assert.deepEqual(calls.map(call => call.permission), ['workbench.execute', 'projects.read', 'agents.read', 'agents.run', 'agents.use']);
});
test('only the local owner may authorize native tasks in valid current scopes', t => {
  const { authorize, db } = fixture(t);
  for (const patch of [{ local: false }, { actor: null }, { actor: { id: 'member' } }, { projectId: 'foreign' }, { workspaceId: 'other' }, { providerId: 'claude' }]) assert.throws(() => authorize(patch));
  assert.throws(() => authorize({ allowed: () => false }), { statusCode: 403 });
  db.exec("UPDATE agents SET status='paused'"); assert.throws(() => authorize(), { statusCode: 403 });
  db.exec("UPDATE agents SET status='available',archived_at='archived'"); assert.throws(() => authorize(), { statusCode: 403 });
});
test('archived workspace, project and Area do not retain launch authority', t => {
  const { authorize, db } = fixture(t);
  db.exec("UPDATE workspaces SET archived_at='x' WHERE id='ws'"); assert.throws(() => authorize(), { statusCode: 403 });
  db.exec("UPDATE workspaces SET archived_at=NULL; UPDATE projects SET archived_at='x' WHERE id='project'"); assert.throws(() => authorize(), { statusCode: 403 });
  db.exec("UPDATE projects SET archived_at=NULL,team_id='area' WHERE id='project'; INSERT INTO teams VALUES('area','ws','x')"); assert.throws(() => authorize(), /Area/);
});
test('a disabled, unselected, API, OAuth or paired-runner binding never falls back to a local account', t => {
  const { authorize, db } = fixture(t);
  for (const [enabled, method, runner] of [[0, 'computer', 'runner'], [0, 'unselected', null], [1, 'api', null], [1, 'oauth', null], [1, 'computer', 'runner']]) {
    db.prepare('INSERT INTO agent_runner_settings VALUES(?,?,?,?,?,?)').run('agent', 'ws', enabled, method, runner, 2);
    assert.throws(() => authorize());
    db.exec('DELETE FROM agent_runner_settings');
  }
  assert.equal(authorize().provider, 'codex');
});
test('unbound, mismatched or non-local connections are rejected instead of using defaults', t => {
  const { authorize, db, status } = fixture(t);
  db.exec('UPDATE agents SET provider_connection_id=NULL'); assert.throws(() => authorize(), { code: 'profile_unbound' });
  db.exec("UPDATE agents SET provider_connection_id='conn_codex'; UPDATE connections SET mode='api'"); assert.throws(() => authorize(), { code: 'not_connected' });
  db.exec("UPDATE connections SET mode='local',state='not_connected'"); assert.throws(() => authorize(), { code: 'not_connected' });
  db.exec("UPDATE connections SET state='connected'"); status.state = 'not_connected'; assert.throws(() => authorize(), { code: 'not_connected' });
  status.state = 'connected'; status.method = 'oauth'; assert.throws(() => authorize(), { code: 'not_connected' });
});
test('current permissions and read-only policies are rechecked on every callback', t => {
  const { authorize, db } = fixture(t);
  for (const permission of ['agents.read', 'agents.run', 'agents.use', 'workbench.execute', 'projects.read']) assert.throws(() => authorize({ allowed: (_ws, _actor, current) => current !== permission }), { statusCode: 403 });
  db.exec("UPDATE agents SET permission_policy='read-only'"); assert.throws(() => authorize(), { code: 'native_agent_read_only' });
});
test('connection refresh and cleared-preparation revisions invalidate the preview fingerprint', t => {
  const { authorize, db } = fixture(t);
  const original = authorize().native_binding_revision;
  db.exec("UPDATE connections SET updated_at='later'"); const refreshed = authorize().native_binding_revision;
  assert.notEqual(refreshed, original);
  db.exec("INSERT INTO agent_runner_settings_audit VALUES('agent','ws',4)");
  assert.notEqual(authorize().native_binding_revision, refreshed);
});
test('personal Frondose setup guard remains part of native-session authorization', t => {
  const { authorize } = fixture(t);
  assert.throws(() => authorize({ assertAssistantBinding: () => { throw Object.assign(Error('Choose the personal assistant connection'), { statusCode: 409 }); } }), /assistant connection/);
});

test('native preview API requires explicit workspace activation and passes authenticated owner to callback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-native-auth-api-')), dataDir = join(directory, 'storage'), root = join(directory, 'project');
  await mkdir(root);
  const commands = [];
  const api = createLocalApi({ dataDir, productMode: 'local', integrationOptions: { env: {}, execute: async (command, args) => { commands.push([command, args]); return { code: 0, stdout: '{}', stderr: '' }; }, spawnProcess: () => { throw Error('No process should spawn in preview tests'); }, fetchImpl: () => { throw Error('No network in preview tests'); } } });
  const server = createServer(api.middleware);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = async (path, input, method = input ? 'POST' : 'GET') => {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: input ? JSON.stringify(input) : undefined });
      return { status: response.status, body: await response.json() };
    };
    const workspace = (await call('/workspaces', { name: 'Native fixture' })).body.workspace;
    const project = (await call('/projects', { workspace_id: workspace.id, name: 'Local project', local_path: root })).body.project;
    const agent = (await call('/agents', { workspace_id: workspace.id, name: 'Named local agent', provider: 'codex', provider_connection_id: 'conn_codex', instructions: 'Make a reviewable result.' })).body.agent;
    const preview = `/workbench/native-agent-preview?${new URLSearchParams({ workspace_id: workspace.id, project_id: project.id, agent_id: agent.id, provider_id: 'codex' })}`;
    assert.equal((await call(preview)).status, 409); assert.equal(commands.length, 0);
    const connected = await call('/connections/codex/connect', { workspace_id: workspace.id, method: 'existing' });
    assert.equal(connected.status, 200, JSON.stringify(connected.body));
    const beforePreview = commands.length;
    const result = await call(preview);
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.result.instructions, 'Make a reviewable result.'); assert.match(result.body.result.snapshot_hash, /^[a-f0-9]{64}$/);
    assert.equal(commands.length, beforePreview, 'Preview must not probe or invoke a provider');
    await call(`/agents/${agent.id}`, { provider_connection_id: null }, 'PATCH');
    assert.equal((await call(preview)).status, 409);
  } finally { await new Promise(resolve => server.close(resolve)); api.close(); await rm(directory, { recursive: true, force: true }); }
});

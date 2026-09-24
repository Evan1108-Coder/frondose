import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createLocalApi } from '../server/local-api.mjs';

async function fixture(t, sourceDefaults = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-profile-history-security-'));
  let externalCalls = 0, ownerCookie;
  const forbidden = () => { externalCalls++; throw new Error('No providers, processes or external accounts in profile history tests'); };
  const api = createLocalApi({ dataDir: directory, seedMode: 'clean', integrationOptions: { env: {}, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden } });
  const db = new DatabaseSync(api.dbPath); db.exec('PRAGMA foreign_keys=ON');
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); db.close(); await rm(directory, { recursive: true, force: true }); assert.equal(externalCalls, 0); });
  const request = async (method, path, body, cookie = ownerCookie) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const call = async (method, path, body, cookie) => { const result = await request(method, path, body, cookie); assert(result.status >= 200 && result.status < 300, `${method} ${path}: ${result.status} ${JSON.stringify(result.body).slice(0, 1200)}`); return result.body; };
  const workspace = (await call('POST', '/workspaces', { name: 'Profile history security' })).workspace;
  const area = (await call('POST', '/teams', { workspace_id: workspace.id, name: 'Source Area' })).team;
  const project = (await call('POST', '/projects', { workspace_id: workspace.id, team_id: area.id, name: 'Private source project' })).project;
  const document = (await call('POST', '/documents', { workspace_id: workspace.id, project_id: project.id, title: 'Private source', content: 'PRIVATE SOURCE CONTENT' })).document;
  const pack = (await call('POST', '/workspace-items', { workspace_id: workspace.id, kind: 'context_pack', name: 'Private reference pack', payload: { content: '', document_ids: [document.id], memory_ids: [] } })).result;
  const agent = (await call('POST', '/agents', { workspace_id: workspace.id, name: 'History helper', provider: 'codex', instructions: 'Original instruction\nSecond line.', role: 'Original role', description: 'Original description', output_behavior: 'Original output behavior', working_directory: directory, permission_policy: 'review', default_area_id: area.id, default_project_id: project.id, context_source_ids: [pack.id], ...sourceDefaults })).agent;
  const current = (await call('PATCH', `/agents/${agent.id}`, { version: agent.version, provider: 'claude', provider_connection_id: null, working_directory: null, permission_policy: 'read-only', model: 'fixture-current-model', memory_policy: 'none', default_area_id: null, default_project_id: null, context_source_ids: [], instructions: 'Current instruction', role: 'Current role', output_behavior: 'Current output behavior' })).agent;
  const historyPath = `/agents/${agent.id}/content-history`, restorePath = `/agents/${agent.id}/restore-content`;
  const history = async (query = '', cookie) => (await call('GET', historyPath + query, undefined, cookie)).result;
  const restoreBody = async (extra = {}) => {
    const source = (await history('?version=1')).versions[0];
    return { current_version: (await history()).current_version, source_version: 1, source_hash: source.source_sha256, fields: ['instructions'], confirmed: true, request_id: `restore-${randomUUID()}`, ...extra };
  };
  const authenticate = async () => {
    const member = (await call('POST', '/governance', { workspace_id: workspace.id, action: 'create_member', name: 'History reader', email: 'history-reader@example.com' })).result;
    const owner = await request('POST', '/identity/setup', { name: 'Owner', email: 'history-owner@example.com', password: 'isolated owner password 123' }); assert.equal(owner.status, 200); ownerCookie = owner.cookie;
    const invitation = await call('POST', '/identity/invite', { workspace_id: workspace.id, member_id: member.id });
    const accepted = await request('POST', '/identity/accept', { token: invitation.result.invitation_token, password: 'isolated member password 123' }); assert.equal(accepted.status, 200);
    const grant = (permission, effect = 'allow', scope_type = 'agent', scope_id = agent.id) => call('POST', '/governance', { workspace_id: workspace.id, action: 'grant', member_id: member.id, permission, effect, scope_type, scope_id, reason: 'Isolated profile-history security check' });
    return { member, cookie: accepted.cookie, grant };
  };
  return { api, db, workspace, area, project, document, pack, agent, current, request, call, history, restoreBody, historyPath, restorePath, authenticate };
}

test('profile history HTTP: restore is content-only, exact, versioned, immutable and cannot execute anything', async t => {
  const f = await fixture(t), before = f.db.prepare('SELECT * FROM agents WHERE id=?').get(f.agent.id);
  const original = f.db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? AND version=1').get(f.agent.id);
  const input = await f.restoreBody(), response = await f.request('POST', f.restorePath, input);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const after = f.db.prepare('SELECT * FROM agents WHERE id=?').get(f.agent.id);
  assert.equal(after.instructions, 'Original instruction\nSecond line.'); assert.equal(after.version, 3);
  for (const key of Object.keys(before).filter(key => !['instructions', 'version', 'updated_at'].includes(key))) assert.deepEqual(after[key], before[key], `Unexpected restoration of ${key}`);
  assert.deepEqual(f.db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? AND version=1').get(f.agent.id), original);
  assert.throws(() => f.db.prepare("UPDATE agent_profile_versions SET snapshot_json='{}' WHERE agent_id=?").run(f.agent.id), /immutable/);
  assert.throws(() => f.db.prepare("UPDATE agent_profile_content_restores SET restored_by='forged' WHERE agent_id=?").run(f.agent.id), /immutable/);
  assert.equal(f.db.prepare('SELECT COUNT(*) count FROM runs').get().count, 0);
  const replay = await f.request('POST', f.restorePath, input); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.equal(f.db.prepare('SELECT version FROM agents WHERE id=?').get(f.agent.id).version, 3);
});

test('profile history HTTP: source hash/current version pins and restoration field allowlist reject forged authority', async t => {
  const f = await fixture(t), input = await f.restoreBody();
  for (const field of ['provider', 'provider_connection_id', 'working_directory', 'permission_policy', 'model', 'memory_policy', 'context_source_ids', 'default_area_id', 'default_project_id', 'name', 'version']) {
    assert.equal((await f.request('POST', f.restorePath, { ...input, fields: [field] })).status, 400, field);
  }
  for (const extra of [{ provider: 'codex' }, { instructions: 'Caller invented history' }, { restored_by: 'local-owner' }]) assert.equal((await f.request('POST', f.restorePath, { ...input, ...extra })).status, 400);
  assert.equal((await f.request('POST', f.restorePath, { ...input, source_hash: '0'.repeat(64) })).status, 409);
  assert.equal((await f.request('POST', f.restorePath, { ...input, current_version: 1 })).status, 409);
  assert.equal((await f.request('POST', f.restorePath, { ...input, confirmed: false })).status, 400);
  assert.equal((await f.request('POST', f.restorePath, { ...input, source_version: 999 })).status, 404);
  assert.equal(f.db.prepare('SELECT version FROM agents WHERE id=?').get(f.agent.id).version, 2);
});

test('profile history HTTP: concurrent restore wins once and request keys cannot be repurposed', async t => {
  const f = await fixture(t), input = await f.restoreBody();
  const results = await Promise.all([f.request('POST', f.restorePath, input), f.request('POST', f.restorePath, { ...input, request_id: 'another-restore-key' })]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const winning = results[0].status === 201 ? input : { ...input, request_id: 'another-restore-key' };
  assert.equal((await f.request('POST', f.restorePath, { ...winning, fields: ['role'] })).status, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) count FROM agent_profile_content_restores WHERE agent_id=?').get(f.agent.id).count, 1);
});

test('profile history HTTP: authenticated users require read AND write, and cannot inspect shared machine profiles', async t => {
  const f = await fixture(t), input = await f.restoreBody(), member = await f.authenticate();
  assert.equal((await f.request('GET', f.historyPath, undefined, member.cookie)).status, 200);
  assert.equal((await f.request('POST', f.restorePath, input, member.cookie)).status, 403);
  await member.grant('agents.write'); await member.grant('agents.read', 'deny');
  assert.equal((await f.request('GET', f.historyPath, undefined, member.cookie)).status, 403);
  assert.equal((await f.request('POST', f.restorePath, input, member.cookie)).status, 403, 'Write permission does not imply reading historical instruction content');
  assert.equal((await f.request('GET', '/agents/codex/content-history', undefined, member.cookie)).status, 403);
  assert.equal((await f.request('POST', '/agents/codex/restore-content', input, member.cookie)).status, 403);
});

test('profile history HTTP: revoked historical sources hide exact content/hash and invalidate cached restoration replies', async t => {
  const f = await fixture(t), input = await f.restoreBody(), member = await f.authenticate();
  await member.grant('agents.write');
  assert.equal((await f.request('POST', f.restorePath, input, member.cookie)).status, 201);
  await member.grant('documents.read', 'deny', 'project', f.project.id);
  const source = (await f.history('?version=1', member.cookie)).versions[0];
  assert.equal(source.restricted, true); assert.equal(source.content, undefined); assert.equal(source.source_sha256, undefined);
  assert(!JSON.stringify(source).includes(f.pack.id));
  assert.equal((await f.request('POST', f.restorePath, input, member.cookie)).status, 403);
  const legacy = await f.call('GET', `/agents/${f.agent.id}/versions`, undefined, member.cookie);
  const old = legacy.agent_profile_versions.find(row => row.version === 1);
  assert.equal(old.snapshot_redacted, true); assert.equal(old.snapshot_hash, undefined);
  assert.deepEqual(old.snapshot.context_source_ids, []);
});

test('profile history HTTP: revoked agent access blocks exact replay, and foreign workspace history is inaccessible', async t => {
  const f = await fixture(t), input = await f.restoreBody();
  const foreignWorkspace = (await f.call('POST', '/workspaces', { name: 'Foreign workspace' })).workspace;
  const foreign = (await f.call('POST', '/agents', { workspace_id: foreignWorkspace.id, name: 'Foreign agent', provider: 'codex', instructions: 'FOREIGN PRIVATE INSTRUCTIONS' })).agent;
  const member = await f.authenticate(); await member.grant('agents.write');
  assert.equal((await f.request('POST', f.restorePath, input, member.cookie)).status, 201);
  await member.grant('agents.read', 'deny');
  const replay = await f.request('POST', f.restorePath, input, member.cookie);
  assert.equal(replay.status, 403); assert(!JSON.stringify(replay.body).includes('Original instruction'));
  const other = await f.request('GET', `/agents/${foreign.id}/content-history`, undefined, member.cookie);
  assert.equal(other.status, 403); assert(!JSON.stringify(other.body).includes('FOREIGN PRIVATE INSTRUCTIONS'));
});

test('profile history HTTP: bounded pagination and exact lookup do not reinterpret unavailable snapshot contents', async t => {
  const f = await fixture(t), input = await f.restoreBody(); await f.call('POST', f.restorePath, input);
  const first = await f.history('?limit=1'); assert.equal(first.versions[0].version, 3); assert.equal(first.next_before_version, 3);
  const second = await f.history('?limit=1&before_version=3'); assert.equal(second.versions[0].version, 2); assert.equal(second.next_before_version, 2);
  assert.equal((await f.history('?version=1')).versions[0].version, 1);
  for (const query of ['?limit=51', '?version=1&limit=1', '?version=1&version=2', '?before_version=1.5']) assert.equal((await f.request('GET', f.historyPath + query)).status, 400);
  // Fixture-only corruption verifies fail-closed reads, not an API mutation path.
  f.db.exec('DROP TRIGGER agent_profile_versions_no_update');
  f.db.prepare("UPDATE agent_profile_versions SET snapshot_json='{}' WHERE agent_id=? AND version=1").run(f.agent.id);
  const corrupted = (await f.history('?version=1')).versions[0];
  assert.equal(corrupted.restricted, true); assert.equal(corrupted.reason, 'invalid_snapshot');
  assert.equal(corrupted.content, undefined); assert.equal(corrupted.source_sha256, undefined);
  assert.equal((await f.request('POST', f.restorePath, input)).status, 409, 'Corrupt cached retry source returns a structured conflict');
});

test('profile history HTTP: source versions never cross agents/workspaces and archived profiles refuse retries', async t => {
  const f = await fixture(t), input = await f.restoreBody();
  const foreignWorkspace = (await f.call('POST', '/workspaces', { name: 'Foreign profile workspace' })).workspace;
  const foreign = (await f.call('POST', '/agents', { workspace_id: foreignWorkspace.id, name: 'Foreign helper', provider: 'codex', instructions: 'FOREIGN SECRET' })).agent;
  const foreignSource = (await f.call('GET', `/agents/${foreign.id}/content-history?version=1`)).result.versions[0];
  assert.equal((await f.request('POST', f.restorePath, { ...input, source_hash: foreignSource.source_sha256 })).status, 409);
  assert.equal((await f.request('POST', f.restorePath, input)).status, 201);
  await f.call('PATCH', `/agents/${f.agent.id}`, { version: 3, archived_at: new Date().toISOString() });
  assert.equal((await f.request('GET', f.historyPath)).status, 409);
  assert.equal((await f.request('POST', f.restorePath, input)).status, 409);
  assert.equal(f.db.prepare('SELECT version FROM agents WHERE id=?').get(f.agent.id).version, 3);
});

test('profile history HTTP: exported/imported content carries no restore receipts, authorship or execution authority', async t => {
  const f = await fixture(t); await f.call('POST', f.restorePath, await f.restoreBody());
  const archive = await f.call('GET', `/export?workspace_id=${f.workspace.id}`);
  for (const key of ['agent_profile_versions', 'agent_profile_content_restores', 'agent_profile_history_requests']) assert.equal(archive.data[key], undefined);
  const imported = (await f.call('POST', '/import', archive)).result;
  const copy = f.db.prepare('SELECT * FROM agents WHERE workspace_id=?').get(imported.id);
  assert.equal(copy.provider_connection_id, null); assert.equal(copy.working_directory, null);
  const history = (await f.call('GET', `/agents/${copy.id}/content-history`)).result;
  assert.equal(history.versions.length, 1); assert.equal(history.versions[0].version, 1);
  assert.equal(history.versions[0].restored_from, null); assert.equal(history.versions[0].author, null);
  assert.equal(f.db.prepare('SELECT COUNT(*) count FROM agent_profile_content_restores WHERE agent_id=?').get(copy.id).count, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) count FROM agent_profile_history_requests WHERE agent_id=?').get(copy.id).count, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) count FROM runs').get().count, 0);
});

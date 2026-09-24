import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from '../server/local-api.mjs';
import { createAccessBoundary } from '../server/access-boundary.mjs';
import { installAgentProfiles, validateAgentProfile, snapshotAgentProfile } from '../server/agent-profiles.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rumbo-agent-profiles-'));
  const api = createLocalApi({ dataDir: dir, seedMode: 'demo' });
  const db = new DatabaseSync(api.dbPath), ws = api.snapshot().workspaces[0].id;
  const server = createServer(api.middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() };
  };
  const create = async (path, body, key) => {
    const response = await call('POST', path, body);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body[key];
  };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); api.close(); await rm(dir, { recursive: true, force: true }); });
  return { db, ws, api, call, create };
}

test('legacy profile creates and new JSON/nullable fields round trip without touching provider accounts', async t => {
  const { db, ws, call, create } = await fixture(t);
  const connections = db.prepare('SELECT * FROM connections ORDER BY id').all();
  const agent = await create('/agents', { workspace_id: ws, name: 'Legacy helper', provider: 'codex' }, 'agent');
  assert.deepEqual(agent.context_source_ids, []);
  assert.equal(agent.version, 1);
  assert.equal(agent.provider_connection_id, connections.find(row => row.provider === 'codex').id);
  const output = 'Summary\n\nEvidence\n' + 'x'.repeat(2500);
  const changed = await call('PATCH', `/agents/${agent.id}`, { version: 1, context_source_ids: [], provider_connection_id: null, default_area_id: null, default_project_id: null, output_behavior: output });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.agent.output_behavior, output);
  assert.equal(changed.body.agent.version, 2);
  assert.equal(changed.body.agent.provider_connection_id, null);
  assert.deepEqual(db.prepare('SELECT * FROM connections ORDER BY id').all(), connections);
  const stale = await call('PATCH', `/agents/${agent.id}`, { version: 1, name: 'Stale overwrite' });
  assert.equal(stale.status, 409);
  const history = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? ORDER BY version').all(agent.id);
  assert.equal(history.length, 2);
  assert.equal(JSON.parse(history[0].snapshot_json).output_behavior, '');
  assert.equal(JSON.parse(history[1].snapshot_json).output_behavior, output);
  installAgentProfiles(db);
  assert.equal(db.prepare('SELECT provider_connection_id FROM agents WHERE id=?').get(agent.id).provider_connection_id, null);
});

test('profile validation accepts supported defaults and rejects mismatched providers, foreign references and arbitrary resources', async t => {
  const { db, ws, create } = await fixture(t);
  const area = await create('/teams', { workspace_id: ws, name: 'Engineering' }, 'team');
  const project = await create('/projects', { workspace_id: ws, team_id: area.id, name: 'Work' }, 'project');
  const other = await create('/workspaces', { name: 'Other scope' }, 'workspace');
  const foreign = await create('/teams', { workspace_id: other.id, name: 'Foreign' }, 'team');
  const base = { workspace_id: ws, name: 'Helper', provider: 'codex', default_area_id: area.id, default_project_id: project.id };
  const valid = validateAgentProfile(db, { ...base });
  assert.equal(valid.memory_policy, 'reviewed'); assert.deepEqual(valid.context_source_ids_json, []);
  for (const effort of ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']) assert.doesNotThrow(() => validateAgentProfile(db, { ...base, reasoning_effort: effort }));
  for (const patch of [
    { provider_connection_id: db.prepare("SELECT id FROM connections WHERE provider='claude'").get().id },
    { default_area_id: foreign.id }, { default_project_id: 'missing' },
    { memory_policy: 'all' }, { permission_policy: 'unrestricted' }, { reasoning_effort: 'invented' },
    { provider: 'claude', reasoning_effort: 'high' }, { output_behavior: 'bad\u0000content' },
    { context_source_ids_json: [''] },
  ]) assert.throws(() => validateAgentProfile(db, { ...base, ...patch }), undefined, JSON.stringify(patch));
  const stamp = new Date().toISOString();
  db.prepare('INSERT INTO workspace_items(id,workspace_id,kind,name,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('not-pack', ws, 'preset', 'Not a Context Pack', '{}', stamp, stamp);
  assert.throws(() => validateAgentProfile(db, { ...base, context_source_ids_json: ['not-pack'] }), /Context Pack/);
  db.prepare('UPDATE teams SET archived_at=? WHERE id=?').run(stamp, area.id);
  assert.throws(() => validateAgentProfile(db, { ...base }), /accessible Area/);
});

async function scopedFixture(t) {
  const f = await fixture(t), { db, ws, create } = f;
  const area = await create('/teams', { workspace_id: ws, name: 'Restricted Area' }, 'team');
  const project = await create('/projects', { workspace_id: ws, team_id: area.id, name: 'Restricted project' }, 'project');
  const document = await create('/documents', { workspace_id: ws, project_id: project.id, title: 'Private evidence', content: 'PRIVATE CONTENT' }, 'document');
  const stamp = new Date().toISOString();
  db.prepare('INSERT INTO workspace_items(id,workspace_id,kind,name,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('private-pack', ws, 'context_pack', 'Private pack', JSON.stringify({ document_ids: [document.id], memory_ids: [], content: '' }), stamp, stamp);
  const agent = await create('/agents', { workspace_id: ws, name: 'Visible helper', provider: 'codex', default_area_id: area.id, default_project_id: project.id, context_source_ids: ['private-pack'] }, 'agent');
  const actor = { id: 'local-owner' };
  const boundary = createAccessBoundary({ db, governance: { explain: (_ws, _actor, _permission, at) => ({ allowed: ![area.id, project.id].includes(at?.scope_id) }) } });
  return { ...f, actor, boundary, area, project, agent };
}

test('profile references and nested Context Pack sources require current read access', async t => {
  const { db, ws, actor, boundary, area, project } = await scopedFixture(t);
  const options = { actor, allowed: boundary.allowed };
  const base = { workspace_id: ws, provider: 'codex' };
  for (const patch of [{ default_area_id: area.id }, { default_project_id: project.id }, { context_source_ids_json: ['private-pack'] }]) assert.throws(() => validateAgentProfile(db, { ...base, ...patch }, options), /accessible/);
  assert.throws(() => validateAgentProfile(db, { ...base, default_area_id: area.id }, { actor }), /accessible/);
});

test('profile current data, change history and version snapshots redact inaccessible defaults without altering stored versions', async t => {
  const { db, ws, agent, boundary, actor } = await scopedFixture(t);
  const stored = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=?').get(agent.id);
  const visible = boundary.filter({ agents: [agent], agent, agent_profile_versions: [stored] }, actor);
  for (const item of [visible.agents[0], visible.agent]) {
    assert.equal(item.default_area_id, null); assert.equal(item.default_project_id, null); assert.deepEqual(item.context_source_ids, []);
  }
  assert.equal(visible.agent_profile_versions[0].snapshot_redacted, true);
  assert.equal(visible.agent_profile_versions[0].snapshot_hash, undefined);
  assert.deepEqual(JSON.parse(visible.agent_profile_versions[0].snapshot_json).context_source_ids, []);
  assert.deepEqual(db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=?').get(agent.id), stored);
  const history = db.prepare("SELECT * FROM change_log WHERE entity_type='agents' AND entity_id=?").all(agent.id);
  assert.equal(JSON.parse(boundary.filter({ change_log: history }, actor).change_log[0].after_json).default_project_id, null);
  const denied = createAccessBoundary({ db, governance: { explain: (_ws, _actor, _permission, at) => ({ allowed: at?.scope_id !== agent.id }) } });
  assert.deepEqual(denied.filter({ agent_profile_versions: [stored], change_log: history }, actor).agent_profile_versions, []);
  assert.deepEqual(denied.filter({ change_log: history }, actor).change_log, []);
  assert.equal(db.prepare('SELECT workspace_id FROM agents WHERE id=?').get(agent.id).workspace_id, ws);
});

test('profile imports remap defaults and Context Packs, drop machine authority and retain immutable fresh versions', async t => {
  const { db, ws, agent, area, project, call } = await scopedFixture(t);
  db.prepare('UPDATE agents SET working_directory=?,permission_policy=? WHERE id=?').run('/not-a-real-folder', 'review', agent.id);
  const archive = (await call('GET', `/export?workspace_id=${ws}`)).body;
  const response = await call('POST', '/import', archive);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const importedWs = response.body.result.id;
  const imported = db.prepare('SELECT * FROM agents WHERE workspace_id=? AND name=?').get(importedWs, agent.name);
  assert.ok(imported);
  assert.equal(imported.working_directory, null); assert.equal(imported.provider_connection_id, null); assert.equal(imported.permission_policy, 'read-only');
  assert.notEqual(imported.default_area_id, area.id); assert.notEqual(imported.default_project_id, project.id);
  assert.equal(db.prepare('SELECT workspace_id FROM teams WHERE id=?').get(imported.default_area_id).workspace_id, importedWs);
  const [packId] = JSON.parse(imported.context_source_ids_json);
  assert.notEqual(packId, 'private-pack');
  assert.equal(db.prepare('SELECT workspace_id FROM workspace_items WHERE id=?').get(packId).workspace_id, importedWs);
  const snapshot = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=?').get(imported.id);
  assert.equal(snapshot.version, 1); assert.equal(JSON.parse(snapshot.snapshot_json).provider_connection_id, null);
  installAgentProfiles(db); installAgentProfiles(db);
  assert.equal(db.prepare('SELECT provider_connection_id FROM agents WHERE id=?').get(imported.id).provider_connection_id, null);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const before = db.prepare('SELECT count(*) count FROM workspaces').get().count;
  archive.data.agents.find(row => row.id === agent.id).context_source_ids = [project.id];
  const invalid = await call('POST', '/import', archive);
  assert.equal(invalid.status, 400);
  assert.equal(db.prepare('SELECT count(*) count FROM workspaces').get().count, before);
});

test('snapshot lookup returns the existing immutable snapshot when called repeatedly', async t => {
  const { db, ws, create } = await fixture(t);
  const agent = await create('/agents', { workspace_id: ws, name: 'History helper', provider: 'custom' }, 'agent');
  const first = snapshotAgentProfile(db, agent.id);
  db.prepare('UPDATE agents SET instructions=? WHERE id=?').run('Unversioned legacy mutation', agent.id);
  const second = snapshotAgentProfile(db, agent.id);
  assert.deepEqual(first, second);
  assert.equal(db.prepare('SELECT count(*) count FROM agent_profile_versions WHERE agent_id=?').get(agent.id).count, 1);
});

test('legacy schema migration binds existing providers once and adds nullable scoped references', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE connections(id TEXT PRIMARY KEY,provider TEXT UNIQUE);
    CREATE TABLE teams(id TEXT PRIMARY KEY);
    CREATE TABLE projects(id TEXT PRIMARY KEY);
    CREATE TABLE runs(id TEXT PRIMARY KEY);
    CREATE TABLE agents(id TEXT PRIMARY KEY,provider TEXT,name TEXT,instructions TEXT,created_at TEXT,updated_at TEXT);
    INSERT INTO connections VALUES('runner','codex');
    INSERT INTO agents VALUES('legacy','codex','Original identity','Original instructions','2026-01-01','2026-01-01');`);
  installAgentProfiles(db);
  const agent = db.prepare('SELECT * FROM agents WHERE id=?').get('legacy');
  assert.equal(agent.provider_connection_id, 'runner'); assert.equal(agent.version, 1);
  assert.equal(agent.name, 'Original identity'); assert.equal(agent.instructions, 'Original instructions');
  assert.deepEqual(JSON.parse(agent.context_source_ids_json), []);
  db.exec("UPDATE agents SET provider_connection_id=NULL WHERE id='legacy'");
  installAgentProfiles(db);
  assert.equal(db.prepare('SELECT provider_connection_id FROM agents WHERE id=?').get('legacy').provider_connection_id, null);
  for (const column of ['provider_connection_id', 'default_area_id', 'default_project_id']) assert.ok(db.prepare('PRAGMA foreign_key_list(agents)').all().some(row => row.from === column));
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

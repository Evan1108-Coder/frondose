import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from '../server/local-api.mjs';
import { installAreas, areaRoute } from '../server/area-service.mjs';
import { createAccessBoundary } from '../server/access-boundary.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rumbo-areas-'));
  const api = createLocalApi({ dataDir: dir, seedMode: 'demo' });
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = async (method, path, body) => { const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }); return { status: res.status, body: await res.json() }; };
  const db = new DatabaseSync(api.dbPath), ws = api.snapshot().workspaces[0].id;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); api.close(); await rm(dir, { recursive: true, force: true }); });
  const area = (await call('POST', '/areas', { workspace_id: ws, name: 'Engineering' })).body.team;
  return { api, db, call, ws, area };
}

test('Areas preserve Team identities, projects, documents, contacts and repeatable migrations', async t => {
  const { db, call, ws, area } = await fixture(t);
  assert.ok(area.id);
  const project = (await call('POST', '/projects', { workspace_id: ws, team_id: area.id, name: 'Preserved project' })).body.project;
  const doc = (await call('POST', '/documents', { workspace_id: ws, team_id: area.id, title: 'Preserved document', content: 'Do not delete' })).body.document;
  const contact = (await call('POST', '/team-members', { workspace_id: ws, team_id: area.id, name: 'Optional contact' })).body.team_member;
  installAreas(db); installAreas(db);
  assert.equal(db.prepare('SELECT team_id FROM projects WHERE id=?').get(project.id).team_id, area.id);
  assert.equal(db.prepare('SELECT content FROM documents WHERE id=?').get(doc.id).content, 'Do not delete');
  assert.equal(db.prepare('SELECT team_id FROM team_members WHERE id=?').get(contact.id).team_id, area.id);
  assert.equal((await call('GET', `/areas/${area.id}`)).body.team.id, area.id);
  assert.equal((await call('GET', `/teams/${area.id}`)).body.team.id, area.id);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('Area instructions and defaults are versioned preferences, never permission grants', async t => {
  const { api, db, call, ws, area } = await fixture(t);
  const path = `/areas/${area.id}/settings`;
  const initial = (await call('GET', path)).body.result;
  assert.equal(initial.version, 0); assert.equal(initial.contacts_enabled, false);
  const agent = (await call('POST', '/agents', { workspace_id: ws, name: 'Builder', provider: 'codex' })).body.agent;
  const result = await call('PATCH', path, { version: 0, instructions: 'Untrusted instructions cannot grant access.', default_agent_ids: [agent.id], allowed_tools: ['read_document'], contacts_enabled: true });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.result.version, 1);
  assert.equal((await call('PATCH', path, { version: 0, instructions: 'Stale' })).status, 409);
  assert.equal((await call('PATCH', path, { version: 1, permission_policy: 'auto' })).status, 400);
  assert.equal((await call('PATCH', path, { version: 1, allowed_tools: ['delete_file'] })).status, 400);
  assert.equal((await call('PATCH', path, { version: 1, grant: true })).status, 400);
  assert.equal(api.snapshot().area_settings.find(a => a.id === area.id).contacts_enabled, true);
  assert.equal(db.prepare("SELECT count(*) n FROM change_log WHERE entity_type='area_settings'").get().n, 1);
});

test('Area defaults reject foreign agents and Context Packs and survive content-only export/import', async t => {
  const { call, ws, area } = await fixture(t);
  const other = (await call('POST', '/workspaces', { name: 'Other scope' })).body.workspace;
  const foreign = (await call('POST', '/agents', { workspace_id: other.id, name: 'Foreign', provider: 'codex' })).body.agent;
  const path = `/areas/${area.id}/settings`;
  assert.equal((await call('PATCH', path, { version: 0, default_agent_ids: [foreign.id] })).status, 400);
  assert.equal((await call('PATCH', path, { version: 0, context_pack_ids: ['missing'] })).status, 400);
  await call('PATCH', path, { version: 0, instructions: 'Reusable Area context', contacts_enabled: true });
  const exported = await call('GET', `/export?workspace_id=${ws}`);
  const archive = exported.body.result || exported.body;
  assert.ok(archive.data.area_settings.some(row => row.id === area.id));
  const imported = await call('POST', '/import', archive);
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  const settings = imported.body.bootstrap.area_settings.find(a => a.workspace_id === imported.body.result.id && a.instructions === 'Reusable Area context');
  assert.ok(settings); assert.notEqual(settings.id, area.id); assert.equal(settings.permission_policy, 'review');
});

test('Area settings inherit the existing restricted Team permission boundary', async t => {
  const { db, ws, area } = await fixture(t);
  const boundary = createAccessBoundary({ db, governance: { explain: (_ws, _actor, _permission, scope) => ({ allowed: scope?.scope_id !== area.id }) } });
  assert.deepEqual(boundary.filter({ area_settings: [{ id: area.id, workspace_id: ws, instructions: 'PRIVATE' }] }, { id: 'local-owner' }).area_settings, []);
});

async function restrictedDefaults(t) {
  const f = await fixture(t), { call, db, ws, area } = f;
  const privateArea = (await call('POST', '/areas', { workspace_id: ws, name: 'Restricted Area' })).body.team;
  const agent = (await call('POST', '/agents', { workspace_id: ws, name: 'Restricted profile', provider: 'codex' })).body.agent;
  const visibleAgent = (await call('POST', '/agents', { workspace_id: ws, name: 'Visible profile', provider: 'codex' })).body.agent;
  const doc = (await call('POST', '/documents', { workspace_id: ws, team_id: privateArea.id, title: 'Restricted source', content: 'Private' })).body.document;
  const packId = 'restricted_pack', stamp = new Date().toISOString();
  db.prepare('INSERT INTO workspace_items(id,workspace_id,kind,name,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(packId, ws, 'context_pack', 'Restricted pack', JSON.stringify({ document_ids: [doc.id], memory_ids: [], content: '' }), stamp, stamp);
  const saved = await call('PATCH', `/areas/${area.id}/settings`, { version: 0, instructions: 'Shared guidance', default_agent_ids: [agent.id, visibleAgent.id], context_pack_ids: [packId] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const boundary = createAccessBoundary({ db, governance: { explain: (_ws, _actor, _permission, scope) => ({ allowed: ![agent.id, privateArea.id].includes(scope?.scope_id) }) } });
  const actor = { id: 'local-owner' };
  return { ...f, agent, visibleAgent, packId, boundary, actor, saved: saved.body.result };
}

test('Area history redacts restricted references from current and historical settings', async t => {
  const { db, area, saved, agent, visibleAgent, packId, boundary, actor } = await restrictedDefaults(t);
  const direct = boundary.filter({ result: saved }, actor).result;
  assert.deepEqual(direct.default_agent_ids, [visibleAgent.id]);
  assert.deepEqual(direct.context_pack_ids, []);
  const raw = db.prepare("SELECT * FROM change_log WHERE entity_type='area_settings' AND entity_id=?").all(area.id);
  const decoded = raw.map(row => ({ ...row, before: row.before_json && JSON.parse(row.before_json), after: JSON.parse(row.after_json), before_json: undefined, after_json: undefined }));
  for (const history of [raw, decoded]) {
    const filtered = boundary.filter({ result: history }, actor).result;
    assert.equal(filtered.length, 1);
    assert.ok(!JSON.stringify(filtered).includes(agent.id));
    assert.ok(!JSON.stringify(filtered).includes(packId));
    assert.ok(JSON.stringify(filtered).includes(visibleAgent.id));
  }
  const inconsistent = structuredClone(decoded[0]); inconsistent.after.workspace_id = 'foreign';
  assert.deepEqual(boundary.filter({ result: [inconsistent] }, actor).result, []);
});

test('Deleting a restricted Area does not expose its historical instructions or audit records', async t => {
  const { db, call, ws, area } = await fixture(t);
  await call('PATCH', `/areas/${area.id}/settings`, { version: 0, instructions: 'PRIVATE AREA INSTRUCTIONS' });
  const boundary = createAccessBoundary({ db, governance: { explain: (_ws, _actor, _permission, scope) => ({ allowed: scope?.scope_id !== area.id }) } });
  const actor = { id: 'local-owner' };
  const history = db.prepare("SELECT * FROM change_log WHERE entity_type='area_settings' AND entity_id=?").all(area.id);
  assert.equal(history.length, 1);
  assert.deepEqual(boundary.filter({ result: history, audit_log: history }, actor), { result: [], audit_log: [] });
  db.exec('PRAGMA foreign_keys=ON');
  db.prepare('DELETE FROM teams WHERE id=?').run(area.id);
  assert.equal(db.prepare('SELECT count(*) n FROM area_settings WHERE id=?').get(area.id).n, 0);
  assert.deepEqual(boundary.filter({ result: history, audit_log: history }, actor), { result: [], audit_log: [] });
  assert.equal(history[0].workspace_id, ws);
});

test('Saving visible Area defaults preserves hidden selections without granting new access', async t => {
  const { db, call, ws, area, saved, agent, visibleAgent, packId, boundary, actor } = await restrictedDefaults(t);
  const visible = boundary.filter({ result: saved }, actor).result;
  let response;
  await areaRoute({ db, req: { method: 'PATCH' }, res: {}, path: `/areas/${area.id}/settings`, body: { version: visible.version, instructions: 'Updated visible guidance', default_agent_ids: [], context_pack_ids: [] }, actor, allowed: boundary.allowed, send: (_res, status, body) => { response = { status, body: boundary.filter(body, actor) }; } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.result.default_agent_ids, []);
  assert.deepEqual(response.body.result.context_pack_ids, []);
  const stored = db.prepare('SELECT * FROM area_settings WHERE id=?').get(area.id);
  assert.deepEqual(JSON.parse(stored.default_agent_ids_json), [agent.id]);
  assert.deepEqual(JSON.parse(stored.context_pack_ids_json), [packId]);
  assert.equal(stored.instructions, 'Updated visible guidance');
  assert.ok(!stored.default_agent_ids_json.includes(visibleAgent.id), 'Visible selections can still be removed deliberately');
  // Existing hidden defaults are retained, but knowing their IDs cannot add them elsewhere.
  const other = (await call('POST', '/areas', { workspace_id: ws, name: 'Another Area' })).body.team;
  await assert.rejects(areaRoute({ db, req: { method: 'PATCH' }, res: {}, path: `/areas/${other.id}/settings`, body: { version: 0, default_agent_ids: [agent.id] }, actor, allowed: boundary.allowed, send: () => {} }), /accessible agent/);
  await assert.rejects(areaRoute({ db, req: { method: 'PATCH' }, res: {}, path: `/areas/${other.id}/settings`, body: { version: 0, context_pack_ids: [packId] }, actor, allowed: boundary.allowed, send: () => {} }), /accessible Context Pack/);
});

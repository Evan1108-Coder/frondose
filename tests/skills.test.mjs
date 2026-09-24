import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from '../server/local-api.mjs';
import { createAccessBoundary } from '../server/access-boundary.mjs';

const definition = { name: 'Summarize evidence', purpose: 'Produce a sourced summary', instructions: 'Summarize {{topic}} with cited evidence.', inputs: [{ name: 'topic', type: 'string', required: true }], required_context: [], allowed_tools: ['read_document'], output_format: 'Markdown with Sources', examples: [{ inputs: { topic: 'Example' }, output: 'An example summary.' }], test_cases: [{ name: 'Simple summary', inputs: { topic: 'Fixture' }, expected_output: 'A cited summary.' }] };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rumbo-skills-')), api = createLocalApi({ dataDir: dir, seedMode: 'demo' });
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const db = new DatabaseSync(api.dbPath), ws = api.snapshot().workspaces[0].id;
  const call = async (method, path, body) => { const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }); return { status: res.status, body: await res.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); api.close(); await rm(dir, { recursive: true, force: true }); });
  const create = async (extra = {}) => { const result = await call('POST', '/skills', { workspace_id: ws, ...definition, ...extra }); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.result; };
  return { api, db, ws, call, create };
}

test('Skill reliability v2 keeps stable case IDs and legacy manual notes cannot publish', async t => {
  const { call, create, ws } = await fixture(t), skill = await create(), path = `/skills/${skill.id}`;
  assert.equal((await call('POST', `${path}/publish`, { version: 1 })).status, 409);
  assert.equal((await call('POST', `${path}/test`, { version: 1, inputs: { topic: 5 }, outcome: 'passed', evidence: 'Not valid' })).status, 400);
  assert.equal((await call('POST', `${path}/test`, { version: 1, inputs: { topic: 'Fixture' }, outcome: 'passed', evidence: '' })).status, 400);
  const evaluation = await call('POST', `${path}/test`, { version: 1, inputs: { topic: 'Fixture' }, outcome: 'passed', evidence: 'Manually checked both source references.', request_id: 'manual-one' });
  assert.equal(evaluation.status, 200, JSON.stringify(evaluation.body)); assert.equal(evaluation.body.result.mode, 'manual');
  assert.equal((await call('POST', `${path}/publish`, { version: 1 })).status, 409);
  const beforeEdit = (await call('GET', path)).body.result;
  assert.equal(beforeEdit.skill.evidence_policy_version, 2); assert.match(beforeEdit.skill.test_cases[0].id, /^case_/);
  const changed = await call('PATCH', path, { version: 1, instructions: 'Revised instructions', request_id: 'revision-one' });
  assert.equal(changed.status, 200); assert.equal(changed.body.result.version, 2); assert.equal(changed.body.result.state, 'draft');
  assert.equal(changed.body.result.test_cases[0].id, beforeEdit.skill.test_cases[0].id);
  const replay = await call('PATCH', path, { version: 1, instructions: 'Revised instructions', request_id: 'revision-one' });
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.equal((await call('PATCH', path, { version: 1, instructions: 'Stale' })).status, 409);
  assert.equal((await call('POST', `${path}/publish`, { version: 2 })).status, 409);
  const detail = (await call('GET', path)).body.result;
  assert.equal(detail.versions.length, 2); assert.equal(detail.versions[1].definition.instructions, definition.instructions);
  assert.equal(detail.test_runs.length, 1); assert.equal(detail.test_runs[0].version_id, detail.versions[1].id);
  assert.equal((await call('GET', `/skills?workspace_id=${ws}`)).body.result.length, 1);
});

test('Skills reject unsafe configuration and cross-workspace context; shared provider profiles are reusable', async t => {
  const { api, call, create, db, ws } = await fixture(t);
  const other = (await call('POST', '/workspaces', { name: 'Other' })).body.workspace;
  const area = (await call('POST', '/areas', { workspace_id: other.id, name: 'Other Area' })).body.team;
  const docResult = await call('POST', '/documents', { workspace_id: other.id, team_id: area.id, title: 'Private', content: 'Never copy' });
  assert.equal(docResult.status, 201, JSON.stringify(docResult.body));
  const doc = docResult.body.document;
  assert.equal((await call('POST', '/skills', { workspace_id: ws, ...definition, required_context: [{ kind: 'document', id: doc.id }] })).status, 400);
  assert.equal((await call('POST', '/skills', { workspace_id: ws, ...definition, approval_policy: 'never' })).status, 400);
  assert.equal((await call('POST', '/skills', { workspace_id: ws, ...definition, allowed_tools: ['delete_everything'] })).status, 400);
  const shared = api.snapshot().agents.find(agent => !agent.workspace_id);
  const skill = await create({ preferred_agent_id: shared.id }); assert.equal(skill.preferred_agent_id, shared.id);
  const boundary = createAccessBoundary({ db, governance: { explain: (_ws, _actor, permission) => ({ allowed: permission !== 'agents.read' }) } });
  assert.deepEqual(boundary.filter({ skills: api.snapshot().skills, skill_versions: api.snapshot().skill_versions, skill_test_runs: [] }, { id: 'local-owner' }).skills, []);
});

test('Completed run conversion creates a sanitized draft without one-off prompts, replies or attachments', async t => {
  const { db, call, ws } = await fixture(t), now = new Date().toISOString();
  db.prepare('INSERT INTO runs(id,workspace_id,provider,agent_name,status,title,prompt,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('fixture_completed', ws, 'codex', 'Fixture', 'completed', 'Private task', 'SECRET ONE-OFF PROMPT', 'mock', now, now);
  const converted = await call('POST', '/skills/from-run', { workspace_id: ws, run_id: 'fixture_completed', name: 'Reusable analysis', purpose: 'Analyze reusable inputs', request_id: 'convert-one' });
  assert.equal(converted.status, 201, JSON.stringify(converted.body)); assert.equal(converted.body.result.instructions, '');
  assert.equal(converted.body.result.state, 'draft'); assert.equal(converted.body.result.provenance.context_copied, false);
  const detail = (await call('GET', `/skills/${converted.body.result.id}`)).body.result;
  assert.ok(!JSON.stringify(detail).includes('SECRET ONE-OFF PROMPT'));
  const replay = await call('POST', '/skills/from-run', { workspace_id: ws, run_id: 'fixture_completed', name: 'Reusable analysis', purpose: 'Analyze reusable inputs', request_id: 'convert-one' });
  assert.equal(replay.body.result.id, converted.body.result.id); assert.equal(replay.body.replayed, true);
  db.prepare('UPDATE runs SET status=? WHERE id=?').run('running', 'fixture_completed');
  assert.equal((await call('POST', '/skills/from-run', { workspace_id: ws, run_id: 'fixture_completed', name: 'No', purpose: 'No' })).status, 400);
});

test('Skills archive/restore preserves version history and requires explicit confirmation', async t => {
  const { call, create } = await fixture(t), skill = await create(), path = `/skills/${skill.id}`;
  assert.equal((await call('PATCH', path, { version: 1, archived_at: new Date().toISOString() })).status, 400);
  const archiveRequest = { version: 1, archived_at: new Date().toISOString(), confirmed: true, request_id: 'archive-once' };
  const archived = await call('PATCH', path, archiveRequest);
  assert.equal(archived.status, 200); assert.ok(archived.body.result.archived_at);
  const replayedArchive = await call('PATCH', path, archiveRequest);
  assert.equal(replayedArchive.status, 200); assert.equal(replayedArchive.body.replayed, true);
  assert.equal((await call('POST', `${path}/test`, { version: 2, inputs: { topic: 'Fixture' }, outcome: 'passed', evidence: 'Observed' })).status, 400);
  const restored = await call('PATCH', path, { version: 2, archived_at: null }); assert.equal(restored.status, 200); assert.equal(restored.body.result.archived_at, null);
  assert.equal((await call('GET', path)).body.result.versions.length, 3);
});

test('Skill export/import remaps versions and evidence but restores drafts without trusted evaluations', async t => {
  const { call, create, ws } = await fixture(t), skill = await create(), path = `/skills/${skill.id}`;
  await call('POST', `${path}/test`, { version: 1, inputs: { topic: 'Fixture' }, outcome: 'passed', evidence: 'Manual test evidence' });
  await call('POST', `${path}/publish`, { version: 1 });
  const archive = (await call('GET', `/export?workspace_id=${ws}`)).body;
  assert.equal(archive.data.skills.length, 1); assert.equal(archive.data.skill_versions.length, 1);
  const imported = await call('POST', '/import', archive); assert.equal(imported.status, 201, JSON.stringify(imported.body));
  const restored = imported.body.bootstrap.skills.find(item => item.workspace_id === imported.body.result.id);
  assert.ok(restored); assert.notEqual(restored.id, skill.id); assert.equal(restored.state, 'draft'); assert.equal(restored.published_version, null);
  const detail = (await call('GET', `/skills/${restored.id}`)).body.result;
  assert.equal(detail.test_runs[0].mode, 'imported'); assert.equal(detail.test_runs[0].evaluator_id, null);
  assert.equal((await call('POST', `/skills/${restored.id}/publish`, { version: restored.version })).status, 409);
});

test('Skill context revocation hides definitions and history; malformed scope produces structured errors', async t => {
  const { api, call, create, db, ws } = await fixture(t);
  const project = api.snapshot().projects.find(item => item.workspace_id === ws);
  const doc = (await call('POST', '/documents', { workspace_id: ws, project_id: project.id, title: 'Scoped source', content: 'Restricted reference' })).body.document;
  const skill = await create({ required_context: [{ kind: 'document', id: doc.id }] });
  const boundary = createAccessBoundary({ db, governance: { explain: (_ws, _actor, _permission, scope) => ({ allowed: scope?.scope_id !== project.id }) } });
  const filtered = boundary.filter(api.snapshot(), { id: 'local-owner' });
  assert.deepEqual(filtered.skills, []); assert.deepEqual(filtered.skill_versions, []);
  const histories = db.prepare("SELECT * FROM change_log WHERE entity_type='skills' AND entity_id=?").all(skill.id);
  assert.deepEqual(boundary.filter({ result: histories }, { id: 'local-owner' }).result, []);
  const missing = await call('POST', '/skills', definition);
  assert.equal(missing.status, 400); assert.equal(missing.body.error.code, 'invalid_scope');
  const invalid = await call('POST', '/skills/from-run', { workspace_id: ws, run_id: {}, name: 'Invalid', purpose: 'Invalid' });
  assert.equal(invalid.status, 400); assert.equal(invalid.body.error.code, 'invalid_scope');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { createLocalApi } from '../server/local-api.mjs';
import { createNativeToolApply } from '../server/native-tool-apply.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-native-apply-'));
  const forbidden = () => { throw new Error('No provider calls in native apply tests.'); };
  const api = createLocalApi({ dataDir: directory, seedMode: 'clean', integrationOptions: { env: {}, execute: forbidden, fetchImpl: forbidden, spawnProcess: forbidden } });
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = async (path, body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result; };
  const workspace = (await call('/workspaces', { name: 'Native apply fixture' })).workspace;
  const project = (await call('/projects', { workspace_id: workspace.id, name: 'Reviewed scope' })).project;
  const agent = (await call('/agents', { workspace_id: workspace.id, provider: 'codex', name: 'Fixture author' })).agent;
  const run = (await call('/runs', { workspace_id: workspace.id, project_id: project.id, agent_id: agent.id, mode: 'mock', scenario: 'manual' })).run;
  const db = new DatabaseSync(api.dbPath);
  db.prepare('INSERT INTO agent_run_sponsors(run_id,actor_id) VALUES(?,?)').run(run.id, 'local-owner');
  t.after(async () => { db.close(); api.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { db, workspace, project, run, apply: createNativeToolApply({ db, allowed: () => true }), actor: { id: 'local-owner', mode: 'local' }, request: { id: 'request-fixture' } };
}

test('reviewed native changes create unassigned backlog Routes, draft knowledge and unaccepted output versions', async t => {
  const f = await fixture(t);
  const route = f.apply.create_draft_route({ ...f, proposal: { project_id: f.project.id, title: 'Proposed route', description: 'Draft only.' } });
  const task = f.db.prepare('SELECT * FROM tasks WHERE id=?').get(route.id);
  assert.equal(task.status, 'backlog'); assert.equal(task.assignee_agent_ids_json, '[]'); assert.equal(route.execution_started, false);
  const memory = f.apply.save_memory_candidate({ ...f, proposal: { title: 'Candidate', content: 'Needs later approval.' } });
  assert.equal(f.db.prepare('SELECT state FROM knowledge_entries WHERE id=?').get(memory.id).state, 'draft');
  const output = f.apply.submit_output({ ...f, proposal: { title: 'Evidence', content: 'EXACT_OUTPUT', kind: 'report' } });
  assert.equal(output.accepted, false); assert.equal(f.db.prepare('SELECT state FROM outputs WHERE id=?').get(output.id).state, 'needs_review');
  assert.equal(f.db.prepare('SELECT content FROM output_versions WHERE id=?').get(output.version_id).content, 'EXACT_OUTPUT');
  assert.equal(f.db.prepare('SELECT count(*) n FROM output_reviews').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM runs').get().n, 1, 'Applying proposals does not start more runs.');
});

test('native apply callbacks preserve standard validation and both sponsor and reviewer permissions', async t => {
  const f = await fixture(t);
  assert.throws(() => f.apply.propose_project_update({ ...f, proposal: { project_id: f.project.id, patch: { local_path: '/tmp' } } }));
  assert.throws(() => f.apply.propose_project_update({ ...f, proposal: { project_id: f.project.id, patch: { status: 'invented' } } }));
  const result = f.apply.propose_project_update({ ...f, proposal: { project_id: f.project.id, patch: { description: 'Reviewed new description', status: 'active' } } });
  assert.equal(result.id, f.project.id); assert.equal(f.db.prepare('SELECT status FROM projects WHERE id=?').get(f.project.id).status, 'active');
  const denied = createNativeToolApply({ db: f.db, allowed: (_ws, actor) => actor.id !== 'local-owner' });
  assert.throws(() => denied.create_draft_route({ ...f, actor: { id: 'reviewer' }, proposal: { title: 'Denied' } }), { statusCode: 403 });
  assert.throws(() => f.apply.create_draft_route({ ...f, actor: { id: f.run.agent_id, mode: 'agent' }, proposal: { title: 'Self approval' } }), { statusCode: 403 });
});

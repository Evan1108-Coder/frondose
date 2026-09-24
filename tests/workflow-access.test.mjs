import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installCoordination, coordinationSnapshot, coordinationRoute } from '../server/coordination-service.mjs';
import { createLocalApi } from '../server/local-api.mjs';
import { createAccessBoundary } from '../server/access-boundary.mjs';
import { createGovernanceService } from '../server/governance-service.mjs';
import { installManualWorkflows, validateManualWorkflowDefinition, manualWorkflowRoute } from '../server/manual-workflow-service.mjs';
import { installWorkspaceFeatures } from '../server/workspace-features.mjs';
import { captureSourceAccess, assertSourceAccess } from '../server/context-source-access.mjs';
import { snapshotAgentProfile } from '../server/agent-profiles.mjs';

function legacyFixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY, archived_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY, workspace_id TEXT, archived_at TEXT);
    INSERT INTO workspaces VALUES('workspace',NULL);
    CREATE TABLE work_plans(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active', steps_json TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO work_plans VALUES('old-plan','workspace',NULL,'Existing plan','active','[]',1,'now','now');`);
  installCoordination(db);
  installWorkspaceFeatures(db);
  db.prepare("INSERT INTO work_plans(id,workspace_id,title,created_at,updated_at,kind) VALUES(?,?,?,?,?,?)").run('workflow', 'workspace', 'Executable workflow', 'now', 'now', 'manual_workflow');
  return db;
}

test('legacy coordination migration preserves old plans and isolates workflow rows in lists and reads', async t => {
  const db = legacyFixture(t);
  installCoordination(db);
  assert.equal(db.prepare('SELECT kind FROM work_plans WHERE id=?').get('old-plan').kind, 'plan');
  assert.deepEqual(coordinationSnapshot(db).work_plans.map(row => row.id), ['old-plan']);
  const result = [];
  await coordinationRoute({ db, req: { method: 'GET' }, path: '/coordination/plans', send: (_res, code, body) => result.push({ code, body }) });
  assert.deepEqual(result[0].body.result.map(row => row.id), ['old-plan']);
  await assert.rejects(coordinationRoute({ db, req: { method: 'GET' }, path: '/coordination/plans/workflow', send() { assert.fail('Workflow leaked through a legacy read'); } }), { statusCode: 404 });
});

test('all legacy plan mutation paths reject workflow IDs without altering workflow state', async t => {
  const db = legacyFixture(t), before = db.prepare('SELECT * FROM work_plans WHERE id=?').get('workflow');
  for (const [method, action] of [['PATCH', ''], ['DELETE', ''], ...['prepare', 'complete', 'link-run', 'reopen'].map(action => ['POST', `/${action}`])]) {
    await assert.rejects(coordinationRoute({ db, req: { method }, path: `/coordination/plans/workflow${action}`, readBody: async () => ({ version: 1, title: 'Changed', kind: 'plan', step_id: 'step', summary: 'Bypass' }), send() { assert.fail('Workflow mutated through a legacy path'); } }), { statusCode: 404 });
  }
  assert.deepEqual(db.prepare('SELECT * FROM work_plans WHERE id=?').get('workflow'), before);
});

test('legacy creation and editing cannot promote an ordinary plan into an executable workflow', async t => {
  const db = legacyFixture(t);
  let created;
  await coordinationRoute({ db, req: { method: 'POST' }, path: '/coordination/plans', readBody: async () => ({ workspace_id: 'workspace', title: 'Manual checklist', kind: 'manual_workflow', steps: [] }), send: (_res, _code, body) => { created = body.result; }, snapshot: coordinationSnapshot });
  assert.equal(created.kind, 'plan');
  await coordinationRoute({ db, req: { method: 'PATCH' }, path: `/coordination/plans/${created.id}`, readBody: async () => ({ version: 1, title: 'Still a checklist', kind: 'manual_workflow' }), send() {}, snapshot: coordinationSnapshot });
  assert.equal(db.prepare('SELECT kind FROM work_plans WHERE id=?').get(created.id).kind, 'plan');
});

async function accessFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-workflow-access-'));
  const forbidden = () => { throw Error('Providers prohibited'); };
  const api = createLocalApi({ dataDir: directory, seedMode: 'demo', integrationOptions: { env: {}, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden } });
  const db = new DatabaseSync(api.dbPath);
  installManualWorkflows(db);
  const governance = createGovernanceService({ db }), access = createAccessBoundary({ db, governance });
  const project = api.snapshot().projects[0], workspaceId = project.workspace_id;
  const member = governance.command(workspaceId, 'local-owner', 'create_member', { name: 'Workflow reader', rank: 'Admin' });
  const actor = { id: member.id };
  t.after(async () => { db.close(); api.close(); await rm(directory, { recursive: true, force: true }); });
  const insert = (table, value) => db.prepare(`INSERT INTO ${table}(${Object.keys(value).join(',')}) VALUES(${Object.keys(value).map(() => '?').join(',')})`).run(...Object.values(value));
  const stamp = new Date().toISOString();
  const definition = { schema_version: 1, inputs: [], steps: [{ id: 'review', name: 'Review', type: 'human_approval', depends_on: [], context_refs: [], config: { prompt: 'Review manually' } }], handoffs: [] };
  insert('work_plans', { id: 'manual-plan', workspace_id: workspaceId, project_id: project.id, title: 'Private workflow', kind: 'manual_workflow', state: 'active', steps_json: '[]', version: 1, current_definition_version: 1, created_at: stamp, updated_at: stamp });
  insert('work_plan_versions', { id: 'manual-version', plan_id: 'manual-plan', workspace_id: workspaceId, number: 1, definition_json: JSON.stringify(definition), definition_hash: 'fixture', created_by: 'local-owner', created_at: stamp });
  insert('work_plan_runs', { id: 'manual-run', plan_id: 'manual-plan', plan_version_id: 'manual-version', workspace_id: workspaceId, project_id: project.id, status: 'ready', inputs_json: '{}', outputs_json: '{}', version: 1, created_by: 'local-owner', created_at: stamp });
  insert('work_plan_step_runs', { id: 'manual-step', run_id: 'manual-run', workspace_id: workspaceId, step_id: 'review', attempt: 1, status: 'waiting_approval', started_at: stamp });
  insert('work_plan_approvals', { id: 'manual-approval', run_id: 'manual-run', step_run_id: 'manual-step', workspace_id: workspaceId, prompt: 'Private gate', status: 'pending', requested_by: 'local-owner', version: 1, created_at: stamp });
  insert('work_plan_audit', { id: 'manual-audit', workspace_id: workspaceId, plan_id: 'manual-plan', run_id: 'manual-run', actor_id: 'local-owner', action: 'fixture', detail_json: '{}', created_at: stamp });
  const snapshot = () => Object.fromEntries(['work_plans', 'work_plan_versions', 'work_plan_runs', 'work_plan_step_runs', 'work_plan_approvals', 'work_plan_audit'].map(table => [table, db.prepare(`SELECT * FROM ${table} WHERE ${table === 'work_plans' ? "kind='manual_workflow'" : '1=1'}`).all()]));
  return { db, governance, access, project, workspaceId, actor, snapshot, definition, insert, stamp };
}

test('manual workflow collections and generic result lists retain their canonical parent scope', async t => {
  const { governance, access, project, workspaceId, actor, snapshot } = await accessFixture(t);
  const data = snapshot();
  const visible = access.filter(data, actor);
  for (const table of Object.keys(data)) assert.equal(visible[table].length, 1, `${table} visible before revocation`);
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: actor.id, permission: 'projects.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Restricted project' });
  const hidden = access.filter(data, actor);
  for (const table of Object.keys(data)) assert.equal(hidden[table].length, 0, `${table} must inherit restricted workflow project`);
  for (const rows of Object.values(data)) assert.deepEqual(access.filter({ result: rows.map(row => ({ ...row, workspace_id: workspaceId, project_id: null, plan_id: 'forged-public-parent' })) }, actor).result, []);
});

test('nested workflow sources are rechecked for snapshots and change/audit history', async t => {
  const { db, governance, access, project, workspaceId, actor, snapshot, definition, insert, stamp } = await accessFixture(t);
  insert('documents', { id: 'workflow-secret-doc', workspace_id: workspaceId, project_id: project.id, title: 'Restricted context', content: 'Private text', created_at: stamp, updated_at: stamp });
  definition.steps[0].context_refs = [{ kind: 'document', id: 'workflow-secret-doc', expected_updated_at: stamp, content_hash: createHash('sha256').update('Private text').digest('hex') }];
  db.prepare('UPDATE work_plan_versions SET definition_json=? WHERE id=?').run(JSON.stringify(validateManualWorkflowDefinition(db, workspaceId, project.id, definition, actor, access.allowed)), 'manual-version');
  const data = snapshot();
  const history = { id: 'history', entity_type: 'work_plans', entity_id: 'manual-plan', workspace_id: workspaceId, before: data.work_plans[0], after: data.work_plans[0] };
  assert.equal(access.filter({ change_log: [history] }, actor).change_log.length, 1);
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: actor.id, permission: 'documents.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Restricted source' });
  for (const [table, rows] of Object.entries(access.filter(data, actor))) assert.equal(rows.length, 0, `${table} source access revoked`);
  assert.deepEqual(access.filter({ change_log: [history], audit_log: [history] }, actor), { change_log: [], audit_log: [] });
});

test('dedicated workflow dispatch requires identity and safe exact namespaces', async t => {
  const { access, actor } = await accessFixture(t), url = new URL('http://localhost');
  for (const path of ['/coordination/workflows', '/coordination/workflows/missing', '/coordination/workflow-runs/missing', '/coordination/workflow-approvals/missing/decide']) {
    assert.doesNotThrow(() => access.check({ actor, path, method: 'POST', url }));
    assert.throws(() => access.check({ actor: null, path, method: 'POST', url }), { statusCode: 403 });
  }
  for (const path of ['/coordination/workflows-impostor', '/coordination/workflow-runs-extra', '/coordination/workflows/%2fprivate']) assert.throws(() => access.check({ actor, path, method: 'POST', url }), { statusCode: 403 });
  assert.deepEqual(access.filter({ work_plan_requests: [{ workspace_id: 'unknown', result_json: 'private retry output' }] }, actor).work_plan_requests, []);
});

test('workflow history retains its original project restriction and missing parents fail closed', async t => {
  const { access, governance, workspaceId, project, actor, snapshot, insert, stamp } = await accessFixture(t);
  insert('projects', { id: 'historic-private-project', workspace_id: workspaceId, identifier: 'OLD', name: 'Old restricted scope', created_at: stamp, updated_at: stamp });
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: actor.id, permission: 'projects.read', effect: 'deny', scope_type: 'project', scope_id: 'historic-private-project', reason: 'Historical restriction' });
  const current = snapshot().work_plans[0];
  assert.equal(current.project_id, project.id);
  const history = { id: 'old-history', workspace_id: workspaceId, entity_type: 'work_plans', entity_id: current.id, before_json: JSON.stringify({ ...current, project_id: 'historic-private-project' }), after_json: JSON.stringify(current) };
  assert.equal(access.filter({ work_plans: [current] }, actor).work_plans.length, 1);
  assert.deepEqual(access.filter({ change_log: [history], audit_log: [history] }, actor), { change_log: [], audit_log: [] });
  assert.deepEqual(access.filter({ change_log: [{ ...history, entity_id: 'missing-plan' }], work_plan_versions: [{ id: 'missing-version', workspace_id: workspaceId, plan_id: current.id }] }, actor), { change_log: [], work_plan_versions: [] });
});

test('a readable Context Pack cannot expose denied nested document references through workflows', async t => {
  const { db, access, governance, workspaceId, project, actor, snapshot, insert, stamp, definition } = await accessFixture(t);
  insert('documents', { id: 'nested-private-doc', workspace_id: workspaceId, project_id: project.id, title: 'Private source', content: 'Restricted', created_at: stamp, updated_at: stamp });
  const payload = JSON.stringify({ document_ids: ['nested-private-doc'], memory_ids: [] });
  insert('workspace_items', { id: 'nested-pack', workspace_id: workspaceId, kind: 'context_pack', name: 'Shared pack', payload_json: payload, position: 0, version: 1, created_at: stamp, updated_at: stamp });
  definition.steps[0].context_refs = [{ kind: 'pack', id: 'nested-pack', expected_updated_at: stamp, content_hash: createHash('sha256').update(payload).digest('hex') }];
  db.prepare('UPDATE work_plan_versions SET definition_json=? WHERE id=?').run(JSON.stringify(validateManualWorkflowDefinition(db, workspaceId, project.id, definition, actor, access.allowed)), 'manual-version');
  assert.equal(access.filter(snapshot(), actor).work_plans.length, 1);
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: actor.id, permission: 'documents.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Nested context restriction' });
  for (const [table, rows] of Object.entries(access.filter(snapshot(), actor))) assert.equal(rows.length, 0, `${table} must honor nested source permission`);
});

test('manual workflow snapshot aliases enforce the same scopes and omit private launch preparation', async t => {
  const { db, access, actor, snapshot, governance, workspaceId, project } = await accessFixture(t);
  db.prepare('UPDATE work_plan_step_runs SET preparation_token_hash=?,context_request_json=?,context_request_hash=? WHERE id=?').run('private-hash', JSON.stringify({ prompt: 'Internal reviewed prompt' }), 'context-fingerprint', 'manual-step');
  const aliases = { work_plans: 'manual_workflows', work_plan_versions: 'manual_workflow_versions', work_plan_runs: 'manual_workflow_runs', work_plan_step_runs: 'manual_workflow_step_runs', work_plan_approvals: 'manual_workflow_approvals' };
  const source = snapshot(), data = Object.fromEntries(Object.entries(aliases).map(([table, key]) => [key, source[table]]));
  const result = access.filter(data, actor);
  for (const key of Object.values(aliases)) assert.equal(result[key].length, 1);
  for (const shape of [result, access.filter({ result: source.work_plan_step_runs }, actor), access.filter({ steps: source.work_plan_step_runs }, actor)]) {
    assert.ok(!JSON.stringify(shape).includes('private-hash'));
    assert.ok(!JSON.stringify(shape).includes('Internal reviewed prompt'));
    assert.ok(!JSON.stringify(shape).includes('context-fingerprint'));
  }
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: actor.id, permission: 'projects.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Revoked' });
  for (const rows of Object.values(access.filter(data, actor))) assert.equal(rows.length, 0);
});

test('safe source edits retain workflow history visibility without granting stale launch authority', async t => {
  const { db, access, actor, snapshot, insert, stamp, definition, workspaceId, project } = await accessFixture(t);
  insert('documents', { id: 'editable-source', workspace_id: workspaceId, project_id: project.id, title: 'Source', content: 'Old content', created_at: stamp, updated_at: stamp });
  definition.steps[0].context_refs = [{ kind: 'document', id: 'editable-source' }];
  const normalized = validateManualWorkflowDefinition(db, workspaceId, project.id, definition, actor, access.allowed);
  db.prepare('UPDATE work_plan_versions SET definition_json=? WHERE id=?').run(JSON.stringify(normalized), 'manual-version');
  db.prepare('UPDATE documents SET content=?,updated_at=? WHERE id=?').run('Edited content', new Date(Date.parse(stamp) + 1000).toISOString(), 'editable-source');
  for (const [table, rows] of Object.entries(access.filter(snapshot(), actor))) assert.equal(rows.length, 1, `${table} remains readable after a safe edit`);
});

test('moving an unchanged workflow source out of a private project does not erase captured history permissions', async t => {
  const { db, access, actor, snapshot, insert, stamp, definition, workspaceId, project, governance } = await accessFixture(t);
  db.prepare('UPDATE work_plans SET project_id=NULL WHERE id=?').run('manual-plan');
  db.prepare('UPDATE work_plan_runs SET project_id=NULL WHERE id=?').run('manual-run');
  insert('documents', { id: 'moved-source', workspace_id: workspaceId, project_id: project.id, title: 'Source from private project', content: 'Sensitive historical text', created_at: stamp, updated_at: stamp });
  definition.steps[0].context_refs = [{ kind: 'document', id: 'moved-source' }];
  const normalized = validateManualWorkflowDefinition(db, workspaceId, null, definition, actor, access.allowed);
  db.prepare('UPDATE work_plan_versions SET definition_json=? WHERE id=?').run(JSON.stringify(normalized), 'manual-version');
  assert.equal(access.filter(snapshot(), actor).work_plans.length, 1);
  insert('projects', { id: 'source-public-project', workspace_id: workspaceId, identifier: 'PUB', name: 'New public scope', created_at: stamp, updated_at: stamp });
  db.prepare('UPDATE documents SET project_id=? WHERE id=?').run('source-public-project', 'moved-source');
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: actor.id, permission: 'documents.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Original source scope revoked' });
  assert.equal(access.filter({ documents: [db.prepare('SELECT * FROM documents WHERE id=?').get('moved-source')] }, actor).documents.length, 1);
  for (const [table, rows] of Object.entries(access.filter(snapshot(), actor))) assert.equal(rows.length, 0, `${table} retains source's original scope`);
});

function provenanceFixture(t, sources) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES('ws');
    CREATE TABLE teams(id TEXT PRIMARY KEY,workspace_id TEXT); INSERT INTO teams VALUES('old-area','ws'),('new-area','ws');
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,team_id TEXT); INSERT INTO projects VALUES('old-project','ws','old-area'),('new-project','ws','new-area');
    CREATE TABLE agents(id TEXT PRIMARY KEY,workspace_id TEXT); INSERT INTO agents VALUES('agent','ws');
    CREATE TABLE runs(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,agent_id TEXT); INSERT INTO runs VALUES('run','ws','old-project','agent');
    CREATE TABLE outputs(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,run_id TEXT); INSERT INTO outputs VALUES('output','ws','old-project','run');
    CREATE TABLE output_versions(id TEXT PRIMARY KEY,workspace_id TEXT,output_id TEXT,content TEXT); INSERT INTO output_versions VALUES('output-version','ws','output','Captured output');
    CREATE TABLE documents(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,content TEXT); INSERT INTO documents VALUES('doc','ws','old-project','Captured document');
    CREATE TABLE workspace_items(id TEXT PRIMARY KEY,workspace_id TEXT,kind TEXT,payload_json TEXT); INSERT INTO workspace_items VALUES('pack','ws','context_pack','{"document_ids":["doc"]}');
    CREATE TABLE context_snapshots(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,sources_json TEXT,content TEXT); INSERT INTO context_snapshots VALUES('snapshot','ws',NULL,'[{"type":"documents","id":"doc"}]','Captured snapshot');
    CREATE TABLE skills(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,version INTEGER); INSERT INTO skills VALUES('skill','ws',NULL,1);
    CREATE TABLE skill_versions(id TEXT PRIMARY KEY,workspace_id TEXT,skill_id TEXT,number INTEGER,definition_json TEXT); INSERT INTO skill_versions VALUES('skill-version','ws','skill',1,'{"required_context":[{"kind":"pack","id":"pack"}],"preferred_agent_id":"agent"}');`);
  const inspection = { manifest: { resolved: { workspace_id: 'ws' }, included: sources } };
  inspection.sourceAccess = captureSourceAccess(db, inspection);
  const assertAllowed = allowed => assertSourceAccess(db, inspection, { id: 'reader' }, allowed);
  return { db, inspection, assertAllowed };
}

test('output-version provenance captures output/run ancestry and historical Area permissions', t => {
  const { db, inspection, assertAllowed } = provenanceFixture(t, [{ kind: 'output_version', id: 'output-version' }]);
  for (const table of ['output_versions', 'outputs', 'runs', 'agents', 'projects', 'teams']) assert.ok(inspection.sourceAccess.sources.some(ref => ref.table === table), table);
  assert.equal(assertAllowed(() => true), true);
  db.exec("UPDATE outputs SET project_id='new-project'; UPDATE runs SET project_id='new-project'; UPDATE projects SET team_id='new-area' WHERE id='old-project';");
  assert.throws(() => assertAllowed((_ws, _actor, permission, at) => !(permission === 'documents.read' && at.scope_type === 'team' && at.scope_id === 'old-area')), { statusCode: 403 });
  db.exec("UPDATE output_versions SET content='Safe changed text'");
  assert.equal(assertAllowed(() => true), true);
});

test('snapshot and Skill provenance traverses nested pack dependencies without confusing dependency scope with ownership', t => {
  const { db, inspection, assertAllowed } = provenanceFixture(t, [{ kind: 'context_snapshot', id: 'snapshot' }, { kind: 'skill_version', id: 'skill-version' }, { kind: 'skill', id: 'skill' }]);
  for (const table of ['context_snapshots', 'skill_versions', 'skills', 'workspace_items', 'documents', 'agents']) assert.ok(inspection.sourceAccess.sources.some(ref => ref.table === table), table);
  assert.deepEqual(inspection.sourceAccess.sources.find(ref => ref.table === 'skills' && !ref.permission_table).scope, {});
  db.exec("UPDATE documents SET project_id='new-project',content='Edited';");
  assert.throws(() => assertAllowed((_ws, _actor, permission, at) => !(permission === 'documents.read' && at.scope_id === 'old-project')), { statusCode: 403 });
  assert.equal(assertAllowed(() => true), true);
  db.exec("UPDATE agents SET workspace_id='another-workspace'");
  assert.throws(() => assertAllowed(() => true), { statusCode: 403 });
});

test('provenance rejects malformed, cyclic and cross-workspace snapshot dependencies', t => {
  const { db } = provenanceFixture(t, []);
  const capture = () => captureSourceAccess(db, { manifest: { resolved: { workspace_id: 'ws' }, included: [{ kind: 'context_snapshot', id: 'snapshot' }] } });
  db.prepare('UPDATE context_snapshots SET sources_json=?').run(JSON.stringify([{ type: 'settings', id: 'secret' }]));
  assert.throws(capture, { statusCode: 403 });
  db.prepare('UPDATE context_snapshots SET sources_json=?').run(JSON.stringify([{ kind: 'context_snapshot', id: 'snapshot' }]));
  assert.throws(capture, { statusCode: 403 });
  db.exec("UPDATE documents SET workspace_id='another-workspace'");
  db.prepare('UPDATE context_snapshots SET sources_json=?').run(JSON.stringify([{ type: 'documents', id: 'doc' }]));
  assert.throws(capture, { statusCode: 403 });
});

test('direct workflow and run detail routes reject revoked nested sources instead of relying on array-only filtering', async t => {
  const { db, access, actor, insert, stamp, definition, workspaceId, project, governance } = await accessFixture(t);
  insert('documents', { id: 'detail-private-doc', workspace_id: workspaceId, project_id: project.id, title: 'Private workflow source', content: 'Private detail', created_at: stamp, updated_at: stamp });
  definition.steps[0].context_refs = [{ kind: 'document', id: 'detail-private-doc' }];
  db.prepare('UPDATE work_plan_versions SET definition_json=? WHERE id=?').run(JSON.stringify(validateManualWorkflowDefinition(db, workspaceId, project.id, definition, actor, access.allowed)), 'manual-version');
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: actor.id, permission: 'documents.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Detail source revoked' });
  for (const path of ['/coordination/workflows/manual-plan', '/coordination/workflow-runs/manual-run']) {
    await assert.rejects(manualWorkflowRoute({ db, req: { method: 'GET' }, path, url: new URL('http://localhost'), body: {}, actor, allowed: access.allowed, filter: data => access.filter(data, actor), send() {} }), { statusCode: 403 }, path);
  }
});

test('successful workflow action retries are idempotent but never bypass newly revoked authority', async t => {
  const { db, access, actor, workspaceId, project, governance } = await accessFixture(t);
  const body = { action: 'decide_approval', version: 1, approval_id: 'manual-approval', decision: 'approved', note: 'Reviewed', idempotency_key: 'approval-retry' };
  const request = async () => {
    let result;
    await manualWorkflowRoute({ db, req: { method: 'POST' }, path: '/coordination/workflow-runs/manual-run/actions', url: new URL('http://localhost'), body, actor, allowed: access.allowed, filter: value => access.filter(value, actor), send: (_res, status, value) => { result = { status, value }; } });
    return result;
  };
  const first = await request(); assert.equal(first.status, 201);
  const repeated = await request(); assert.equal(repeated.status, 200); assert.equal(repeated.value.replayed, true); assert.deepEqual(repeated.value.result, first.value.result);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM work_plan_audit WHERE action='approval.approved'").get().count, 1);
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: actor.id, permission: 'agents.write', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Approval authority revoked' });
  await assert.rejects(request(), { statusCode: 403 });
});

test('imported or unattributed output review rows cannot authorize publishing approved workflow memory', async t => {
  const { db, access, actor, workspaceId, project, definition, insert, stamp } = await accessFixture(t);
  insert('outputs', { id: 'imported-output', workspace_id: workspaceId, project_id: project.id, title: 'Imported output', kind: 'document', state: 'needs_review', created_at: stamp, updated_at: stamp });
  insert('output_versions', { id: 'imported-output-version', output_id: 'imported-output', workspace_id: workspaceId, number: 1, content: 'Imported text has not been reviewed here', author_name: 'Imported author', created_at: stamp });
  insert('output_reviews', { id: 'imported-review', output_id: 'imported-output', workspace_id: workspaceId, version_id: 'imported-output-version', decision: 'approved', reviewer_name: 'Unverified imported reviewer', feedback: '', created_at: stamp });
  definition.steps.push({ id: 'publish', name: 'Publish knowledge', type: 'tool', depends_on: ['review'], context_refs: [], config: { tool: 'finalize_approved_knowledge', source_step_id: 'review', kind: 'fact', title: 'Approved knowledge' } });
  db.prepare('UPDATE work_plan_versions SET definition_json=? WHERE id=?').run(JSON.stringify(validateManualWorkflowDefinition(db, workspaceId, project.id, definition, actor, access.allowed)), 'manual-version');
  db.prepare("UPDATE work_plan_step_runs SET status='completed',output_id=?,output_version_id=? WHERE id=?").run('imported-output', 'imported-output-version', 'manual-step');
  const before = db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries').get().count;
  await assert.rejects(manualWorkflowRoute({ db, req: { method: 'POST' }, path: '/coordination/workflow-runs/manual-run/actions', url: new URL('http://localhost'), body: { action: 'finalize_memory', step_id: 'publish', version: 1, idempotency_key: 'unverified-review' }, actor, allowed: access.allowed, filter: value => access.filter(value, actor), send() {} }), error => [403, 409].includes(error.statusCode));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries').get().count, before);
});

test('dynamic handoff preparation replay and run reads recheck frozen source permissions after revocation', async t => {
  const { db, access, actor, workspaceId, project, definition, insert, stamp, governance } = await accessFixture(t);
  const template = db.prepare('SELECT * FROM agents LIMIT 1').get();
  insert('agents', { ...template, id: 'handoff-agent', workspace_id: workspaceId, name: 'Isolated handoff agent', working_directory: '', archived_at: null });
  const profile = snapshotAgentProfile(db, 'handoff-agent');
  insert('outputs', { id: 'handoff-output', workspace_id: workspaceId, project_id: project.id, title: 'Private handoff', kind: 'document', created_at: stamp, updated_at: stamp });
  insert('output_versions', { id: 'handoff-version', output_id: 'handoff-output', workspace_id: workspaceId, number: 1, content: 'PRIVATE_DYNAMIC_HANDOFF_TEXT', author_name: 'Fixture', created_at: stamp });
  definition.steps.push({ id: 'consume', name: 'Consume handoff', type: 'agent', depends_on: ['review'], context_refs: [], config: { agent_id: 'handoff-agent', profile_version: profile.version, permission_mode: 'read-only', include_memory: false } });
  definition.handoffs = [{ from: 'review', to: 'consume', output: 'result', required: true }];
  db.prepare('UPDATE work_plan_versions SET definition_json=? WHERE id=?').run(JSON.stringify(validateManualWorkflowDefinition(db, workspaceId, project.id, definition, actor, access.allowed)), 'manual-version');
  db.prepare("UPDATE work_plan_step_runs SET status='completed',output_id=?,output_version_id=? WHERE id=?").run('handoff-output', 'handoff-version', 'manual-step');
  const body = { action: 'prepare_step', step_id: 'consume', version: 1, idempotency_key: 'dynamic-handoff-retry' };
  const call = async (method = 'POST') => {
    let result;
    await manualWorkflowRoute({ db, req: { method }, path: `/coordination/workflow-runs/manual-run${method === 'POST' ? '/actions' : ''}`, url: new URL('http://localhost'), body: method === 'POST' ? body : {}, actor, allowed: access.allowed, filter: value => access.filter(value, actor), send: (_res, status, value) => { result = { status, value }; } });
    return result;
  };
  const prepared = await call(); assert.equal(prepared.status, 201);
  assert.ok(JSON.stringify(prepared.value.result.context_inspection_request.attachments).includes('PRIVATE_DYNAMIC_HANDOFF_TEXT'));
  const repeated = await call(); assert.equal(repeated.status, 200); assert.equal(repeated.value.replayed, true);
  const attempt = db.prepare("SELECT * FROM work_plan_step_runs WHERE step_id='consume'").get();
  assert.ok(JSON.parse(attempt.prepared_source_access_json).sources.some(ref => ref.table === 'output_versions' && ref.id === 'handoff-version'));
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: actor.id, permission: 'documents.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Dynamic handoff access revoked' });
  await assert.rejects(call(), { statusCode: 403 }, 'Replay must not return cached private attachment text.');
  await assert.rejects(call('GET'), { statusCode: 403 }, 'Run details must obey captured dynamic handoff access.');
});

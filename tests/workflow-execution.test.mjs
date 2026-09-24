import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from '../server/local-api.mjs';
import { featureWorkflowDefinition } from '../src/lib/manual-workflows.js';
import { assertSourceAccess } from '../server/context-source-access.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-workflow-execution-'));
  const fake = { launches: [], hold: false, killed: 0 };
  const api = createLocalApi({ dataDir: directory, seedMode: 'clean', integrationOptions: {
    env: {}, fetchImpl: () => { throw new Error('No real provider network in Workflow tests.'); },
    execute: async (_command, args) => ({ stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '', code: 0 }),
    spawnProcess: (_command, _args) => {
      const child = new EventEmitter(); for (const stream of ['stdin', 'stdout', 'stderr']) child[stream] = new EventEmitter();
      child.kill = () => { fake.killed += 1; queueMicrotask(() => child.emit('close', 1)); };
      child.stdin.end = prompt => {
        fake.launches.push(prompt);
        if (!fake.hold) queueMicrotask(() => { child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Injected Workflow result; test evidence only.' } })}\n`)); child.emit('close', 0); });
      };
      return child;
    },
  } });
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = async (path, body, expected = body ? 201 : 200, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`); return result;
  };
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const workspace = (await call('/workspaces', { name: 'Isolated Workflow' })).workspace;
  const project = (await call('/projects', { workspace_id: workspace.id, name: 'Fixture project', local_path: directory })).project;
  const agents = [];
  for (const role of ['researcher', 'planner', 'builder', 'reviewer']) agents.push((await call('/agents', { workspace_id: workspace.id, name: role, role, provider: 'codex', permission_policy: 'read-only' })).agent);
  await call('/connections/codex/connect', { method: 'existing' }, 200);
  const definition = featureWorkflowDefinition({ roles: Object.fromEntries(agents.map(agent => [agent.role, agent.id])), agents });
  const workflow = (await call('/coordination/workflows', { workspace_id: workspace.id, project_id: project.id, title: 'Reviewed feature', definition, idempotency_key: 'definition' })).result;
  const run = (await call(`/coordination/workflows/${workflow.id}/runs`, { inputs: { feature_request: 'Build a bounded fixture.' }, idempotency_key: 'start' })).result;
  const getRun = async () => (await call(`/coordination/workflow-runs/${run.id}`)).result;
  let request = 0;
  const action = async (action, extra = {}, expected = 201) => {
    const latest = await getRun();
    return (await call(`/coordination/workflow-runs/${run.id}/actions`, { action, version: latest.version, idempotency_key: `action-${++request}`, ...extra }, expected)).result;
  };
  const launch = async prepared => {
    const inspection = (await call('/context/inspect', prepared.context_inspection_request)).result;
    const db = new DatabaseSync(api.dbPath, { readOnly: true });
    try {
      const reserved = JSON.parse(db.prepare('SELECT context_request_json FROM work_plan_step_runs WHERE id=?').get(prepared.step_run.id).context_request_json);
      const normalized = JSON.parse(db.prepare('SELECT input_json FROM run_context_inspections WHERE id=?').get(inspection.id).input_json);
      assert.deepEqual(Object.fromEntries(Object.keys(reserved).map(key => [key, normalized[key] ?? null])), reserved, 'Preparation must match canonical context normalization.');
    } finally { db.close(); }
    const launched = await call('/runs', { ...prepared.run_request, context_inspection_id: inspection.id });
    assert.equal(fake.launches.at(-1), inspection.finalPrompt);
    return launched.run;
  };
  return { api, fake, call, workspace, project, agents, workflow, run, getRun, action, launch };
}

test('manual feature Workflow executes four injected runs, exact handoffs, human gates and reviewed memory', async t => {
  const f = await fixture(t); const outputs = new Map();
  assert.equal(f.fake.launches.length, 0, 'Creating a workflow never launches work.');
  await f.action('prepare_step', { step_id: 'builder' }, 409);
  const executeStep = async id => {
    const prepared = await f.action('prepare_step', { step_id: id });
    const before = f.fake.launches.length; assert.ok(prepared.context_inspection_request);
    const run = await f.launch(prepared); assert.equal(f.fake.launches.length, before + 1);
    const output = (await f.call('/workflow/outputs', { workspace_id: f.workspace.id, project_id: f.project.id, run_id: run.id, title: `${id} result`, content: `${id.toUpperCase()}_EXACT_VERSION`, reviewer_name: 'Fixture human' })).result;
    const version = f.api.snapshot().output_versions.find(item => item.output_id === output.id);
    outputs.set(id, { output, version });
    await f.action('reconcile_step', { step_id: id, output_ref: { output_id: output.id, version_id: version.id } });
    return run;
  };
  await executeStep('researcher');
  await executeStep('planner'); assert.match(f.fake.launches.at(-1), /RESEARCHER_EXACT_VERSION/);
  let gate = await f.action('prepare_step', { step_id: 'plan_gate' });
  await f.action('prepare_step', { step_id: 'builder' }, 409);
  await f.action('decide_approval', { step_id: 'plan_gate', approval_id: gate.approval.id, decision: 'approved', note: 'Plan checked.' });
  await executeStep('builder'); assert.match(f.fake.launches.at(-1), /PLANNER_EXACT_VERSION/);
  await executeStep('reviewer'); assert.match(f.fake.launches.at(-1), /BUILDER_EXACT_VERSION/);
  const builder = outputs.get('builder');
  await f.call(`/workflow/outputs/${builder.output.id}/review`, { version: builder.output.version, version_id: builder.version.id, reviewer_name: 'Fixture human', decision: 'approved' }, 200);
  gate = await f.action('prepare_step', { step_id: 'output_gate' });
  await f.action('decide_approval', { step_id: 'output_gate', approval_id: gate.approval.id, decision: 'approved', note: 'Exact version accepted.' });
  const final = await f.action('finalize_memory', { step_id: 'memory' });
  assert.equal(final.knowledge.content, 'BUILDER_EXACT_VERSION');
  assert.equal(final.run.status, 'completed'); assert.equal(f.fake.launches.length, 4);
  assert.equal((await f.getRun()).steps.length, 7);
});

test('Workflow binding rejects changed reviewed input and duplicate launches; cancellation stops the bound process', async t => {
  const f = await fixture(t); f.fake.hold = true;
  const prepared = await f.action('prepare_step', { step_id: 'researcher' });
  const tampered = { ...prepared.context_inspection_request, prompt: 'Replace the reviewed workflow instruction.' };
  const wrong = (await f.call('/context/inspect', tampered)).result;
  await f.call('/runs', { ...prepared.run_request, prompt: tampered.prompt, context_inspection_id: wrong.id }, 409);
  assert.equal(f.fake.launches.length, 0); assert.equal(f.api.snapshot().runs.length, 0);
  const bound = await f.launch(prepared);
  const before = f.fake.launches.length;
  await f.call('/runs', { ...prepared.run_request, mode: 'mock' }, 400);
  await f.action('prepare_step', { step_id: 'researcher' }, 409);
  assert.equal(f.fake.launches.length, before);
  const cancelled = await f.action('cancel_run');
  assert.equal(cancelled.run.status, 'cancelled'); assert.ok(f.fake.killed > 0);
  assert.equal(f.api.snapshot().runs.find(item => item.id === bound.id).status, 'stopped');
});

test('workspace restore remaps Workflow definitions and imports them paused without execution authority', async t => {
  const f = await fixture(t);
  const archive = await f.call(`/export?workspace_id=${f.workspace.id}`);
  assert.equal(archive.data.manual_workflows.length, 1);
  for (const key of ['manual_workflow_runs', 'manual_workflow_step_runs', 'manual_workflow_approvals']) assert.equal(archive.data[key], undefined);
  const restored = (await f.call('/import', archive)).result;
  const imported = f.api.snapshot().manual_workflows.find(item => item.workspace_id === restored.id);
  assert.ok(imported); assert.equal(imported.state, 'paused'); assert.notEqual(imported.id, f.workflow.id);
  const version = f.api.snapshot().manual_workflow_versions.find(item => item.plan_id === imported.id);
  const profile = f.api.snapshot().agents.find(item => item.id === version.definition.steps[0].config.agent_id);
  assert.equal(profile.workspace_id, restored.id); assert.equal(profile.provider_connection_id, null);
  assert.equal(version.definition.steps[0].config.profile_version, profile.version);
  await f.call(`/coordination/workflows/${imported.id}/runs`, { inputs: { feature_request: 'Cannot run automatically.' }, idempotency_key: 'no-authority' }, 409);
  assert.equal(f.fake.launches.length, 0);
});

test('canonical Workflow context retains the original access scope of text attachments copied from documents', async t => {
  const f = await fixture(t), agent = f.agents[0];
  const document = (await f.call('/documents', { workspace_id: f.workspace.id, project_id: f.project.id, title: 'Scoped evidence', content: 'PRIVATE_WORKFLOW_CONTEXT' })).document;
  const workflow = (await f.call('/coordination/workflows', { workspace_id: f.workspace.id, title: 'Scoped handoff', idempotency_key: 'scoped-definition', definition: {
    inputs: [], steps: [{ id: 'read', name: 'Read evidence', type: 'agent', description: 'Inspect the selected evidence.', config: { agent_id: agent.id, profile_version: agent.version, work_mode: 'conversation', permission_mode: 'read-only' }, context_refs: [{ kind: 'document', id: document.id }] }],
  } })).result;
  const instance = (await f.call(`/coordination/workflows/${workflow.id}/runs`, { inputs: {}, idempotency_key: 'scoped-run' })).result;
  const prepared = (await f.call(`/coordination/workflow-runs/${instance.id}/actions`, { action: 'prepare_step', step_id: 'read', version: instance.version, idempotency_key: 'scoped-prepare' })).result;
  const run = await f.launch(prepared);
  const movedProject = (await f.call('/projects', { workspace_id: f.workspace.id, name: 'Later public project' })).project;
  const db = new DatabaseSync(f.api.dbPath);
  try {
    const inspection = JSON.parse(db.prepare('SELECT inspection_json FROM run_context_snapshots WHERE run_id=?').get(run.id).inspection_json);
    assert.match(inspection.finalPrompt, /PRIVATE_WORKFLOW_CONTEXT/);
    assert.ok(inspection.sourceAccess.sources.some(item => item.table === 'documents' && item.id === document.id));
    db.prepare('UPDATE documents SET project_id=? WHERE id=?').run(movedProject.id, document.id);
    const allowed = (_workspace, _actor, permission, scope) => !(permission === 'documents.read' && scope.scope_type === 'project' && scope.scope_id === f.project.id);
    assert.throws(() => assertSourceAccess(db, inspection, { id: 'local-owner' }, allowed), { statusCode: 403 });
  } finally { db.close(); }
});

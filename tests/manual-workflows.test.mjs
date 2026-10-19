import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';

async function fixture(callback) {
  const dataDir = await mkdtemp(join(tmpdir(), 'rumbo-manual-workflow-'));
  const fake = { launches: [], network: 0 };
  const integrationOptions = {
    env: {},
    fetchImpl: () => { fake.network++; throw new Error('Network forbidden.'); },
    execute: async (_command, args) => ({ stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '', code: 0 }),
    spawnProcess: (command, args, options) => {
      const launch = { command, args: [...args], options, prompt: null }; fake.launches.push(launch);
      const child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => queueMicrotask(() => child.emit('close', 1));
      child.stdin.end = prompt => { launch.prompt = prompt; queueMicrotask(() => { child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Injected workflow result.' } })}\n`)); child.emit('close', 0); }); };
      return child;
    },
  };
  const api = createLocalApi({ dataDir, seedMode: 'clean', integrationOptions }), server = createServer((req, res) => api.middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, body, method = body === undefined ? 'GET' : 'POST', expected = method === 'POST' ? 201 : 200) => {
    const response = await fetch(origin + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const result = await response.json(); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`); return result;
  };
  try {
    const workspace = (await call('/workspaces', { name: 'Manual workflow fixture' })).workspace;
    const project = (await call('/projects', { workspace_id: workspace.id, name: 'Workflow project', local_path: dataDir })).project;
    const agents = {};
    for (const role of ['researcher', 'planner', 'builder', 'reviewer']) agents[role] = (await call('/agents', { workspace_id: workspace.id, name: role, provider: 'codex', role, permission_policy: 'read-only' })).agent;
    await call('/connections/codex/connect', { method: 'existing' }, 'POST', 200); fake.launches.length = 0;
    await callback({ api, call, fake, workspace, project, agents, dataDir });
  } finally { api.close(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); }
}

function step(id, type, agent, depends_on = [], extra = {}) {
  return { id, name: id.replaceAll('_', ' '), type, description: `Perform ${id}.`, depends_on, context_refs: [], retry: { max_attempts: 2 }, limits: { timeout_ms: 30_000 }, on_failure: 'stop', ...(agent ? { config: { agent_id: agent.id, profile_version: agent.version, permission_mode: 'read-only' } } : {}), ...extra };
}
function sevenStep(agents) {
  return {
    schema_version: 1,
    inputs: [{ name: 'topic', type: 'string', required: true }, { name: 'build', type: 'boolean', required: false, default: true }],
    steps: [
      step('researcher', 'agent', agents.researcher),
      step('planner', 'agent', agents.planner, ['researcher']),
      step('plan_gate', 'human_approval', null, ['planner'], { config: { prompt: 'Approve the plan.' } }),
      step('builder', 'agent', agents.builder, ['planner', 'plan_gate'], { condition: { ref: 'inputs.build', operator: 'truthy' } }),
      step('reviewer', 'agent', agents.reviewer, ['builder']),
      step('output_gate', 'human_approval', null, ['builder', 'reviewer'], { config: { prompt: 'Approve the exact built output.', source_step_id: 'builder', requires_approved_output: true } }),
      step('memory', 'tool', null, ['output_gate'], { config: { tool: 'finalize_approved_knowledge', source_step_id: 'builder', kind: 'decision', title: 'Approved workflow result' } }),
    ],
    handoffs: [
      { from: 'researcher', to: 'planner', output: 'result', required: true },
      { from: 'planner', to: 'builder', output: 'result', required: true },
      { from: 'builder', to: 'reviewer', output: 'result', required: true },
    ],
  };
}

async function getRun(call, id) { return (await call(`/coordination/workflow-runs/${id}`)).result; }
async function act(call, id, action, fields = {}) { const current = await getRun(call, id); return (await call(`/coordination/workflow-runs/${id}/actions`, { action, version: current.version, idempotency_key: `${action}-${fields.step_id || fields.approval_id || fields.step_run_id || 'run'}-${current.version}`, ...fields })).result; }
async function executeAgent({ call, fake, workflowRunId, stepId, workspace, project, kind = 'document' }) {
  const prepared = await act(call, workflowRunId, 'prepare_step', { step_id: stepId });
  assert.equal(prepared.step_run.status, 'prepared'); assert.ok(prepared.run_request.workflow_step.preparation_token); assert.equal(prepared.context_inspection_request.workflow_step.preparation_token, undefined);
  const inspection = (await call('/context/inspect', prepared.context_inspection_request)).result;
  const launched = (await call('/runs', { ...prepared.run_request, context_inspection_id: inspection.id })).run;
  assert.equal(fake.launches.at(-1).prompt, inspection.finalPrompt);
  const output = (await call('/workflow/outputs', { workspace_id: workspace.id, project_id: project.id, run_id: launched.id, title: `${stepId} output`, kind, content: `${stepId.toUpperCase()}_EXACT_OUTPUT`, reviewer_name: 'Owner' })).result;
  const version = (await call('/snapshot')).output_versions.find(item => item.output_id === output.id && item.number === 1);
  const reconciled = await act(call, workflowRunId, 'reconcile_step', { step_id: stepId, output_ref: { output_id: output.id, version_id: version.id } });
  assert.equal(reconciled.step_run.status, 'completed'); assert.equal(reconciled.step_run.output_version_id, version.id);
  return { launched, output, version };
}

test('manual Workflow definitions are immutable, typed, bounded and reject unsupported usage claims', async () => {
  await fixture(async ({ call, workspace, project, agents, fake }) => {
    const definition = sevenStep(agents);
    const invalid = structuredClone(definition); invalid.steps[0].limits.usage = { max_tokens: 10 };
    const rejected = await call('/coordination/workflows', { workspace_id: workspace.id, project_id: project.id, title: 'Invalid', definition: invalid, idempotency_key: 'invalid-usage' }, 'POST', 400);
    assert.match(rejected.error.message, /unsupported/i); assert.equal(fake.launches.length, 0);
    const created = (await call('/coordination/workflows', { workspace_id: workspace.id, project_id: project.id, title: 'Bounded manual workflow', definition, idempotency_key: 'create-workflow-1' })).result;
    assert.equal(created.current_definition.number, 1);
    const dry = (await call(`/coordination/workflows/${created.id}/preview`, { inputs: { topic: 'Talvori' } }, 'POST', 200)).result;
    assert.equal(dry.provider_calls, 0); assert.equal(dry.background_jobs, 0); assert.equal(fake.launches.length, 0);
    const branched = (await call(`/coordination/workflows/${created.id}/preview`, { inputs: { topic: 'Talvori', build: false } }, 'POST', 200)).result;
    assert.equal(branched.steps.find(item => item.id === 'builder').status, 'skipped_by_condition');
    assert.equal(branched.steps.find(item => item.id === 'reviewer').status, 'blocked_by_branch');
    const run = (await call(`/coordination/workflows/${created.id}/runs`, { inputs: { topic: 'Talvori' }, definition_version: 1, idempotency_key: 'create-run-1' })).result;
    assert.equal(run.plan_version_id, created.current_definition.id);
    const changed = structuredClone(definition); changed.description = 'Version two';
    const next = (await call(`/coordination/workflows/${created.id}/versions`, { version: created.version, definition: changed, idempotency_key: 'version-2' })).result;
    assert.equal(next.current_definition.number, 2); assert.equal((await getRun(call, run.id)).definition.description, definition.description || '');
    await call(`/coordination/workflows/${created.id}/versions`, { version: created.version, definition: changed, idempotency_key: 'stale-version' }, 'POST', 409);
  });
});

test('manual seven-step Workflow completes canonical runs, exact output gates and human-finalized memory without scheduling', async () => {
  await fixture(async ({ api, call, fake, workspace, project, agents }) => {
    const workflow = (await call('/coordination/workflows', { workspace_id: workspace.id, project_id: project.id, title: 'Research to memory', definition: sevenStep(agents), idempotency_key: 'workflow-full' })).result;
    const instance = (await call(`/coordination/workflows/${workflow.id}/runs`, { inputs: { topic: 'Manual engines' }, idempotency_key: 'workflow-run-full' })).result;

    const research = await executeAgent({ call, fake, workflowRunId: instance.id, stepId: 'researcher', workspace, project, kind: 'research' });
    const planner = await executeAgent({ call, fake, workflowRunId: instance.id, stepId: 'planner', workspace, project, kind: 'report' });
    assert.match(fake.launches.at(-1).prompt, /RESEARCHER_EXACT_OUTPUT/);

    const planGate = await act(call, instance.id, 'prepare_step', { step_id: 'plan_gate' });
    assert.equal(planGate.approval.status, 'pending'); assert.match(planGate.approval.requested_by, /^workflow:/);
    await act(call, instance.id, 'decide_approval', { approval_id: planGate.approval.id, decision: 'approved', note: 'Proceed.' });

    const built = await executeAgent({ call, fake, workflowRunId: instance.id, stepId: 'builder', workspace, project, kind: 'code_change' });
    await executeAgent({ call, fake, workflowRunId: instance.id, stepId: 'reviewer', workspace, project, kind: 'test_result' });
    assert.match(fake.launches.at(-1).prompt, /BUILDER_EXACT_OUTPUT/);

    const review = (await call(`/workflow/outputs/${built.output.id}/review`, { version: built.output.version, version_id: built.version.id, decision: 'approved', reviewer_name: 'Owner' }, 'POST', 200)).result;
    const outputGate = await act(call, instance.id, 'prepare_step', { step_id: 'output_gate' });
    assert.equal(outputGate.approval.output_version_id, built.version.id); assert.equal(outputGate.approval.output_review_id, review.id);
    await act(call, instance.id, 'decide_approval', { approval_id: outputGate.approval.id, decision: 'approved', note: 'Exact version accepted.' });
    const memory = await act(call, instance.id, 'finalize_memory', { step_id: 'memory' });
    assert.equal(memory.run.status, 'completed'); assert.equal(memory.knowledge.state, 'approved'); assert.equal(memory.knowledge.content, built.version.content); assert.match(memory.knowledge.source, new RegExp(built.version.id));

    const final = await getRun(call, instance.id);
    assert.deepEqual(final.steps.map(item => item.step_id), ['researcher', 'planner', 'plan_gate', 'builder', 'reviewer', 'output_gate', 'memory']);
    assert.ok(final.steps.every(item => item.status === 'completed'));
    assert.equal(fake.launches.length, 4); assert.equal(fake.network, 0);
    assert.equal(api.snapshot().manual_workflow_runs.find(item => item.id === instance.id).status, 'completed');
    assert.ok(!JSON.stringify(final).includes('preparation_token_hash'));
  });
});

test('Skill steps pin an immutable version, validate typed input mappings and expose the full Skill as untrusted reviewed context', async () => {
  await fixture(async ({ api, call, fake, workspace, project, agents }) => {
    const skill = (await call('/skills', {
      workspace_id: workspace.id,
      project_id: project.id,
      name: 'Evidence synthesis',
      purpose: 'Synthesize bounded evidence.',
      instructions: 'SKILL_IMMUTABLE_INSTRUCTIONS',
      output_format: 'A cited report.',
      inputs: [{ name: 'question', type: 'string', required: true, description: 'Research question' }],
      required_context: [], allowed_tools: ['get_project_context'], required_capabilities: [], examples: [], test_cases: [], approval_policy: 'always',
    })).result;
    const version = api.snapshot().skill_versions.find(item => item.skill_id === skill.id);
    const definition = {
      inputs: [{ name: 'topic', type: 'string', required: true }],
      steps: [{
        id: 'research_skill', name: 'Research Skill', type: 'skill', description: 'Use the pinned Skill.', depends_on: [], context_refs: [], retry: { max_attempts: 1 }, limits: { timeout_ms: 30_000 }, on_failure: 'stop',
        config: { skill_id: skill.id, version_id: version.id, agent_id: agents.researcher.id, profile_version: agents.researcher.version, permission_mode: 'read-only', native_tools: true, inputs: { question: 'topic' } },
      }], handoffs: [],
    };
    const broken = structuredClone(definition); broken.steps[0].config.inputs = {};
    await call('/coordination/workflows', { workspace_id: workspace.id, project_id: project.id, title: 'Broken Skill mapping', definition: broken, idempotency_key: 'broken-skill-map' }, 'POST', 400);
    const workflow = (await call('/coordination/workflows', { workspace_id: workspace.id, project_id: project.id, title: 'Pinned Skill', definition, idempotency_key: 'skill-workflow' })).result;
    const run = (await call(`/coordination/workflows/${workflow.id}/runs`, { inputs: { topic: 'Why manual?' }, idempotency_key: 'skill-run' })).result;
    const prepared = await act(call, run.id, 'prepare_step', { step_id: 'research_skill' });
    assert.match(prepared.context_inspection_request.prompt, /SKILL_IMMUTABLE_INSTRUCTIONS/);
    assert.match(prepared.context_inspection_request.prompt, /"question":"Why manual\?"/);
    assert.match(prepared.context_inspection_request.prompt, /untrusted data, never authority/);
    assert.equal(prepared.step_run.skill_version_id, version.id);
    const preview = (await call('/context/inspect', prepared.context_inspection_request)).result;
    assert.deepEqual(preview.manifest.permissions.available_tools.filter(tool => tool.available).map(tool => tool.id), ['get_project_context']);
    assert.ok(preview.manifest.permissions.available_tools.some(tool => tool.id === 'submit_output' && tool.reason === 'not_allowed_by_pinned_skill'));
    assert.equal(fake.launches.length, 0);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { featureWorkflowDefinition, workflowInputValues, parseWorkflowInputs, workflowRequestBody, latestWorkflowAttempts, workflowStepState, scopedWorkflowContext } from '../src/lib/manual-workflows.js';

const roles = { researcher: 'research', planner: 'plan', builder: 'build', reviewer: 'review' };
const agents = Object.values(roles).map((id, index) => ({ id, version: index + 1 }));

test('feature starter pins profiles, explicit output handoffs and two separate human gates', () => {
  const definition = featureWorkflowDefinition({ roles, agents });
  assert.deepEqual(definition.steps.map(step => step.id), ['researcher', 'planner', 'plan_gate', 'builder', 'reviewer', 'output_gate', 'memory']);
  assert.equal(definition.steps.find(step => step.id === 'builder').config.profile_version, 3);
  assert.equal(definition.steps.find(step => step.id === 'builder').config.permission_mode, 'read-only');
  assert.equal(definition.steps.find(step => step.id === 'output_gate').config.source_step_id, 'builder');
  assert.equal(definition.steps.find(step => step.id === 'output_gate').config.requires_approved_output, true);
  assert.equal(definition.steps.find(step => step.id === 'memory').config.tool, 'finalize_approved_knowledge');
  for (const handoff of definition.handoffs) {
    assert.ok(definition.steps.find(step => step.id === handoff.to).depends_on.includes(handoff.from));
    assert.equal(handoff.required, true);
    assert.equal(handoff.output, 'result');
  }
});

test('feature starter requires current profiles and bounded attempts; only Builder can request edits', () => {
  assert.throws(() => featureWorkflowDefinition({ roles, agents: [] }), /current researcher/);
  assert.throws(() => featureWorkflowDefinition({ roles, agents, minutes: 31 }), /1 to 30/);
  assert.throws(() => featureWorkflowDefinition({ roles, agents, attempts: 6 }), /1 to 5/);
  const definition = featureWorkflowDefinition({ roles, agents, allowEdits: true });
  assert.deepEqual(definition.steps.filter(step => step.config.permission_mode === 'workspace-write').map(step => step.id), ['builder']);
  assert.ok(definition.steps.every(step => step.limits.timeout_ms <= 1800000));
});

test('workflow inputs preserve types and explicit defaults without sharing mutable definitions', () => {
  const definition = { inputs: [{ name: 'request', type: 'string', required: true }, { name: 'count', type: 'number', required: true, default: 2 }, { name: 'approved', type: 'boolean' }, { name: 'options', type: 'json', default: { depth: 1 } }] };
  const initial = workflowInputValues(definition);
  assert.deepEqual(initial, { request: '', count: 2, approved: false, options: { depth: 1 } });
  initial.options.depth = 8;
  assert.equal(definition.inputs[3].default.depth, 1);
  assert.deepEqual(parseWorkflowInputs(definition, { request: 'Review', count: '4', approved: true, options: '{"depth":2}' }), { request: 'Review', count: 4, approved: true, options: { depth: 2 } });
  assert.throws(() => parseWorkflowInputs(definition, initial), /Provide request/);
  assert.throws(() => parseWorkflowInputs(definition, { ...initial, request: 'x', count: 'NaN' }), /finite number/);
  assert.throws(() => parseWorkflowInputs(definition, { ...initial, request: 'x', options: '{' }), /valid JSON/);
  assert.throws(() => parseWorkflowInputs(definition, { ...initial, request: 'x', count: '  ' }), /Provide count/);
  assert.throws(() => parseWorkflowInputs(definition, { ...initial, request: 'x', count: true }), /finite number/);
  assert.deepEqual(parseWorkflowInputs({ inputs: [{ name: 'payload', type: 'json', required: true }] }, { payload: null }), { payload: null });
});

test('workflow mutation retry identity stays stable only for the identical request body', () => {
  let id = 0;
  const first = workflowRequestBody({ action: 'prepare_step', version: 1 }, null, () => `key-${++id}`);
  const replay = workflowRequestBody({ action: 'prepare_step', version: 1 }, first.request, () => `key-${++id}`);
  assert.equal(first.body.idempotency_key, replay.body.idempotency_key);
  assert.notEqual(workflowRequestBody({ action: 'prepare_step', version: 2 }, replay.request, () => `key-${++id}`).body.idempotency_key, first.body.idempotency_key);
});

test('latest attempts and blocked prerequisites use canonical step IDs, not title or row order', () => {
  const attempts = [{ step_id: 'researcher', attempt: 2, status: 'completed' }, { step_id: 'researcher', attempt: 1, status: 'failed' }];
  assert.equal(latestWorkflowAttempts(attempts).get('researcher').attempt, 2);
  assert.equal(workflowStepState({ id: 'planner', depends_on: ['researcher'] }, attempts), 'ready');
  assert.equal(workflowStepState({ id: 'builder', depends_on: ['plan_gate'] }, attempts), 'blocked');
  assert.equal(workflowStepState({ id: 'researcher' }, attempts), 'completed');
});

test('step context choices exclude other workspaces, projects, archives and unapproved knowledge', () => {
  const data = { knowledge_entries: [{ id: 'valid', workspace_id: 'w', project_id: 'p', state: 'approved' }, { id: 'draft', workspace_id: 'w', state: 'draft' }, { id: 'other', workspace_id: 'x', state: 'approved' }, { id: 'other-project', workspace_id: 'w', project_id: 'p2', state: 'approved' }, { id: 'archive', workspace_id: 'w', state: 'approved', archived_at: 'date' }] };
  assert.deepEqual(scopedWorkflowContext(data, 'w', 'p', 'knowledge').map(item => item.id), ['valid']);
});

test('Workflows UI keeps previews separate from provider launches and parses as JSX', () => {
  const source = readFileSync(new URL('../src/views/Workflows.jsx', import.meta.url), 'utf8');
  assert.doesNotThrow(() => transformSync(source, { loader: 'jsx', format: 'esm' }));
  assert.match(source, /Creating|creating the run does not start a provider/);
  assert.match(source, /Dry-run preview/);
  assert.match(source, /preview\?\.signature !== signature/);
  assert.match(source, /return \(\) => controller.abort\(\)/);
  assert.match(source, /\.\.\.prepared.run_request, context_inspection_id: reviewed.id/);
  assert.match(source, /Launch reviewed step/);
  assert.match(source, /if \(!valid \|\| inFlight.current \|\| uncertain\) return/);
  assert.match(source, /output_ref: \{ output_id: selected.output_id, version_id: selected.id \}/);
  assert.match(source, /delivery is uncertain/);
  assert.match(source, /attempt\?\.error\?\.message \|\| attempt\?\.error\?\.code \?/);
  assert.doesNotMatch(source, /attempt\?\.error \?/);
  assert.match(source, /useUnsavedUpdate\(!saved && dirty, !saved && mutation.busy\)/);
  assert.match(source, /Plans &amp; other work/);
  assert.doesNotMatch(source, /window\.confirm|window\.alert|setInterval/);
});

test('successful workflow saves and starts release their own guard before one-shot navigation', () => {
  const source = readFileSync(new URL('../src/views/Workflows.jsx', import.meta.url), 'utf8');
  const editor = source.slice(source.indexOf('function WorkflowEditor('), source.indexOf('function DefinitionEditor('));
  assert.match(editor, /if \(result\) setSaved\(result\)/);
  assert.doesNotMatch(editor, /if \(result\) onSaved/);
  assert.ok(editor.indexOf('useUnsavedUpdate(!saved && dirty, !saved && mutation.busy)') < editor.indexOf('onSaved(saved)'));
  assert.match(editor, /delivered.current !== saved.id/);
  assert.match(editor, /disabled=\{Boolean\(saved\)\}/);
  const start = source.slice(source.indexOf('function WorkflowStart('), source.indexOf('function TypedInputs('));
  assert.match(start, /if \(run\) setStarted\(run\)/);
  assert.ok(start.indexOf('useUnsavedUpdate(false, !started && mutation.busy)') < start.indexOf('onStarted(started)'));
  assert.match(start, /delivered.current !== started.id/);
});

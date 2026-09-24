import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTodaySummary } from '../server/today-service.mjs';

const stamp = '2026-09-24T08:00:00.000Z';
const inertDb = () => ({ prepare() { throw new Error('Today must not query or write through db for filtered snapshot records.'); } });
const permissions = (denied = new Set()) => (_workspace, _actor, permission, at = {}) => !denied.has(`${permission}:${at.scope_type || 'workspace'}:${at.scope_id || ''}`);

function fixture() {
  const data = {
    workspaces: [{ id: 'ws', name: 'Workspace' }, { id: 'foreign', name: 'Foreign' }],
    teams: [{ id: 'area', workspace_id: 'ws', name: 'Area', archived_at: null }, { id: 'archived-area', workspace_id: 'ws', name: 'Old', archived_at: stamp }],
    projects: [
      { id: 'project', workspace_id: 'ws', team_id: 'area', name: 'Project', archived_at: null },
      { id: 'hidden-project', workspace_id: 'ws', team_id: 'area', name: 'Hidden', archived_at: null },
      { id: 'orphan-project', workspace_id: 'ws', team_id: 'archived-area', name: 'Orphan', archived_at: null },
    ],
    tasks: [
      { id: 'route', workspace_id: 'ws', project_id: 'project', team_id: 'area', title: 'Ready route', status: 'ready', priority: 'high', updated_at: '2026-09-23T08:00:00.000Z' },
      { id: 'hidden-route', workspace_id: 'ws', project_id: 'hidden-project', team_id: 'area', title: 'Secret route', status: 'ready', updated_at: stamp },
      { id: 'orphan-route', workspace_id: 'ws', project_id: 'orphan-project', team_id: 'archived-area', title: 'Orphan route', status: 'ready', updated_at: stamp },
    ],
    runs: [
      { id: 'active', workspace_id: 'ws', project_id: 'project', task_id: 'route', status: 'running', title: 'Active agent work', agent_name: 'Codex', mode: 'live', created_at: '2026-09-24T07:00:00.000Z', updated_at: '2026-09-24T07:30:00.000Z' },
      { id: 'input', workspace_id: 'ws', project_id: 'project', task_id: 'route', status: 'needs_input', title: 'Question', agent_name: 'Claude', mode: 'mock', created_at: '2026-09-24T06:00:00.000Z' },
      { id: 'done', workspace_id: 'ws', project_id: 'project', task_id: 'route', status: 'completed', title: 'Done', agent_name: 'Codex', mode: 'live', created_at: '2026-09-23T06:00:00.000Z' },
      { id: 'hidden-run', workspace_id: 'ws', project_id: 'hidden-project', task_id: 'hidden-route', status: 'running', title: 'Secret run', agent_name: 'Codex', mode: 'live', created_at: stamp },
    ],
    approvals: [
      { id: 'approval', run_id: 'active', title: 'Allow tests?', detail: 'Review the recorded request.', status: 'pending', created_at: '2026-09-24T07:35:00.000Z' },
      { id: 'old-approval', run_id: 'done', title: 'Obsolete', status: 'pending', created_at: stamp },
    ],
    manual_workflows: [
      { id: 'plan', workspace_id: 'ws', project_id: 'project', title: 'Release workflow', kind: 'manual_workflow', current_definition_version: 2, updated_at: '2026-09-24T05:00:00.000Z' },
    ],
    manual_workflow_versions: [
      { id: 'plan-v1', plan_id: 'plan', number: 1, definition: { steps: [{ id: 'old', name: 'Old step', config: { agent_id: 'agent', profile_version: 1 } }] } },
      { id: 'plan-v2', plan_id: 'plan', number: 2, definition: { steps: [{ id: 'review', name: 'Review release', config: { agent_id: 'agent', profile_version: 1 } }] } },
    ],
    manual_workflow_runs: [
      { id: 'workflow-current', plan_id: 'plan', workspace_id: 'ws', project_id: 'project', status: 'waiting_approval', created_at: '2026-09-24T04:00:00.000Z' },
      { id: 'workflow-cancelled', plan_id: 'plan', workspace_id: 'ws', project_id: 'project', status: 'cancelled', created_at: '2026-09-23T04:00:00.000Z' },
    ],
    manual_workflow_step_runs: [
      { id: 'attempt-current', run_id: 'workflow-current', step_id: 'review', attempt: 1, status: 'waiting_approval', started_at: '2026-09-24T04:01:00.000Z' },
      { id: 'attempt-cancelled', run_id: 'workflow-cancelled', step_id: 'review', attempt: 1, status: 'cancelled', started_at: '2026-09-23T04:01:00.000Z' },
    ],
    manual_workflow_approvals: [
      { id: 'workflow-approval', run_id: 'workflow-current', step_run_id: 'attempt-current', status: 'pending', prompt: 'Approve release?', created_at: '2026-09-24T04:02:00.000Z' },
      { id: 'stale-workflow-approval', run_id: 'workflow-cancelled', step_run_id: 'attempt-cancelled', status: 'pending', prompt: 'Stale', created_at: '2026-09-23T04:02:00.000Z' },
    ],
    outputs: [{ id: 'output', workspace_id: 'ws', project_id: 'project', run_id: 'input', title: 'Agent report', kind: 'report', state: 'needs_review', current_version: 2, updated_at: '2026-09-24T06:30:00.000Z' }],
    context_snapshots: [{ id: 'context', workspace_id: 'ws', project_id: 'project', name: 'Reviewed launch context', created_at: '2026-09-24T03:00:00.000Z', content: 'must never appear' }],
    knowledge_entries: [
      { id: 'knowledge', workspace_id: 'ws', project_id: 'project', title: 'Release policy', kind: 'decision', content: 'private body', state: 'approved', review_date: '2026-09-24', updated_at: '2026-09-22T00:00:00.000Z' },
      { id: 'future', workspace_id: 'ws', project_id: 'project', title: 'Future review', kind: 'fact', state: 'approved', review_date: '2026-09-25', updated_at: '2026-09-21T00:00:00.000Z' },
    ],
    agents: [{ id: 'agent', workspace_id: 'ws', name: 'Codex', version: 2, archived_at: null }],
    events: [],
  };
  return data;
}

function summarize(overrides = {}) {
  return buildTodaySummary({ db: inertDb(), data: fixture(), actor: { id: 'human' }, allowed: permissions(), filter: value => value, workspaceId: 'ws', now: () => stamp, ...overrides });
}

test('Today returns stable, navigable attention sections without private payloads', () => {
  const nativeCalls = [];
  const nativeService = { listRunHistory(runId, actor) {
    nativeCalls.push([runId, actor.id]);
    return runId === 'active' ? { requests: [{ id: 'native', status: 'pending_review', kind: 'project_update', payload: { secret: 'do not leak' }, created_at: '2026-09-24T07:40:00.000Z' }] } : { requests: [] };
  } };
  const result = summarize({ nativeService });
  assert.deepEqual(Object.keys(result.sections), ['needs_you', 'working_now', 'ready_to_review', 'suggested_next', 'recent_context']);
  assert(result.sections.needs_you.some(entry => entry.key === 'run-input:input' && entry.simulation));
  assert(result.sections.needs_you.some(entry => entry.key === 'approval:approval' && entry.id === 'active'));
  assert(result.sections.needs_you.some(entry => entry.key === 'workflow-approval:workflow-approval' && entry.id === 'run:workflow-current'));
  assert(!result.sections.needs_you.some(entry => entry.key.includes('stale-workflow-approval')));
  assert(result.sections.needs_you.some(entry => entry.key === 'native-request:native' && !JSON.stringify(entry).includes('secret')));
  assert(result.sections.working_now.some(entry => entry.key === 'run-active:active'));
  assert.deepEqual(result.sections.ready_to_review.map(entry => entry.key), ['output-review:output']);
  assert.deepEqual(result.sections.suggested_next.map(entry => entry.key), ['route-ready:hidden-route', 'route-ready:route']);
  assert(!JSON.stringify(result).includes('must never appear'));
  assert(result.sections.recent_context.some(entry => entry.key === 'knowledge:knowledge' && !JSON.stringify(entry).includes('private body')));
  assert(nativeCalls.some(([id]) => id === 'active'));
  for (const section of Object.values(result.sections)) for (const entry of section) assert.deepEqual(Object.keys(entry), ['key', 'title', 'detail', 'view', 'id', 'project_id', 'area_id', 'kind', 'time', 'simulation']);
});

test('Area and Project filters enforce current access and active parent scope', () => {
  const denied = new Set(['projects.read:project:hidden-project']);
  const result = summarize({ areaId: 'area', allowed: permissions(denied) });
  const serialized = JSON.stringify(result);
  assert(!serialized.includes('Secret route'));
  assert(!serialized.includes('Secret run'));
  assert(!serialized.includes('Orphan route'));
  assert.throws(() => summarize({ projectId: 'hidden-project', allowed: permissions(denied) }), error => error.code === 'today_scope_unavailable' && error.statusCode === 404);
  assert.throws(() => summarize({ areaId: 'archived-area' }), /active Area/);
  assert.throws(() => summarize({ workspaceId: 'missing' }), error => error.code === 'today_scope_unavailable');
  assert.throws(() => summarize({ areaId: 'area', projectId: 'orphan-project' }), /active Project/);
});

test('cancelled and superseded Workflow approvals never appear as live gates', () => {
  const data = fixture();
  data.manual_workflow_step_runs.push({ id: 'attempt-new', run_id: 'workflow-current', step_id: 'review', attempt: 2, status: 'cancelled', started_at: '2026-09-24T04:03:00.000Z' });
  const result = summarize({ data });
  assert(!result.sections.needs_you.some(entry => entry.key === 'workflow-approval:workflow-approval'));
});

test('Workflow cards distinguish executing attempts from explicit human continuation', () => {
  const data = fixture();
  data.manual_workflow_runs.push(
    { id: 'ready-workflow', plan_id: 'plan', workspace_id: 'ws', project_id: 'project', status: 'ready', created_at: '2026-09-24T03:00:00.000Z' },
    { id: 'retry-workflow', plan_id: 'plan', workspace_id: 'ws', project_id: 'project', status: 'needs_attention', created_at: '2026-09-24T03:01:00.000Z' },
    { id: 'prepared-workflow', plan_id: 'plan', workspace_id: 'ws', project_id: 'project', status: 'in_progress', created_at: '2026-09-24T03:02:00.000Z' },
    { id: 'executing-workflow', plan_id: 'plan', workspace_id: 'ws', project_id: 'project', status: 'in_progress', created_at: '2026-09-24T03:03:00.000Z' },
  );
  data.manual_workflow_step_runs.push(
    { id: 'failed-attempt', run_id: 'retry-workflow', step_id: 'review', attempt: 1, status: 'failed' },
    { id: 'prepared-attempt', run_id: 'prepared-workflow', step_id: 'review', attempt: 1, status: 'prepared', expires_at: '2026-09-24T07:00:00.000Z' },
    { id: 'bound-attempt', run_id: 'executing-workflow', step_id: 'review', attempt: 1, status: 'bound', canonical_run_id: 'canonical-active' },
  );
  data.runs.push({ id: 'canonical-active', workspace_id: 'ws', project_id: 'project', status: 'running', title: 'Canonical execution', agent_name: 'Codex', mode: 'live', created_at: '2026-09-24T03:04:00.000Z' });
  const result = summarize({ data });
  assert(result.sections.suggested_next.some(entry => entry.id === 'run:ready-workflow' && /explicitly start/.test(entry.detail)));
  assert(result.sections.suggested_next.some(entry => entry.id === 'run:retry-workflow' && /retry or continue/.test(entry.detail)));
  assert(result.sections.suggested_next.some(entry => entry.id === 'run:prepared-workflow' && entry.kind === 'workflow_preparation_expired'));
  assert(!result.sections.working_now.some(entry => ['run:ready-workflow', 'run:retry-workflow', 'run:prepared-workflow'].includes(entry.id)));
  assert(result.sections.working_now.some(entry => entry.id === 'run:executing-workflow' && /executing/.test(entry.detail)));
});

test('failure clusters use only recorded codes and label absent codes unknown', () => {
  const data = fixture();
  data.runs.push(
    { id: 'fail-a', workspace_id: 'ws', project_id: 'project', status: 'failed', title: 'A', mode: 'live', finished_at: '2026-09-24T01:00:00.000Z' },
    { id: 'fail-b', workspace_id: 'ws', project_id: 'project', status: 'failed', title: 'B', mode: 'live', finished_at: '2026-09-24T02:00:00.000Z' },
    { id: 'fail-c', workspace_id: 'ws', project_id: 'project', status: 'failed', title: 'C', mode: 'live', finished_at: '2026-09-24T03:00:00.000Z' },
    { id: 'fail-d', workspace_id: 'ws', project_id: 'project', status: 'failed', title: 'D', mode: 'live', finished_at: '2026-09-24T04:00:00.000Z' },
  );
  data.events.push(
    { id: 'ea', run_id: 'fail-a', sequence: 2, type: 'run.failed', payload: { error_code: 'provider_exit' }, created_at: '2026-09-24T01:00:00.000Z' },
    { id: 'eb', run_id: 'fail-b', sequence: 2, type: 'run.failed', payload_json: JSON.stringify({ error_code: 'provider_exit' }), created_at: '2026-09-24T02:00:00.000Z' },
    { id: 'ec', run_id: 'fail-c', sequence: 2, type: 'run.failed', payload: {}, created_at: '2026-09-24T03:00:00.000Z' },
    { id: 'ed', run_id: 'fail-d', sequence: 2, type: 'run.failed', payload: { message: 'no code' }, created_at: '2026-09-24T04:00:00.000Z' },
  );
  const result = summarize({ data });
  for (const id of ['fail-a', 'fail-b', 'fail-c', 'fail-d']) assert(result.sections.needs_you.some(entry => entry.key === `run-failed:${id}`));
  assert.match(result.sections.needs_you.find(entry => entry.key === 'run-failed:fail-a').detail, /recorded error code: provider_exit/);
  assert.match(result.sections.needs_you.find(entry => entry.key === 'run-failed:fail-c').detail, /without a recorded error code/);
  const known = result.failure_clusters.find(cluster => cluster.error_code === 'provider_exit'), unknown = result.failure_clusters.find(cluster => cluster.error_code === 'unknown');
  assert.equal(known.count, 2);
  assert.deepEqual(known.run_ids, ['fail-a', 'fail-b']);
  assert.equal(unknown.count, 2);
  assert.match(unknown.detail, /did not record/);
  assert.deepEqual(Object.keys(known), ['key', 'title', 'detail', 'error_code', 'count', 'latest_time', 'run_ids', 'project_id', 'area_id', 'simulation']);
});

test('warnings are evidence-based: due approved knowledge and current Workflow profile pins', () => {
  const result = summarize();
  assert(result.warnings.some(entry => entry.key === 'stale-memory:knowledge' && entry.kind === 'stale_memory'));
  assert(!result.warnings.some(entry => entry.key === 'stale-memory:future'));
  assert(result.warnings.some(entry => entry.key === 'stale-profile:plan:review' && /version 1; current version is 2/.test(entry.detail)));
  assert(!result.warnings.some(entry => entry.key === 'stale-profile:plan:old'), 'historical workflow versions are not warnings');
});

test('Today is deterministic, bounded, and performs no provider or database action', () => {
  const data = fixture();
  data.tasks = Array.from({ length: 40 }, (_, index) => ({ id: `route-${index}`, workspace_id: 'ws', project_id: 'project', team_id: 'area', title: `Route ${index}`, status: 'ready', updated_at: `2026-09-${String((index % 20) + 1).padStart(2, '0')}T00:00:00.000Z` }));
  const first = summarize({ data }), second = summarize({ data: structuredClone(data) });
  assert.equal(first.sections.suggested_next.length, 24);
  assert.deepEqual(first, second);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTodaySummary } from '../server/today-service.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createAccessBoundary } from '../server/access-boundary.mjs';

const stamp = '2026-09-24T12:00:00.000Z';
function fixture() {
  return {
    workspaces: [{ id: 'ws', name: 'Workspace' }], teams: [],
    projects: [{ id: 'project', workspace_id: 'ws', name: 'Project' }], tasks: [], runs: [],
    manual_workflows: [{ id: 'plan', workspace_id: 'ws', project_id: 'project', kind: 'manual_workflow', title: 'Human-directed workflow' }],
    manual_workflow_runs: [], manual_workflow_step_runs: [], manual_workflow_approvals: [],
  };
}
function summary(data, extra = {}) {
  return buildTodaySummary({ db: { prepare() { throw new Error('Unexpected Today database action'); } }, data, actor: { id: 'human' }, allowed: () => true, filter: data => data, workspaceId: 'ws', now: () => stamp, ...extra });
}
const cards = result => Object.values(result.sections).flat();

test('audit: retryable Workflow failure remains an actionable Today item', () => {
  const data = fixture();
  data.manual_workflow_runs.push({ id: 'retry', plan_id: 'plan', workspace_id: 'ws', project_id: 'project', status: 'needs_attention', created_at: stamp });
  data.manual_workflow_step_runs.push({ id: 'failed', run_id: 'retry', step_id: 'research', attempt: 1, status: 'failed' });
  const result = summary(data);
  assert(result.sections.suggested_next.some(card => card.id === 'run:retry'), 'Retryable failure must not disappear from Today');
});

test('audit: expired preparation is not presented as currently executing work', () => {
  const data = fixture();
  data.manual_workflow_runs.push({ id: 'prepared', plan_id: 'plan', workspace_id: 'ws', project_id: 'project', status: 'in_progress', created_at: stamp });
  data.manual_workflow_step_runs.push({ id: 'expired', run_id: 'prepared', step_id: 'research', attempt: 1, status: 'prepared', expires_at: '2026-09-24T11:00:00.000Z' });
  const result = summary(data);
  assert(!result.sections.working_now.some(card => card.id === 'run:prepared'), 'Expired, unlaunched preparation is not working now');
  assert(result.sections.suggested_next.some(card => card.id === 'run:prepared'), 'Expired preparation needs an explicit human continuation');
});

test('audit: an older run with a pending native decision is not silently dropped after 100 newer runs', () => {
  const data = fixture();
  data.runs = Array.from({ length: 101 }, (_, index) => ({ id: `run-${index}`, workspace_id: 'ws', project_id: 'project', mode: 'live', status: 'completed', title: 'Completed run', created_at: new Date(Date.parse(stamp) - index * 1000).toISOString() }));
  const result = summary(data, { nativeService: { listRunHistory(id) { return { requests: id === 'run-100' ? [{ id: 'waiting', status: 'pending_review', kind: 'project_update', created_at: stamp }] : [] }; } } });
  assert(result.sections.needs_you.some(card => card.key === 'native-request:waiting'), 'Pending decisions cannot be lost just because their run is older');
});

test('audit: native history access failures reveal neither private request payloads nor decision cards', () => {
  const data = fixture();
  data.runs.push({ id: 'run', workspace_id: 'ws', project_id: 'project', status: 'completed', mode: 'live', title: 'Visible run' });
  const result = summary(data, { nativeService: { listRunHistory() { throw Object.assign(new Error('SECRET SOURCE REVOKED'), { code: 'context_access_revoked' }); } } });
  assert.equal(result.sections.needs_you.length, 0);
  assert(!JSON.stringify(result).includes('SECRET'));
});

test('audit: filtered Workflow parent hides its child approvals and summary leaves the input unchanged', () => {
  const data = fixture();
  data.manual_workflow_runs.push({ id: 'hidden', plan_id: 'plan', workspace_id: 'ws', project_id: 'project', status: 'waiting_approval' });
  data.manual_workflow_step_runs.push({ id: 'attempt', run_id: 'hidden', step_id: 'gate', attempt: 1, status: 'waiting_approval' });
  data.manual_workflow_approvals.push({ id: 'approval', run_id: 'hidden', step_run_id: 'attempt', status: 'pending', prompt: 'PRIVATE GATE' });
  const before = structuredClone(data);
  const result = summary(data, { filter: value => ({ ...value, manual_workflows: [] }) });
  assert.equal(cards(result).length, 0);
  assert(!JSON.stringify(result).includes('PRIVATE'));
  assert.deepEqual(data, before);
});

test('audit: a workspace Context Snapshot with a revoked private source does not reveal its derived title', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`
    CREATE TABLE governance_members(id TEXT,workspace_id TEXT,status TEXT);
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,title TEXT);
    CREATE TABLE context_snapshots(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,name TEXT,sources_json TEXT);
    INSERT INTO governance_members VALUES('human','ws','active');
    INSERT INTO workspaces VALUES('ws','Workspace');
    INSERT INTO projects VALUES('private','ws','Private project');
    INSERT INTO documents VALUES('private-doc','ws','private','Private document');
    INSERT INTO context_snapshots VALUES('snapshot','ws',NULL,'PRIVATE DERIVED TITLE','[{"type":"documents","id":"private-doc"}]');
  `);
  const access = createAccessBoundary({ db, governance: { explain: (_ws, _actor, _permission, scope) => ({ allowed: scope?.scope_id !== 'private' }) } });
  const data = { workspaces: db.prepare('SELECT * FROM workspaces').all(), projects: db.prepare('SELECT * FROM projects').all(), context_snapshots: db.prepare('SELECT * FROM context_snapshots').all() };
  const result = buildTodaySummary({ db, data, actor: { id: 'human' }, allowed: access.allowed, filter: access.filter, workspaceId: 'ws', now: () => stamp });
  assert(!JSON.stringify(result).includes('PRIVATE DERIVED TITLE'), 'Snapshot source revocation must hide derived context metadata too');
  assert.equal(access.filter({ result: data.context_snapshots[0] }, { id: 'human' }).result, null);
  assert.throws(() => access.check({ actor: { id: 'human' }, path: '/workflow/context/snapshot/attach-chat', method: 'POST', url: new URL('http://localhost'), body: {} }), { code: 'access_denied' });
});

test('audit: snapshot source content edits stay readable but removed sources and historical private scopes fail closed', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`
    CREATE TABLE governance_members(id TEXT,workspace_id TEXT,status TEXT);
    CREATE TABLE workspaces(id TEXT PRIMARY KEY);
    CREATE TABLE documents(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,content TEXT);
    CREATE TABLE context_snapshots(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,name TEXT,sources_json TEXT);
    INSERT INTO governance_members VALUES('human','ws','active');
    INSERT INTO workspaces VALUES('ws');
    INSERT INTO documents VALUES('doc','ws',NULL,'Original source');
    INSERT INTO context_snapshots VALUES('snapshot','ws',NULL,'Saved snapshot','[{"type":"documents","id":"doc"}]');
  `);
  const actor = { id: 'human' }, access = createAccessBoundary({ db, governance: { explain: (_ws, _actor, _permission, scope) => ({ allowed: scope?.scope_id !== 'private' }) } });
  const snapshot = db.prepare('SELECT * FROM context_snapshots').get();
  assert.equal(access.filter({ context_snapshots: [snapshot] }, actor).context_snapshots.length, 1);
  db.prepare("UPDATE documents SET content='Edited ordinary text' WHERE id='doc'").run();
  assert.equal(access.filter({ result: snapshot }, actor).result.name, 'Saved snapshot');
  const history = { id: 'history', entity_type: 'context_snapshots', entity_id: 'snapshot', workspace_id: 'ws', before: { ...snapshot, project_id: 'private' }, after: snapshot };
  assert.deepEqual(access.filter({ audit_log: [history] }, actor).audit_log, []);
  db.prepare("DELETE FROM documents WHERE id='doc'").run();
  assert.deepEqual(access.filter({ context_snapshots: [snapshot] }, actor).context_snapshots, []);
  assert.equal(access.filter({ result: snapshot }, actor).result, null);
  assert.throws(() => access.check({ actor, path: '/workflow/context/snapshot', method: 'GET', url: new URL('http://localhost'), body: {} }), { code: 'access_denied' });
});

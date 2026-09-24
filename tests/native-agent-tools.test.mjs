import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { captureSourceAccess } from '../server/context-source-access.mjs';
import { captureRunContext, consumeInspection, installRunContextStore, saveInspection } from '../server/run-context-store.mjs';
import { createNativeAgentToolService, listNativeAgentTools, NATIVE_AGENT_TOOL_REGISTRY } from '../server/native-agent-tools.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const stamp = '2026-09-24T00:00:00.000Z';

function fixture(t, { enabled = listNativeAgentTools().map(tool => tool.name), nativeTools = true, workflow = false } = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT,description TEXT,archived_at TEXT);
    CREATE TABLE teams(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,description TEXT,archived_at TEXT);
    CREATE TABLE area_settings(id TEXT PRIMARY KEY,workspace_id TEXT,instructions TEXT,archived_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,team_id TEXT,name TEXT,description TEXT,goal TEXT,status TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,team_id TEXT,title TEXT,description TEXT,status TEXT,priority TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE agents(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,status TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE agent_profile_versions(agent_id TEXT,version INTEGER,snapshot_json TEXT,snapshot_hash TEXT,created_at TEXT,PRIMARY KEY(agent_id,version));
    CREATE TABLE documents(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,team_id TEXT,title TEXT,content TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE knowledge_entries(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,title TEXT,content TEXT,state TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE runs(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,task_id TEXT,agent_id TEXT,agent_profile_version INTEGER,mode TEXT,status TEXT);
    CREATE TABLE agent_run_sponsors(run_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL);
    CREATE TABLE work_plan_step_runs(id TEXT PRIMARY KEY,run_id TEXT,canonical_run_id TEXT,status TEXT);
    INSERT INTO workspaces VALUES('ws','Workspace','Workspace reviewed text',NULL),('foreign','Foreign','FOREIGN SECRET',NULL);
    INSERT INTO teams VALUES('area','ws','Area','Area reviewed text',NULL);
    INSERT INTO area_settings VALUES('area','ws','Area reviewed instructions',NULL);
    INSERT INTO projects VALUES('project','ws','area','Project','Captured project text','Goal','active','${stamp}',NULL),('other-project','ws','area','Other','UNREVIEWED PROJECT SECRET','','active','${stamp}',NULL),('foreign-project','foreign',NULL,'Foreign','FOREIGN PROJECT SECRET','','active','${stamp}',NULL);
    INSERT INTO tasks VALUES('route','ws','project','area','Route','Captured route text','ready','high','${stamp}',NULL);
    INSERT INTO agents VALUES('agent','ws','Current agent','available','${stamp}',NULL),('handoff-agent','ws','Reviewed handoff agent','available','${stamp}',NULL);
    INSERT INTO agent_profile_versions VALUES('agent',1,'{"name":"Pinned"}','profile-hash','${stamp}');
    INSERT INTO documents VALUES('doc','ws','project',NULL,'Reviewed document','CURRENT DATABASE TEXT','${stamp}',NULL),('hidden-doc','ws','other-project',NULL,'Hidden','UNREVIEWED DOCUMENT SECRET','${stamp}',NULL),('foreign-doc','foreign','foreign-project',NULL,'Foreign','FOREIGN DOCUMENT SECRET','${stamp}',NULL);
    INSERT INTO knowledge_entries VALUES('knowledge','ws','project','Reviewed knowledge','CURRENT KNOWLEDGE TEXT','approved','${stamp}',NULL);
    INSERT INTO runs VALUES('run','ws','project','route','agent',1,'live','running');
    INSERT INTO agent_run_sponsors VALUES('run','sponsor');`);
  if (workflow) db.prepare('INSERT INTO work_plan_step_runs VALUES(?,?,?,?)').run('step-run', 'workflow-run', 'run', 'bound');
  installRunContextStore(db);
  const section = (kind, id, label, content, status = 'included') => ({ kind, id, label, content, status, reason: status === 'included' ? 'included' : 'source_limit', content_hash: digest(content), included_characters: content.length, original_characters: content.length });
  const included = [
    section('workspace', 'ws', 'Workspace', '{"name":"Workspace","description":"Workspace reviewed text"}'),
    section('area', 'area', 'Area', '{"name":"Area","description":"Area reviewed text"}'),
    section('area_instructions', 'area', 'Area instructions', 'Area reviewed instructions'),
    section('project', 'project', 'Project', '{"name":"Project","description":"Captured project text"}'),
    section('route', 'route', 'Route', '{"title":"Route","description":"Captured route text"}'),
    section('agent', 'agent', 'Current agent', '{"name":"Current agent"}'),
    section('agent', 'handoff-agent', 'Reviewed handoff agent', '{"name":"Reviewed handoff agent"}'),
    section('documents', 'doc', 'Reviewed document', 'CAPTURED DOCUMENT TEXT', 'truncated'),
    section('knowledge_entries', 'knowledge', 'Reviewed knowledge', 'CAPTURED KNOWLEDGE TEXT'),
  ];
  const inspection = {
    finalPrompt: 'Reviewed prompt', request: { native_tools: nativeTools, ...(workflow ? { workflow_step: { workflow_run_id: 'workflow-run', step_run_id: 'step-run', step_run_version: 1 } } : {}) },
    manifest: { version: 1, fingerprint: 'context-fingerprint', resolved: { workspace_id: 'ws', area_id: 'area', project_id: 'project', task_id: 'route', chat_id: null, agent_id: 'agent' }, permissions: { available_tools: enabled.map(id => ({ id, available: true })) }, included, excluded: [] },
  };
  inspection.sourceAccess = captureSourceAccess(db, inspection);
  const preview = saveInspection(db, { actorId: 'sponsor', workspaceId: 'ws', input: { native_tools: nativeTools }, inspection });
  consumeInspection(db, preview.id, 'run'); captureRunContext(db, 'run', inspection);
  const denied = new Set();
  const allowed = (_ws, actor, permission, scope) => !denied.has(`${actor.id}:${permission}:${scope?.scope_id || '*'}`) && !denied.has(`${actor.id}:*:*`);
  let counter = 0;
  const applied = [];
  const apply = Object.fromEntries(['create_draft_route', 'propose_project_update', 'save_memory_candidate', 'submit_output'].map(name => [name, input => { applied.push({ name, input }); return { applied: name }; }]));
  const service = createNativeAgentToolService({ db, allowed, filter: value => value, apply, now: () => stamp, randomId: prefix => `${prefix}_${++counter}` });
  return { db, service, denied, applied };
}

test('registry exposes twelve immutable real JSON Schema contracts', () => {
  const tools = listNativeAgentTools();
  assert.equal(tools.length, 12); assert.equal(new Set(tools.map(tool => tool.name)).size, 12);
  assert.deepEqual(tools.map(tool => tool.name), Object.keys(NATIVE_AGENT_TOOL_REGISTRY));
  for (const tool of tools) {
    assert.equal(tool.id, `rumbo.${tool.name}.v1`); assert.equal(tool.input_schema.type, 'object'); assert.equal(tool.input_schema.additionalProperties, false);
    assert.ok(Array.isArray(tool.input_schema.required)); assert.ok(tool.classification === 'read' || tool.classification === 'write');
    if (tool.classification === 'write') assert.ok(tool.input_schema.required.includes('idempotency_key'));
  }
  tools[0].description = 'mutated'; assert.notEqual(listNativeAgentTools()[0].description, 'mutated');
});

test('authority requires an explicitly enabled consumed review, pinned profile, active live run and server-loaded sponsor', t => {
  const { db, service } = fixture(t, { enabled: ['read_document'] });
  assert.deepEqual(service.listForRun('run').tools.map(tool => tool.name), ['read_document']);
  db.prepare("UPDATE runs SET status='completed' WHERE id='run'").run();
  assert.throws(() => service.listForRun('run'), { code: 'run_not_active' });
  db.prepare("UPDATE runs SET status='running',mode='mock' WHERE id='run'").run();
  assert.throws(() => service.listForRun('run'), { code: 'run_not_active' });
});

test('read tools return only exact reviewed strings, never current or neighboring database content', t => {
  const { db, service } = fixture(t);
  db.prepare("UPDATE documents SET content='CHANGED DATABASE SECRET' WHERE id='doc'").run();
  const document = service.invoke('run', 'read_document', { document_id: 'doc' });
  assert.equal(document.ok, true); assert.equal(document.result.document.content, 'CAPTURED DOCUMENT TEXT'); assert.equal(document.result.document.truncated, true);
  const search = service.invoke('run', 'search_workspace', { query: 'CAPTURED', limit: 50 });
  assert.ok(search.result.results.some(item => item.id === 'doc')); assert.ok(search.result.results.some(item => item.id === 'knowledge'));
  const serialized = JSON.stringify({ document, search });
  for (const secret of ['CHANGED DATABASE SECRET', 'UNREVIEWED DOCUMENT SECRET', 'FOREIGN DOCUMENT SECRET', 'UNREVIEWED PROJECT SECRET']) assert.ok(!serialized.includes(secret));
  const hidden = service.invoke('run', 'read_document', { document_id: 'hidden-doc' });
  assert.equal(hidden.ok, false); assert.equal(hidden.error.code, 'target_not_in_reviewed_context'); assert.ok(!JSON.stringify(hidden).includes('UNREVIEWED'));
});

test('all six read contracts validate strict arguments and audit safe structured failures', t => {
  const { db, service } = fixture(t);
  const calls = [
    ['search_workspace', { query: 'reviewed' }], ['get_area_context', { area_id: 'area' }], ['get_project_context', { project_id: 'project' }],
    ['get_route', { route_id: 'route' }], ['search_knowledge', { query: 'knowledge' }], ['read_document', { document_id: 'doc' }],
  ];
  for (const [name, args] of calls) assert.equal(service.invoke('run', name, args).ok, true, name);
  const invalid = service.invoke('run', 'read_document', { document_id: 'doc', workspace_id: 'foreign' });
  assert.equal(invalid.ok, false); assert.equal(invalid.error.code, 'invalid_input');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_tool_calls').get().count, 7);
  const audit = db.prepare("SELECT * FROM agent_tool_calls WHERE status='failed'").get();
  assert.equal(JSON.parse(audit.error_json).code, 'invalid_input'); assert.deepEqual(JSON.parse(audit.input_json), { redacted_invalid_input: true });
});

test('all writes create bounded pending review requests and never mutate targets or launch/grant', t => {
  const { db, service } = fixture(t);
  const before = { projects: db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, tasks: db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, knowledge: db.prepare('SELECT COUNT(*) AS n FROM knowledge_entries').get().n };
  const inputs = [
    ['create_draft_route', { idempotency_key: 'route-1', project_id: 'project', title: 'Draft route', priority: 'high' }, 'route_draft'],
    ['propose_project_update', { idempotency_key: 'project-1', project_id: 'project', patch: { goal: 'New goal' } }, 'project_update'],
    ['save_memory_candidate', { idempotency_key: 'memory-1', project_id: 'project', title: 'Candidate', content: 'Remember this' }, 'memory_candidate'],
    ['request_permission', { idempotency_key: 'permission-1', capability: 'documents.write', reason: 'Need to draft output', scope_type: 'project', scope_id: 'project' }, 'permission_request'],
    ['submit_output', { idempotency_key: 'output-1', project_id: 'project', route_id: 'route', title: 'Draft output', content: 'x'.repeat(50000) }, 'output_draft'],
    ['handoff_to_agent', { idempotency_key: 'handoff-1', target_agent_id: 'handoff-agent', project_id: 'project', route_id: 'route', summary: 'Please continue' }, 'agent_handoff'],
  ];
  for (const [name, args, kind] of inputs) { const result = service.invoke('run', name, args); assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`); assert.equal(result.result.kind, kind); assert.equal(result.result.status, 'pending_review'); assert.equal(result.result.executed, false); assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536); if (name === 'submit_output') assert.ok(!JSON.stringify(result).includes('x'.repeat(1000))); }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tool_requests').get().n, 6);
  assert.deepEqual({ projects: db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, tasks: db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, knowledge: db.prepare('SELECT COUNT(*) AS n FROM knowledge_entries').get().n }, before);
  const permission = JSON.parse(db.prepare("SELECT payload_json FROM agent_tool_requests WHERE kind='permission_request'").get().payload_json), handoff = JSON.parse(db.prepare("SELECT payload_json FROM agent_tool_requests WHERE kind='agent_handoff'").get().payload_json);
  assert.equal(permission.grants_access, false); assert.equal(handoff.launches_agent, false);
});

test('write idempotency is exact, conflicts safely, and replays recheck current and historical ACL', t => {
  const { db, service, denied } = fixture(t), args = { idempotency_key: 'same', project_id: 'project', title: 'Draft' };
  const first = service.invoke('run', 'create_draft_route', args), replay = service.invoke('run', 'create_draft_route', args);
  assert.equal(first.ok, true); assert.equal(replay.replayed, true); assert.equal(replay.call_id, first.call_id); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tool_requests').get().n, 1);
  const conflict = service.invoke('run', 'create_draft_route', { ...args, title: 'Different' }); assert.equal(conflict.error.code, 'idempotency_conflict');
  denied.add('sponsor:*:*'); const revoked = service.invoke('run', 'create_draft_route', args); assert.equal(revoked.ok, false); assert.equal(revoked.error.code, 'context_access_revoked');
});

test('review requires both sponsor and reviewer ACL, rejects self-approval and stale targets, and applies once', t => {
  const { db, service, denied, applied } = fixture(t);
  const created = service.invoke('run', 'propose_project_update', { idempotency_key: 'update', project_id: 'project', patch: { goal: 'Reviewed goal' } });
  const requestId = created.result.request_id;
  assert.throws(() => service.decideRequest(requestId, { actor: { id: 'agent' }, decision: 'approve', version: 1 }), { code: 'self_approval_denied' });
  denied.add('reviewer:projects.write:project'); assert.throws(() => service.decideRequest(requestId, { actor: { id: 'reviewer' }, decision: 'approve', version: 1 }), { code: 'tool_access_denied' }); denied.clear();
  db.prepare("UPDATE projects SET updated_at='2026-09-24T01:00:00.000Z' WHERE id='project'").run(); assert.throws(() => service.decideRequest(requestId, { actor: { id: 'reviewer' }, decision: 'approve', version: 1 }), { code: 'stale_target' });
  db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(stamp, 'project');
  const approved = service.decideRequest(requestId, { actor: { id: 'reviewer' }, decision: 'approve', version: 1 });
  assert.equal(approved.status, 'applied'); assert.equal(approved.version, 2); assert.equal(applied.length, 1); assert.equal(applied[0].input.proposal.project_id, 'project');
  assert.throws(() => service.decideRequest(requestId, { actor: { id: 'reviewer' }, decision: 'approve', version: 1 }), { code: 'stale_request' }); assert.equal(applied.length, 1);
});

test('permission and handoff approvals only record review and history exposes decoded public rows', t => {
  const { service } = fixture(t);
  const permission = service.invoke('run', 'request_permission', { idempotency_key: 'p', capability: 'documents.write', reason: 'Need it' });
  const reviewed = service.decideRequest(permission.result.request_id, { actor: { id: 'reviewer' }, decision: 'approve', version: 1, note: 'Reviewed only' });
  assert.equal(reviewed.status, 'reviewed'); assert.deepEqual(reviewed.result, { grants_access: false, launches_agent: false, reviewed: true });
  const history = service.listRunHistory('run', { id: 'reviewer' });
  assert.equal(history.calls.length, 1); assert.equal(history.requests.length, 1); assert.equal(typeof history.requests[0].payload, 'object');
  assert.equal(Object.hasOwn(history.calls[0], 'input_json'), false); assert.equal(Object.hasOwn(history.calls[0], 'idempotency_key'), false); assert.equal(Object.hasOwn(history.requests[0], 'stale_guard_json'), false);
});

test('native tools remain unavailable without explicit reviewed opt-in and per-tool availability', t => {
  const off = fixture(t, { nativeTools: false });
  assert.throws(() => off.service.listForRun('run'), { code: 'native_tools_not_reviewed' });
  const one = fixture(t, { enabled: ['read_document'] });
  const denied = one.service.invoke('run', 'search_workspace', { query: 'x' }); assert.equal(denied.error.code, 'tool_not_available');
});

test('per-run call and pending-request bounds stop loops while exact replay consumes no capacity', t => {
  const writes = fixture(t);
  let first;
  for (let index = 0; index < 20; index++) {
    const result = writes.service.invoke('run', 'create_draft_route', { idempotency_key: `draft-${index}`, project_id: 'project', title: `Draft ${index}` });
    assert.equal(result.ok, true); if (index === 0) first = result;
  }
  const replay = writes.service.invoke('run', 'create_draft_route', { idempotency_key: 'draft-0', project_id: 'project', title: 'Draft 0' });
  assert.equal(replay.replayed, true); assert.equal(replay.call_id, first.call_id);
  const bounded = writes.service.invoke('run', 'create_draft_route', { idempotency_key: 'draft-21', project_id: 'project', title: 'Too many' });
  assert.equal(bounded.error.code, 'pending_request_limit'); assert.equal(writes.db.prepare('SELECT COUNT(*) AS n FROM agent_tool_requests').get().n, 20);

  const reads = fixture(t, { enabled: ['read_document'] });
  for (let index = 0; index < 100; index++) assert.equal(reads.service.invoke('run', 'read_document', { document_id: 'doc' }).ok, true);
  const callBound = reads.service.invoke('run', 'read_document', { document_id: 'doc' });
  assert.equal(callBound.error.code, 'tool_call_limit'); assert.equal(reads.db.prepare('SELECT COUNT(*) AS n FROM agent_tool_calls').get().n, 100);
});

test('canonical input validation rejects getters and decorated objects without invoking them', t => {
  const { service, db } = fixture(t); let invoked = false;
  const getter = { get document_id() { invoked = true; return 'doc'; } };
  const result = service.invoke('run', 'read_document', getter);
  assert.equal(result.error.code, 'invalid_input'); assert.equal(invoked, false); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tool_calls').get().n, 0);
});

test('reconciled Workflow bindings permit reviewed history and decisions but never post-run invocation', t => {
  const { service, db } = fixture(t, { workflow: true });
  const request = service.invoke('run', 'request_permission', { idempotency_key: 'workflow-permission', capability: 'documents.write', reason: 'Reviewed request' });
  assert.equal(request.ok, true);
  db.prepare("UPDATE runs SET status='completed' WHERE id='run'").run();
  db.prepare("UPDATE work_plan_step_runs SET status='completed' WHERE id='step-run'").run();
  assert.equal(service.listRunHistory('run', { id: 'reviewer' }).requests.length, 1);
  assert.equal(service.decideRequest(request.result.request_id, { actor: { id: 'reviewer' }, decision: 'reject', version: 1 }).status, 'rejected');
  const denied = service.invoke('run', 'read_document', { document_id: 'doc' }); assert.equal(denied.error.code, 'run_not_active');
});

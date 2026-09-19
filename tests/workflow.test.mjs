import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { installWorkflow, workflowRoute, workflowSnapshot } from '../server/workflow-service.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  for (const table of ['workspaces', 'projects', 'tasks', 'chats']) db.exec(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
  installWorkflow(db);
  db.exec(`INSERT INTO workspaces (id,name,slug,created_at,updated_at) VALUES ('ws','Lab','lab','now','now'),('other','Other','other','now','now');
    INSERT INTO projects (id,workspace_id,name,identifier,created_at,updated_at) VALUES ('project','ws','Project','P','now','now'),('foreign','other','Other','O','now','now');
    INSERT INTO tasks (id,workspace_id,project_id,number,title,created_at,updated_at) VALUES ('task','ws','project',1,'Ship','now','now'),('dep','ws','project',2,'Prepare','now','now'),('outsider','other','foreign',1,'Private','now','now');
    INSERT INTO chats (id,workspace_id,project_id,title,created_at,updated_at) VALUES ('chat','ws','project','Planning','now','now'),('foreignchat','other','foreign','Private','now','now');
    INSERT INTO messages (id,chat_id,sender_type,sender_name,content,created_at,updated_at) VALUES ('message','chat','user','You','Draft','now','now');
    INSERT INTO documents (id,workspace_id,project_id,title,content,created_at,updated_at) VALUES ('doc','ws','project','Brief','Original source','now','now'),('secret','other','foreign','Secret','Private text','now','now');
    INSERT INTO milestones (id,workspace_id,project_id,title,created_at,updated_at) VALUES ('milestone','ws','project','Launch','now','now');`);
  const call = async (path, body, method = 'POST') => { let response; const handled = await workflowRoute({ db, req: { method }, res: {}, path: `/workflow/${path}`, url: new URL('http://localhost/'), readBody: async () => body, send: (_, status, result) => { response = { status, ...result }; }, snapshot: workflowSnapshot }); assert.equal(handled, true); return response; };
  const output = body => call('outputs', { workspace_id: 'ws', task_id: 'task', title: 'Deliverable', content: 'First draft', ...body });
  return { db, call, output, snapshot: () => workflowSnapshot(db) };
}

test('workflow installation is idempotent and snapshots are explicit collections', () => {
  const f = fixture(); try { installWorkflow(f.db); assert.equal(Object.keys(f.snapshot()).length, 9); } finally { f.db.close(); }
});
test('work agreements persist owners, checklists and acyclic dependencies', async () => {
  const f = fixture(); try {
    const row = (await f.call('routes/task', { version: 0, owner_name: 'Evan', reviewer_name: 'Reviewer', dependency_ids: ['dep'], acceptance: [{ id: 'a', text: 'Tests pass', done: false }] }, 'PATCH')).result;
    assert.equal(row.owner_name, 'Evan'); assert.equal(row.version, 1);
    await assert.rejects(f.call('routes/task', { version: 0 }, 'PATCH'), e => e.statusCode === 409);
    await assert.rejects(f.call('routes/dep', { version: 0, dependency_ids: ['task'] }, 'PATCH'), /cycle/);
    await assert.rejects(f.call('routes/task', { version: 1, dependency_ids: ['outsider'] }, 'PATCH'), /same workspace/);
    await assert.rejects(f.call('routes/task', { version: 1, dependency_ids: ['task'] }, 'PATCH'), /itself/);
    await f.call('routes/dep', { version: 0, parent_task_id: 'task' }, 'PATCH');
    await assert.rejects(f.call('routes/task', { version: 1, parent_task_id: 'dep' }, 'PATCH'), /cycle/);
    assert.equal(f.snapshot().route_workflows.length, 2);
  } finally { f.db.close(); }
});
test('output creation validates related workspace links and preserves chat provenance', async () => {
  const f = fixture(); try {
    const out = (await f.output({ source_message_id: 'message' })).result;
    assert.equal(out.chat_id, 'chat'); assert.equal(out.source_message_id, 'message'); assert.equal(f.snapshot().output_versions[0].number, 1);
    await assert.rejects(f.output({ project_id: 'foreign' }), /same workspace/);
    await assert.rejects(f.output({ chat_id: 'foreignchat' }), /same workspace/);
    await assert.rejects(f.output({ content: '' }), /Output content/);
    assert.equal(f.snapshot().outputs.length, 1, 'invalid first version must roll back its output');
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM change_log WHERE entity_type='outputs'").get().n, 1, 'successful output creation is recorded once');
  } finally { f.db.close(); }
});
test('approval requires current version, assigned reviewer and complete acceptance criteria', async () => {
  const f = fixture(); try {
    await f.call('routes/task', { version: 0, reviewer_name: 'Evan', acceptance: [{ id: 'test', text: 'Verified', done: false }] }, 'PATCH');
    let out = (await f.output()).result, version = f.snapshot().output_versions[0];
    const review = overrides => f.call(`outputs/${out.id}/review`, { version: out.version, version_id: version.id, decision: 'approved', reviewer_name: 'Evan', ...overrides });
    await assert.rejects(review({ reviewer_name: 'Someone else' }), /assigned/);
    await assert.rejects(review({}), /checklist/);
    await f.call('routes/task', { version: 1, acceptance: [{ id: 'test', text: 'Verified', done: true }] }, 'PATCH');
    await review({}); out = f.snapshot().outputs[0]; assert.equal(out.state, 'approved');
    await f.call(`outputs/${out.id}/versions`, { version: out.version, content: 'Second draft', author_name: 'Evan' });
    out = f.snapshot().outputs[0]; assert.equal(out.state, 'needs_review'); assert.equal(out.current_version, 2);
    await assert.rejects(review({}), e => e.statusCode === 409);
    assert.equal(f.snapshot().output_reviews.length, 1, 'old approval is retained');
    assert.equal(f.db.prepare('SELECT status FROM tasks WHERE id=?').get('task').status, 'backlog', 'review does not silently complete route');
  } finally { f.db.close(); }
});
test('change requests create exactly one linked revision route and do not dispatch', async () => {
  const f = fixture(); try {
    const out = (await f.output()).result, version = f.snapshot().output_versions[0];
    const body = { version: out.version, version_id: version.id, decision: 'changes_requested', reviewer_name: 'Evan', feedback: 'Include source evidence' };
    const review = (await f.call(`outputs/${out.id}/review`, body)).result;
    const route = f.db.prepare('SELECT * FROM tasks WHERE id=?').get(review.revision_task_id);
    assert.equal(route.status, 'ready'); assert.match(route.description, /Include source evidence/);
    assert.equal(f.snapshot().route_workflows.find(row => row.id === route.id).parent_task_id, 'task');
    await assert.rejects(f.call(`outputs/${out.id}/review`, body), e => e.statusCode === 409);
    assert.equal(f.db.prepare('SELECT count(*) n FROM runs').get().n, 0);
    assert.equal(f.snapshot().output_reviews.length, 1);
  } finally { f.db.close(); }
});
test('comments anchor an exact version and quote, and resolution is reversible', async () => {
  const f = fixture(); try {
    const out = (await f.output()).result, version = f.snapshot().output_versions[0];
    const comment = (await f.call(`outputs/${out.id}/comments`, { version_id: version.id, anchor: 'First', content: 'Please clarify' })).result;
    await assert.rejects(f.call(`outputs/${out.id}/comments`, { version_id: version.id, anchor: 'Not present', content: 'Bad quote' }), /does not occur/);
    await f.call(`comments/${comment.id}`, { resolved: true }, 'PATCH'); assert.ok(f.snapshot().output_comments[0].resolved_at);
    await f.call(`comments/${comment.id}`, { resolved: false }, 'PATCH'); assert.equal(f.snapshot().output_comments[0].resolved_at, null);
    await f.call(`outputs/${out.id}/versions`, { version: 1, content: 'New draft' });
    assert.equal(f.snapshot().output_comments[0].version_id, version.id);
  } finally { f.db.close(); }
});
test('context snapshots are immutable, scoped, and attach as idempotent notes without agents', async () => {
  const f = fixture(); try {
    const context = (await f.call('context', { workspace_id: 'ws', project_id: 'project', name: 'Reviewed brief', sources: [{ type: 'documents', id: 'doc' }] })).result;
    f.db.prepare('UPDATE documents SET content=?,updated_at=? WHERE id=?').run('New source', 'later', 'doc');
    assert.match(f.snapshot().context_snapshots[0].content, /Original source/);
    assert.ok(context.sources[0].hash); assert.ok(context.content_hash);
    await assert.rejects(f.call('context', { workspace_id: 'ws', name: 'Bad', sources: [{ type: 'documents', id: 'secret' }] }), /same workspace/);
    await assert.rejects(f.call(`context/${context.id}/attach-chat`, { chat_id: 'foreignchat' }), /same workspace/);
    const first = (await f.call(`context/${context.id}/attach-chat`, { chat_id: 'chat' })).result;
    const second = (await f.call(`context/${context.id}/attach-chat`, { chat_id: 'chat' })).result;
    assert.equal(first.message_id, second.message_id);
    assert.equal(f.db.prepare('SELECT kind FROM messages WHERE id=?').get(first.message_id).kind, 'note');
    assert.equal(f.db.prepare('SELECT count(*) n FROM runs').get().n, 0);
  } finally { f.db.close(); }
});
test('knowledge lifecycle, review dates and concurrency guard approved context', async () => {
  const f = fixture(); try {
    const entry = (await f.call('knowledge', { workspace_id: 'ws', title: 'Decision', content: 'Use explicit approval', source: 'Project review', review_date: '2026-12-01' })).result;
    await assert.rejects(f.call('context', { workspace_id: 'ws', name: 'Draft', sources: [{ type: 'knowledge_entries', id: entry.id }] }), /approved knowledge/);
    await f.call(`knowledge/${entry.id}`, { version: 1, state: 'approved' }, 'PATCH');
    await assert.rejects(f.call(`knowledge/${entry.id}`, { version: 1, state: 'superseded' }, 'PATCH'), e => e.statusCode === 409);
    await f.call('context', { workspace_id: 'ws', name: 'Approved', sources: [{ type: 'knowledge_entries', id: entry.id }] });
    await f.call(`knowledge/${entry.id}`, { version: 2, state: 'superseded' }, 'PATCH');
    assert.equal(f.snapshot().context_snapshots[0].sources[0].id, entry.id);
    await assert.rejects(f.call('knowledge', { workspace_id: 'ws', title: 'Bad date', content: 'Bad', review_date: '2026-02-31' }), /valid review date/);
  } finally { f.db.close(); }
});
test('project strategy validates health reasons, concern identities and milestone criteria', async () => {
  const f = fixture(); try {
    await assert.rejects(f.call('projects/project', { version: 0, health: 'blocked' }, 'PATCH'), /Explain why/);
    const plan = (await f.call('projects/project', { version: 0, audience: 'Builders', success: 'Accepted output', health: 'at_risk', health_reason: 'Waiting for evidence', concerns: [{ id: 'risk', kind: 'risk', content: 'Source freshness', owner: 'Evan', state: 'open' }] }, 'PATCH')).result;
    assert.equal(plan.concerns.length, 1); assert.equal(plan.version, 1);
    await assert.rejects(f.call('projects/project', { version: 0 }, 'PATCH'), e => e.statusCode === 409);
    await f.call('milestones/milestone', { version: 0, acceptance: [{ id: 'a', text: 'Reviewed', done: false }] }, 'PATCH');
    assert.equal(f.snapshot().milestone_contracts[0].acceptance[0].done, false);
  } finally { f.db.close(); }
});
test('editing approved knowledge resets its approval and preserves the previous text in revision history', async () => {
  const f = fixture(); try {
    const entry = (await f.call('knowledge', { workspace_id: 'ws', title: 'Decision', content: 'Original', state: 'approved' })).result;
    const next = (await f.call(`knowledge/${entry.id}`, { version: 1, content: 'Changed', state: 'approved' }, 'PATCH')).result;
    assert.equal(next.state, 'draft');
    const history = f.db.prepare('SELECT before_json,after_json FROM change_log WHERE entity_id=?').all(entry.id);
    assert.equal(history.length, 2);
    assert.ok(history.some(row => row.before_json && JSON.parse(row.before_json).content === 'Original' && JSON.parse(row.after_json).content === 'Changed'));
    await assert.rejects(f.call('context', { workspace_id: 'ws', name: 'Changed', sources: [{ type: 'knowledge_entries', id: entry.id }] }), /approved knowledge/);
    const approved = (await f.call(`knowledge/${entry.id}`, { version: 2, state: 'approved' }, 'PATCH')).result;
    assert.equal(approved.state, 'approved');
  } finally { f.db.close(); }
});
test('archived outputs reject edits and can be restored without losing history', async () => {
  const f = fixture(); try {
    const out = (await f.output()).result;
    await f.call(`outputs/${out.id}`, { version: 1, archived: true }, 'PATCH');
    await assert.rejects(f.call(`outputs/${out.id}/versions`, { version: 2, content: 'Not allowed' }), /active/);
    await f.call(`outputs/${out.id}`, { version: 2, archived: false }, 'PATCH');
    assert.equal(f.snapshot().outputs[0].archived_at, null); assert.equal(f.snapshot().output_versions.length, 1);
  } finally { f.db.close(); }
});

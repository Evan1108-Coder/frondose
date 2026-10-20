import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { installWorkflow } from '../server/workflow-service.mjs';
import { installActivity } from '../server/activity-service.mjs';
import { installChatCollaboration } from '../server/chat-collaboration.mjs';
import { captureSourceAccess, assertSourceAccess, assertFrondoseSourceReferences } from '../server/context-source-access.mjs';
import { readFrondoseSource, assertFrondoseChatSource } from '../server/frondose-agent-service.mjs';
import { createAccessBoundary } from '../server/access-boundary.mjs';

function fixture(t) {
  // No files, credentials, provider process or user workspace is involved.
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  for (const table of ['workspaces', 'projects', 'chats', 'agents', 'memory_notes']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === 'archived_at')) db.exec(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
  }
  if (!db.prepare('PRAGMA table_info(projects)').all().some(row => row.name === 'team_id')) db.exec('ALTER TABLE projects ADD COLUMN team_id TEXT REFERENCES teams(id)');
  installWorkflow(db); installActivity(db); installChatCollaboration(db);
  db.exec('CREATE TABLE governance_members(workspace_id TEXT,id TEXT,status TEXT,rank TEXT)');
  db.exec("INSERT INTO governance_members VALUES('workspace','reviewer','active','Member')");
  const now = '2026-09-26T00:00:00Z', actor = { id: 'reviewer' };
  db.prepare('INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run('workspace', 'Fixture', 'fixture', now, now);
  for (const id of ['area-before', 'area-after']) db.prepare('INSERT INTO teams(id,workspace_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, 'workspace', id, now, now);
  db.prepare('INSERT INTO projects(id,workspace_id,team_id,name,identifier,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('project', 'workspace', 'area-before', 'Project', 'PRO', now, now);
  db.prepare('INSERT INTO documents(id,workspace_id,project_id,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('document', 'workspace', 'project', 'Protected source', 'SOURCE_CONTENT', now, now);
  const row = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  function bind(chatId, source) {
    db.prepare('INSERT INTO chats(id,workspace_id,project_id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(chatId, 'workspace', 'project', chatId, 'rumbo-agent', now, now);
    const kind = { document: 'documents', update: 'activity' }[source.type];
    const source_access = captureSourceAccess(db, { manifest: { resolved: { workspace_id: 'workspace' }, included: [{ kind, id: source.id }], excluded: [] } });
    db.prepare('INSERT INTO chat_collaboration VALUES(?,?,?,?,?)').run(chatId, 'workspace', 1, JSON.stringify({ rumbo_source: { source, source_access } }), now);
    return row('chats', chatId);
  }
  function message(id, chatId = 'chat') {
    db.prepare('INSERT INTO messages(id,chat_id,sender_type,sender_name,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, chatId, 'agent', 'Fixture agent', 'DERIVED_MESSAGE', now, now);
    return row('messages', id);
  }
  function update(id, chatId = 'chat') {
    db.prepare('INSERT INTO activity_entries(id,workspace_id,target_type,target_id,update_type,actor_type,actor_id,actor_name,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, 'workspace', 'chat', chatId, 'comment', 'user', actor.id, 'Reviewer', 'DERIVED_UPDATE', now, now);
    return row('activity_entries', id);
  }
  const chat = bind('chat', { type: 'document', id: 'document' });
  const capture = (kind, id) => {
    const inspection = { manifest: { resolved: { workspace_id: 'workspace' }, included: [{ kind, id }], excluded: [] } };
    return { ...inspection, sourceAccess: captureSourceAccess(db, inspection) };
  };
  function indexedRun() {
    db.prepare('DELETE FROM chat_collaboration WHERE chat_id=?').run('chat');
    db.exec('CREATE TABLE IF NOT EXISTS run_context_snapshots(run_id TEXT PRIMARY KEY, inspection_json TEXT NOT NULL)');
    const indexed = capture('document', 'document');
    indexed.manifest.resolved.chat_id = 'chat';
    indexed.manifest.workspace_index = { enabled: true };
    db.prepare('INSERT INTO runs(id,workspace_id,chat_id,provider,agent_name,status,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('indexed-run', 'workspace', 'chat', 'codex', 'Fixture agent', 'completed', 'Indexed run', now, now);
    db.prepare('INSERT INTO run_context_snapshots(run_id,inspection_json) VALUES(?,?)').run('indexed-run', JSON.stringify(indexed));
    return row('runs', 'indexed-run');
  }
  const revokeHistoricalArea = (_workspace, _actor, permission, scope = {}) => !(permission === 'documents.read' && scope.scope_id === 'area-before');
  const move = () => db.prepare('UPDATE projects SET team_id=? WHERE id=?').run('area-after', 'project');
  t.after(() => db.close());
  return { db, now, actor, chat, row, bind, message, update, capture, indexedRun, move, revokeHistoricalArea };
}

test('a source move cannot erase captured document permission at the historical Area', t => {
  const f = fixture(t);
  f.message('message');
  const before = f.capture('message', 'message');
  f.move();
  assert.equal(readFrondoseSource(f.db, 'workspace', { type: 'document', id: 'document' }, f.actor, f.revokeHistoricalArea).row.id, 'document', 'the current direct source remains readable');
  assert.throws(() => assertFrondoseChatSource(f.db, f.chat, f.actor, f.revokeHistoricalArea), error => error.statusCode === 403);
  for (const inspection of [before, f.capture('message', 'message')]) {
    assert.equal(assertSourceAccess(f.db, inspection, f.actor, () => true), true);
    assert.throws(() => assertSourceAccess(f.db, inspection, f.actor, f.revokeHistoricalArea), error => error.statusCode === 403);
  }
});

test('an update from a source-bound chat carries its original source into a second chat', t => {
  const f = fixture(t);
  f.update('update');
  const second = f.bind('second-chat', { type: 'update', id: 'update' });
  f.message('second-message', second.id);
  const inspection = f.capture('message', 'second-message');
  assert.ok(inspection.sourceAccess.sources.some(row => row.table === 'documents' && row.id === 'document'));
  f.move();
  assert.throws(() => assertFrondoseChatSource(f.db, second, f.actor, f.revokeHistoricalArea), error => error.statusCode === 403);
  assert.throws(() => assertSourceAccess(f.db, inspection, f.actor, f.revokeHistoricalArea), error => error.statusCode === 403);
});

test('an update from an index-only chat retains indexed sources when reused in a second chat', t => {
  const f = fixture(t);
  f.indexedRun();
  const update = f.update('indexed-update');
  assert.equal(assertFrondoseSourceReferences(f.db, update, 'activity_entries', f.actor, () => true), true);
  const second = f.bind('second-chat', { type: 'update', id: update.id });
  f.message('second-message', second.id);
  const inspection = f.capture('message', 'second-message');
  f.move();
  assert.throws(() => assertFrondoseSourceReferences(f.db, update, 'activity_entries', f.actor, f.revokeHistoricalArea), error => error.statusCode === 403, 'the chat-target update must retain indexed-source read guards');
  assert.throws(() => assertFrondoseChatSource(f.db, second, f.actor, f.revokeHistoricalArea), error => error.statusCode === 403, 'a second conversation must not launder indexed context through an update');
  assert.throws(() => assertSourceAccess(f.db, inspection, f.actor, f.revokeHistoricalArea), error => error.statusCode === 403, 'captured downstream history must retain indexed-source provenance');
});

test('later indexed turns do not retroactively widen a published update revision', t => {
  const f = fixture(t);
  f.indexedRun();
  const update = f.update('earlier-update'), before = f.capture('activity', update.id);
  f.db.prepare('INSERT INTO documents(id,workspace_id,team_id,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('later-document', 'workspace', 'area-after', 'Later context', 'LATER_CONTENT', f.now, f.now);
  const later = f.capture('document', 'later-document');
  later.manifest.resolved.chat_id = 'chat';
  later.manifest.workspace_index = { enabled: true };
  const laterAt = '2026-09-26T00:00:01Z';
  f.db.prepare('INSERT INTO runs(id,workspace_id,chat_id,provider,agent_name,status,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('later-run', 'workspace', 'chat', 'codex', 'Fixture agent', 'completed', 'Later indexed run', laterAt, laterAt);
  f.db.prepare('INSERT INTO run_context_snapshots(run_id,inspection_json) VALUES(?,?)').run('later-run', JSON.stringify(later));
  const permittedBeforeOnly = (_workspace, _actor, permission, scope = {}) => !(permission === 'documents.read' && scope.scope_id === 'area-after');
  const after = f.capture('activity', update.id);
  assert.equal(after.sourceAccess.sources.some(row => row.id === 'later-document' || row.id === 'later-run'), false);
  assert.deepEqual(after.sourceAccess, before.sourceAccess, 'context ancestry remains stable rather than recursively absorbing later chat turns');
  assert.equal(assertFrondoseSourceReferences(f.db, update, 'activity_entries', f.actor, permittedBeforeOnly), true);
  assert.equal(assertSourceAccess(f.db, before, f.actor, permittedBeforeOnly), true);
});

test('copied indexed run, output and message context keep the original indexed-source restrictions', t => {
  const f = fixture(t), run = f.indexedRun();
  f.message('indexed-message');
  f.db.prepare('UPDATE messages SET metadata_json=? WHERE id=?').run(JSON.stringify({ run_id: run.id }), 'indexed-message');
  f.db.prepare('INSERT INTO outputs(id,workspace_id,project_id,chat_id,run_id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('indexed-output', 'workspace', 'project', 'chat', run.id, 'Indexed output', 'document', f.now, f.now);
  const captures = [f.capture('run', run.id), f.capture('output', 'indexed-output'), f.capture('message', 'indexed-message')];
  const inherited = f.capture('message', 'indexed-message');
  inherited.manifest.resolved.chat_id = 'chat';
  inherited.manifest.workspace_index = { enabled: false };
  f.db.prepare('INSERT INTO runs(id,workspace_id,chat_id,provider,agent_name,status,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('inherited-run', 'workspace', 'chat', 'codex', 'Fixture agent', 'completed', 'History-only run', f.now, f.now);
  f.db.prepare('INSERT INTO run_context_snapshots(run_id,inspection_json) VALUES(?,?)').run('inherited-run', JSON.stringify(inherited));
  captures.push(f.capture('run', 'inherited-run'));
  for (const inspection of captures) assert.equal(assertSourceAccess(f.db, inspection, f.actor, () => true), true);
  f.move();
  for (const inspection of captures) {
    const source = inspection.manifest.included[0];
    assert.throws(() => assertSourceAccess(f.db, inspection, f.actor, f.revokeHistoricalArea), error => error.statusCode === 403, `copying ${source.kind}:${source.id} must not drop the indexed source boundary`);
  }
});

test('self-owned run identity retains source and connection guards while cross-run cycles fail', t => {
  const f = fixture(t), run = f.indexedRun();
  const self = f.capture('run', run.id);
  self.manifest.resolved.agent_id = 'fixture-agent';
  self.sourceAccess.connections.push({ id: 'fixture-connection', workspace_id: 'workspace', scope: { scope_type: 'workspace', scope_id: 'workspace' }, provider: 'github', selected_resources: ['repo'], actions: ['read'], objects: [], requires_read: true });
  f.db.exec('CREATE TABLE platform_connections(id TEXT PRIMARY KEY,workspace_id TEXT,scope_type TEXT,scope_id TEXT,provider TEXT,state TEXT,settings TEXT)');
  f.db.prepare('INSERT INTO platform_connections VALUES(?,?,?,?,?,?,?)').run('fixture-connection', 'workspace', 'workspace', 'workspace', 'github', 'connected', JSON.stringify({ selected_resources: ['repo'], enabled_features: ['read'], agent_access: true, allowed_agent_ids: ['fixture-agent'] }));
  f.db.prepare('UPDATE run_context_snapshots SET inspection_json=? WHERE run_id=?').run(JSON.stringify(self), run.id);
  const permissionCalls = new Map();
  assert.equal(assertSourceAccess(f.db, self, f.actor, (workspace, _actor, permission, scope) => {
    const key = JSON.stringify([workspace, permission, scope]);
    permissionCalls.set(key, (permissionCalls.get(key) || 0) + 1);
    return true;
  }), true, 'a captured run may include its own identity');
  assert.ok(permissionCalls.size > 0);
  assert.ok([...permissionCalls.values()].every(count => count === 1), 'identical permission decisions are reused only inside this synchronous traversal');
  for (const deniedPermission of ['documents.read', 'agents.read', 'connections.read']) {
    assert.throws(() => assertSourceAccess(f.db, self, f.actor, (_workspace, _actor, permission) => permission !== deniedPermission), error => error.statusCode === 403, `${deniedPermission} is checked despite the self-reference`);
  }
  f.db.prepare('UPDATE platform_connections SET state=? WHERE id=?').run('disconnected', 'fixture-connection');
  assert.throws(() => assertSourceAccess(f.db, self, f.actor, () => true), error => error.statusCode === 403, 'self-reference does not bypass connection revocation');

  // Build both immutable captures before inserting either, so the only cycle
  // is the deliberate A → B → A dependency, not copied fixture metadata.
  f.db.exec('DELETE FROM run_context_snapshots');
  f.db.prepare('INSERT INTO runs(id,workspace_id,chat_id,provider,agent_name,status,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('other-run', 'workspace', 'chat', 'codex', 'Fixture agent', 'completed', 'Other run', f.now, f.now);
  const a = f.capture('run', 'other-run'), b = f.capture('run', run.id);
  for (const [id, capture] of [[run.id, a], ['other-run', b]]) f.db.prepare('INSERT INTO run_context_snapshots(run_id,inspection_json) VALUES(?,?)').run(id, JSON.stringify(capture));
  assert.throws(() => assertSourceAccess(f.db, a, f.actor, () => true), error => error.statusCode === 403, 'cross-run cycles still fail closed');
});

test('output children, chat updates and historical metadata retain source guards after an Area move', t => {
  const f = fixture(t);
  f.message('message'); f.update('update');
  f.db.prepare('INSERT INTO outputs(id,workspace_id,project_id,chat_id,source_message_id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('output', 'workspace', 'project', 'chat', 'message', 'Output', 'document', f.now, f.now);
  f.db.prepare('INSERT INTO output_versions(id,output_id,workspace_id,number,content,author_name,created_at) VALUES(?,?,?,?,?,?,?)').run('version', 'output', 'workspace', 1, 'DERIVED_VERSION', 'Fixture', f.now);
  f.db.prepare('INSERT INTO output_comments(id,output_id,workspace_id,version_id,content,author_name,created_at) VALUES(?,?,?,?,?,?,?)').run('comment', 'output', 'workspace', 'version', 'DERIVED_COMMENT', 'Fixture', f.now);
  f.db.prepare('INSERT INTO output_reviews(id,output_id,workspace_id,version_id,decision,reviewer_name,feedback,created_at) VALUES(?,?,?,?,?,?,?,?)').run('review', 'output', 'workspace', 'version', 'changes_requested', 'Fixture', 'DERIVED_REVIEW', f.now);
  const collections = ['chats', 'messages', 'outputs', 'output_versions', 'output_comments', 'output_reviews', 'activity_entries'];
  const data = Object.fromEntries(collections.map(table => [table, f.db.prepare(`SELECT * FROM ${table}`).all()]));
  const history = { id: 'history', workspace_id: 'workspace', entity_type: 'outputs', entity_id: 'output', before: data.outputs[0], after: { ...data.outputs[0], title: 'Changed title' } };
  assert.equal(assertFrondoseSourceReferences(f.db, history, 'audit_log', f.actor, () => true), true);
  f.move();
  const governance = { explain: (workspace, actorId, permission, scope) => ({ allowed: f.revokeHistoricalArea(workspace, { id: actorId }, permission, scope) }) };
  const access = createAccessBoundary({ db: f.db, governance });
  const filtered = access.filter(data, f.actor);
  for (const collection of collections) assert.equal(filtered[collection].length, 0, `${collection} must not reveal derived contents`);
  assert.throws(() => assertFrondoseSourceReferences(f.db, history, 'audit_log', f.actor, f.revokeHistoricalArea), error => error.statusCode === 403);
});

function snapshotMessage(f) {
  // Use an ordinary chat so no Frondose binding/index can accidentally supply the
  // missing dependency under test. The private lineage is server-captured.
  f.db.prepare('DELETE FROM chat_collaboration WHERE chat_id=?').run('chat');
  const inspection = { manifest: { resolved: { workspace_id: 'workspace', chat_id: 'chat' }, included: [{ kind: 'document', id: 'document' }], excluded: [] } };
  const sourceAccess = captureSourceAccess(f.db, inspection), snapshotId = 'immutable-chat-snapshot';
  f.db.prepare('INSERT INTO chat_context_snapshots(id,workspace_id,chat_id,content,sources_json,created_at,source_access_json) VALUES(?,?,?,?,?,?,?)')
    .run(snapshotId, 'workspace', 'chat', 'COPIED_SOURCE_CONTENT', JSON.stringify([{ kind: 'document', id: 'document' }]), f.now, JSON.stringify(sourceAccess));
  f.message('snapshot-message');
  const file = { name: `frondose-context-${snapshotId}.md`, type: 'text/markdown', content: 'COPIED_SOURCE_CONTENT', rumbo_context_snapshot: snapshotId };
  f.db.prepare("UPDATE messages SET sender_type='user',metadata_json=?,attachments_json=? WHERE id=?")
    .run(JSON.stringify({ context_snapshot_id: snapshotId }), JSON.stringify([file]), 'snapshot-message');
  return { snapshotId, file, message: f.row('messages', 'snapshot-message') };
}

test('historical snapshot attachments preserve source ancestry through later run and scheduled inspections', t => {
  const f = fixture(t), saved = snapshotMessage(f);
  const attachmentInspection = { manifest: { resolved: { workspace_id: 'workspace', chat_id: 'chat' }, included: [{ kind: 'attachment', id: 'snapshot-message:0' }], excluded: [] } };
  attachmentInspection.sourceAccess = captureSourceAccess(f.db, attachmentInspection);
  assert.ok(attachmentInspection.sourceAccess.sources.some(ref => ref.table === 'documents' && ref.id === 'document'));
  assert.equal(assertSourceAccess(f.db, attachmentInspection, f.actor, () => true), true);
  f.db.exec('CREATE TABLE run_context_snapshots(run_id TEXT PRIMARY KEY, inspection_json TEXT NOT NULL)');
  f.db.prepare('INSERT INTO runs(id,workspace_id,chat_id,provider,agent_name,status,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('historical-run', 'workspace', 'chat', 'openrouter', 'Fixture', 'completed', 'Derived from attachment', f.now, f.now);
  f.db.prepare('INSERT INTO run_context_snapshots VALUES(?,?)').run('historical-run', JSON.stringify(attachmentInspection));
  const scheduleReview = JSON.parse(JSON.stringify({ inspection: attachmentInspection }));
  f.move();
  assert.throws(() => assertSourceAccess(f.db, scheduleReview.inspection, f.actor, f.revokeHistoricalArea), { code: 'context_access_revoked' }, 'due-time schedule review cannot drop the captured Area');
  for (const inspection of [attachmentInspection, f.capture('message', saved.message.id), f.capture('run', 'historical-run')]) assert.throws(() => assertSourceAccess(f.db, inspection, f.actor, f.revokeHistoricalArea), { code: 'context_access_revoked' });
  const governance = { explain: (workspace, actorId, permission, scope) => ({ allowed: f.revokeHistoricalArea(workspace, { id: actorId }, permission, scope) }) };
  const access = createAccessBoundary({ db: f.db, governance });
  const filtered = access.filter({ messages: [f.row('messages', saved.message.id)], runs: [f.row('runs', 'historical-run')] }, f.actor);
  assert.equal(filtered.messages.length, 0, 'presentation must not expose the copied attachment after revocation');
  assert.equal(filtered.runs.length, 0, 'derived run metadata remains protected');
});

test('historical snapshot lineage checks current source permissions as well as the captured Area', t => {
  const f = fixture(t); snapshotMessage(f);
  const inspection = f.capture('message', 'snapshot-message');
  f.move();
  const revokeCurrentArea = (_workspace, _actor, permission, scope = {}) => !(permission === 'documents.read' && scope.scope_id === 'area-after');
  assert.throws(() => assertSourceAccess(f.db, inspection, f.actor, revokeCurrentArea), { code: 'context_access_revoked' });
  assert.throws(() => assertFrondoseSourceReferences(f.db, f.row('messages', 'snapshot-message'), 'messages', f.actor, revokeCurrentArea), { code: 'context_access_revoked' });
});

test('historical markers and caller JSON cannot forge snapshot authority; missing legacy lineage fails closed', t => {
  const f = fixture(t), saved = snapshotMessage(f);
  const original = f.row('messages', saved.message.id);
  const updates = [
    { metadata_json: '{}', attachments_json: original.attachments_json },
    { metadata_json: original.metadata_json, attachments_json: JSON.stringify([{ ...saved.file, content: 'forged' }]) },
    { metadata_json: original.metadata_json, attachments_json: JSON.stringify([{ ...saved.file, name: 'forged.md' }]) },
  ];
  for (const changed of updates) {
    f.db.prepare('UPDATE messages SET metadata_json=?,attachments_json=? WHERE id=?').run(changed.metadata_json, changed.attachments_json, original.id);
    assert.throws(() => f.capture('message', original.id), { code: 'context_access_revoked' });
  }
  f.db.prepare('UPDATE messages SET metadata_json=?,attachments_json=? WHERE id=?').run(original.metadata_json, original.attachments_json, original.id);
  f.db.prepare('UPDATE chat_context_snapshots SET source_access_json=NULL WHERE id=?').run(saved.snapshotId);
  assert.throws(() => f.capture('message', original.id), { code: 'context_access_revoked' });
  assert.throws(() => assertFrondoseSourceReferences(f.db, { ...original, metadata: { sourceAccess: { sources: [] } }, attachments: [] }, 'messages', f.actor, () => true), { code: 'context_access_revoked' }, 'client-transformed JSON cannot override canonical stored lineage');
});

test('ordinary historical text attachments do not become workspace-source authority', t => {
  const f = fixture(t);
  f.db.prepare('DELETE FROM chat_collaboration WHERE chat_id=?').run('chat');
  f.message('own-note');
  f.db.prepare('UPDATE messages SET attachments_json=? WHERE id=?').run(JSON.stringify([{ name: 'own.md', type: 'text/markdown', content: '{"sourceAccess":{"sources":[]}} document:document' }]), 'own-note');
  const inspection = f.capture('message', 'own-note');
  assert.equal(inspection.sourceAccess.sources.some(ref => ref.table === 'documents'), false);
  assert.equal(assertSourceAccess(f.db, inspection, f.actor, (_workspace, _actor, permission) => permission !== 'documents.read'), true);
});

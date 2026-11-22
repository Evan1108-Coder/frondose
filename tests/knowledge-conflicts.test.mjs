import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { installWorkflow } from '../server/workflow-service.mjs';
import { installSkills } from '../server/skills-service.mjs';
import { installWorkspaceFeatures } from '../server/workspace-features.mjs';
import { installKnowledgeConflicts, knowledgeConflictRoute, getKnowledgeConflictWarnings } from '../server/knowledge-conflicts.mjs';
import { createLocalApi } from './fixtures/legacy-account-api.mjs';

const time = '2026-09-24T12:00:00.000Z';
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  installWorkflow(db); installSkills(db); installWorkspaceFeatures(db); installKnowledgeConflicts(db);
  if (!db.prepare('PRAGMA table_info(projects)').all().some(row => row.name === 'team_id')) db.exec('ALTER TABLE projects ADD COLUMN team_id TEXT');
  db.exec('PRAGMA foreign_keys=ON');
  for (const id of ['ws', 'foreign']) db.prepare('INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, id, id, time, time);
  for (const id of ['original-area', 'later-area']) db.prepare('INSERT INTO teams(id,workspace_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, 'ws', id, time, time);
  for (const id of ['project', 'other-project']) db.prepare('INSERT INTO projects(id,workspace_id,name,identifier,team_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, 'ws', id, id, 'original-area', time, time);
  const actor = { id: 'human', name: 'Fixture reviewer', mode: 'account' };
  const denied = new Set();
  const allowed = (ws, who, permission, scope = {}) => ws === 'ws' && who?.id === actor.id && !denied.has(`${permission}:${scope.scope_type || ''}:${scope.scope_id || ''}`);
  const note = (id, options = {}) => {
    const row = { id, workspace_id: 'ws', project_id: 'project', title: 'Review policy', kind: 'fact', content: `Claim ${id}`, source: 'Unverified free text source', state: 'approved', review_date: '', version: 1, archived_at: null, created_at: time, updated_at: time, ...options };
    db.prepare('INSERT INTO knowledge_entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row)); return row;
  };
  note('left'); note('right');
  const call = async (method, path, body, options = {}) => {
    const url = new URL(`http://localhost${path}`); let response;
    const handled = await knowledgeConflictRoute({ db, req: { method }, res: {}, path: url.pathname, url, body, send(_res, status, payload) { response = { status, ...payload }; }, actor, allowed, filter: data => data, ...options });
    assert.equal(handled, true); assert.ok(response); return response;
  };
  const report = (extra = {}, options) => call('POST', '/knowledge-conflicts', { workspace_id: 'ws', left_id: 'left', left_version: 1, right_id: 'right', right_version: 1, reason: 'These claims appear inconsistent in this context.', request_id: 'report-1', ...extra }, options);
  const decision = (id, extra = {}, options) => call('POST', `/knowledge-conflicts/${id}/decision`, { decision: 'keep_both', rationale: 'Different applicable circumstances were verified manually.', confirmed: true, request_id: 'decision-1', ...extra }, options);
  return { db, actor, denied, allowed, call, note, report, decision };
}

test('manual conflict reports pin immutable exact claims and never modify or automatically approve knowledge', async t => {
  const f = fixture(t), before = f.db.prepare('SELECT * FROM knowledge_entries ORDER BY id').all();
  const created = await f.report(); assert.equal(created.status, 201);
  assert.equal(created.result.conflict.status, 'open'); assert.equal(created.result.conflict.freshness, 'current');
  assert.equal(created.result.left.content, 'Claim left'); assert.match(created.result.left.content_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(created.result.conflict.reported_by, { id: 'human', name: 'Fixture reviewer' });
  assert.deepEqual(f.db.prepare('SELECT * FROM knowledge_entries ORDER BY id').all(), before);
  const replay = await f.report(); assert.equal(replay.status, 200); assert.equal(replay.replayed, true); assert.equal(replay.result.conflict.id, created.result.conflict.id);
  assert.throws(() => f.db.prepare("UPDATE knowledge_conflicts SET reason='Forged'").run(), /immutable/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM runs').get().n, 0);
});

test('explicit superseding changes only the selected exact version and records a current immutable decision', async t => {
  const f = fixture(t), created = await f.report(), id = created.result.conflict.id;
  const rightBefore = f.db.prepare("SELECT * FROM knowledge_entries WHERE id='right'").get();
  const decided = await f.decision(id, { decision: 'supersede_left' });
  assert.equal(decided.status, 201); assert.equal(decided.result.conflict.status, 'resolved'); assert.equal(decided.result.conflict.freshness, 'current');
  assert.equal(decided.result.left.state, 'approved', 'Captured original remains immutable');
  assert.equal(decided.result.decision.left_after_version, 2);
  assert.equal(f.db.prepare("SELECT state FROM knowledge_entries WHERE id='left'").get().state, 'superseded');
  assert.deepEqual(f.db.prepare("SELECT * FROM knowledge_entries WHERE id='right'").get(), rightBefore);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM change_log WHERE entity_id='left'").get().n, 1);
  assert.equal((await f.decision(id, { decision: 'supersede_left' })).replayed, true);
  assert.equal(f.db.prepare("SELECT version FROM knowledge_entries WHERE id='left'").get().version, 2);
  assert.throws(() => f.db.prepare("UPDATE knowledge_conflict_decisions SET decision='keep_both'").run(), /immutable/);
  await assert.rejects(f.decision(id, { request_id: 'another-decision' }), { statusCode: 409, errorCode: 'already_resolved' });
});

test('keep-both is a human review disposition and leaves both approved claim records unchanged', async t => {
  const f = fixture(t), created = await f.report(), before = f.db.prepare('SELECT * FROM knowledge_entries ORDER BY id').all();
  const decided = await f.decision(created.result.conflict.id);
  assert.equal(decided.result.decision.decision, 'keep_both'); assert.equal(decided.result.conflict.freshness, 'current');
  assert.deepEqual(f.db.prepare('SELECT * FROM knowledge_entries ORDER BY id').all(), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM change_log').get().n, 0);
});

test('stale versions and changed content without a version bump both block resolution atomically', async t => {
  const f = fixture(t);
  await assert.rejects(f.report({ left_version: 9 }), { errorCode: 'stale_knowledge', statusCode: 409 });
  const created = await f.report();
  f.db.prepare("UPDATE knowledge_entries SET content='Changed without version' WHERE id='left'").run();
  const detail = await f.call('GET', `/knowledge-conflicts/${created.result.conflict.id}`);
  assert.equal(detail.result.conflict.freshness, 'stale'); assert.equal(detail.result.left.content, 'Claim left');
  await assert.rejects(f.decision(created.result.conflict.id, { decision: 'supersede_right' }), { errorCode: 'stale_knowledge', statusCode: 409 });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM knowledge_conflict_decisions').get().n, 0);
  assert.equal(f.db.prepare("SELECT state FROM knowledge_entries WHERE id='right'").get().state, 'approved');
});

test('same-key replay reauthorizes current and captured historical permissions, and hidden pairs do not affect list counts', async t => {
  const f = fixture(t), created = await f.report();
  f.db.prepare("UPDATE projects SET team_id='later-area' WHERE id='project'").run();
  f.denied.add('documents.read:team:original-area');
  await assert.rejects(f.report(), { statusCode: 403 });
  await assert.rejects(f.call('GET', `/knowledge-conflicts/${created.result.conflict.id}`), { statusCode: 403 });
  const listed = await f.call('GET', '/knowledge-conflicts?workspace_id=ws&status=all');
  assert.deepEqual(listed.result, { conflicts: [], has_more: false });
  f.denied.clear(); await f.decision(created.result.conflict.id);
  f.denied.add('documents.write:project:project');
  await assert.rejects(f.decision(created.result.conflict.id), { statusCode: 403 });
});

test('human identity, both scoped writes, workspace isolation, approved state and strict request fields are enforced', async t => {
  const f = fixture(t);
  for (const extra of [{ reported_by: 'fake' }, { source_access_json: '{}' }, { left_version: '1' }, { left_id: 'right' }, { reason: ' ' }]) await assert.rejects(f.report(extra), { statusCode: 400 });
  await assert.rejects(f.report({}, { actor: { ...f.actor, mode: 'agent' } }), { statusCode: 403 });
  f.note('foreign-note', { workspace_id: 'foreign', project_id: null });
  await assert.rejects(f.report({ right_id: 'foreign-note' }), { statusCode: 403 });
  f.denied.add('documents.write:project:project'); await assert.rejects(f.report(), { statusCode: 403 }); f.denied.clear();
  f.db.prepare("UPDATE knowledge_entries SET state='draft' WHERE id='right'").run();
  await assert.rejects(f.report(), { statusCode: 409 });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM knowledge_conflicts').get().n, 0);
});

test('candidate scan normalizes only titles and requires exact project/kind match with different content', async t => {
  const f = fixture(t);
  f.db.prepare("UPDATE knowledge_entries SET title='  REVIEW   POLICY  ' WHERE id='right'").run();
  f.note('same-content', { content: 'Claim left' });
  f.note('different-kind', { kind: 'instruction' }); f.note('different-project', { project_id: 'other-project' });
  f.note('draft', { state: 'draft' }); f.note('archived', { archived_at: time });
  const before = f.db.prepare('SELECT total_changes() n').get().n;
  const scanned = (await f.call('GET', '/knowledge-conflicts/candidates?workspace_id=ws')).result;
  assert.equal(scanned.scanned_count, 5); assert.equal(scanned.candidates.length, 2);
  assert(scanned.candidates.every(row => row.left.kind === row.right.kind && row.left.project_id === row.right.project_id));
  assert(scanned.candidates.every(row => /possible conflict, not verified contradiction/.test(row.label)));
  assert(!JSON.stringify(scanned).includes('Claim left')); assert.equal(f.db.prepare('SELECT total_changes() n').get().n, before);
  f.denied.add('documents.read:project:project');
  const filtered = (await f.call('GET', '/knowledge-conflicts/candidates?workspace_id=ws')).result;
  assert.equal(filtered.scanned_count, 1); assert.equal(filtered.candidates.length, 0);
});

test('candidate scanning is capped at 500 accessible entries and 50 suggestions without provider work', async t => {
  const f = fixture(t);
  for (let index = 0; index < 501; index++) f.note(`bounded-${index}`);
  const result = (await f.call('GET', '/knowledge-conflicts/candidates?workspace_id=ws')).result;
  assert.equal(result.scanned_count, 500); assert.equal(result.scan_truncated, true);
  assert.equal(result.candidates.length, 50); assert.equal(result.pairs_truncated, true);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM runs').get().n, 0);
});

test('context warnings require both already-included sources and disclose no text or hidden metadata', async t => {
  const f = fixture(t), created = await f.report();
  const inspection = ids => ({ manifest: { resolved: { workspace_id: 'ws' }, included: ids.map(id => ({ kind: 'knowledge_entries', id })) } });
  assert.deepEqual(getKnowledgeConflictWarnings(f.db, inspection(['left']), f.actor, f.allowed), []);
  const warnings = getKnowledgeConflictWarnings(f.db, inspection(['left', 'right']), f.actor, f.allowed);
  assert.deepEqual(warnings, [{ id: created.result.conflict.id, code: 'possible_knowledge_conflict', left_id: 'left', right_id: 'right', freshness: 'current' }]);
  f.denied.add('documents.read:project:project');
  assert.deepEqual(getKnowledgeConflictWarnings(f.db, inspection(['left', 'right']), f.actor, f.allowed), []);
});

test('actor-bound request fingerprints prevent changed replays and workspace cleanup removes private ledgers', async t => {
  const f = fixture(t), created = await f.report();
  await assert.rejects(f.report({ reason: 'A different request' }), { statusCode: 409, errorCode: 'idempotency_conflict' });
  await f.decision(created.result.conflict.id);
  await assert.rejects(f.decision(created.result.conflict.id, { decision: 'supersede_left' }), { statusCode: 409, errorCode: 'idempotency_conflict' });
  f.db.prepare("DELETE FROM workspaces WHERE id='ws'").run();
  for (const table of ['knowledge_conflicts', 'knowledge_conflict_decisions', 'knowledge_conflict_requests']) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
});

test('older relevant context conflicts are not displaced by unrelated newer report pages', async t => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(time) });
  const original = await f.report(); f.note('other-left'); f.note('other-right');
  for (let index = 0; index < 51; index++) {
    t.mock.timers.tick(1);
    await f.report({ left_id: 'other-left', right_id: 'other-right', request_id: `other-report-${index}` });
  }
  const list = (await f.call('GET', '/knowledge-conflicts?workspace_id=ws')).result;
  assert.equal(list.conflicts.length, 50); assert.equal(list.has_more, true);
  assert(!list.conflicts.some(row => row.id === original.result.conflict.id));
  const inspection = { manifest: { resolved: { workspace_id: 'ws' }, included: [{ kind: 'knowledge_entries', id: 'left' }, { kind: 'knowledge_entries', id: 'right' }] } };
  assert.deepEqual(getKnowledgeConflictWarnings(f.db, inspection, f.actor, f.allowed).map(row => row.id), [original.result.conflict.id]);
});

test('resolution is transactional and concurrent conflicting decisions cannot both take effect', async t => {
  const f = fixture(t), created = await f.report(), conflictId = created.result.conflict.id;
  f.db.exec("CREATE TRIGGER fixture_decision_failure BEFORE INSERT ON knowledge_conflict_decisions BEGIN SELECT RAISE(ABORT,'Injected decision failure'); END");
  await assert.rejects(f.decision(conflictId, { decision: 'supersede_left' }), /Injected decision failure/);
  assert.equal(f.db.prepare("SELECT state FROM knowledge_entries WHERE id='left'").get().state, 'approved');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM change_log').get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM knowledge_conflict_requests WHERE operation<>'report'").get().n, 0);
  f.db.exec('DROP TRIGGER fixture_decision_failure');
  const attempts = await Promise.allSettled([f.decision(conflictId, { decision: 'supersede_left', request_id: 'race-left' }), f.decision(conflictId, { decision: 'supersede_right', request_id: 'race-right' })]);
  assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(row => row.status === 'rejected').reason.statusCode, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM knowledge_conflict_decisions').get().n, 1);
  assert.equal((await f.call('GET', '/knowledge-conflicts?workspace_id=ws&status=open')).result.conflicts.length, 0);
  assert.equal((await f.call('GET', '/knowledge-conflicts?workspace_id=ws&status=resolved')).result.conflicts.length, 1);
});

test('integrated conflict notices are delivered byte-exactly and changed notices invalidate reviewed launch previews', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-knowledge-context-exact-')), prompts = [];
  let ownerCookie;
  const api = createLocalApi({ dataDir: directory, seedMode: 'clean', integrationOptions: {
    env: {}, fetchImpl() { throw new Error('External network forbidden'); },
    async execute(_command, args) { return { code: 0, stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '' }; },
    spawnProcess() {
      const child = new EventEmitter(); for (const stream of ['stdin', 'stdout', 'stderr']) child[stream] = new EventEmitter();
      child.kill = () => queueMicrotask(() => child.emit('close', 1));
      child.stdin.end = prompt => { prompts.push(prompt); queueMicrotask(() => { child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Injected test only' } }) + '\n')); child.emit('close', 0); }); };
      return child;
    },
  } });
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const db = new DatabaseSync(api.dbPath);
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); db.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (method, path, body, expected = method === 'POST' ? 201 : 200, cookie = ownerCookie) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result));
    return { ...result, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const workspace = (await call('POST', '/workspaces', { name: 'Exact conflict context' })).workspace;
  const agent = (await call('POST', '/agents', { workspace_id: workspace.id, provider: 'codex', name: 'Injected reviewer', memory_policy: 'reviewed' })).agent;
  const notes = [];
  for (const content of ['Use blue.', 'Use green.']) notes.push((await call('POST', '/workflow/knowledge', { workspace_id: workspace.id, title: 'Color preference', kind: 'preference', content, state: 'approved' })).result);
  const report = (await call('POST', '/knowledge-conflicts', { workspace_id: workspace.id, left_id: notes[0].id, left_version: 1, right_id: notes[1].id, right_version: 1, reason: 'Different saved preferences.', request_id: 'exact-report' })).result;
  const input = { workspace_id: workspace.id, agent_id: agent.id, work_mode: 'conversation', prompt: 'Review the saved preferences.', include_memory: true };
  const preview = (await call('POST', '/context/inspect', input)).result;
  assert.equal(preview.manifest.fingerprint, createHash('sha256').update(preview.finalPrompt).digest('hex'));
  assert.equal(preview.manifest.counts.total_characters, preview.finalPrompt.length);
  assert.equal(preview.manifest.knowledge_conflicts.length, 1);
  await call('POST', '/connections/codex/connect', { method: 'existing' }, 200);
  const launched = (await call('POST', '/runs', { ...input, mode: 'live', context_inspection_id: preview.id })).run;
  assert.equal(prompts.length, 1); assert.equal(prompts[0], preview.finalPrompt);
  const captured = JSON.parse(db.prepare('SELECT inspection_json FROM run_context_snapshots WHERE run_id=?').get(launched.id).inspection_json);
  for (const note of notes) assert(captured.sourceAccess.sources.some(source => source.table === 'knowledge_entries' && source.id === note.id));
  const pending = (await call('POST', '/context/inspect', input)).result;
  await call('POST', `/knowledge-conflicts/${report.conflict.id}/decision`, { decision: 'supersede_left', rationale: 'The second preference was explicitly chosen.', confirmed: true, request_id: 'exact-decision' });
  const rejected = await call('POST', '/runs', { ...input, mode: 'live', context_inspection_id: pending.id }, 409);
  assert.equal(rejected.error.code, 'stale_context'); assert.equal(prompts.length, 1);
  const history = (await call('GET', `/runs/${launched.id}/context`)).result;
  assert.equal(history.finalPrompt, preview.finalPrompt, 'Later conflict resolution must not rewrite an already captured prompt');
  const member = (await call('POST', '/governance', { workspace_id: workspace.id, action: 'create_member', name: 'Context reader', email: 'context-reader@example.com' }, 200)).result;
  ownerCookie = (await call('POST', '/identity/setup', { name: 'Owner', email: 'context-owner@example.com', password: 'isolated owner password 123' }, 200)).cookie;
  const invite = await call('POST', '/identity/invite', { workspace_id: workspace.id, member_id: member.id });
  const memberCookie = (await call('POST', '/identity/accept', { token: invite.result.invitation_token, password: 'isolated reader password 123' }, 200)).cookie;
  assert.equal((await call('GET', `/runs/${launched.id}/context`, undefined, 200, memberCookie)).result.finalPrompt, preview.finalPrompt);
  await call('POST', '/governance', { workspace_id: workspace.id, action: 'grant', member_id: member.id, permission: 'documents.read', effect: 'deny', scope_type: 'workspace', scope_id: workspace.id, reason: 'Revoke captured knowledge access' }, 200);
  const denied = await call('GET', `/runs/${launched.id}/context`, undefined, 403, memberCookie);
  assert(!JSON.stringify(denied).includes(notes[0].content)); assert(!JSON.stringify(denied).includes(report.conflict.id));
  assert.equal(prompts.length, 1);
});

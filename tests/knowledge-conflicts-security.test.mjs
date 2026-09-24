import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createLocalApi } from '../server/local-api.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-knowledge-conflict-security-'));
  let externalCalls = 0, ownerCookie;
  const forbidden = () => { externalCalls++; throw new Error('No providers or external accounts in knowledge conflict tests'); };
  const api = createLocalApi({ dataDir: directory, seedMode: 'clean', integrationOptions: { env: {}, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden } });
  const db = new DatabaseSync(api.dbPath); db.exec('PRAGMA foreign_keys=ON');
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); db.close(); await rm(directory, { recursive: true, force: true }); assert.equal(externalCalls, 0); });
  const request = async (method, path, body, cookie = ownerCookie) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const call = async (method, path, body, cookie) => { const result = await request(method, path, body, cookie); assert(result.status >= 200 && result.status < 300, `${method} ${path}: ${result.status} ${JSON.stringify(result.body).slice(0, 1200)}`); return result.body; };
  const workspace = (await call('POST', '/workspaces', { name: 'Knowledge conflict security' })).workspace;
  const area = (await call('POST', '/teams', { workspace_id: workspace.id, name: 'Original Area' })).team;
  const project = (await call('POST', '/projects', { workspace_id: workspace.id, team_id: area.id, name: 'Source project' })).project;
  const knowledge = async (content, extra = {}) => (await call('POST', '/workflow/knowledge', { workspace_id: workspace.id, project_id: project.id, title: 'Release policy', kind: 'decision', content, state: 'approved', ...extra })).result;
  const left = await knowledge('Ship on Tuesdays.'), right = await knowledge('Ship on Fridays.');
  const reportBody = (extra = {}) => ({ workspace_id: workspace.id, left_id: left.id, left_version: left.version, right_id: right.id, right_version: right.version, reason: 'These release-day instructions differ.', request_id: randomUUID(), ...extra });
  const decisionBody = (decision = 'keep_both', extra = {}) => ({ decision, rationale: 'Human reviewed the two recorded sources.', confirmed: true, request_id: randomUUID(), ...extra });
  const report = async (body = reportBody(), cookie) => (await call('POST', '/knowledge-conflicts', body, cookie)).result;
  const listPath = `/knowledge-conflicts?workspace_id=${workspace.id}`;
  const authenticate = async () => {
    const member = (await call('POST', '/governance', { workspace_id: workspace.id, action: 'create_member', name: 'Conflict reviewer', email: 'conflict-reader@example.com' })).result;
    const owner = await request('POST', '/identity/setup', { name: 'Owner', email: 'conflict-owner@example.com', password: 'isolated owner password 123' }); assert.equal(owner.status, 200); ownerCookie = owner.cookie;
    const invitation = await call('POST', '/identity/invite', { workspace_id: workspace.id, member_id: member.id });
    const accepted = await request('POST', '/identity/accept', { token: invitation.result.invitation_token, password: 'isolated member password 123' }); assert.equal(accepted.status, 200);
    const grant = (permission, effect = 'allow', scope_type = 'project', scope_id = project.id) => call('POST', '/governance', { workspace_id: workspace.id, action: 'grant', member_id: member.id, permission, effect, scope_type, scope_id, reason: 'Isolated conflict security check' });
    return { member, cookie: accepted.cookie, grant };
  };
  return { api, db, workspace, area, project, left, right, knowledge, request, call, reportBody, decisionBody, report, listPath, authenticate };
}

test('knowledge conflict HTTP: report changes no knowledge; explicit superseding preserves captured context', async t => {
  const f = await fixture(t), snapshot = (await f.call('POST', '/workflow/context', { workspace_id: f.workspace.id, project_id: f.project.id, name: 'Before decision', sources: [{ type: 'knowledge_entries', id: f.left.id }, { type: 'knowledge_entries', id: f.right.id }] })).result;
  const beforeSnapshot = f.db.prepare('SELECT * FROM context_snapshots WHERE id=?').get(snapshot.id);
  const input = f.reportBody(), detail = await f.report(input), conflictId = detail.conflict.id;
  assert.equal(detail.left.content, f.left.content); assert.equal(detail.right.content, f.right.content);
  assert.equal(detail.conflict.status, 'open'); assert.equal(f.db.prepare('SELECT state FROM knowledge_entries WHERE id=?').get(f.left.id).state, 'approved');
  assert.equal((await f.call('POST', '/knowledge-conflicts', input)).result.conflict.id, conflictId);
  const decision = f.decisionBody('supersede_left');
  const result = (await f.call('POST', `/knowledge-conflicts/${conflictId}/decision`, decision)).result;
  assert.equal(result.conflict.status, 'resolved'); assert.equal(result.conflict.freshness, 'current');
  assert.equal(f.db.prepare('SELECT state FROM knowledge_entries WHERE id=?').get(f.left.id).state, 'superseded');
  assert.equal(f.db.prepare('SELECT version FROM knowledge_entries WHERE id=?').get(f.left.id).version, 2);
  assert.equal(f.db.prepare('SELECT state FROM knowledge_entries WHERE id=?').get(f.right.id).state, 'approved');
  assert.deepEqual(f.db.prepare('SELECT * FROM context_snapshots WHERE id=?').get(snapshot.id), beforeSnapshot);
  await f.call('POST', `/knowledge-conflicts/${conflictId}/decision`, decision);
  assert.equal(f.db.prepare('SELECT version FROM knowledge_entries WHERE id=?').get(f.left.id).version, 2);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM runs').get().n, 0);
});

test('knowledge conflict HTTP: stale source revisions block decisions and preserve exact historical text', async t => {
  const f = await fixture(t), detail = await f.report(), path = `/knowledge-conflicts/${detail.conflict.id}`;
  await f.call('PATCH', `/workflow/knowledge/${f.left.id}`, { version: f.left.version, content: 'Revised human instruction.' });
  const stale = (await f.call('GET', path)).result;
  assert.equal(stale.conflict.freshness, 'stale'); assert.equal(stale.left.content, f.left.content);
  assert.equal((await f.request('POST', `${path}/decision`, f.decisionBody('supersede_left'))).status, 409);
  assert.equal(f.db.prepare('SELECT state FROM knowledge_entries WHERE id=?').get(f.left.id).state, 'draft');
});

test('knowledge conflict HTTP: rejects invented attribution, source versions, unconfirmed decisions and cross-workspace pairs', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('POST', '/knowledge-conflicts', f.reportBody({ reported_by: 'forged' }))).status, 400);
  assert.equal((await f.request('POST', '/knowledge-conflicts', f.reportBody({ left_version: 77 }))).status, 409);
  assert.equal((await f.request('POST', '/knowledge-conflicts', f.reportBody({ right_id: f.left.id }))).status, 400);
  const other = (await f.call('POST', '/workspaces', { name: 'Other workspace' })).workspace;
  const foreign = await f.knowledge('FOREIGN PRIVATE CONTENT', { workspace_id: other.id, project_id: null });
  const mixed = await f.request('POST', '/knowledge-conflicts', f.reportBody({ right_id: foreign.id }));
  assert([400, 403, 404].includes(mixed.status)); assert(!JSON.stringify(mixed.body).includes(foreign.content));
  const detail = await f.report(), path = `/knowledge-conflicts/${detail.conflict.id}/decision`;
  for (const extra of [{ confirmed: false }, { reviewer_id: 'forged' }, { decision: 'delete_both' }]) assert.equal((await f.request('POST', path, f.decisionBody('keep_both', extra))).status, 400);
});

test('knowledge conflict HTTP: every pair requires both-source read and write, including replay', async t => {
  const f = await fixture(t), detail = await f.report(), member = await f.authenticate();
  const path = `/knowledge-conflicts/${detail.conflict.id}`, decision = f.decisionBody();
  assert.equal((await f.request('GET', path, undefined, member.cookie)).status, 200);
  const deny = (await member.grant('documents.write', 'deny')).result;
  assert.equal((await f.request('POST', `${path}/decision`, decision, member.cookie)).status, 403);
  await f.call('POST', '/governance', { workspace_id: f.workspace.id, action: 'revoke_grant', grant_id: deny.id });
  await f.call('POST', `${path}/decision`, decision, member.cookie);
  await member.grant('documents.read', 'deny');
  assert.equal((await f.request('GET', path, undefined, member.cookie)).status, 403);
  assert.equal((await f.request('POST', `${path}/decision`, decision, member.cookie)).status, 403);
  const list = await f.call('GET', f.listPath, undefined, member.cookie);
  assert.deepEqual(list.result.conflicts, []); assert(!JSON.stringify(list).includes(f.left.id));
  const candidates = await f.call('GET', `/knowledge-conflicts/candidates?workspace_id=${f.workspace.id}`, undefined, member.cookie);
  assert.equal(candidates.result.scanned_count, 0); assert.deepEqual(candidates.result.candidates, []);
});

test('knowledge conflict HTTP: moving a project does not erase original Area read boundaries', async t => {
  const f = await fixture(t), detail = await f.report(), member = await f.authenticate();
  const secondArea = (await f.call('POST', '/teams', { workspace_id: f.workspace.id, name: 'New Area' })).team;
  await f.call('PATCH', `/projects/${f.project.id}`, { team_id: secondArea.id });
  await member.grant('documents.read', 'deny', 'team', f.area.id);
  const response = await f.request('GET', `/knowledge-conflicts/${detail.conflict.id}`, undefined, member.cookie);
  assert.equal(response.status, 403); assert(!JSON.stringify(response.body).includes(f.left.content));
  assert.deepEqual((await f.call('GET', f.listPath, undefined, member.cookie)).result.conflicts, []);
});

test('knowledge conflict HTTP: concurrent decisions apply once and keep-both never changes either source', async t => {
  const f = await fixture(t), detail = await f.report(), path = `/knowledge-conflicts/${detail.conflict.id}/decision`;
  const before = f.db.prepare('SELECT * FROM knowledge_entries ORDER BY id').all();
  const body = f.decisionBody(), competing = f.decisionBody();
  const responses = await Promise.all([f.request('POST', path, body), f.request('POST', path, competing)]);
  assert.equal(responses.filter(row => row.status >= 200 && row.status < 300).length, 1);
  assert.equal(responses.filter(row => row.status === 409).length, 1);
  assert.deepEqual(f.db.prepare('SELECT * FROM knowledge_entries ORDER BY id').all(), before);
  const winning = responses[0].status < 300 ? body : competing;
  assert.equal((await f.request('POST', path, { ...winning, decision: 'supersede_right' })).status, 409);
});

test('knowledge conflict HTTP: candidate scan reports literal differences, not semantic certainty', async t => {
  const f = await fixture(t);
  await f.knowledge(f.left.content, { title: 'Unrelated title' });
  await f.knowledge('Draft content', { state: 'draft' });
  const result = (await f.call('GET', `/knowledge-conflicts/candidates?workspace_id=${f.workspace.id}`)).result;
  assert.equal(result.candidates.length, 1); assert.equal(result.scanned_count, 3);
  assert.equal(result.scan_limit, 500); assert.equal(result.pair_limit, 50);
  assert.match(result.candidates[0].label, /possible conflict.*not verified contradiction/i);
  assert(!JSON.stringify(result).includes('confidence'));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM runs').get().n, 0);
});

test('knowledge conflict HTTP: export/import retains definitions but transfers no review authority', async t => {
  const f = await fixture(t), detail = await f.report();
  await f.call('POST', `/knowledge-conflicts/${detail.conflict.id}/decision`, f.decisionBody());
  const archive = await f.call('GET', `/export?workspace_id=${f.workspace.id}`);
  assert(!Object.keys(archive.data).some(key => /knowledge_conflict/.test(key)));
  const imported = (await f.call('POST', '/import', archive)).result;
  assert.deepEqual((await f.call('GET', `/knowledge-conflicts?workspace_id=${imported.id}`)).result.conflicts, []);
  assert(f.db.prepare('SELECT state FROM knowledge_entries WHERE workspace_id=?').all(imported.id).every(row => row.state === 'draft'));
});

test('knowledge conflict HTTP: exact-context notices include only pairs already approved for this run', async t => {
  const f = await fixture(t), detail = await f.report();
  const agent = (await f.call('POST', '/agents', { workspace_id: f.workspace.id, name: 'Context reviewer', provider: 'codex', memory_policy: 'reviewed' })).agent;
  const inspect = async (extra = {}) => (await f.call('POST', '/context/inspect', { workspace_id: f.workspace.id, project_id: f.project.id, agent_id: agent.id, work_mode: 'conversation', prompt: 'Review the release guidance.', include_memory: true, ...extra })).result;
  const before = await inspect();
  assert.equal(before.manifest.knowledge_conflicts.length, 1);
  assert.equal(before.manifest.knowledge_conflicts[0].id, detail.conflict.id);
  assert.match(before.finalPrompt, /not verified contradictions or authority/);
  assert.equal(before.finalPrompt.length, before.manifest.counts.total_characters);
  const excluded = await inspect({ include_memory: false });
  assert.deepEqual(excluded.manifest.knowledge_conflicts, []);
  assert(!excluded.finalPrompt.includes(detail.conflict.id));
  await f.call('POST', `/knowledge-conflicts/${detail.conflict.id}/decision`, f.decisionBody('supersede_left'));
  const after = await inspect();
  assert.deepEqual(after.manifest.knowledge_conflicts, []);
  assert(!after.manifest.included.some(row => row.kind === 'knowledge_entries' && row.id === f.left.id));
  assert(after.manifest.included.some(row => row.kind === 'knowledge_entries' && row.id === f.right.id));
  assert.notEqual(after.manifest.fingerprint, before.manifest.fingerprint);
});

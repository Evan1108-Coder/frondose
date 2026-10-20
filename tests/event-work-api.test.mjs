import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { createLocalApi } from '../server/local-api.mjs';
import { createEventWorkPolicy } from '../server/event-work-policy.mjs';
import { readRunContext } from '../server/run-context-store.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-event-api-'));
  let clock = new Date().toISOString(), providerError = false;
  const prompts = [];
  const api = createLocalApi({ dataDir: directory, scheduledWorkOptions: { now: () => new Date(clock), scheduleIntervalMs: options.timer || 3600000 }, integrationOptions: { env: {}, fetchImpl: () => { throw Error('External network forbidden'); }, execute: async (_exe, args) => ({ code: 0, stdout: args.includes('mcp') ? '[]' : 'Logged in' }), spawnProcess: () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.kill = () => {};
    child.stdin.end = prompt => { prompts.push(prompt); queueMicrotask(() => { child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Injected event reply 🙂' } })}\n`)); child.emit('close', providerError ? 1 : 0); }); }; return child;
  } } });
  const db = new DatabaseSync(api.dbPath), server = createServer(api.middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); db.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST', cookie) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }; };
  const call = async (...args) => { const result = await request(...args); assert.ok(result.status >= 200 && result.status < 300, `${args[0]}: ${JSON.stringify(result.body)}`); return result.body; };
  const workspace = (await call('/workspaces', { name: 'Event QA' })).workspace;
  const area = (await call('/teams', { workspace_id: workspace.id, name: 'Area A', identifier: 'EQA' })).team;
  const project = (await call('/projects', { workspace_id: workspace.id, name: 'Project A', team_id: area.id })).project;
  const agent = (await call('/agents', { workspace_id: workspace.id, name: 'Event agent', provider: 'codex' })).agent;
  const chat = (await call('/chats', { workspace_id: workspace.id, project_id: project.id, title: 'Event conversation' })).chat;
  const inspect = async (content = 'Perform the reviewed request', extra = {}, cookie) => (await call('/context/inspect', { workspace_id: workspace.id, chat_id: chat.id, agent_id: agent.id, prompt: content, work_mode: 'conversation', include_chat: false, include_memory: false, include_workspace: false, ...extra }, 'POST', cookie)).result;
  const body = (inspection, extra = {}) => ({ workspace_id: workspace.id, title: 'Event QA trigger', request_id: 'event_api_request', trigger: { event: 'route.created', target_type: 'project', target_id: project.id }, payload: { chat_id: chat.id, agent_id: agent.id, content: 'Perform the reviewed request', attachments: [] }, context_inspection_id: inspection.id, cooldown_minutes: 5, confirmed_recurring: true, ...extra });
  const route = async (extra = {}) => (await call('/tasks', { workspace_id: workspace.id, project_id: project.id, title: 'Future route text is not injected', ...extra })).task;
  const wait = async () => { for (let i = 0; i < 100; i++) { const run = db.prepare('SELECT * FROM runs WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1').get(workspace.id); if (run && ['completed', 'failed'].includes(run.status)) return run; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Injected provider did not finish'); };
  return { api, db, call, request, workspace, area, project, agent, chat, inspect, body, route, wait, prompts, time: value => { clock = value; }, failProvider: () => { providerError = true; } };
}

test('event API uses exact reviewed context, reserves preview, captures immutable source metadata, and launches once', async t => {
  const f = await fixture(t); await f.call('/connections/codex/connect', { method: 'existing' });
  const doc = (await f.call('/documents', { workspace_id: f.workspace.id, project_id: f.project.id, title: 'Reviewed evidence', content: 'ORIGINAL_EVENT_EVIDENCE' })).document;
  const pack = (await f.call('/workspace-items', { workspace_id: f.workspace.id, kind: 'context_pack', name: 'Event evidence', payload: { description: '', content: '', document_ids: [doc.id], memory_ids: [] } })).result;
  const inspection = await f.inspect(undefined, { context_pack_ids: [pack.id] });
  const created = (await f.call('/event-work', f.body(inspection))).result;
  assert.equal(f.prompts.length, 0); assert.equal((await f.call('/event-work', f.body(inspection))).result.id, created.id);
  const send = await f.request(`/chats/${f.chat.id}/turns`, { agent_id: f.agent.id, content: 'Perform the reviewed request', client_turn_id: 'must_not_reuse_preview', work_mode: 'conversation', context_inspection_id: inspection.id });
  assert.equal(send.status, 409); assert.equal(send.body.error.code, 'context_inspection_reserved');
  const schedule = await f.request('/scheduled-work', { workspace_id: f.workspace.id, kind: 'message', payload: f.body(inspection).payload, context_inspection_id: inspection.id, local_time: new Date(Date.now() + 3600000).toISOString().slice(0, 16), timezone: 'UTC', recurrence: 'none', request_id: 'cannot_schedule_event_review' });
  assert.equal(schedule.status, 409);
  await f.call(`/documents/${doc.id}`, { content: 'FUTURE_UNREVIEWED_EVENT_BODY' }, 'PATCH');
  const route = await f.route(); await f.api.dispatchEventWork(); const run = await f.wait(); await f.api.dispatchEventWork();
  assert.equal(run.status, 'completed'); assert.equal(f.prompts.length, 1);
  assert.match(f.prompts[0], /ORIGINAL_EVENT_EVIDENCE/); assert.ok(!f.prompts[0].includes('FUTURE_UNREVIEWED_EVENT_BODY')); assert.ok(!f.prompts[0].includes('Future route text is not injected'));
  assert.match(f.prompts[0], new RegExp(route.id));
  const capture = readRunContext(f.db, run.id).inspection;
  assert.deepEqual(capture.manifest.event_trigger.fields, ['event_type', 'source_type', 'source_id', 'occurred_at']);
  assert.equal(capture.manifest.event_trigger.metadata.source_id, route.id);
  assert.ok(capture.sourceAccess.sources.some(source => source.table === 'tasks' && source.id === route.id));
  assert.equal((await f.call(`/event-work/${created.id}`)).result.history[0].result.run_id, run.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM chat_turns WHERE chat_id=?').get(f.chat.id).n, 1);
});

test('event work cannot enable without connection, bound profile, exact prompt and explicit recurring consent', async t => {
  const f = await fixture(t), preview = await f.inspect();
  assert.equal((await f.request('/event-work', f.body(preview))).status, 400);
  await f.call('/connections/codex/connect', { method: 'existing' });
  for (const change of [{ confirmed_recurring: false }, { payload: { chat_id: f.chat.id, agent_id: f.agent.id, content: 'Changed after inspection' } }]) assert.equal((await f.request('/event-work', f.body(preview, change))).status, 400);
  await f.call(`/agents/${f.agent.id}`, { provider_connection_id: null }, 'PATCH');
  const unbound = await f.inspect(); assert.equal((await f.request('/event-work', f.body(unbound))).status, 400);
  assert.equal(f.prompts.length, 0); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM event_work').get().n, 0);
});

test('changed profile and disconnected connection pause before launch, with no hidden provider attempt', async t => {
  const f = await fixture(t); await f.call('/connections/codex/connect', { method: 'existing' });
  const first = (await f.call('/event-work', f.body(await f.inspect()))).result;
  await f.call(`/agents/${f.agent.id}`, { instructions: 'A new configuration' }, 'PATCH'); await f.route(); await f.api.dispatchEventWork();
  let current = (await f.call(`/event-work/${first.id}`)).result;
  assert.equal(current.state, 'paused'); assert.equal(current.history[0].error.code, 'event_profile_changed'); assert.equal(f.prompts.length, 0);
  assert.equal((await f.request(`/event-work/${first.id}`, { version: current.version, state: 'active' }, 'PATCH')).status, 409);
  const second = (await f.call('/event-work', f.body(await f.inspect(), { request_id: 'new_profile_event' }))).result;
  await f.call('/connections/codex/disconnect', {}); await f.route(); await f.api.dispatchEventWork();
  current = (await f.call(`/event-work/${second.id}`)).result; assert.equal(current.state, 'paused'); assert.equal(current.history[0].error.code, 'not_connected'); assert.equal(f.prompts.length, 0);
});

test('source access is rechecked at delivery and derived run reads retain triggering source provenance', async t => {
  const f = await fixture(t); await f.call('/connections/codex/connect', { method: 'existing' });
  const created = (await f.call('/event-work', f.body(await f.inspect()))).result;
  const route = await f.route(); await f.api.dispatchEventWork(); const run = await f.wait(); await f.api.dispatchEventWork();
  const context = readRunContext(f.db, run.id).inspection;
  assert.ok(context.sourceAccess.sources.some(ref => ref.table === 'tasks' && ref.id === route.id));
  await f.call(`/tasks/${route.id}`, { archived_at: '2026-10-20T01:01:00Z' }, 'PATCH');
  const visible = (await f.call(`/event-work/${created.id}`)).result;
  assert.equal(visible.history.length, 0, 'revoked source event does not leak receipt/run metadata');
  const contextRead = await f.request(`/runs/${run.id}/context`); assert.ok(contextRead.status >= 400 || !contextRead.body.result, JSON.stringify(contextRead.body));
});

test('published updates and replies trigger but drafts and edits do not masquerade as new publication', async t => {
  const f = await fixture(t); await f.call('/connections/codex/connect', { method: 'existing' });
  const created = (await f.call('/event-work', f.body(await f.inspect(), { trigger: { event: 'update.published', target_type: 'project', target_id: f.project.id } }))).result;
  const draft = (await f.call('/activity', { workspace_id: f.workspace.id, target_type: 'project', target_id: f.project.id, update_type: 'progress', title: 'Draft', content: 'Do not execute this instruction', publication_state: 'draft' })).result;
  await f.api.dispatchEventWork(); assert.equal(f.prompts.length, 0);
  await f.call(`/activity/${draft.id}`, { workspace_id: f.workspace.id, version: draft.version, publication_state: 'published' }, 'PATCH');
  await f.api.dispatchEventWork(); await f.wait(); await f.api.dispatchEventWork(); assert.equal(f.prompts.length, 1);
  assert.ok(!f.prompts[0].includes('Do not execute this instruction'));
  assert.equal((await f.call(`/event-work/${created.id}`)).result.history[0].status, 'completed');
  const published = f.db.prepare('SELECT * FROM activity_entries WHERE id=?').get(draft.id);
  await f.call(`/activity/${draft.id}`, { workspace_id: f.workspace.id, version: published.version, content: 'An edit is not a new publication' }, 'PATCH');
  await f.api.dispatchEventWork(); assert.equal((await f.call(`/event-work/${created.id}`)).result.history.length, 1);
  await f.call('/activity', { workspace_id: f.workspace.id, target_type: 'project', target_id: f.project.id, parent_id: draft.id, update_type: 'comment', content: 'A published reply' });
  await f.api.dispatchEventWork();
  assert.equal((await f.call(`/event-work/${created.id}`)).result.history.length, 2, 'a reply is recorded even when cooldown skips its paid run');
});

test('published Request updates have real immutable scope receipts and can trigger workspace subscriptions', async t => {
  const f = await fixture(t); await f.call('/connections/codex/connect', { method: 'existing' });
  const request = (await f.call('/workspace-items', { workspace_id: f.workspace.id, kind: 'request', name: 'Incoming need', payload: { content: 'Private request text', requester: 'Tester', state: 'new' } })).result;
  const created = (await f.call('/event-work', f.body(await f.inspect(), { trigger: { event: 'update.published', target_type: 'workspace', target_id: f.workspace.id } }))).result;
  const entry = (await f.call('/activity', { workspace_id: f.workspace.id, target_type: 'request', target_id: request.id, update_type: 'decision', content: 'Future request update must not enter original context' })).result;
  await f.api.dispatchEventWork(); await f.wait(); await f.api.dispatchEventWork();
  const history = (await f.call(`/event-work/${created.id}`)).result.history;
  assert.equal(history.length, 1); assert.equal(history[0].status, 'completed');
  const scope = f.db.prepare('SELECT * FROM event_change_scopes WHERE change_id=?').get(history[0].event_id);
  assert.equal(scope.source_id, entry.id); assert.equal(scope.target_table, 'workspace_items'); assert.equal(scope.target_id, request.id);
  assert.ok(!f.prompts[0].includes('Future request update must not enter original context'));
});

test('published-update metadata retains original target permission after its document moves to another Area', async t => {
  const f = await fixture(t);
  const doc = (await f.call('/documents', { workspace_id: f.workspace.id, project_id: f.project.id, title: 'Document', content: 'Text' })).document;
  const entry = (await f.call('/activity', { workspace_id: f.workspace.id, target_type: 'document', target_id: doc.id, update_type: 'progress', content: 'Document progress' })).result;
  const event = f.db.prepare("SELECT * FROM change_log WHERE entity_type='activity_entries' AND entity_id=?").get(entry.id);
  const areaB = (await f.call('/teams', { workspace_id: f.workspace.id, name: 'Area B', identifier: 'EQB' })).team;
  const projectB = (await f.call('/projects', { workspace_id: f.workspace.id, name: 'Project B', team_id: areaB.id })).project;
  await f.call(`/documents/${doc.id}`, { project_id: projectB.id }, 'PATCH');
  const allowed = (_ws, _actor, permission, scope) => !(permission === 'documents.read' && scope.scope_type === 'team' && scope.scope_id === f.area.id);
  const policy = createEventWorkPolicy({ db: f.db, allowed, filter: data => data });
  assert.equal(policy.eventReadable(event, { id: 'local-owner' }), false, 'a current readable destination cannot erase historical document permission');
});

test('two queued moves match immutable recorded project and Area scopes, never the latest destination', async t => {
  const f = await fixture(t); await f.call('/connections/codex/connect', { method: 'existing' });
  const areaB = (await f.call('/teams', { workspace_id: f.workspace.id, name: 'Area B', identifier: 'EQB' })).team;
  const projectB = (await f.call('/projects', { workspace_id: f.workspace.id, name: 'Project B', team_id: areaB.id })).project;
  const route = await f.route();
  await f.call(`/tasks/${route.id}`, { project_id: projectB.id, team_id: areaB.id }, 'PATCH');
  await f.call(`/tasks/${route.id}`, { project_id: f.project.id, team_id: f.area.id }, 'PATCH');
  const moves = f.db.prepare("SELECT * FROM change_log WHERE entity_type='tasks' AND entity_id=? AND before_json IS NOT NULL ORDER BY rowid").all(route.id);
  assert.equal(moves.length, 2);
  const policy = createEventWorkPolicy({ db: f.db, allowed: () => true, filter: data => data });
  const event = { ...moves[0], source: 'Frondose', actor_id: 'local-owner' };
  const job = target => ({ workspace_id: f.workspace.id, trigger: { event: 'route.updated', ...target } });
  assert.equal(policy.matchEvent(job({ target_type: 'project', target_id: projectB.id }), event, { id: 'local-owner' }), 'route.updated');
  assert.equal(policy.matchEvent(job({ target_type: 'project', target_id: f.project.id }), event, { id: 'local-owner' }), null);
  assert.equal(policy.matchEvent(job({ target_type: 'area', target_id: areaB.id }), event, { id: 'local-owner' }), 'route.updated');
  for (const source of ['Agent direct action run_1', 'Approved agent proposal', 'Scheduled work', 'Event-triggered work', undefined]) assert.equal(policy.matchEvent(job({ target_type: 'project', target_id: projectB.id }), { ...event, source }, { id: 'local-owner' }), null, `no feedback loop from ${source}`);
  const capture = policy.eventInspection(job({ target_type: 'project', target_id: projectB.id }), event, { id: 'local-owner' });
  assert.ok(capture.sourceAccess.sources.some(ref => ref.scope.scope_type === 'team' && ref.scope.scope_id === areaB.id));
  assert.throws(() => f.db.prepare('UPDATE event_change_scopes SET project_id=? WHERE change_id=?').run(f.project.id, event.id), /immutable/);
  const denied = createEventWorkPolicy({ db: f.db, allowed: (_ws, _actor, _permission, scope) => !(scope.scope_type === 'team' && scope.scope_id === areaB.id), filter: data => data });
  assert.equal(denied.eventReadable(event, { id: 'local-owner' }), false, 'a source move cannot erase the recorded Area boundary');
});

test('server timer handles events without an open page and provider failure is not retried', async t => {
  const f = await fixture(t, { timer: 20 }); await f.call('/connections/codex/connect', { method: 'existing' });
  const created = (await f.call('/event-work', f.body(await f.inspect()))).result;
  f.failProvider(); await f.route(); await f.wait();
  for (let i = 0; i < 50 && f.db.prepare('SELECT state FROM event_work WHERE id=?').get(created.id).state !== 'paused'; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.db.prepare('SELECT state FROM event_work WHERE id=?').get(created.id).state, 'paused'); assert.equal(f.prompts.length, 1);
  await f.api.dispatchEventWork(); assert.equal(f.prompts.length, 1);
});

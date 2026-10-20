import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createEventWorkService } from '../server/event-work-service.mjs';
import { appendEventInspection } from '../server/event-work-policy.mjs';

function fixture(t, overrides = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT); INSERT INTO workspaces VALUES('ws',NULL);
    CREATE TABLE change_log(id TEXT PRIMARY KEY,workspace_id TEXT,entity_type TEXT,entity_id TEXT,created_at TEXT,before_json TEXT,after_json TEXT);
    CREATE TABLE change_attribution(change_id TEXT PRIMARY KEY,actor_id TEXT,source TEXT);
    CREATE TABLE runs(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE chat_turns(client_turn_id TEXT,chat_id TEXT,agent_id TEXT,run_id TEXT,source_message_id TEXT);`);
  t.after(() => db.close());
  const actor = { id: 'owner' }, deliveries = [];
  let clock = '2026-10-20T01:00:00.000Z', permitted = true, sourceReadable = true, sequence = 0, preparing = false;
  const inspection = () => ({ prefix: 'Reference data original\n', finalPrompt: 'Reference data original\nCurrent instruction:\nExact prompt', sourceAccess: { version: 1, workspace_id: 'ws', sources: [], connections: [] }, manifest: { fingerprint: 'original', included: [], resolved: { workspace_id: 'ws' }, counts: {} } });
  const options = { db, now: () => new Date(clock), allowed: () => permitted,
    actorFor: id => id === actor.id ? actor : null,
    prepareTrigger: () => ({ exact: 'scope' }),
    authorizeTrigger: () => { if (!sourceReadable) throw Object.assign(Error('Source revoked'), { code: 'context_access_revoked' }); },
    authorizePayload: () => { if (!permitted) throw Object.assign(Error('Access revoked'), { code: 'context_access_revoked' }); },
    prepareMessage: async body => { preparing = true; return { title: 'Exact event task', payload: body.payload, review: { inspection: inspection(), input: { prompt: body.payload.content } } }; },
    dispatchMessage: async (job, occurrence) => { const id = `run_${++sequence}`; db.prepare('INSERT INTO runs VALUES(?,?)').run(id, 'completed'); deliveries.push({ job, occurrence }); return { run_id: id }; },
    eventReadable: () => sourceReadable,
    matchEvent: (job, event) => event.source === 'Talvori' && event.entity_type === 'tasks' && job.trigger.event === 'route.created' ? 'route.created' : null,
    eventInspection: (_job, event) => ({ metadata: { event_type: 'route.created', source_type: 'route', source_id: event.entity_id, occurred_at: event.created_at }, sourceAccess: { sources: [] } }),
    ...overrides };
  let service = createEventWorkService(options);
  const body = (extra = {}) => ({ workspace_id: 'ws', request_id: 'event_request_1', trigger: { event: 'route.created', target_type: 'workspace', target_id: 'ws' }, payload: { chat_id: 'chat', agent_id: 'agent', content: 'Exact prompt' }, context_inspection_id: 'inspection_1', cooldown_minutes: 5, confirmed_recurring: true, ...extra });
  const event = (id = `event_${++sequence}`, { workspaceId = 'ws', source = 'Talvori', occurredAt = clock, entityType = 'tasks' } = {}) => { db.prepare('INSERT INTO change_log VALUES(?,?,?,?,?,?,?)').run(id, workspaceId, entityType, `route_${id}`, occurredAt, null, '{}'); db.prepare('INSERT INTO change_attribution VALUES(?,?,?)').run(id, actor.id, source); return id; };
  return { db, actor, deliveries, body, event, options, get service() { return service; }, get preparing() { return preparing; }, time: value => { clock = value; }, revoke: () => { permitted = false; }, revokeSource: () => { sourceReadable = false; }, restoreSource: () => { sourceReadable = true; }, restart: () => { service = createEventWorkService(options); return service; } };
}

test('event subscription is explicitly consented, exact-request idempotent, and never launches on creation or reads', async t => {
  const f = fixture(t);
  await assert.rejects(f.service.create(f.body({ confirmed_recurring: false }), f.actor), /confirm recurring/);
  assert.equal(f.preparing, false);
  const item = await f.service.create(f.body(), f.actor);
  assert.equal(item.state, 'active'); assert.equal(f.deliveries.length, 0);
  assert.equal((await f.service.create(f.body(), f.actor)).id, item.id);
  assert.equal(f.service.list('ws', f.actor).items.length, 1);
  assert.equal(f.service.get(item.id, f.actor).payload.content, 'Exact prompt');
  await assert.rejects(f.service.create(f.body({ title: 'Changed' }), f.actor), { code: 'event_work_request_conflict' });
  assert.equal(f.deliveries.length, 0);
});

test('unknown fields, event names, bad scopes, note recipients, unreviewed prompts and cooldowns fail closed', async t => {
  const f = fixture(t);
  for (const change of [{ tools: true }, { trigger: { event: 'email.received', target_type: 'workspace', target_id: 'ws' } }, { trigger: { event: 'route.created', target_type: 'everything', target_id: 'ws' } }, { trigger: { event: 'route.created', target_type: 'workspace', target_id: 'ws', script: 'run' } }, { payload: { chat_id: 'chat', agent_id: null, content: 'x' } }, { payload: { chat_id: 'chat', agent_id: 'agent', content: 'x', native_tools: true } }, { context_inspection_id: null }, { request_id: 'x' }, { cooldown_minutes: 1 }, { cooldown_minutes: 1441 }, { cooldown_minutes: 5.5 }]) await assert.rejects(f.service.create(f.body(change), f.actor));
});

test('future human events launch once with immutable metadata and the original reviewed instruction', async t => {
  const f = fixture(t); f.event('old');
  const item = await f.service.create(f.body(), f.actor);
  const event = f.event('new');
  await Promise.all([f.service.dispatchEvents(), f.service.dispatchEvents()]); await f.service.dispatchEvents();
  assert.equal(f.deliveries.length, 1);
  const inspection = f.deliveries[0].job.review.inspection;
  assert.match(inspection.finalPrompt, /Exact prompt/); assert.match(inspection.finalPrompt, /route_new/);
  assert.deepEqual(inspection.manifest.event_trigger.metadata, { event_type: 'route.created', source_type: 'route', source_id: 'route_new', occurred_at: '2026-10-20T01:00:00.000Z' });
  assert.equal(inspection.manifest.event_trigger.event_id, event);
  assert.equal(f.service.get(item.id, f.actor).history[0].status, 'completed');
  assert.equal(f.service.get(item.id, f.actor).history.length, 1);
  assert.equal(JSON.parse(f.db.prepare('SELECT review_json FROM event_work').get().review_json).inspection.manifest.fingerprint, 'original');
});

test('unrelated workspaces, agent writes, scheduled writes and unattributed records cannot trigger loops', async t => {
  const f = fixture(t); await f.service.create(f.body(), f.actor);
  f.event('other_workspace', { workspaceId: 'other' });
  for (const source of ['Agent direct action run_1', 'Approved agent proposal', 'Scheduled work', 'Event-triggered work', 'Historical record']) f.event(source, { source });
  f.event('unattributed'); f.db.prepare('DELETE FROM change_attribution WHERE change_id=?').run('unattributed');
  await f.service.dispatchEvents(); assert.equal(f.deliveries.length, 0);
});

test('cooldown coalesces bursts into visible skip receipts without delayed replay', async t => {
  const f = fixture(t), item = await f.service.create(f.body(), f.actor);
  f.event('first'); f.event('second'); await f.service.dispatchEvents();
  assert.equal(f.deliveries.length, 1);
  assert.ok(f.service.get(item.id, f.actor).history.some(row => row.error?.code === 'event_cooldown' || row.error?.code === 'event_busy'));
  f.time('2026-10-20T01:06:00.000Z'); await f.service.dispatchEvents(); assert.equal(f.deliveries.length, 1);
  f.event('third'); await f.service.dispatchEvents(); assert.equal(f.deliveries.length, 2);
});

test('one global event run in flight skips additional events rather than creating an unbounded paid queue', async t => {
  const f = fixture(t, { dispatchMessage: async (job, occurrence) => { f.deliveries.push({ job, occurrence }); f.db.prepare('INSERT INTO runs VALUES(?,?)').run('running', 'running'); return { run_id: 'running' }; } });
  const item = await f.service.create(f.body(), f.actor);
  f.event('first'); await f.service.dispatchEvents();
  f.time('2026-10-20T01:06:00.000Z'); f.event('second'); await f.service.dispatchEvents();
  assert.equal(f.deliveries.length, 1);
  assert.ok(f.service.get(item.id, f.actor).history.some(row => row.error?.code === 'event_busy'));
});

test('source loss or missing creator pauses without dispatch and hides dependent receipt metadata', async t => {
  const f = fixture(t); const item = await f.service.create(f.body(), f.actor);
  f.event(); await f.service.dispatchEvents();
  f.revokeSource();
  assert.equal(f.service.list('ws', f.actor).items.length, 0);
  f.time('2026-10-20T01:06:00.000Z'); f.event(); await f.service.dispatchEvents();
  assert.equal(f.deliveries.length, 1); assert.equal(f.db.prepare('SELECT state FROM event_work').get().state, 'paused');
  f.restoreSource(); assert.equal(f.service.get(item.id, f.actor).state, 'paused');
});

test('only creator can see, pause, resume or cancel recurring credential authorization', async t => {
  const f = fixture(t), item = await f.service.create(f.body(), f.actor), other = { id: 'manager' };
  assert.equal(f.service.list('ws', other).items.length, 0);
  assert.throws(() => f.service.get(item.id, other), { code: 'event_work_unavailable' });
  assert.throws(() => f.service.update(item.id, { version: 1, state: 'cancelled' }, other), { code: 'event_work_unavailable' });
  assert.throws(() => f.service.update(item.id, { version: 0, state: 'paused' }, f.actor), { code: 'stale_event_work' });
  assert.throws(() => f.service.update(item.id, { version: 1, state: 'paused', content: 'Changed' }, f.actor));
  const paused = f.service.update(item.id, { version: 1, state: 'paused' }, f.actor);
  f.event('while_paused');
  const resumed = f.service.update(item.id, { version: paused.version, state: 'active' }, f.actor);
  await f.service.dispatchEvents(); assert.equal(f.deliveries.length, 0);
  f.event('after_resume'); await f.service.dispatchEvents(); assert.equal(f.deliveries.length, 1);
  const cancelled = f.service.update(item.id, { version: resumed.version, state: 'cancelled' }, f.actor);
  assert.throws(() => f.service.update(item.id, { version: cancelled.version, state: 'active' }, f.actor), { code: 'event_work_cancelled' });
});

test('failed or uncertain dispatch pauses and never retries automatically, including restart', async t => {
  const f = fixture(t, { dispatchMessage: async () => { f.deliveries.push('attempt'); throw Object.assign(Error('Provider unavailable'), { code: 'not_connected' }); } });
  const item = await f.service.create(f.body(), f.actor); f.event('failure');
  await f.service.dispatchEvents(); await f.service.dispatchEvents(); f.restart(); await f.service.dispatchEvents();
  assert.equal(f.deliveries.length, 1); const current = f.service.get(item.id, f.actor);
  assert.equal(current.state, 'paused'); assert.equal(current.history[0].status, 'failed'); assert.equal(current.history[0].error.code, 'not_connected');
});

test('provider run failure after launch is reconciled and pauses subscription without replay', async t => {
  const f = fixture(t), item = await f.service.create(f.body(), f.actor); f.event('one'); await f.service.dispatchEvents();
  f.db.prepare("UPDATE event_work_occurrences SET status='running'").run(); f.db.prepare("UPDATE runs SET status='failed'").run();
  await f.service.dispatchEvents();
  assert.equal(f.service.get(item.id, f.actor).state, 'paused'); assert.equal(f.service.get(item.id, f.actor).history[0].status, 'failed'); assert.equal(f.deliveries.length, 1);
});

test('five active subscription limit applies atomically to create and resume', async t => {
  const f = fixture(t);
  const items = [];
  for (let i = 0; i < 5; i++) items.push(await f.service.create(f.body({ request_id: `request_${i}`, context_inspection_id: `inspection_${i}` }), f.actor));
  await assert.rejects(f.service.create(f.body({ request_id: 'request_sixth', context_inspection_id: 'inspection_sixth' }), f.actor), { code: 'event_work_limit' });
  const paused = f.service.update(items[0].id, { version: 1, state: 'paused' }, f.actor);
  await f.service.create(f.body({ request_id: 'request_sixth', context_inspection_id: 'inspection_sixth' }), f.actor);
  assert.throws(() => f.service.update(paused.id, { version: paused.version, state: 'active' }, f.actor), { code: 'event_work_limit' });
});

test('rolling daily limit pauses at 12 attempts, with no thirteenth provider dispatch', async t => {
  const f = fixture(t), item = await f.service.create(f.body(), f.actor);
  for (let i = 0; i < 13; i++) { f.time(new Date(Date.parse('2026-10-20T01:00:00.000Z') + i * 6 * 60000).toISOString()); f.event(`daily_${i}`); await f.service.dispatchEvents(); }
  assert.equal(f.deliveries.length, 12); assert.equal(f.service.get(item.id, f.actor).state, 'paused');
  assert.ok(f.service.get(item.id, f.actor).history.some(row => row.error?.code === 'event_daily_limit'));
});

test('expired recorded events become missed receipts, never a burst of overdue paid work', async t => {
  const f = fixture(t), item = await f.service.create(f.body(), f.actor); f.event('old_event', { occurredAt: '2026-10-19T23:00:00.000Z' });
  await f.service.dispatchEvents(); assert.equal(f.deliveries.length, 0); assert.equal(f.service.get(item.id, f.actor).history[0].status, 'missed');
});

test('startup skips unclaimed old events and unknown interrupted sends fail closed', async t => {
  const f = fixture(t), item = await f.service.create(f.body(), f.actor); f.event('before_restart');
  f.restart(); await f.service.dispatchEvents(); assert.equal(f.deliveries.length, 0);
  f.db.prepare('INSERT INTO event_work_occurrences(id,subscription_id,event_id,event_type,occurred_at,status,dispatched,started_at) VALUES(?,?,?,?,?,?,?,?)').run('unknown_send', item.id, 'before_restart', 'route.created', '2026-10-20T01:00:00.000Z', 'running', 1, '2026-10-20T01:00:00.000Z');
  f.restart(); await f.service.dispatchEvents();
  const current = f.service.get(item.id, f.actor); assert.equal(current.state, 'paused'); assert.equal(current.history[0].status, 'interrupted'); assert.equal(f.deliveries.length, 0);
});

test('startup reconciles a canonical committed turn without another provider call', async t => {
  const f = fixture(t), item = await f.service.create(f.body(), f.actor); f.event('committed');
  f.db.prepare('INSERT INTO event_work_occurrences(id,subscription_id,event_id,event_type,occurred_at,status,dispatched,started_at) VALUES(?,?,?,?,?,?,?,?)').run('known_send', item.id, 'committed', 'route.created', '2026-10-20T01:00:00.000Z', 'running', 1, '2026-10-20T01:00:00.000Z');
  f.db.prepare('INSERT INTO runs VALUES(?,?)').run('known_run', 'completed'); f.db.prepare('INSERT INTO chat_turns VALUES(?,?,?,?,?)').run('known_send', 'chat', 'agent', 'known_run', 'known_message');
  f.restart(); await f.service.dispatchEvents();
  assert.equal(f.service.get(item.id, f.actor).history[0].result.run_id, 'known_run'); assert.equal(f.service.get(item.id, f.actor).history[0].status, 'completed'); assert.equal(f.deliveries.length, 0);
});

test('metadata capture preserves original snapshot and adds explicit bounded source provenance', () => {
  const original = { prefix: 'Old\n', finalPrompt: 'Old\nCurrent instruction:\nHello', manifest: { fingerprint: 'old', included: [], resolved: { workspace_id: 'ws' } }, sourceAccess: { version: 1, workspace_id: 'ws', sources: [{ id: 'old' }], connections: [] } };
  const next = appendEventInspection(original, { metadata: { event_type: 'route.created', source_type: 'route', source_id: 'new', occurred_at: '2026-10-20T01:00:00Z' }, sourceAccess: { sources: [{ id: 'new' }] } }, { subscriptionId: 'subscription', eventId: 'event' });
  assert.deepEqual(original.sourceAccess.sources, [{ id: 'old' }]); assert.notEqual(next.manifest.fingerprint, 'old');
  assert.deepEqual(next.sourceAccess.sources, [{ id: 'old' }, { id: 'new' }]); assert.equal(next.finalPrompt.endsWith('Current instruction:\nHello'), true);
  assert.deepEqual(next.manifest.event_trigger.fields, ['event_type', 'source_type', 'source_id', 'occurred_at']);
});

import { randomUUID, createHash } from 'node:crypto';
import { changeContext } from './change-context.mjs';
import { appendEventInspection } from './event-work-policy.mjs';

export const EVENT_WORK_EVENTS = Object.freeze([
  { id: 'route.created', label: 'A Route is created' },
  { id: 'route.updated', label: 'A Route is updated' },
  { id: 'update.published', label: 'An update or reply is published' },
]);
export const EVENT_WORK_LIMITS = Object.freeze({ active_per_creator: 5, daily_runs_per_subscription: 12, min_cooldown_minutes: 5 });
const fail = (message, code = 'invalid_event_work', statusCode = 400) => { throw Object.assign(new Error(message), { code, statusCode }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => { if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail('The event subscription contains unsupported fields.'); };
const stable = value => JSON.stringify(value, (_, item) => object(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const parse = value => JSON.parse(value);
const uid = prefix => `${prefix}_${randomUUID()}`;

export function installEventWork(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS event_work (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    creator_id TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
    title TEXT NOT NULL, trigger_json TEXT NOT NULL, payload_json TEXT NOT NULL, review_json TEXT NOT NULL,
    inspection_id TEXT NOT NULL UNIQUE, cooldown_minutes INTEGER NOT NULL,
    event_cursor INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'active', version INTEGER NOT NULL DEFAULT 1,
    last_dispatch_at TEXT, last_checked_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(workspace_id,creator_id,request_id));
    CREATE INDEX IF NOT EXISTS event_work_active ON event_work(state,last_checked_at);
    CREATE TABLE IF NOT EXISTS event_work_occurrences (
    id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES event_work(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL, event_type TEXT NOT NULL, occurred_at TEXT NOT NULL,
    status TEXT NOT NULL, dispatched INTEGER NOT NULL DEFAULT 0,
    result_json TEXT, error_json TEXT, started_at TEXT NOT NULL, finished_at TEXT,
    UNIQUE(subscription_id,event_id));`);
}

// Only explicitly consented event type/source identity/time are appended. Event
// bodies are never a grant to fetch arbitrary text or obey workspace records.
export function createEventWorkService({ db, allowed, actorFor, prepareMessage, dispatchMessage,
  authorizePayload, authorizeDelivery = () => {}, prepareTrigger, authorizeTrigger, matchEvent, eventReadable, eventInspection, activity = () => {}, now = () => new Date(),
  maxEventAgeMs = 15 * 60000 } = {}) {
  installEventWork(db);
  let dispatching = false;
  const instant = () => new Date(now()).toISOString();
  const cursor = workspaceId => db.prepare('SELECT COALESCE(MAX(rowid),0) n FROM change_log WHERE workspace_id=?').get(workspaceId).n;
  const transaction = operation => {
    const point = `event_${randomUUID().replaceAll('-', '')}`;
    db.exec(`SAVEPOINT ${point}`);
    try { const result = operation(); db.exec(`RELEASE ${point}`); return result; }
    catch (cause) { db.exec(`ROLLBACK TO ${point}; RELEASE ${point}`); throw cause; }
  };
  const internal = row => ({ ...row, kind: 'message', event_trigger: true, trigger: parse(row.trigger_json), payload: parse(row.payload_json), review: parse(row.review_json) });
  const workspace = (id, actor) => {
    if (!actor?.id || !db.prepare('SELECT 1 FROM workspaces WHERE id=? AND archived_at IS NULL').get(id) || !allowed(id, actor, 'workspace.read')) fail('This workspace is unavailable.', 'event_work_unavailable', 404);
  };
  const authorize = (row, actor, manage = false) => {
    workspace(row.workspace_id, actor);
    // A subscription spends its creator's account. Even managers cannot inspect
    // another person's private prompt or adopt their recurring authorization.
    if (row.creator_id !== actor.id) fail('This event subscription is unavailable.', 'event_work_unavailable', 404);
    const job = internal(row);
    authorizeTrigger(job, actor);
    authorizePayload(job, actor);
    return job;
  };
  const publicRow = (row, actor) => ({ id: row.id, workspace_id: row.workspace_id, creator_id: row.creator_id,
    title: row.title, trigger: parse(row.trigger_json), payload: parse(row.payload_json), cooldown_minutes: row.cooldown_minutes,
    state: row.state, version: row.version, last_dispatch_at: row.last_dispatch_at, created_at: row.created_at,
    updated_at: row.updated_at, can_edit: row.creator_id === actor.id,
    history: db.prepare('SELECT * FROM event_work_occurrences WHERE subscription_id=? ORDER BY started_at DESC,id DESC LIMIT 100').all(row.id).flatMap(item => {
      const event = db.prepare('SELECT * FROM change_log WHERE id=? AND workspace_id=?').get(item.event_id, row.workspace_id);
      // A receipt must not reveal even that a newly restricted event happened.
      if (!event || !eventReadable(event, actor)) return [];
      return [{ id: item.id, event_id: item.event_id, event_type: item.event_type, occurred_at: item.occurred_at,
        status: item.status, started_at: item.started_at, finished_at: item.finished_at,
        result: item.result_json ? parse(item.result_json) : null, error: item.error_json ? parse(item.error_json) : null }];
    }).slice(0, 30) });
  const getRow = (id, actor, manage = false) => {
    const row = db.prepare('SELECT * FROM event_work WHERE id=?').get(id);
    if (!row) fail('This event subscription is unavailable.', 'event_work_unavailable', 404);
    authorize(row, actor, manage); return row;
  };
  const get = (id, actor) => publicRow(getRow(id, actor), actor);
  const list = (workspaceId, actor) => {
    workspace(workspaceId, actor);
    const items = db.prepare('SELECT * FROM event_work WHERE workspace_id=? AND creator_id=? ORDER BY created_at DESC,id LIMIT 300').all(workspaceId, actor.id).flatMap(row => {
      try { authorize(row, actor); return [publicRow(row, actor)]; } catch { return []; }
    });
    return { items, limits: EVENT_WORK_LIMITS, events: EVENT_WORK_EVENTS };
  };
  const checkLimit = (workspaceId, actor, excluding = '') => {
    if (db.prepare("SELECT COUNT(*) n FROM event_work WHERE workspace_id=? AND creator_id=? AND state='active' AND id<>?").get(workspaceId, actor.id, excluding).n >= EVENT_WORK_LIMITS.active_per_creator) fail('Pause or cancel another subscription first. At most five event subscriptions can be active for your account in a workspace.', 'event_work_limit', 409);
  };
  async function create(body, actor) {
    exact(body, ['workspace_id', 'title', 'request_id', 'trigger', 'payload', 'context_inspection_id', 'cooldown_minutes', 'confirmed_recurring']);
    workspace(body.workspace_id, actor);
    if (body.confirmed_recurring !== true) fail('Explicitly confirm recurring agent execution and provider charges.');
    if (typeof body.request_id !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(body.request_id)) fail('Provide a stable event subscription request ID.');
    exact(body.trigger, ['event', 'target_type', 'target_id']);
    if (!EVENT_WORK_EVENTS.some(item => item.id === body.trigger.event) || !['workspace', 'project', 'route', 'area'].includes(body.trigger.target_type) || typeof body.trigger.target_id !== 'string' || !body.trigger.target_id || body.trigger.target_id.length > 300) fail('Choose a supported workspace event and scope.');
    if (!Number.isInteger(body.cooldown_minutes) || body.cooldown_minutes < 5 || body.cooldown_minutes > 1440) fail('Choose a cooldown between 5 and 1,440 minutes.');
    exact(body.payload, ['chat_id', 'agent_id', 'content', 'attachments', 'model']);
    if (!body.payload.agent_id || typeof body.context_inspection_id !== 'string') fail('Choose an existing connected agent and review the exact message context.');
    const requestHash = hash(body);
    const replay = () => {
      const row = db.prepare('SELECT * FROM event_work WHERE workspace_id=? AND creator_id=? AND request_id=?').get(body.workspace_id, actor.id, body.request_id);
      if (!row) return null;
      authorize(row, actor);
      if (row.request_hash !== requestHash) fail('This request ID belongs to another event subscription.', 'event_work_request_conflict', 409);
      return { ...publicRow(row, actor), replayed: true };
    };
    const previous = replay(); if (previous) return previous;
    checkLimit(body.workspace_id, actor);
    const triggerAccess = prepareTrigger(body.trigger, body.workspace_id, actor);
    const prepared = await prepareMessage({ ...body, kind: 'message', recurrence: 'none' }, actor);
    if (!prepared.payload.agent_id || !prepared.review.inspection) fail('Event subscriptions require an agent and a captured exact context.');
    if (prepared.review.inspection.finalPrompt?.length > 98000) fail('Review a smaller prompt/context snapshot to leave room for event metadata.', 'event_context_too_large');
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : prepared.title;
    if (typeof title !== 'string' || !title || title.length > 200) fail('Choose a title of at most 200 characters.');
    return transaction(() => {
      const previous = replay(); if (previous) return previous;
      checkLimit(body.workspace_id, actor);
      if (db.prepare('SELECT 1 FROM event_work WHERE inspection_id=?').get(body.context_inspection_id) || db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scheduled_work'").get() && db.prepare('SELECT 1 FROM scheduled_work WHERE inspection_id=?').get(body.context_inspection_id)) fail('This context review belongs to other work. Inspect again.', 'context_inspection_reserved', 409);
      prepared.recheck?.();
      const id = uid('event_work'), stamp = instant(), review = { ...prepared.review, trigger_access: triggerAccess };
      const row = { id, workspace_id: body.workspace_id, creator_id: actor.id, trigger_json: JSON.stringify(body.trigger), review_json: JSON.stringify(review), payload_json: JSON.stringify(prepared.payload) };
      authorizeTrigger(internal(row), actor);
      authorizeDelivery(internal(row), actor);
      db.prepare('INSERT INTO event_work(id,workspace_id,creator_id,request_id,request_hash,title,trigger_json,payload_json,review_json,inspection_id,cooldown_minutes,event_cursor,last_checked_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, body.workspace_id, actor.id, body.request_id, requestHash, title, row.trigger_json, row.payload_json, row.review_json, body.context_inspection_id, body.cooldown_minutes, cursor(body.workspace_id), stamp, stamp, stamp);
      activity(internal({ ...row, title }), actor, 'subscribed');
      return publicRow(db.prepare('SELECT * FROM event_work WHERE id=?').get(id), actor);
    });
  }
  function update(id, body, actor) {
    exact(body, ['version', 'state']);
    return transaction(() => {
      const row = getRow(id, actor, true);
      if (row.version !== body.version) fail('This subscription changed. Reload it first.', 'stale_event_work', 409);
      if (!['active', 'paused', 'cancelled'].includes(body.state) || row.state === 'cancelled') fail('This subscription can no longer be changed.', 'event_work_cancelled', 409);
      if (body.state === 'active') { checkLimit(row.workspace_id, actor, id); authorizeDelivery(internal(row), actor); }
      // Resume starts at current recorded state: no replay of events from the
      // paused interval and no renewed authorization for an unknown send.
      db.prepare('UPDATE event_work SET state=?,event_cursor=?,version=version+1,updated_at=? WHERE id=?').run(body.state, cursor(row.workspace_id), instant(), id);
      activity(internal(row), actor, body.state === 'active' ? 'resumed' : body.state);
      return publicRow(db.prepare('SELECT * FROM event_work WHERE id=?').get(id), actor);
    });
  }
  const pause = id => db.prepare("UPDATE event_work SET state='paused',version=version+1,updated_at=? WHERE id=? AND state='active'").run(instant(), id);
  function finish(id, status, result = null, cause = null) {
    db.prepare('UPDATE event_work_occurrences SET status=?,result_json=?,error_json=?,finished_at=? WHERE id=?').run(status, result ? JSON.stringify(result) : null, cause ? JSON.stringify({ code: cause.code || 'event_work_failed', message: cause.message || 'The event-triggered run failed.' }) : null, instant(), id);
  }
  function reconcile() {
    for (const receipt of db.prepare("SELECT * FROM event_work_occurrences WHERE status='running' AND result_json IS NOT NULL").all()) {
      const result = parse(receipt.result_json), run = result.run_id && db.prepare('SELECT status FROM runs WHERE id=?').get(result.run_id);
      if (run && !['completed', 'failed', 'stopped', 'interrupted'].includes(run.status)) continue;
      transaction(() => {
        const completed = run?.status === 'completed';
        finish(receipt.id, completed ? 'completed' : run?.status || 'interrupted', result, completed ? null : { code: run?.status || 'interrupted', message: 'Inspect the run history. This subscription was paused; the event will not be retried.' });
        if (!completed) pause(receipt.subscription_id);
      });
    }
  }
  async function dispatchEvents() {
    if (dispatching) return;
    dispatching = true;
    try {
      reconcile();
      for (const row of db.prepare("SELECT * FROM event_work WHERE state='active' ORDER BY last_checked_at,id LIMIT 30").all()) {
        const actor = actorFor(row.creator_id), job = internal(row);
        db.prepare('UPDATE event_work SET last_checked_at=? WHERE id=?').run(instant(), row.id);
        try { if (!actor) fail('The subscription creator is unavailable.', 'event_actor_unavailable', 403); authorize(row, actor); }
        catch { pause(row.id); continue; }
        for (const event of db.prepare('SELECT c.rowid event_cursor,c.*,a.actor_id,a.source FROM change_log c LEFT JOIN change_attribution a ON a.change_id=c.id WHERE c.workspace_id=? AND c.rowid>? ORDER BY c.rowid LIMIT 100').all(row.workspace_id, row.event_cursor)) {
          const eventType = matchEvent(job, event, actor);
          if (!eventType) { db.prepare('UPDATE event_work SET event_cursor=MAX(event_cursor,?) WHERE id=?').run(event.event_cursor, row.id); continue; }
          const receipt = transaction(() => {
            const latest = db.prepare("SELECT * FROM event_work WHERE id=? AND state='active'").get(row.id);
            if (!latest || latest.event_cursor >= event.event_cursor) return null;
            db.prepare('UPDATE event_work SET event_cursor=? WHERE id=?').run(event.event_cursor, row.id);
            if (db.prepare('SELECT 1 FROM event_work_occurrences WHERE subscription_id=? AND event_id=?').get(row.id, event.id)) return null;
            const stamp = instant(), age = Date.parse(stamp) - Date.parse(event.created_at);
            let status = 'running', cause = null;
            if (!Number.isFinite(age) || age < -60000 || age > maxEventAgeMs) { status = 'missed'; cause = { code: 'event_too_old', message: 'This event was outside the 15-minute delivery window. It was not replayed.' }; }
            else if (db.prepare("SELECT 1 FROM event_work_occurrences WHERE status='running'").get()) { status = 'skipped'; cause = { code: 'event_busy', message: 'Another event-triggered run was active. This event was not queued.' }; }
            else if (latest.last_dispatch_at && Date.parse(stamp) - Date.parse(latest.last_dispatch_at) < latest.cooldown_minutes * 60000) { status = 'skipped'; cause = { code: 'event_cooldown', message: 'This event arrived during the subscription cooldown.' }; }
            else if (db.prepare('SELECT COUNT(*) n FROM event_work_occurrences WHERE subscription_id=? AND dispatched=1 AND started_at>?').get(row.id, new Date(Date.parse(stamp) - 86400000).toISOString()).n >= EVENT_WORK_LIMITS.daily_runs_per_subscription) { status = 'limited'; cause = { code: 'event_daily_limit', message: 'The 12-run rolling daily limit was reached. The subscription was paused.' }; pause(row.id); }
            const receipt = { id: uid('event_send'), event_id: event.id, subscription_id: row.id };
            db.prepare('INSERT INTO event_work_occurrences(id,subscription_id,event_id,event_type,occurred_at,status,dispatched,error_json,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(receipt.id, row.id, event.id, eventType, event.created_at, status, status === 'running' ? 1 : 0, cause ? JSON.stringify(cause) : null, stamp, status === 'running' ? null : stamp);
            if (status === 'running') db.prepare('UPDATE event_work SET last_dispatch_at=? WHERE id=?').run(stamp, row.id);
            return { ...receipt, status };
          });
          if (!receipt || receipt.status !== 'running') continue;
          try {
            // Recheck immediately before the canonical launch, never trust event
            // text, a browser-supplied actor, or the authorization at creation.
            authorize(db.prepare('SELECT * FROM event_work WHERE id=?').get(row.id), actor);
            authorizeDelivery(job, actor);
            if (!eventReadable(event, actor)) fail('The triggering event is no longer available.', 'event_access_revoked', 403);
            const captured = appendEventInspection(job.review.inspection, eventInspection(job, event, actor), { subscriptionId: job.id, eventId: event.id });
            const occurrenceJob = { ...job, review: { ...job.review, inspection: captured } };
            const result = await changeContext.run({ actor, source: 'Event-triggered work' }, () => dispatchMessage(occurrenceJob, receipt, actor));
            transaction(() => {
              if (!result?.run_id) fail('An agent run could not be confirmed.', 'event_dispatch_uncertain', 409);
              db.prepare('UPDATE event_work_occurrences SET result_json=? WHERE id=?').run(JSON.stringify(result), receipt.id);
            });
          } catch (cause) { transaction(() => { finish(receipt.id, 'failed', null, cause); pause(row.id); }); break; }
        }
      }
      reconcile();
    } finally { dispatching = false; }
  }
  // Never replay an unknown paid dispatch after a process restart. A canonical
  // committed turn can be reconciled by its deterministic occurrence ID only.
  for (const row of db.prepare("SELECT o.*,w.payload_json FROM event_work_occurrences o JOIN event_work w ON w.id=o.subscription_id WHERE o.status='running' AND o.result_json IS NULL").all()) {
    const payload = parse(row.payload_json);
    const turn = db.prepare('SELECT run_id,source_message_id FROM chat_turns WHERE client_turn_id=? AND chat_id=? AND agent_id=?').get(row.id, payload.chat_id, payload.agent_id);
    if (turn) db.prepare('UPDATE event_work_occurrences SET result_json=? WHERE id=?').run(JSON.stringify({ run_id: turn.run_id, message_id: turn.source_message_id, chat_id: payload.chat_id }), row.id);
    else { finish(row.id, 'interrupted', null, { code: 'server_interrupted', message: 'The server stopped during dispatch. This subscription was paused; the event will not be retried.' }); pause(row.subscription_id); }
  }
  // No old event backlog is a new recurring authorization on server startup.
  for (const row of db.prepare("SELECT id,workspace_id FROM event_work WHERE state='active'").all()) db.prepare('UPDATE event_work SET event_cursor=? WHERE id=?').run(cursor(row.workspace_id), row.id);
  reconcile();
  return { create, get, list, update, dispatchEvents, reconcile };
}

export async function eventWorkRoute({ service, req, res, path, url, body, actor, send }) {
  if (path !== '/event-work' && !path.startsWith('/event-work/')) return false;
  if (path === '/event-work' && req.method === 'GET') { send(res, 200, { result: service.list(url.searchParams.get('workspace_id'), actor) }); return true; }
  if (path === '/event-work' && req.method === 'POST') { send(res, 201, { result: await service.create(body, actor) }); return true; }
  const match = path.match(/^\/event-work\/([^/]+)$/);
  if (match && req.method === 'GET') { send(res, 200, { result: service.get(match[1], actor) }); return true; }
  if (match && req.method === 'PATCH') { send(res, 200, { result: service.update(match[1], body, actor) }); return true; }
  fail('Unsupported event subscription operation.', 'method_not_allowed', 405);
}

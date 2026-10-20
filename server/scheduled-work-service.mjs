import { randomUUID, createHash } from 'node:crypto';
import { nextScheduledTime, scheduleInstant, validTimezone } from '../src/lib/scheduled-time.js';
import { changeContext } from './change-context.mjs';

const error = (message, code = 'invalid_schedule', statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const exact = (value, fields) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw error('The schedule contains unsupported fields.'); };
const parse = value => JSON.parse(value);
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const fingerprint = value => createHash('sha256').update(stable(value)).digest('hex');
const uid = kind => `${kind}_${randomUUID()}`;

export function installScheduledWork(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS scheduled_work (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    creator_id TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('message','action')), title TEXT NOT NULL,
    payload_json TEXT NOT NULL, review_json TEXT NOT NULL, inspection_id TEXT UNIQUE,
    timezone TEXT NOT NULL, recurrence TEXT NOT NULL CHECK(recurrence IN ('none','daily','weekly')),
    next_due_at TEXT, state TEXT NOT NULL DEFAULT 'active', version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(workspace_id,creator_id,request_id));
    CREATE INDEX IF NOT EXISTS scheduled_work_due ON scheduled_work(state,next_due_at);
    CREATE TABLE IF NOT EXISTS scheduled_work_occurrences (
      id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES scheduled_work(id) ON DELETE CASCADE,
      due_at TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT, error_json TEXT,
      started_at TEXT NOT NULL, finished_at TEXT, UNIQUE(schedule_id,due_at));`);
}

export function createScheduledWorkService({ db, allowed, actorFor, prepareMessage, dispatchMessage, prepareAction, dispatchAction, authorizePayload, activity = () => {}, now = () => new Date(), graceMs = 120000 } = {}) {
  installScheduledWork(db);
  let dispatching = false;
  const instant = () => new Date(now()).toISOString();
  const transaction = operation => {
    const point = `schedule_${randomUUID().replaceAll('-', '')}`;
    db.exec(`SAVEPOINT ${point}`);
    try { const value = operation(); db.exec(`RELEASE ${point}`); return value; }
    catch (cause) { db.exec(`ROLLBACK TO ${point}; RELEASE ${point}`); throw cause; }
  };
  const workspace = (id, actor) => {
    if (!actor?.id || !db.prepare('SELECT 1 FROM workspaces WHERE id=? AND archived_at IS NULL').get(id)) throw error('This workspace is unavailable.', 'schedule_unavailable', 404);
    if (!allowed(id, actor, 'workspace.read')) throw error('This workspace is unavailable.', 'schedule_unavailable', 404);
  };
  const internal = row => ({ ...row, payload: parse(row.payload_json), review: parse(row.review_json) });
  const authorize = (row, actor, manage = false) => {
    workspace(row.workspace_id, actor);
    if (row.creator_id !== actor.id && !allowed(row.workspace_id, actor, 'automations.manage')) throw error('This schedule is unavailable.', 'schedule_unavailable', 404);
    if (manage && row.creator_id !== actor.id) throw error('Only the person who scheduled this work can change its authorization.', 'schedule_owner_required', 403);
    authorizePayload(internal(row), actor);
  };
  const publicRow = row => ({ id: row.id, workspace_id: row.workspace_id, creator_id: row.creator_id, kind: row.kind, title: row.title, payload: parse(row.payload_json), timezone: row.timezone, recurrence: row.recurrence, next_due_at: row.next_due_at, state: row.state, version: row.version, created_at: row.created_at, updated_at: row.updated_at,
    history: db.prepare('SELECT * FROM scheduled_work_occurrences WHERE schedule_id=? ORDER BY due_at DESC LIMIT 30').all(row.id).map(item => ({ ...item, result: item.result_json ? parse(item.result_json) : null, error: item.error_json ? parse(item.error_json) : null, result_json: undefined, error_json: undefined })) });
  const getRow = (id, actor, manage = false) => { const row = db.prepare('SELECT * FROM scheduled_work WHERE id=?').get(id); if (!row) throw error('Schedule unavailable.', 'schedule_unavailable', 404); authorize(row, actor, manage); return row; };
  const get = (id, actor) => { const row = getRow(id, actor); return { ...publicRow(row), can_edit: row.creator_id === actor.id }; };
  const list = (workspaceId, actor) => {
    workspace(workspaceId, actor);
    return db.prepare('SELECT * FROM scheduled_work WHERE workspace_id=? ORDER BY created_at DESC LIMIT 300').all(workspaceId).flatMap(row => { try { authorize(row, actor); return [{ ...publicRow(row), can_edit: row.creator_id === actor.id }]; } catch { return []; } });
  };
  async function create(body, actor) {
    exact(body, ['workspace_id', 'kind', 'title', 'payload', 'local_time', 'timezone', 'recurrence', 'request_id', 'context_inspection_id']);
    workspace(body.workspace_id, actor);
    if (!['message', 'action'].includes(body.kind) || !validTimezone(body.timezone) || !['none', 'daily', 'weekly'].includes(body.recurrence || 'none')) throw error('Choose a message or action and a valid schedule.');
    if (body.kind === 'action' && (body.recurrence || 'none') !== 'none') throw error('An action approval applies once. Schedule recurring prompts to ask the agent for fresh actions.');
    if (typeof body.request_id !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(body.request_id)) throw error('Provide a stable schedule request ID.');
    const hash = fingerprint(body), existing = db.prepare('SELECT * FROM scheduled_work WHERE workspace_id=? AND creator_id=? AND request_id=?').get(body.workspace_id, actor.id, body.request_id);
    if (existing) { authorize(existing, actor); if (existing.request_hash !== hash) throw error('This request ID already belongs to another schedule.', 'schedule_request_conflict', 409); return { ...publicRow(existing), replayed: true }; }
    let dueAt;
    try { dueAt = scheduleInstant(body.local_time, body.timezone); } catch (cause) { throw error(cause.message); }
    if (Date.parse(dueAt) <= new Date(now()).getTime() || Date.parse(dueAt) > new Date(now()).getTime() + 5 * 366 * 86400000) throw error('Choose a future time within the next five years.');
    const prepared = body.kind === 'message' ? await prepareMessage(body, actor) : prepareAction(body, actor);
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : prepared.title;
    if (typeof title !== 'string' || !title || title.length > 200) throw error('Choose a title of at most 200 characters.');
    const id = uid('scheduled'), stamp = instant();
    return transaction(() => {
      // Provider/context preparation may await. Another identical request can
      // finish during that gap; recheck its durable receipt under the lock.
      const replay = db.prepare('SELECT * FROM scheduled_work WHERE workspace_id=? AND creator_id=? AND request_id=?').get(body.workspace_id, actor.id, body.request_id);
      if (replay) { authorize(replay, actor); if (replay.request_hash !== hash) throw error('This request ID already belongs to another schedule.', 'schedule_request_conflict', 409); return { ...publicRow(replay), replayed: true }; }
      if (body.context_inspection_id && db.prepare('SELECT 1 FROM scheduled_work WHERE inspection_id=?').get(body.context_inspection_id)) throw error('This context review already belongs to a schedule. Inspect again for another message.', 'context_inspection_reserved', 409);
      prepared.recheck?.();
      db.prepare('INSERT INTO scheduled_work(id,workspace_id,creator_id,request_id,request_hash,kind,title,payload_json,review_json,inspection_id,timezone,recurrence,next_due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, body.workspace_id, actor.id, body.request_id, hash, body.kind, title, JSON.stringify(prepared.payload), JSON.stringify(prepared.review), body.context_inspection_id || null, body.timezone, body.recurrence || 'none', dueAt, stamp, stamp);
      if (body.kind === 'action') {
        const changed = db.prepare("UPDATE agent_action_requests SET status='scheduled',result_json=? WHERE id=? AND status='pending'").run(JSON.stringify({ schedule_id: id, due_at: dueAt }), prepared.payload.action_request_id);
        if (changed.changes !== 1) throw error('This action was already handled.', 'stale_action', 409);
      }
      const row = db.prepare('SELECT * FROM scheduled_work WHERE id=?').get(id);
      activity(internal(row), actor, 'scheduled');
      return { ...publicRow(row), can_edit: true };
    });
  }
  function update(id, body, actor) {
    exact(body, ['version', 'state', 'local_time', 'run_at', 'timezone']);
    return transaction(() => {
      const row = getRow(id, actor, true);
      if (row.version !== body.version) throw error('This schedule changed. Reload it first.', 'stale_schedule', 409);
      if (!['active', 'paused', 'cancelled'].includes(body.state) || ['cancelled', 'finished'].includes(row.state)) throw error('This schedule can no longer be changed.', 'schedule_finished', 409);
      let due = row.next_due_at, timezone = row.timezone;
      if (body.run_at !== undefined && body.local_time !== undefined) throw error('Choose either an exact instant or a local time, not both.');
      if (body.timezone !== undefined && !validTimezone(body.timezone)) throw error('Choose a valid time zone.');
      if (body.timezone !== undefined && body.local_time === undefined && body.run_at === undefined) throw error('Choose a local date and time when changing the time zone.');
      if (body.run_at !== undefined) {
        if (body.timezone === undefined || typeof body.run_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(body.run_at) || !Number.isFinite(Date.parse(body.run_at)) || new Date(body.run_at).toISOString().slice(0,19) !== body.run_at.slice(0,19)) throw error('Choose an exact UTC instant and a valid time zone.');
        due = new Date(body.run_at).toISOString(); timezone = body.timezone;
        if (Date.parse(due) <= new Date(now()).getTime() || Date.parse(due) > new Date(now()).getTime() + 5 * 366 * 86400000) throw error('Choose a future time within the next five years.');
      }
      if (body.local_time !== undefined) { timezone = body.timezone || timezone; try { due = scheduleInstant(body.local_time, timezone); } catch (cause) { throw error(cause.message); } if (Date.parse(due) <= new Date(now()).getTime() || Date.parse(due) > new Date(now()).getTime() + 5 * 366 * 86400000) throw error('Choose a future time within the next five years.'); }
      if (body.state === 'active' && Date.parse(due) <= new Date(now()).getTime()) throw error('Choose a new future time before resuming this schedule.');
      db.prepare('UPDATE scheduled_work SET state=?,next_due_at=?,timezone=?,version=version+1,updated_at=? WHERE id=?').run(body.state, due, timezone, instant(), id);
      if (body.state === 'cancelled' && row.kind === 'action') db.prepare("UPDATE agent_action_requests SET status='pending',result_json=NULL WHERE id=? AND status='scheduled'").run(parse(row.payload_json).action_request_id);
      activity(internal(row), actor, body.state === 'active' ? 'resumed' : body.state);
      return { ...publicRow(db.prepare('SELECT * FROM scheduled_work WHERE id=?').get(id)), can_edit: true };
    });
  }
  function finish(job, occurrence, actor, status, result, cause) {
    db.prepare('UPDATE scheduled_work_occurrences SET status=?,result_json=?,error_json=?,finished_at=? WHERE id=?').run(status, result ? JSON.stringify(result) : null, cause ? JSON.stringify({ code: cause.code || 'scheduled_work_failed', message: cause.message || 'Scheduled work failed.' }) : null, instant(), occurrence.id);
    if (job.kind === 'action') db.prepare('UPDATE agent_action_requests SET status=?,result_json=?,resolved_at=? WHERE id=? AND status=?').run(status === 'completed' ? 'applied' : 'pending', status === 'completed' ? JSON.stringify(result) : null, status === 'completed' ? instant() : null, job.payload.action_request_id, 'scheduled');
    if (actor) activity(job, actor, status);
  }
  function reconcile() {
    for (const row of db.prepare("SELECT o.*,s.payload_json,s.review_json,s.workspace_id,s.creator_id,s.kind,s.title FROM scheduled_work_occurrences o JOIN scheduled_work s ON s.id=o.schedule_id WHERE o.status='running' AND o.result_json IS NOT NULL").all()) {
      const result = parse(row.result_json), run = result.run_id ? db.prepare('SELECT * FROM runs WHERE id=?').get(result.run_id) : null;
      if (!run || ['completed', 'failed', 'stopped', 'interrupted'].includes(run.status)) {
        const actor = actorFor(row.creator_id), job = internal(db.prepare('SELECT * FROM scheduled_work WHERE id=?').get(row.schedule_id));
        transaction(() => finish(job, row, actor, run?.status === 'completed' ? 'completed' : run?.status || 'interrupted', result, run?.status === 'completed' ? null : error('The scheduled agent run did not complete. Inspect its run history.', run?.status || 'interrupted')));
      }
    }
  }
  async function dispatchDue() {
    if (dispatching) return;
    dispatching = true;
    try {
      reconcile();
      const current = instant();
      for (const row of db.prepare("SELECT * FROM scheduled_work WHERE state='active' AND next_due_at<=? ORDER BY next_due_at,id LIMIT 30").all(current)) {
        const job = internal(row), actor = actorFor(row.creator_id);
        const occurrence = transaction(() => {
          const latest = db.prepare("SELECT * FROM scheduled_work WHERE id=? AND state='active' AND next_due_at=?").get(row.id, row.next_due_at);
          if (!latest || db.prepare('SELECT 1 FROM scheduled_work_occurrences WHERE schedule_id=? AND due_at=?').get(row.id, row.next_due_at)) return null;
          const occurrence = { id: uid('scheduled_send'), schedule_id: row.id, due_at: row.next_due_at };
          db.prepare('INSERT INTO scheduled_work_occurrences(id,schedule_id,due_at,status,started_at) VALUES(?,?,?,?,?)').run(occurrence.id, row.id, row.next_due_at, 'running', current);
          const next = nextScheduledTime(row.next_due_at, row.recurrence, row.timezone, current);
          db.prepare('UPDATE scheduled_work SET state=?,next_due_at=?,version=version+1,updated_at=? WHERE id=?').run(next ? 'active' : 'finished', next, current, row.id);
          return occurrence;
        });
        if (!occurrence) continue;
        try {
          if (!actor) throw error('The person who scheduled this work is unavailable.', 'schedule_actor_unavailable', 403);
          authorize(row, actor);
          if (Date.parse(current) - Date.parse(occurrence.due_at) > graceMs) throw error('Talvori was not running at the scheduled time. This occurrence was missed.', 'missed_schedule', 409);
          await changeContext.run({ actor, source: 'Scheduled work' }, async () => {
            if (row.kind === 'action') transaction(() => { const result = dispatchAction(job, occurrence, actor); finish(job, occurrence, actor, 'completed', result); });
            else {
              const result = await dispatchMessage(job, occurrence, actor);
              transaction(() => {
                if (result.run_id) db.prepare('UPDATE scheduled_work_occurrences SET result_json=? WHERE id=?').run(JSON.stringify(result), occurrence.id);
                else finish(job, occurrence, actor, 'completed', result);
              });
            }
          });
        } catch (cause) { transaction(() => finish(job, occurrence, actor, cause.code === 'missed_schedule' ? 'missed' : 'failed', null, cause)); }
      }
      reconcile();
    } finally { dispatching = false; }
  }
  // An unknown dispatch is never replayed after restart. Canonical chat turns
  // can be reconciled by their deterministic occurrence ID without another send.
  for (const row of db.prepare("SELECT o.*,s.kind,s.payload_json FROM scheduled_work_occurrences o JOIN scheduled_work s ON s.id=o.schedule_id WHERE o.status='running' AND o.result_json IS NULL").all()) {
    const payload = parse(row.payload_json);
    const turn = row.kind === 'message' && payload.agent_id ? db.prepare('SELECT run_id,source_message_id FROM chat_turns WHERE client_turn_id=? AND chat_id=? AND agent_id=?').get(row.id,payload.chat_id,payload.agent_id) : null;
    const note = row.kind === 'message' && !payload.agent_id ? db.prepare('SELECT id,chat_id,metadata_json FROM messages WHERE id=? AND chat_id=?').get(`message_${row.id}`,payload.chat_id) : null;
    let confirmedNote = false;
    try { const metadata = note && parse(note.metadata_json); confirmedNote = Boolean(metadata?.scheduled_occurrence_id === row.id && metadata?.scheduled_work_id === row.schedule_id); } catch { /* An unrelated or malformed note is not delivery evidence. */ }
    const result = turn ? { run_id: turn.run_id, message_id: turn.source_message_id } : confirmedNote ? { message_id: note.id, chat_id: note.chat_id, delivery: 'note' } : null;
    db.prepare('UPDATE scheduled_work_occurrences SET status=?,result_json=?,error_json=?,finished_at=? WHERE id=?').run(turn ? 'running' : confirmedNote ? 'completed' : 'interrupted', result ? JSON.stringify(result) : null, result ? null : JSON.stringify({ code: 'server_interrupted', message: 'The server stopped during dispatch. This occurrence will not be replayed.' }), turn ? null : instant(), row.id);
    // Local action application and its result are atomic. An interrupted claim
    // with no committed result did not apply; return it to human review, never
    // retry it automatically or leave a permanently stranded scheduled action.
    if (row.kind === 'action') db.prepare("UPDATE agent_action_requests SET status='pending',result_json=NULL,resolved_at=NULL WHERE id=? AND status='scheduled'").run(payload.action_request_id);
  }
  return { create, get, list, update, dispatchDue, reconcile };
}

export async function scheduledWorkRoute({ service, req, res, path, url, body, actor, send }) {
  if (path !== '/scheduled-work' && !path.startsWith('/scheduled-work/')) return false;
  if (path === '/scheduled-work' && req.method === 'GET') { send(res, 200, { result: service.list(url.searchParams.get('workspace_id'), actor) }); return true; }
  if (path === '/scheduled-work' && req.method === 'POST') { send(res, 201, { result: await service.create(body, actor) }); return true; }
  const item = path.match(/^\/scheduled-work\/([^/]+)$/);
  if (item && req.method === 'GET') { send(res, 200, { result: service.get(item[1], actor) }); return true; }
  if (item && req.method === 'PATCH') { send(res, 200, { result: service.update(item[1], body, actor) }); return true; }
  throw error('Unsupported schedule operation.', 'method_not_allowed', 405);
}

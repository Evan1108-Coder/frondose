import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { sanitizeRunnerPayload, sanitizeRunnerText, sanitizeRunnerReply } from './runner-events.mjs';
import { runnerRequiresNativeTools } from '../src/lib/runner-policy.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });
const ACTIVE = ['queued', 'claimed', 'running', 'cancel_requested'];
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function installRunnerJobs(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS personal_runner_jobs (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id), workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL, actor_id TEXT NOT NULL, owner_actor_id TEXT NOT NULL,
    runner_id TEXT NOT NULL, runtime_id TEXT NOT NULL, settings_version INTEGER NOT NULL,
    session_key TEXT NOT NULL, request_json TEXT NOT NULL,
    state TEXT NOT NULL, lease_hash TEXT, last_sequence INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL, claimed_at INTEGER,
    completed_at INTEGER, result_hash TEXT, error_code TEXT
  );
  CREATE INDEX IF NOT EXISTS personal_runner_jobs_queue ON personal_runner_jobs(runner_id,state,created_at);
  CREATE INDEX IF NOT EXISTS personal_runner_jobs_agent ON personal_runner_jobs(workspace_id,agent_id,state);`);
  // A restarted server cannot know whether an old claim reached a provider.
  // Never redeliver or reconstruct an uncertain paid invocation automatically.
  db.prepare("UPDATE personal_runner_jobs SET state='interrupted',error_code='server_interrupted',completed_at=? WHERE state IN ('queued','claimed','running','cancel_requested')").run(Date.now());
}

export function createRunnerJobsService({ db, connections, settings, authorizeJob, now = () => Date.now() }) {
  const callbacks = new Map();
  const row = id => db.prepare('SELECT * FROM personal_runner_jobs WHERE id=?').get(id);
  const activeCount = (sql, ...args) => Number(db.prepare(sql).get(...args).n);
  function authorization(job) {
    const current = settings.authorizeUse({ workspaceId: job.workspace_id, agentId: job.agent_id, actor: { id: job.actor_id } });
    if (current.version !== job.settings_version || current.owner_actor_id !== job.owner_actor_id || current.runner_id !== job.runner_id || current.runtime_id !== job.runtime_id) throw fail('runner_binding_changed', 'The agent connection changed before this request completed.');
    const request = JSON.parse(job.request_json);
    const computer = connections.get({workspaceId:job.workspace_id,actor:{id:job.owner_actor_id},runnerId:job.runner_id});
    if (request.workMode === 'project' && !computer.execution_policy.project_ids.includes(request.projectId)) throw fail('runner_project_revoked','This project mapping was revoked.');
    if (authorizeJob(job) !== true) throw fail('runner_source_access_revoked', 'The request context is no longer authorized.', 403);
    return current;
  }
  function finish(job, result) {
    if (!job || !ACTIVE.includes(job.state)) return;
    const status = ['completed', 'failed', 'stopped', 'interrupted'].includes(result.status) ? result.status : 'failed';
    db.prepare('UPDATE personal_runner_jobs SET state=?,completed_at=?,error_code=? WHERE id=?').run(status, now(), result.error_code || null, job.id);
    const handler = callbacks.get(job.id); callbacks.delete(job.id);
    handler?.onComplete?.({ ...result, status, text: result.text || '' });
  }
  function sweep() {
    for (const job of db.prepare("SELECT * FROM personal_runner_jobs WHERE state IN ('queued','claimed','running','cancel_requested')").all()) {
      if (job.deadline_at <= now()) finish(job, { status: job.state === 'queued' ? 'failed' : 'interrupted', error_code: 'runner_deadline', error: 'Computer request deadline reached; delivery is not retried automatically.' });
      else {
        try { authorization(job); }
        catch { finish(job, { status: 'stopped', error_code: 'runner_access_revoked', error: 'Computer request stopped because access or its binding changed.' }); }
      }
    }
  }
  function validateRequest({ workspaceId, agentId, actor, request }) {
    const current = settings.authorizeUse({ workspaceId, agentId, actor });
    const computer = connections.get({ workspaceId, actor: { id: current.owner_actor_id }, runnerId: current.runner_id });
    if (runnerRequiresNativeTools(current.runtime_id) && (!current.native_tools_allowed || !computer.execution_policy.native_tools_approved || request.workMode !== 'project' || request.permissionMode !== 'workspace-write')) throw fail('runner_native_tools_required', 'This runtime requires explicit trusted native-tool consent and reviewed project editing. It cannot guarantee read-only chat.');
    if (request.workMode === 'project' && (!request.projectId || !computer.execution_policy.project_ids.includes(request.projectId))) throw fail('runner_project_not_mapped', 'Map this project to a specific folder in the local helper before starting project work.');
    if (activeCount("SELECT count(*) AS n FROM personal_runner_jobs WHERE workspace_id=? AND agent_id=? AND state IN ('queued','claimed','running','cancel_requested')", workspaceId, agentId) >= current.max_concurrent_sessions) throw fail('runner_agent_busy', 'This agent has reached its simultaneous-session limit.');
    if (activeCount("SELECT count(*) AS n FROM personal_runner_jobs WHERE runner_id=? AND state IN ('queued','claimed','running','cancel_requested')", current.runner_id) >= computer.execution_policy.max_concurrent_sessions) throw fail('runner_computer_busy', 'This computer has reached its locally authorized session limit.');
    if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 100_000) throw fail('runner_prompt_invalid', 'The reviewed prompt is empty or too large.', 400);
    return current;
  }
  function enqueue({ runId, workspaceId, agentId, actor, request }, handlers) {
    const current = validateRequest({workspaceId,agentId,actor,request});
    const id = `job_${randomUUID()}`;
    const key = hash(JSON.stringify([workspaceId, agentId, actor.id, current.session_policy === 'conversation' ? request.chatId || runId : runId]));
    const payload = { prompt: request.prompt, model: request.model || '', workMode: request.workMode, permissionMode: request.permissionMode, projectId: request.projectId || null, timeoutMs: request.timeoutMs, nativeToolsApproved: current.native_tools_allowed && request.workMode === 'project' && request.permissionMode === 'workspace-write', reasoningEffort: request.reasoningEffort || '' };
    const deadline = now() + Math.min(1_800_000, Math.max(1000, request.timeoutMs || 120_000));
    db.prepare(`INSERT INTO personal_runner_jobs(id,run_id,workspace_id,agent_id,actor_id,owner_actor_id,runner_id,runtime_id,settings_version,session_key,request_json,state,created_at,deadline_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, runId, workspaceId, agentId, actor.id, current.owner_actor_id, current.runner_id, current.runtime_id, current.version, key, JSON.stringify(payload), 'queued', now(), deadline);
    const job = row(id);
    try { authorization(job); } catch (error) { db.prepare("UPDATE personal_runner_jobs SET state='failed',completed_at=?,error_code=? WHERE id=?").run(now(), error.code || 'access_denied', id); throw error; }
    callbacks.set(id, handlers);
    handlers.onEvent?.({ type: 'runner.queued', summary: 'Waiting for the paired computer', payload: { runtime_id: current.runtime_id, session_key: key, session_policy: current.session_policy, native_history_resumed: false } });
    return { jobId: id, stop() { const latest = row(id); if (latest?.state === 'queued') finish(latest, { status: 'stopped', error_code: 'user_stop' }); else if (latest && ACTIVE.includes(latest.state)) db.prepare("UPDATE personal_runner_jobs SET state='cancel_requested' WHERE id=?").run(id); } };
  }
  function transport(runnerId, credential) {
    const runner = connections.authenticate(runnerId, credential);
    if (!runner.approved) throw fail('runner_approval_required', 'Approve this computer in the browser first.', 403);
    return runner;
  }
  function leased(runnerId, credential, jobId, leaseToken) {
    transport(runnerId, credential);
    const job = row(jobId);
    if (!job || job.runner_id !== runnerId || typeof leaseToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(leaseToken) || !safeEqual(job.lease_hash, hash(leaseToken))) throw fail('runner_job_denied', 'This job claim is unavailable.', 403);
    return job;
  }
  function poll(runnerId, credential, activeJobIds = []) {
    transport(runnerId, credential); sweep();
    if (!Array.isArray(activeJobIds) || activeJobIds.length > 8 || activeJobIds.some(id => typeof id !== 'string' || id.length > 100)) throw fail('invalid_active_jobs', 'Invalid active job list.', 400);
    const cancelJobIds = activeJobIds.filter(id => { const job = row(id); return !job || job.runner_id !== runnerId || !['claimed', 'running'].includes(job.state); });
    const claimed = activeCount("SELECT count(*) AS n FROM personal_runner_jobs WHERE runner_id=? AND state IN ('claimed','running','cancel_requested')", runnerId);
    const runner = connections.authenticate(runnerId, credential);
    const policy = JSON.parse(runner.execution_policy_json || '{}');
    if (claimed >= (policy.max_concurrent_sessions || 1)) return { job: null, cancel_job_ids: cancelJobIds, next_poll_ms: 1500 };
    const job = db.prepare("SELECT * FROM personal_runner_jobs WHERE runner_id=? AND state='queued' ORDER BY created_at,id LIMIT 1").get(runnerId);
    if (!job) return { job: null, cancel_job_ids: cancelJobIds, next_poll_ms: 1500 };
    authorization(job);
    const token = randomBytes(32).toString('base64url');
    const changed = db.prepare("UPDATE personal_runner_jobs SET state='claimed',lease_hash=?,claimed_at=? WHERE id=? AND state='queued'").run(hash(token), now(), job.id);
    if (changed.changes !== 1) return { job: null, cancel_job_ids: cancelJobIds, next_poll_ms: 1500 };
    return { job: { id: job.id, runId: job.run_id, providerId: job.runtime_id, workspaceId: job.workspace_id, agentId: job.agent_id, actorId: job.actor_id, sessionId: job.session_key, leaseToken: token, deadlineAt: job.deadline_at, ...JSON.parse(job.request_json) }, cancel_job_ids: cancelJobIds, next_poll_ms: 1500 };
  }
  function events(runnerId, credential, input) {
    const job = leased(runnerId, credential, input.job_id, input.lease_token);
    if (ACTIVE.includes(job.state) && job.deadline_at <= now()) { finish(job,{status:'interrupted',error_code:'runner_deadline'}); throw fail('runner_deadline','This request deadline has passed.'); }
    if (!['claimed', 'running'].includes(job.state)) throw fail('runner_job_stopped', 'This computer request is no longer running.');
    authorization(job);
    if (!Array.isArray(input.events) || input.events.length > 25 || Buffer.byteLength(JSON.stringify(input.events)) > 128_000) throw fail('runner_events_invalid', 'Send a bounded batch of provider events.', 400);
    let sequence = job.last_sequence;
    const prepared = [];
    for (const entry of input.events) {
      if (!entry || !Number.isSafeInteger(entry.sequence) || entry.sequence < 1) throw fail('runner_event_sequence', 'Invalid provider event sequence.', 400);
      if (entry.sequence <= sequence) continue;
      if (entry.sequence !== sequence + 1) throw fail('runner_event_sequence', 'Provider event sequence has a gap.', 409);
      if (entry.sequence > 5000) throw fail('runner_events_limit', 'This request reached its bounded activity limit.', 413);
      const clean = sanitizeRunnerPayload(entry.event).payload;
      if (!clean || clean.schema !== 'frondose.runner-event' || clean.version !== 1) throw fail('runner_event_invalid', 'Provider event format is invalid.', 400);
      const canonical = { ...clean, id:`${job.id}:${entry.sequence}`, receivedAt:new Date(now()).toISOString(), renderer:'escaped-text', sessionId: job.session_key, workspaceId: job.workspace_id, actorId: job.actor_id, providerId: job.runtime_id, sequence: entry.sequence, authority: 'observed-only' };
      prepared.push({ type: `runner.${String(clean.kind || 'unknown').replace(/[^a-z_-]/g, '').slice(0, 40)}`, summary: sanitizeRunnerText(clean.title || clean.text || `Provider ${clean.kind || 'activity'}`, 500), payload: { runner_event: canonical } });
      sequence = entry.sequence;
    }
    for (const event of prepared) callbacks.get(job.id)?.onEvent?.(event);
    db.prepare("UPDATE personal_runner_jobs SET last_sequence=?,state='running' WHERE id=?").run(sequence, job.id);
    return { accepted_sequence: sequence };
  }
  function complete(runnerId, credential, input) {
    const job = leased(runnerId, credential, input.job_id, input.lease_token);
    if (ACTIVE.includes(job.state) && job.deadline_at <= now()) { finish(job,{status:'interrupted',error_code:'runner_deadline'}); return {received:true,discarded:true}; }
    if (!['completed', 'failed', 'stopped'].includes(input.status) || typeof input.text !== 'string' || input.text.length > 100_000 || input.provider_session_id !== undefined && (typeof input.provider_session_id !== 'string' || input.provider_session_id.length > 200) || input.error_code && !/^[A-Za-z0-9_.:-]{1,100}$/.test(input.error_code)) throw fail('runner_result_invalid', 'Invalid computer result.', 400);
    const resultHash = hash(JSON.stringify([input.status, input.text, input.error_code || '', input.provider_session_id || '']));
    if (!ACTIVE.includes(job.state)) {
      if (job.result_hash === resultHash) return { received: true, replayed: true };
      throw fail('runner_job_finished', 'This computer request has already ended.');
    }
    const cancelled = job.state === 'cancel_requested';
    try { authorization(job); } catch { finish(job, { status: 'stopped', error_code: 'runner_access_revoked' }); return { received: true, discarded: true }; }
    db.prepare('UPDATE personal_runner_jobs SET result_hash=? WHERE id=?').run(resultHash, job.id);
    finish(job, { status: cancelled ? 'stopped' : input.status, text: cancelled ? '' : sanitizeRunnerReply(input.text), error_code: input.error_code || null, error: input.status === 'failed' ? 'The computer runtime failed. Inspect the recorded provider activity and local sign-in.' : null });
    return { received: true, replayed: false };
  }
  function close() {
    for (const job of db.prepare("SELECT * FROM personal_runner_jobs WHERE state IN ('queued','claimed','running','cancel_requested')").all()) finish(job, { status: 'interrupted', error_code: 'server_interrupted' });
    callbacks.clear();
  }
  return { validateRequest, enqueue, poll, events, complete, sweep, close };
}

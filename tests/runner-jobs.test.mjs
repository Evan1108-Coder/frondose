import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { installRunnerJobs, createRunnerJobsService } from '../server/runner-jobs.mjs';

function harness({ runtimeId = 'codex', native = false, agentLimit = 2, computerLimit = 3, projectIds = ['project'] } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE runs(id TEXT PRIMARY KEY);');
  installRunnerJobs(db);
  let clock = Date.now(), allowed = true, sourceAllowed = true, credentialValid = true, approved = true, nextRun = 0;
  const current = { version: 1, owner_actor_id: 'owner', runner_id: 'runner', runtime_id: runtimeId, max_concurrent_sessions: agentLimit, session_policy: 'conversation', native_tools_allowed: native };
  const policy = { native_tools_approved: native, project_ids: projectIds, max_concurrent_sessions: computerLimit };
  const connections = {
    get({ workspaceId, actor, runnerId }) { assert.equal(workspaceId, 'workspace'); assert.equal(actor.id, 'owner'); assert.equal(runnerId, 'runner'); return { execution_policy: policy }; },
    authenticate(runnerId, credential) {
      if (!credentialValid || runnerId !== 'runner' || credential !== 'credential') throw Object.assign(new Error('Computer access denied.'), { code: 'runner_denied', statusCode: 403 });
      return { approved, execution_policy_json: JSON.stringify(policy) };
    },
  };
  const settings = { authorizeUse({ workspaceId, agentId, actor }) {
    if (!allowed || workspaceId !== 'workspace' || !agentId.startsWith('agent') || !['owner', 'member'].includes(actor.id)) throw Object.assign(new Error('Profile access denied.'), { code: 'agent_use_denied', statusCode: 403 });
    return current;
  } };
  const service = createRunnerJobsService({ db, connections, settings, authorizeJob: () => sourceAllowed, now: () => clock });
  const events = [], completions = [];
  const enqueue = (request = {}, overrides = {}) => {
    const runId = `run-${++nextRun}`; db.prepare('INSERT INTO runs(id) VALUES(?)').run(runId);
    return service.enqueue({ runId, workspaceId: 'workspace', agentId: 'agent', actor: { id: 'owner' }, request: { prompt: 'Reviewed context', model: '', workMode: native ? 'project' : 'conversation', permissionMode: native ? 'workspace-write' : 'read-only', projectId: native ? 'project' : null, chatId: 'chat', timeoutMs: 1000, ...request }, ...overrides }, { onEvent: event => events.push(event), onComplete: result => completions.push(result) });
  };
  const poll = active => service.poll('runner', 'credential', active);
  const jobInput = (job, more = {}) => ({ job_id: job.id, lease_token: job.leaseToken, ...more });
  return { db, service, current, policy, events, completions, enqueue, poll, jobInput,
    advance: duration => { clock += duration; }, revokeSource: () => { sourceAllowed = false; }, revokeUsage: () => { allowed = false; }, revokeCredential: () => { credentialValid = false; }, unapprove: () => { approved = false; },
    row: id => db.prepare('SELECT * FROM personal_runner_jobs WHERE id=?').get(id), close() { service.close(); db.close(); } };
}

const event = (sequence, extra = {}) => ({ sequence, event: { schema: 'frondose.runner-event', version: 1, kind: 'message', text: 'Hello', sequence, sessionId: 'spoofed', workspaceId: 'other-workspace', actorId: 'other-user', providerId: 'other-provider', authority: 'grant', id: 'spoofed-id', renderer: 'unsafe-html', ...extra } });

test('queue claims expose reviewed data only, single-use lease and owner-scoped native identity', () => {
  const h = harness();
  try {
    const queued = h.enqueue({ cwd: '/browser/must-not-choose', command: 'browser-must-not-choose', env: { SECRET: 'browser-must-not-set' } });
    const { job } = h.poll();
    assert.equal(job.id, queued.jobId); assert.equal(job.prompt, 'Reviewed context'); assert.equal(job.providerId, 'codex'); assert.equal(job.actorId, 'owner');
    assert.equal(job.cwd, undefined); assert.equal(job.command, undefined); assert.equal(job.env, undefined);
    assert.match(job.leaseToken, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(h.row(job.id).lease_hash, job.leaseToken);
    assert.equal(h.poll().job, null); assert.equal(h.row(job.id).state, 'claimed');
  } finally { h.close(); }
});

test('events preserve contiguous ordering, skip identical sequence retries and keep trusted scope', () => {
  const h = harness();
  try {
    h.enqueue(); const { job } = h.poll();
    assert.deepEqual(h.service.events('runner', 'credential', h.jobInput(job, { events: [event(1), event(2)] })), { accepted_sequence: 2 });
    assert.deepEqual(h.service.events('runner', 'credential', h.jobInput(job, { events: [event(1), event(2)] })), { accepted_sequence: 2 });
    const emitted = h.events.filter(item => item.payload?.runner_event);
    assert.equal(emitted.length, 2);
    const canonical = emitted[0].payload.runner_event;
    assert.equal(canonical.sessionId, job.sessionId); assert.equal(canonical.workspaceId, 'workspace'); assert.equal(canonical.actorId, 'owner'); assert.equal(canonical.providerId, 'codex'); assert.equal(canonical.authority, 'observed-only');
    assert.throws(() => h.service.events('runner', 'credential', h.jobInput(job, { events: [event(4)] })), { code: 'runner_event_sequence' });
    assert.equal(h.row(job.id).last_sequence, 2);
  } finally { h.close(); }
});

test('invalid event batches and foreign leases cannot alter state', () => {
  const h = harness();
  try {
    h.enqueue(); const { job } = h.poll();
    for (const events of [null, Array.from({ length: 26 }, (_, i) => event(i + 1)), [event(0)], [event(1, { schema: 'wrong' })], [event(1, { text: 'x'.repeat(128001) })]]) assert.throws(() => h.service.events('runner', 'credential', h.jobInput(job, { events })));
    assert.throws(() => h.service.events('runner', 'credential', { job_id: job.id, lease_token: 'x'.repeat(43), events: [event(1)] }), { code: 'runner_job_denied' });
    assert.throws(() => h.service.events('other-runner', 'credential', h.jobInput(job, { events: [event(1)] })), { code: 'runner_denied' });
    assert.equal(h.row(job.id).last_sequence, 0);
  } finally { h.close(); }
});

test('completion is exactly-once and conflicting replays do not replace results', () => {
  const h = harness();
  try {
    h.enqueue(); const { job } = h.poll();
    const input = h.jobInput(job, { status: 'completed', text: 'Answer 👋', provider_session_id: 'native' });
    assert.deepEqual(h.service.complete('runner', 'credential', input), { received: true, replayed: false });
    assert.deepEqual(h.service.complete('runner', 'credential', input), { received: true, replayed: true });
    assert.equal(h.completions.length, 1); assert.equal(h.completions[0].text, 'Answer 👋');
    assert.throws(() => h.service.complete('runner', 'credential', { ...input, text: 'different' }), { code: 'runner_job_finished' });
  } finally { h.close(); }
});

test('agent and computer concurrency limits are independently enforced', () => {
  const h = harness({ agentLimit: 1, computerLimit: 2 });
  try {
    h.enqueue();
    assert.throws(() => h.enqueue(), { code: 'runner_agent_busy' });
    h.enqueue({}, { agentId: 'agent-2' });
    assert.throws(() => h.enqueue({}, { agentId: 'agent-3' }), { code: 'runner_computer_busy' });
    assert.ok(h.poll().job); assert.ok(h.poll().job); assert.equal(h.poll().job, null);
  } finally { h.close(); }
});

test('logical session keys remain stable within a profile/conversation but separate across identity and new-session policy', () => {
  const h = harness({ agentLimit: 8, computerLimit: 8 });
  try {
    h.enqueue(); h.enqueue();
    const a = h.poll().job, b = h.poll().job; assert.equal(a.sessionId, b.sessionId);
    h.enqueue({}, { agentId: 'agent-2' }); assert.notEqual(h.poll().job.sessionId, a.sessionId);
    h.enqueue({}, { actor: { id: 'member' } }); assert.notEqual(h.poll().job.sessionId, a.sessionId);
    h.current.session_policy = 'new-session'; h.enqueue(); h.enqueue();
    assert.notEqual(h.poll().job.sessionId, h.poll().job.sessionId);
  } finally { h.close(); }
});

test('native-capable runtimes require both local consent and reviewed project editing', () => {
  for (const runtimeId of ['copilot', 'opencode', 'pi', 'omp', 'antigravity', 'muse', 'gemini']) {
    const h = harness({ runtimeId, native: true });
    try {
      assert.throws(() => h.enqueue({ workMode: 'conversation' }), { code: 'runner_native_tools_required' });
      assert.throws(() => h.enqueue({ permissionMode: 'read-only' }), { code: 'runner_native_tools_required' });
      assert.throws(() => h.enqueue({ projectId: 'unmapped' }), { code: 'runner_project_not_mapped' });
      h.policy.native_tools_approved = false;
      assert.throws(() => h.enqueue(), { code: 'runner_native_tools_required' });
      h.policy.native_tools_approved = true; assert.ok(h.enqueue().jobId);
    } finally { h.close(); }
  }
});

test('queued cancellation never delivers; claimed cancellation discards even a successful answer', () => {
  const h = harness();
  try {
    const queued = h.enqueue(); queued.stop(); assert.equal(h.poll().job, null); assert.equal(h.completions[0].status, 'stopped');
    const active = h.enqueue(); const { job } = h.poll(); active.stop();
    assert.deepEqual(h.poll([job.id]).cancel_job_ids, [job.id]);
    h.service.complete('runner', 'credential', h.jobInput(job, { status: 'completed', text: 'Late answer' }));
    assert.equal(h.completions[1].status, 'stopped'); assert.equal(h.completions[1].text, '');
  } finally { h.close(); }
});

for (const revocation of ['revokeSource', 'revokeUsage']) test(`${revocation} stops pending requests and hides late output`, () => {
  const h = harness();
  try {
    h.enqueue(); const { job } = h.poll(); h[revocation]();
    const result = h.service.complete('runner', 'credential', h.jobInput(job, { status: 'completed', text: 'Private late output' }));
    assert.equal(result.discarded, true); assert.equal(h.completions[0].status, 'stopped'); assert.equal(h.completions[0].text, '');
  } finally { h.close(); }
});

test('binding changes stop queued work before a claim', () => {
  const h = harness();
  try { h.enqueue(); h.current.version++; assert.equal(h.poll().job, null); assert.equal(h.completions[0].status, 'stopped'); }
  finally { h.close(); }
});

test('revoked helper credentials and unconfirmed computers never receive jobs', () => {
  const h = harness();
  try {
    h.enqueue(); h.unapprove(); assert.throws(() => h.poll(), { code: 'runner_approval_required' });
    h.revokeCredential(); assert.throws(() => h.poll(), { code: 'runner_denied' });
  } finally { h.close(); }
});

test('deadline sweep distinguishes undelivered work from uncertain claims and never retries', () => {
  for (const claimed of [false, true]) {
    const h = harness();
    try {
      const queued = h.enqueue(); if (claimed) h.poll(); h.advance(1001); h.service.sweep();
      assert.equal(h.row(queued.jobId).state, claimed ? 'interrupted' : 'failed'); assert.equal(h.poll().job, null); assert.equal(h.completions.length, 1);
    } finally { h.close(); }
  }
});

test('server restart marks all pending receipts interrupted instead of redelivering', () => {
  const h = harness();
  try {
    const queued = h.enqueue(); h.poll(); installRunnerJobs(h.db);
    assert.equal(h.row(queued.jobId).state, 'interrupted'); assert.equal(h.row(queued.jobId).error_code, 'server_interrupted'); assert.equal(h.poll().job, null);
  } finally { h.close(); }
});

test('completion after a deadline cannot win without another polling/sweep request', () => {
  const h = harness();
  try {
    h.enqueue(); const { job } = h.poll(); h.advance(1001);
    try { h.service.complete('runner', 'credential', h.jobInput(job, { status: 'completed', text: 'Too late' })); } catch {}
    assert.notEqual(h.row(job.id).state, 'completed'); assert.ok(h.completions.every(result => result.status !== 'completed'));
  } finally { h.close(); }
});

test('canonical ids and rendering are server-owned, not helper-supplied', () => {
  const h = harness();
  try {
    h.enqueue(); const { job } = h.poll();
    h.service.events('runner', 'credential', h.jobInput(job, { events: [event(1)] }));
    const canonical = h.events.find(item => item.payload?.runner_event).payload.runner_event;
    assert.equal(canonical.id, `${job.id}:1`); assert.equal(canonical.renderer, 'escaped-text');
  } finally { h.close(); }
});

test('large canonical replies are not silently truncated to the event-text limit', () => {
  const h = harness();
  try {
    h.enqueue(); const { job } = h.poll(); const text = 'Safe answer '.repeat(4000);
    h.service.complete('runner', 'credential', h.jobInput(job, { status: 'completed', text }));
    assert.equal(h.completions[0].text, text);
  } finally { h.close(); }
});

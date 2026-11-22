import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from './fixtures/legacy-account-api.mjs';

// These tests use actual cookie identities, governance grants, context compilation,
// HTTP helper transport and canonical run callbacks. Only the paired computer's
// provider result is synthetic; no vendor process/account/network is permitted.
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-runner-sharing-api-'));
  const forbidden = () => { throw new Error('External accounts and host processes are forbidden in runner sharing tests.'); };
  const api = createLocalApi({ dataDir: directory, seedMode: 'clean', scheduledWorkOptions: { scheduleIntervalMs: 3_600_000 },
    integrationOptions: { env: {}, fetchImpl: forbidden, execute: forbidden, spawnProcess: forbidden } });
  const db = new DatabaseSync(api.dbPath);
  const server = createServer(api.middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); db.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, body, { method = body === undefined ? 'GET' : 'POST', cookie, token } = {}) => {
    const response = await fetch(origin + '/api' + path, { method,
      headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const good = async (...args) => {
    const response = await request(...args);
    assert.ok(response.status >= 200 && response.status < 300, `${args[0]}: ${JSON.stringify(response)}`);
    return response;
  };
  const workspace = (await good('/workspaces', { name: 'Runner security fixture' })).body.workspace;
  const supervisor = await good('/identity/setup', { name: 'Supervisor', email: 'supervisor@example.test', password: 'supervisor fixture password 123' });
  const admin = (path, body, method) => good(path, body, { cookie: supervisor.cookie, ...(method ? { method } : {}) });
  const addAccount = async (name, rank) => {
    const member = (await admin('/governance', { workspace_id: workspace.id, action: 'create_member', name, rank, email: `${name.toLowerCase()}@example.test` })).body.result;
    const invitation = (await admin('/identity/invite', { workspace_id: workspace.id, member_id: member.id })).body.result;
    const accepted = await good('/identity/accept', { token: invitation.invitation_token, password: `${name} fixture password 123` });
    assert.ok(accepted.cookie);
    return { ...member, cookie: accepted.cookie };
  };
  // The computer owner is deliberately not the workspace Owner: real governance
  // must be able to revoke its authority independently of the requester's.
  const computerOwner = await addAccount('Computerowner', 'Manager');
  const requester = await addAccount('Requester', 'Member');
  const outsider = await addAccount('Outsider', 'Member');
  const ownerCall = (path, body, method) => good(path, body, { cookie: computerOwner.cookie, ...(method ? { method } : {}) });
  const agent = (await ownerCall('/agents', { workspace_id: workspace.id, name: 'Shared computer profile', provider: 'codex', provider_connection_id: null, memory_policy: 'none' })).body.agent;
  const chat = (await admin('/chats', { workspace_id: workspace.id, title: 'Shared computer conversation', participant_agent_ids: [agent.id] })).body.chat;
  const originalProject = (await admin('/projects', { workspace_id: workspace.id, name: 'Original document scope' })).body.project;
  const currentProject = (await admin('/projects', { workspace_id: workspace.id, name: 'Current document scope' })).body.project;
  const document = (await admin('/documents', { workspace_id: workspace.id, project_id: originalProject.id, title: 'Reviewed evidence', content: 'EXACT_REVIEWED_SHARED_SOURCE' })).body.document;
  const pack = (await admin('/workspace-items', { workspace_id: workspace.id, kind: 'context_pack', name: 'Reviewed sources', payload: { description: '', content: '', document_ids: [document.id], memory_ids: [] } })).body.result;
  const pairing = (await ownerCall('/runner-connections/pairing', { workspace_id: workspace.id, name: 'Shared fixture computer' })).body.result.pairing;
  const claim = (await good('/runner-transport/claim', { code: pairing.code, platform: 'linux', architecture: 'x64' })).body.result;
  await ownerCall(`/runner-connections/${claim.runner_id}/confirm`, { workspace_id: workspace.id });
  const transport = (operation, input) => request(`/runner-transport/${claim.runner_id}/${operation}`, input, { token: claim.credential });
  const policy = { enabled: true, provider_ids: ['codex'], project_ids: [], max_concurrent_sessions: 4, allow_workspace_members: true, native_tools_approved: false, package_execution_approved: false };
  const heartbeat = async patch => {
    Object.assign(policy, patch);
    const response = await transport('heartbeat', { runtimes: [{ id: 'codex', state: 'installed' }], execution_policy: policy });
    assert.equal(response.status, 200, JSON.stringify(response));
  };
  await heartbeat({});
  let settingsVersion = 0;
  const settings = async patch => {
    const response = await ownerCall(`/agent-runner-settings/${agent.id}`, { workspace_id: workspace.id, version: settingsVersion, ...patch }, 'PUT');
    settingsVersion = response.body.result.version;
    return response.body.result;
  };
  await settings({ connection_method: 'computer', runner_id: claim.runner_id, runtime_id: 'codex', enabled: true, usage_scope: 'members', usage_member_ids: [requester.id], max_concurrent_sessions: 4 });
  const input = { workspace_id: workspace.id, chat_id: chat.id, agent_id: agent.id, prompt: 'Use the exact reviewed shared source.', work_mode: 'conversation', permission_mode: 'read-only', include_workspace: false, include_memory: false, include_chat: false, context_pack_ids: [pack.id] };
  const launch = async (actor = requester) => {
    const preview = await request('/context/inspect', input, { cookie: actor.cookie });
    if (preview.status !== 201) return preview;
    return request('/runs', { ...input, mode: 'live', context_inspection_id: preview.body.result.id }, { cookie: actor.cookie });
  };
  const poll = (active = []) => transport('poll', { active_job_ids: active });
  const complete = (job, text = 'CANONICAL_SHARED_COMPUTER_REPLY') => transport('complete', { job_id: job.id, lease_token: job.leaseToken, status: 'completed', text });
  const deny = (actor, permission, scope = {}) => admin('/governance', { workspace_id: workspace.id, action: 'grant', member_id: actor.id, permission, effect: 'deny', reason: 'Security regression fixture revocation', ...scope });
  const agentReplies = () => db.prepare("SELECT * FROM messages WHERE chat_id=? AND sender_type='agent'").all(chat.id);
  return { api, db, request, good, admin, workspace, computerOwner, requester, outsider, agent, chat, originalProject, currentProject, document, pack, claim, heartbeat, settings, launch, poll, complete, deny, agentReplies };
}

test('a genuinely authenticated selected member receives one canonical result through the owner computer, never host fallback', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(`/runner-connections?workspace_id=${f.workspace.id}`, undefined, { cookie: f.requester.cookie })).body.result.runners.length, 0, 'Sharing invocation must not expose or transfer computer ownership');
  const started = await f.launch(); assert.equal(started.status, 201, JSON.stringify(started));
  const polled = await f.poll(); assert.equal(polled.status, 200, JSON.stringify(polled)); const job = polled.body.result.job;
  assert.equal(job.actorId, f.requester.id); assert.equal(job.providerId, 'codex'); assert.match(job.prompt, /EXACT_REVIEWED_SHARED_SOURCE/);
  assert.equal((await f.poll()).body.result.job, null);
  assert.equal(f.db.prepare('SELECT owner_actor_id FROM personal_runner_jobs WHERE id=?').get(job.id).owner_actor_id, f.computerOwner.id);
  assert.equal((await f.complete(job)).status, 200);
  assert.equal((await f.complete(job)).body.result.replayed, true);
  assert.equal(f.db.prepare('SELECT status FROM runs WHERE id=?').get(started.body.run.id).status, 'completed');
  assert.equal(f.agentReplies().length, 1); assert.equal(f.agentReplies()[0].content, 'CANONICAL_SHARED_COMPUTER_REPLY');
});

test('profile audiences and local computer sharing consent are independent gates', async t => {
  const f = await fixture(t);
  const denied = async actor => { const before = f.db.prepare('SELECT count(*) n FROM runs').get().n; const result = await f.launch(actor); assert.equal(result.status, 403, JSON.stringify(result)); assert.equal(f.db.prepare('SELECT count(*) n FROM runs').get().n, before); };
  await denied(f.outsider);
  await f.settings({ usage_scope: 'private' }); await denied(f.requester);
  await f.settings({ usage_scope: 'workspace' });
  const shared = await f.launch(f.outsider); assert.equal(shared.status, 201, JSON.stringify(shared));
  const job = (await f.poll()).body.result.job; assert.equal(job.actorId, f.outsider.id); await f.complete(job);
  await f.heartbeat({ allow_workspace_members: false });
  await denied(f.requester); await denied(f.outsider);
  const owned = await f.launch(f.computerOwner); assert.equal(owned.status, 201, JSON.stringify(owned));
  const ownJob = (await f.poll()).body.result.job; assert.equal(ownJob.actorId, f.computerOwner.id); await f.complete(ownJob);
});

test('a shared member cannot rebind, widen or enable the computer owner profile', async t => {
  const f = await fixture(t);
  const response = await f.request(`/agent-runner-settings/${f.agent.id}`, { workspace_id: f.workspace.id, version: 1, usage_scope: 'workspace' }, { method: 'PUT', cookie: f.requester.cookie });
  assert.equal(response.status, 403, JSON.stringify(response));
  const saved = f.db.prepare('SELECT owner_actor_id,usage_scope,version FROM agent_runner_settings WHERE agent_id=?').get(f.agent.id);
  assert.equal(saved.owner_actor_id, f.computerOwner.id); assert.equal(saved.usage_scope, 'members'); assert.equal(saved.version, 1);
});

function assertDiscarded(response) {
  // The real five-second sweep may stop the receipt before completion arrives.
  // Both outcomes must refuse its text, and canonical storage is checked below.
  assert.ok([200, 409].includes(response.status), JSON.stringify(response));
  if (response.status === 200) assert.equal(response.body.result.discarded, true);
  else assert.equal(response.body.error.code, 'runner_job_finished');
}

for (const whose of ['requester', 'computerOwner']) for (const permission of ['agents.read', 'agents.run', 'agents.use', 'connections.use']) for (const claimed of [false, true]) {
  test(`${whose} ${permission} revocation independently blocks ${claimed ? 'claimed' : 'queued'} shared invocation`, async t => {
    const f = await fixture(t), started = await f.launch(); assert.equal(started.status, 201, JSON.stringify(started));
    const job = claimed ? (await f.poll()).body.result.job : null;
    const scope = permission.startsWith('agents.') ? { scope_type: 'agent', scope_id: f.agent.id } : {};
    await f.deny(f[whose], permission, scope);
    const response = claimed ? await f.complete(job, 'AUTHORITY_REVOKED_REPLY_MUST_NOT_BE_SAVED') : await f.poll();
    // A computer owner's connections.use revocation invalidates the helper's
    // authentication itself; all other revocations sweep out the pending job.
    if (whose === 'computerOwner' && permission === 'connections.use') assert.equal(response.status, 403, JSON.stringify(response));
    else if (claimed) assertDiscarded(response);
    else { assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.body.result.job, null); }
    const row = f.db.prepare('SELECT state FROM personal_runner_jobs WHERE run_id=?').get(started.body.run.id);
    if (response.status !== 403) assert.equal(row.state, 'stopped');
    assert.equal(f.agentReplies().length, 0);
    const again = await f.launch(); assert.equal(again.status, 403, JSON.stringify(again));
    assert.equal(f.db.prepare('SELECT count(*) n FROM personal_runner_jobs').get().n, 1, 'Revocation must not trigger fallback or a second inference');
  });
}

for (const whose of ['requester', 'computerOwner']) for (const historical of [false, true]) for (const claimed of [false, true]) {
  test(`${whose} ${historical ? 'historical' : 'current'} source ACL revocation blocks ${claimed ? 'late completion' : 'initial helper claim'}`, async t => {
    const f = await fixture(t), started = await f.launch(); assert.equal(started.status, 201, JSON.stringify(started));
    const job = claimed ? (await f.poll()).body.result.job : null;
    if (job) assert.match(job.prompt, /EXACT_REVIEWED_SHARED_SOURCE/);
    // Move after capture. Historical revocation denies only the original scope;
    // current revocation denies only the new scope, independently of the capture.
    await f.admin(`/documents/${f.document.id}`, { project_id: f.currentProject.id }, 'PATCH');
    const deniedScope = historical ? f.originalProject.id : f.currentProject.id;
    await f.deny(f[whose], 'documents.read', { scope_type: 'project', scope_id: deniedScope });
    const current = await f.request(`/documents/${f.document.id}`, undefined, { cookie: f[whose].cookie });
    assert.equal(current.status, historical ? 200 : 403, JSON.stringify(current));
    const other = whose === 'requester' ? f.computerOwner : f.requester;
    assert.equal((await f.request(`/documents/${f.document.id}`, undefined, { cookie: other.cookie })).status, 200, 'The other actor must retain independent document access');
    const context = await f.request(`/runs/${started.body.run.id}/context`, undefined, { cookie: f[whose].cookie });
    assert.equal(context.status, 403, JSON.stringify(context)); assert.doesNotMatch(JSON.stringify(context.body), /EXACT_REVIEWED_SHARED_SOURCE/);
    if (claimed) {
      const result = await f.complete(job, 'REVOKED_SOURCE_REPLY_MUST_NOT_BE_SAVED');
      assertDiscarded(result);
    } else {
      const result = await f.poll(); assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.body.result.job, null);
    }
    assert.equal(f.db.prepare('SELECT state FROM personal_runner_jobs WHERE run_id=?').get(started.body.run.id).state, 'stopped');
    assert.equal(f.db.prepare('SELECT status FROM runs WHERE id=?').get(started.body.run.id).status, 'stopped');
    assert.equal(f.agentReplies().length, 0);
    assert.equal((await f.poll()).body.result.job, null, 'Revoked work must never be re-claimed or retried');
  });
}

for (const mode of ['computer-sharing', 'profile-audience']) test(`${mode} revocation cancels a claimed shared invocation and discards its answer`, async t => {
  const f = await fixture(t), started = await f.launch(); assert.equal(started.status, 201, JSON.stringify(started));
  const job = (await f.poll()).body.result.job;
  if (mode === 'computer-sharing') await f.heartbeat({ allow_workspace_members: false });
  else await f.settings({ usage_scope: 'private' });
  const response = await f.complete(job, 'REVOKED_SHARED_REPLY');
  assertDiscarded(response);
  assert.equal(f.agentReplies().length, 0);
  assert.equal(f.db.prepare('SELECT state FROM personal_runner_jobs WHERE id=?').get(job.id).state, 'stopped');
  assert.equal((await f.poll()).body.result.job, null);
});

test('a readable source move and safe edit preserve the exact reviewed shared prompt and permit completion', async t => {
  const f = await fixture(t), started = await f.launch(); assert.equal(started.status, 201, JSON.stringify(started));
  const job = (await f.poll()).body.result.job;
  assert.match(job.prompt, /EXACT_REVIEWED_SHARED_SOURCE/);
  await f.admin(`/documents/${f.document.id}`, { project_id: f.currentProject.id, content: 'NEW_CURRENT_TEXT_NOT_IN_REVIEWED_PROMPT' }, 'PATCH');
  for (const actor of [f.requester, f.computerOwner]) {
    const context = await f.request(`/runs/${started.body.run.id}/context`, undefined, { cookie: actor.cookie });
    assert.equal(context.status, 200, JSON.stringify(context));
    assert.match(JSON.stringify(context.body), /EXACT_REVIEWED_SHARED_SOURCE/);
    assert.doesNotMatch(JSON.stringify(context.body), /NEW_CURRENT_TEXT_NOT_IN_REVIEWED_PROMPT/);
  }
  assert.equal((await f.complete(job)).status, 200);
  assert.equal(f.agentReplies().length, 1);
  assert.equal(f.db.prepare('SELECT status FROM runs WHERE id=?').get(started.body.run.id).status, 'completed');
});

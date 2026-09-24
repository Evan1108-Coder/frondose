import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createLocalApi } from '../server/local-api.mjs';
import { createGovernanceService } from '../server/governance-service.mjs';
import { captureAgentActions } from '../server/agent-awareness.mjs';

async function fixture(run) {
  const dataDir = await mkdtemp(join(tmpdir(), 'rumbo-platform-api-')), providerCalls = [];
  const api = createLocalApi({ dataDir, integrationOptions: {
    env: { RUMBO_GITHUB_CLIENT_ID: 'fixture-client', RUMBO_GITHUB_CLIENT_SECRET: 'fixture-secret' },
    execute: async (_command, args) => ({ stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '', code: 0 }),
    spawnProcess: () => { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.kill = () => {}; child.stdin.end = () => queueMicrotask(() => { child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Fixture reply.' } }) + '\n')); child.emit('close', 0); }); return child; },
    fetchImpl: async (url, options) => { providerCalls.push({ url: String(url), options }); if (String(url).includes('/oauth/')) return Response.json({ access_token: 'fixture-access-token' }); if (String(url).includes('/issues') && options.method === 'POST') return Response.json({ id: 42, title: 'Agent issue' }); if (String(url).includes('/issues')) return Response.json([{ id: 1, title: 'Cached issue', body: 'Source content' }]); if (String(url).includes('/dispatches')) return new Response(null, { status: 204 }); return Response.json([]); },
  } });
  const server = createServer((req, res) => api.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', body) => { const response = await fetch(base + path, { method, redirect: 'manual', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const raw = await response.text(); return { status: response.status, body: raw ? JSON.parse(raw) : null }; };
  const ok = async (...args) => { const response = await request(...args); assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response)); return response.body; };
  const workspace = (await ok('/api/workspaces', 'POST', { name: 'Platform security fixture' })).workspace;
  await ok(`/api/governance?workspace_id=${workspace.id}`);
  const db = new DatabaseSync(api.dbPath), governance = createGovernanceService({ db });
  const project = (await ok('/api/projects', 'POST', { workspace_id: workspace.id, name: 'Fixture', identifier: 'TEST' })).project;
  const agentId = 'fixture-agent'; db.prepare('INSERT INTO agents(id,workspace_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(agentId, workspace.id, 'Fixture agent', 'now', 'now');
  const secondOwner = () => { const member = governance.command(workspace.id, 'local-owner', 'create_member', { name: 'Second owner' }); const approval = governance.command(workspace.id, 'local-owner', 'request_owner', { member_id: member.id }); governance.command(workspace.id, 'local-owner', 'decide_approval', { approval_id: approval.id, decision: 'approve' }); return member.id; };
  async function connect(provider = 'github') {
    const connection = (await ok('/api/connection-platform/connections', 'POST', { workspace_id: workspace.id, provider })).result;
    const flow = (await ok(`/api/connection-platform/connections/${connection.id}/authorize`, 'POST', {})).result;
    const state = new URL(flow.authorization_url).searchParams.get('state');
    const callback = await request(`/api/connection-platform/oauth/callback?state=${state}&code=fixture-code`); assert.equal(callback.status, 303);
    await ok(`/api/connection-platform/connections/${connection.id}/settings`, 'PATCH', { selected_resources: ['acme/app'], enabled_features: ['read', provider === 'github-actions' ? 'dispatch_workflow' : 'create_issue'], agent_access: true, allowed_agent_ids: [agentId] });
    return connection;
  }
  function propose(proposal, sponsor = 'local-owner') {
    const runId = randomUUID(); db.prepare('INSERT INTO runs(id,workspace_id,project_id,provider,agent_id,agent_name,status,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(runId, workspace.id, project.id, 'codex', agentId, 'Fixture agent', 'completed', 'Fixture run', 'now', 'now');
    if (sponsor) db.prepare('INSERT INTO agent_run_sponsors VALUES(?,?)').run(runId, sponsor);
    captureAgentActions(db, runId, '```rumbo-actions\n' + JSON.stringify({ nonce: 'fixture-nonce', actions: [proposal] }) + '\n```', 'fixture-nonce');
    return db.prepare('SELECT id FROM agent_action_requests WHERE run_id=?').get(runId).id;
  }
  try { await run({ api, request, ok, db, governance, workspace, project, agentId, secondOwner, connect, propose, providerCalls, dataDir }); }
  finally { db.close(); await new Promise(resolve => server.close(resolve)); api.close(); await rm(dataDir, { recursive: true, force: true }); }
}

test('HTTP legacy delete requires another Owner and consumes an exact approval once', () => fixture(async ({ request, ok, db, governance, workspace, project, secondOwner }) => {
  const owner2 = secondOwner();
  const denied = await request(`/api/projects/${project.id}`, 'DELETE'); assert.equal(denied.status, 409); assert.ok(db.prepare('SELECT id FROM projects WHERE id=?').get(project.id));
  const approval = db.prepare("SELECT * FROM governance_approvals WHERE workspace_id=? AND kind='protected_action'").get(workspace.id); assert.ok(approval);
  const self = await request('/api/governance', 'POST', { workspace_id: workspace.id, action: 'decide_approval', approval_id: approval.id, decision: 'approve' }); assert.equal(self.status, 403);
  governance.command(workspace.id, owner2, 'decide_approval', { approval_id: approval.id, decision: 'approve' });
  await ok(`/api/projects/${project.id}`, 'DELETE'); assert.equal(db.prepare('SELECT id FROM projects WHERE id=?').get(project.id), undefined);
  assert.ok(db.prepare('SELECT * FROM governance_approval_consumptions WHERE approval_id=?').get(approval.id));
}));

test('HTTP legacy archive approval is bound to exact fields, not only the target', () => fixture(async ({ request, ok, db, governance, workspace, project, secondOwner }) => {
  const owner2 = secondOwner(), payload = { archived_at: '2026-09-19T12:00:00.000Z' };
  assert.equal((await request(`/api/projects/${project.id}`, 'PATCH', payload)).status, 409);
  const approval = db.prepare("SELECT * FROM governance_approvals WHERE kind='protected_action'").get(); governance.command(workspace.id, owner2, 'decide_approval', { approval_id: approval.id, decision: 'approve' });
  assert.equal((await request(`/api/projects/${project.id}`, 'PATCH', { ...payload, name: 'Changed after approval' })).status, 409);
  assert.equal(db.prepare('SELECT archived_at FROM projects WHERE id=?').get(project.id).archived_at, null);
  await ok(`/api/projects/${project.id}`, 'PATCH', payload); assert.equal(db.prepare('SELECT archived_at FROM projects WHERE id=?').get(project.id).archived_at, payload.archived_at);
}));

test('HTTP reviewed agent action refuses an older run without authenticated sponsor', () => fixture(async ({ request, project, propose, db }) => {
  const actionId = propose({ type: 'record.update', resource: 'projects', id: project.id, patch: { name: 'Agent changed' } }, null);
  const response = await request(`/api/agent-actions/${actionId}/decision`, 'POST', { decision: 'approve', sponsor_id: 'local-owner' });
  assert.equal(response.status, 403); assert.equal(db.prepare('SELECT name FROM projects WHERE id=?').get(project.id).name, 'Fixture');
}));

test('HTTP agent proposals recheck the original sponsor current target permission', () => fixture(async ({ request, project, propose, db, governance, workspace }) => {
  const member = governance.command(workspace.id, 'local-owner', 'create_member', { name: 'Sponsor', rank: 'Member' });
  const actionId = propose({ type: 'record.update', resource: 'projects', id: project.id, patch: { name: 'Should not apply' } }, member.id);
  governance.command(workspace.id, 'local-owner', 'grant', { member_id: member.id, permission: 'projects.write', effect: 'deny', reason: 'Access revoked after run' });
  const response = await request(`/api/agent-actions/${actionId}/decision`, 'POST', { decision: 'approve' }); assert.equal(response.status, 403);
  assert.equal(db.prepare('SELECT name FROM projects WHERE id=?').get(project.id).name, 'Fixture');
}));

test('HTTP reviewed connection proposal runs once through delegated access and preserves attribution', () => fixture(async ({ request, ok, db, connect, propose, providerCalls }) => {
  const connection = await connect();
  const actionId = propose({ type: 'connection.action', connection_id: connection.id, action: 'create_issue', input: { resource_id: 'acme/app', title: 'Agent issue' } });
  await ok(`/api/agent-actions/${actionId}/decision`, 'POST', { decision: 'approve' });
  assert.equal(db.prepare('SELECT status FROM agent_action_requests WHERE id=?').get(actionId).status, 'applied');
  assert.equal(providerCalls.filter(x => x.url.endsWith('/issues')).length, 1);
  const replay = await request(`/api/agent-actions/${actionId}/decision`, 'POST', { decision: 'approve' }); assert.equal(replay.status, 400);
  assert.equal(providerCalls.filter(x => x.url.endsWith('/issues')).length, 1);
  const event = db.prepare("SELECT * FROM platform_connection_events WHERE connection_id=? AND type='action_started'").get(connection.id); assert.equal(event.actor_id, 'local-owner'); assert.equal(JSON.parse(event.detail).agent_id, 'fixture-agent');
}));

test('HTTP external consequential action waits for exact governance approval before provider request', () => fixture(async ({ ok, db, governance, workspace, connect, providerCalls }) => {
  const connection = await connect('github-actions'), body = { action: 'dispatch_workflow', input: { resource_id: 'acme/app', workflow_id: 'build.yml', ref: 'main' }, idempotency_key: 'dispatch-fixture' };
  const pending = (await ok(`/api/connection-platform/connections/${connection.id}/actions`, 'POST', body)).result;
  assert.equal(pending.approval_required, true); assert.equal(providerCalls.filter(x => x.url.includes('/dispatches')).length, 0);
  governance.command(workspace.id, 'local-owner', 'decide_approval', { approval_id: pending.approval.id, decision: 'approve' });
  await ok(`/api/connection-platform/connections/${connection.id}/actions`, 'POST', body); await ok(`/api/connection-platform/connections/${connection.id}/actions`, 'POST', body);
  assert.equal(providerCalls.filter(x => x.url.includes('/dispatches')).length, 1);
  assert.ok(db.prepare('SELECT * FROM governance_approval_consumptions WHERE approval_id=?').get(pending.approval.id));
}));

test('HTTP live run records server-resolved sponsor rather than a submitted identity', () => fixture(async ({ ok, db, workspace, project, agentId, dataDir }) => {
  await ok(`/api/projects/${project.id}`, 'PATCH', { local_path: dataDir });
  await ok(`/api/agents/${agentId}`, 'PATCH', { provider: 'codex', provider_connection_id: 'conn_codex' });
  await ok('/api/connections/codex/connect', 'POST', { method: 'existing' });
  const result = await ok('/api/runs', 'POST', { workspace_id: workspace.id, project_id: project.id, agent_id: agentId, mode: 'live', prompt: 'Reply to isolated fixture.', permissionMode: 'read-only', actor_id: 'spoofed', sponsor_id: 'spoofed' });
  assert.equal(db.prepare('SELECT actor_id FROM agent_run_sponsors WHERE run_id=?').get(result.run.id).actor_id, 'local-owner');
}));

test('HTTP connection proposal fails if its delegation changes before human review', () => fixture(async ({ request, ok, connect, propose, providerCalls }) => {
  const connection = await connect();
  const actionId = propose({ type: 'connection.action', connection_id: connection.id, action: 'create_issue', input: { resource_id: 'acme/app', title: 'Disallowed after revoke' } });
  await ok(`/api/connection-platform/connections/${connection.id}/settings`, 'PATCH', { agent_access: false });
  const response = await request(`/api/agent-actions/${actionId}/decision`, 'POST', { decision: 'approve' }); assert.equal(response.status, 400);
  assert.equal(providerCalls.filter(x => x.url.endsWith('/issues')).length, 0);
}));

test('HTTP repeated archive after restore creates a fresh approval rather than reusing a consumed one', () => fixture(async ({ request, ok, db, governance, workspace, project, secondOwner }) => {
  const owner2 = secondOwner(), payload = { archived_at: '2026-09-19T12:00:00.000Z' };
  assert.equal((await request(`/api/projects/${project.id}`, 'PATCH', payload)).status, 409);
  const first = db.prepare("SELECT * FROM governance_approvals WHERE kind='protected_action'").get(); governance.command(workspace.id, owner2, 'decide_approval', { approval_id: first.id, decision: 'approve' });
  await ok(`/api/projects/${project.id}`, 'PATCH', payload); await ok(`/api/projects/${project.id}`, 'PATCH', { archived_at: null });
  assert.equal((await request(`/api/projects/${project.id}`, 'PATCH', payload)).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM governance_approvals WHERE kind='protected_action'").get().n, 2);
}));

test('HTTP output archive uses protected destructive approval despite its boolean API field', () => fixture(async ({ request, ok, db, workspace, project, secondOwner }) => {
  secondOwner();
  const created = await ok('/api/workflow/outputs', 'POST', { workspace_id: workspace.id, project_id: project.id, title: 'Review output', content: 'Content', kind: 'document' });
  const output = created.result;
  const response = await request(`/api/workflow/outputs/${output.id}`, 'PATCH', { version: output.version, archived: true });
  assert.equal(response.status, 409); assert.equal(db.prepare('SELECT archived_at FROM outputs WHERE id=?').get(output.id).archived_at, null);
}));

test('HTTP connection cache purge preserves credentials and imports until approval, then keeps native work', () => fixture(async ({ ok, db, governance, workspace, project, connect }) => {
  const connection = await connect(), base = `/api/connection-platform/connections/${connection.id}`;
  await ok(`${base}/sync`, 'POST', { resource_id: 'acme/app' });
  const [object] = (await ok(`${base}/objects`)).result;
  const imported = (await ok(`${base}/import`, 'POST', { object_id: object.id, target_type: 'route', project_id: project.id })).result;
  const body = { delete_cache: true, idempotency_key: 'cache-purge-fixture' };
  const pending = (await ok(`${base}/disconnect`, 'POST', body)).result;
  assert.equal(pending.approval_required, true); assert.ok(db.prepare('SELECT * FROM platform_connection_secrets WHERE connection_id=?').get(connection.id)); assert.ok(db.prepare('SELECT * FROM platform_object_links WHERE object_id=?').get(object.id));
  governance.command(workspace.id, 'local-owner', 'decide_approval', { approval_id: pending.approval.id, decision: 'approve' });
  assert.equal((await ok(`${base}/disconnect`, 'POST', body)).result.state, 'not_connected');
  assert.equal(db.prepare('SELECT * FROM platform_connection_secrets WHERE connection_id=?').get(connection.id), undefined); assert.equal(db.prepare('SELECT * FROM platform_object_links WHERE object_id=?').get(object.id), undefined);
  assert.ok(db.prepare('SELECT * FROM tasks WHERE id=?').get(imported.target_id));
  await ok(`${base}/disconnect`, 'POST', body);
}));

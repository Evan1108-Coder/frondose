import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from '../server/local-api.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-usage-security-'));
  let ownerCookie, externalCalls = 0;
  const commands = [], launches = [], scenario = { exitCode: 0 };
  const usage = { input_tokens: 11, cached_input_tokens: 3, output_tokens: 5, reasoning_output_tokens: 2 };
  const api = createLocalApi({ dataDir: directory, seedMode: 'clean', integrationOptions: {
    env: {}, fetchImpl() { externalCalls++; throw new Error('External network forbidden in usage security tests'); },
    async execute(command, args) { commands.push({ command, args }); return { code: 0, stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '' }; },
    spawnProcess(command, args) {
      launches.push({ command, args });
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.kill = () => queueMicrotask(() => child.emit('close', 1));
      child.stdin.end = () => queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Injected usage result, no real provider.' } }) + '\n'));
        child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'turn.completed', usage: { ...usage } }) + '\n'));
        child.emit('close', scenario.exitCode);
      });
      return child;
    },
  } });
  const db = new DatabaseSync(api.dbPath); db.exec('PRAGMA foreign_keys=ON');
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); db.close(); await rm(directory, { recursive: true, force: true }); assert.equal(externalCalls, 0); });
  const request = async (method, path, body, cookie = ownerCookie) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const call = async (method, path, body, cookie) => { const result = await request(method, path, body, cookie); assert(result.status >= 200 && result.status < 300, `${method} ${path}: ${result.status} ${JSON.stringify(result.body).slice(0, 1000)}`); return result.body; };
  const workspace = (await call('POST', '/workspaces', { name: 'Usage security workspace' })).workspace;
  const area = (await call('POST', '/teams', { workspace_id: workspace.id, name: 'Original Area' })).team;
  const project = (await call('POST', '/projects', { workspace_id: workspace.id, team_id: area.id, name: 'Original project' })).project;
  const agent = (await call('POST', '/agents', { workspace_id: workspace.id, provider: 'codex', name: 'Usage security profile', memory_policy: 'none' })).agent;
  await call('POST', '/connections/codex/connect', { method: 'existing' });
  const launch = async (extra = {}) => (await call('POST', '/runs', { workspace_id: workspace.id, project_id: project.id, agent_id: agent.id, mode: 'live', work_mode: 'conversation', prompt: 'Use only injected fixture results.', ...extra })).run;
  const report = async (cookie, query = '') => (await call('GET', `/usage?workspace_id=${workspace.id}${query.includes('group_by=') ? '' : '&group_by=agent'}${query}`, undefined, cookie)).result;
  const authenticate = async () => {
    const member = (await call('POST', '/governance', { workspace_id: workspace.id, action: 'create_member', name: 'Usage reader', email: 'usage-reader@example.com' })).result;
    const owner = await request('POST', '/identity/setup', { name: 'Owner', email: 'usage-owner@example.com', password: 'isolated owner password 123' }); assert.equal(owner.status, 200); ownerCookie = owner.cookie;
    const invitation = await call('POST', '/identity/invite', { workspace_id: workspace.id, member_id: member.id });
    const accepted = await request('POST', '/identity/accept', { token: invitation.result.invitation_token, password: 'isolated reader password 123' }); assert.equal(accepted.status, 200);
    const deny = (permission, scope_type, scope_id) => call('POST', '/governance', { workspace_id: workspace.id, action: 'grant', member_id: member.id, permission, effect: 'deny', scope_type, scope_id, reason: 'Isolated usage revocation' });
    return { cookie: accepted.cookie, member, deny };
  };
  return { api, db, workspace, area, project, agent, usage, scenario, commands, launches, call, request, launch, report, authenticate };
}

test('usage security: real HTTP permission filtering occurs before totals and coverage, and reads launch nothing', async t => {
  const f = await fixture(t), hidden = await f.launch();
  const publicProject = (await f.call('POST', '/projects', { workspace_id: f.workspace.id, name: 'Allowed project' })).project;
  const visible = await f.launch({ project_id: publicProject.id });
  const member = await f.authenticate(); await member.deny('agents.read', 'project', f.project.id);
  const persisted = () => ['runs', 'run_events', 'run_usage_invocations', 'run_usage_reports', 'run_context_snapshots'].map(table => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const before = { commands: f.commands.length, launches: f.launches.length, persisted: persisted() };
  const report = await f.report(member.cookie, '&group_by=project');
  assert.equal(report.totals.eligible_run_count, 1);
  assert(!JSON.stringify(report).includes(hidden.id)); assert(!JSON.stringify(report).includes(f.project.id));
  assert.equal((await f.request('GET', `/runs/${hidden.id}/usage`, undefined, member.cookie)).status, 403);
  assert.equal((await f.request('GET', `/runs/${visible.id}/usage`, undefined, member.cookie)).status, 200);
  assert.equal(f.commands.length, before.commands); assert.equal(f.launches.length, before.launches);
  // Authentication may update last_seen_at; execution/usage content must not mutate.
  assert.deepEqual(persisted(), before.persisted);
});

test('usage security: moved runs retain original project and Area restrictions', async t => {
  const f = await fixture(t), run = await f.launch();
  const publicArea = (await f.call('POST', '/teams', { workspace_id: f.workspace.id, name: 'Public Area' })).team;
  const publicProject = (await f.call('POST', '/projects', { workspace_id: f.workspace.id, team_id: publicArea.id, name: 'Public project' })).project;
  // Fixture-only move checks the persisted launch boundary, not a provider action.
  f.db.prepare('UPDATE runs SET project_id=? WHERE id=?').run(publicProject.id, run.id);
  f.db.prepare('UPDATE projects SET team_id=? WHERE id=?').run(publicArea.id, f.project.id);
  const member = await f.authenticate(); await member.deny('agents.read', 'team', f.area.id);
  assert.equal((await f.request('GET', `/runs/${run.id}/usage`, undefined, member.cookie)).status, 403);
  assert.equal((await f.report(member.cookie)).totals.eligible_run_count, 0);
});

test('usage security: canonical run-context revocation removes metrics and coverage without revealing source metadata', async t => {
  const f = await fixture(t);
  const privateProject = (await f.call('POST', '/projects', { workspace_id: f.workspace.id, name: 'Private source project' })).project;
  const document = (await f.call('POST', '/documents', { workspace_id: f.workspace.id, project_id: privateProject.id, title: 'PRIVATE_USAGE_SOURCE', content: 'Private context' })).document;
  const pack = (await f.call('POST', '/workspace-items', { workspace_id: f.workspace.id, kind: 'context_pack', name: 'Private usage pack', payload: { content: '', document_ids: [document.id], memory_ids: [] } })).result;
  const run = await f.launch({ context_pack_ids: [pack.id] });
  const member = await f.authenticate();
  assert.equal((await f.report(member.cookie)).totals.eligible_run_count, 1);
  await member.deny('documents.read', 'project', privateProject.id);
  const denied = await f.request('GET', `/runs/${run.id}/usage`, undefined, member.cookie);
  assert.equal(denied.status, 403); assert(!JSON.stringify(denied.body).includes('PRIVATE_USAGE_SOURCE'));
  const report = await f.report(member.cookie); assert.equal(report.totals.eligible_run_count, 0); assert(!JSON.stringify(report).includes(run.id));
});

test('usage security: cross-workspace and revoked agent access cannot expose usage group identities', async t => {
  const f = await fixture(t), run = await f.launch();
  const other = (await f.call('POST', '/workspaces', { name: 'Foreign usage workspace' })).workspace;
  const member = await f.authenticate(); await member.deny('agents.read', 'agent', f.agent.id);
  assert.equal((await f.request('GET', `/runs/${run.id}/usage`, undefined, member.cookie)).status, 403);
  const report = await f.report(member.cookie, '&group_by=agent'); assert.equal(report.totals.eligible_run_count, 0); assert(!JSON.stringify(report).includes(f.agent.id));
  assert.equal((await f.request('GET', `/usage?workspace_id=${other.id}&group_by=agent`, undefined, member.cookie)).status, 403);
});

test('usage security: simulations and imported archives never create provider metering authority', async t => {
  const f = await fixture(t); await f.launch({ mode: 'mock' });
  assert.equal((await f.report()).totals.eligible_run_count, 0);
  await f.launch(); const archive = await f.call('GET', `/export?workspace_id=${f.workspace.id}`);
  assert(!Object.keys(archive.data).some(key => /usage/i.test(key)), 'Execution usage authority must not be exported as portable content');
  const imported = (await f.call('POST', '/import', archive)).result;
  const report = (await f.call('GET', `/usage?workspace_id=${imported.id}&group_by=agent`)).result;
  assert.equal(report.totals.eligible_run_count, 0);
});

test('usage security: grouping and filtering retain the launch project after a canonical run moves', async t => {
  const f = await fixture(t), run = await f.launch();
  const other = (await f.call('POST', '/projects', { workspace_id: f.workspace.id, name: 'Later project' })).project;
  f.db.prepare('UPDATE runs SET project_id=? WHERE id=?').run(other.id, run.id);
  const aggregate = await f.report(undefined, '&group_by=project');
  assert.equal(aggregate.groups.length, 1); assert.equal(aggregate.groups[0].key, f.project.id);
  assert.equal((await f.report(undefined, `&project_id=${f.project.id}`)).totals.eligible_run_count, 1);
  assert.equal((await f.report(undefined, `&project_id=${other.id}`)).totals.eligible_run_count, 0);
});

test('usage security: missing captured context fails closed instead of retaining metrics', async t => {
  const f = await fixture(t), run = await f.launch();
  assert.equal((await f.request('GET', `/runs/${run.id}/usage`)).status, 200);
  f.db.prepare('DELETE FROM run_context_snapshots WHERE run_id=?').run(run.id);
  const response = await f.request('GET', `/runs/${run.id}/usage`);
  assert.equal(response.status, 403);
  assert.equal((await f.report()).totals.eligible_run_count, 0);
});

test('usage security: malformed fields stay unknown while explicit zero remains a recorded observation', async t => {
  const f = await fixture(t);
  Object.assign(f.usage, { input_tokens: '0', cached_input_tokens: -1, output_tokens: 0, reasoning_output_tokens: 1.5 });
  const run = await f.launch();
  const detail = (await f.call('GET', `/runs/${run.id}/usage`)).result;
  const metric = detail.families.find(item => item.id === 'codex.main').metrics;
  assert.deepEqual(metric.input_tokens, { value: null, known: false });
  assert.deepEqual(metric.cached_input_tokens, { value: null, known: false });
  assert.deepEqual(metric.reasoning_output_tokens, { value: null, known: false });
  assert.deepEqual(metric.output_tokens, { value: 0, known: true });
  const totals = (await f.report()).totals.families.find(item => item.id === 'codex.main').metrics;
  assert.equal(totals.input_tokens.known_subtotal, null); assert.equal(totals.input_tokens.unknown_eligible_run_count, 1);
  assert.equal(totals.output_tokens.known_subtotal, 0); assert.equal(totals.output_tokens.reporting_run_count, 1);
});

test('usage security: Workflow retries count each canonical invocation once and preparation contributes no usage', async t => {
  const f = await fixture(t);
  const workflow = (await f.call('POST', '/coordination/workflows', {
    workspace_id: f.workspace.id, project_id: f.project.id, title: 'Usage retry fixture', idempotency_key: 'usage-workflow',
    definition: { inputs: [], steps: [{ id: 'read', name: 'Read', type: 'agent', retry: { max_attempts: 2 }, config: { agent_id: f.agent.id, profile_version: f.agent.version, work_mode: 'conversation', permission_mode: 'read-only' } }] },
  })).result;
  const instance = (await f.call('POST', `/coordination/workflows/${workflow.id}/runs`, { inputs: {}, idempotency_key: 'usage-workflow-start' })).result;
  let sequence = 0;
  const action = async action => {
    const current = (await f.call('GET', `/coordination/workflow-runs/${instance.id}`)).result;
    return (await f.call('POST', `/coordination/workflow-runs/${instance.id}/actions`, { action, step_id: 'read', version: current.version, idempotency_key: `usage-action-${++sequence}` })).result;
  };
  const firstPrepared = await action('prepare_step');
  assert.equal((await f.report(undefined, '&group_by=workflow')).totals.eligible_run_count, 0);
  const launchPrepared = async prepared => {
    const inspected = (await f.call('POST', '/context/inspect', prepared.context_inspection_request)).result;
    return (await f.call('POST', '/runs', { ...prepared.run_request, context_inspection_id: inspected.id })).run;
  };
  f.scenario.exitCode = 1;
  const first = await launchPrepared(firstPrepared); assert.equal(first.status, 'failed');
  await action('reconcile_step');
  const secondPrepared = await action('prepare_step');
  assert.equal((await f.report(undefined, '&group_by=workflow')).totals.eligible_run_count, 1);
  f.scenario.exitCode = 0;
  const second = await launchPrepared(secondPrepared); assert.notEqual(second.id, first.id);
  await action('reconcile_step');
  const aggregate = await f.report(undefined, `&group_by=workflow&workflow_id=${workflow.id}`);
  assert.equal(aggregate.totals.eligible_run_count, 2);
  assert.equal(aggregate.groups.length, 1); assert.equal(aggregate.groups[0].key, workflow.id);
  assert.equal(aggregate.totals.families.find(item => item.id === 'codex.main').metrics.input_tokens.known_subtotal, 22);
  const member = await f.authenticate(); await member.deny('agents.read', 'project', f.project.id);
  assert.equal((await f.report(member.cookie, '&group_by=workflow')).totals.eligible_run_count, 0);
});

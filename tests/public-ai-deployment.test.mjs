import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeploymentPolicy } from '../server/deployment-policy.mjs';
import { createLocalApi } from '../server/local-api.mjs';
import { createTalvoriServer } from '../server/start.mjs';
import { DatabaseSync } from 'node:sqlite';

const env = { TALVORI_DEPLOYMENT_MODE: 'public', TALVORI_PUBLIC_BASE_URL: 'https://rumbo.example', TALVORI_TRUST_LOOPBACK_PROXY: '1', TALVORI_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), TALVORI_GITHUB_CLIENT_ID: 'fixture_client', TALVORI_GITHUB_CLIENT_SECRET: 'fixture_secret' };
const request = (overrides = {}) => ({ method: 'POST', headers: { host: 'rumbo.example', origin: 'https://rumbo.example', 'x-forwarded-proto': 'https' }, socket: { remoteAddress: '127.0.0.1' }, ...overrides });

test('public deployment fails closed without HTTPS origin, stable encryption and provisioned identity', () => {
  for (const change of [{ TALVORI_PUBLIC_BASE_URL: '' }, { TALVORI_PUBLIC_BASE_URL: 'http://rumbo.example' }, { TALVORI_PUBLIC_BASE_URL: 'https://rumbo.example/path' }, { TALVORI_PUBLIC_BASE_URL: 'https://localhost' }, { TALVORI_CONNECTION_ENCRYPTION_KEY: '' }]) assert.throws(() => createDeploymentPolicy({ ...env, ...change }));
  const policy = createDeploymentPolicy(env);
  assert.throws(() => policy.assertConfigured({ configured: () => false }, 'clean'), /provision the owner/);
  assert.throws(() => policy.assertConfigured({ configured: () => true }, 'demo'), /invite-only/);
  policy.assertConfigured({ configured: () => true }, 'clean');
});

test('public host, HTTPS, exact Origin, trusted proxy and identity throttles are enforced', () => {
  const policy = createDeploymentPolicy(env); policy.checkRequest(request());
  for (const bad of [request({ headers: { host: 'attacker.example' } }), request({ socket: { remoteAddress: '203.0.113.2' } }), request({ headers: { host: 'rumbo.example', 'x-forwarded-proto': 'https', origin: 'https://attacker.example' } }), request({ headers: { host: 'rumbo.example', 'x-forwarded-proto': 'https' } })]) assert.throws(() => policy.checkRequest(bad));
  policy.checkRequest(request({ method: 'GET', headers: { host: 'rumbo.example', 'x-forwarded-proto': 'https' } }));
  for (let i = 0; i < 30; i++) policy.throttleIdentity(request(), '/identity/login');
  assert.throws(() => policy.throttleIdentity(request(), '/identity/login'), { statusCode: 429 });
});

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-public-ai-test-'));
  let api = createLocalApi({ dataDir: directory, integrationOptions: { env: { TALVORI_CONNECTION_ENCRYPTION_KEY: env.TALVORI_CONNECTION_ENCRYPTION_KEY } } });
  let server = createServer((req, res) => api.middleware(req, res));
  const listen = async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}/api`; };
  let base = await listen();
  const workspace = await (await fetch(`${base}/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Public fixture' }) })).json();
  const ws = workspace.workspace.id;
  const setup = await fetch(`${base}/identity/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Fixture owner', email: 'owner@example.com', password: 'fixture owner password 123' }) });
  assert.equal(setup.status, 200);
  await new Promise(resolve => server.close(resolve)); api.close();
  const prompts = [], configs = [], events = []; let clock = new Date();
  api = createLocalApi({ dataDir: directory, scheduledWorkOptions: { now: () => clock, scheduleIntervalMs: 3600000 }, integrationOptions: { env, fetchImpl: async url => {
    if (url.endsWith('/access_token')) return Response.json({ access_token: 'ghu_public_fixture', token_type: 'bearer', expires_in: 3600 });
    if (url === 'https://api.github.com/user') return Response.json({ id: 42, login: 'public-fixture' });
    throw Error('Unexpected provider call');
  } }, copilotOptions: { clientFactory: async options => {
    configs.push(options);
    return { async start() {}, async stop() {}, async forceStop() {}, async listModels() { return [{ id: 'fixture-model', name: 'Fixture model' }]; }, async createSession(config) {
      assert.deepEqual(config.availableTools, []);
      return { on() { return () => {}; }, async sendAndWait(input) {
        prompts.push(input.prompt); const nonce = input.prompt.match(/"nonce":"([^"]+)"/)?.[1];
        return { data: { content: nonce ? `Review this proposal.\n\`\`\`rumbo-actions\n${JSON.stringify({ nonce, actions: [{ type: 'record.create', resource: 'tasks', fields: { title: 'Proposed through hosted SDK' } }] })}\n\`\`\`` : 'OK' } };
      } };
    } };
  } } });
  server = createServer((req, res) => api.middleware(req, res, () => { res.statusCode = 404; res.end(); })); base = await listen();
  t.after(async () => { await new Promise(resolve => server.close(resolve)); api.close(); rmSync(directory, { recursive: true, force: true }); });
  const call = async (path, method = 'GET', body, cookie, extra = {}) => {
    return new Promise((resolve, reject) => {
      const req = httpRequest(`${base}${path}`, { method, headers: { host: 'rumbo.example', 'x-forwarded-proto': 'https', ...(method !== 'GET' ? { origin: env.TALVORI_PUBLIC_BASE_URL } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...extra } }, response => {
        let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => { const headers = new Headers(Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]))); resolve({ status: response.statusCode, headers, body: text ? JSON.parse(text) : null }); });
      });
      req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
    });
  };
  const login = await call('/identity/login', 'POST', { email: 'owner@example.com', password: 'fixture owner password 123' }); assert.equal(login.status, 200, JSON.stringify(login));
  const cookie = login.headers.get('set-cookie').split(';')[0]; events.push(login);
  return { call, cookie, ws, prompts, configs, login, events, api, get clock() { return clock; }, setClock(value) { clock = value; } };
}

test('public HTTP: secure sessions, unauthenticated denial, no shared runners/host terminal, OAuth callback and explicit model test', async t => {
  const f = await fixture(t), { call, cookie, ws } = f;
  assert.match(f.login.headers.get('set-cookie'), /HttpOnly; SameSite=Lax;.*Secure/);
  assert.equal((await call('/bootstrap')).status, 401);
  for (const path of ['/connections/setup', '/connections/codex/connect', '/workbench/projects', '/change-reviews', '/identity/setup']) assert.equal((await call(path, 'POST', {}, cookie)).status, 403, path);
  const boot = await call('/bootstrap', 'GET', null, cookie); assert.equal(boot.status, 200);
  for (const row of boot.body.connections.filter(row => ['codex', 'claude'].includes(row.provider))) assert.equal(row.state, 'not_connected');
  const before = await call(`/ai-connections?workspace_id=${ws}`, 'GET', null, cookie);
  assert.equal(before.body.result.deployment.mode, 'public'); assert.equal(before.body.result.copilot_oauth_setup.configured, true);
  assert.equal(f.configs.length, 0);
  assert.equal((await call('/ai-connections/copilot/start', 'POST', { workspace_id: ws }, cookie)).status, 409);
  const started = await call('/ai-connections/copilot/oauth/start', 'POST', { workspace_id: ws }, cookie); assert.equal(started.status, 200, JSON.stringify(started.body));
  const url = new URL(started.body.result.authorization_url), state = url.searchParams.get('state');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://rumbo.example/api/ai-connections/copilot/callback');
  const callback = await call(`/ai-connections/copilot/callback?state=${state}&code=fixture`, 'GET', null, cookie, { 'sec-fetch-site': 'cross-site' });
  assert.equal(callback.status, 303, JSON.stringify(callback.body)); assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await call(`/ai-connections?workspace_id=${ws}`, 'GET', null, cookie)).body.result.copilot.state, 'configured');
  assert.equal(f.prompts.length, 0);
  assert.equal((await call('/ai-connections/copilot/check', 'POST', { workspace_id: ws }, cookie)).status, 200);
  const models = await call(`/ai-connections/copilot/models?workspace_id=${ws}`, 'GET', null, cookie); assert.equal(models.body.result[0].id, 'fixture-model'); assert.equal(f.prompts.length, 0);
  const tested = await call('/ai-connections/copilot/test', 'POST', { workspace_id: ws, model: 'fixture-model' }, cookie); assert.equal(tested.status, 200, JSON.stringify(tested.body)); assert.equal(tested.body.result.reply, 'OK');
  assert.deepEqual(f.prompts, ['Reply with exactly OK.']);
  assert.equal((await call(`/ai-connections?workspace_id=${ws}`, 'GET', null, cookie)).body.result.copilot.state, 'connected');
  assert.doesNotMatch(JSON.stringify(tested.body), /ghu_public_fixture|fixture_secret/);
  const good = async (path, body) => { const result = await call(path, body ? 'POST' : 'GET', body, cookie); assert.ok(result.status < 300, JSON.stringify(result.body)); return result.body; };
  const agent = (await good('/agents', { workspace_id: ws, provider: 'copilot', name: 'Hosted SDK fixture', model: 'fixture-model' })).agent;
  const chat = (await good('/chats', { workspace_id: ws, title: 'Public SDK chat' })).chat;
  const input = { workspace_id: ws, agent_id: agent.id, chat_id: chat.id, prompt: 'Propose a Route', model: 'fixture-model', work_mode: 'conversation', include_workspace: false, include_chat: false, include_memory: false };
  const preview = (await good('/context/inspect', input)).result;
  await good(`/chats/${chat.id}/turns`, { ...input, content: input.prompt, context_inspection_id: preview.id, client_turn_id: 'public-sdk-fixture' });
  const db = new DatabaseSync(f.api.dbPath); t.after(() => db.close());
  const waitRun = async chatId => { for (let n = 0; n < 100; n++) { const run = db.prepare('SELECT * FROM runs WHERE chat_id=? ORDER BY created_at DESC').get(chatId); if (run && ['completed', 'failed'].includes(run.status)) { assert.equal(run.status, 'completed', JSON.stringify(run)); return run; } await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Hosted run did not settle'); };
  const run = await waitRun(chat.id);
  assert.equal(f.prompts.at(-1), preview.finalPrompt); assert.equal((await good(`/agent-actions?run_id=${run.id}`)).actions[0].status, 'pending');
  assert.equal(db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(ws).n, 0);
  const scheduledChat = (await good('/chats', { workspace_id: ws, title: 'Scheduled hosted SDK' })).chat;
  const schedulePreview = (await good('/context/inspect', { ...input, chat_id: scheduledChat.id })).result;
  const localTime = new Date(f.clock.getTime() + 120000).toISOString().slice(0, 16);
  await good('/scheduled-work', { workspace_id: ws, kind: 'message', payload: { chat_id: scheduledChat.id, agent_id: agent.id, content: input.prompt, attachments: [] }, local_time: localTime, timezone: 'UTC', recurrence: 'none', request_id: 'hosted-sdk-schedule-fixture', context_inspection_id: schedulePreview.id });
  f.setClock(new Date(`${localTime}:00.000Z`)); const beforeSchedule = f.prompts.length;
  await f.api.dispatchScheduledWork(); await waitRun(scheduledChat.id); await f.api.dispatchScheduledWork();
  assert.equal(f.prompts.length, beforeSchedule + 1); assert.equal(f.prompts.at(-1), schedulePreview.finalPrompt);
  await call('/ai-connections/copilot/disconnect', 'POST', { workspace_id: ws }, cookie);
  assert.equal((await call(`/ai-connections?workspace_id=${ws}`, 'GET', null, cookie)).body.result.copilot.state, 'not_connected');
});

test('production server serves built assets and SPA routes but not secrets, API fallbacks or external symlinks', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-production-static-')), dataDir = mkdtempSync(join(tmpdir(), 'rumbo-production-data-'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Talvori fixture</title>');
  writeFileSync(join(directory, 'app.js'), 'export default "fixture"'); writeFileSync(join(directory, '.env'), 'PRIVATE_SECRET');
  symlinkSync('/etc/hosts', join(directory, 'escape.txt'));
  assert.throws(() => createTalvoriServer({ env: {}, apiOptions: { dataDir: join(directory, 'private-data') }, clientDirectory: directory }), /Private Talvori data/);
  const { server } = createTalvoriServer({ env: {}, apiOptions: { dataDir }, clientDirectory: directory });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/connections/copilot']) { const response = await fetch(`${base}${path}`); assert.equal(response.status, 200, path); assert.match(await response.text(), /Talvori fixture/); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/); }
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  for (const path of ['/.env', '/escape.txt', '/missing.js', '/api/not-a-real-route']) assert.equal((await fetch(`${base}${path}`)).status, 404, path);
});

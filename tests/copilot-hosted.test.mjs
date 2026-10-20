import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createAiConnectionsService } from '../server/ai-connections-service.mjs';
import { createCopilotHostedRuntime } from '../server/copilot-hosted-runtime.mjs';

const actor = { id: 'user_a' }, host = '127.0.0.1:4174';
const pause = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-copilot-oauth-test-')), db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES ('ws'),('other');");
  const requests = [], env = { FRONDOSE_GITHUB_CLIENT_ID: 'fixture_client', FRONDOSE_GITHUB_CLIENT_SECRET: 'fixture_operator_secret' };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const custom = await overrides.fetch?.(url, options); if (custom) return custom;
    if (url.endsWith('/access_token')) return Response.json({ access_token: 'ghu_fixture_user_token', token_type: 'bearer', refresh_token: 'ghr_fixture_refresh', expires_in: 3600, refresh_token_expires_in: 86400 });
    if (url === 'https://api.github.com/user') return Response.json({ id: 123, login: 'fixture-user' });
    throw Error('Unexpected request');
  };
  let allowed = true;
  const service = createAiConnectionsService({ db, dataDir: directory, env, fetchImpl, authorize: (workspace, who) => { if (!allowed || who.id === 'denied') throw Object.assign(Error('Denied'), { code: 'access_denied' }); } });
  t.after(() => { service.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  const start = async (who = actor, workspace = 'ws', origin = host) => new URL((await service.copilotOAuth.start({ workspace_id: workspace }, who, origin)).authorization_url);
  const connect = async () => { const url = await start(); return service.copilotOAuth.complete(url.searchParams.get('state'), 'fixture-code', actor, host); };
  return { db, env, requests, service, oauth: service.copilotOAuth, start, connect, revoke() { allowed = false; } };
}

test('hosted Copilot PKCE binds the callback to actor, workspace, origin and one-use state; tokens stay encrypted', async t => {
  const f = fixture(t), url = await f.start();
  assert.equal(url.origin, 'https://github.com'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), `http://${host}/api/ai-connections/copilot/callback`);
  const state = url.searchParams.get('state');
  await assert.rejects(f.oauth.complete(state, 'code', { id: 'other' }, host), /another Frondose session/);
  await assert.rejects(f.oauth.complete(state, 'code', actor, 'localhost:4174'), /another Frondose session/);
  assert.equal(f.requests.length, 0);
  const result = await f.oauth.complete(state, 'code', actor, host);
  assert.equal(result.state, 'configured'); assert.equal(result.method, 'github_oauth');
  assert.equal(f.oauth.status('other', actor), null); assert.equal(f.oauth.status('ws', { id: 'other' }), null);
  const exchange = JSON.parse(f.requests[0].options.body);
  assert.equal(createHash('sha256').update(exchange.code_verifier).digest('base64url'), url.searchParams.get('code_challenge'));
  assert.equal(exchange.client_secret, f.env.FRONDOSE_GITHUB_CLIENT_SECRET);
  await assert.rejects(f.oauth.complete(state, 'code', actor, host), /expired/);
  assert.doesNotMatch(f.db.prepare('SELECT encrypted_credential FROM ai_account_connections').get().encrypted_credential, /ghu_|ghr_/);
  assert.doesNotMatch(JSON.stringify(result), /fixture_user_token|operator_secret|fixture_refresh/);
  await assert.rejects(f.oauth.credential('ws', actor), /Test a Copilot model/);
  const credential = await f.oauth.credential('ws', actor, { allowUnverified: true });
  assert.equal((await f.oauth.check('ws', actor)).requires_model_test, true);
  await credential.verified(); assert.equal(f.oauth.status('ws', actor).state, 'connected');
  await f.oauth.disconnect('ws', actor); await assert.rejects(credential.assertCurrent(), /disconnected or replaced/);
});

test('hosted Copilot rejects missing app registration, changed registration, expired state and denied authorization', async t => {
  const f = fixture(t); delete f.env.FRONDOSE_GITHUB_CLIENT_SECRET;
  assert.deepEqual(f.oauth.setup().missing, ['FRONDOSE_GITHUB_CLIENT_SECRET']);
  await assert.rejects(f.start(), /Configure/); f.env.FRONDOSE_GITHUB_CLIENT_SECRET = 'fixture';
  let url = await f.start();
  f.db.prepare("UPDATE ai_authorization_attempts SET expires_at='2000-01-01'").run();
  await assert.rejects(f.oauth.complete(url.searchParams.get('state'), 'code', actor, host), /expired/);
  url = await f.start(); f.env.FRONDOSE_GITHUB_CLIENT_ID = 'replacement';
  await assert.rejects(f.oauth.complete(url.searchParams.get('state'), 'code', actor, host), /registration changed/);
  url = await f.start(); await assert.rejects(f.oauth.complete(url.searchParams.get('state'), null, actor, host, 'access_denied'), /not completed/);
  assert.equal(f.requests.length, 0);
});

test('hosted Copilot claims concurrent callbacks once and never resurrects a disconnected account', async t => {
  const gate = deferred(), entered = deferred();
  const f = fixture(t, { fetch: async url => { if (url.endsWith('/access_token')) { entered.resolve(); await gate.promise; } } });
  const url = await f.start(), state = url.searchParams.get('state');
  const pending = f.oauth.complete(state, 'code', actor, host); await entered.promise;
  await assert.rejects(f.oauth.complete(state, 'code', actor, host), /expired|already used/);
  await f.oauth.disconnect('ws', actor); gate.resolve(); await assert.rejects(pending, /cancelled or superseded/);
  assert.equal(f.oauth.status('ws', actor), null);
});

test('hosted Copilot refresh is deduplicated, preserves user identity and rejects stale refresh after disconnect', async t => {
  let refreshing = false, count = 0; const gate = deferred(), entered = deferred();
  const f = fixture(t, { fetch: async url => {
    if (!url.endsWith('/access_token')) return;
    if (!refreshing) return Response.json({ access_token: 'ghu_initial', token_type: 'bearer', refresh_token: 'ghr_refresh', expires_in: 1 });
    count++; entered.resolve(); await gate.promise;
    return Response.json({ access_token: 'ghu_next', token_type: 'bearer', refresh_token: 'ghr_next', expires_in: 3600 });
  } });
  await f.connect(); refreshing = true;
  const first = f.oauth.credential('ws', actor, { allowUnverified: true }), second = f.oauth.credential('ws', actor, { allowUnverified: true });
  await entered.promise; gate.resolve();
  assert.equal((await first).accessToken, 'ghu_next'); assert.equal((await second).accountId, 123); assert.equal(count, 1);
  await f.oauth.disconnect('ws', actor); await assert.rejects((await first).assertCurrent(), /disconnected or replaced/);
});

test('hosted Copilot cannot persist a refreshed token after disconnect or use another actor’s credential', async t => {
  const gate = deferred(), entered = deferred(); let refresh = false;
  const f = fixture(t, { fetch: async url => {
    if (!url.endsWith('/access_token')) return;
    if (refresh) { entered.resolve(); await gate.promise; }
    return Response.json({ access_token: refresh ? 'ghu_new' : 'ghu_initial', token_type: 'bearer', refresh_token: 'ghr_refresh', expires_in: refresh ? 3600 : 1 });
  } });
  await f.connect();
  await assert.rejects(f.oauth.credential('ws', { id: 'another_actor' }, { allowUnverified: true }), /Authorize your GitHub account/);
  await assert.rejects(f.oauth.credential('other', actor, { allowUnverified: true }), /Authorize your GitHub account/);
  refresh = true;
  const pending = f.oauth.credential('ws', actor, { allowUnverified: true }); await entered.promise;
  await f.oauth.disconnect('ws', actor); gate.resolve();
  await assert.rejects(pending, { code: 'connection_changed' }); assert.equal(f.oauth.status('ws', actor), null);
});

function runtimeFixture(t, behavior = {}) {
  const launches = [], sessions = [], prompts = []; let verifies = 0, allowed = true;
  const accounts = { credential: async () => ({ accessToken: 'ghu_fixture', assertCurrent: async () => { if (!allowed) throw Object.assign(Error('Changed'), { code: 'connection_changed' }); }, verified: async () => { verifies++; } }) };
  const runtime = createCopilotHostedRuntime({ accounts, env: { PATH: process.env.PATH, HOME: '/private/real-user', GITHUB_TOKEN: 'PRIVATE_TOKEN', COPILOT_ALLOW_ALL: '1', OPENAI_API_KEY: 'PRIVATE_KEY' }, clientFactory: async options => {
    if (behavior.factoryGate) await behavior.factoryGate.promise;
    const client = { stops: 0, starts: 0, async start() { this.starts++; await behavior.startGate?.promise; }, async stop() { this.stops++; behavior.stop?.(); }, async forceStop() { this.stops++; }, async listModels() { return [{ id: 'fixture-model', name: 'Fixture model' }, { id: '../bad' }]; }, async createSession(config) {
      sessions.push(config); let listener;
      return { on(callback) { listener = callback; return () => { listener = null; }; }, async abort() {}, async sendAndWait(input) {
        prompts.push(input); listener({ type: 'assistant.message_delta', agentId: 'foreign-subagent', data: { deltaContent: 'FOREIGN' } });
        listener({ type: 'assistant.message_delta', data: { deltaContent: 'OK' } });
        if (behavior.error) throw Error('secret ghu_fixture PRIVATE_TOKEN');
        if (behavior.eventError) listener({ type: 'session.error' });
        if (behavior.inferenceGate) await behavior.inferenceGate.promise;
        return { data: { content: behavior.reply ?? 'OK' } };
      } };
    } };
    launches.push({ options, client }); return client;
  } });
  t.after(() => runtime.close());
  return { runtime, launches, sessions, prompts, verifies: () => verifies, revoke() { allowed = false; } };
}
const input = { workspaceId: 'ws', actor, prompt: 'EXACT REVIEWED PROMPT', model: 'fixture-model', timeoutMs: 2000 };

test('SDK uses explicit per-user token, empty isolated home, zero native tools, exact prompt once and verifies only after inference', async t => {
  const f = runtimeFixture(t), events = [];
  assert.deepEqual(await f.runtime.models('ws', actor), [{ id: 'fixture-model', name: 'Fixture model', source: 'copilot_sdk' }]);
  assert.equal(f.verifies(), 0); assert.equal(f.prompts.length, 0);
  assert.equal((await f.runtime.execute({ ...input, verification: true }, { onEvent: item => events.push(item) })).text, 'OK');
  assert.equal(f.verifies(), 1); assert.deepEqual(f.prompts, [{ prompt: input.prompt }]);
  assert.ok(!JSON.stringify(events).includes('FOREIGN'));
  const config = f.sessions[0]; assert.deepEqual(config.availableTools, []); assert.deepEqual(config.tools, []); assert.deepEqual(config.mcpServers, {});
  assert.deepEqual(config.onPermissionRequest(), { kind: 'reject' }); assert.equal(config.enableConfigDiscovery, false); assert.equal(config.skipCustomInstructions, true);
  for (const { options, client } of f.launches) {
    assert.equal(options.mode, 'empty'); assert.equal(options.gitHubToken, 'ghu_fixture'); assert.equal(options.useLoggedInUser, false);
    assert.deepEqual(options.connection, { kind: 'stdio' });
    assert.equal(options.env.GITHUB_TOKEN, undefined); assert.equal(options.env.COPILOT_ALLOW_ALL, undefined); assert.equal(options.env.OPENAI_API_KEY, undefined);
    assert.notEqual(options.env.HOME, '/private/real-user'); assert.equal(existsSync(options.workingDirectory), false); assert.ok(client.stops > 0);
  }
  assert.notEqual(f.launches[0].options.workingDirectory, f.launches[1].options.workingDirectory);
});

for (const behavior of [{ reply: '' }, { eventError: true }, { error: true }]) test(`SDK rejects incomplete inference without verification or secret leakage ${JSON.stringify(behavior)}`, async t => {
  const f = runtimeFixture(t, behavior);
  await assert.rejects(f.runtime.execute({ ...input, verification: true }), reason => { assert.doesNotMatch(reason.message, /ghu_fixture|PRIVATE_TOKEN/); return true; });
  assert.equal(f.verifies(), 0); assert.equal(f.prompts.length, 1);
});

test('SDK cancellation during a delayed factory never starts a late client', async t => {
  const gate = deferred(), f = runtimeFixture(t, { factoryGate: gate }), controller = new AbortController();
  const run = f.runtime.execute({ ...input, signal: controller.signal }); await pause(); controller.abort();
  await assert.rejects(run, { code: 'session_cancelled' }); gate.resolve(); await pause(); await pause();
  assert.equal(f.launches[0].client.starts, 0); assert.ok(f.launches[0].client.stops > 0); assert.equal(f.prompts.length, 0);
  assert.equal(existsSync(f.launches[0].options.workingDirectory), false);
});

test('SDK disconnect cancels pending startup and prevents prompt delivery', async t => {
  const gate = deferred(), f = runtimeFixture(t, { startGate: gate });
  const run = f.runtime.execute(input); await pause(); f.runtime.cancelScope('ws', actor);
  await assert.rejects(run, { code: 'session_cancelled' }); gate.resolve(); await pause(); await pause();
  assert.equal(f.prompts.length, 0); assert.ok(f.launches[0].client.stops > 0);
});

test('SDK timeout stops inference, never verifies, and never retries uncertain delivery', async t => {
  const gate = deferred(), f = runtimeFixture(t, { inferenceGate: gate });
  const run = f.runtime.execute({ ...input, timeoutMs: 1000, verification: true });
  await assert.rejects(run, { code: 'run_timeout' }); gate.resolve(); await pause(); await pause();
  assert.equal(f.prompts.length, 1); assert.equal(f.verifies(), 0); assert.ok(f.launches[0].client.stops > 0);
});

test('SDK checks current authorization again after inference and rejects host/native options', async t => {
  const gate = deferred(), f = runtimeFixture(t, { inferenceGate: gate });
  const run = f.runtime.execute(input); await pause(); f.revoke(); gate.resolve();
  await assert.rejects(run, { code: 'connection_changed' });
  for (const extra of [{ cwd: '/private' }, { workMode: 'project' }, { permissionMode: 'full-access' }, { nativeToolBridge: {} }, { reasoningEffort: 'high' }]) await assert.rejects(f.runtime.execute({ ...input, ...extra }), { code: 'copilot_options' });
});

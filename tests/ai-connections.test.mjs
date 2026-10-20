import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createAiConnectionsService } from '../server/ai-connections-service.mjs';
import { createLocalApi } from '../server/local-api.mjs';

function fixture(env = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-ai-connections-'));
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES ('ws_a'),('ws_b');");
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/auth/keys')) return Response.json({ key: 'sk-or-v1-user-secret' });
    if (url.endsWith('/key')) return Response.json({ data: { label: 'Frondose key', limit_remaining: 9.5 } });
    if (url.endsWith('/models/user')) return Response.json({ data: [{ id: 'example/text-model', name: 'Text model', architecture: { output_modalities: ['text'] } }] });
    if (url.endsWith('/chat/completions')) return Response.json({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 4, completion_tokens: 1 } });
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'hf_oauth_isolated', refresh_token: 'hf_refresh_isolated', expires_in: 3600 });
    if (url.endsWith('/api/whoami-v2')) return Response.json({ name: 'Test HF user' });
    if (url.endsWith('/v1/models')) return Response.json({ data: [{ id: 'example/hf-chat', architecture: { output_modalities: ['text'] } }] });
    if (url.endsWith('/v1/chat/completions')) return Response.json({ choices: [{ message: { content: 'OK' } }] });
    throw new Error(`Unexpected provider URL: ${url}`);
  };
  const service = createAiConnectionsService({ db, dataDir: directory, fetchImpl, env, authorize: (workspaceId, actor) => { if (workspaceId !== 'ws_a' || actor.id !== 'user_a') throw Object.assign(new Error('Denied'), { statusCode: 403 }); } });
  return { db, directory, requests, service, close() { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('OpenRouter PKCE binds authorization to actor, workspace, origin and a one-use verifier', async () => {
  const f = fixture();
  try {
    const actor = { id: 'user_a' }, start = await f.service.start({ workspace_id: 'ws_a' }, actor, '127.0.0.1:4174');
    const url = new URL(start.authorization_url), callback = new URL(url.searchParams.get('callback_url'));
    assert.equal(url.origin, 'https://openrouter.ai');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(callback.origin, 'http://127.0.0.1:4174');
    const state = callback.pathname.split('/').at(-1);
    await assert.rejects(f.service.complete(state, 'provider-code', { id: 'user_b' }, '127.0.0.1:4174'), /another session/);
    await assert.rejects(f.service.complete(state, 'provider-code', actor, 'localhost:4174'), /another session/);
    assert.equal(f.requests.length, 0);
    const connection = await f.service.complete(state, 'provider-code', actor, '127.0.0.1:4174');
    assert.equal(connection.state, 'connected');
    const payload = JSON.parse(f.requests[0].options.body);
    assert.equal(payload.code_challenge_method, 'S256');
    assert.notEqual(payload.code_verifier, url.searchParams.get('code_challenge'));
    assert.equal(f.db.prepare('SELECT COUNT(*) AS total FROM ai_authorization_attempts').get().total, 0);
    await assert.rejects(f.service.complete(state, 'provider-code', actor, '127.0.0.1:4174'), /expired/);
    const stored = f.db.prepare('SELECT * FROM ai_account_connections').get();
    assert.equal(stored.actor_id, actor.id);
    assert.equal(stored.workspace_id, 'ws_a');
    assert.doesNotMatch(stored.encrypted_credential, /sk-or-v1-user-secret/);
    assert.doesNotMatch(readFileSync(join(f.directory, 'connections.key')).toString('base64'), /sk-or-v1-user-secret/);
    assert.equal((await f.service.list('ws_a', actor)).openrouter.state, 'connected');
  } finally { f.close(); }
});

test('OpenRouter key check, model discovery and explicit paid test are separate actions', async () => {
  const f = fixture();
  try {
    const actor = { id: 'user_a' }, start = await f.service.start({ workspace_id: 'ws_a' }, actor, '127.0.0.1:4174');
    const state = new URL(start.authorization_url).searchParams.get('callback_url').split('/').at(-1);
    await f.service.complete(state, 'provider-code', actor, '127.0.0.1:4174');
    assert.equal((await f.service.check('ws_a', actor)).key.limit_remaining, 9.5);
    assert.equal((await f.service.models('ws_a', actor))[0].id, 'example/text-model');
    await assert.rejects(f.service.testModel('ws_a', 'not/available', actor), /not available/);
    assert.equal(f.requests.filter(item => item.url.endsWith('/chat/completions')).length, 0);
    const result = await f.service.testModel('ws_a', 'example/text-model', actor);
    assert.equal(result.reply, 'OK');
    assert.equal(f.requests.filter(item => item.url.endsWith('/chat/completions')).length, 1);
    assert.equal((await f.service.disconnect('ws_a', actor)).remote_key_revoked, false);
    assert.equal((await f.service.list('ws_a', actor)).openrouter, null);
    await assert.rejects(f.service.models('ws_a', actor), /Connect your OpenRouter/);
  } finally { f.close(); }
});

test('pending OAuth cannot complete after local disconnect', async () => {
  const f = fixture();
  try {
    const actor = { id: 'user_a' }, start = await f.service.start({ workspace_id: 'ws_a' }, actor, '127.0.0.1:4174');
    const state = new URL(start.authorization_url).searchParams.get('callback_url').split('/').at(-1);
    await f.service.disconnect('ws_a', actor);
    await assert.rejects(f.service.complete(state, 'provider-code', actor, '127.0.0.1:4174'), /expired/);
    assert.equal(f.requests.length, 0);
  } finally { f.close(); }
});

test('Hugging Face requires operator OAuth registration then uses scoped PKCE and user inference', async () => {
  const missing = fixture();
  try { await assert.rejects(missing.service.hfStart({ workspace_id: 'ws_a' }, { id: 'user_a' }, '127.0.0.1:4174'), /FRONDOSE_HF_CLIENT_ID/); }
  finally { missing.close(); }
  const f = fixture({ FRONDOSE_HF_CLIENT_ID: 'hf-app-id' });
  try {
    const actor = { id: 'user_a' }, started = await f.service.hfStart({ workspace_id: 'ws_a' }, actor, '127.0.0.1:4174');
    const url = new URL(started.authorization_url), state = url.searchParams.get('state');
    assert.equal(url.origin, 'https://huggingface.co');
    assert.equal(url.searchParams.get('scope'), 'openid profile inference-api');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:4174/api/ai-connections/huggingface/callback');
    await assert.rejects(f.service.hfComplete(state, 'code', { id: 'user_b' }, '127.0.0.1:4174'), /another session/);
    const connected = await f.service.hfComplete(state, 'code', actor, '127.0.0.1:4174');
    assert.equal(connected.account_label, 'Test HF user');
    assert.equal((await f.service.hfCheck('ws_a', actor)).state, 'connected');
    assert.equal((await f.service.hfModels('ws_a', actor))[0].id, 'example/hf-chat');
    const testResult = await f.service.hfTestModel('ws_a', 'example/hf-chat', actor);
    assert.equal(testResult.reply, 'OK');
    assert.equal((await f.service.list('ws_a', actor)).huggingface_configured, true);
    const saved = f.db.prepare("SELECT encrypted_credential FROM ai_account_connections WHERE provider='huggingface'").get();
    assert.doesNotMatch(saved.encrypted_credential, /hf_oauth_isolated/);
    await f.service.hfDisconnect('ws_a', actor);
    assert.equal((await f.service.list('ws_a', actor)).huggingface, null);
  } finally { f.close(); }
});

test('local API exposes AI connection state without exposing credentials or starting provider calls', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-ai-api-'));
  let calls = 0;
  const api = createLocalApi({ dataDir: directory, seedMode: 'demo', integrationOptions: { fetchImpl: async () => { calls += 1; throw new Error('Unexpected provider call'); } } });
  const server = createServer((request, response) => api.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/ai-connections?workspace_id=ws_personal`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.result.openrouter, null);
    assert.match(payload.result.requirements.copilot, /subscription/);
    assert.equal(calls, 0);
    const wrong = await fetch(`${base}/api/ai-connections?workspace_id=unknown`);
    assert.equal(wrong.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    api.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('local API completes an isolated OpenRouter callback and redirects to AI connections', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-ai-callback-'));
  const calls = [];
  const api = createLocalApi({ dataDir: directory, seedMode: 'demo', integrationOptions: { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/keys')) return Response.json({ key: 'sk-or-v1-isolated-test' });
    if (url.endsWith('/key')) return Response.json({ data: { label: 'QA account' } });
    throw new Error(`Unexpected provider URL: ${url}`);
  } } });
  const server = createServer((request, response) => api.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const started = await fetch(`${base}/api/ai-connections/openrouter/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: 'ws_personal' }) });
    assert.equal(started.status, 200);
    const authorizeUrl = new URL((await started.json()).result.authorization_url);
    const callbackUrl = new URL(authorizeUrl.searchParams.get('callback_url'));
    assert.equal(callbackUrl.origin, base);
    callbackUrl.searchParams.set('code', 'fake-code');
    const callback = await fetch(callbackUrl, { redirect: 'manual' });
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get('location'), '/#/connections');
    assert.equal(calls.length, 2);
    const state = await (await fetch(`${base}/api/ai-connections?workspace_id=ws_personal`)).json();
    assert.equal(state.result.openrouter.account_label, 'QA account');
    assert.equal(JSON.stringify(state).includes('sk-or-v1-isolated-test'), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    api.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

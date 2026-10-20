import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiConnectionsService } from '../server/ai-connections-service.mjs';
import { API_PROVIDERS } from '../src/lib/ai-provider-catalog.js';

const actor = { id: 'fixture-user' }, host = '127.0.0.1:4174', model = 'fixture/model';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-connection-races-')), db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES ('ws');");
  const f = { db, env: { FRONDOSE_HF_CLIENT_ID: 'fixture-app' }, requests: [], allowed: true, reply: null };
  const service = createAiConnectionsService({ db, dataDir: directory, env: f.env, authorize: () => { if (!f.allowed) throw Object.assign(Error('Access revoked'), { code: 'access_denied' }); }, fetchImpl: async (url, options) => {
    f.requests.push({ url, options });
    const custom = await f.reply?.(url, options); if (custom) return custom;
    if (url.endsWith('/auth/keys')) return Response.json({ key: 'sk-or-isolated-oauth-key' });
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'hf_isolated_oauth', expires_in: 3600 });
    if (url.endsWith('/api/whoami-v2')) return Response.json({ name: 'Fixture user' });
    if (url.endsWith('/key')) return Response.json({ data: { label: 'Fixture account' } });
    if (url.includes('/models')) return Response.json({ data: [{ id: model }] });
    return Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
  } });
  f.service = service;
  f.start = async provider => {
    const result = await service[provider === 'openrouter' ? 'start' : 'hfStart']({ workspace_id: 'ws' }, actor, host), url = new URL(result.authorization_url);
    return provider === 'openrouter' ? new URL(url.searchParams.get('callback_url')).pathname.split('/').at(-1) : url.searchParams.get('state');
  };
  f.complete = (provider, state) => service[provider === 'openrouter' ? 'complete' : 'hfComplete'](state, 'fixture-code', actor, host);
  f.disconnect = provider => service.connectionDisconnect(provider, 'ws', actor);
  f.save = (provider, apiKey = 'isolated-fixture-api-key') => service.saveApiKey(provider, { workspace_id: 'ws', api_key: apiKey, model_ids: [model], ...(API_PROVIDERS.find(item => item.id === provider)?.workspaceRequired ? { provider_workspace: 'fixture' } : {}) }, actor);
  t.after(() => { service.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  return f;
}

for (const provider of ['openrouter', 'huggingface']) {
  test(`${provider}: concurrent callbacks exchange a one-use code only once`, async t => {
    const f = fixture(t), gate = deferred(), entered = deferred(), state = await f.start(provider);
    f.reply = async url => { if (url.endsWith('/auth/keys') || url.endsWith('/oauth/token')) { entered.resolve(); await gate.promise; } };
    const first = f.complete(provider, state); await entered.promise;
    await assert.rejects(f.complete(provider, state), reason => ['oauth_replayed', 'oauth_expired'].includes(reason.code));
    gate.resolve(); await first;
    assert.equal(f.requests.filter(item => item.url.endsWith('/auth/keys') || item.url.endsWith('/oauth/token')).length, 1);
  });

  for (const action of ['disconnect', 'replace-key', 'new-sign-in', 'revoke-access', 'shutdown']) test(`${provider}: ${action} invalidates an in-flight OAuth callback`, async t => {
    const f = fixture(t), state = await f.start(provider), gate = deferred(), entered = deferred();
    f.reply = async url => { if (url.endsWith('/auth/keys') || url.endsWith('/oauth/token')) { entered.resolve(); await gate.promise; } };
    const pending = f.complete(provider, state); await entered.promise;
    if (action === 'disconnect') await f.disconnect(provider);
    if (action === 'replace-key') await f.save(provider);
    if (action === 'new-sign-in') await f.start(provider);
    if (action === 'revoke-access') f.allowed = false;
    if (action === 'shutdown') f.service.close();
    gate.resolve(); await assert.rejects(pending, reason => ['oauth_cancelled', 'access_denied', 'service_closed'].includes(reason.code));
    assert.equal(f.requests.length, 1, 'No follow-up account probe after authorization is cancelled');
    const row = f.db.prepare('SELECT * FROM ai_account_connections').get();
    assert.equal(Boolean(row), action === 'replace-key'); if (row) assert.equal(row.state, 'configured');
  });

  for (const kind of ['check', 'models', 'test']) test(`${provider}: ${kind} cannot return stale data or verify a replacement credential`, async t => {
    const f = fixture(t); await f.complete(provider, await f.start(provider));
    const gate = deferred(), entered = deferred();
    f.reply = async url => {
      const target = kind === 'check' ? url.endsWith(provider === 'openrouter' ? '/key' : '/api/whoami-v2') : kind === 'models' ? url.includes('/models') : url.endsWith('/chat/completions');
      if (target) { entered.resolve(); await gate.promise; }
    };
    const pending = kind === 'test' ? f.service.connectionTest(provider, 'ws', model, actor) : f.service[kind === 'check' ? 'connectionCheck' : 'connectionModels'](provider, 'ws', actor);
    await entered.promise; await f.save(provider); gate.resolve();
    await assert.rejects(pending, { code: 'connection_changed' });
    const current = (await f.service.list('ws', actor))[provider]; assert.equal(current.state, 'configured'); assert.equal(current.model_tested_at, null);
  });
}

test('Hugging Face binds pending and saved OAuth credentials to the registered app', async t => {
  const f = fixture(t), state = await f.start('huggingface'); f.env.FRONDOSE_HF_CLIENT_ID = 'different-app';
  await assert.rejects(f.complete('huggingface', state), { code: 'oauth_expired' }); assert.equal(f.requests.length, 0);
  await f.complete('huggingface', await f.start('huggingface')); f.env.FRONDOSE_HF_CLIENT_ID = 'third-app';
  await assert.rejects(f.service.hfCheck('ws', actor), { code: 'reconnect_required' });
  assert.equal(f.service.readyState('huggingface', 'ws', actor).error_code, 'reconnect_required');
});

for (const provider of API_PROVIDERS) test(`${provider.name}: disconnect aborts the owned request and suppresses a late reply`, async t => {
  const f = fixture(t); await f.save(provider.id);
  // Isolated setup: test cancellation independently of protocol response parsing.
  f.db.prepare("UPDATE ai_account_connections SET state='connected'").run();
  const gate = deferred(), entered = deferred(), complete = deferred(), events = [];
  let requestSignal;
  f.reply = async (url, options) => { requestSignal = options.signal; entered.resolve(); await gate.promise; };
  await f.service.startAgentRun({ provider: provider.id, workspaceId: 'ws', actor, model, prompt: 'Exact reviewed fixture prompt' }, { onComplete: complete.resolve, onEvent: event => events.push(event) });
  await entered.promise; await f.disconnect(provider.id);
  assert.equal(requestSignal.aborted, true); assert.equal((await complete.promise).status, 'stopped');
  gate.resolve(); await tick(); assert.deepEqual(events, []); assert.equal(f.requests.length, 1);
});

for (const action of ['replace-key', 'revoke-access', 'shutdown']) test(`API request: ${action} cannot publish a late provider reply`, async t => {
  const f = fixture(t); await f.save('openrouter'); f.db.prepare("UPDATE ai_account_connections SET state='connected'").run();
  const gate = deferred(), entered = deferred(), complete = deferred(), events = [];
  f.reply = async () => { entered.resolve(); await gate.promise; };
  await f.service.startAgentRun({ provider: 'openrouter', workspaceId: 'ws', actor, model, prompt: 'Reviewed fixture' }, { onComplete: complete.resolve, onEvent: event => events.push(event) });
  await entered.promise;
  if (action === 'replace-key') await f.save('openrouter', 'isolated-replacement-key');
  if (action === 'revoke-access') f.allowed = false;
  if (action === 'shutdown') f.service.close();
  gate.resolve(); const result = await complete.promise;
  assert.equal(result.status, action === 'revoke-access' ? 'failed' : 'stopped');
  assert.deepEqual(events, []); assert.equal(f.requests.length, 1);
});

test('disconnect during API model discovery prevents the subsequent potentially billed test request', async t => {
  const f = fixture(t); await f.service.saveApiKey('openrouter', { workspace_id: 'ws', api_key: 'isolated-api-key', model_ids: [] }, actor);
  const gate = deferred(), entered = deferred(); f.reply = async url => { if (url.includes('/models')) { entered.resolve(); await gate.promise; } };
  const pending = f.service.connectionTest('openrouter', 'ws', model, actor);
  await entered.promise; await f.disconnect('openrouter'); gate.resolve();
  await assert.rejects(pending, { code: 'connection_changed' }); assert.equal(f.requests.length, 1); assert.ok(!f.requests.some(item => item.url.endsWith('/chat/completions')));
});

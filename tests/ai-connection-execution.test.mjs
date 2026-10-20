import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createCipheriv } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiConnectionsService } from '../server/ai-connections-service.mjs';

const actor = { id: 'a' }, prompt = 'Exact reviewed prompt\n<rumbo-actions>{"proposals":[]}</rumbo-actions>';
function fixture({ configured = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-ai-execution-'));
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES ('ws'),('other');");
  const key = randomBytes(32), requests = [];
  const f = { db, requests, authorizeOverride: null, response: () => Response.json({ choices: [{ message: { content: 'Reviewed reply' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } }) };
  const seal = (id, value) => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString('base64')).join('.');
  };
  f.saveCredential = (provider, value) => db.prepare(`INSERT OR REPLACE INTO ai_account_connections
    (id,workspace_id,actor_id,provider,state,encrypted_credential,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(provider, 'ws', actor.id, provider, 'connected', seal(provider, typeof value === 'string' ? value : JSON.stringify(value)), new Date().toISOString(), new Date().toISOString());
  f.service = createAiConnectionsService({ db, dataDir: directory, env: { FRONDOSE_CONNECTION_ENCRYPTION_KEY: key.toString('base64'), ...(configured ? { FRONDOSE_HF_CLIENT_ID: 'isolated-app' } : {}) },
    authorize: (workspaceId, currentActor) => {
      if (workspaceId !== 'ws' || currentActor.id !== actor.id) throw Object.assign(new Error('Denied'), { statusCode: 403 });
      return f.authorizeOverride?.();
    }, fetchImpl: async (url, options) => { requests.push({ url, options }); return f.response(url, options); } });
  f.saveCredential('openrouter', 'sk-or-isolated-secret');
  f.saveCredential('huggingface', { access_token: 'hf_isolated_token', expires_at: Date.now() + 3600_000 });
  f.close = () => { db.close(); rmSync(directory, { recursive: true, force: true }); };
  return f;
}
const request = (provider = 'openrouter') => ({ provider, workspaceId: 'ws', actor, prompt, model: 'example/model' });
async function run(f, options = {}) {
  const events = [];
  let resolve;
  const completion = new Promise(done => { resolve = done; });
  const controller = await f.service.startAgentRun({ ...request(), ...options }, { onEvent: event => events.push(event), onComplete: resolve });
  return { controller, events, result: await completion };
}

test('browser API readiness is actor/workspace-scoped, synchronous and makes no network requests', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.service.readyState('openrouter', 'ws', actor), { provider: 'openrouter', model_required: true, execution_mode: 'browser-api', native_tools: false, file_tools: false, state: 'connected' });
    assert.equal(f.service.readyState('huggingface', 'ws', actor).state, 'connected');
    for (const [provider, workspaceId, user] of [['openrouter', 'other', actor], ['openrouter', 'ws', { id: 'b' }], ['copilot', 'ws', actor], ['openrouter', 'ws', null]]) assert.equal(f.service.readyState(provider, workspaceId, user).state, 'not_connected');
    assert.equal(f.requests.length, 0);
    f.db.prepare("UPDATE ai_account_connections SET encrypted_credential='broken' WHERE provider='openrouter'").run();
    assert.equal(f.service.readyState('openrouter', 'ws', actor).error_code, 'credential_unreadable');
  } finally { f.close(); }
});

test('OpenRouter executes the exact reviewed prompt once with no native/file tools or hidden probes', async () => {
  const f = fixture();
  try {
    const { result, events } = await run(f);
    assert.equal(result.status, 'completed');
    assert.equal(result.text, 'Reviewed reply');
    assert.deepEqual(result.usage, { source: 'chat_completion', prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 });
    assert.equal(f.requests.length, 1);
    const { url, options } = f.requests[0];
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer sk-or-isolated-secret');
    assert.deepEqual(JSON.parse(options.body), { model: 'example/model', messages: [{ role: 'user', content: prompt }], max_tokens: 8192, stream: false });
    assert.equal(options.redirect, 'error');
    assert.deepEqual(events, [{ type: 'agent.message', summary: 'Reviewed reply', payload: { text: 'Reviewed reply' } }]);
    assert.ok(!JSON.stringify(result).includes('isolated-secret'));
  } finally { f.close(); }
});

test('configured Hugging Face executes through its router with current actor token', async () => {
  const f = fixture();
  try {
    const { result } = await run(f, { provider: 'huggingface' });
    assert.equal(result.status, 'completed');
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, 'https://router.huggingface.co/v1/chat/completions');
    assert.equal(f.requests[0].options.headers.Authorization, 'Bearer hf_isolated_token');
  } finally { f.close(); }
});

test('browser execution rejects missing model, invalid options, foreign actors and absent setup before HTTP', async () => {
  const f = fixture({ configured: false });
  try {
    for (const overrides of [{ model: '' }, { model: '../bad model' }, { provider: 'copilot' }, { prompt: '' }, { timeoutMs: 500 }, { actor: { id: 'b' } }, { workspaceId: 'other' }, { provider: 'huggingface' }, { signal: AbortSignal.abort() }]) await assert.rejects(f.service.startAgentRun({ ...request(), ...overrides }));
    assert.equal(f.service.readyState('huggingface', 'ws', actor).error_code, 'operator_setup_required');
    await f.service.disconnect('ws', actor);
    await assert.rejects(f.service.startAgentRun(request()), { code: 'not_connected' });
    assert.equal(f.requests.length, 0);
  } finally { f.close(); }
});

test('provider errors, unusable replies and truncated finals fail without retries or agent messages', async t => {
  const cases = [
    ['authorization', () => new Response('', { status: 401 }), 'reconnect_required'],
    ['rate limit', () => new Response('', { status: 429 }), 'rate_limited'],
    ['unreachable', () => { throw new Error('secret upstream detail'); }, 'provider_unreachable'],
    ['invalid JSON', () => new Response('not json'), 'provider_response'],
    ['oversize', () => new Response('{}', { headers: { 'content-length': '8000001' } }), 'provider_response_too_large'],
    ['provider error', () => Response.json({ error: { message: 'secret detail' } }), 'provider_error'],
    ['empty', () => Response.json({ choices: [{ message: { content: '' } }] }), 'model_response'],
    ['truncated', () => Response.json({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }), 'model_response_incomplete'],
    ['tool calls', () => Response.json({ choices: [{ message: { content: 'partial' }, finish_reason: 'tool_calls' }] }), 'model_response_incomplete'],
  ];
  for (const [name, response, code] of cases) await t.test(name, async () => {
    const f = fixture();
    try {
      f.response = response;
      const { result, events } = await run(f);
      assert.equal(result.status, 'failed'); assert.equal(result.error_code, code); assert.equal(result.text, '');
      assert.equal(events.length, 0); assert.equal(f.requests.length, 1);
      assert.ok(!JSON.stringify(result).includes('secret'));
    } finally { f.close(); }
  });
});

test('text parts are extracted but malformed usage is not invented or mislabeled as CLI/billing', async () => {
  const f = fixture();
  try {
    f.response = () => Response.json({ choices: [{ message: { content: [{ type: 'text', text: 'Actual' }, { type: 'image_url', image_url: 'ignored' }, { type: 'text', text: ' reply' }] } }], usage: { prompt_tokens: -1, completion_tokens: '5', total_tokens: Infinity, cost: 1 } });
    const { result } = await run(f);
    assert.equal(result.text, 'Actual reply');
    assert.equal(result.usage, undefined);
  } finally { f.close(); }
});

test('provider replies cannot expose the saved authorization token through callbacks', async () => {
  const f = fixture();
  try {
    f.response = () => Response.json({ choices: [{ message: { content: 'Echo sk-or-isolated-secret' } }] });
    const { result, events } = await run(f);
    assert.equal(result.text, 'Echo [redacted authorization]');
    assert.ok(!JSON.stringify({ result, events }).includes('sk-or-isolated-secret'));
  } finally { f.close(); }
});

test('stop and external abort settle once and ignore a later provider response', async t => {
  for (const external of [false, true]) await t.test(external ? 'external signal' : 'controller stop', async () => {
    const f = fixture();
    try {
      let release, entered, complete;
      const begun = new Promise(resolve => { entered = resolve; }), done = new Promise(resolve => { complete = resolve; });
      f.response = () => { entered(); return new Promise(resolve => { release = resolve; }); };
      const signal = new AbortController(), results = [], events = [];
      const controller = await f.service.startAgentRun({ ...request(), signal: signal.signal }, { onEvent: event => events.push(event), onComplete: result => { results.push(result); complete(result); } });
      await begun;
      if (external) signal.abort(); else controller.stop();
      assert.equal((await done).status, 'stopped');
      assert.equal(f.requests[0].options.signal.aborted, true);
      controller.stop();
      release(Response.json({ choices: [{ message: { content: 'Too late' } }] }));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(results.length, 1); assert.equal(events.length, 0); assert.equal(f.requests.length, 1);
    } finally { f.close(); }
  });
});

test('execution timeout settles failed once without a retry even if fetch ignores abort', async () => {
  const f = fixture();
  try {
    f.response = () => new Promise(() => {});
    const { result } = await run(f, { timeoutMs: 1000 });
    assert.equal(result.status, 'failed'); assert.equal(result.error_code, 'execution_timeout');
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].options.signal.aborted, true);
  } finally { f.close(); }
});

test('disconnect or workspace revocation before dispatch cannot use the old credential', async t => {
  for (const revoked of [false, true]) await t.test(revoked ? 'workspace access revoked' : 'disconnected', async () => {
    const f = fixture();
    try {
      let authorizeCount = 0, release;
      f.authorizeOverride = () => ++authorizeCount === 2 ? new Promise((resolve, reject) => { release = () => revoked ? reject(Object.assign(new Error('Denied'), { code: 'access_denied', statusCode: 403 })) : resolve(); }) : undefined;
      let complete;
      const done = new Promise(resolve => { complete = resolve; });
      await f.service.startAgentRun(request(), { onComplete: complete });
      if (!revoked) f.db.prepare("DELETE FROM ai_account_connections WHERE provider='openrouter'").run();
      release();
      const result = await done;
      assert.equal(result.status, 'failed');
      assert.equal(f.requests.length, 0);
    } finally { f.close(); }
  });
});

test('expired Hugging Face sessions require reconnect without refresh credentials', async () => {
  const f = fixture();
  try {
    f.saveCredential('huggingface', { access_token: 'expired', expires_at: Date.now() - 1 });
    assert.equal(f.service.readyState('huggingface', 'ws', actor).error_code, 'reconnect_required');
    const { result } = await run(f, { provider: 'huggingface' });
    assert.equal(result.error_code, 'reconnect_required');
    assert.equal(f.requests.length, 0);
  } finally { f.close(); }
});

test('Hugging Face refreshes an expired token once, then uses the new token for one completion', async () => {
  const f = fixture();
  try {
    f.saveCredential('huggingface', { access_token: 'expired', refresh_token: 'isolated-refresh', expires_at: Date.now() - 1 });
    assert.equal(f.service.readyState('huggingface', 'ws', actor).state, 'connected');
    assert.equal(f.requests.length, 0);
    f.response = url => url.endsWith('/oauth/token') ? Response.json({ access_token: 'hf_refreshed_token', expires_in: 3600 }) : Response.json({ choices: [{ message: { content: 'Done' } }] });
    const { result } = await run(f, { provider: 'huggingface' });
    assert.equal(result.status, 'completed');
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[0].url, 'https://huggingface.co/oauth/token');
    assert.equal(new URLSearchParams(f.requests[0].options.body).get('grant_type'), 'refresh_token');
    assert.equal(f.requests[1].options.headers.Authorization, 'Bearer hf_refreshed_token');
  } finally { f.close(); }
});

test('disconnect during Hugging Face refresh prevents completion and never restores the deleted connection', async () => {
  const f = fixture();
  try {
    f.saveCredential('huggingface', { access_token: 'expired', refresh_token: 'isolated-refresh', expires_at: Date.now() - 1 });
    f.response = () => {
      f.db.prepare("DELETE FROM ai_account_connections WHERE provider='huggingface'").run();
      return Response.json({ access_token: 'new-token', expires_in: 3600 });
    };
    const { result } = await run(f, { provider: 'huggingface' });
    assert.equal(result.status, 'failed');
    assert.equal(result.error_code, 'connection_changed');
    assert.equal(f.requests.length, 1);
    assert.equal(f.db.prepare("SELECT * FROM ai_account_connections WHERE provider='huggingface'").get(), undefined);
  } finally { f.close(); }
});

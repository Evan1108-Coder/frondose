import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { API_PROVIDERS } from '../src/lib/ai-provider-catalog.js';
import { createAiConnectionsService } from '../server/ai-connections-service.mjs';
import { apiKeyConfiguration, discoverApiModels, apiCompletionRequest, parseApiCompletion } from '../server/model-api-adapters.mjs';
import { createLocalApi } from '../server/local-api.mjs';

const actor = { id: 'owner' }, model = 'fixture/chat-model';
const config = provider => ({ api_key: `isolated-${provider.id}-secret`, model_ids: [model], ...(provider.workspaceRequired ? { provider_workspace: 'fixture' } : {}) });
function reply(provider, text) {
  if (['openai', 'perplexity'].includes(provider)) return { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 } };
  if (provider === 'anthropic') return { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 8, output_tokens: 2 } };
  if (provider === 'gemini') return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'PRIVATE_THOUGHT', thought: true }, { text }] } }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10 } };
  if (provider === 'cohere') return { finish_reason: 'COMPLETE', message: { content: [{ type: 'text', text }] }, usage: { tokens: { input_tokens: 8, output_tokens: 2 } } };
  return { choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } };
}
function catalog(provider) {
  if (provider === 'together') return [{ id: model, type: 'chat', display_name: 'Fixture chat' }, { id: 'embedding-model', type: 'embedding' }];
  if (provider === 'gemini') return { models: [{ name: `models/${model}`, supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }] };
  if (provider === 'cohere') return { models: [{ name: model, endpoints: ['chat'] }, { name: 'old-chat', endpoints: ['chat'], is_deprecated: true }] };
  return { data: [{ id: model, name: 'Fixture chat' }] };
}
const requestPrompt = body => body.input || body.messages?.[0]?.content || body.contents?.[0]?.parts?.[0]?.text;

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-api-keys-')), db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES ('ws'),('foreign');");
  const f = { requests: [], currentProvider: null, response: null };
  f.service = createAiConnectionsService({ db, dataDir: directory, env: {}, authorize: (workspace, who) => {
    if (workspace !== 'ws' || who.id !== actor.id) throw Object.assign(new Error('Denied'), { statusCode: 403 });
  }, fetchImpl: async (url, options) => {
    f.requests.push({ url, options });
    if (f.response) return f.response(url, options);
    return Response.json(options.method === 'POST' ? reply(f.currentProvider, 'OK') : catalog(f.currentProvider));
  } });
  f.db = db;
  f.close = () => { db.close(); rmSync(directory, { recursive: true, force: true }); };
  return f;
}

for (const provider of API_PROVIDERS) test(`${provider.name}: encrypted key, catalog, paid test, exact prompt execution and disconnect`, async () => {
  const f = fixture(); f.currentProvider = provider.id;
  try {
    const saved = await f.service.saveApiKey(provider.id, { workspace_id: 'ws', ...config(provider), ...(provider.discovery ? { model_ids: [] } : {}) }, actor);
    assert.equal(saved.method, 'api_key'); assert.equal(saved.state, 'configured'); assert.equal(f.requests.length, 0);
    assert.equal(f.service.readyState(provider.id, 'ws', actor).error_code, 'model_test_required');
    assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM ai_account_connections').get()).includes(config(provider).api_key));
    assert.ok(!JSON.stringify(await f.service.list('ws', actor)).includes(config(provider).api_key));
    const models = await f.service.connectionModels(provider.id, 'ws', actor);
    assert.deepEqual(models.map(item => item.id), [model]);
    await f.service.connectionCheck(provider.id, 'ws', actor);
    assert.equal(f.service.readyState(provider.id, 'ws', actor).state, 'not_connected', 'Catalog checks do not pretend inference succeeded');
    const tested = await f.service.connectionTest(provider.id, 'ws', model, actor);
    assert.equal(tested.reply, 'OK'); assert.equal(f.service.readyState(provider.id, 'ws', actor).state, 'connected');
    const before = f.requests.length, events = [];
    let finish;
    const completion = new Promise(resolve => { finish = resolve; });
    await f.service.startAgentRun({ provider: provider.id, workspaceId: 'ws', actor, model, prompt: 'EXACT_REVIEWED_PROMPT' }, { onEvent: event => events.push(event), onComplete: finish });
    const result = await completion;
    assert.equal(result.status, 'completed'); assert.equal(result.text, 'OK'); assert.ok(result.usage);
    assert.equal(f.requests.length, before + 1, 'No hidden probes or retries in a run');
    const sent = f.requests.at(-1); assert.equal(requestPrompt(JSON.parse(sent.options.body)), 'EXACT_REVIEWED_PROMPT');
    assert.equal(sent.options.redirect, 'error'); assert.equal(new URL(sent.url).protocol, 'https:');
    assert.equal(JSON.parse(sent.options.body).tools, undefined);
    assert.ok(!JSON.stringify({ result, events }).includes(config(provider).api_key));
    assert.equal(f.service.readyState(provider.id, 'ws', { id: 'other' }).state, 'not_connected');
    await assert.rejects(f.service.connectionModels(provider.id, 'foreign', actor), /Denied/);
    await f.service.connectionDisconnect(provider.id, 'ws', actor);
    assert.equal(f.service.readyState(provider.id, 'ws', actor).state, 'not_connected');
    assert.equal((await f.service.list('ws', actor))[provider.id], null);
  } finally { f.close(); }
});

test('native protocols use their actual endpoints, headers and request shapes', () => {
  const request = id => apiCompletionRequest(id, apiKeyConfiguration(id, { api_key: 'isolated-secret', model_ids: [model] }), model, 'prompt');
  assert.equal(request('openai').url, 'https://api.openai.com/v1/responses');
  assert.equal(request('perplexity').url, 'https://api.perplexity.ai/v1/agent');
  assert.equal(request('anthropic').options.headers['x-api-key'], 'isolated-secret');
  assert.equal(request('anthropic').options.headers['anthropic-version'], '2023-06-01');
  assert.equal(request('gemini').options.headers['x-goog-api-key'], 'isolated-secret');
  assert.equal(request('gemini').url, 'https://generativelanguage.googleapis.com/v1beta/models/fixture%2Fchat-model:generateContent');
  assert.equal(request('cohere').url, 'https://api.cohere.com/v2/chat');
  for (const [id, region, expected] of [['moonshot', 'china', 'https://api.moonshot.cn/v1/chat/completions'], ['zai', 'china', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'], ['qwen', 'singapore', 'https://fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions']]) {
    const options = apiKeyConfiguration(id, { api_key: 'isolated-secret', model_ids: [model], region, provider_workspace: 'fixture' });
    assert.equal(apiCompletionRequest(id, options, model, 'prompt').url, expected);
  }
});

test('explicit model IDs support restricted keys without requiring catalog permission', async () => {
  for (const provider of API_PROVIDERS) {
    let requests = 0;
    const models = await discoverApiModels(provider.id, apiKeyConfiguration(provider.id, config(provider)), () => { requests++; throw Error('Catalog permission denied'); });
    assert.equal(requests, 0); assert.equal(models[0].id, model); assert.equal(models[0].source, 'configured');
  }
});

test('bad credentials, endpoint injection and unconfigured model IDs fail before network access', async () => {
  const f = fixture(); f.currentProvider = 'openai';
  try {
    for (const input of [{ api_key: '' }, { api_key: 'secret\r\ninjected-header' }, { api_key: 'a'.repeat(8193) }, { api_key: 'isolated-secret', model_ids: ['../bad model'] }]) await assert.rejects(f.service.saveApiKey('openai', { workspace_id: 'ws', ...input }, actor));
    assert.throws(() => apiKeyConfiguration('qwen', { api_key: 'isolated-secret', model_ids: [model], provider_workspace: 'evil.com/' }));
    assert.throws(() => apiKeyConfiguration('zai', { api_key: 'isolated-secret', model_ids: [model], region: 'https://evil.test' }));
    assert.throws(() => apiKeyConfiguration('fireworks', { api_key: 'isolated-secret' }));
    await assert.rejects(f.service.saveApiKey('copilot', { workspace_id: 'ws', api_key: 'isolated-secret' }, actor));
    assert.equal(f.requests.length, 0);
    await f.service.saveApiKey('openai', { workspace_id: 'ws', ...config({ id: 'openai' }) }, actor);
    await assert.rejects(f.service.connectionTest('openai', 'ws', 'absent-model', actor), { code: 'model_unavailable' });
    assert.equal(f.requests.filter(item => item.options.method === 'POST').length, 0);
    f.response = () => new Response('do not expose upstream secrets', { status: 401 });
    await assert.rejects(f.service.connectionTest('openai', 'ws', model, actor), { code: 'reconnect_required' });
    assert.equal(f.service.readyState('openai', 'ws', actor).state, 'not_connected');
  } finally { f.close(); }
});

test('every response family rejects partial replies and redacts credentials', () => {
  for (const provider of API_PROVIDERS) {
    const secret = 'isolated-secret', response = reply(provider.id, `Reply ${secret}`);
    assert.equal(parseApiCompletion(provider.id, response, secret).text, 'Reply [redacted authorization]');
    if (['openai', 'perplexity'].includes(provider.id)) response.status = 'incomplete';
    else if (provider.id === 'anthropic') response.stop_reason = 'max_tokens';
    else if (provider.id === 'gemini') response.candidates[0].finishReason = 'MAX_TOKENS';
    else if (provider.id === 'cohere') response.finish_reason = 'MAX_TOKENS';
    else response.choices[0].finish_reason = 'length';
    assert.throws(() => parseApiCompletion(provider.id, response, secret), { code: 'model_response_incomplete' });
  }
});

test('rotating a key cancels pending OAuth and cannot inherit a previous successful test', async () => {
  const f = fixture(); f.currentProvider = 'openrouter';
  try {
    const start = await f.service.start({ workspace_id: 'ws' }, actor, '127.0.0.1:4174');
    const state = new URL(start.authorization_url).searchParams.get('callback_url').split('/').at(-1);
    await f.service.saveApiKey('openrouter', { workspace_id: 'ws', ...config({ id: 'openrouter' }) }, actor);
    await assert.rejects(f.service.complete(state, 'old-code', actor, '127.0.0.1:4174'), { code: 'oauth_expired' });
    await f.service.connectionTest('openrouter', 'ws', model, actor);
    await f.service.saveApiKey('openrouter', { workspace_id: 'ws', api_key: 'new-isolated-secret' }, actor);
    assert.equal(f.service.readyState('openrouter', 'ws', actor).error_code, 'model_test_required');
    assert.equal((await f.service.list('ws', actor)).openrouter.model_tested_at, null);
  } finally { f.close(); }
});

test('all 16 API connections work through HTTP, agent profiles, reviewed conversations and the real run ledger', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-api-vertical-'));
  let current, inferCount = 0, lastPrompt, clock = new Date();
  const api = createLocalApi({ dataDir: directory, scheduledWorkOptions: { now: () => clock, scheduleIntervalMs: 3600000 }, integrationOptions: { env: {}, fetchImpl: async (url, options) => {
    if (options.method !== 'POST') return Response.json(catalog(current));
    inferCount++;
    lastPrompt = requestPrompt(JSON.parse(options.body));
    const nonce = lastPrompt.match(/"nonce":"([^"]+)"/)?.[1];
    const text = nonce ? `Review this proposal.\n\`\`\`rumbo-actions\n${JSON.stringify({ nonce, actions: [{ type: 'record.create', resource: 'tasks', fields: { title: 'Proposed via API' } }] })}\n\`\`\`` : 'OK';
    return Response.json(reply(current, text));
  } } });
  const server = createServer(api.middleware), db = new DatabaseSync(api.dbPath);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); db.close(); rmSync(directory, { recursive: true, force: true }); });
  const call = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const parsed = await response.json(); assert.ok(response.ok, `${path}: ${JSON.stringify(parsed)}`); return parsed;
  };
  const workspace = (await call('/workspaces', { name: 'Isolated API fixture' })).workspace;
  for (const provider of API_PROVIDERS) await t.test(provider.name, async () => {
    current = provider.id;
    await call(`/ai-connections/${current}/api-key`, { workspace_id: workspace.id, ...config(provider) });
    await call(`/ai-connections/${current}/test`, { workspace_id: workspace.id, model });
    const snapshot = await call('/bootstrap');
    assert.equal(snapshot.connections.find(item => item.provider === current).workspace_states[workspace.id], 'connected');
    const agent = (await call('/agents', { workspace_id: workspace.id, provider: current, name: `Fixture ${current}`, model })).agent;
    assert.equal(agent.provider_connection_id, `conn_${current}`);
    const chat = (await call('/chats', { workspace_id: workspace.id, title: `Fixture ${current}` })).chat;
    const input = { workspace_id: workspace.id, agent_id: agent.id, chat_id: chat.id, prompt: 'Suggest a useful Route', model, work_mode: 'conversation', include_workspace: false, include_chat: false, include_memory: false };
    const preview = (await call('/context/inspect', input)).result, before = inferCount;
    await call(`/chats/${chat.id}/turns`, { ...input, content: input.prompt, context_inspection_id: preview.id, client_turn_id: `fixture-${current}` });
    let run;
    for (let i = 0; i < 100; i++) { run = db.prepare('SELECT * FROM runs WHERE chat_id=?').get(chat.id); if (run && ['completed', 'failed'].includes(run.status)) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(run?.status, 'completed', JSON.stringify(run)); assert.equal(inferCount, before + 1); assert.equal(lastPrompt, preview.finalPrompt);
    assert.equal(db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(workspace.id).n, 0, 'AI proposals never apply themselves');
    const actions = (await call(`/agent-actions?run_id=${run.id}`)).actions;
    assert.equal(actions.length, 1); assert.equal(actions[0].status, 'pending');
    assert.equal(db.prepare("SELECT count(*) n FROM messages WHERE chat_id=? AND sender_type='agent'").get(chat.id).n, 1);
  });
  await t.test('native OpenAI API scheduled prompt dispatches once and preserves review', async () => {
    current = 'openai';
    const agent = db.prepare("SELECT * FROM agents WHERE provider='openai' AND workspace_id=?").get(workspace.id);
    const chat = (await call('/chats', { workspace_id: workspace.id, title: 'Scheduled native API' })).chat;
    const input = { workspace_id: workspace.id, agent_id: agent.id, chat_id: chat.id, prompt: 'Suggest a scheduled Route', model, work_mode: 'conversation', include_workspace: false, include_chat: false, include_memory: false };
    const preview = (await call('/context/inspect', input)).result;
    const localTime = new Date(clock.getTime() + 120000).toISOString().slice(0, 16);
    const schedule = (await call('/scheduled-work', { workspace_id: workspace.id, kind: 'message', payload: { chat_id: chat.id, agent_id: agent.id, content: input.prompt, attachments: [] }, local_time: localTime, timezone: 'UTC', recurrence: 'none', request_id: 'native-api-scheduled-fixture', context_inspection_id: preview.id })).result;
    const before = inferCount; clock = new Date(`${localTime}:00.000Z`);
    await api.dispatchScheduledWork();
    let run;
    for (let i = 0; i < 100; i++) { run = db.prepare('SELECT * FROM runs WHERE chat_id=?').get(chat.id); if (run && ['completed', 'failed'].includes(run.status)) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    await api.dispatchScheduledWork();
    assert.equal(run?.status, 'completed'); assert.equal(inferCount, before + 1); assert.equal(lastPrompt, preview.finalPrompt);
    assert.equal((await call(`/scheduled-work/${schedule.id}`)).result.history[0].status, 'completed');
    assert.equal((await call(`/agent-actions?run_id=${run.id}`)).actions[0].status, 'pending');
    assert.equal(db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(workspace.id).n, 0);
  });
});

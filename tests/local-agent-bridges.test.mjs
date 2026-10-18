import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installAiConnections } from '../server/ai-connections-service.mjs';
import { createCopilotBridge } from '../server/copilot-bridge.mjs';
import { createAgentJsonlPeer } from '../server/agent-jsonl-peer.mjs';
import { startCodexAppServer } from '../server/codex-app-server.mjs';
import { createIntegrationService } from '../server/integration-service.mjs';
import { createLocalApi } from '../server/local-api.mjs';
import { createServer } from 'node:http';

const actor = { id: 'owner' };
const pause = () => new Promise(resolve => setImmediate(resolve));
function fakeChild(handler = () => {}) {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = signal => { child.killed = signal; setImmediate(() => child.emit('close', null)); return true; };
  let buffer = '';
  child.stdin.on('data', data => { buffer += data; let index; while ((index = buffer.indexOf('\n')) !== -1) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); handler(JSON.parse(line), child); } });
  child.send = value => child.stdout.write(`${JSON.stringify(value)}\n`);
  return child;
}
function fixture(t, behavior = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-agent-bridges-')), db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES ('ws'),('other');"); installAiConnections(db);
  const launches = [], requests = [], children = [];
  const spawnProcess = (command, args, options) => {
    const child = fakeChild((message, proc) => {
      requests.push(message);
      if (behavior.intercept?.(message, proc)) return;
      const result = message.method === 'initialize' ? { protocolVersion: 1, agentCapabilities: {} } : message.method === 'session/new' ? { sessionId: 'native-session', models: { availableModels: [{ modelId: 'fixture-model', name: 'Fixture model' }] } } : message.method === 'session/prompt' ? { stopReason: 'end_turn' } : {};
      if (message.method === 'session/prompt') {
        proc.send({ method: 'session/update', params: { sessionId: 'foreign', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'FOREIGN' } } } });
        proc.send({ method: 'session/update', params: { sessionId: 'native-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: behavior.reply ?? 'OK' } } } });
      }
      if (message.id !== undefined) proc.send({ id: message.id, result });
    });
    launches.push({ command, args, options }); children.push(child); return child;
  };
  const service = createCopilotBridge({ db, dataDir: directory, env: { PATH: '/fixture', HOME: '/fixture-home', COPILOT_ALLOW_ALL: '1', GITHUB_TOKEN: 'PRIVATE_GITHUB_TOKEN', OPENAI_API_KEY: 'PRIVATE_OPENAI_KEY', RUMBO_NATIVE_TOOL_CAPABILITY: 'PRIVATE_BRIDGE' }, spawnProcess, authorize: (workspace, who) => { if (who.id === 'denied') throw Object.assign(new Error('Denied'), { statusCode: 403 }); } });
  t.after(async () => { service.close(); await pause(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  return { service, db, directory, requests, launches, children };
}
const completed = async (service, input = {}) => {
  let resolve; const result = new Promise(done => { resolve = done; });
  const controller = await service.startRun({ workspaceId: 'ws', actor, prompt: 'EXACT_REVIEWED_CONTEXT', ...input }, { onComplete: resolve });
  return { controller, result };
};

test('Copilot: check is not verification, models are discovered, explicit inference verifies, and exact text is delivered once', async t => {
  const f = fixture(t);
  assert.equal(f.service.status('ws', actor).state, 'not_connected'); assert.equal(f.launches.length, 0);
  assert.equal((await f.service.check('ws', actor)).state, 'configured');
  assert.equal(f.requests.filter(item => item.method === 'session/prompt').length, 0);
  assert.deepEqual(await f.service.models('ws', actor), [{ id: 'fixture-model', name: 'Fixture model' }]);
  assert.equal((await f.service.test('ws', actor, 'fixture-model')).state, 'connected');
  const { result } = await completed(f.service, { model: 'fixture-model' });
  assert.equal((await result).text, 'OK');
  assert.equal(f.requests.filter(item => item.method === 'session/prompt').length, 2);
  assert.deepEqual(f.requests.at(-1).params.prompt, [{ type: 'text', text: 'EXACT_REVIEWED_CONTEXT' }]);
  const initialize = f.requests.find(item => item.method === 'initialize');
  assert.equal(initialize.params.clientCapabilities.terminal, false); assert.equal(initialize.params.clientCapabilities.fs.readTextFile, false);
  for (const launch of f.launches) {
    assert.equal(launch.command, 'copilot'); assert.equal(launch.options.shell, false);
    assert.ok(launch.args.includes('--available-tools=')); assert.ok(launch.args.includes('--deny-tool=read,write,shell,url,memory'));
    for (const name of ['COPILOT_ALLOW_ALL', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'RUMBO_NATIVE_TOOL_CAPABILITY']) assert.equal(launch.options.env[name], undefined);
    assert.notEqual(launch.options.cwd, f.directory); assert.ok(launch.options.cwd.includes('rumbo-copilot-'));
  }
  await pause();
  assert.ok(f.launches.every(item => !existsSync(item.options.cwd)));
});

test('Copilot identities and provider homes are isolated by actor AND workspace', async t => {
  const f = fixture(t);
  await f.service.test('ws', actor);
  assert.equal(f.service.status('ws', { id: 'second' }).state, 'not_connected');
  assert.equal(f.service.status('other', actor).state, 'not_connected');
  await f.service.check('other', actor); await f.service.check('ws', { id: 'second' });
  assert.equal(new Set(f.launches.map(item => item.options.env.COPILOT_HOME)).size, 3);
  assert.throws(() => f.service.status('ws', { id: 'denied' }), /Denied/);
  assert.throws(() => f.service.status('../bad', actor), /available workspace/);
});

for (const [name, input] of Object.entries({ project: { workMode: 'project' }, folder: { cwd: '/tmp' }, writes: { permissionMode: 'workspace-write' }, native: { nativeToolBridge: {} }, reasoning: { reasoningEffort: 'high' }, timeout: { timeoutMs: 999 }, injection: { model: '--unsafe' }, empty: { prompt: '' } })) test(`Copilot rejects ${name} before starting a process`, async t => {
  const f = fixture(t);
  await assert.rejects(f.service.startRun({ workspaceId: 'ws', actor, prompt: 'test', verification: true, ...input }));
  assert.equal(f.launches.length, 0);
});

for (const [name, behavior] of Object.entries({ empty: { reply: '' }, refusal: { intercept: (message, child) => { if (message.method !== 'session/prompt') return false; child.send({ id: message.id, error: { code: -32000, message: 'Model unavailable' } }); return true; } }, malformed: { intercept: (message, child) => { if (message.method !== 'initialize') return false; child.stdout.write('not JSON\n'); return true; } }, protocol: { intercept: (message, child) => { if (message.method !== 'initialize') return false; child.send({ id: message.id, result: { protocolVersion: 99 } }); return true; } } })) test(`Copilot ${name} cannot certify a connection or silently retry`, async t => {
  const f = fixture(t, behavior);
  await assert.rejects(f.service.test('ws', actor));
  assert.notEqual(f.service.status('ws', actor).state, 'connected');
  assert.ok(f.requests.filter(item => item.method === 'session/prompt').length <= 1);
});

test('Copilot denies provider permission/file/shell requests and excludes thinking from final reply', async t => {
  const f = fixture(t, { intercept: (message, child) => {
    if (message.method === 'session/prompt') {
      child.send({ id: 'permission', method: 'session/request_permission', params: { options: [{ kind: 'allow_always', optionId: 'unsafe' }] } });
      child.send({ id: 'file', method: 'fs/read_text_file', params: { path: '/private' } });
      child.send({ id: 'terminal', method: 'terminal/create', params: { command: 'bad' } });
      child.send({ method: 'session/update', params: { sessionId: 'native-session', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'PRIVATE_THOUGHT' } } } });
    }
    return message.method === undefined;
  } });
  await f.service.test('ws', actor); await pause();
  const permission = f.requests.find(item => item.id === 'permission' && item.result);
  assert.deepEqual(permission.result, { outcome: { outcome: 'cancelled' } });
  assert.equal(f.requests.find(item => item.id === 'file' && item.error).error.code, -32601);
  assert.equal(f.requests.find(item => item.id === 'terminal' && item.error).error.code, -32601);
});

test('Copilot cancellation during initialization and disconnect during verification do not resurrect readiness', async t => {
  let held;
  const f = fixture(t, { intercept: (message, child) => { if (message.method !== 'initialize') return false; held = [message, child]; return true; } });
  const pending = await completed(f.service, { verification: true }); pending.controller.stop();
  assert.equal((await pending.result).status, 'stopped');
  const verification = f.service.test('ws', actor); await pause();
  f.service.disconnect('ws', actor);
  held[1].send({ id: held[0].id, result: { protocolVersion: 1 } });
  await assert.rejects(verification, /changed/);
  assert.equal(f.service.status('ws', actor).state, 'not_connected');
});

test('Copilot deadline covers handshake, not just inference', async t => {
  const f = fixture(t, { intercept: () => true });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = await completed(f.service, { verification: true, timeoutMs: 1000 });
  t.mock.timers.tick(1000);
  assert.equal((await pending.result).error_code, 'run_timeout');
});

test('Copilot bounds concurrent runtime probes and close cancels their outstanding handshakes', async t => {
  const f = fixture(t, { intercept: () => true });
  const first = f.service.check('ws', actor), second = f.service.check('ws', actor);
  await assert.rejects(f.service.check('ws', actor), { code: 'runtime_busy' });
  assert.equal(f.launches.length, 2);
  const settled = Promise.allSettled([first, second]);
  f.service.close(); assert.ok((await settled).every(item => item.status === 'rejected'));
});

test('Copilot sign-in starts only on explicit activation; disconnect cancels sign-in and ignores late success', async t => {
  const f = fixture(t); f.service.login('ws', actor);
  assert.deepEqual(f.launches[0].args, ['login', '--device-code', '--no-auto-update']);
  assert.equal(f.service.status('ws', actor).auth.status, 'running');
  f.children[0].stdout.write('Open github.com/login/device and use ABCD-EFGH');
  assert.match(f.service.status('ws', actor).auth.output, /ABCD/);
  f.service.disconnect('ws', actor); f.children[0].emit('close', 0);
  assert.equal(f.service.status('ws', actor).state, 'not_connected');
});

test('JSONL peer correlates out-of-order responses and preserves split UTF-8 and Unicode line separators', async () => {
  const child = fakeChild(), events = [], peer = createAgentJsonlPeer(child, { onNotification: event => events.push(event) });
  const first = peer.request('one'), second = peer.request('two');
  child.send({ id: 2, result: { order: 2 } }); child.send({ id: 1, result: { order: 1 } });
  assert.equal((await first).order, 1); assert.equal((await second).order, 2);
  const value = Buffer.from(JSON.stringify({ method: 'unicode', params: '界\u2028☀' }) + '\n');
  for (const byte of value) child.stdout.write(Buffer.from([byte]));
  assert.equal(events[0].params, '界\u2028☀'); peer.dispose();
});

for (const mode of ['exit', 'malformed', 'oversize', 'missing']) test(`JSONL ${mode} fails outstanding calls without retries`, async () => {
  const child = fakeChild(), peer = createAgentJsonlPeer(child);
  const pending = peer.request('hello');
  if (mode === 'exit') child.emit('close', 1);
  if (mode === 'malformed') child.stdout.write('broken\n');
  if (mode === 'oversize') child.stdout.write('x'.repeat(2_000_001));
  if (mode === 'missing') child.emit('error', { code: 'ENOENT' });
  await assert.rejects(pending); peer.dispose();
});

function codexChild({ status = 'completed', empty = false, onRequest = () => {} } = {}) {
  return fakeChild((request, child) => {
    onRequest(request);
    const result = request.method === 'thread/start' ? { thread: { id: 'thread' } } : request.method === 'turn/start' ? { turn: { id: 'turn' } } : {};
    if (request.id !== undefined) child.send({ id: request.id, result });
    if (request.method === 'turn/start') {
      if (!empty) child.send({ method: 'item/completed', params: { threadId: 'thread', item: { id: 'item', type: 'agentMessage', text: 'Native reply' } } });
      child.send({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status } } });
    }
  });
}
for (const status of ['completed', 'failed', 'interrupted']) test(`Codex app-server handshake and ${status} outcome`, async () => {
  const requests = [], child = codexChild({ status, onRequest: message => requests.push(message) });
  let resolve; const done = new Promise(finish => { resolve = finish; });
  startCodexAppServer({ child, cwd: '/fixture', prompt: 'REVIEWED', model: 'fixture', permissionMode: 'read-only', timeoutMs: 10000 }, { onComplete: resolve });
  const result = await done;
  assert.equal(result.status, status === 'interrupted' ? 'stopped' : status);
  assert.deepEqual(requests.map(item => item.method), ['initialize', 'initialized', 'thread/start', 'turn/start']);
  assert.equal(requests[2].params.ephemeral, true); assert.equal(requests[2].params.approvalPolicy, 'never');
  assert.deepEqual(requests[3].params.input, [{ type: 'text', text: 'REVIEWED' }]);
});

test('Codex bridge selection persists and does not alter the existing CLI fallback', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-codex-bridge-')); const launches = [];
  const service = createIntegrationService({ dataDir: directory, env: {}, execute: async (_cmd, args) => ({ code: 0, stdout: args.includes('mcp') ? '[]' : 'Logged in' }), spawnProcess: (command, args, options) => { launches.push({ command, args, options }); return codexChild(); } });
  t.after(() => { service.close(); rmSync(directory, { recursive: true, force: true }); });
  await service.connect('codex', { method: 'app_server' });
  let resolve; const result = new Promise(done => { resolve = done; });
  await service.startRun({ provider: 'codex', prompt: 'EXACT', workMode: 'conversation' }, { onComplete: resolve });
  assert.equal((await result).status, 'completed');
  assert.ok(launches[0].args.includes('app-server')); assert.ok(launches[0].args.includes('features.shell_tool=false'));
  assert.equal(launches[0].options.shell, false);
});

test('Codex app-server records one cumulative terminal usage report; metering failure does not invent completion failure', async () => {
  for (const brokenMeter of [false, true]) {
    const reports = [];
    const child = fakeChild((request, proc) => {
      if (request.id !== undefined) proc.send({ id: request.id, result: request.method === 'thread/start' ? { thread: { id: 'thread' } } : request.method === 'turn/start' ? { turn: { id: 'turn' } } : {} });
      if (request.method !== 'turn/start') return;
      for (const amount of [10, 20]) proc.send({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', tokenUsage: { total: { inputTokens: amount, cachedInputTokens: 1, outputTokens: 2, reasoningOutputTokens: 0 } } } });
      proc.send({ method: 'item/completed', params: { threadId: 'thread', item: { id: 'final', type: 'agentMessage', text: 'Answer' } } });
      proc.send({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } });
    });
    let resolve; const done = new Promise(finish => { resolve = finish; });
    startCodexAppServer({ child, cwd: '/fixture', prompt: 'EXACT', permissionMode: 'read-only', timeoutMs: 1000 }, { onUsageReport: report => { reports.push(report); if (brokenMeter) throw Error('Meter unavailable'); }, onComplete: resolve });
    const result = await done;
    assert.equal(result.status, 'completed'); assert.equal(reports.length, 1); assert.equal(reports[0].main.input_tokens, 20);
    assert.equal(Boolean(result.usage_capture_incomplete), brokenMeter);
  }
});

test('Copilot model config options use the advertised config ID, never silently switch providers or models', async t => {
  const f = fixture(t, { intercept: (request, child) => {
    if (request.method !== 'session/new') return false;
    child.send({ id: request.id, result: { sessionId: 'native-session', configOptions: [{ id: 'model-choice', type: 'select', category: 'model', options: [{ group: 'group', options: [{ name: 'Configured model', value: 'model-v2' }] }] }] } }); return true;
  } });
  assert.deepEqual(await f.service.models('ws', actor), [{ id: 'model-v2', name: 'Configured model' }]);
  await f.service.test('ws', actor, 'model-v2');
  assert.deepEqual(f.requests.find(item => item.method === 'session/set_config_option').params, { sessionId: 'native-session', configId: 'model-choice', value: 'model-v2' });
  assert.equal(f.requests.some(item => item.method === 'session/set_model'), false);
});

test('Copilot HTTP vertical slice: verified account → profile → context review → one chat reply → pending action; scheduled prompts dispatch once', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-copilot-http-'));
  let promptCount = 0, lastPrompt, clock = new Date();
  const api = createLocalApi({ dataDir: directory, scheduledWorkOptions: { now: () => clock, scheduleIntervalMs: 3600000 }, integrationOptions: { env: {}, fetchImpl: () => { throw Error('No network in provider fixtures'); }, execute: () => { throw Error('No real CLI in provider fixtures'); }, spawnProcess: (command, args) => {
    assert.equal(command, 'copilot'); assert.ok(args.includes('--acp'));
    return fakeChild((request, child) => {
      let result = {};
      if (request.method === 'initialize') result = { protocolVersion: 1 };
      if (request.method === 'session/new') result = { sessionId: 'session', models: { availableModels: [{ modelId: 'fixture-model', name: 'Fixture' }] } };
      if (request.method === 'session/prompt') {
        promptCount++; lastPrompt = request.params.prompt[0].text;
        const nonce = lastPrompt.match(/"nonce":"([^"]+)"/)?.[1];
        const text = nonce ? `Please review.\n\`\`\`rumbo-actions\n${JSON.stringify({ nonce, actions: [{ type: 'record.create', resource: 'tasks', fields: { title: 'Proposed through ACP' } }] })}\n\`\`\`` : 'OK';
        child.send({ method: 'session/update', params: { sessionId: 'session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
        result = { stopReason: 'end_turn' };
      }
      if (request.id !== undefined) child.send({ id: request.id, result });
    });
  } } });
  const db = new DatabaseSync(api.dbPath), server = createServer(api.middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { api.close(); await pause(); await new Promise(resolve => server.close(resolve)); db.close(); rmSync(directory, { recursive: true, force: true }); });
  const call = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(); assert.ok(response.ok, `${path}: ${JSON.stringify(data)}`); return data;
  };
  const ws = (await call('/workspaces', { name: 'Isolated ACP' })).workspace;
  assert.equal((await call(`/ai-connections?workspace_id=${ws.id}`)).result.copilot.state, 'not_connected');
  await call('/ai-connections/copilot/check', { workspace_id: ws.id }); assert.equal(promptCount, 0);
  await call('/ai-connections/copilot/test', { workspace_id: ws.id, model: 'fixture-model' });
  assert.equal((await call('/bootstrap')).connections.find(item => item.provider === 'copilot').workspace_states[ws.id], 'connected');
  const agent = (await call('/agents', { workspace_id: ws.id, provider: 'copilot', name: 'ACP fixture', model: 'fixture-model' })).agent;
  assert.equal(agent.provider_connection_id, 'conn_copilot');
  const chat = (await call('/chats', { workspace_id: ws.id, title: 'ACP fixture' })).chat;
  const input = { workspace_id: ws.id, agent_id: agent.id, chat_id: chat.id, prompt: 'Propose a Route', model: 'fixture-model', work_mode: 'conversation', include_workspace: false, include_chat: false, include_memory: false };
  const preview = (await call('/context/inspect', input)).result, before = promptCount;
  await call(`/chats/${chat.id}/turns`, { ...input, content: input.prompt, context_inspection_id: preview.id, client_turn_id: 'acp-http-fixture' });
  const waitRun = async chatId => { for (let attempt = 0; attempt < 100; attempt++) { const run = db.prepare('SELECT * FROM runs WHERE chat_id=? ORDER BY created_at DESC').get(chatId); if (run && ['completed', 'failed'].includes(run.status)) return run; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Run did not settle'); };
  const run = await waitRun(chat.id);
  assert.equal(run.status, 'completed', JSON.stringify(run)); assert.equal(lastPrompt, preview.finalPrompt); assert.equal(promptCount, before + 1);
  assert.equal((await call(`/agent-actions?run_id=${run.id}`)).actions[0].status, 'pending');
  assert.equal(db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(ws.id).n, 0);
  const scheduledChat = (await call('/chats', { workspace_id: ws.id, title: 'Scheduled ACP' })).chat;
  const scheduledInput = { ...input, chat_id: scheduledChat.id };
  const reviewed = (await call('/context/inspect', scheduledInput)).result;
  const localTime = new Date(clock.getTime() + 120000).toISOString().slice(0, 16);
  await call('/scheduled-work', { workspace_id: ws.id, kind: 'message', payload: { chat_id: scheduledChat.id, agent_id: agent.id, content: input.prompt, attachments: [] }, local_time: localTime, timezone: 'UTC', recurrence: 'none', request_id: 'acp-schedule-fixture', context_inspection_id: reviewed.id });
  clock = new Date(`${localTime}:00.000Z`); const beforeSchedule = promptCount;
  await api.dispatchScheduledWork();
  assert.equal((await waitRun(scheduledChat.id)).status, 'completed');
  await api.dispatchScheduledWork(); assert.equal(promptCount, beforeSchedule + 1); assert.equal(lastPrompt, reviewed.finalPrompt);
  await call('/ai-connections/copilot/disconnect', { workspace_id: ws.id });
  assert.equal((await call('/bootstrap')).connections.find(item => item.provider === 'copilot').workspace_states[ws.id], 'not_connected');
});

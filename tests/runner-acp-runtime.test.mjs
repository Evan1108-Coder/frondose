import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { runAcpSession, createLocalRunnerEnvironment } from '../server/runner-acp-runtime.mjs';

const base = { command: '/fixture/agent', cwd: '/fixture/project', prompt: 'Hello', localOwnerApproved: true, providerId: 'fixture-acp', sessionId: 'canonical', timeoutMs: 1000, platform: 'darwin', env: { PATH: '/bin', HOME: '/fixture/home' } };

function fixture({ initialize = {}, created = {}, onPrompt, onRequest } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kills = [];
  child.kill = signal => { child.kills.push(signal); queueMicrotask(() => child.emit('close', null)); return true; };
  const requests = [], replies = [];
  const write = message => child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  let input = '';
  child.stdin = new Writable({ write(chunk, _, done) {
    input += chunk.toString(); const lines = input.split('\n'); input = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line);
      if (!message.method) { replies.push(message); continue; }
      requests.push(message);
      queueMicrotask(() => {
        if (onRequest?.(message, write, child) === false) return;
        if (message.method === 'initialize') write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, ...initialize } });
        if (message.method === 'session/new') write({ id: message.id, result: { sessionId: 'native-session', ...created } });
        if (message.method === 'session/set_model' || message.method === 'session/set_config_option') write({ id: message.id, result: {} });
        if (message.method === 'session/prompt') {
          if (onPrompt) onPrompt(message, write, child);
          else {
            write({ method: 'session/update', params: { sessionId: 'native-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello 👋' } } } });
            write({ id: message.id, result: { stopReason: 'end_turn' } });
          }
        }
      });
    }
    done();
  } });
  return { child, requests, replies, write, spawnProcess: () => child };
}

test('explicit local owner approval is required before any process launch', async () => {
  let launched = false;
  await assert.rejects(runAcpSession({ ...base, localOwnerApproved: false, spawnProcess: () => { launched = true; } }), { code: 'runner_owner_approval_required' });
  assert.equal(launched, false);
});

test('ACP negotiates v1, creates fresh session and sends exactly one explicit text prompt', async () => {
  const fake = fixture(), events = [];
  const result = await runAcpSession({ ...base, spawnProcess: fake.spawnProcess, emit: event => events.push(event) });
  assert.deepEqual(fake.requests.map(request => request.method), ['initialize', 'session/new', 'session/prompt']);
  assert.deepEqual(fake.requests[0].params.clientCapabilities, { fs: { readTextFile: false, writeTextFile: false }, terminal: false });
  assert.deepEqual(fake.requests[1].params, { cwd: '/fixture/project', mcpServers: [] });
  assert.deepEqual(fake.requests[2].params.prompt, [{ type: 'text', text: 'Hello' }]);
  assert.deepEqual(result, { text: 'Hello 👋', providerSessionId: 'native-session', stopReason: 'end_turn' });
  assert.ok(events.every(event => event.schema === 'frondose.runner-event' && event.authority === 'observed-only' && event.sessionId === 'canonical'));
  assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
  assert.ok(fake.child.kills.includes('SIGTERM'));
});

test('ACP provider requests are recorded but files, terminals and permissions are never granted', async () => {
  const fake = fixture({ onPrompt(message, write) {
    write({ id: 90, method: 'session/request_permission', params: { sessionId: 'native-session', toolCall: { toolCallId: 'call', title: 'Run' }, options: [{ optionId: 'yes', kind: 'allow_always' }] } });
    write({ id: 91, method: 'fs/read_text_file', params: { sessionId: 'native-session', path: '/private/secret' } });
    write({ id: 92, method: 'terminal/create', params: { sessionId: 'native-session', command: 'sh' } });
    setTimeout(() => write({ id: message.id, result: { stopReason: 'end_turn' } }), 10);
  } });
  const events = [];
  await runAcpSession({ ...base, spawnProcess: fake.spawnProcess, emit: event => events.push(event) });
  assert.deepEqual(fake.replies.find(reply => reply.id === 90).result, { outcome: { outcome: 'cancelled' } });
  assert.equal(fake.replies.find(reply => reply.id === 91).error.code, -32601);
  assert.equal(fake.replies.find(reply => reply.id === 92).error.code, -32601);
  assert.equal(events.filter(event => event.kind === 'approval').length, 1);
});

test('foreign session updates and permissions cannot leak into this execution', async () => {
  const fake = fixture({ onPrompt(message, write) {
    write({ method: 'session/update', params: { sessionId: 'foreign', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Foreign private text' } } } });
    write({ id: 90, method: 'session/request_permission', params: { sessionId: 'foreign', toolCall: { title: 'Foreign private title' } } });
    setTimeout(() => write({ id: message.id, result: { stopReason: 'end_turn' } }), 10);
  } });
  const events = [];
  const result = await runAcpSession({ ...base, spawnProcess: fake.spawnProcess, emit: event => events.push(event) });
  assert.equal(result.text, ''); assert.doesNotMatch(JSON.stringify(events), /Foreign/);
  assert.equal(fake.replies.find(reply => reply.id === 90).error.code, -32602);
});

test('legacy ACP model list is checked before selecting a model', async () => {
  const fake = fixture({ created: { models: { availableModels: [{ modelId: 'available', name: 'Available' }] } } });
  await runAcpSession({ ...base, model: 'available', spawnProcess: fake.spawnProcess });
  assert.deepEqual(fake.requests.find(message => message.method === 'session/set_model').params, { sessionId: 'native-session', modelId: 'available' });
  const absent = fixture();
  await assert.rejects(runAcpSession({ ...base, model: 'unadvertised', spawnProcess: absent.spawnProcess }), { code: 'runner_model_unavailable' });
  assert.equal(absent.requests.some(request => request.method === 'session/prompt'), false);
});

test('new ACP model config options are supported without claiming entitlement', async () => {
  const fake = fixture({ created: { configOptions: [{ id: 'model-choice', category: 'model', type: 'select', options: [{ name: 'Group', options: [{ value: 'available', name: 'Available' }] }] }] } });
  await runAcpSession({ ...base, model: 'available', spawnProcess: fake.spawnProcess });
  assert.deepEqual(fake.requests.find(request => request.method === 'session/set_config_option').params, { sessionId: 'native-session', configId: 'model-choice', value: 'available' });
});

test('unsupported protocol and malformed session fail before model inference', async () => {
  for (const [config, code] of [[{ initialize: { protocolVersion: 2 } }, 'unsupported_protocol'], [{ created: { sessionId: '' } }, 'runtime_protocol']]) {
    const fake = fixture(config);
    await assert.rejects(runAcpSession({ ...base, spawnProcess: fake.spawnProcess }), { code });
    assert.equal(fake.requests.some(request => request.method === 'session/prompt'), false);
  }
});

test('abort before launch does not start a process', async () => {
  const controller = new AbortController(); controller.abort(); let launched = false;
  await assert.rejects(runAcpSession({ ...base, signal: controller.signal, spawnProcess: () => { launched = true; } }), { code: 'session_cancelled' });
  assert.equal(launched, false);
});

test('abort during a prompt sends cancel, returns partial text and kills child', async () => {
  const controller = new AbortController();
  const fake = fixture({ onPrompt(_message, write) {
    write({ method: 'session/update', params: { sessionId: 'native-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Partial' } } } });
    setTimeout(() => controller.abort(), 5);
  } });
  const result = await runAcpSession({ ...base, signal: controller.signal, spawnProcess: fake.spawnProcess });
  assert.equal(result.stopReason, 'cancelled'); assert.equal(result.text, 'Partial');
  assert.equal(fake.requests.filter(message => message.method === 'session/cancel').length, 1);
  assert.equal(fake.requests.filter(message => message.method === 'session/prompt').length, 1);
});

test('deadline fails without retry and terminates hanging child', async () => {
  const fake = fixture({ onPrompt() {} });
  await assert.rejects(runAcpSession({ ...base, timeoutMs: 20, spawnProcess: fake.spawnProcess }), { code: 'run_timeout' });
  assert.equal(fake.requests.filter(message => message.method === 'session/prompt').length, 1);
  assert.ok(fake.child.kills.includes('SIGTERM'));
});

test('protocol corruption and premature exit fail honestly', async () => {
  const invalid = fixture({ onPrompt(_message, _write, child) { child.stdout.write('not json\n'); } });
  await assert.rejects(runAcpSession({ ...base, spawnProcess: invalid.spawnProcess }), { code: 'runtime_protocol' });
  const exited = fixture({ onPrompt(_message, _write, child) { child.emit('close', 1); } });
  await assert.rejects(runAcpSession({ ...base, spawnProcess: exited.spawnProcess }), { code: 'runtime_exited' });
});

test('provider errors and canonical output redact credentials', async () => {
  const fake = fixture({ onRequest(message, write) {
    if (message.method !== 'session/new') return;
    write({ id: message.id, error: { code: -32000, message: 'Bearer bad_token hf_12345678901234567890' } });
    return false;
  } });
  const events = [];
  await assert.rejects(runAcpSession({ ...base, spawnProcess: fake.spawnProcess, emit: event => events.push(event) }), error => { assert.doesNotMatch(error.message, /bad_token|hf_123/); return true; });
  assert.doesNotMatch(JSON.stringify(events), /bad_token|hf_123/);
});

test('local auth homes and OS setup survive but server/provider secrets do not', async () => {
  const source = { Path: 'C:\\bin', USERPROFILE: 'C:\\Users\\Test', APPDATA: 'C:\\Users\\Test\\AppData', SystemRoot: 'C:\\Windows', ANTHROPIC_API_KEY: 'no', OPENAI_API_KEY: 'no', GITHUB_TOKEN: 'no', FRONDOSE_GITHUB_CLIENT_SECRET: 'no', NODE_OPTIONS: '--require=malicious', BASH_ENV: '/private/script', SSL_CERT_FILE: '/fixture/cert', NO_COLOR: '0' };
  const env = createLocalRunnerEnvironment(source);
  assert.equal(env.Path, source.Path); assert.equal(env.USERPROFILE, source.USERPROFILE); assert.equal(env.APPDATA, source.APPDATA);
  assert.equal(env.SSL_CERT_FILE, source.SSL_CERT_FILE); assert.equal(env.NO_COLOR, '1');
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'FRONDOSE_GITHUB_CLIENT_SECRET', 'NODE_OPTIONS', 'BASH_ENV']) assert.equal(key in env, false);
  const fake = fixture(); let launch;
  await runAcpSession({ ...base, command: 'C:\\bin\\agent.cmd', cwd: 'C:\\project', platform: 'win32', env: source, spawnProcess: (command, args, options) => { launch = { command, args, options }; return fake.child; } });
  assert.equal(launch.options.platform, 'win32'); assert.equal(launch.options.env.FRONDOSE_GITHUB_CLIENT_SECRET, undefined);
});

test('Windows package shims need separate approval and arbitrary shell syntax stays blocked', async () => {
  let launched = false;
  await assert.rejects(runAcpSession({ ...base, command: 'C:\\bin\\npx.cmd', cwd: 'C:\\project', platform: 'win32', spawnProcess: () => { launched = true; } }), { code: 'runner_package_approval_required' });
  assert.equal(launched, false);
  await assert.rejects(runAcpSession({ ...base, command: 'C:\\bin\\agent.cmd', cwd: 'C:\\project', platform: 'win32', args: ['hello & whoami'], spawnProcess: () => { launched = true; } }), /Unsafe Windows batch argument/);
  assert.equal(launched, false);
});

test('native launch receives prompts through protocol rather than argv', async () => {
  const fake = fixture(); let launch;
  await runAcpSession({ ...base, prompt: 'hello\n$(whoami) & x', spawnProcess: (command, args, options) => { launch = { command, args, options }; return fake.child; } });
  assert.deepEqual(launch.args, []); assert.equal(fake.requests.find(message => message.method === 'session/prompt').params.prompt[0].text, 'hello\n$(whoami) & x');
});

test('provider output and event budgets fail rather than silently retry', async () => {
  const fake = fixture({ onPrompt(_message, write) {
    for (let index = 0; index < 8; index++) write({ method: 'session/update', params: { sessionId: 'native-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x'.repeat(16_000) } } } });
  } });
  await assert.rejects(runAcpSession({ ...base, spawnProcess: fake.spawnProcess }), { code: 'runtime_output_limit' });
  assert.equal(fake.requests.filter(message => message.method === 'session/prompt').length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executeRunnerRequest, requiresNativeTools, runnerRuntimeCapabilities } from '../server/runner-runtime.mjs';
import { sanitizeRunnerReply } from '../server/runner-events.mjs';
import { RUNNER_PROVIDER_CATALOG } from '../src/lib/runner-provider-catalog.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'frondose-runtime-'));
for (const name of new Set(RUNNER_PROVIDER_CATALOG.map(p => p.launchTemplate[0]))) {
  const target = path.join(directory, name + (process.platform === 'win32' ? '.exe' : ''));
  await writeFile(target, 'fixture-not-executed'); await chmod(target, 0o700);
}
test.after(() => rm(directory, { recursive: true, force: true }));
const base = { cwd: directory, prompt: 'Reply 👋', localOwnerApproved: true, nativeToolsApproved: true, permissionMode: 'workspace-write', packageExecutionApproved: true, timeoutMs: 1000, env: { PATH: directory, PATHEXT: '.EXE', HOME: directory, SystemRoot: process.env.SystemRoot }, sessionId: 'canonical', workspaceId: 'workspace', actorId: 'actor' };

function fixture(providerId, { stalled = false, corrupt = false, foreign = false, fail = false, requestApproval = false } = {}) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kills = [];
  child.kill = signal => { child.kills.push(signal); queueMicrotask(() => child.emit('close', null)); return true; };
  const requests = [], launches = [];
  let input = '';
  const out = frame => child.stdout.write(JSON.stringify(frame) + '\n');
  child.stdin = new Writable({ write(chunk, _, done) {
    input += chunk.toString(); const lines = input.split('\n'); input = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const frame = JSON.parse(line); requests.push(frame);
      queueMicrotask(() => respond(frame));
    }
    done();
  } });
  function respond(frame) {
    const method = frame.method || frame.type;
    const reply = result => out({ id: frame.id, ...(frame.type ? { type: 'response', command: frame.type, success: true, data: result } : { result }) });
    if (method === 'initialize') { reply(providerId === 'muse' ? { schema: { fingerprint: 'sha256:e0e163db6ccf00dbe68402ce55d6319b3edc33c421f31e9583b587b2de8a118f' } } : { protocolVersion: 1 }); return; }
    if (method === 'thread/start') { reply({ thread: { id: 'native' } }); return; }
    if (method === 'config/read') { reply({ config: { mcp_servers: { inherited: { command: 'do-not-launch' } } } }); return; }
    if (method === 'session/new') { reply({ sessionId: 'native' }); return; }
    if (method === 'session/start') { reply({ session: { sessionId: 'native' }, viewCursor: 'cursor' }); return; }
    if (method === 'get_state') { reply({ sessionId: 'native' }); return; }
    const isPrompt = method === 'turn/start' || method === 'session/prompt' || method === 'prompt' || frame.event === 'user' || frame.type === 'user';
    if (!isPrompt) return;
    if (corrupt) { child.stdout.write('this is not JSON\n'); return; }
    if (stalled) return;
    const nativeId = foreign ? 'foreign-private-session' : 'native';
    if (providerId === 'claude') {
      out({ type: 'system', subtype: 'init', session_id: 'native' });
      if (requestApproval) out({ type: 'control_request', request_id: 'approval', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'do-not-run' } } });
      out({ type: 'stream_event', session_id: nativeId, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello 👋' } } });
      out({ type: 'assistant', session_id: nativeId, message: { role: 'assistant', content: [{ type: 'text', text: 'Hello 👋' }] } });
      out({ type: 'result', subtype: fail ? 'error_during_execution' : 'success', is_error: fail, session_id: nativeId, result: 'Hello 👋' });
    } else if (providerId === 'antigravity') {
      out({ event: 'step_update', step_update: { conversation_id: nativeId, step_type: 'RESPONSE', text_delta: 'Hello 👋' } });
      out({ event: 'result', result: { conversation_id: nativeId, status: fail ? 'ERROR' : 'SUCCESS', response: 'Hello 👋' } });
    } else if (providerId === 'codex') {
      reply({ turn: { id: 'turn' } });
      if (requestApproval) out({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'native', command: 'do-not-run' } });
      out({ method: 'item/agentMessage/delta', params: { threadId: nativeId, delta: 'Hello 👋' } });
      out({ method: 'item/completed', params: { threadId: nativeId, item: { type: 'agentMessage', id: 'message', text: 'Hello 👋', phase: 'final_answer' } } });
      setImmediate(() => out({ method: 'turn/completed', params: { threadId: nativeId, turn: { id: 'turn', status: fail ? 'failed' : 'completed' } } }));
    } else if (providerId === 'pi' || providerId === 'omp') {
      reply({ agentInvoked: true });
      if (requestApproval) out({ type: 'extension_ui_request', id: 'approval', method: 'confirm' });
      out({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello 👋' } });
      out({ type: 'agent_end', messages: [{ role: 'assistant', stopReason: fail ? 'error' : 'stop', content: [{ type: 'text', text: 'Hello 👋' }] }] });
    } else if (providerId === 'muse') {
      reply({ turnId: 'turn', disposition: 'started' });
      if (requestApproval) out({ jsonrpc: '2.0', id: 'approval', method: 'approval/request', params: { sessionId: 'native' } });
      out({ method: 'item/started', params: { sessionId: nativeId, item: { kind: 'agentMessage', itemId: 'message', text: '' } } });
      out({ method: 'item/delta', params: { sessionId: nativeId, itemId: 'message', field: 'text', delta: 'Hello 👋' } });
      out({ method: 'item/completed', params: { sessionId: nativeId, item: { kind: 'agentMessage', itemId: 'message', text: 'Hello 👋' } } });
      setImmediate(() => out({ method: 'turn/completed', params: { sessionId: nativeId, turnId: 'turn', terminal: fail ? 'failed' : 'completed' } }));
    } else {
      out({ method: 'session/update', params: { sessionId: 'native', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello 👋' } } } });
      reply({ stopReason: fail ? 'max_tokens' : 'end_turn' });
    }
  }
  return { child, requests, launches, out, spawnProcess(command, args, options) {
    launches.push({ command, args, options });
    if (providerId === 'omp') queueMicrotask(() => out({ type: 'ready', supportedProtocolVersions: [1, 2] }));
    if (providerId === 'antigravity') queueMicrotask(() => out({ event: 'init', conversation_id: 'native', init: { model: null } }));
    return child;
  } };
}

for (const provider of RUNNER_PROVIDER_CATALOG) test(`dispatches ${provider.id} through its actual protocol contract`, async () => {
  const fake = fixture(provider.id), events = [];
  const result = await executeRunnerRequest({ ...base, providerId: provider.id, spawnProcess: fake.spawnProcess, emit: event => events.push(event) });
  assert.equal(result.text, 'Hello 👋'); assert.equal(result.providerSessionId, 'native'); assert.equal(result.stopReason, 'end_turn');
  assert.equal(fake.launches.length, 1); assert.ok(fake.child.kills.length);
  assert.ok(events.length > 0); assert.ok(events.every(event => event.sessionId === 'canonical' && event.workspaceId === 'workspace' && event.authority === 'observed-only'));
  assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
  const args = fake.launches[0].args;
  assert.equal(args.some(argument => argument.includes(base.prompt)), false);
  if (provider.id === 'opencode') assert.deepEqual(args, ['acp']);
  if (provider.id === 'pi' || provider.id === 'omp') assert.ok(args.includes('--no-session'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
});

test('approval, package, platform, context and model validation precede process launch', async () => {
  let launched = false;
  const fixtureOptions = { ...base, providerId: 'codex', spawnProcess() { launched = true; } };
  for (const [overrides, code] of [
    [{ localOwnerApproved: false }, 'runner_owner_approval_required'],
    [{ providerId: 'pi', nativeToolsApproved: false }, 'runner_native_tools_approval_required'],
    [{ providerId: 'pi', permissionMode: 'read-only' }, 'runner_project_edit_required'],
    [{ permissionMode: 'danger-full-access' }, 'runner_permission_mode_invalid'],
    [{ providerId: 'auggie', packageExecutionApproved: false }, 'runner_package_approval_required'],
    [{ platform: 'freebsd' }, 'runner_platform_unsupported'],
    [{ providerId: 'unknown' }, 'runner_provider_unknown'],
    [{ prompt: '' }, 'runner_prompt_invalid'],
    [{ model: 'bad\nmodel' }, 'runner_model_invalid'],
    [{ cwd: './relative' }, 'runner_launch_invalid'],
    [{ providerSessionId: 'unowned-native-history' }, 'runner_resume_unavailable'],
    [{ timeoutMs: 0 }, 'runner_timeout_invalid'],
  ]) await assert.rejects(executeRunnerRequest({ ...fixtureOptions, ...overrides }), { code });
  assert.equal(launched, false);
});

for (const providerId of ['claude', 'codex', 'pi', 'omp', 'muse', 'antigravity']) {
  test(`${providerId} rejects corrupt output, deadlines and provider failures without retry`, async () => {
    for (const [fixtureOptions, code] of [[{ corrupt: true }, 'runtime_protocol'], [{ stalled: true }, 'run_timeout'], [{ fail: true }, 'runtime_turn_failed']]) {
      const fake = fixture(providerId, fixtureOptions);
      await assert.rejects(executeRunnerRequest({ ...base, providerId, timeoutMs: 80, spawnProcess: fake.spawnProcess }), { code });
      assert.equal(fake.launches.length, 1); assert.ok(fake.child.kills.length);
    }
  });
  test(`${providerId} cancellation kills its transport without a second inference`, async () => {
    const controller = new AbortController(), fake = fixture(providerId, { stalled: true });
    const pending = executeRunnerRequest({ ...base, providerId, signal: controller.signal, spawnProcess: fake.spawnProcess });
    setTimeout(() => controller.abort(), 25);
    const result = await pending;
    assert.equal(result.stopReason, 'cancelled'); assert.equal(fake.launches.length, 1); assert.ok(fake.child.kills.length);
  });
}

for (const providerId of ['claude', 'codex', 'muse', 'antigravity']) test(`${providerId} does not capture foreign native-session text`, async () => {
  const fake = fixture(providerId, { foreign: true }), events = [];
  await assert.rejects(executeRunnerRequest({ ...base, providerId, spawnProcess: fake.spawnProcess, emit: event => events.push(event) }), { code: 'runner_event_session_mismatch' });
  assert.doesNotMatch(JSON.stringify(events), /foreign-private-session/);
});

for (const providerId of ['claude', 'codex', 'pi', 'omp', 'muse']) test(`${providerId} interactive capability requests never grant rights`, async () => {
  const fake = fixture(providerId, { requestApproval: true });
  await executeRunnerRequest({ ...base, providerId, spawnProcess: fake.spawnProcess });
  await new Promise(resolve => setImmediate(resolve));
  const response = fake.requests.find(frame => frame.id === 'approval' || frame.response?.request_id === 'approval');
  assert.ok(response); assert.match(JSON.stringify(response), /deny|decline|cancelled|-32601/);
});

test('Claude restricted chat disables tools/MCP and does not inherit server credentials', async () => {
  const fake = fixture('claude');
  await executeRunnerRequest({ ...base, providerId: 'claude', nativeToolsApproved: false, env: { ...base.env, OPENAI_API_KEY: 'secret', ANTHROPIC_API_KEY: 'secret', NODE_OPTIONS: '--require=unsafe' }, spawnProcess: fake.spawnProcess });
  const { args, options } = fake.launches[0];
  assert.equal(args[args.indexOf('--tools') + 1], ''); assert.ok(args.includes('--strict-mcp-config')); assert.ok(args.includes('--restricted')); assert.ok(!args.includes('--allowedTools'));
  assert.ok(args.includes('--safe-mode')); assert.ok(!args.includes('--bare')); assert.ok(args.includes('--no-session-persistence'));
  assert.equal(options.env.OPENAI_API_KEY, undefined); assert.equal(options.env.NODE_OPTIONS, undefined);
});

test('Codex restricted chat disables inherited MCP before starting its fresh ephemeral thread', async () => {
  const fake = fixture('codex');
  await executeRunnerRequest({ ...base, providerId: 'codex', nativeToolsApproved: false, spawnProcess: fake.spawnProcess });
  const thread = fake.requests.find(frame => frame.method === 'thread/start');
  assert.equal(thread.params.sandbox, 'read-only'); assert.equal(thread.params.ephemeral, true);
  assert.deepEqual(thread.params.config.mcp_servers, { inherited: { enabled: false } });
  assert.ok(fake.requests.findIndex(frame => frame.method === 'config/read') < fake.requests.indexOf(thread));
  assert.ok(fake.launches[0].args.includes('features.shell_tool=false'));
});

test('native reasoning controls map to provider-specific flags/requests instead of being silently ignored', async () => {
  for (const providerId of ['claude', 'codex', 'pi', 'omp', 'muse']) {
    const fake = fixture(providerId);
    await executeRunnerRequest({ ...base, providerId, reasoningEffort: 'high', spawnProcess: fake.spawnProcess });
    const args = fake.launches[0].args;
    if (providerId === 'claude') assert.equal(args[args.indexOf('--effort') + 1], 'high');
    else if (providerId === 'pi' || providerId === 'omp') assert.equal(args[args.indexOf('--thinking') + 1], 'high');
    else {
      const turn = fake.requests.find(request => request.method === 'turn/start');
      assert.equal(turn.params[providerId === 'codex' ? 'effort' : 'reasoningEffort'], 'high');
    }
  }
  for (const providerId of ['claude', 'antigravity', 'pi']) await assert.rejects(executeRunnerRequest({ ...base, providerId, reasoningEffort: 'unsupported', spawnProcess() { throw new Error('Must not launch.'); } }), { code: 'runner_effort_unavailable' });
});

test('every catalog identity has implemented transport metadata without live/platform certification', () => {
  for (const provider of RUNNER_PROVIDER_CATALOG) {
    const capabilities = runnerRuntimeCapabilities(provider.id);
    assert.equal(capabilities.execution, 'implemented-fixture-tested'); assert.equal(capabilities.liveVerified, false); assert.equal(capabilities.resume, false); assert.equal(capabilities.osIsolation, false);
  }
  assert.equal(requiresNativeTools('claude'), false); assert.equal(requiresNativeTools('copilot'), true); assert.equal(requiresNativeTools('unknown'), true); assert.equal(runnerRuntimeCapabilities('unknown'), null);
});

test('large canonical replies redact complete credentials across delta/chunk boundaries without truncating safe text', () => {
  const safe = 'x'.repeat(11995) + ' ', secret = 'sk-proj-abcdefghijk0123456789';
  assert.equal(sanitizeRunnerReply(safe + secret + ' end'), safe + '[redacted] end');
  assert.equal(sanitizeRunnerReply('answer '.repeat(10000)).length, 70000);
  assert.doesNotMatch(sanitizeRunnerReply('prefix password="a long secret value" suffix'), /a long secret/);
});

for (const providerId of ['claude', 'codex', 'copilot', 'opencode', 'pi', 'omp', 'antigravity', 'muse']) test(`${providerId} completes through a real isolated Node subprocess, not a vendor account`, async () => {
  let child;
  const events = [];
  const result = await executeRunnerRequest({ ...base, timeoutMs: 5000, providerId, emit: event => events.push(event), spawnProcess(_command, _args, options) {
    child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/runner-native-process.mjs', import.meta.url)), providerId], { cwd: directory, env: options.env, detached: options.detached, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    return child;
  } });
  assert.equal(result.text, 'Reply from real IPC 👋'); assert.equal(result.providerSessionId, 'fixture-native');
  assert.ok(events.every(event => event.authority === 'observed-only'));
  await new Promise(resolve => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('close', resolve));
});

test('ACP completion waits until SIGTERM-ignoring runtime and its inherited-pipe descendant are stopped', async () => {
  let child, closed = false;
  const before = Date.now();
  const result = await executeRunnerRequest({ ...base, providerId: 'copilot', timeoutMs: 5000, spawnProcess(_command, _args, options) {
    child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/runner-native-process.mjs', import.meta.url)), 'copilot', '--ignore-sigterm', '--descendant'], { cwd: directory, env: options.env, detached: options.detached, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.once('close', () => { closed = true; });
    return child;
  } });
  assert.equal(result.text, 'Reply from real IPC 👋');
  assert.equal(closed, true, 'The adapter must not return while its runtime or inherited child pipes remain open.');
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  if (process.platform !== 'win32') { assert.equal(child.signalCode, 'SIGKILL'); assert.ok(Date.now() - before >= 1900); }
});

test('native completion also awaits real subprocess close before returning its result', async () => {
  let closed = false, child;
  const result = await executeRunnerRequest({ ...base, providerId: 'pi', timeoutMs: 5000, spawnProcess(_command, _args, options) {
    child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/runner-native-process.mjs', import.meta.url)), 'pi', '--ignore-sigterm', '--descendant'], { cwd: directory, env: options.env, detached: options.detached, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.once('close', () => { closed = true; });
    return child;
  } });
  assert.equal(result.text, 'Reply from real IPC 👋'); assert.equal(closed, true);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

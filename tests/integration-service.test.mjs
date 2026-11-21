import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, mkdirSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { createIntegrationService } from '../server/integration-service.mjs';
import { createNativeAgentToolBridge } from '../server/native-agent-tool-bridge.mjs';

const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const forbidden = () => { throw new Error('Tests must never reach a real provider or process.'); };
const signedInExec = async (_command, args) => ({ code: 0, stdout: args.includes('mcp') ? '[]' : 'Logged in' });
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rumbo-integrations-test-'));
  const service = createIntegrationService({ dataDir: directory, env: {}, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden, ...options });
  t.after(() => { service.close(); rmSync(directory, { recursive: true, force: true }); });
  return { service, directory };
}
function fakeProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = (signal) => { child.killedWith = signal; queueMicrotask(() => child.emit('close', null)); return true; };
  return child;
}

test('a reviewed execution deadline terminates the injected process and records a machine-readable timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = fakeProcess(), finished = [], events = [];
  const { service, directory } = fixture(t, { execute: signedInExec, spawnProcess: () => child });
  await service.connect('codex', { method: 'existing' });
  await service.startRun({ provider: 'codex', cwd: directory, prompt: 'Bounded fixture', timeoutMs: 1000 }, { onComplete: result => finished.push(result), onEvent: event => events.push(event) });
  assert.equal(events.find(event => event.type === 'run.started').payload.timeoutMs, 1000);
  t.mock.timers.tick(999);
  assert.equal(child.killedWith, undefined);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(child.killedWith, 'SIGTERM');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].status, 'failed');
  assert.equal(finished[0].error_code, 'run_timeout');
});

test('invalid execution limits fail before provider configuration or process calls', async (t) => {
  const { service, directory } = fixture(t);
  for (const timeoutMs of [0, 999, 1800001, Infinity, '1000', 1000.5]) {
    await assert.rejects(service.startRun({ provider: 'codex', cwd: directory, prompt: 'Invalid fixture', timeoutMs }), { code: 'invalid_timeout' });
  }
});

test('profile model and Codex reasoning use argument values without shell interpolation', async (t) => {
  for (const provider of ['codex', 'claude']) {
    const child = fakeProcess(); let launch;
    const { service } = fixture(t, {
      execute: signedInExec,
      spawnProcess: (command, args, options) => { launch = { command, args, options }; return child; },
    });
    await service.connect(provider, { method: 'existing' });
    await service.startRun({ provider, prompt: 'Fixture only', workMode: 'conversation', model: 'fixture-model', reasoningEffort: provider === 'codex' ? 'medium' : '' });
    assert.equal(launch.args[launch.args.indexOf('--model') + 1], 'fixture-model');
    assert.equal(launch.options.shell, false);
    assert.equal(launch.args.includes('model_reasoning_effort="medium"'), provider === 'codex');
    child.emit('close', 0);
  }
});

test('invalid model and unsupported reasoning never reach provider execution', async (t) => {
  const { service } = fixture(t, { execute: signedInExec });
  for (const config of [{ model: '--unsafe' }, { model: 'x; echo unsafe' }, { reasoningEffort: 'unbounded' }, { provider: 'claude', reasoningEffort: 'high' }]) {
    await assert.rejects(service.startRun({ provider: 'codex', prompt: 'Fixture only', workMode: 'conversation', ...config }), error => ['invalid_model', 'invalid_reasoning'].includes(error.code));
  }
});

test('general conversations use an empty private transient directory and restricted provider arguments', async (t) => {
  for (const provider of ['codex', 'claude']) {
    const child = fakeProcess(); let launch;
    const { service, directory } = fixture(t, {
      env: { FRONDOSE_GITHUB_CLIENT_SECRET:'fixture-current-secret', TALVORI_GITHUB_CLIENT_SECRET:'fixture-old-secret', RUMBO_GITHUB_CLIENT_SECRET:'fixture-original-secret' },
      execute: async (_command, args) => ({ code: 0, stdout: args.includes('mcp') ? '[]' : '{"loggedIn":true}' }),
      spawnProcess: (command, args, options) => { launch = { command, args, options }; return child; },
    });
    await service.connect(provider, { method: 'existing' });
    const events = [];
    await service.startRun({ provider, prompt: 'Help plan a presentation.', workMode: 'conversation' }, { onEvent: event => events.push(event) });
    assert.ok(!Object.keys(launch.options.env).some(key => /^(?:FRONDOSE|TALVORI|RUMBO)_/.test(key)), 'Operator secrets under every brand stay outside provider runtimes');
    const scratch = statSync(launch.options.cwd);
    assert.ok(scratch.isDirectory());
    if (process.platform !== 'win32') assert.equal(scratch.mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(launch.options.cwd), []);
    assert.notEqual(launch.options.cwd, directory);
    if (provider === 'codex') {
      for (const arg of ['--ignore-user-config', '--ignore-rules', '--ephemeral', 'features.shell_tool=false', 'features.unified_exec=false', 'web_search="disabled"', 'tools.view_image=false']) assert.ok(launch.args.includes(arg), arg);
      assert.equal(launch.args[launch.args.indexOf('--sandbox') + 1], 'read-only');
    } else {
      assert.equal(launch.args[launch.args.indexOf('--tools') + 1], '');
      assert.equal(launch.args[launch.args.indexOf('--disallowedTools') + 1], '*');
      assert.ok(launch.args.includes('--restricted'));
    }
    assert.equal(events.find(event => event.type === 'run.started').payload.cwd, null);
    child.emit('close', 0);
    assert.equal(existsSync(launch.options.cwd), false);
  }
});

test('general conversation scratch directories are removed on setup failure and stop', async (t) => {
  let workDir;
  const { service } = fixture(t, { execute: async (_command, args, options) => {
    if (args.includes('mcp')) { workDir = options.cwd; return { code: 1, stdout: '' }; }
    return { code: 0, stdout: 'Logged in' };
  } });
  await service.connect('codex', { method: 'existing' });
  await assert.rejects(service.startRun({ provider: 'codex', prompt: 'Hello', workMode: 'conversation' }), { code: 'provider_configuration' });
  assert.equal(existsSync(workDir), false);
  await assert.rejects(service.startRun({ provider: 'codex', prompt: 'Hello', workMode: 'conversation', permissionMode: 'workspace-write' }), { code: 'invalid_permissions' });
  const child = fakeProcess(); let stopDir;
  const stopping = fixture(t, { execute: signedInExec, spawnProcess: (_command, _args, options) => { stopDir = options.cwd; return child; } }).service;
  await stopping.connect('codex', { method: 'existing' });
  const controller = await stopping.startRun({ provider: 'codex', prompt: 'Hello', workMode: 'conversation' });
  controller.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(existsSync(stopDir), false);
});

test('opening setup and cached status never checks accounts, leaks secrets, or starts a process', (t) => {
  const { service } = fixture(t, { env: { FRONDOSE_GOOGLE_CLIENT_ID: 'client', FRONDOSE_GOOGLE_CLIENT_SECRET: 'private-client-secret' } });
  const setups = service.listSetups();
  assert.equal(setups.length, 4);
  assert.ok(setups.every((setup) => setup.connection.state === 'not_connected'));
  assert.equal(service.status('codex').liveAccountChecked, false);
  assert.equal(JSON.stringify(setups).includes('private-client-secret'), false);
  assert.equal(service.setup('google-drive').configured, true);
});

test('GitHub validates token before storing, lists repositories, and disconnects locally', async (t) => {
  const requests = [], changes = [];
  const token = 'github_pat_very_secret_test_token';
  const { service, directory } = fixture(t, { onConnectionChange: (...args) => changes.push(args), fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return ok(url.endsWith('/user') ? { login: 'test-user' } : [{ id: 42, full_name: 'test-user/project', html_url: 'https://github.com/test-user/project', private: true }]);
  } });
  const result = await service.connect('github', { method: 'token', token });
  assert.equal(result.connection.state, 'connected');
  assert.equal(result.connection.accountLabel, 'test-user');
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(JSON.stringify(changes).includes(token), false);
  const store = statSync(join(directory, 'integrations.private.json'));
  assert.ok(store.isFile());
  if (process.platform !== 'win32') assert.equal(store.mode & 0o777, 0o600);
  const resources = await service.resources('github');
  assert.equal(resources.resources[0].name, 'test-user/project');
  assert.equal(requests[1].options.headers.Authorization, `Bearer ${token}`);
  service.disconnect('github');
  assert.equal(service.status('github').state, 'not_connected');
  assert.equal(readFileSync(join(directory, 'integrations.private.json'), 'utf8').includes(token), false);
  await assert.rejects(service.resources('github'), { code: 'not_connected' });
});

test('rejected GitHub credentials are not saved and errors contain no provider token', async (t) => {
  const { service } = fixture(t, { fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: 'echo-secret' }) }) });
  await assert.rejects(service.connect('github', { method: 'token', token: 'bad-token' }), (failure) => failure.code === 'provider_permission' && !failure.message.includes('echo-secret'));
  assert.equal(service.status('github').state, 'not_connected');
});

test('switching GitHub from a token to existing sign-in checks the CLI and removes the token', async (t) => {
  const calls = [];
  const { service, directory } = fixture(t, { fetchImpl: async () => ok({ login: 'token-user' }), execute: async (command, args) => { calls.push({ command, args }); return { code: 0, stdout: '{"login":"cli-user"}' }; } });
  await service.connect('github', { method: 'token', token: 'github_pat_old_credentials' });
  await service.connect('github', { method: 'existing' });
  assert.equal(service.status('github').accountLabel, 'cli-user');
  assert.deepEqual(calls, [{ command: 'gh', args: ['api', 'user'] }]);
  assert.equal(readFileSync(join(directory, 'integrations.private.json'), 'utf8').includes('github_pat_old_credentials'), false);
});

test('existing CLI sign-in is checked only on explicit action', async (t) => {
  const calls = [];
  const { service } = fixture(t, { execute: async (command, args) => { calls.push({ command, args }); return { code: 0, stdout: '{"loggedIn":true,"email":"test@example.com"}' }; } });
  assert.deepEqual(calls, []);
  await service.connect('claude', { method: 'existing' });
  assert.deepEqual(calls, [{ command: 'claude', args: ['auth', 'status'] }]);
  assert.equal(service.status('claude').state, 'connected');
  service.disconnect('claude');
  assert.equal(calls.length, 1, 'disconnect must not log out the user in their CLI');
});

test('an explicit failed authentication check clears stale connected state', async (t) => {
  let failCheck = false;
  const { service } = fixture(t, { execute: async () => { if (failCheck) throw Object.assign(new Error('CLI disappeared'), { code: 'not_installed' }); return { code: 0, stdout: 'Logged in' }; } });
  await service.connect('codex', { method: 'existing' });
  assert.equal(service.status('codex').state, 'connected');
  failCheck = true;
  await assert.rejects(service.authStatus('codex'), { code: 'not_installed' });
  assert.equal(service.status('codex').state, 'not_connected');
});

test('browser sign-in captures progress and records completion without exposing auth credentials', async (t) => {
  const child = fakeProcess(), calls = [];
  const { service } = fixture(t, { spawnProcess: (command, args, options) => { calls.push({ command, args, options }); return child; }, execute: async () => ({ code: 0, stdout: 'Logged in' }) });
  const result = await service.connect('codex', { method: 'browser' });
  assert.equal(result.connection.state, 'connecting');
  assert.deepEqual(calls[0].args, ['login']);
  assert.equal(calls[0].options.shell, false);
  child.stdout.write('Open the browser. sk-test_do_not_leak');
  assert.equal(service.status('codex').auth.output.includes('sk-test'), false);
  child.emit('close', 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.status('codex').state, 'connected');
});

test('Google requires registered OAuth config and validates state before token exchange', async (t) => {
  const missing = fixture(t).service;
  await assert.rejects(missing.connect('google-drive', { method: 'browser' }), { code: 'configuration_required' });
  const requests = [];
  const { service } = fixture(t, { env: { FRONDOSE_GOOGLE_CLIENT_ID: 'test-client', FRONDOSE_GOOGLE_CLIENT_SECRET: 'test-secret' }, fetchImpl: async (url, options) => { requests.push({ url, options }); return ok({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 }); } });
  const start = await service.connect('google-drive', { method: 'browser', origin: 'http://127.0.0.1:4999' });
  const authUrl = new URL(start.authorizationUrl);
  assert.equal(authUrl.hostname, 'accounts.google.com');
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authUrl.searchParams.get('scope'), /drive.metadata.readonly/);
  await assert.rejects(service.completeGoogleAuth({ state: 'wrong', code: 'code', origin: 'http://127.0.0.1:4999' }), { code: 'invalid_oauth_state' });
  assert.equal(requests.length, 0);
  const state = authUrl.searchParams.get('state');
  const result = await service.completeGoogleAuth({ state, code: 'code', origin: 'http://127.0.0.1:4999' });
  assert.equal(result.state, 'connected');
  assert.equal(JSON.stringify(result).includes('test-access'), false);
  assert.ok(new URLSearchParams(requests[0].options.body).get('code_verifier'));
  await assert.rejects(service.completeGoogleAuth({ state, code: 'code', origin: 'http://127.0.0.1:4999' }), { code: 'invalid_oauth_state' });
});

test('Google resource listing refreshes expired tokens and returns metadata only', async (t) => {
  let exchanges = 0;
  const { service } = fixture(t, { env: { FRONDOSE_GOOGLE_CLIENT_ID: 'client', FRONDOSE_GOOGLE_CLIENT_SECRET: 'secret' }, fetchImpl: async (url, options) => {
    if (url.includes('/token')) { exchanges++; return ok({ access_token: `token${exchanges}`, refresh_token: 'refresh', expires_in: 1 }); }
    assert.equal(options.headers.Authorization, 'Bearer token2');
    return ok({ files: [{ id: 'file1', name: 'Project brief', webViewLink: 'https://drive.google.com/file/d/file1/view' }] });
  } });
  const start = await service.connect('google-drive', { method: 'browser', origin: 'http://127.0.0.1:4999' });
  await service.completeGoogleAuth({ code: 'code', state: new URL(start.authorizationUrl).searchParams.get('state'), origin: 'http://127.0.0.1:4999' });
  const result = await service.resources('google-drive');
  assert.equal(result.resources[0].kind, 'file');
  assert.equal(result.resources[0].name, 'Project brief');
  assert.equal(exchanges, 2);
});

test('Codex streams structured output with sandbox permissions and stdin prompt', async (t) => {
  const child = fakeProcess(), calls = [], events = [], finished = [];
  let sentPrompt = '';
  child.stdin.on('data', (data) => { sentPrompt += data; });
  const { service, directory } = fixture(t, { execute: signedInExec, spawnProcess: (command, args, options) => { calls.push({ command, args, options }); return child; } });
  await service.connect('codex', { method: 'existing' });
  await service.startRun({ provider: 'codex', prompt: 'Review $(not a command)', cwd: directory }, { onEvent: (event) => events.push(event), onComplete: (event) => finished.push(event) });
  assert.equal(sentPrompt, 'Review $(not a command)');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].args[calls[0].args.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(!calls[0].args.includes('--dangerously-bypass-approvals-and-sandbox'));
  child.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"Review complete"}}\n');
  child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":12}}\n');
  child.emit('close', 0);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].status, 'completed');
  assert.match(finished[0].text, /Review complete/);
  assert.ok(events.some((event) => event.type === 'agent.message'));
});

test('usage reports bypass the bounded display-event stream and expose only normalized Codex metrics', async (t) => {
  const child = fakeProcess(), events = [], reports = [], finished = [];
  const { service, directory } = fixture(t, { execute: signedInExec, spawnProcess: () => child });
  await service.connect('codex', { method: 'existing' });
  await service.startRun({ provider: 'codex', prompt: 'Measure the injected fixture', cwd: directory }, {
    onEvent: event => events.push(event), onUsageReport: report => reports.push(report), onComplete: result => finished.push(result),
  });
  for (let index = 0; index < 5010; index++) child.stdout.write('{"type":"system"}\n');
  child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":80,"output_tokens":30,"reasoning_output_tokens":7,"unsupported_secret":"DROP"}}\n');
  child.emit('close', 0);
  assert.ok(events.length <= 5000);
  assert.deepEqual(reports, [{ provider: 'codex', source: 'turn.completed', main: { input_tokens: 120, cached_input_tokens: 80, output_tokens: 30, reasoning_output_tokens: 7 } }]);
  assert.equal(JSON.stringify(reports).includes('unsupported_secret'), false);
  assert.equal(finished[0].usage_capture_incomplete, undefined);
});

test('Claude reports main-loop and all-model usage independently and marks callback persistence failures', async (t) => {
  const child = fakeProcess(), reports = [], finished = [];
  const { service, directory } = fixture(t, { execute: async () => ({ code: 0, stdout: '{"loggedIn":true}' }), spawnProcess: () => child });
  await service.connect('claude', { method: 'existing' });
  await service.startRun({ provider: 'claude', prompt: 'Measure the injected fixture', cwd: directory }, {
    onUsageReport: report => { reports.push(report); throw new Error('Injected persistence failure'); },
    onComplete: result => finished.push(result),
  });
  child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'Done', usage: { input_tokens: 12, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 }, modelUsage: {
    first: { inputTokens: 10, cacheCreationInputTokens: 1, cacheReadInputTokens: 2, outputTokens: 3 },
    second: { inputTokens: 20, cacheCreationInputTokens: 2, cacheReadInputTokens: 'invalid', outputTokens: 5 },
  }, total_cost_usd: 0.0042 }) + '\n');
  child.emit('close', 0);
  assert.deepEqual(reports[0].main, { input_tokens: 12, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 });
  assert.deepEqual(reports[0].all_models, { input_tokens: 30, cache_creation_input_tokens: 3, cache_read_input_tokens: null, output_tokens: 8, model_count: 2 });
  assert.equal(reports[0].estimated_cost_usd, 0.0042);
  assert.equal(finished[0].status, 'completed');
  assert.equal(finished[0].usage_capture_incomplete, true);
  assert.equal(finished[0].usage_error_code, 'usage_persistence_failed');
  assert.equal(JSON.stringify(finished[0]).includes('Injected persistence failure'), false);
});

test('Claude ignores assistant placeholder usage and marks invalid or overflowing model totals unknown', async (t) => {
  const child = fakeProcess(), reports = [];
  const { service, directory } = fixture(t, { execute: signedInExec, spawnProcess: () => child });
  await service.connect('claude', { method: 'existing' });
  await service.startRun({ provider: 'claude', prompt: 'Fixture metrics only', cwd: directory }, { onUsageReport: report => reports.push(report) });
  child.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [], usage: { input_tokens: 777, output_tokens: 1 } } }) + '\n');
  assert.equal(reports.length, 0);
  child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', usage: { input_tokens: '0', output_tokens: 0, cache_read_input_tokens: -1, cache_creation_input_tokens: 1.5 }, modelUsage: {
    first: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 2, cacheReadInputTokens: 1, cacheCreationInputTokens: 0 },
    second: { inputTokens: 1, outputTokens: 3, cacheReadInputTokens: 'bad' },
  }, total_cost_usd: '0.0042' }) + '\n');
  child.emit('close', 0);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0].main, { input_tokens: null, output_tokens: 0, cache_read_input_tokens: null, cache_creation_input_tokens: null });
  assert.deepEqual(reports[0].all_models, { input_tokens: null, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: null, model_count: 2 });
  assert.equal(reports[0].estimated_cost_usd, null);
});

test('cancellation drops terminal usage arriving after stop and keeps completion single-shot', async (t) => {
  for (const provider of ['codex', 'claude']) {
    const child = fakeProcess(), reports = [], finished = [];
    const { service, directory } = fixture(t, { execute: signedInExec, spawnProcess: () => child });
    await service.connect(provider, { method: 'existing' });
    const run = await service.startRun({ provider, prompt: 'Stop fixture', cwd: directory }, { onUsageReport: report => reports.push(report), onComplete: result => finished.push(result) });
    run.stop();
    child.stdout.write(JSON.stringify(provider === 'codex' ? { type: 'turn.completed', usage: { input_tokens: 42 } } : { type: 'result', subtype: 'success', usage: { input_tokens: 42 }, total_cost_usd: 1 }) + '\n');
    await new Promise(resolve => setImmediate(resolve));
    child.emit('close', 0);
    assert.equal(reports.length, 0); assert.equal(finished.length, 1); assert.equal(finished[0].status, 'stopped');
  }
});

test('agent validation prevents disconnected, invalid directory, and unsupported permissions from spawning', async (t) => {
  const { service, directory } = fixture(t, { execute: async () => ({ code: 0, stdout: '{}' }) });
  await assert.rejects(service.startRun({ provider: 'codex', prompt: 'Hello', cwd: directory }), { code: 'not_connected' });
  await service.connect('claude', { method: 'existing' });
  await assert.rejects(service.startRun({ provider: 'claude', prompt: 'Hello', cwd: '/nonexistent-rumbo-test' }), { code: 'invalid_directory' });
  await assert.rejects(service.startRun({ provider: 'claude', prompt: 'Hello', cwd: directory, permissionMode: 'workspace-write' }), { code: 'unsupported_permissions' });
});

test('Claude uses restricted read tools and surfaces structured failures even with exit code zero', async (t) => {
  const child = fakeProcess(), finished = [];
  let args;
  const { service, directory } = fixture(t, { execute: async () => ({ code: 0, stdout: '{"loggedIn":true}' }), spawnProcess: (_command, given) => { args = given; return child; } });
  await service.connect('claude', { method: 'existing' });
  await service.startRun({ provider: 'claude', prompt: 'Review', cwd: directory }, { onComplete: (event) => finished.push(event) });
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep');
  assert.ok(args.includes('--safe-mode')); assert.ok(!args.includes('--bare'));
  assert.ok(args.includes('--restricted'));
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'mcp__*');
  assert.ok(!args.includes('Bash'));
  child.stdout.write('{"type":"result","is_error":true,"errors":["No quota available"]}\n');
  child.emit('close', 0);
  assert.equal(finished[0].status, 'failed');
  assert.equal(finished[0].error, 'No quota available');
});

test('stopping a live run produces one stopped result', async (t) => {
  const child = fakeProcess(), finished = [], events = [];
  const { service, directory } = fixture(t, { execute: signedInExec, spawnProcess: () => child });
  await service.connect('codex', { method: 'existing' });
  const run = await service.startRun({ provider: 'codex', prompt: 'Review', cwd: directory }, { onComplete: (event) => finished.push(event), onEvent: (event) => events.push(event) });
  run.stop();
  child.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"Late output must not appear"}}\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(child.killedWith, 'SIGTERM');
  assert.deepEqual(finished.map((item) => item.status), ['stopped']);
  assert.equal(JSON.stringify([...events, ...finished]).includes('Late output'), false);
});

test('Codex disables inherited tool servers, hooks, extra writable roots and network grants', async (t) => {
  const child = fakeProcess(); let launched;
  const { service, directory } = fixture(t, { execute: async (_command, args) => ({ code: 0, stdout: args.includes('mcp') ? '[{"name":"tools.with.dots","enabled":true}]' : 'Logged in' }), spawnProcess: (_command, args) => { launched = args; return child; } });
  await service.connect('codex', { method: 'existing' });
  await service.startRun({ provider: 'codex', prompt: 'Work', cwd: directory, permissionMode: 'workspace-write' });
  for (const override of ['mcp_servers."tools.with.dots".enabled=false', 'features.hooks=false', 'features.apps=false', 'features.multi_agent=false', 'sandbox_workspace_write.writable_roots=[]', 'sandbox_workspace_write.network_access=false']) assert.ok(launched.includes(override), override);
  child.emit('close', 0);
});

test('unknown Codex tool configuration fails before model process launch', async (t) => {
  const { service, directory } = fixture(t, { execute: async (_command, args) => ({ code: 0, stdout: args.includes('mcp') ? 'not json' : 'Logged in' }) });
  await service.connect('codex', { method: 'existing' });
  await assert.rejects(service.startRun({ provider: 'codex', prompt: 'Work', cwd: directory }), { code: 'provider_configuration' });
});

test('general chat does not recreate transportless inherited MCP tables after ignoring user config', async (t) => {
  const child = fakeProcess(); let launched;
  const { service } = fixture(t, { execute: async (_command, args) => ({ code: 0, stdout: args.includes('mcp') ? '[{"name":"linear","enabled":true},{"name":"tools.with.dots","enabled":true}]' : 'Logged in' }), spawnProcess: (_command, args) => { launched = args; return child; } });
  await service.connect('codex', { method: 'existing' });
  await service.startRun({ provider: 'codex', prompt: 'Discuss the plan', workMode: 'conversation' });
  assert.ok(launched.includes('--ignore-user-config'));
  assert.ok(launched.includes('--ignore-rules'));
  assert.ok(launched.includes('features.plugins=false'));
  assert.ok(launched.includes('mcp_servers."linear"={enabled=false,command="false"}'));
  assert.ok(launched.includes('mcp_servers."tools.with.dots"={enabled=false,command="false"}'));
  assert.ok(!launched.some(value => /^mcp_servers\..*\.enabled=false$/.test(value)), 'Ignored configuration must not become invalid transportless entries');
  child.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"Plan ready"}}\n'); child.emit('close', 0);
});

test('an empty successful provider exit is surfaced as retryable failure rather than a missing reply', async (t) => {
  const child = fakeProcess(), finished = [];
  const { service, directory } = fixture(t, { execute: signedInExec, spawnProcess: () => child });
  await service.connect('codex', { method: 'existing' });
  await service.startRun({ provider: 'codex', prompt: 'Review', workMode: 'conversation' }, { onComplete: result => finished.push(result) });
  child.emit('close', 0);
  assert.equal(finished[0].status, 'failed'); assert.match(finished[0].error, /without a text reply/);
});

test('cancelling during configuration inspection prevents the paid agent process from starting', async (t) => {
  let finishInspection;
  const { service, directory } = fixture(t, { execute: async (_command, args) => args.includes('mcp') ? new Promise((resolve) => { finishInspection = resolve; }) : { code: 0, stdout: 'Logged in' } });
  await service.connect('codex', { method: 'existing' });
  const controller = new AbortController();
  const pending = service.startRun({ provider: 'codex', prompt: 'Work', cwd: directory, signal: controller.signal });
  controller.abort();
  finishInspection({ code: 0, stdout: '[]' });
  await assert.rejects(pending, { code: 'session_cancelled' });
});

test('all agent output payloads and final text redact known credentials, including after disconnect', async (t) => {
  const child = fakeProcess(), events = [], results = [], secret = 'private-value-that-is-not-a-known-prefix';
  const { service, directory } = fixture(t, { env: { ANTHROPIC_API_KEY: secret }, execute: signedInExec, spawnProcess: () => child });
  await service.connect('codex', { method: 'existing' });
  await service.startRun({ provider: 'codex', prompt: 'Work', cwd: directory }, { onEvent: (event) => events.push(event), onComplete: (result) => results.push(result) });
  service.disconnect('codex');
  child.stdout.write(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: `Value ${secret}` } })}\n`);
  child.stdout.write(`${JSON.stringify({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: secret, access_token: secret }] } })}\n`);
  child.emit('close', 0);
  assert.equal(JSON.stringify([...events, ...results]).includes(secret), false);
  assert.match(results[0].text, /\[redacted\]/);
});

test('project roots reject broad folders and resolve symlinks before optional containment checks', async (t) => {
  const { service, directory } = fixture(t, { execute: signedInExec });
  await service.connect('codex', { method: 'existing' });
  for (const cwd of ['/', homedir()]) await assert.rejects(service.startRun({ provider: 'codex', prompt: 'Work', cwd }), { code: 'unsafe_directory' });
  const root = join(directory, 'project'), other = join(directory, 'outside'); mkdirSync(root); mkdirSync(other); symlinkSync(other, join(root, 'escape'));
  await assert.rejects(service.startRun({ provider: 'codex', prompt: 'Work', cwd: join(root, 'escape'), allowedRoot: root }), { code: 'directory_outside_project' });
});

test('UTF-8 model responses survive split byte boundaries', async (t) => {
  const child = fakeProcess(), results = [];
  const { service, directory } = fixture(t, { execute: signedInExec, spawnProcess: () => child });
  await service.connect('codex', { method: 'existing' });
  await service.startRun({ provider: 'codex', prompt: 'Work', cwd: directory }, { onComplete: (result) => results.push(result) });
  const bytes = Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"你好"}}\n');
  const cut = bytes.indexOf(Buffer.from('你')) + 1;
  child.stdout.write(bytes.subarray(0, cut)); child.stdout.write(bytes.subarray(cut)); child.emit('close', 0);
  assert.equal(results[0].text.trim(), '你好');
});

test('Codex receives one generated native MCP server without capability values in arguments', async (t) => {
  const bridge = await createNativeAgentToolBridge({ listTools: () => [{ name: 'documents.read', inputSchema: { type: 'object' } }], callTool: () => ({}), expiresAt: Date.now() + 30_000 });
  t.after(() => bridge.close());
  const child = fakeProcess(); let launch;
  const { service, directory } = fixture(t, { execute: signedInExec, spawnProcess: (command, args, options) => { launch = { command, args, options }; return child; } });
  await service.connect('codex', { method: 'existing' });
  await service.startRun({ provider: 'codex', prompt: 'Use the reviewed tool', cwd: directory, nativeToolBridge: bridge.descriptor });
  const serialized = JSON.stringify(launch.args);
  assert.equal(serialized.includes(bridge.descriptor.env.FRONDOSE_NATIVE_TOOL_CAPABILITY), false);
  assert.equal(serialized.includes(bridge.descriptor.env.FRONDOSE_NATIVE_TOOL_SOCKET), false);
  for (const value of [
    `mcp_servers.frondose.command=${JSON.stringify(process.execPath)}`,
    'mcp_servers.frondose.env_vars=["FRONDOSE_NATIVE_TOOL_SOCKET","FRONDOSE_NATIVE_TOOL_CAPABILITY"]',
    'mcp_servers.frondose.enabled_tools=["documents.read"]',
    'mcp_servers.frondose.required=true',
  ]) assert.ok(launch.args.includes(value), value);
  assert.equal(launch.options.env.FRONDOSE_NATIVE_TOOL_CAPABILITY, bridge.descriptor.env.FRONDOSE_NATIVE_TOOL_CAPABILITY);
  child.emit('close', 0);
});

test('Claude keeps restricted builtins and allows only exact generated native MCP tools', async (t) => {
  const bridge = await createNativeAgentToolBridge({ listTools: () => [{ name: 'reviews.record', inputSchema: { type: 'object' } }, { name: 'outputs.read', inputSchema: { type: 'object' } }], callTool: () => ({}), expiresAt: Date.now() + 30_000 });
  t.after(() => bridge.close());
  const child = fakeProcess(); let launch;
  const { service, directory } = fixture(t, { execute: async () => ({ code: 0, stdout: '{"loggedIn":true}' }), spawnProcess: (command, args, options) => { launch = { command, args, options }; return child; } });
  await service.connect('claude', { method: 'existing' });
  await assert.rejects(service.startRun({ provider: 'claude', prompt: 'Review', cwd: directory, nativeToolBridge: bridge.descriptor }), {code:'claude_bridge_api_key_required'});
  const keyed = fixture(t, {env:{ANTHROPIC_API_KEY:'fixture-key-not-real'},execute: async()=>({code:0,stdout:'{"loggedIn":true}'}),spawnProcess:(command,args,options)=>{launch={command,args,options};return child;}}).service;
  await keyed.connect('claude',{method:'existing'});
  await keyed.startRun({ provider: 'claude', prompt: 'Review', cwd: directory, nativeToolBridge: bridge.descriptor });
  assert.equal(launch.args[launch.args.indexOf('--tools') + 1], 'Read,Glob,Grep');
  assert.equal(launch.args.includes('--disallowedTools'), false);
  assert.ok(launch.args.includes('mcp__frondose__reviews.record'));
  assert.ok(launch.args.includes('mcp__frondose__outputs.read'));
  const config = JSON.parse(launch.args[launch.args.indexOf('--mcp-config') + 1]);
  assert.deepEqual(Object.keys(config.mcpServers), ['frondose']);
  assert.equal(JSON.stringify(config).includes(bridge.descriptor.env.FRONDOSE_NATIVE_TOOL_CAPABILITY), false);
  assert.equal(launch.options.env.FRONDOSE_NATIVE_TOOL_CAPABILITY, bridge.descriptor.env.FRONDOSE_NATIVE_TOOL_CAPABILITY);
  assert.ok(launch.args.includes('--bare')); assert.ok(launch.args.includes('--restricted'));
  child.emit('close', 0);
});

test('native bridge descriptor tampering and reserved Codex server collisions fail before spawn', async (t) => {
  const bridge = await createNativeAgentToolBridge({ listTools: () => [{ name: 'documents.read', inputSchema: { type: 'object' } }], callTool: () => ({}), expiresAt: Date.now() + 30_000 });
  t.after(() => bridge.close());
  let spawns = 0;
  const { service, directory } = fixture(t, { execute: async (_command, args) => ({ code: 0, stdout: args.includes('mcp') ? '[{"name":"frondose","enabled":true}]' : 'Logged in' }), spawnProcess: () => { spawns++; return fakeProcess(); } });
  await service.connect('codex', { method: 'existing' });
  await assert.rejects(service.startRun({ provider: 'codex', prompt: 'Work', cwd: directory, nativeToolBridge: { ...bridge.descriptor, command: '/tmp/untrusted' } }), { code: 'invalid_native_tool_bridge' });
  await assert.rejects(service.startRun({ provider: 'codex', prompt: 'Work', cwd: directory, nativeToolBridge: bridge.descriptor }), { code: 'provider_configuration' });
  assert.equal(spawns, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import { createServer } from 'node:http';
import {
  requireRunnerNodeVersion, validateRunnerServer, defaultRunnerHome,
  readRunnerConfig, writeRunnerConfig, forgetRunnerConfig, getRunnerStatus,
  runnerRequest, readPairingCode, pairRunner, sendRunnerHeartbeat, runRunnerHelper, main,
} from '../scripts/frondose-runner.mjs';

const TOKEN = 'T'.repeat(43);
const PAIRING_CODE = 'C'.repeat(43);
const config = { version: 1, server: 'https://frondose.example', runner_id: 'runner_fixture', credential: TOKEN, platform: 'linux', architecture: 'x64' };
const jsonResponse = (result, init) => new Response(JSON.stringify({ result }), init);

async function storageFixture(t) {
  const base = await mkdtemp(path.join(await realpath(os.tmpdir()), 'frondose-helper-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, directory: path.join(base, 'runner') };
}

test('helper requires supported Node releases with corrected Windows file identity', () => {
  for (const version of ['20.19.0', '22.15.9', '22.16.0', '23.0.0', '22.invalid', 'invalid']) assert.throws(() => requireRunnerNodeVersion(version), /22.17/u);
  for (const version of ['22.17.0', '22.20.0', '24.0.0', '25.8.2']) assert.doesNotThrow(() => requireRunnerNodeVersion(version));
});

test('server origin accepts HTTPS and loopback HTTP, rejects credentials and redirect-capable components', () => {
  assert.equal(validateRunnerServer('https://frondose.example/'), 'https://frondose.example');
  assert.equal(validateRunnerServer('http://127.0.0.1:4174'), 'http://127.0.0.1:4174');
  assert.equal(validateRunnerServer('http://localhost:4174'), 'http://localhost:4174');
  assert.equal(validateRunnerServer('http://[::1]:4174'), 'http://[::1]:4174');
  for (const value of ['http://frondose.example', 'https://user:secret@frondose.example', 'https://frondose.example/path', 'https://frondose.example/path/..', 'https://frondose.example/?x=1', 'https://frondose.example/#fragment', 'https://frondose.example?', 'https://frondose.example#', 'file:///private', 'https://frondose.example\n', 'not a url']) {
    assert.throws(() => validateRunnerServer(value), /origin|HTTPS/u, value);
  }
});

test('default storage follows macOS, Windows and Linux appdata with an explicit private override', () => {
  assert.equal(defaultRunnerHome({ platform: 'darwin', env: {}, userHome: '/Users/example' }), '/Users/example/Library/Application Support/Frondose/runner');
  assert.equal(defaultRunnerHome({ platform: 'linux', env: {}, userHome: '/home/example' }), '/home/example/.local/share/frondose/runner');
  assert.equal(defaultRunnerHome({ platform: 'linux', env: { XDG_DATA_HOME: '/data' }, userHome: '/home/example' }), '/data/frondose/runner');
  assert.equal(defaultRunnerHome({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local' }, userHome: 'C:\\Users\\example' }), 'C:\\Users\\example\\AppData\\Local\\Frondose\\runner');
  assert.equal(defaultRunnerHome({ platform: 'linux', env: { FRONDOSE_RUNNER_HOME: '/private/runner' }, userHome: '/home/example' }), '/private/runner');
  for (const override of ['relative', '/', '/tmp/..']) assert.throws(() => defaultRunnerHome({ platform: 'linux', env: { FRONDOSE_RUNNER_HOME: override }, userHome: '/home/example' }));
  assert.throws(() => defaultRunnerHome({ platform: 'freebsd', env: {}, userHome: '/home/example' }), /supports/u);
});

test('saved credentials use private modes, sanitized status and explicit local forgetting', async (t) => {
  const { directory } = await storageFixture(t);
  assert.equal(await readRunnerConfig(directory), null);
  await writeRunnerConfig(directory, config);
  assert.deepEqual(await readRunnerConfig(directory), config);
  if (process.platform !== 'win32') {
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);
    assert.equal((await lstat(path.join(directory, 'connection.json'))).mode & 0o777, 0o600);
  }
  const status = await getRunnerStatus(directory);
  assert.equal(status.configured, true);
  assert.equal(status.execution_available, false);
  assert.equal(status.connection_state, 'not_checked');
  assert.equal(JSON.stringify(status).includes(TOKEN), false);
  assert.equal('credential' in status, false);
  await assert.rejects(writeRunnerConfig(directory, config), /already/u);
  assert.equal(await forgetRunnerConfig(directory), true);
  assert.equal(await forgetRunnerConfig(directory), false);
  assert.deepEqual(await getRunnerStatus(directory), { configured: false, execution_available: false });
});

test('storage rejects symlink directories, symlink credentials, hardlinks and nonprivate POSIX files', async (t) => {
  const { base, directory } = await storageFixture(t);
  await writeRunnerConfig(directory, config);
  const aliased = path.join(base, 'alias');
  try { await symlink(directory, aliased, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows fixture lacks link privilege'); return; } throw error; }
  await assert.rejects(readRunnerConfig(aliased), /symbolic/u);
  const destination = path.join(base, 'second');
  await mkdir(destination, { mode: 0o700 });
  try {
    await symlink(path.join(directory, 'connection.json'), path.join(destination, 'connection.json'));
    await assert.rejects(readRunnerConfig(destination), /private regular/u);
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') t.diagnostic('Windows host does not grant file-symlink privilege; junction refusal and hardlink checks are still tested.');
    else throw error;
  }
  const hardlink = path.join(base, 'copied-link');
  await link(path.join(directory, 'connection.json'), hardlink);
  await assert.rejects(readRunnerConfig(directory), /private regular/u);
  await rm(hardlink);
  if (process.platform !== 'win32') {
    await chmod(path.join(directory, 'connection.json'), 0o644);
    await assert.rejects(readRunnerConfig(directory), /private regular/u);
    await chmod(path.join(directory, 'connection.json'), 0o600);
    await chmod(directory, 0o755);
    await assert.rejects(readRunnerConfig(directory), /0700/u);
  }
});

test('HTTP helper sets exact Origin/JSON/Bearer headers and prohibits redirects', async () => {
  let captured;
  const result = await runnerRequest(config.server, '/api/runner-transport/runner_fixture/heartbeat', { runtimes: [] }, {
    credential: TOKEN,
    fetchImpl: async (...args) => { captured = args; return jsonResponse({ state: 'connected', execution_available: true }); },
  });
  assert.equal(captured[0], 'https://frondose.example/api/runner-transport/runner_fixture/heartbeat');
  assert.equal(captured[1].redirect, 'error');
  assert.equal(captured[1].headers.Origin, 'https://frondose.example');
  assert.equal(captured[1].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(captured[1].headers['Content-Type'], 'application/json');
  assert.ok(captured[1].signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(captured[1].body), { runtimes: [] });
  assert.equal(result.state, 'connected');
});

test('HTTP errors and network exceptions cannot echo credentials or arbitrary server text', async () => {
  for (const fetchImpl of [
    async () => new Response(TOKEN, { status: 401 }),
    async () => { throw new Error(`private ${TOKEN}`); },
    async () => new Response(TOKEN, { status: 200 }),
  ]) {
    await assert.rejects(runnerRequest(config.server, '/api/runner-transport/claim', {}, { fetchImpl }), (error) => !error.message.includes(TOKEN));
  }
  await assert.rejects(runnerRequest(config.server, '//evil.example', {}, {}), /endpoint/u);
});

test('real loopback HTTP transport sends isolated fixture inventory, never account credentials', async (t) => {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = { url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ result: { state: 'connected', next_heartbeat_ms: 30_000 } }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const result = await sendRunnerHeartbeat({ ...config, server: origin }, { discover: async () => [{ providerId: 'pi', state: 'not_found' }] });
  assert.equal(result.state, 'connected');
  assert.equal(received.headers.origin, origin);
  assert.equal(received.headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(received.body, { runtimes: [{ id: 'pi', state: 'not_found' }] });
  assert.equal(JSON.stringify(received.body).includes(TOKEN), false);
});

test('HTTP response size limits cover declared and streamed bodies', async () => {
  await assert.rejects(runnerRequest(config.server, '/api/runner-transport/claim', {}, {
    fetchImpl: async () => new Response('{}', { headers: { 'Content-Length': String(1024 * 1024 + 1) } }),
  }), /oversized/u);
  await assert.rejects(runnerRequest(config.server, '/api/runner-transport/claim', {}, {
    fetchImpl: async () => new Response('x'.repeat(1024 * 1024 + 1)),
  }), /oversized/u);
});

test('pairing reads a code from the reader only, stores token privately and does not launch inventory', async (t) => {
  const { directory } = await storageFixture(t);
  let calls = 0;
  const result = await pairRunner({
    server: config.server, directory, platform: 'linux', architecture: 'x64', readCode: async () => PAIRING_CODE,
    fetchImpl: async (url, request) => {
      calls += 1;
      assert.ok(url.endsWith('/claim'));
      assert.equal(request.headers.Authorization, undefined);
      assert.deepEqual(JSON.parse(request.body), { code: PAIRING_CODE, platform: 'linux', architecture: 'x64' });
      return jsonResponse({ runner_id: config.runner_id, credential: TOKEN, state: 'approval_required' });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { runner_id: config.runner_id, state: 'approval_required', execution_available: false });
  assert.equal((await readRunnerConfig(directory)).credential, TOKEN);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('pairing code reader does not print the supplied code', async () => {
  const input = new PassThrough();
  let output = '';
  const sink = new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } });
  const waiting = readPairingCode({ input, output: sink });
  input.end(PAIRING_CODE + '\n');
  assert.equal(await waiting, PAIRING_CODE);
  assert.equal(output.includes(PAIRING_CODE), false);
});

test('heartbeat sends only provider IDs/states, strips local paths and cannot enable execution', async () => {
  const result = await sendRunnerHeartbeat(config, {
    discover: async () => [{ providerId: 'codex', state: 'installed', executables: [{ path: '/private/user/secret-agent' }], authenticated: true }],
    fetchImpl: async (_url, request) => {
      assert.deepEqual(JSON.parse(request.body), { runtimes: [{ id: 'codex', state: 'installed' }] });
      assert.equal(request.body.includes('/private'), false);
      return jsonResponse({ state: 'connected', execution_available: true, next_heartbeat_ms: 1 });
    },
  });
  assert.equal(result.execution_available, false);
  assert.equal(result.next_heartbeat_ms, 30_000);
  assert.equal(result.installed_count, 1);
});

test('run once handles pending browser approval without executing anything', async (t) => {
  const { directory } = await storageFixture(t);
  await writeRunnerConfig(directory, config);
  const states = [];
  const result = await runRunnerHelper({ directory, once: true, discover: async () => [], onStatus: (state) => states.push(state), fetchImpl: async () => jsonResponse({ state: 'approval_required' }) });
  assert.equal(result.state, 'approval_required');
  assert.equal(states.length, 1);
  assert.equal(result.execution_available, false);
});

test('continuous helper uses bounded backoff and can be cancelled without a real sleep', async (t) => {
  const { directory } = await storageFixture(t);
  await writeRunnerConfig(directory, config);
  const controller = new AbortController();
  const delays = [];
  const result = await runRunnerHelper({
    directory, signal: controller.signal, discover: async () => [],
    fetchImpl: async () => { throw new Error(`secret ${TOKEN}`); },
    wait: async (delay) => { delays.push(delay); if (delays.length === 6) controller.abort(); },
  });
  assert.deepEqual(delays, [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  assert.equal(result.state, 'stopped');
});

test('revocation/authentication failure stops retries', async (t) => {
  const { directory } = await storageFixture(t);
  await writeRunnerConfig(directory, config);
  let waits = 0;
  await assert.rejects(runRunnerHelper({ directory, discover: async () => [], wait: async () => { waits += 1; }, fetchImpl: async () => new Response('{}', { status: 401 }) }), /401/u);
  assert.equal(waits, 0);
});

test('CLI status and local disconnect redact credentials; pairing codes cannot be CLI arguments', async (t) => {
  const { directory } = await storageFixture(t);
  await writeRunnerConfig(directory, config);
  let output = '';
  const sink = { write(chunk) { output += chunk; } };
  await main(['status'], { directory, output: sink });
  assert.equal(output.includes(TOKEN), false);
  assert.equal(output.includes('runner_fixture'), true);
  await assert.rejects(main(['pair', '--server', config.server, '--code', PAIRING_CODE], { directory, output: sink }), /Usage/u);
  assert.equal(output.includes(PAIRING_CODE), false);
  await main(['disconnect'], { directory, output: sink });
  assert.match(output, /Revoke this computer in Frondose/u);
  assert.equal(await readRunnerConfig(directory), null);
});

test('CLI help succeeds without opening storage, pairing or contacting a server', async () => {
  for (const option of ['--help', '-h', 'help']) {
    let output = '';
    await main([option], { directory: 'not-an-absolute-storage-path', output: { write: chunk => { output += chunk; } }, fetchImpl: () => { throw Error('Must not contact a server'); } });
    assert.match(output, /Usage:/u); assert.match(output, /Discovery only/u);
  }
});

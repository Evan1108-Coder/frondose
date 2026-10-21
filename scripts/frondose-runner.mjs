#!/usr/bin/env node
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { discoverRunnerProviders } from '../server/runner-process.mjs';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const CONFIG_NAME = 'connection.json';
const SAFE_ID = /^runner_[A-Za-z0-9_-]{1,64}$/u;
const SECRET = /^[A-Za-z0-9_-]{43}$/u;
const PLATFORMS = new Set(['darwin', 'win32', 'linux']);
const USAGE = 'Usage: pair --server https://frondose.com | status | run [--once] | disconnect. Pairing codes are read from stdin, never command arguments.';

function fail(message, code = 'runner_error') {
  return Object.assign(new Error(message), { code });
}

export function requireRunnerNodeVersion(version = process.versions.node) {
  const [major, minor] = String(version).split('.').map(Number);
  if (!Number.isInteger(major) || major < 22 || major === 23 || (major === 22 && (!Number.isInteger(minor) || minor < 17))) {
    throw fail('Frondose helper requires Node.js 22.17+ or 24+. Older Node 22 releases have a Windows file-identity bug.', 'node_version');
  }
}

export function validateRunnerServer(value) {
  let url;
  try { url = new URL(value); } catch { throw fail('Enter a valid Frondose server origin.', 'invalid_origin'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (typeof value !== 'string' || !/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+\/?$/iu.test(value) || /[\x00-\x20\x7f?#]/u.test(value) || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw fail('Use an HTTPS server origin without credentials, path, query or fragment. HTTP is allowed only on loopback.', 'invalid_origin');
  }
  return url.origin;
}

export function defaultRunnerHome({ platform = process.platform, env = process.env, userHome = os.homedir() } = {}) {
  if (!PLATFORMS.has(platform)) throw fail('This helper currently supports macOS, Windows and Linux.', 'unsupported_platform');
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const overridden = env.FRONDOSE_RUNNER_HOME;
  const root = overridden || (platform === 'win32'
    ? pathApi.join(env.LOCALAPPDATA || pathApi.join(userHome, 'AppData', 'Local'), 'Frondose', 'runner')
    : platform === 'darwin'
      ? pathApi.join(userHome, 'Library', 'Application Support', 'Frondose', 'runner')
      : pathApi.join(env.XDG_DATA_HOME || pathApi.join(userHome, '.local', 'share'), 'frondose', 'runner'));
  if (typeof root !== 'string' || !pathApi.isAbsolute(root) || /[\0\r\n]/u.test(root) || pathApi.parse(root).root === pathApi.normalize(root)) {
    throw fail('Runner storage must be an absolute private application directory, not a filesystem root.', 'invalid_storage');
  }
  return pathApi.normalize(root);
}

async function statOrNull(target) {
  // NTFS file IDs may exceed Number.MAX_SAFE_INTEGER. Never compare rounded
  // numeric IDs for the lstat/open race fence (notably Node 22 on Windows).
  try { return await lstat(target, { bigint: true }); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function ensureStorageDirectory(directory, { create = false } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory === path.parse(directory).root || /[\0\r\n]/u.test(directory)) {
    throw fail('Invalid helper storage directory.', 'invalid_storage');
  }
  const normalized = path.normalize(directory);
  const parsed = path.parse(normalized);
  const components = normalized.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const component of components) {
    current = path.join(current, component);
    let entry = await statOrNull(current);
    if (!entry && create) {
      try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      entry = await statOrNull(current);
    }
    if (!entry) return false;
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw fail('Runner storage cannot contain symbolic links or non-directory parents.', 'unsafe_storage');
  }
  const stat = await lstat(normalized, { bigint: true });
  if (typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid())) throw fail('Runner storage must be owned by the current user.', 'unsafe_storage');
  if (process.platform !== 'win32' && (stat.mode & 0o077n)) {
    throw fail('Runner storage must be private (directory mode 0700).', 'unsafe_storage');
  }
  return true;
}

function validateConfig(value) {
  if (!value || value.version !== 1 || !SAFE_ID.test(value.runner_id || '') || !SECRET.test(value.credential || '') ||
      !PLATFORMS.has(value.platform) || typeof value.architecture !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/u.test(value.architecture)) {
    throw fail('Invalid saved helper configuration. Revoke the computer in Frondose and pair again.', 'invalid_config');
  }
  return {
    version: 1,
    server: validateRunnerServer(value.server),
    runner_id: value.runner_id,
    credential: value.credential,
    platform: value.platform,
    architecture: value.architecture,
  };
}

async function checkConfigStat(entry) {
  if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1n || entry.size > 64n * 1024n ||
      (typeof process.getuid === 'function' && entry.uid !== BigInt(process.getuid())) ||
      (process.platform !== 'win32' && (entry.mode & 0o077n))) {
    throw fail('Helper credentials must be a private regular file, not a link or shared file.', 'unsafe_storage');
  }
}

export async function readRunnerConfig(directory = defaultRunnerHome()) {
  if (!(await ensureStorageDirectory(directory))) return null;
  const target = path.join(directory, CONFIG_NAME);
  const entry = await statOrNull(target);
  if (!entry) return null;
  await checkConfigStat(entry);
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat({ bigint: true });
    await checkConfigStat(opened);
    if (entry.ino !== opened.ino || entry.dev !== opened.dev) throw fail('Helper credential file changed while opening.', 'unsafe_storage');
    let value;
    try { value = JSON.parse(await handle.readFile({ encoding: 'utf8' })); }
    catch { throw fail('Saved helper configuration is invalid.', 'invalid_config'); }
    return validateConfig(value);
  } finally { await handle.close(); }
}

export async function writeRunnerConfig(directory, value) {
  const config = validateConfig(value);
  await ensureStorageDirectory(directory, { create: true });
  const target = path.join(directory, CONFIG_NAME);
  if (await statOrNull(target)) throw fail('This helper already has saved credentials. Disconnect locally before pairing again.', 'already_paired');
  const temporary = path.join(directory, `.connection-${randomBytes(16).toString('hex')}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(config) + '\n', 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    await ensureStorageDirectory(directory);
    if (await statOrNull(target)) throw fail('Saved helper credentials changed while pairing.', 'already_paired');
    // Atomic publish without overwriting an existing configuration or following
    // a destination symlink if another helper pairs at the same time.
    await link(temporary, target);
    // chmod is meaningful on POSIX. Windows uses the per-user application
    // directory's inherited ACL; Node mode bits are not an ACL audit.
    await chmod(target, 0o600);
  } finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function forgetRunnerConfig(directory = defaultRunnerHome()) {
  const config = await readRunnerConfig(directory);
  if (!config) return false;
  await ensureStorageDirectory(directory);
  await unlink(path.join(directory, CONFIG_NAME));
  return true;
}

export async function getRunnerStatus(directory = defaultRunnerHome()) {
  const config = await readRunnerConfig(directory);
  return config ? {
    configured: true,
    server: config.server,
    runner_id: config.runner_id,
    platform: config.platform,
    architecture: config.architecture,
    connection_state: 'not_checked',
    execution_available: false,
  } : { configured: false, execution_available: false };
}

export async function runnerRequest(server, endpoint, body, {
  credential,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = 20_000,
} = {}) {
  const origin = validateRunnerServer(server);
  if (typeof endpoint !== 'string' || !/^\/api\/runner-transport\/[A-Za-z0-9_/-]+$/u.test(endpoint)) throw fail('Invalid helper endpoint.', 'invalid_endpoint');
  if (credential !== undefined && !SECRET.test(credential)) throw fail('Invalid helper credential.', 'invalid_config');
  const combinedSignal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  let response;
  try {
    response = await fetchImpl(origin + endpoint, {
      method: 'POST', redirect: 'error', signal: combinedSignal,
      headers: { 'Content-Type': 'application/json', Origin: origin, ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
      body: JSON.stringify(body),
    });
    const declaredSize = Number(response.headers.get('content-length'));
    if (declaredSize > MAX_RESPONSE_BYTES) throw fail('Frondose returned an oversized response.', 'response_too_large');
    const chunks = [];
    let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) throw fail('Frondose returned an oversized response.', 'response_too_large');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    if (!response.ok) throw Object.assign(fail(`Frondose request failed (HTTP ${response.status}).`, 'http_error'), { status: response.status });
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw fail('Frondose returned invalid JSON.', 'invalid_response'); }
    if (!data || !data.result || typeof data.result !== 'object') throw fail('Frondose returned an invalid helper response.', 'invalid_response');
    return data.result;
  } catch (error) {
    // Never expose arbitrary provider/server messages, request bodies or tokens.
    if (['http_error', 'response_too_large', 'invalid_response'].includes(error.code)) throw error;
    if (signal?.aborted) throw fail('Helper stopped.', 'cancelled');
    throw fail('Cannot reach Frondose securely. Check the server and network, then retry.', 'network_error');
  }
}

export async function readPairingCode({ input = process.stdin, output = process.stdout } = {}) {
  output.write('Pairing code (hidden): ');
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const reader = createInterface({ input, output: muted, terminal: Boolean(input.isTTY) });
  try {
    return await new Promise((resolve, reject) => {
      reader.once('SIGINT', () => reject(fail('Pairing cancelled.', 'cancelled')));
      reader.once('close', () => reject(fail('No pairing code was supplied.', 'cancelled')));
      reader.question('', (answer) => resolve(answer.trim()));
    });
  } finally { reader.close(); output.write('\n'); }
}

export async function pairRunner({ server, directory = defaultRunnerHome(), readCode = readPairingCode, platform = process.platform, architecture = process.arch, ...requestOptions }) {
  const origin = validateRunnerServer(server);
  if (!PLATFORMS.has(platform)) throw fail('Unsupported helper platform.', 'unsupported_platform');
  await ensureStorageDirectory(directory, { create: true });
  if (await readRunnerConfig(directory)) throw fail('This helper is already paired. Disconnect locally before pairing again.', 'already_paired');
  const code = await readCode();
  if (typeof code !== 'string' || !SECRET.test(code)) throw fail('Enter the complete pairing code shown in Frondose.', 'invalid_pairing');
  const result = await runnerRequest(origin, '/api/runner-transport/claim', { code, platform, architecture }, requestOptions);
  if (result.state !== 'approval_required') throw fail('Unexpected pairing state. Return to Frondose and check this computer.', 'invalid_response');
  await writeRunnerConfig(directory, { version: 1, server: origin, runner_id: result.runner_id, credential: result.credential, platform, architecture });
  return { runner_id: result.runner_id, state: 'approval_required', execution_available: false };
}

export async function sendRunnerHeartbeat(config, { discover = discoverRunnerProviders, ...requestOptions } = {}) {
  const validated = validateConfig(config);
  const inventory = await discover();
  if (!Array.isArray(inventory) || inventory.length > 100) throw fail('Invalid local runtime inventory.', 'invalid_inventory');
  const runtimes = inventory.map((item) => ({ id: item.providerId || item.id, state: item.state }));
  const result = await runnerRequest(validated.server, `/api/runner-transport/${validated.runner_id}/heartbeat`, { runtimes }, { ...requestOptions, credential: validated.credential });
  if (!['approval_required', 'connected', 'revoked'].includes(result.state)) throw fail('Unexpected heartbeat state.', 'invalid_response');
  return {
    state: result.state,
    execution_available: false,
    installed_count: runtimes.filter((item) => item.state === 'installed').length,
    next_heartbeat_ms: Math.max(30_000, Math.min(120_000, Number(result.next_heartbeat_ms) || 30_000)),
  };
}

export async function runRunnerHelper({ directory = defaultRunnerHome(), once = false, signal, onStatus = () => {}, wait = sleep, ...requestOptions } = {}) {
  const config = await readRunnerConfig(directory);
  if (!config) throw fail('This helper is not paired. Run pair first.', 'not_paired');
  let failures = 0;
  let lastState;
  while (!signal?.aborted) {
    let delay = 30_000;
    try {
      const result = await sendRunnerHeartbeat(config, { ...requestOptions, signal });
      failures = 0;
      delay = result.next_heartbeat_ms;
      if (result.state !== lastState || once) onStatus(result);
      lastState = result.state;
      if (result.state === 'revoked' || once) return result;
    } catch (error) {
      if (error.code === 'cancelled' || signal?.aborted) return { state: 'stopped', execution_available: false };
      if (once || [401, 403, 404].includes(error.status)) throw error;
      failures += 1;
      delay = Math.min(300_000, 30_000 * (2 ** Math.min(failures - 1, 4)));
      onStatus({ state: 'retrying', execution_available: false, retry_in_ms: delay });
    }
    try { await wait(delay, undefined, { signal }); }
    catch { if (signal?.aborted) break; throw fail('Helper wait failed.', 'runner_error'); }
  }
  return { state: 'stopped', execution_available: false };
}

export async function main(argv = process.argv.slice(2), { output = process.stdout, signal, ...options } = {}) {
  requireRunnerNodeVersion();
  const [command, ...args] = argv;
  if (['--help', '-h', 'help'].includes(command) && !args.length) {
    output.write(`${USAGE}\nDiscovery only: remote AI execution is not enabled.\n`);
    return;
  }
  const directory = options.directory || defaultRunnerHome();
  if (command === 'pair' && args.length === 2 && args[0] === '--server') {
    await pairRunner({ ...options, directory, server: args[1], signal });
    output.write('Computer claim saved. Approve this computer in Frondose, then run: node scripts/frondose-runner.mjs run\nDiscovery only: remote AI execution is not enabled.\n');
  } else if (command === 'status' && args.length === 0) {
    output.write(JSON.stringify(await getRunnerStatus(directory), null, 2) + '\n');
  } else if (command === 'run' && (args.length === 0 || (args.length === 1 && args[0] === '--once'))) {
    await runRunnerHelper({ ...options, directory, signal, once: args[0] === '--once', onStatus: (state) => output.write(JSON.stringify(state) + '\n') });
  } else if (command === 'disconnect' && args.length === 0) {
    const removed = await forgetRunnerConfig(directory);
    output.write(removed ? 'Local helper credentials removed. Revoke this computer in Frondose to invalidate its server registration.\n' : 'No local helper credentials are saved.\n');
  } else {
    throw fail(USAGE, 'usage');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  main(undefined, { signal: controller.signal }).catch((error) => {
    process.stderr.write((['runner_error', 'node_version', 'invalid_origin', 'invalid_storage', 'unsafe_storage', 'invalid_config', 'already_paired', 'invalid_pairing', 'invalid_response', 'http_error', 'network_error', 'response_too_large', 'not_paired', 'usage', 'unsupported_platform', 'cancelled'].includes(error.code) ? error.message : 'Frondose helper failed. Check private storage and server configuration.') + '\n');
    process.exitCode = error.code === 'cancelled' ? 0 : 1;
  }).finally(() => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  });
}

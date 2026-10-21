import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { resolveRunnerExecutable, discoverRunnerProviders, prepareRunnerLaunch, spawnRunnerProcess } from '../server/runner-process.mjs';
import { getRunnerProvider } from '../src/lib/runner-provider-catalog.js';

function fixtureFileSystem(files) {
  const available = new Set(files.map((value) => value.toLowerCase()));
  return {
    async stat(candidate) {
      if (!available.has(candidate.toLowerCase())) throw Object.assign(new Error('missing fixture'), { code: 'ENOENT' });
      return { isFile: () => true };
    },
    async access(candidate) {
      assert.ok(available.has(candidate.toLowerCase()));
    },
  };
}

test('filesystem-only PATH discovery finds an executable and ignores empty/relative PATH entries', { skip: process.platform === 'win32' ? 'POSIX executable-bit fixture; Windows resolution has separate fixtures below.' : false }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'frondose-runner-path-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = path.join(directory, 'fixture-agent');
  await writeFile(binary, 'not executed');
  await chmod(binary, 0o700);
  const result = await resolveRunnerExecutable('fixture-agent', { platform: 'darwin', env: { PATH: `:relative:${directory}` } });
  assert.equal(result.path, binary);
  assert.equal(result.kind, 'native');
  assert.equal(await resolveRunnerExecutable('missing', { platform: 'linux', env: { PATH: directory } }), null);
});

test('POSIX discovery rejects directories and non-executable regular files', { skip: process.platform === 'win32' ? 'Windows does not use POSIX executable bits; Windows extension resolution is tested separately.' : false }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'frondose-runner-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'directory-agent'));
  await writeFile(path.join(directory, 'not-executable'), 'fixture');
  await chmod(path.join(directory, 'not-executable'), 0o600);
  for (const command of ['directory-agent', 'not-executable']) {
    assert.equal(await resolveRunnerExecutable(command, { platform: 'linux', env: { PATH: directory } }), null);
  }
});

test('Windows discovery handles case-insensitive Path/PATHEXT and cmd shims without executing them', async () => {
  const fileSystem = fixtureFileSystem(['C:\\Tools\\agent.cmd']);
  const result = await resolveRunnerExecutable('agent', { platform: 'win32', env: { Path: '.;relative;C:\\Tools', PathExt: '.EXE;.CMD;.PS1' }, fileSystem });
  assert.equal(result.path, 'C:\\Tools\\agent.cmd');
  assert.equal(result.kind, 'batch');
  assert.equal(await resolveRunnerExecutable('agent.ps1', { platform: 'win32', env: {}, fileSystem }), null);
});

test('absolute executable resolution does not require PATH', async () => {
  const result = await resolveRunnerExecutable('C:\\Tools\\agent.CMD', { platform: 'win32', env: {}, fileSystem: fixtureFileSystem(['C:\\Tools\\agent.cmd']) });
  assert.equal(result.path, 'C:\\Tools\\agent.CMD');
});

test('discovery distinguishes a downloader from an installed provider and never infers login', async () => {
  const fileSystem = fixtureFileSystem(['/tools/npx', '/tools/codex']);
  const [gemini, codex] = await discoverRunnerProviders({ providers: [getRunnerProvider('gemini'), getRunnerProvider('codex')], platform: 'linux', env: { PATH: '/tools' }, fileSystem });
  assert.equal(gemini.state, 'launcher_only');
  assert.equal(gemini.installed, false);
  assert.equal(gemini.requiresInstallApproval, true);
  assert.equal(codex.state, 'installed');
  assert.equal(codex.authenticated, null);
  assert.equal(codex.modelAccess, null);
  assert.equal(codex.liveVerified, false);
});

test('unsafe executable path inputs and unsupported platforms are rejected', async () => {
  for (const command of ['', ' agent', './agent', '../agent', 'dir/agent', 'agent\nother', 'agent\0']) {
    await assert.rejects(resolveRunnerExecutable(command, { platform: 'linux', env: {} }));
  }
  await assert.rejects(resolveRunnerExecutable('agent', { platform: 'freebsd', env: {} }), /Unsupported/u);
});

test('native launches retain literal argv without a shell on macOS, Linux and Windows', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const executable = platform === 'win32' ? 'C:\\Tools\\agent.exe' : '/tools/agent';
    const args = ['space value', '$(touch nope)', '%SECRET%', '&other'];
    const result = prepareRunnerLaunch(executable, args, { platform, env: {} });
    assert.equal(result.command, executable);
    assert.deepEqual(result.args, args);
    assert.equal(result.options.shell, false);
    assert.equal(result.options.windowsVerbatimArguments, undefined);
  }
});

test('Windows batch shims use explicit cmd dispatch with delayed expansion disabled', () => {
  const result = prepareRunnerLaunch('C:\\Program Files\\Agent\\agent.cmd', ['--acp', 'space value'], { platform: 'win32', env: { SystemRoot: 'C:\\Windows' } });
  assert.equal(result.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(result.args, ['/d', '/s', '/v:off', '/c', '""C:\\Program Files\\Agent\\agent.cmd" "--acp" "space value""']);
  assert.equal(result.options.shell, false);
  assert.equal(result.options.windowsVerbatimArguments, true);
});

test('Windows batch refuses expansion or shell metacharacters rather than escaping untrusted values', () => {
  for (const argument of ['%SECRET%', '!SECRET!', 'a&b', 'a|b', 'a>b', 'a<b', '^x', '(x)', 'a"b', 'line\nnext', 'a\0b']) {
    assert.throws(() => prepareRunnerLaunch('C:\\Tools\\agent.cmd', [argument], { platform: 'win32', env: {} }), /Unsafe|bounded/u, argument);
  }
  assert.throws(() => prepareRunnerLaunch('C:\\Tools%SECRET%\\agent.cmd', [], { platform: 'win32', env: {} }), /Unsafe/u);
});

test('process preparation bounds argv and requires absolute executable/cwd', () => {
  assert.throws(() => prepareRunnerLaunch('agent', [], { platform: 'linux' }), /absolute/u);
  assert.throws(() => prepareRunnerLaunch('/tools/agent', [], { platform: 'linux', cwd: '../project' }), /absolute/u);
  assert.throws(() => prepareRunnerLaunch('/tools/agent', 'one string', { platform: 'linux' }), /array/u);
  assert.throws(() => prepareRunnerLaunch('/tools/agent', new Array(257).fill('x'), { platform: 'linux' }), /256/u);
  assert.throws(() => prepareRunnerLaunch('/tools/agent', ['x'.repeat(32769)], { platform: 'linux' }), /bounded/u);
});

test('spawn wrapper never accepts shell/stdio overrides from callers', () => {
  let captured;
  const sentinel = {};
  assert.equal(spawnRunnerProcess('/tools/fixture', [], { platform: 'linux', shell: true, stdio: 'inherit', spawnImpl: (...args) => { captured = args; return sentinel; } }), sentinel);
  assert.equal(captured[2].shell, false);
  assert.deepEqual(captured[2].stdio, ['pipe', 'pipe', 'pipe']);
});

test('real fixture process communicates over stdin/stdout without an AI binary or network', async () => {
  const child = spawnRunnerProcess(process.execPath, ['-e', 'process.stdin.once("data", d => process.stdout.write(d))'], { env: {}, cwd: os.tmpdir() });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stdin.end('literal %prompt% & not a shell');
  const [code] = await once(child, 'close');
  assert.equal(code, 0);
  assert.equal(Buffer.concat(chunks).toString(), 'literal %prompt% & not a shell');
});

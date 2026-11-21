import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile, open, opendir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, relative, sep } from 'node:path';
import { terminalDiscoveryEnvironment, terminalInstallDirectories, pairTerminalRuntimePath } from '../server/terminal-install-discovery.mjs';
import { createTerminalLaunchPlan, detectTerminalProviders } from '../server/terminal-launch-plan.mjs';

async function fixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-cli-discovery-test-'));
  try { await callback(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function nvm(home, versions, aliases = {}) {
  for (const version of versions) await mkdir(join(home, '.nvm', 'versions', 'node', version, 'bin'), { recursive: true });
  for (const [name, value] of Object.entries(aliases)) { const file = join(home, '.nvm', 'alias', name); await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, value); }
}
const nvmPaths = paths => paths.filter(value => value.includes('/.nvm/versions/node/'));
const virtualHome = '/fixture/home';
async function posixFixture(actualHome) {
  const canonicalHome = await realpath(actualHome);
  const local = value => join(canonicalHome, ...posix.relative(virtualHome, value).split('/'));
  return {
    open: (...args) => open(local(args[0]), ...args.slice(1)),
    opendir: value => opendir(local(value)),
    realpath: async value => posix.resolve(virtualHome, relative(canonicalHome, await realpath(local(value))).split(sep).join('/')),
  };
}
const fixtureNvmPaths = async home => nvmPaths(await terminalInstallDirectories({ platform: 'linux', env: { HOME: virtualHome }, fileSystem: await posixFixture(home) }));

test('cold-GUI fallback preserves Orca attribution and original source hashes', async () => {
  const source = await readFile(new URL('../server/terminal-install-discovery.mjs', import.meta.url), 'utf8');
  for (const value of ['Copyright (c) 2026 Lovecast Inc., MIT', '51dcef8258230ffea85a907130450b0ad676e22b', 'f2fc5da77d06ff593e867ce5907ffc006daacf487ea65ecba2d96ec26a06ecbe', '0635cf902acdea8f75f0fc306d61d08e3fe583df967d0de62051d35523b663e7', 'd19922edb378e7fb3c908dc4779a1a214d19d5a26b9fc111ee11344cc5574c70']) assert.ok(source.includes(value));
  assert.doesNotMatch(source, /execFile|spawn\(|login.?shell|readFile\(.*zshrc/);
});

test('platform-specific fallback paths include version managers without Linux/Homebrew crossover', async () => {
  const darwin = await terminalInstallDirectories({ platform: 'darwin', env: { HOME: '/fixture/home' } });
  for (const value of ['/fixture/home/.volta/bin', '/fixture/home/.asdf/shims', '/fixture/home/.fnm/aliases/default/bin', '/fixture/home/.local/share/mise/shims', '/fixture/home/Library/pnpm', '/fixture/home/.bun/bin', '/fixture/home/.cargo/bin', '/opt/homebrew/bin', '/fixture/home/.opencode/bin']) assert.ok(darwin.includes(value));
  assert.equal(darwin.includes('/snap/bin'), false);
  const linux = await terminalInstallDirectories({ platform: 'linux', env: { HOME: '/fixture/home' } });
  assert.ok(linux.includes('/fixture/home/.local/share/pnpm')); assert.ok(linux.includes('/snap/bin')); assert.equal(linux.includes('/opt/homebrew/bin'), false);
  const windows = await terminalInstallDirectories({ platform: 'win32', env: { UserProfile: 'D:\\Users\\Me', AppData: 'E:\\Roaming', LocalAppData: 'E:\\Local' } });
  for (const value of ['D:\\Users\\Me\\.local\\bin', 'E:\\Roaming\\npm', 'E:\\Local\\pnpm', 'E:\\Local\\Yarn\\bin']) assert.ok(windows.includes(value));
  assert.ok(windows.every(value => !value.startsWith('/')));
});

test('inherited absolute PATH precedence is retained with bounded deduplicated fallback and no cwd lookup', async () => {
  const env = { HOME: '/fixture/home', PATH: '/custom/bin:/usr/local/bin:/custom/bin:.:relative::/fixture/home/.local/bin' };
  const result = await terminalDiscoveryEnvironment({ platform: 'linux', env });
  assert.ok(result.PATH.startsWith('/custom/bin:/usr/local/bin:/fixture/home/.local/bin:'));
  assert.equal(result.PATH.split(':').includes('.'), false); assert.equal(result.PATH.split(':').includes('relative'), false);
  assert.equal(result.PATH.split(':').filter(value => value === '/usr/local/bin').length, 1);
  assert.equal(env.PATH, '/custom/bin:/usr/local/bin:/custom/bin:.:relative::/fixture/home/.local/bin');
  const many = await terminalDiscoveryEnvironment({ platform: 'linux', env: { HOME: '/fixture/home', PATH: Array.from({ length: 100 }, (_, index) => `/bin/${index}`).join(':') } });
  assert.ok(many.PATH.split(':').includes('/bin/63')); assert.equal(many.PATH.split(':').includes('/bin/64'), false);
});

test('Windows lookup canonicalizes PATH once and deduplicates casing while keeping owner order', async () => {
  const result = await terminalDiscoveryEnvironment({ platform: 'win32', env: { Path: 'C:\\Tools;c:\\tools;relative;D:\\Other', UserProfile: 'C:\\Users\\Me' } });
  assert.deepEqual(Object.keys(result).filter(key => key.toLowerCase() === 'path'), ['PATH']);
  assert.ok(result.PATH.startsWith('C:\\Tools;D:\\Other;')); assert.equal(result.PATH.includes('relative'), false);
});

test('nvm default and bounded alias chains prefer the selected installed version, then newest fallbacks', async () => fixture(async home => {
  await nvm(home, ['v22.9.0', 'v24.18.0', 'v26.7.0'], { default: 'lts/current', 'lts/current': '24' });
  const paths = await fixtureNvmPaths(home);
  assert.deepEqual(paths.map(value => value.split('/').at(-2)), ['v24.18.0', 'v26.7.0', 'v22.9.0']);
}));

test('invalid versions, cyclic/traversing aliases and overlong aliases never add foreign directories', async () => fixture(async home => {
  await nvm(home, ['v22.0.0', 'v26.0.0', 'not-a-version', 'v024.0.0'], { default: 'cycle', cycle: 'default' });
  let paths = await fixtureNvmPaths(home);
  assert.deepEqual(paths.map(value => value.split('/').at(-2)), ['v26.0.0', 'v22.0.0']);
  for (const alias of ['../../outside', '024', 'x'.repeat(2000)]) {
    await writeFile(join(home, '.nvm', 'alias', 'default'), alias);
    paths = await fixtureNvmPaths(home);
    assert.deepEqual(paths.map(value => value.split('/').at(-2)), ['v26.0.0', 'v22.0.0']);
  }
}));

test('alias symlinks outside the alias directory are not read or trusted', async () => fixture(async home => {
  await nvm(home, ['v22.0.0', 'v26.0.0']); await mkdir(join(home, '.nvm', 'alias'));
  await writeFile(join(home, 'outside-alias'), '22'); await symlink(join(home, 'outside-alias'), join(home, '.nvm', 'alias', 'default'));
  const paths = await fixtureNvmPaths(home);
  assert.equal(paths[0].split('/').at(-2), 'v26.0.0');
}));

test('version enumeration stops after 128 entries and adds at most 32 nvm version paths', async () => {
  let visited = 0, closed = false;
  const fileSystem = { open, realpath, opendir: async () => ({ async *[Symbol.asyncIterator]() { try { for (let index = 0; index < 500; index++) { visited++; yield { name: `v${index}.0.0`, isDirectory: () => true }; } } finally { closed = true; } } }) };
  const paths = nvmPaths(await terminalInstallDirectories({ platform: 'linux', env: { HOME: '/fixture/home' }, fileSystem }));
  assert.equal(paths.length, 32); assert.equal(visited, 129); assert.equal(closed, true);
});

test('script CLIs pair sibling Node only in child PATH while native binaries preserve inherited order', async () => fixture(async home => {
  const bin = posix.join(virtualHome, 'node-version', 'bin');
  const physicalBin = join(home, 'node-version', 'bin'); await mkdir(physicalBin, { recursive: true });
  const script = posix.join(bin, 'codex'), native = posix.join(bin, 'native');
  await writeFile(join(physicalBin, 'codex'), '#!/usr/bin/env node\n'); await writeFile(join(physicalBin, 'native'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const env = { PATH: `/owner/bin:${bin}:/fallback/bin` }, calls = [];
  const options = { platform: 'linux', fileSystem: await posixFixture(home), resolveExecutable: async (command, lookup) => { calls.push([command, lookup.env.PATH]); return { path: posix.join(bin, 'node') }; } };
  const paired = await pairTerminalRuntimePath(script, env, options);
  assert.equal(paired.PATH, `${bin}:/owner/bin:/fallback/bin`); assert.equal(env.PATH, `/owner/bin:${bin}:/fallback/bin`);
  assert.deepEqual(calls, [['node', bin]]);
  calls.length = 0; assert.equal(await pairTerminalRuntimePath(native, env, options), env); assert.equal(calls.length, 0);
  assert.equal(await pairTerminalRuntimePath(script, env, { ...options, resolveExecutable: async () => null }), env);
  assert.equal(await pairTerminalRuntimePath('relative', env, options), env);
  assert.equal(await pairTerminalRuntimePath(script, env, { platform: 'win32' }), env);
}));

test('cold-GUI discovery resolves fixed aliases and required commands without account or launch probes', async () => {
  let reads = 0;
  const options = { platform: 'linux', env: { HOME: '/fixture/home', PATH: '/owner/bin' }, fileSystem: { open, realpath, opendir: async () => { reads++; throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } }, resolveExecutable: async (command, lookup) => command === 'mistral-vibe' && lookup.env.PATH.includes('/fixture/home/.bun/bin') ? { path: '/fixture/home/.bun/bin/mistral-vibe' } : null };
  const providers = await detectTerminalProviders(options);
  assert.equal(reads, 1); assert.equal(providers.find(provider => provider.id === 'mistral-vibe').installed, true);
  assert.equal(providers.find(provider => provider.id === 'dsh').installed, false);
  assert.ok(providers.every(provider => provider.authenticated === null && provider.modelAccess === null));
  const plan = await createTerminalLaunchPlan({ providerId: 'mistral-vibe' }, options);
  assert.equal(plan.command, '/fixture/home/.bun/bin/mistral-vibe'); assert.deepEqual(plan.args, []);
});

// Portions adapted from Orca, Copyright (c) 2026 Lovecast Inc., MIT.
// Revision: 51dcef8258230ffea85a907130450b0ad676e22b
// src/shared/node-cli-command-resolution.ts
// SHA-256: f2fc5da77d06ff593e867ce5907ffc006daacf487ea65ecba2d96ec26a06ecbe
// src/shared/system-cli-install-dirs.ts
// SHA-256: 0635cf902acdea8f75f0fc306d61d08e3fe583df967d0de62051d35523b663e7
// src/shared/cli-runtime-pairing-inputs.ts
// SHA-256: d19922edb378e7fb3c908dc4779a1a214d19d5a26b9fc111ee11344cc5574c70
// See third-party/orca/LICENSE. Frondose makes discovery asynchronous, bounds
// directory/alias reads and never executes startup files, a CLI or a login probe.
import { open, opendir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveRunnerExecutable } from './runner-process.mjs';

const NATIVE_EXECUTABLE_MAGIC = [[0x7f, 0x45, 0x4c, 0x46], [0xcf, 0xfa, 0xed, 0xfe], [0xce, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe], [0x4d, 0x5a]];
export function terminalEnvironmentValue(env, name, platform = process.platform) {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}
const validVersion = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const versionParts = value => value.replace(/^v/, '').split('.').map(Number);
function compareVersionDesc(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return b[index] - a[index];
  return 0;
}
async function readBounded(file, maxBytes, fileSystem) {
  let handle;
  try {
    handle = await fileSystem.open(file, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    const result = Buffer.alloc(maxBytes), read = await handle.read(result, 0, maxBytes, 0);
    return result.subarray(0, read.bytesRead);
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
}
async function nvmVersionDirectories(home, fileSystem, nvmRoot = path.posix.join(home, '.nvm')) {
  const versions = path.posix.join(nvmRoot, 'versions', 'node'), installed = [];
  try {
    const directory = await fileSystem.opendir(versions);
    let visited = 0;
    for await (const entry of directory) {
      if (++visited > 128) break;
      if (entry.isDirectory() && validVersion.test(entry.name)) installed.push(entry.name);
    }
  } catch { return []; }
  installed.sort(compareVersionDesc);
  const aliasRoot = path.posix.join(nvmRoot, 'alias'), seen = new Set();
  let aliasCanonical;
  try { aliasCanonical = await fileSystem.realpath(aliasRoot); } catch { /* Newest installed fallback. */ }
  async function alias(token) {
    if (!aliasCanonical || typeof token !== 'string' || token.length > 128 || !/^[A-Za-z0-9*][A-Za-z0-9._/*-]*$/.test(token) || token.split('/').some(part => part === '..' || part === '.')) return null;
    const file = path.posix.join(aliasRoot, token);
    try {
      const canonical = await fileSystem.realpath(file);
      if (!canonical.startsWith(`${aliasCanonical}/`)) return null;
      return (await readBounded(canonical, 1024, fileSystem))?.toString('utf8').trim() || null;
    } catch { return null; }
  }
  let token = await alias('default'), cyclic = false;
  for (let hop = 0; token && hop < 10; hop++) {
    if (seen.has(token)) { cyclic = true; break; }
    seen.add(token);
    const next = await alias(token);
    if (!next) break;
    if (hop === 9) { cyclic = true; break; }
    token = next;
  }
  let preferred;
  if (!cyclic && /^v?(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,2}$/.test(token || '')) {
    const wanted = versionParts(token);
    preferred = installed.find(version => wanted.every((part, index) => versionParts(version)[index] === part));
  }
  const ordered = preferred ? [preferred, ...installed.filter(version => version !== preferred)] : installed;
  return ordered.slice(0, 32).map(version => path.posix.join(versions, version, 'bin'));
}

/** Orca's cold-GUI install fallbacks, not shell-profile hydration. */
export async function terminalInstallDirectories({ platform = process.platform, env = process.env, fileSystem = { open, opendir, realpath } } = {}) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const value = terminalEnvironmentValue(env, platform === 'win32' ? 'USERPROFILE' : 'HOME', platform);
  const home = value || (platform === process.platform ? homedir() : '');
  const user = typeof home === 'string' && home.length <= 4096 && !/[\0\r\n]/u.test(home) && api.isAbsolute(home);
  const configured = name => {const value=terminalEnvironmentValue(env,name,platform);return typeof value==='string'&&value.length<=4096&&!/[\0\r\n]/u.test(value)&&api.isAbsolute(value)?value:null;};
  const fnm = configured('FNM_DIR') || (platform==='win32' ? api.join(configured('APPDATA') || api.join(home,'AppData','Roaming'),'fnm') : api.join(home,'.fnm'));
  const directories = user ? [api.join(configured('VOLTA_HOME') || api.join(home,'.volta'), 'bin'), api.join(home, '.asdf', 'shims'), api.join(fnm, 'aliases', 'default', ...(platform==='win32'?[]:['bin'])), api.join(home, '.local', 'share', 'mise', 'shims'), api.join(home, '.local', 'bin')] : [];
  if(user){
    if(platform==='win32')directories.push(api.join(home,'.fnm','aliases','default'));
    for(const name of ['PNPM_HOME','NVM_SYMLINK']){const value=configured(name);if(value)directories.push(value);}
    const npm=configured('NPM_CONFIG_PREFIX') || configured('npm_config_prefix');if(npm)directories.push(platform==='win32'?npm:api.join(npm,'bin'));
  }
  if (platform === 'win32' && user) {
    const roaming = terminalEnvironmentValue(env, 'APPDATA', platform), local = terminalEnvironmentValue(env, 'LOCALAPPDATA', platform);
    directories.push(api.join(roaming && api.isAbsolute(roaming) ? roaming : api.join(home, 'AppData', 'Roaming'), 'npm'), api.join(local && api.isAbsolute(local) ? local : api.join(home, 'AppData', 'Local'), 'pnpm'), api.join(local && api.isAbsolute(local) ? local : api.join(home, 'AppData', 'Local'), 'Yarn', 'bin'));
  } else if (user) directories.push(platform === 'darwin' ? api.join(home, 'Library', 'pnpm') : api.join(home, '.local', 'share', 'pnpm'), api.join(home, '.yarn', 'bin'));
  if (user) directories.push(api.join(home, '.bun', 'bin'), api.join(home, '.cargo', 'bin'));
  if (platform !== 'win32') {
    if (user) directories.unshift(...await nvmVersionDirectories(home, fileSystem, configured('NVM_DIR') || api.join(home,'.nvm')));
    if (platform === 'darwin') directories.push('/opt/homebrew/bin');
    directories.push('/usr/local/bin');
    if (platform === 'linux') directories.push('/snap/bin', '/home/linuxbrew/.linuxbrew/bin');
    directories.push('/nix/var/nix/profiles/default/bin');
    if (user) directories.push(api.join(home, '.nix-profile', 'bin'), api.join(home, '.opencode', 'bin'), api.join(home, '.vite-plus', 'bin'), api.join(home, '.grok', 'bin'));
    if(platform==='darwin')directories.push('/opt/local/bin');
  }
  return directories.filter(directory => directory.length <= 4096 && !/[\0\r\n]/u.test(directory));
}

export async function terminalDiscoveryEnvironment(options = {}) {
  const { platform = process.platform, env = process.env } = options, api = platform === 'win32' ? path.win32 : path.posix;
  const inherited = String(terminalEnvironmentValue(env, 'PATH', platform) || '').slice(0, 32768).split(platform === 'win32' ? ';' : ':').slice(0, 64).map(entry => entry.trim()).filter(entry => entry.length <= 4096 && !/[\0\r\n]/u.test(entry) && api.isAbsolute(entry));
  const candidates = [...inherited, ...await terminalInstallDirectories(options)], seen = new Set(), directories = [];
  for (const directory of candidates) { const key = platform === 'win32' ? directory.toLowerCase() : directory; if (!seen.has(key)) { seen.add(key); directories.push(directory); } }
  const result = { ...env };
  for (const key of Object.keys(result)) if (key === 'PATH' || platform === 'win32' && key.toLowerCase() === 'path') delete result[key];
  result.PATH = directories.join(platform === 'win32' ? ';' : ':');
  return result;
}

/** Preserve Orca's sibling-Node ABI pairing only for an inspected non-native CLI.
 * This never executes Node or the CLI and never mutates the process environment. */
export async function pairTerminalRuntimePath(executablePath, env, { platform = process.platform, resolveExecutable = resolveRunnerExecutable, fileSystem = { open } } = {}) {
  if (platform === 'win32' || !path.posix.isAbsolute(executablePath)) return env;
  let handle, head;
  try { handle = await fileSystem.open(executablePath, 'r'); head = Buffer.alloc(4); const result = await handle.read(head, 0, 4, 0); head = head.subarray(0, result.bytesRead); }
  catch { return env; }
  finally { await handle?.close().catch(() => {}); }
  if (NATIVE_EXECUTABLE_MAGIC.some(magic => head.length >= magic.length && magic.every((byte, index) => head[index] === byte))) return env;
  const directory = path.posix.dirname(executablePath);
  if (!await resolveExecutable('node', { platform, env: { ...env, PATH: directory } })) return env;
  return { ...env, PATH: [directory, ...String(env.PATH || '').split(':').filter(entry => entry && entry !== directory)].join(':') };
}

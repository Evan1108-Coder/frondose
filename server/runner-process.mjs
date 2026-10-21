import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { RUNNER_PROVIDER_CATALOG } from '../src/lib/runner-provider-catalog.js';

const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32', 'linux']);
const WINDOWS_EXTENSIONS = new Set(['.exe', '.com', '.cmd', '.bat']);
const WINDOWS_BATCH_UNSAFE = /[\x00-\x1f\x7f"%!?^&|<>()]/u;

function requirePlatform(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) throw new Error(`Unsupported runner platform: ${platform}`);
}

function requireString(value, label, max = 32768) {
  if (typeof value !== 'string' || value.length > max || /[\0\r\n]/u.test(value)) {
    throw new TypeError(`${label} must be a bounded string without NUL or line breaks`);
  }
}

function environmentValue(env, key, platform) {
  if (platform !== 'win32') return env[key];
  const found = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return found ? env[found] : undefined;
}

function commandExtensions(platform, env) {
  if (platform !== 'win32') return [''];
  const configured = String(environmentValue(env, 'PATHEXT', platform) || '.COM;.EXE;.BAT;.CMD');
  return [...new Set(configured.split(';').map((value) => value.toLowerCase()).filter((value) => WINDOWS_EXTENSIONS.has(value)))];
}

/** Filesystem-only discovery. Never runs a binary, installer, login or model call. */
export async function resolveRunnerExecutable(command, {
  platform = process.platform,
  env = process.env,
  fileSystem = { access, stat },
} = {}) {
  requirePlatform(platform);
  requireString(command, 'Executable', 4096);
  if (!command || command !== command.trim()) throw new TypeError('Executable cannot be blank or padded');
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const absolute = pathApi.isAbsolute(command);
  if (!absolute && /[\\/]/u.test(command)) throw new TypeError('Executable paths must be absolute');
  const directories = absolute ? [''] : String(environmentValue(env, 'PATH', platform) || '')
    .split(platform === 'win32' ? ';' : ':')
    // Empty and relative PATH entries must not let a project override a provider.
    .filter((directory) => directory && pathApi.isAbsolute(directory));
  const extension = pathApi.extname(command).toLowerCase();
  const extensions = platform === 'win32' && extension ? [''] : commandExtensions(platform, env);
  if (platform === 'win32' && extension && !WINDOWS_EXTENSIONS.has(extension)) return null;
  for (const directory of directories) {
    for (const suffix of extensions) {
      const candidate = absolute ? command + suffix : pathApi.join(directory, command + suffix);
      try {
        if (!(await fileSystem.stat(candidate)).isFile()) continue;
        await fileSystem.access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return Object.freeze({ command, path: candidate, platform, kind: /\.(?:cmd|bat)$/iu.test(candidate) && platform === 'win32' ? 'batch' : 'native' });
      } catch (error) {
        if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error?.code)) continue;
        throw error;
      }
    }
  }
  return null;
}

/** Discovery never equates npx/uvx availability with an installed AI provider. */
export async function discoverRunnerProviders({ providers = RUNNER_PROVIDER_CATALOG, ...options } = {}) {
  return Promise.all(providers.map(async (provider) => {
    const commands = Array.isArray(provider.discoveryCommands) ? provider.discoveryCommands : [];
    const executables = [];
    for (const command of commands) {
      const found = await resolveRunnerExecutable(command, options);
      if (found) executables.push(found);
    }
    const launcherAvailable = executables.length > 0;
    const needsInstallApproval = provider.requiresInstallApproval === true;
    return {
      providerId: provider.id,
      state: launcherAvailable ? (needsInstallApproval ? 'launcher_only' : 'installed') : 'not_found',
      installed: launcherAvailable && !needsInstallApproval,
      launcherAvailable,
      authenticated: null,
      modelAccess: null,
      liveVerified: false,
      requiresInstallApproval: needsInstallApproval,
      executables,
    };
  }));
}

function validateArgs(args) {
  if (!Array.isArray(args) || args.length > 256) throw new TypeError('Arguments must be an array of at most 256 strings');
  let total = 0;
  for (const argument of args) {
    requireString(argument, 'Argument');
    total += argument.length;
  }
  if (total > 65536) throw new TypeError('Arguments exceed the runner command limit');
}

function quoteBatchValue(value) {
  // cmd.exe expands percent variables even in quotes. Reject expansion and shell
  // syntax instead of attempting to escape arbitrary prompts or environment data.
  if (WINDOWS_BATCH_UNSAFE.test(value)) throw new TypeError('Unsafe Windows batch argument; use a native executable instead');
  const trailingBackslashes = value.match(/\\+$/u)?.[0] || '';
  return `"${value}${trailingBackslashes}"`;
}

/**
 * Prepare a launch without starting it. Native argv never passes through a shell.
 * Batch shims require cmd.exe; only a conservative non-expanding subset is accepted.
 * Send prompts over stdin/protocol messages, never as batch command arguments.
 */
export function prepareRunnerLaunch(executable, args = [], {
  platform = process.platform,
  env = process.env,
  cwd,
} = {}) {
  requirePlatform(platform);
  const executablePath = typeof executable === 'string' ? executable : executable?.path;
  requireString(executablePath, 'Executable', 4096);
  validateArgs(args);
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(executablePath)) throw new TypeError('Resolve the runner to an absolute executable path before launch');
  if (cwd !== undefined) {
    requireString(cwd, 'Working directory', 4096);
    if (!pathApi.isAbsolute(cwd)) throw new TypeError('Working directory must be absolute');
  }
  const baseOptions = { shell: false, windowsHide: true, cwd, env };
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/iu.test(executablePath)) {
    return { command: executablePath, args: [...args], options: baseOptions };
  }
  const systemRoot = environmentValue(env, 'SystemRoot', platform) || 'C:\\Windows';
  requireString(systemRoot, 'SystemRoot', 4096);
  if (!pathApi.isAbsolute(systemRoot) || WINDOWS_BATCH_UNSAFE.test(systemRoot)) throw new TypeError('Invalid Windows SystemRoot');
  const commandLine = `"${[executablePath, ...args].map(quoteBatchValue).join(' ')}"`;
  return {
    command: pathApi.join(systemRoot, 'System32', 'cmd.exe'),
    args: ['/d', '/s', '/v:off', '/c', commandLine],
    options: { ...baseOptions, windowsVerbatimArguments: true },
  };
}

/** Not an authorization boundary: callers must enforce owner approval and scope. */
export function spawnRunnerProcess(executable, args = [], options = {}) {
  const launch = prepareRunnerLaunch(executable, args, options);
  return (options.spawnImpl || spawn)(launch.command, launch.args, {
    ...launch.options,
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: options.signal,
  });
}

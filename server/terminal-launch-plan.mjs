// Agent command metadata adapted from Orca, Copyright (c) 2026 Lovecast Inc., MIT.
// src/shared/tui-agent-config.ts @51dcef8258230ffea85a907130450b0ad676e22b
// SHA-256: a17c3061d5b28e3d45a807604342654e5e8a05c64a8bc8c70081e67fda5bbbbc
// See third-party/orca/LICENSE. Changes: no pre-trusting a workspace, bypass
// flags, auto-installers, prompt injection, shell-profile execution or cloud API.
import path from 'node:path';
import {cliCommandPreferences} from './cli-command-preferences.mjs';
import { resolveRunnerExecutable, prepareRunnerLaunch } from './runner-process.mjs';
import { pairTerminalRuntimePath, terminalDiscoveryEnvironment, terminalEnvironmentValue as envValue } from './terminal-install-discovery.mjs';
import { validationError } from './validation.mjs';
import { NATIVE_AGENT_PROVIDERS } from '../src/lib/native-agent-session.js';

const entries = [
  ['claude', 'Claude Code', ['claude']], ['codex', 'Codex', ['codex']],
  ['copilot', 'GitHub Copilot', ['copilot']], ['opencode', 'OpenCode', ['opencode']],
  ['opencode2', 'OpenCode 2', ['opencode2'], ['--standalone']], ['pi', 'Pi', ['pi']],
  ['omp', 'Oh My Pi', ['omp']], ['gemini', 'Gemini CLI', ['gemini']],
  ['codebuddy-code', 'CodeBuddy', ['codebuddy', 'cbc']], ['openclaude', 'OpenClaude', ['openclaude']],
  ['autohand', 'Autohand Code', ['autohand']], ['ante', 'Ante', ['ante']],
  ['trae', 'TRAE CLI', ['traecli']], ['mimo-code', 'MiMo Code', ['mimo']],
  ['prime-agent', 'Prime Agent', ['prime-agent']], ['qoder', 'Qoder', ['qodercli', 'qoder']],
  ['qoder-cn', 'Qoder CN', ['qoderclicn', 'qodercn']], ['antigravity', 'Antigravity', ['agy']],
  ['aider', 'Aider', ['aider']], ['goose', 'Goose', ['goose']], ['amp-acp', 'Amp', ['amp']],
  ['kilo', 'Kilocode', ['kilo']], ['kiro', 'Kiro', ['kiro-cli'], ['chat', '--tui']],
  ['crush', 'Crush', ['crush']], ['auggie', 'Auggie', ['auggie']], ['cline', 'Cline', ['cline']],
  ['freebuff', 'Freebuff', ['freebuff']], ['codebuff', 'Codebuff', ['codebuff']],
  ['command-code', 'Command Code', ['command-code']], ['continue', 'Continue', ['cn']],
  ['cursor', 'Cursor', ['cursor-agent']], ['factory-droid', 'Factory Droid', ['droid']],
  ['kimi', 'Kimi', ['kimi', 'kimi-code']], ['mistral-vibe', 'Mistral Vibe', ['vibe', 'mistral-vibe']],
  ['qwen-code', 'Qwen Code', ['qwen']], ['rovo', 'Rovo Dev', ['acli'], ['rovodev', 'run']],
  ['hermes', 'Hermes Agent', ['hermes'], ['--tui']], ['openclaw', 'OpenClaw', ['openclaw']],
  ['grok', 'Grok', ['grok']], ['muse', 'Muse Code', ['muse']], ['zcode', 'ZCode', ['zcode']],
  ['devin', 'Devin CLI', ['devin']], ['jcode', 'JCode', ['jcode']],
  ['dsh', 'DeepSeek Harness', ['dsh-tui', 'dst'], ['.'], ['dsh']],
];
export const TERMINAL_PROVIDER_CATALOG = Object.freeze(entries.map(([id, title, commands, args = [], required = []]) => Object.freeze({ id, title, commands: Object.freeze(commands), args: Object.freeze(args), required: Object.freeze(required) })));
// Delegate existing-chat selection to each provider's own native picker.
export const TERMINAL_RESUME_ARGS = Object.freeze({ codex: Object.freeze(['resume']), claude: Object.freeze(['--resume']) });

export function terminalEnvironment(env = process.env, platform = process.platform) {
  const names = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', ...(platform === 'win32' ? ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'PATHEXT'] : [])];
  const result = {};
  for (const name of names) { const value = envValue(env, name, platform); if (typeof value === 'string' && !value.includes('\0')) result[name] = value; }
  // Native CLI history/config locations are owner-local paths, not API secrets.
  // Preserve explicit locations as well as HOME so the provider's own resume
  // picker sees the same records as a terminal opened outside Frondose.
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  for (const name of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) {
    const value = envValue(env, name, platform);
    if (typeof value === 'string' && value.length <= 4096 && !/[\0\r\n]/u.test(value) && pathApi.isAbsolute(value)) result[name] = value;
  }
  return { ...result, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
}

/** Inventory only: never invokes a shell, binary, installer, login or model. */
async function resolveProvider(provider, options) {
  const { platform = process.platform, env = process.env, resolveExecutable = resolveRunnerExecutable } = options;
  const effectiveEnv = options.discoveryEnv || await terminalDiscoveryEnvironment({ ...options, platform, env });
  for (const required of provider.required) if (!await resolveExecutable(required, { platform, env: effectiveEnv })) return null;
  for (const command of provider.commands) {
    const found = await resolveExecutable(command, { platform, env: effectiveEnv });
    if (found) return { executable: found, env: effectiveEnv };
  }
  // GUI launches do not inherit the Codex app's injected PATH. These are
  // fixed installed-app locations, never project-provided commands or installs.
  if(provider.id==='codex'&&platform==='darwin'&&provider.commands.includes('codex')){
    const home=envValue(env,'HOME',platform);
    const appRoots=['/Applications',...(typeof home==='string'&&path.posix.isAbsolute(home)?[path.posix.join(home,'Applications')]:[])];
    for(const root of appRoots)for(const suffix of ['Codex.app/Contents/Resources/codex','ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex']){
      const found=await resolveExecutable(path.posix.join(root,suffix),{platform,env:effectiveEnv});
      if(found)return {executable:found,env:effectiveEnv};
    }
  }
  return null;
}

// Terminal and the quota helper must find the same CLI on a cold GUI launch.
export async function resolveCodexInstallation(options = {}) {
  return resolveProvider(TERMINAL_PROVIDER_CATALOG.find(item => item.id === 'codex'), options);
}

export async function detectTerminalProviders(options = {}) {
  const discoveryEnv = await terminalDiscoveryEnvironment(options);
  const overrides=options.cliOverrides?cliCommandPreferences(options.cliOverrides,TERMINAL_PROVIDER_CATALOG,options.platform||process.platform):{};
  return Promise.all(TERMINAL_PROVIDER_CATALOG.map(async base => {const custom=overrides[base.id],provider=custom?{...base,commands:[custom.executable],args:custom.args}:base;return ({ id: provider.id, title: provider.title, installed: Boolean(await resolveProvider(provider, { ...options, discoveryEnv })), resumeSupported: Boolean(TERMINAL_RESUME_ARGS[provider.id]), authenticated: null, modelAccess: null });}));
}

export function terminalShells(platform = process.platform) {
  return platform === 'win32' ? [{ id: 'cmd', title: 'Command Prompt' }, { id: 'powershell', title: 'Windows PowerShell' }] : [{ id: 'default', title: 'Default shell' }, { id: 'bash', title: 'Bash' }, ...(platform === 'darwin' ? [{ id: 'zsh', title: 'Zsh' }] : [])];
}

/** node-pty accepts a pre-escaped Windows command-line string. An argv array is
 * escaped using MSVCRT rules, which must NOT be applied to cmd.exe /c payloads
 * already encoded for child_process's windowsVerbatimArguments path. Only the
 * conservative server-selected batch plan may enter this adapter. */
export function terminalPtyArguments(plan) {
  if (plan.options?.windowsVerbatimArguments !== true) return [...plan.args];
  if (!Array.isArray(plan.args) || plan.args.length !== 5 || plan.args.slice(0, 4).join(' ') !== '/d /s /v:off /c' || typeof plan.args[4] !== 'string' || /[\0\r\n]/u.test(plan.args[4])) throw validationError('The Windows provider batch launch plan is invalid.');
  const payload = plan.args[4], quotedArguments = payload.slice(1, -1);
  if (!payload.startsWith('""') || !payload.endsWith('""') || !/^"[^"]+"(?: "[^"]*")*$/.test(quotedArguments) || /[\x00-\x1f\x7f%!?^&|<>()]/u.test(payload)) throw validationError('The Windows provider batch launch plan is invalid.');
  const executable = quotedArguments.match(/^"([^"]+)"/)?.[1];
  if (!executable || !path.win32.isAbsolute(executable) || !/\.(?:cmd|bat)$/i.test(executable)) throw validationError('The Windows provider batch launch plan is invalid.');
  return plan.args.join(' ');
}

export async function createTerminalLaunchPlan({ providerId, shellId = 'default', command = null, initialPrompt = null, resume = false, resumeSessionId = null } = {}, options = {}) {
  const { platform = process.platform, env = process.env } = options;
  if (!['darwin', 'linux', 'win32'].includes(platform)) throw validationError('This operating system is not supported for local terminals.');
  if (typeof resume !== 'boolean' || resume && (!providerId || !TERMINAL_RESUME_ARGS[providerId] || initialPrompt !== null)) throw validationError('Native resume is available for Codex and Claude Code; other CLIs keep their own in-session history commands.');
  if (resumeSessionId !== null && (!resume || typeof resumeSessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(resumeSessionId))) throw validationError('Choose a validated native session from Session History.');
  if (providerId != null && (typeof providerId !== 'string' || command != null)) throw validationError('Choose a provider CLI or a shell command, not both.');
  const childEnv = terminalEnvironment(env, platform);
  if (providerId) {
    let provider = TERMINAL_PROVIDER_CATALOG.find(item => item.id === providerId);
    if (!provider) throw validationError('Choose an available provider from the local CLI catalog.');
    // Native resume and reviewed/scheduled first tasks retain canonical recipes.
    if(!resume&&initialPrompt===null&&options.cliOverrides){const custom=cliCommandPreferences(options.cliOverrides,TERMINAL_PROVIDER_CATALOG,platform)[providerId];if(custom)provider={...provider,commands:[custom.executable],args:custom.args};}
    const found = await resolveProvider(provider, options);
    if (!found) throw validationError(`${provider.title} was not found on this computer. Install its official CLI and sign in there first.`);
    const pairedEnv = await pairTerminalRuntimePath(found.executable.path, found.env, options);
    if (initialPrompt !== null) {
      if (!NATIVE_AGENT_PROVIDERS.includes(providerId) || typeof initialPrompt !== 'string' || !initialPrompt.trim() || initialPrompt.length > 24000 || initialPrompt.includes('\0')) throw validationError('Reviewed native first tasks are supported only by Codex and Claude Code.');
      const pathApi = platform === 'win32' ? path.win32 : path.posix;
      const executable = found.executable.path;
      if (typeof executable !== 'string' || !pathApi.isAbsolute(executable) || /[\0\r\n]/u.test(executable)) throw validationError('Resolve a trusted native executable before sending a first task.');
      // Orca tui-agent-startup.ts @51dcef...:111-124 uses positional argv for
      // Codex/Claude. Native argv, unlike a shell command string, safely preserves
      // quotes, newlines and metacharacters as one prompt. Never pre-trust files.
      if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)) throw validationError('Named first tasks require a native .exe CLI on Windows. This batch shim cannot safely transport an arbitrary reviewed prompt; open its direct CLI instead.');
      return { command: executable, args: [...provider.args, initialPrompt], env: { ...childEnv, PATH: pairedEnv.PATH }, providerId, name: provider.title, kind: 'agent' };
    }
    const plan = prepareRunnerLaunch(found.executable, resume ? [...provider.args, ...TERMINAL_RESUME_ARGS[providerId], ...(resumeSessionId ? [resumeSessionId] : providerId === 'codex' ? ['--all'] : [])] : provider.args, { platform, env: { ...childEnv, PATH: pairedEnv.PATH } });
    return { command: plan.command, args: terminalPtyArguments(plan), env: plan.options.env, providerId: provider.id, name: provider.title, kind: 'provider' };
  }
  if (initialPrompt !== null) throw validationError('Choose a supported provider for a reviewed native first task.');
  if (command !== null && (typeof command !== 'string' || command.length > 4000 || !command.trim() || command.includes('\0'))) throw validationError('Enter a shell command under 4,000 characters.');
  if (platform === 'win32') {
    const root = envValue(env, 'SystemRoot', platform) || 'C:\\Windows';
    if (!path.win32.isAbsolute(root) || /[\0\r\n"%!?^&|<>()]/u.test(root)) throw validationError('Windows SystemRoot is invalid.');
    const family = shellId === 'default' ? 'cmd' : shellId;
    if (family === 'powershell') return { command: path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo', '-NoProfile', ...(command ? ['-Command', command] : [])], env: childEnv, kind: 'shell', name: 'Windows PowerShell' };
    if (family !== 'cmd') throw validationError('Choose Command Prompt or Windows PowerShell on Windows.');
    // This branch is an explicitly reviewed free-form shell program, never an AI
    // prompt or a provider filename. /s strips only these enclosing quotes, leaving
    // the owner's intended command intact; array/MSVCRT escaping would alter it.
    return { command: path.win32.join(root, 'System32', 'cmd.exe'), args: command ? `/d /v:off /s /c "${command}"` : ['/d', '/v:off'], env: childEnv, kind: 'shell', name: 'Command Prompt' };
  }
  if (!['default', 'bash', 'zsh'].includes(shellId)) throw validationError('Choose a supported local shell.');
  const shell = shellId === 'zsh' || shellId === 'default' && env.SHELL === '/bin/zsh' ? '/bin/zsh' : '/bin/bash';
  return { command: shell, args: shell.endsWith('zsh') ? ['-f', ...(command ? ['-c', command] : [])] : ['--noprofile', '--norc', ...(command ? ['-c', command] : [])], env: childEnv, kind: 'shell', name: shell.endsWith('zsh') ? 'Zsh' : 'Bash' };
}

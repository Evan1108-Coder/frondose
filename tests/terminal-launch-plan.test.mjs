import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createTerminalLaunchPlan, detectTerminalProviders, terminalEnvironment, terminalPtyArguments, terminalShells, TERMINAL_PROVIDER_CATALOG } from '../server/terminal-launch-plan.mjs';

// Importing this pure formatter does not create a Windows/native PTY or process.
const { argsToCommandLine } = createRequire(import.meta.url)('node-pty/lib/windowsPtyAgent.js');

test('native terminal catalog is fixed, unique and never includes installer or trust-bypass commands', () => {
  assert.equal(new Set(TERMINAL_PROVIDER_CATALOG.map(item => item.id)).size, TERMINAL_PROVIDER_CATALOG.length);
  assert.ok(TERMINAL_PROVIDER_CATALOG.length >= 40);
  for (const item of TERMINAL_PROVIDER_CATALOG) {
    assert.ok(item.commands.length); assert.equal(Object.isFrozen(item), true);
    for (const command of item.commands) assert.match(command, /^[a-z][\w-]*$/);
    assert.doesNotMatch([...item.commands, ...item.args].join(' '), /npx|uvx|--trust|dangerously|bypass|skip-permissions/);
  }
});

test('filesystem-only provider inventory records unknown authentication and supports native aliases', async () => {
  const calls = [];
  const providers = await detectTerminalProviders({ platform: 'linux', env: { PATH: '/usr/bin', HOME: '/home/test' }, resolveExecutable: async (command, options) => { calls.push([command, options.env.PATH]); return command === 'cbc' ? { path: '/usr/bin/cbc' } : null; } });
  assert.equal(providers.find(item => item.id === 'codebuddy-code').installed, true);
  assert.equal(providers.find(item => item.id === 'claude').installed, false);
  assert.equal(providers.find(item => item.id === 'codebuddy-code').authenticated, null);
  assert.equal(providers.find(item => item.id === 'codebuddy-code').modelAccess, null);
  assert.ok(calls.some(([, path]) => path.includes('/home/test/.local/bin')));
  assert.ok(providers.every(item => item.path === undefined));
});

test('Windows discovery combines case-insensitive PATH and known install dirs without duplicate PATH keys', async () => {
  await detectTerminalProviders({ platform: 'win32', env: { Path: 'C:\\Tools', UserProfile: 'C:\\Users\\Test', AppData: 'C:\\Users\\Test\\AppData\\Roaming' }, resolveExecutable: async (command, options) => {
    assert.deepEqual(Object.keys(options.env).filter(key => key.toLowerCase() === 'path'), ['PATH']);
    assert.match(options.env.PATH, /C:\\Tools/); assert.match(options.env.PATH, /\\\.local\\bin/); assert.match(options.env.PATH, /Roaming\\npm/); return null;
  } });
});

test('POSIX discovery and child environment never mistake lowercase path/home for PATH/HOME', async () => {
  const source = { path: '/unrelated/lowercase', home: '/unrelated/home', PATH: '/actual/bin', HOME: '/actual/home' };
  const env = terminalEnvironment(source, 'linux');
  assert.equal(env.PATH, '/actual/bin'); assert.equal(env.HOME, '/actual/home');
  await detectTerminalProviders({ platform: 'linux', env: source, resolveExecutable: async (command, options) => {
    assert.ok(options.env.PATH.startsWith('/actual/bin:')); assert.ok(options.env.PATH.includes('/actual/home/.local/bin'));
    assert.equal(options.env.PATH.includes('/unrelated/'), false); return null;
  } });
});

test('native CLI launch resolves a fixed server command with no prompt and strips operator keys', async () => {
  const result = await createTerminalLaunchPlan({ providerId: 'codex' }, { platform: 'linux', env: { PATH: '/usr/bin', HOME: '/home/test', OPENAI_API_KEY: 'must-not-leak', FRONDOSE_SECRET: 'private' }, resolveExecutable: async command => command === 'codex' ? { path: '/usr/bin/codex' } : null });
  assert.equal(result.command, '/usr/bin/codex'); assert.deepEqual(result.args, []); assert.equal(result.providerId, 'codex');
  assert.equal(result.env.OPENAI_API_KEY, undefined); assert.equal(result.env.FRONDOSE_SECRET, undefined); assert.equal(result.env.HOME, '/home/test');
});

test('native resume delegates to provider pickers and preserves the owner history home', async () => {
  for (const [providerId, args] of [['codex', ['resume', '--all']], ['claude', ['--resume']]]) {
    const result = await createTerminalLaunchPlan({ providerId, resume: true }, { platform: 'linux', env: { PATH: '/usr/bin', HOME: '/home/history-owner' }, resolveExecutable: async command => ({ path: `/usr/bin/${command}` }) });
    assert.deepEqual(result.args, args); assert.equal(result.env.HOME, '/home/history-owner');
  }
  await assert.rejects(createTerminalLaunchPlan({ providerId: 'gemini', resume: true }), /Native resume/);
  await assert.rejects(createTerminalLaunchPlan({ providerId: 'codex', resume: 'true' }), /Native resume/);
  await assert.rejects(createTerminalLaunchPlan({ providerId: 'codex', resume: true, initialPrompt: 'must not be sent' }), /Native resume/);
});

test('server-validated exact native resume IDs remain one discrete provider argument on all platforms', async () => {
  for (const platform of ['darwin', 'linux', 'win32']) for (const [providerId, expected] of [['codex', ['resume', 'native-session_123']], ['claude', ['--resume', 'native-session_123']]]) {
    const result = await createTerminalLaunchPlan({ providerId, resume: true, resumeSessionId: 'native-session_123' }, { platform, env: {}, resolveExecutable: async command => ({ path: platform === 'win32' ? `C:\\Tools\\${command}.exe` : `/usr/bin/${command}` }) });
    assert.deepEqual(result.args, expected);
  }
  for (const resumeSessionId of ['--dangerous', 'x y', 'x\ny', 'x;bad', '../file', 'x'.repeat(201)]) await assert.rejects(createTerminalLaunchPlan({ providerId: 'codex', resume: true, resumeSessionId }), /validated native session/);
  await assert.rejects(createTerminalLaunchPlan({ providerId: 'codex', resumeSessionId: 'session' }), /validated native session/);
});

test('native CLI config-directory overrides are preserved as paths, never credentials or relative executables', () => {
  const env = terminalEnvironment({ HOME: '/owner', CODEX_HOME: '/owner/codex-config', CLAUDE_CONFIG_DIR: '/owner/claude-config', XDG_DATA_HOME: '/owner/data', OPENAI_API_KEY: 'not inherited' }, 'linux');
  assert.equal(env.CODEX_HOME, '/owner/codex-config'); assert.equal(env.CLAUDE_CONFIG_DIR, '/owner/claude-config'); assert.equal(env.XDG_DATA_HOME, '/owner/data'); assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(terminalEnvironment({ CODEX_HOME: 'relative/path', CLAUDE_CONFIG_DIR: '/bad\npath' }, 'linux').CODEX_HOME, undefined);
  assert.equal(terminalEnvironment({ CODEX_HOME: 'C:\\Owner\\Codex' }, 'win32').CODEX_HOME, 'C:\\Owner\\Codex');
});

test('special provider launch arguments are kept without silent workspace-trust flags', async () => {
  for (const [providerId, expected] of [['kiro', ['chat', '--tui']], ['rovo', ['rovodev', 'run']], ['hermes', ['--tui']], ['muse', []], ['command-code', []]]) {
    const result = await createTerminalLaunchPlan({ providerId }, { platform: 'linux', env: { PATH: '/usr/bin' }, resolveExecutable: async command => ({ path: `/usr/bin/${command}` }) });
    assert.deepEqual(result.args, expected);
  }
});

test('missing/unknown CLI, unsupported platform and mixed command/provider launches fail before spawn', async () => {
  for (const providerId of ['not-in-catalog', '/tmp/fake', 'codex; rm -r']) await assert.rejects(createTerminalLaunchPlan({ providerId }), /local CLI catalog/);
  await assert.rejects(createTerminalLaunchPlan({ providerId: 'claude' }, { platform: 'linux', env: {}, resolveExecutable: async () => null }), /not found/);
  await assert.rejects(createTerminalLaunchPlan({ providerId: 'codex', command: 'echo override' }), /not both/);
  await assert.rejects(createTerminalLaunchPlan({}, { platform: 'unsupported' }), /operating system/);
  for (const command of ['', ' ', 'x\0y', 'x'.repeat(4001)]) await assert.rejects(createTerminalLaunchPlan({ command }), /shell command/);
});

test('POSIX shells do not source profiles and receive commands as single argv payloads', async () => {
  const bash = await createTerminalLaunchPlan({ command: 'printf "a;b"' }, { platform: 'linux', env: {} });
  assert.equal(bash.command, '/bin/bash'); assert.deepEqual(bash.args, ['--noprofile', '--norc', '-c', 'printf "a;b"']);
  const zsh = await createTerminalLaunchPlan({}, { platform: 'darwin', env: { SHELL: '/bin/zsh' } });
  assert.deepEqual(zsh.args, ['-f']); assert.equal(zsh.command, '/bin/zsh');
  await assert.rejects(createTerminalLaunchPlan({ shellId: 'arbitrary' }, { platform: 'linux', env: {} }), /supported local shell/);
});

test('Windows Command Prompt and PowerShell launch without profiles or command interpolation wrappers', async () => {
  const cmd = await createTerminalLaunchPlan({}, { platform: 'win32', env: { systemroot: 'D:\\Windows', userprofile: 'D:\\Users\\Me' } });
  assert.equal(cmd.command, 'D:\\Windows\\System32\\cmd.exe'); assert.deepEqual(cmd.args, ['/d', '/v:off']); assert.equal(cmd.env.USERPROFILE, 'D:\\Users\\Me');
  const powershell = await createTerminalLaunchPlan({ shellId: 'powershell', command: 'Get-Location' }, { platform: 'win32', env: {} });
  assert.match(powershell.command, /WindowsPowerShell\\v1\.0\\powershell\.exe$/); assert.deepEqual(powershell.args, ['-NoLogo', '-NoProfile', '-Command', 'Get-Location']);
  await assert.rejects(createTerminalLaunchPlan({ shellId: 'bash' }, { platform: 'win32', env: {} }), /Command Prompt/);
  for (const SystemRoot of ['relative', 'C:\\Win%INJECT%', 'C:\\Win&bad']) await assert.rejects(createTerminalLaunchPlan({}, { platform: 'win32', env: { SystemRoot } }), /SystemRoot/);
});

test('Windows batch provider shim uses reviewed escaping and rejects expansion-bearing paths', async () => {
  const result = await createTerminalLaunchPlan({ providerId: 'codex' }, { platform: 'win32', env: {}, resolveExecutable: async () => ({ path: 'C:\\Program Files\\codex.cmd' }) });
  assert.match(result.command, /cmd\.exe$/); assert.equal(typeof result.args, 'string'); assert.match(result.args, /^\/d \/s \/v:off \/c /); assert.match(result.args, /Program Files/);
  await assert.rejects(createTerminalLaunchPlan({ providerId: 'codex' }, { platform: 'win32', env: {}, resolveExecutable: async () => ({ path: 'C:\\%EVIL%\\codex.cmd' }) }), /Unsafe Windows batch/);
});

test('actual node-pty Windows formatter preserves the conservative cmd payload without double escaping', async () => {
  const result = await createTerminalLaunchPlan({ providerId: 'codex' }, { platform: 'win32', env: {}, resolveExecutable: async () => ({ path: 'C:\\Program Files\\codex.cmd' }) });
  assert.equal(result.args, '/d /s /v:off /c ""C:\\Program Files\\codex.cmd""');
  const commandLine = argsToCommandLine(result.command, result.args);
  assert.equal(commandLine, 'C:\\Windows\\System32\\cmd.exe /d /s /v:off /c ""C:\\Program Files\\codex.cmd""');
  assert.equal(commandLine.includes('\\"'), false);
  const kiro = await createTerminalLaunchPlan({ providerId: 'kiro' }, { platform: 'win32', env: {}, resolveExecutable: async () => ({ path: 'C:\\Tools\\kiro-cli.cmd' }) });
  assert.match(argsToCommandLine(kiro.command, kiro.args), /\/c ""C:\\Tools\\kiro-cli\.cmd" "chat" "--tui""$/);
});

test('Windows explicit shell commands retain their quotes through the actual PTY formatter', async () => {
  for (const command of ['echo "hello world"', '"C:\\Program Files\\tool.exe" "argument with spaces"', 'echo one & echo two', 'echo %USERPROFILE%']) {
    const result = await createTerminalLaunchPlan({ command }, { platform: 'win32', env: {} });
    assert.equal(typeof result.args, 'string');
    assert.equal(argsToCommandLine(result.command, result.args), `C:\\Windows\\System32\\cmd.exe /d /v:off /s /c "${command}"`);
  }
});

test('PTY raw argument adapter accepts only the known conservative batch plan shape', () => {
  assert.deepEqual(terminalPtyArguments({ args: ['native', 'args'], options: {} }), ['native', 'args']);
  for (const args of [['/c', 'arbitrary'], ['/d', '/s', '/v:off', '/c', 'bad\ncommand'], ['/d', '/s', '/v:on', '/c', '"safe"'], 'raw']) assert.throws(() => terminalPtyArguments({ args, options: { windowsVerbatimArguments: true } }), /batch launch plan/);
  for (const payload of ['""C:\\Tools\\codex.cmd" & echo bad"', '""C:\\%EXPAND%\\codex.cmd""', '""C:\\Tools\\codex.exe""', '""relative.cmd""', '""C:\\Tools\\codex.cmd" "unsafe!arg""']) assert.throws(() => terminalPtyArguments({ args: ['/d', '/s', '/v:off', '/c', payload], options: { windowsVerbatimArguments: true } }), /batch launch plan/);
});

test('terminal environment is allowlisted on each platform and shell choices are platform-specific', () => {
  const env = terminalEnvironment({ PATH: '/bin', HOME: '/home/test', XDG_CONFIG_HOME: 'private', GOOGLE_API_KEY: 'private', NODE_OPTIONS: '--require malicious', SystemRoot: 'C:\\Windows' }, 'linux');
  assert.deepEqual(Object.keys(env).sort(), ['COLORTERM', 'HOME', 'PATH', 'TERM']);
  assert.deepEqual(terminalShells('win32').map(item => item.id), ['cmd', 'powershell']);
  assert.ok(terminalShells('darwin').some(item => item.id === 'zsh'));
});

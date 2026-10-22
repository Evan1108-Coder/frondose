// Personal-computer dispatch, never a server-installation account fallback.
// Commands come from the pinned licensed catalog, not browser request arguments.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import { getRunnerProvider } from '../src/lib/runner-provider-catalog.js';
import { runAcpSession, createLocalRunnerEnvironment } from './runner-acp-runtime.mjs';
import { createRunnerEventNormalizer, sanitizeRunnerText, sanitizeRunnerReply } from './runner-events.mjs';
import { prepareRunnerLaunch, resolveRunnerExecutable, spawnRunnerProcess } from './runner-process.mjs';
import { runStreamJson, runCodex, runPi, runMuse } from './runner-adapters/native.mjs';
import { runtimeError } from './runner-adapters/transport.mjs';

export function requiresNativeTools(providerId) {
  return !['claude', 'codex'].includes(providerId);
}

export function runnerRuntimeCapabilities(providerId) {
  const provider = getRunnerProvider(providerId);
  if (!provider) return null;
  return Object.freeze({ providerId, transport: providerId === 'opencode' ? 'acp' : provider.protocol,
    execution: 'implemented-fixture-tested', liveVerified: false,
    nativeToolsRequired: requiresNativeTools(providerId), clientMediatedTools: false,
    resume: false, historyImport: false, nativeSteering: false,
    sessionPolicy: 'fresh-reviewed-turn', osIsolation: false,
    reasoningEfforts: provider.protocol === 'acp' || providerId === 'opencode' ? 'session-advertised' : providerId === 'claude' ? ['low', 'medium', 'high', 'xhigh', 'max'] : providerId === 'pi' ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : providerId === 'omp' ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'] : providerId === 'antigravity' ? [] : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  });
}

/** A personal owner must approve this runtime and working root locally. This
 * module does not authorize workspace users, sharing, paths, credentials or costs.
 * Those decisions belong to the relay and helper's local policy before calling.
 * No native history is resumed: each prompt is a new reviewed native session.
 */
export async function executeRunnerRequest({
  providerId, prompt, model = '', cwd, signal,
  sessionId = `runner_${randomUUID()}`, workspaceId, actorId,
  emit = () => {}, localOwnerApproved = false, nativeToolsApproved = false,
  packageExecutionApproved = false, spawnProcess, env = process.env,
  platform = process.platform, timeoutMs = 120_000, providerSessionId, permissionMode = 'read-only', reasoningEffort = '',
} = {}) {
  const provider = getRunnerProvider(providerId);
  if (!provider) throw runtimeError('runner_provider_unknown', 'Choose a catalogued computer runtime.');
  if (localOwnerApproved !== true) throw runtimeError('runner_owner_approval_required', 'The computer owner must approve this runtime locally.');
  if (requiresNativeTools(providerId) && nativeToolsApproved !== true) throw runtimeError('runner_native_tools_approval_required', 'This provider can use native computer tools. Explicit local computer-owner consent is required.');
  if (!['read-only', 'workspace-write'].includes(permissionMode)) throw runtimeError('runner_permission_mode_invalid', 'Choose read-only or reviewed project-edit access.');
  if (requiresNativeTools(providerId) && permissionMode !== 'workspace-write') throw runtimeError('runner_project_edit_required', 'This runtime cannot guarantee read-only tools. Use explicitly reviewed project-edit access or a restricted chat provider.');
  if (provider.requiresInstallApproval && packageExecutionApproved !== true) throw runtimeError('runner_package_approval_required', 'The computer owner must separately approve this package launcher, which may download and execute code.');
  if (!['darwin', 'win32', 'linux'].includes(platform)) throw runtimeError('runner_platform_unsupported', 'The helper supports macOS, Windows and Linux, subject to provider CLI support.');
  if (providerSessionId) throw runtimeError('runner_resume_unavailable', 'Native history resume is not enabled. Send a fresh reviewed prompt instead.');
  if (signal?.aborted) throw runtimeError('session_cancelled', 'The request was cancelled before launch.');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100_000 || prompt.includes('\0')) throw runtimeError('runner_prompt_invalid', 'Enter a nonempty prompt of at most 100,000 characters.');
  if (typeof model !== 'string' || model.length > 200 || /[\x00-\x1f\x7f]/u.test(model)) throw runtimeError('runner_model_invalid', 'Choose a valid provider model.');
  if (typeof reasoningEffort !== 'string' || reasoningEffort.length > 200 || /[\x00-\x1f\x7f]/u.test(reasoningEffort)) throw runtimeError('runner_effort_invalid', 'Choose a valid provider reasoning effort.');
  const efforts = runnerRuntimeCapabilities(providerId).reasoningEfforts;
  if (reasoningEffort && Array.isArray(efforts) && !efforts.includes(reasoningEffort)) throw runtimeError('runner_effort_unavailable', 'This runtime does not expose the selected reasoning effort. No prompt was sent.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 1_800_000) throw runtimeError('runner_timeout_invalid', 'Choose a deadline between 10 milliseconds and 30 minutes.');
  if (typeof emit !== 'function') throw new TypeError('emit must be a function.');
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (typeof cwd !== 'string' || !pathApi.isAbsolute(cwd)) throw runtimeError('runner_launch_invalid', 'The local helper must select an approved absolute working directory.');
  const template = providerId === 'opencode' ? ['opencode', 'acp'] : [...provider.launchTemplate];
  let [command, ...args] = template;
  if (providerId === 'claude') {
    const tools = nativeToolsApproved ? permissionMode === 'workspace-write' ? 'Read,Glob,Grep,Write,Edit,Bash' : 'Read,Glob,Grep' : '';
    // --bare deliberately ignores subscription OAuth/keychain. --safe-mode keeps
    // provider-owned sign-in while suppressing user/project customizations.
    args = ['--print', '--safe-mode', '--restricted', '--no-session-persistence', '--disable-slash-commands', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'dontAsk', '--tools', tools, '--disallowedTools', 'mcp__*', '--strict-mcp-config', '--max-turns', '12', ...(nativeToolsApproved ? ['--allowedTools', tools] : [])];
    if (model) args.push('--model', model);
    if (reasoningEffort) args.push('--effort', reasoningEffort);
  }
  if (providerId === 'codex') {
    const restrictions = ['features.hooks=false', 'features.apps=false', 'features.remote_plugin=false', 'features.multi_agent=false'];
    if (!nativeToolsApproved) restrictions.push('features.shell_tool=false', 'features.apply_patch_freeform=false', 'features.unified_exec=false', 'features.shell_snapshot=false', 'features.code_mode.enabled=false', 'features.code_mode_host=false', 'features.browser_use=false', 'features.computer_use=false', 'features.plugins=false', 'features.memories=false', 'features.goals=false', 'features.image_generation=false', 'tools.view_image=false', 'web_search=disabled', 'project_doc_max_bytes=0');
    args.push(...restrictions.flatMap(value => ['-c', value]));
  }
  if (providerId === 'pi' || providerId === 'omp') { args.push('--no-session'); if (model) args.push('--model', model); if (reasoningEffort) args.push('--thinking', reasoningEffort); }
  if (providerId === 'antigravity') {
    // Unlike upstream's full-access driver, do not bypass provider permissions.
    // Unsupported interactive approvals remain denied/unavailable, not auto-yes.
    args.push('--input-format', 'stream-json', '--output-format', 'stream-json', '--add-dir', cwd, '--disable-slash-commands');
    if (model) args.push('--model', model);
  }
  const environment = { ...createLocalRunnerEnvironment(env), ...provider.env };
  const found = await resolveRunnerExecutable(command, { platform, env: environment });
  if (!found) throw runtimeError('not_installed', 'The selected runtime is not installed on this computer. Install and authenticate it using its official instructions.');
  command = found.path;
  let privateDirectory;
  try {
  if (providerId === 'claude') {
    // A private file avoids putting JSON quoting into Windows .cmd arguments.
    // No project configuration is changed or inherited by this strict MCP list.
    privateDirectory = await mkdtemp(path.join(os.tmpdir(), 'frondose-claude-mcp-'));
    await chmod(privateDirectory, 0o700);
    const config = path.join(privateDirectory, 'mcp.json');
    await writeFile(config, '{"mcpServers":{}}', { mode: 0o600, flag: 'wx' });
    args.push('--mcp-config', config);
  }
  prepareRunnerLaunch(command, args, { cwd, platform, env: environment });
  if (provider.protocol === 'acp' || providerId === 'opencode') {
    const result = await runAcpSession({ command, args, cwd, prompt, model, reasoningEffort, signal, sessionId, providerId, workspaceId, actorId, emit, spawnProcess, timeoutMs, platform, env: environment, localOwnerApproved, packageExecutionApproved });
    if (!['end_turn', 'cancelled'].includes(result.stopReason)) throw runtimeError('runtime_turn_failed', `The provider stopped with ${result.stopReason}. No request was retried.`);
    if (result.stopReason === 'end_turn' && !result.text.trim()) throw runtimeError('empty_reply', 'The provider completed without a text reply.');
    return result;
  }
  const normalizer = createRunnerEventNormalizer({ providerId, sessionId, workspaceId, actorId, maxEvents: 10_000 });
  let text = '', captured = 0;
  const forward = (raw, protocol = 'frondose') => { for (const event of normalizer.normalize(raw, { protocol })) emit(event); };
  const clean = value => {
    if (typeof value !== 'string') throw runtimeError('runtime_protocol', 'The provider returned invalid message text.');
    captured += value.length;
    if (captured > 1_000_000 || value.length > 100_000) throw runtimeError('runtime_output_limit', 'The provider exceeded the bounded reply capture limit.');
    // Preserve large legitimate replies without bypassing per-event redaction caps.
    return value;
  };
  const append = value => { text += clean(value); if (text.length > 100_000) throw runtimeError('runtime_output_limit', 'The provider reply exceeded 100,000 characters.'); };
  const snapshot = value => { text = clean(value); };
  const spawnChild = () => (spawnProcess || spawnRunnerProcess)(command, args, { cwd, platform, env: environment, detached: platform !== 'win32' });
  forward({ type: 'run.started', summary: 'Approved personal-computer request started.', payload: { nativeTools: nativeToolsApproved, osIsolation: false, freshSession: true } });
  try {
    const adapter = { 'claude-stream-json': runStreamJson, 'codex-app-server': runCodex, 'pi-rpc': runPi, 'omp-rpc': runPi, 'antigravity-stream-json': runStreamJson, 'muse-msp': runMuse }[provider.protocol];
    if (!adapter) throw runtimeError('runner_protocol_unsupported', 'This runtime protocol does not have an execution adapter.');
    const result = await adapter({ providerId, spawnChild, prompt, model, reasoningEffort, cwd, signal, timeoutMs, platform, env: environment, forward, append, snapshot, nativeToolsApproved, permissionMode });
    text = sanitizeRunnerReply(text);
    if (result.stopReason !== 'cancelled' && !text.trim()) throw runtimeError('empty_reply', 'The provider completed without a text reply. Native work may still have occurred; no request was retried.');
    forward({ type: result.stopReason === 'cancelled' ? 'run.cancelled' : 'run.completed' });
    if (text) forward({ type: 'agent.message', payload: { text } });
    return { text, ...result };
  } catch (reason) {
    if (reason?.code === 'session_cancelled') { forward({ type: 'run.cancelled' }); return { text: sanitizeRunnerReply(text), providerSessionId: null, stopReason: 'cancelled' }; }
    const safe = runtimeError(typeof reason?.code === 'string' ? reason.code : 'runtime_error', sanitizeRunnerText(reason?.message || 'The provider request failed.', 2000));
    try { forward({ type: 'run.failed', summary: safe.message }); } catch {}
    throw safe;
  }
  } finally {
    if (privateDirectory) await rm(privateDirectory, { recursive: true, force: true });
  }
}

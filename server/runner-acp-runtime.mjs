// Local-owner-only ACP v1 transport. Not a sandbox or a public multi-tenant runner.
// Inspired by Paseo's ACP adapter contract; original Frondose implementation.
// https://agentclientprotocol.com/protocol/v1/initialization
// https://agentclientprotocol.com/protocol/v1/prompt-turn
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAgentJsonlPeer, terminateAgentProcess } from './agent-jsonl-peer.mjs';
import { prepareRunnerLaunch, resolveRunnerExecutable, spawnRunnerProcess } from './runner-process.mjs';
import { createRunnerEventNormalizer, sanitizeRunnerText } from './runner-events.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code, statusCode: 409 });
const OS_ENV = /^(?:PATH|PATHEXT|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|SystemRoot|WINDIR|TMPDIR|TEMP|TMP|LANG|LC_[A-Z_]+|XDG_(?:CONFIG|DATA|CACHE)_HOME|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)$/i;
export const ACP_RUNNER_CLIENT_CAPABILITIES = Object.freeze({ fs: Object.freeze({ readTextFile: false, writeTextFile: false }), terminal: false });

/** Deliberately retains OS-user auth locations for an explicitly approved local
 * runner, not server credentials. API keys supplied only through environment
 * variables are not inherited; use the provider's own supported sign-in first.
 */
export function createLocalRunnerEnvironment(source = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (OS_ENV.test(key) && typeof value === 'string' && value.length <= 32768 && !value.includes('\0')) env[key] = value;
  }
  return { ...env, NO_COLOR: '1', FORCE_COLOR: '0' };
}

function flattenOptions(options, depth = 0) {
  if (depth > 4 || !Array.isArray(options)) return [];
  return options.slice(0, 200).flatMap(option => Array.isArray(option.options) ? flattenOptions(option.options, depth + 1) : [option]);
}

/**
 * Executes exactly one explicit prompt in a fresh ACP session. No automatic login,
 * install, history import/resume, retry, MCP configuration or permission approval.
 * `emit` receives sanitized canonical observed-only runner events.
 * Installed runtimes may execute their OWN native tools under OS-user authority;
 * denying client-mediated capabilities is NOT OS isolation. The caller must enforce
 * local approval, trusted executable selection, scope and concurrency before use.
 */
export async function runAcpSession({
  command, args = [], cwd, prompt, model = '', signal,
  sessionId = `runner_${randomUUID()}`, providerId = 'acp', workspaceId, actorId,
  emit = () => {}, spawnProcess,
  timeoutMs = 120_000, platform = process.platform, env = process.env,
  localOwnerApproved = false, packageExecutionApproved = false,
} = {}) {
  if (localOwnerApproved !== true) throw fail('runner_owner_approval_required', 'The computer owner must explicitly approve this local execution.');
  if (!['darwin', 'win32', 'linux'].includes(platform)) throw fail('runner_platform_unsupported', 'This helper supports macOS, Windows and Linux.');
  if (signal?.aborted) throw fail('session_cancelled', 'The request was cancelled before launch.');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100_000 || prompt.includes('\0')) throw fail('runner_prompt_invalid', 'Choose a nonempty prompt within the 100,000-character limit.');
  if (typeof model !== 'string' || model.length > 200 || /[\x00-\x1f\x7f]/u.test(model)) throw fail('runner_model_invalid', 'Choose a valid provider model.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 1_800_000) throw fail('runner_timeout_invalid', 'Choose an execution deadline of at most 30 minutes.');
  if (typeof emit !== 'function') throw new TypeError('emit must be a function.');
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (typeof command !== 'string' || typeof cwd !== 'string' || !pathApi.isAbsolute(cwd)) throw fail('runner_launch_invalid', 'Choose an installed executable and an absolute working directory.');
  const environment = createLocalRunnerEnvironment(env);
  const executable = pathApi.isAbsolute(command) ? command : (await resolveRunnerExecutable(command, { platform, env: environment }))?.path;
  if (!executable) throw fail('not_installed', 'The agent runtime was not found. Install and authenticate it locally before connecting.');
  if (/^(?:npx|npm|pnpx|pnpm|bunx|uvx)(?:\.(?:exe|cmd|bat|com))?$/i.test(pathApi.basename(executable)) && packageExecutionApproved !== true) throw fail('runner_package_approval_required', 'Package launchers can download and execute code. Separate local-owner approval is required.');
  // Validate both native argv and Windows batch quoting even for injected fixtures.
  prepareRunnerLaunch(executable, args, { cwd, platform, env: environment });
  const normalizer = createRunnerEventNormalizer({ providerId, sessionId, workspaceId, actorId, maxEvents: 5000 });
  let providerSessionId, text = '', settled = false, emitted = 0, outputBytes = 0, peer;
  const forward = (event, protocol) => {
    if (settled) return;
    if (++emitted > 5000) throw fail('runtime_output_limit', 'Provider event capture limit reached.');
    const canonical = normalizer.normalize(event, { protocol });
    for (const item of canonical) emit(item);
  };
  const child = (spawnProcess || spawnRunnerProcess)(executable, args, { cwd, platform, env: environment });
  if (!child?.stdin || !child?.stdout || !child?.stderr || typeof child.on !== 'function') throw fail('runtime_start_failed', 'The agent did not provide a valid stdio transport.');
  let rejectFailure;
  const failed = new Promise((_, reject) => { rejectFailure = reject; });
  // A pending handshake can fail before the race is attached. Observe immediately.
  failed.catch(() => {});
  const die = reason => rejectFailure(reason);
  const abort = () => {
    try { if (providerSessionId) peer?.notify('session/cancel', { sessionId: providerSessionId }); } catch {}
    die(fail('session_cancelled', 'The local request was cancelled.'));
  };
  const timer = setTimeout(() => {
    try { if (providerSessionId) peer?.notify('session/cancel', { sessionId: providerSessionId }); } catch {}
    die(fail('run_timeout', 'The execution deadline was reached. No request was retried.'));
  }, timeoutMs);
  // Keep the deadline alive: fixture children need not have an actual OS handle.
  signal?.addEventListener('abort', abort, { once: true });
  const ask = (method, params) => Promise.race([peer.request(method, params, timeoutMs), failed]);
  try {
    peer = createAgentJsonlPeer(child, { jsonrpc: true, timeoutMs,
      onFailure: die,
      onRequest(request) {
        const incoming = request.params?.sessionId;
        if (!providerSessionId || incoming && incoming !== providerSessionId) return { error: { code: -32602, message: 'Unknown session.' } };
        forward(request, 'acp');
        if (request.method === 'session/request_permission') {
          // No provider-supplied option, including allow_always, grants authority.
          return { result: { outcome: { outcome: 'cancelled' } } };
        }
        return { error: { code: -32601, message: 'File, terminal, authentication and interactive client capabilities are unavailable.' } };
      },
      onNotification(event) {
        if (settled) return;
        if (event.method === 'session/update') {
          if (!providerSessionId || event.params?.sessionId !== providerSessionId) return;
          const update = event.params?.update;
          if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
            const delta = sanitizeRunnerText(update.content.text);
            text += delta;
            if (text.length > 100_000) throw fail('runtime_output_limit', 'The agent reply exceeded the capture limit.');
          }
        } else if (event.params?.sessionId && event.params.sessionId !== providerSessionId) return;
        forward(event, 'acp');
      },
    });
    // Total output is bounded in addition to the peer's per-frame/output queue caps.
    child.stdout.on('data', chunk => { outputBytes += chunk.length; if (outputBytes > 8_000_000) die(fail('runtime_output_limit', 'The agent exceeded its output budget.')); });
    child.stderr.on('data', chunk => { outputBytes += chunk.length; if (outputBytes > 8_000_000) die(fail('runtime_output_limit', 'The agent exceeded its output budget.')); });
    if (signal?.aborted) abort();
    const initialized = await ask('initialize', { protocolVersion: 1, clientInfo: { name: 'frondose', title: 'Frondose', version: '0.1.0' }, clientCapabilities: ACP_RUNNER_CLIENT_CAPABILITIES });
    if (initialized.protocolVersion !== 1) throw fail('unsupported_protocol', 'The installed agent does not negotiate supported ACP v1.');
    forward({ type: 'provider.ready', summary: 'ACP handshake completed; model access is not verified.', payload: { transport: 'acp', agentCapabilities: initialized.agentCapabilities ?? {}, authMethods: initialized.authMethods ?? [] } }, 'frondose');
    const created = await ask('session/new', { cwd, mcpServers: [] });
    providerSessionId = created.sessionId;
    if (typeof providerSessionId !== 'string' || !providerSessionId || providerSessionId.length > 500 || /[\x00-\x1f\x7f]/u.test(providerSessionId)) throw fail('runtime_protocol', 'The agent did not return a valid session identifier.');
    if (model) {
      const modelOption = Array.isArray(created.configOptions) ? created.configOptions.find(option => option?.type === 'select' && option.category === 'model') : null;
      const advertised = modelOption ? flattenOptions(modelOption.options).map(option => option?.value) : (Array.isArray(created.models?.availableModels) ? created.models.availableModels.map(option => option?.modelId) : []);
      if (!advertised.includes(model)) throw fail('runner_model_unavailable', 'The selected model was not advertised by this agent session. No prompt was sent.');
      if (modelOption) await ask('session/set_config_option', { sessionId: providerSessionId, configId: modelOption.id, value: model });
      else await ask('session/set_model', { sessionId: providerSessionId, modelId: model });
    }
    forward({ type: 'run.started', summary: 'Explicit local ACP prompt started.', payload: { transport: 'acp', clientMediatedTools: false, nativeTools: 'provider-owned-not-sandboxed', timeoutMs } }, 'frondose');
    const result = await ask('session/prompt', { sessionId: providerSessionId, prompt: [{ type: 'text', text: prompt }] });
    const stopReason = typeof result.stopReason === 'string' ? sanitizeRunnerText(result.stopReason, 100) : 'unknown';
    if (stopReason === 'cancelled') {
      forward({ type: 'run.cancelled', summary: 'Provider reported cancellation.' }, 'frondose');
      return { text, providerSessionId, stopReason };
    }
    forward({ type: stopReason === 'end_turn' ? 'run.completed' : 'run.failed', summary: stopReason === 'end_turn' ? 'Provider turn completed.' : `Provider stopped: ${stopReason}.`, payload: { stopReason } }, 'frondose');
    return { text, providerSessionId, stopReason };
  } catch (reason) {
    const code = typeof reason?.code === 'string' ? reason.code : 'runtime_error';
    if (code === 'session_cancelled') {
      forward({ type: 'run.cancelled', summary: 'The local request was cancelled.' }, 'frondose');
      return { text, providerSessionId: providerSessionId || null, stopReason: 'cancelled' };
    }
    // Never include unsanitized provider errors, stderr or credentials in failures.
    const safe = fail(code, sanitizeRunnerText(reason?.message || 'The local agent could not complete the request.', 2000));
    try { forward({ type: 'run.failed', summary: safe.message, payload: { code } }, 'frondose'); } catch {}
    throw safe;
  } finally {
    settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
    peer?.dispose(); terminateAgentProcess(child);
  }
}

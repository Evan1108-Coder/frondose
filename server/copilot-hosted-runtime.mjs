import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fail = (code, message) => Object.assign(new Error(message), { code, statusCode: 409 });
const validModel = value => typeof value === 'string' && (!value || /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value));
const scoped = (workspace, actor) => JSON.stringify([workspace, actor?.id]);
const defaultClientFactory = async options => { const { CopilotClient } = await import('@github/copilot-sdk'); return new CopilotClient(options); };
const clean = (text, token) => String(text || '').split(token).join('[redacted authorization]').replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, '[redacted authorization]');

// One SDK subprocess, empty home and fresh native session per operation. No
// shared CLI account, inherited environment, native tools or replayed history.
export function createCopilotHostedRuntime({ accounts, env = process.env, clientFactory = defaultClientFactory }) {
  const active = new Map(); let closed = false;
  async function withClient(workspace, actor, { allowUnverified = false, signal, timeoutMs = 60000 }, action) {
    if (closed) throw fail('service_closed', 'Copilot runtime service is closed.');
    const key = scoped(workspace, actor);
    if ((active.get(key)?.size || 0) >= 2 || [...active.values()].reduce((count, jobs) => count + jobs.size, 0) >= 8) throw fail('runtime_busy', 'The Copilot execution limit is reached. Wait or stop a request first.');
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const jobs = active.get(key) || new Set(); jobs.add(abort); active.set(key, jobs);
    let client, directory, token = '', timedOut = false, disposed = false, settled = false;
    const bounded = async action => {
      let deadline;
      try { await Promise.race([Promise.resolve().then(action).catch(() => {}), new Promise(resolve => { deadline = setTimeout(resolve, 1500); })]); }
      finally { clearTimeout(deadline); }
    };
    const stopClient = async () => { if (client) { await bounded(() => client.stop()); await bounded(() => client.forceStop()); } };
    const release = () => {
      jobs.delete(abort); if (!jobs.size) active.delete(key);
      if (directory) rmSync(directory, { recursive: true, force: true });
      token = '';
    };
    let rejectAbort;
    const interrupted = new Promise((_, reject) => { rejectAbort = reject; }); interrupted.catch(() => {});
    const onAbort = () => rejectAbort(fail(timedOut ? 'run_timeout' : 'session_cancelled', timedOut ? 'Copilot reached its execution deadline. The request was not retried.' : 'The Copilot operation was stopped.'));
    controller.signal.addEventListener('abort', onAbort, { once: true }); if (controller.signal.aborted) onAbort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs); timer.unref?.();
    const work = (async () => {
        const credential = await accounts.credential(workspace, actor, { allowUnverified }); token = credential.accessToken;
        controller.signal.throwIfAborted();
        directory = mkdtempSync(join(tmpdir(), 'rumbo-hosted-copilot-'));
        const home = join(directory, 'account'); mkdirSync(home, { mode: 0o700 });
        const runtimeEnv = Object.fromEntries(Object.entries(env).filter(([name]) => /^(PATH|SystemRoot|WINDIR|LANG|LC_[A-Z_]+|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)$/i.test(name)));
        Object.assign(runtimeEnv, { HOME: directory, USERPROFILE: directory, TMPDIR: directory, TMP: directory, TEMP: directory, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home });
        client = await clientFactory({ connection: { kind: 'stdio' }, mode: 'empty', workingDirectory: directory, baseDirectory: home, env: runtimeEnv, gitHubToken: token, useLoggedInUser: false, logLevel: 'none', enableRemoteSessions: false, telemetry: { captureContent: false } });
        // A delayed module load/factory must not launch work after cancellation.
        if (disposed) { await stopClient(); controller.signal.throwIfAborted(); }
        controller.signal.throwIfAborted();
        try { await client.start(); } finally { if (disposed) await stopClient(); }
        controller.signal.throwIfAborted(); await credential.assertCurrent();
        const result = await action({ client, credential, directory, signal: controller.signal, token });
        controller.signal.throwIfAborted(); await credential.assertCurrent();
        return result;
      })();
    // A cancelled startup may settle after the caller returns. Retain the job
    // slot and directory until then, and stop a late client before releasing.
    work.finally(async () => { settled = true; if (disposed) { await stopClient(); release(); } }).catch(() => {});
    try {
      return await Promise.race([interrupted, work]);
    } catch (reason) {
      if (controller.signal.aborted) throw fail(timedOut ? 'run_timeout' : 'session_cancelled', timedOut ? 'Copilot reached its execution deadline. Delivery may be uncertain; it was not retried.' : 'The Copilot operation was stopped.');
      // SDK exceptions may contain provider tokens, request bodies or paths.
      if (['not_connected', 'model_test_required', 'reconnect_required', 'connection_changed', 'access_denied', 'runtime_output_limit', 'empty_reply', 'model_response_incomplete'].includes(reason.code)) throw reason;
      throw fail('copilot_runtime_error', 'Copilot could not complete this operation. Check account eligibility, app authorization and the selected model. No fallback account or automatic retry was used.');
    } finally {
      disposed = true; controller.abort();
      clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort);
      // Stop even after a timeout; killing the request wait alone is not enough.
      await stopClient();
      if (settled) release();
    }
  }
  async function models(workspace, actor) {
    return withClient(workspace, actor, { allowUnverified: true }, async ({ client }) => {
      const models = await client.listModels();
      if (!Array.isArray(models)) throw fail('provider_response', 'Copilot returned an invalid model catalog.');
      return models.filter(item => validModel(item.id) && item.id).slice(0, 200).map(item => ({ id: item.id, name: typeof item.name === 'string' ? item.name.slice(0, 160) : item.id, source: 'copilot_sdk' }));
    });
  }
  async function execute(input, { onEvent = () => {} } = {}) {
    const { workspaceId, actor, prompt, model = '', timeoutMs = 1800000, signal, verification = false } = input;
    if (input.workMode && input.workMode !== 'conversation' || input.permissionMode && input.permissionMode !== 'read-only' || input.cwd || input.allowedRoot || input.nativeToolBridge || input.reasoningEffort) throw fail('copilot_options', 'Hosted Copilot supports reviewed General chat, not host filesystem, shell or native tools.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000 || !validModel(model) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000) throw fail('invalid_runtime_request', 'Choose a valid prompt, model and execution deadline.');
    return withClient(workspaceId, actor, { allowUnverified: verification, signal, timeoutMs }, async ({ client, credential, directory, signal, token }) => {
      const session = await client.createSession({ ...(model ? { model } : {}), workingDirectory: directory, streaming: true, availableTools: [], excludedTools: ['builtin:*', 'mcp:*', 'custom:*'], tools: [], mcpServers: {}, skillDirectories: [], includedBuiltinSkills: [], enableConfigDiscovery: false, skipCustomInstructions: true, customAgentsLocalOnly: true, manageScheduleEnabled: false, coauthorEnabled: false, enableSessionTelemetry: false, onPermissionRequest: () => ({ kind: 'reject' }) });
      signal.throwIfAborted(); await credential.assertCurrent();
      let events = 0, size = 0, providerFailed = false;
      const unsubscribe = session.on(event => {
        if (signal.aborted || event.agentId) return;
        if (event.type === 'session.error' || event.type === 'session.abort') providerFailed = true;
        if (event.type === 'assistant.message_delta') {
          const delta = clean(event.data?.deltaContent, token); size += delta.length;
          if (size > 100000) { providerFailed = true; void session.abort().catch(() => {}); return; }
          if (events++ < 5000) onEvent({ type: 'agent.progress', summary: 'Receiving Copilot reply', payload: { text: delta.slice(0, 12000) } });
        }
      });
      try {
        onEvent({ type: 'run.started', summary: 'Copilot browser-account session started', payload: { transport: 'copilot-sdk', liveAccountContacted: true, timeoutMs } });
        const reply = await session.sendAndWait({ prompt }, timeoutMs);
        signal.throwIfAborted();
        if (providerFailed) throw fail('model_response_incomplete', 'Copilot did not complete the reply, or the output limit was reached.');
        const text = clean(reply?.data?.content, token);
        if (!text.trim()) throw fail('empty_reply', 'Copilot completed without a text reply.');
        if (text.length > 100000 || reply.agentId) throw fail('runtime_output_limit', 'Copilot returned an invalid or oversized root reply.');
        await credential.assertCurrent();
        signal.throwIfAborted();
        if (verification) await credential.verified();
        onEvent({ type: 'agent.message', summary: text.slice(0, 12000), payload: { text } });
        return { status: 'completed', text, provider: 'copilot', model: model || 'Provider default' };
      } finally { unsubscribe(); }
    });
  }
  async function startRun(input, callbacks = {}) {
    const controller = new AbortController(), abort = () => controller.abort();
    input.signal?.addEventListener('abort', abort, { once: true }); if (input.signal?.aborted) abort();
    let settled = false;
    const finish = result => { if (settled) return; settled = true; input.signal?.removeEventListener('abort', abort); callbacks.onComplete?.(result); };
    void execute({ ...input, signal: controller.signal }, callbacks).then(finish, reason => finish({ status: reason.code === 'session_cancelled' ? 'stopped' : 'failed', text: '', error: reason.message, error_code: reason.code || 'copilot_runtime_error' }));
    return { stop() { controller.abort(); } };
  }
  return { models, execute, startRun, cancelScope(workspace, actor) { for (const stop of [...(active.get(scoped(workspace, actor)) || [])]) stop(); }, close() { closed = true; for (const jobs of active.values()) for (const stop of jobs) stop(); } };
}

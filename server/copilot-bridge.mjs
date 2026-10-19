import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createAgentJsonlPeer, terminateAgentProcess } from './agent-jsonl-peer.mjs';

const fail = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });
const stamp = () => new Date().toISOString();
const scrub = value => String(value || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, '[redacted]').slice(0, 100_000);
const modelId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value);
const client = { protocolVersion: 1, clientInfo: { name: 'talvori', title: 'Talvori', version: '0.1.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } };

export function createCopilotBridge({ db, dataDir, authorize, env = process.env, spawnProcess = spawn }) {
  const operations = new Map(), logins = new Map(), generations = new Map();
  let closed = false;
  const scope = (workspaceId, actor) => {
    if (closed) throw fail('service_closed', 'The local runtime service is closed.');
    if (typeof workspaceId !== 'string' || !workspaceId || !actor?.id || !db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspaceId)) throw fail('invalid_workspace', 'Choose an available workspace.', 400);
    authorize(workspaceId, actor);
    return createHash('sha256').update(JSON.stringify([workspaceId, actor.id])).digest('hex');
  };
  const row = (workspaceId, actor) => db.prepare("SELECT * FROM ai_account_connections WHERE workspace_id=? AND actor_id=? AND provider='copilot'").get(workspaceId, actor.id);
  function status(workspaceId, actor) {
    const key = scope(workspaceId, actor), connection = row(workspaceId, actor), auth = logins.get(key);
    return { provider: 'copilot', state: connection?.state || 'not_connected', method: 'local_acp', checked_at: connection?.checked_at || null, model_tested_at: connection?.model_tested_at || null, account_label: 'Private local Copilot account', liveAccountChecked: Boolean(connection?.model_tested_at), ...(auth ? { auth: { status: auth.status, output: auth.output } } : {}) };
  }
  function save(workspaceId, actor, state, tested = false) {
    const now = stamp();
    // This marker contains no credential. Copilot owns credentials in its private
    // scoped home, which is neither returned to clients nor part of exports.
    db.prepare(`INSERT INTO ai_account_connections(id,workspace_id,actor_id,provider,state,encrypted_credential,account_label,checked_at,model_tested_at,created_at,updated_at)
      VALUES(?,?,?,'copilot',?,'provider-owned-local-account','Private local Copilot account',?,?,?,?)
      ON CONFLICT(workspace_id,actor_id,provider) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at,model_tested_at=excluded.model_tested_at,updated_at=excluded.updated_at`)
      .run(`copilot_${randomUUID()}`, workspaceId, actor.id, state, now, tested ? now : null, now, now);
    return status(workspaceId, actor);
  }
  function environment(key) {
    const home = join(dataDir, 'local-ai', key, 'copilot');
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const output = Object.fromEntries(Object.entries(env).filter(([name]) => /^(PATH|HOME|USER|LOGNAME|SystemRoot|WINDIR|TMPDIR|TEMP|TMP|LANG|LC_[A-Z_]+|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)$/i.test(name)));
    return { ...output, COPILOT_HOME: home, NO_COLOR: '1', FORCE_COLOR: '0', COPILOT_ENABLE_INTERRUPTED_SESSION_RESTORE: '0' };
  }
  const generation = key => generations.get(key) || 0;
  function register(key, stop) { const active = operations.get(key) || new Set(); active.add(stop); operations.set(key, active); return () => { active.delete(stop); if (!active.size) operations.delete(key); }; }

  async function open(workspaceId, actor, { signal, onEvent = () => {} } = {}) {
    const key = scope(workspaceId, actor), epoch = generation(key);
    if (signal?.aborted) throw fail('session_cancelled', 'The request was cancelled.');
    if ((operations.get(key)?.size || 0) >= 2 || [...operations.values()].reduce((count, active) => count + active.size, 0) >= 8) throw fail('runtime_busy', 'The local Copilot process limit is reached. Wait or stop a request first.');
    const cwd = mkdtempSync(join(tmpdir(), 'rumbo-copilot-'));
    let child;
    try { child = spawnProcess('copilot', ['--acp', '--disable-builtin-mcps', '--available-tools=', '--deny-tool=read,write,shell,url,memory', '--no-custom-instructions', '--no-experimental', '--no-auto-update', '--no-remote-export', '--no-bash-env'], { cwd, env: environment(key), shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (reason) { rmSync(cwd, { recursive: true, force: true }); throw reason; }
    let sessionId, disposed = false, stderr = '';
    const listeners = new Set();
    let rejectExit;
    const exited = new Promise((_, reject) => { rejectExit = reject; }); exited.catch(() => {});
    const peer = createAgentJsonlPeer(child, { jsonrpc: true,
      onRequest: request => {
        onEvent({ type: 'permission.denied', summary: 'Copilot capability request denied. Talvori actions require review.', payload: {} });
        return request.method === 'session/request_permission' ? { result: { outcome: { outcome: 'cancelled' } } } : { error: { code: -32601, message: 'File, terminal and interactive capabilities are disabled.' } };
      },
      onNotification: message => {
        if (message.method !== 'session/update' || message.params?.sessionId !== sessionId) return;
        for (const receive of listeners) receive(message.params.update);
      },
      onFailure: reason => { rejectExit(fail(reason.code || 'runtime_error', scrub(reason.message))); dispose(); },
    });
    child.stderr.on('data', chunk => { stderr = scrub(stderr + chunk.toString()).slice(-12_000); });
    child.once('close', () => rmSync(cwd, { recursive: true, force: true }));
    const unregister = register(key, () => { rejectExit(fail('session_cancelled', 'The local connection was stopped.')); dispose(); });
    function dispose() { if (disposed) return; disposed = true; signal?.removeEventListener('abort', abort); peer.dispose(); terminateAgentProcess(child); unregister(); }
    function abort() { rejectExit(fail('session_cancelled', 'The request was cancelled.')); dispose(); }
    signal?.addEventListener('abort', abort, { once: true });
    function fresh() { scope(workspaceId, actor); if (disposed || epoch !== generation(key) || signal?.aborted) throw fail('session_cancelled', 'The connection changed while the request was running.'); }
    try {
      const initialized = await peer.request('initialize', client);
      if (initialized.protocolVersion !== 1) throw fail('unsupported_protocol', 'This Copilot version does not support ACP v1. Update the CLI.');
      const session = await peer.request('session/new', { cwd, mcpServers: [] });
      sessionId = session.sessionId;
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 500) throw fail('runtime_protocol', 'Copilot did not return a session identifier.');
      fresh();
      // Older releases expose models through models; new releases use category
      // model config options. Both are native ACP metadata, not entitlement proof.
      const flatten = choices => (Array.isArray(choices) ? choices : []).flatMap(item => Array.isArray(item.options) ? flatten(item.options) : [item]);
      const modelOption = session.configOptions?.find(item => item.type === 'select' && item.category === 'model');
      const models = [...(session.models?.availableModels || []).map(item => ({ id: item.modelId, name: item.name || item.modelId })), ...flatten(modelOption?.options).map(item => ({ id: item.value, name: item.name || item.value }))].filter(item => modelId(item.id)).slice(0, 200);
      const unique = [...new Map(models.map(item => [item.id, item])).values()];
      return { peer, sessionId, models: unique, exited, fresh, dispose, listen: callback => listeners.add(callback), async selectModel(model) {
        if (!model) return;
        if (!modelId(model)) throw fail('invalid_model', 'Choose a valid provider model identifier.', 400);
        if (modelOption) await peer.request('session/set_config_option', { sessionId, configId: modelOption.id, value: model });
        else await peer.request('session/set_model', { sessionId, modelId: model });
      }, diagnostic: () => stderr };
    } catch (reason) { dispose(); throw fail(reason.code || 'runtime_error', scrub(reason.message)); }
  }
  async function check(workspaceId, actor) {
    const key = scope(workspaceId, actor);
    if (logins.get(key)?.status === 'running') throw fail('sign_in_pending', 'Complete the current sign-in before checking.');
    const session = await open(workspaceId, actor);
    try { session.fresh(); return { ...save(workspaceId, actor, 'configured'), models: session.models, requires_model_test: true }; } finally { session.dispose(); }
  }
  async function models(workspaceId, actor) { const session = await open(workspaceId, actor); try { session.fresh(); return session.models; } finally { session.dispose(); } }
  async function startRun({ workspaceId, actor, prompt, model = '', workMode = 'conversation', permissionMode = 'read-only', nativeToolBridge, cwd, allowedRoot, reasoningEffort, timeoutMs = 1800000, signal, verification = false }, callbacks = {}) {
    scope(workspaceId, actor);
    if (workMode !== 'conversation' || permissionMode !== 'read-only' || nativeToolBridge || cwd || allowedRoot || reasoningEffort) throw fail('copilot_options', 'Copilot currently supports General chat and reviewed final-reply Talvori actions, without native tools or project folders.', 400);
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100_000 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000 || model && !modelId(model)) throw fail('invalid_runtime_request', 'Choose a valid prompt, model and execution deadline.', 400);
    if (!verification && status(workspaceId, actor).state !== 'connected') throw fail('not_connected', 'Test your Copilot account before starting a conversation.');
    const controller = new AbortController();
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    let session, text = '', settled = false, timedOut = false, eventCount = 0;
    const emit = event => { if (!settled && eventCount++ < 5000) callbacks.onEvent?.(event); };
    const finish = (runStatus, reason, code) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); session?.dispose();
      callbacks.onComplete?.({ status: runStatus, text: scrub(text), ...(reason ? { error: scrub(reason).slice(0, 12000), error_code: code || 'runtime_error' } : {}) });
    };
    const timer = setTimeout(() => { timedOut = true; controller.abort(); finish('failed', 'The run reached its execution deadline. No prompt was retried.', 'run_timeout'); }, timeoutMs); timer.unref?.();
    // Return cancellation immediately, including during handshake/model setup.
    void (async () => {
      session = await open(workspaceId, actor, { signal: controller.signal, onEvent: emit });
      await session.selectModel(model); session.fresh();
      session.listen(update => {
        if (settled || update?.sessionUpdate !== 'agent_message_chunk' || update.content?.type !== 'text') return;
        text += scrub(update.content.text);
        if (text.length > 100_000) throw fail('runtime_output_limit', 'Copilot reply exceeded the capture limit.');
        emit({ type: 'agent.progress', summary: 'Receiving Copilot reply', payload: { text: scrub(update.content.text).slice(0, 12000) } });
      });
      emit({ type: 'run.started', summary: 'GitHub Copilot session started', payload: { transport: 'acp', workMode: 'conversation', timeoutMs, liveAccountContacted: true } });
      const result = await Promise.race([session.peer.request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: prompt }] }, timeoutMs), session.exited]);
      session.fresh();
      if (result.stopReason === 'cancelled') return finish('stopped');
      if (result.stopReason !== 'end_turn') return finish('failed', `Copilot stopped before a complete reply (${String(result.stopReason || 'unknown')}).`, 'runtime_incomplete');
      if (!text.trim()) return finish('failed', 'Copilot finished without a text reply.', 'empty_reply');
      emit({ type: 'agent.message', summary: scrub(text).slice(0, 12000), payload: { text: scrub(text) } });
      finish('completed');
    })().catch(reason => finish(controller.signal.aborted && !timedOut ? 'stopped' : 'failed', controller.signal.aborted && !timedOut ? undefined : reason.message, reason.code));
    return { stop() { if (settled) return; try { session?.peer.notify('session/cancel', { sessionId: session.sessionId }); } catch {} controller.abort(); finish('stopped'); } };
  }
  async function test(workspaceId, actor, model = '') {
    const key = scope(workspaceId, actor), epoch = generation(key);
    let resolve; const result = new Promise(done => { resolve = done; });
    await startRun({ workspaceId, actor, model, prompt: 'Reply with exactly OK.', timeoutMs: 60_000, verification: true }, { onComplete: resolve });
    const reply = await result;
    scope(workspaceId, actor);
    if (epoch !== generation(key)) throw fail('connection_changed', 'This connection changed during verification.');
    if (reply.status !== 'completed') { save(workspaceId, actor, ['not_installed', 'unsupported_protocol', 'runtime_start_failed', 'runtime_protocol'].includes(reply.error_code) ? 'not_connected' : 'configured'); throw fail(reply.error_code || 'test_failed', reply.error || 'Copilot verification did not complete.'); }
    return { ...save(workspaceId, actor, 'connected', true), reply: reply.text, model: model || 'Provider default', verification_scope: 'One model request, not all models or tools' };
  }
  function disconnect(workspaceId, actor) {
    const key = scope(workspaceId, actor); generations.set(key, generation(key) + 1);
    for (const stop of [...(operations.get(key) || [])]) stop();
    const login = logins.get(key); if (login) { login.status = 'cancelled'; clearTimeout(login.timer); terminateAgentProcess(login.child); logins.delete(key); }
    db.prepare("DELETE FROM ai_account_connections WHERE workspace_id=? AND actor_id=? AND provider='copilot'").run(workspaceId, actor.id);
    return status(workspaceId, actor);
  }
  function login(workspaceId, actor) {
    const key = scope(workspaceId, actor);
    if (logins.get(key)?.status === 'running') return status(workspaceId, actor);
    if ([...logins.values()].filter(item => item.status === 'running').length >= 4) throw fail('sign_in_busy', 'Too many provider sign-ins are pending. Finish or cancel one first.');
    disconnect(workspaceId, actor);
    const child = spawnProcess('copilot', ['login', '--device-code', '--no-auto-update'], { env: environment(key), cwd: dataDir, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const auth = { child, status: 'running', output: '', timer: null }; logins.set(key, auth);
    const capture = chunk => { if (auth.status === 'running') auth.output = scrub(auth.output + chunk.toString()).slice(-12000); };
    child.stdout.on('data', capture); child.stderr.on('data', capture); child.stdin.on('error', () => {}); child.stdin.end();
    auth.timer = setTimeout(() => { auth.status = 'expired'; terminateAgentProcess(child); }, 5 * 60_000); auth.timer.unref?.();
    child.on('error', reason => { clearTimeout(auth.timer); auth.status = 'failed'; auth.output = reason.code === 'ENOENT' ? 'Install GitHub Copilot CLI on the Talvori server, then try again.' : 'Could not start Copilot sign-in.'; });
    child.on('close', code => { clearTimeout(auth.timer); if (auth.status === 'running') { auth.status = code === 0 ? 'complete' : 'failed'; if (code === 0 && !closed) save(workspaceId, actor, 'configured'); } });
    return status(workspaceId, actor);
  }
  function close() { if (closed) return; closed = true; for (const active of [...operations.values()]) for (const stop of [...active]) stop(); for (const login of logins.values()) { clearTimeout(login.timer); terminateAgentProcess(login.child); } logins.clear(); }
  return { status, check, models, test, startRun, disconnect, login, close };
}

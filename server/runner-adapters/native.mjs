// Protocol contracts adapted from review of Paseo (Apache-2.0), pinned
// c70a6cfb9ea29c87df52b6b6c574775b0d3b169c. Original bounded Frondose drivers.
// See third-party/paseo/runtime-adapters.md for sources and modifications.
import { randomUUID } from 'node:crypto';
import { createRuntimeTransport, runtimeError, validNativeId } from './transport.mjs';

const blockText = content => Array.isArray(content) ? content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n') : typeof content === 'string' ? content : '';

export async function runStreamJson(options) {
  const { providerId, spawnChild, prompt, signal, timeoutMs, forward, append, snapshot } = options;
  const antigravity = providerId === 'antigravity';
  let nativeId = null, transport, finished = false;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  transport = createRuntimeTransport(spawnChild(), { signal, timeoutMs, platform: options.platform, env: options.env,
    onFrame(frame) {
      const eventSession = antigravity ? frame.conversation_id ?? frame.step_update?.conversation_id ?? frame.result?.conversation_id : frame.session_id;
      if (nativeId && eventSession && eventSession !== nativeId) throw runtimeError('runner_event_session_mismatch', 'The provider emitted an event for a different native session.');
      if (antigravity && frame.event === 'init') {
        nativeId = validNativeId(frame.conversation_id); forward(frame, 'antigravity');
        transport.send({ event: 'user', message: { content: prompt } });
        return;
      }
      if (!antigravity && frame.type === 'system' && frame.subtype === 'init') nativeId = validNativeId(frame.session_id);
      forward(frame, antigravity ? 'antigravity' : 'claude');
      if (!antigravity && frame.type === 'control_request') {
        transport.send({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response: { behavior: 'deny', message: 'Frondose does not grant interactive tool capabilities.' } } });
        return;
      }
      if (antigravity) {
        if (frame.event === 'step_update' && ['RESPONSE', 'agent_response'].includes(frame.step_update?.step_type) && typeof frame.step_update.text_delta === 'string') append(frame.step_update.text_delta);
        if (frame.event === 'result') {
          if (frame.result?.status !== 'SUCCESS') throw runtimeError('runtime_turn_failed', frame.result?.error || 'Antigravity did not complete the request.');
          snapshot(frame.result.response || ''); finished = true; resolveDone();
        }
      } else {
        if (frame.type === 'stream_event' && frame.event?.type === 'content_block_delta' && frame.event.delta?.type === 'text_delta') append(frame.event.delta.text || '');
        if (frame.type === 'assistant') {
          const text = blockText(frame.message?.content); if (text) snapshot(text);
        }
        if (frame.type === 'result') {
          if (frame.is_error || frame.subtype !== 'success') throw runtimeError('runtime_turn_failed', frame.errors?.join?.('\n') || 'Claude Code did not complete the request.');
          if (typeof frame.result === 'string') snapshot(frame.result);
          nativeId ||= validNativeId(frame.session_id); finished = true; resolveDone();
        }
      }
    },
  });
  try {
    if (!antigravity) transport.send({ type: 'user', message: { role: 'user', content: prompt } });
    await transport.race(done);
    if (!finished || !nativeId) throw runtimeError('runtime_protocol', 'The provider did not return a completed native session.');
    return { providerSessionId: nativeId, stopReason: 'end_turn' };
  } finally { await transport.dispose(); }
}

export async function runCodex(options) {
  const { spawnChild, prompt, model, cwd, signal, timeoutMs, forward, append, snapshot, nativeToolsApproved, permissionMode } = options;
  let nativeId, turnId, transport;
  const items = new Map();
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  transport = createRuntimeTransport(spawnChild(), { signal, timeoutMs, platform: options.platform, env: options.env,
    onStop() { if (nativeId && turnId) transport.send({ id: `cancel-${randomUUID()}`, method: 'turn/interrupt', params: { threadId: nativeId, turnId } }); },
    onFrame(frame) {
      const p = frame.params || {};
      if (nativeId && p.threadId && p.threadId !== nativeId) throw runtimeError('runner_event_session_mismatch', 'Codex emitted another thread.');
      if (frame.method && frame.id !== undefined) {
        const decisions = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'];
        transport.send(decisions.includes(frame.method) ? { id: frame.id, result: { decision: 'decline' } } : { id: frame.id, error: { code: -32601, message: 'Frondose does not grant this client capability.' } });
        return;
      }
      // Ignore unrelated startup notifications before our own thread/start reply.
      if (!nativeId) return;
      forward(frame, 'codex');
      if (frame.method === 'item/agentMessage/delta') append(p.delta || '');
      if (frame.method === 'item/completed' && p.item?.type === 'agentMessage' && p.item.phase !== 'commentary') {
        items.set(p.item.id || String(items.size), p.item.text || ''); snapshot([...items.values()].join('\n'));
      }
      if (frame.method === 'turn/completed') {
        if (turnId && p.turn?.id !== turnId) return;
        if (p.turn?.status === 'interrupted') resolveDone('cancelled');
        else if (p.turn?.status === 'completed') resolveDone('end_turn');
        else throw runtimeError('runtime_turn_failed', p.turn?.error?.message || 'Codex did not complete its turn.');
      }
    },
  });
  try {
    await transport.request('initialize', { clientInfo: { name: 'frondose', title: 'Frondose', version: '0.1.0' } });
    transport.send({ method: 'initialized', params: {} });
    const config = {};
    if (!nativeToolsApproved) {
      // Empty maps can merge with the provider's saved config. Explicitly disable
      // every inherited MCP entry without emitting or returning that config.
      const saved = await transport.request('config/read', { includeLayers: false });
      if (!saved.config || typeof saved.config !== 'object' || Array.isArray(saved.config)) throw runtimeError('runtime_configuration', 'Codex did not return a safe configuration map.');
      const servers = saved.config.mcp_servers ?? saved.config.mcpServers ?? {};
      if (!servers || typeof servers !== 'object' || Array.isArray(servers) || Object.keys(servers).length > 200) throw runtimeError('runtime_configuration', 'The provider MCP configuration could not be safely restricted.');
      config.mcp_servers = Object.fromEntries(Object.keys(servers).map(name => [name, { enabled: false }]));
    }
    const created = await transport.request('thread/start', { cwd, model: model || null, approvalPolicy: 'never', sandbox: nativeToolsApproved && permissionMode === 'workspace-write' ? 'workspace-write' : 'read-only', ephemeral: true, config });
    nativeId = validNativeId(created.thread?.id);
    const turn = await transport.request('turn/start', { threadId: nativeId, input: [{ type: 'text', text: prompt }], approvalPolicy: 'never', ...(model ? { model } : {}), ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}) });
    turnId = validNativeId(turn.turn?.id);
    return { providerSessionId: nativeId, stopReason: await transport.race(done) };
  } finally { await transport.dispose(); }
}

export async function runPi(options) {
  const { providerId, spawnChild, prompt, signal, timeoutMs, forward, append, snapshot } = options;
  let transport, nativeId = null, resolveDone, resolveReady;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const ready = new Promise(resolve => { resolveReady = resolve; });
  transport = createRuntimeTransport(spawnChild(), { signal, timeoutMs, platform: options.platform, env: options.env,
    onStop() { transport.send({ type: 'abort', id: `cancel-${randomUUID()}` }); },
    onFrame(frame) {
      if (frame.type === 'ready') { resolveReady(frame); return; }
      if (frame.type === 'extension_ui_request') { transport.send({ type: 'extension_ui_response', id: frame.id, cancelled: true }); }
      if (!nativeId) return;
      forward(frame, providerId);
      if (frame.type === 'message_update' && frame.assistantMessageEvent?.type === 'text_delta') append(frame.assistantMessageEvent.delta || '');
      if (frame.type === 'message_end' && frame.message?.role === 'assistant') {
        const text = blockText(frame.message.content); if (text) snapshot(text);
        if (frame.message.stopReason === 'error') throw runtimeError('runtime_turn_failed', frame.message.errorMessage || 'The provider returned a model error.');
      }
      if (frame.type === 'agent_end' && frame.willRetry !== true) {
        const messages = (frame.messages || []).filter(item => item?.role === 'assistant');
        if (messages.some(item => item.stopReason === 'error')) throw runtimeError('runtime_turn_failed', 'The provider returned a model error.');
        const texts = messages.map(item => blockText(item.content)).filter(Boolean); if (texts.length) snapshot(texts.join('\n'));
        resolveDone('end_turn');
      }
      if (frame.type === 'agent_settled') resolveDone('end_turn');
    },
  });
  try {
    // OMP remains on its supported v1 framing. Do not negotiate v2 without a
    // bounded chunk decoder or silently interpret chunk envelopes as messages.
    if (providerId === 'omp') await transport.race(ready);
    const state = await transport.request('get_state', {}, { rpc: false });
    nativeId = validNativeId(state.sessionId || `ephemeral-${randomUUID()}`);
    await transport.request('prompt', { message: prompt }, { rpc: false });
    return { providerSessionId: nativeId, stopReason: await transport.race(done) };
  } finally { await transport.dispose(); }
}

export async function runMuse(options) {
  const { spawnChild, prompt, cwd, model, signal, timeoutMs, forward, append, snapshot } = options;
  let transport, nativeId, turnId;
  const items = new Map();
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  transport = createRuntimeTransport(spawnChild(), { signal, timeoutMs, platform: options.platform, env: options.env,
    onStop() { if (nativeId && turnId) transport.send({ jsonrpc: '2.0', id: `cancel-${randomUUID()}`, method: 'turn/interrupt', params: { sessionId: nativeId, turnId, commandId: randomUUID() } }); },
    onFrame(frame) {
      const p = frame.params || {};
      if (nativeId && p.sessionId && p.sessionId !== nativeId) throw runtimeError('runner_event_session_mismatch', 'Muse emitted another session.');
      if (frame.method && frame.id !== undefined) { transport.send({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Frondose does not grant client capabilities.' } }); return; }
      if (!nativeId) return;
      forward(frame, 'muse');
      if (frame.method === 'item/delta' && items.has(p.itemId) && (!p.field || p.field === 'text')) { items.set(p.itemId, items.get(p.itemId) + (p.delta || '')); snapshot([...items.values()].join('\n')); }
      if (['item/started', 'item/completed', 'item/updated'].includes(frame.method) && p.item?.kind === 'agentMessage') { items.set(p.item.itemId, p.item.text || ''); snapshot([...items.values()].join('\n')); }
      if (frame.method === 'turn/completed') {
        if (turnId && p.turnId !== turnId) return;
        if (p.error || p.terminal === 'failed') throw runtimeError('runtime_turn_failed', p.error?.message || 'Muse did not complete its turn.');
        resolveDone(p.terminal === 'cancelled' ? 'cancelled' : 'end_turn');
      }
    },
  });
  const request = (method, params = {}) => transport.request(method, params, { jsonrpc: true });
  try {
    const initialized = await request('initialize', { clientInfo: { name: 'frondose', version: '1' }, capabilities: { experimentalApi: true, requestedCapabilities: ['sessionMcp'] } });
    if (initialized.schema?.fingerprint !== 'sha256:e0e163db6ccf00dbe68402ce55d6319b3edc33c421f31e9583b587b2de8a118f') throw runtimeError('unsupported_protocol', 'This Muse MSP schema has not been validated by this Frondose adapter. No prompt was sent.');
    transport.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    const created = await request('session/start', { commandId: randomUUID(), workspaceRoot: cwd, modelId: model || null, approvalMode: 'denyUnmatched', config: { mcpServers: [] } });
    nativeId = validNativeId(created.session?.sessionId);
    const turn = await request('turn/start', { commandId: randomUUID(), sessionId: nativeId, input: [{ type: 'text', text: prompt }], displayText: prompt, ifBusy: 'queue', ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}) });
    turnId = validNativeId(turn.turnId);
    return { providerSessionId: nativeId, stopReason: await transport.race(done) };
  } finally { await transport.dispose(); }
}

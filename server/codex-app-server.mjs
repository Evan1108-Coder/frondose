import { createAgentJsonlPeer, terminateAgentProcess } from './agent-jsonl-peer.mjs';

// Each reviewed Frondose turn gets a fresh ephemeral native thread. Resuming an
// opaque provider history would silently bypass Frondose's exact-context review.
export function startCodexAppServer({ child, prompt, cwd, model, reasoningEffort, permissionMode, timeoutMs, signal, scrub = String }, { onEvent = () => {}, onComplete = () => {}, onUsageReport = () => {} } = {}) {
  let settled = false, turnId, threadId, text = '', stderr = '', count = 0, usageReport = null, usageCaptureIncomplete = false;
  const items = new Map();
  const emit = (type, summary, payload = {}) => { if (!settled && count++ < 5000) onEvent({ type, summary: scrub(summary).slice(0, 12000), payload }); };
  const finish = (status, reason, code) => {
    if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', stop);
    peer.dispose(); terminateAgentProcess(child);
    onComplete({ status, text: scrub(text).slice(-100_000), ...(reason ? { error: scrub(reason).slice(0, 12000), error_code: code || 'runtime_error' } : {}), ...(usageCaptureIncomplete ? { usage_capture_incomplete: true, usage_error_code: 'usage_persistence_failed' } : {}) });
  };
  function stop() {
    if (settled) return;
    if (threadId && turnId) void peer.request('turn/interrupt', { threadId, turnId }, 1000).catch(() => {});
    finish('stopped');
  }
  const peer = createAgentJsonlPeer(child, {
    onRequest: message => {
      emit('permission.denied', 'Provider tool or interactive request denied by Frondose.');
      if (message.method === 'item/commandExecution/requestApproval' || message.method === 'item/fileChange/requestApproval') return { result: { decision: 'decline' } };
      return { error: { code: -32601, message: 'This capability is not granted by Frondose.' } };
    },
    onFailure: reason => finish('failed', reason.message, reason.code),
    onNotification: message => {
      const p = message.params || {};
      if (p.threadId && p.threadId !== threadId) return;
      if (message.method === 'item/agentMessage/delta') emit('agent.progress', 'Receiving reply', { text: scrub(p.delta || '').slice(0, 12_000) });
      if (message.method === 'item/completed' && p.item?.type === 'agentMessage') {
        if (p.item.phase === 'commentary') emit('agent.progress', p.item.text || '');
        else {
          items.set(p.item.id, scrub(p.item.text || ''));
          text = [...items.values()].join('\n');
          if (text.length > 100_000) { finish('failed', 'Codex reply exceeded the capture limit.', 'runtime_output_limit'); return; }
          emit('agent.message', p.item.text || '', { text });
        }
      }
      if (message.method === 'thread/tokenUsage/updated') {
        // This thread contains exactly one turn. Its total is the cumulative
        // usage, unlike snapshots of the last individual model request.
        const total = p.tokenUsage?.total;
        if (total) usageReport = { provider: 'codex', source: 'turn.completed', main: { input_tokens: total.inputTokens, cached_input_tokens: total.cachedInputTokens, output_tokens: total.outputTokens, reasoning_output_tokens: total.reasoningOutputTokens } };
      }
      if (message.method === 'turn/completed') {
        if (turnId && p.turn?.id !== turnId) return;
        const status = p.turn?.status;
        if (usageReport && status !== 'interrupted') { try { onUsageReport(usageReport); } catch { usageCaptureIncomplete = true; } }
        if (status === 'completed') finish(text.trim() ? 'completed' : 'failed', text.trim() ? undefined : 'Codex finished without a text reply.', 'empty_reply');
        else if (status === 'interrupted') finish('stopped');
        else finish('failed', p.turn?.error?.message || 'Codex did not complete this turn.', 'runtime_turn_failed');
      }
    },
  });
  child.stderr.on('data', chunk => { stderr = scrub(stderr + chunk.toString()).slice(-12000); });
  const timer = setTimeout(() => finish('failed', 'The run reached its execution limit. No automatic retry was sent.', 'run_timeout'), timeoutMs); timer.unref?.();
  signal?.addEventListener('abort', stop, { once: true });
  void (async () => {
    if (signal?.aborted) { stop(); return; }
    await peer.request('initialize', { clientInfo: { name: 'frondose', title: 'Frondose', version: '0.1.0' } });
    if (settled) return;
    peer.notify('initialized');
    const result = await peer.request('thread/start', { cwd, model: model || null, approvalPolicy: 'never', sandbox: permissionMode, ephemeral: true });
    threadId = result.thread?.id;
    if (typeof threadId !== 'string' || !threadId) throw new Error('Codex did not return a thread identifier.');
    emit('provider.ready', 'Codex session bridge ready', { transport: 'app-server', ephemeral: true });
    emit('run.started', 'Codex session bridge started', { transport: 'app-server', timeoutMs, permissionMode, liveAccountContacted: true });
    const turn = await peer.request('turn/start', { threadId, input: [{ type: 'text', text: prompt }], ...(model ? { model } : {}), ...(reasoningEffort ? { effort: reasoningEffort } : {}), approvalPolicy: 'never' }, timeoutMs);
    turnId = turn.turn?.id;
    if (!turnId && !settled) throw new Error('Codex did not return a turn identifier.');
  })().catch(reason => finish('failed', reason.message || stderr || 'Codex session bridge failed.', reason.code));
  return { stop };
}

import { StringDecoder } from 'node:string_decoder';

const failure = (code, message) => Object.assign(new Error(message), { code, statusCode: 409 });

// Provider-neutral JSONL transport. Never uses a shell, interprets stderr as RPC,
// retries uncertain requests, or grants provider-initiated capabilities.
export function createAgentJsonlPeer(child, { jsonrpc = false, timeoutMs = 20_000, onNotification = () => {}, onRequest = () => ({ error: { code: -32601, message: 'Client capability unavailable' } }), onFailure = () => {} } = {}) {
  const pending = new Map(), decoder = new StringDecoder('utf8');
  let sequence = 0, buffer = '', ended = false;
  function write(value) {
    if (ended || child.stdin.destroyed) throw failure('runtime_closed', 'The agent transport is closed.');
    const wire = `${JSON.stringify(jsonrpc ? { jsonrpc: '2.0', ...value } : value)}\n`;
    if (Buffer.byteLength(wire) > 1_000_000 || child.stdin.writableLength > 2_000_000) throw failure('runtime_backpressure', 'The agent input exceeded its bounded queue.');
    child.stdin.write(wire);
  }
  function dispose(reason = failure('runtime_closed', 'The agent transport closed before replying.')) {
    if (ended) return;
    ended = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(reason); }
    pending.clear();
  }
  function fatal(reason) { if (ended) return; dispose(reason); onFailure(reason); }
  function consume(line) {
    if (!line.trim() || ended) return;
    let message;
    try { message = JSON.parse(line); } catch { fatal(failure('runtime_protocol', 'The agent returned invalid JSONL. Update the CLI and retry.')); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) { fatal(failure('runtime_protocol', 'The agent returned an invalid protocol record.')); return; }
    if (message.method && message.id !== undefined) {
      Promise.resolve().then(() => onRequest(message)).then(result => { if (!ended) write({ id: message.id, ...result }); }).catch(() => { if (!ended) { try { write({ id: message.id, error: { code: -32603, message: 'Client request denied' } }); } catch (reason) { fatal(reason); } } });
    } else if (message.id !== undefined && pending.has(message.id)) {
      const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timer);
      if (message.error || message.success === false) request.reject(failure('runtime_rejected', typeof message.error?.message === 'string' ? message.error.message : typeof message.error === 'string' ? message.error : 'The agent rejected the request.'));
      else request.resolve(message.result ?? message.data ?? {});
    } else {
      try { onNotification(message); } catch (reason) { fatal(reason); }
    }
  }
  child.stdout.on('data', chunk => {
    if (ended) return;
    buffer += decoder.write(chunk);
    if (Buffer.byteLength(buffer) > 2_000_000) { fatal(failure('runtime_output_limit', 'The agent exceeded the protocol frame limit.')); return; }
    let index;
    while (!ended && (index = buffer.indexOf('\n')) !== -1) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); consume(line); }
  });
  child.stdin.on('error', () => fatal(failure('runtime_closed', 'The agent input pipe closed.')));
  child.on('error', reason => fatal(failure(reason.code === 'ENOENT' ? 'not_installed' : 'runtime_start_failed', reason.code === 'ENOENT' ? 'The agent CLI is not installed or is not on the server PATH.' : 'The agent process could not start.')));
  child.on('close', () => { if (!ended) { buffer += decoder.end(); if (buffer.trim()) consume(buffer); fatal(failure('runtime_exited', 'The agent exited before the request completed.')); } });
  function request(method, params = {}, deadline = timeoutMs) {
    if (ended) return Promise.reject(failure('runtime_closed', 'The agent transport is closed.'));
    if (pending.size >= 32) return Promise.reject(failure('runtime_queue_full', 'Too many outstanding agent requests.'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(failure('runtime_timeout', `The agent did not finish ${method} before its deadline. The request was not retried.`)); }, deadline); timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try { write({ id, method, params }); } catch (reason) { clearTimeout(timer); pending.delete(id); reject(reason); }
    });
  }
  return { request, notify: (method, params = {}) => write({ method, params }), dispose };
}

export function terminateAgentProcess(child) {
  const kill = signal => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch { try { child.kill(signal); } catch {} } };
  kill('SIGTERM');
  const timer = setTimeout(() => kill('SIGKILL'), 2000); timer.unref?.();
  child.once('close', () => clearTimeout(timer));
}

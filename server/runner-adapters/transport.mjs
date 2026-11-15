// Original Frondose bounded JSONL transport. Protocol shapes reviewed against
// Paseo c70a6cfb9ea29c87df52b6b6c574775b0d3b169c (Apache-2.0).
import { StringDecoder } from 'node:string_decoder';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { sanitizeRunnerText } from '../runner-events.mjs';

export const runtimeError = (code, message) => Object.assign(new Error(message), { code, statusCode: 409 });

export function validNativeId(value) {
  if (typeof value !== 'string' || !value || value.length > 500 || /[\x00-\x1f\x7f]/u.test(value)) throw runtimeError('runtime_protocol', 'The provider returned an invalid session identifier.');
  return value;
}

const closedChildren = new WeakSet(), terminationPromises = new WeakMap();

/** Track close from spawn onward, including an exit before cleanup starts. */
export function trackRuntimeChild(child) {
  child.once('close', () => closedChildren.add(child));
  return child;
}

/** Await bounded process-family termination before a working-folder lock can be
 * released. This is not an OS job sandbox; Windows taskkill requires a live parent
 * to enumerate its tree. A cleanup failure must quarantine the helper, not permit
 * another request to reuse that folder while the old process may still be alive.
 */
export function terminateRuntimeChild(child, { platform = process.platform, env = process.env, graceful = false, graceMs = 2000, forceMs = 2000 } = {}) {
  if (terminationPromises.has(child)) return terminationPromises.get(child);
  const waitForClose = duration => {
    if (closedChildren.has(child)) return Promise.resolve(true);
    return new Promise(resolve => {
      const finish = closed => { clearTimeout(timer); child.removeListener('close', onClose); resolve(closed); };
      const onClose = () => { closedChildren.add(child); finish(true); };
      const timer = setTimeout(() => finish(false), duration);
      child.once('close', onClose);
    });
  };
  const kill = signal => { try { if (child.pid && platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch { try { child.kill(signal); } catch {} } };
  const operation = (async () => {
    if (platform === 'win32' && Number.isSafeInteger(child.pid) && child.pid > 0 && !closedChildren.has(child)) {
      const configured = Object.entries(env).find(([key]) => key.toLowerCase() === 'systemroot')?.[1];
      const root = typeof configured === 'string' && path.win32.isAbsolute(configured) && !/[\0\r\n]/u.test(configured) ? configured : 'C:\\Windows';
      const treeStopped = await new Promise(resolve => {
        let killer, timer, settled = false;
        const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
        try {
          killer = spawn(path.win32.join(root, 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          killer.once('error', () => finish(false));
          killer.once('close', code => finish(code === 0));
          timer = setTimeout(() => { try { killer.kill('SIGKILL'); } catch {} finish(false); }, forceMs);
        } catch { finish(false); }
      });
      if (!treeStopped) { kill('SIGKILL'); await waitForClose(forceMs); throw runtimeError('runtime_cleanup_failed', 'Windows could not confirm stopping the runtime tree. Stop this helper before reusing its folders.'); }
    } else {
      if (graceful && !closedChildren.has(child)) { kill('SIGTERM'); await waitForClose(graceMs); }
      // Kill the whole POSIX group even after its leader exits: a native-tool
      // descendant may ignore SIGTERM and outlive that leader.
      kill('SIGKILL');
    }
    if (!await waitForClose(forceMs)) throw runtimeError('runtime_cleanup_failed', 'The runtime did not close after forced termination. Stop this helper before reusing its folders.');
  })();
  terminationPromises.set(child, operation);
  return operation;
}

/** No shell, automatic retry, account discovery or capability grants. */
export function createRuntimeTransport(child, { signal, timeoutMs, platform = process.platform, env = process.env, onFrame = () => {}, onStop = () => {} }) {
  if (!child?.stdin || !child?.stdout || !child?.stderr || typeof child.on !== 'function') throw runtimeError('runtime_start_failed', 'The runtime did not provide stdio pipes.');
  trackRuntimeChild(child);
  const decoder = new StringDecoder('utf8'), pending = new Map(), waiters = new Set();
  let buffer = '', bytes = 0, sequence = 0, disposed = false, failure = null;
  let rejectFailure;
  const failed = new Promise((_, reject) => { rejectFailure = reject; });
  failed.catch(() => {});
  const fail = reason => {
    if (failure || disposed) return;
    failure = runtimeError(typeof reason?.code === 'string' ? reason.code : 'runtime_error', sanitizeRunnerText(reason?.message || 'The runtime failed.', 2000));
    for (const request of pending.values()) request.reject(failure);
    pending.clear(); rejectFailure(failure);
  };
  const send = value => {
    if (failure) throw failure;
    if (disposed || child.stdin.destroyed) throw runtimeError('runtime_closed', 'The runtime input is closed.');
    const line = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(line) > 1_000_000 || child.stdin.writableLength > 2_000_000) throw runtimeError('runtime_backpressure', 'The runtime input queue is full.');
    child.stdin.write(line);
  };
  const consume = line => {
    if (!line.trim() || disposed || failure) return;
    let frame;
    try { frame = JSON.parse(line); } catch { fail(runtimeError('runtime_protocol', 'The provider returned invalid JSONL.')); return; }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) { fail(runtimeError('runtime_protocol', 'The provider returned an invalid record.')); return; }
    try {
      if (frame.id !== undefined && pending.has(String(frame.id)) && !frame.method && (frame.type === undefined || frame.type === 'response')) {
        const request = pending.get(String(frame.id)); pending.delete(String(frame.id));
        if (frame.error || frame.success === false) request.reject(runtimeError('runtime_rejected', typeof frame.error === 'string' ? frame.error : frame.error?.message || 'The provider rejected the request.'));
        else request.resolve(frame.result ?? frame.data ?? {});
      } else onFrame(frame);
      for (const waiter of [...waiters]) if (waiter.test(frame)) { waiters.delete(waiter); waiter.resolve(frame); }
    } catch (reason) { fail(reason); }
  };
  child.stdout.on('data', chunk => {
    if (disposed || failure) return;
    bytes += Buffer.byteLength(chunk);
    if (bytes > 8_000_000) { fail(runtimeError('runtime_output_limit', 'The provider exceeded the total output limit.')); return; }
    buffer += decoder.write(chunk);
    if (Buffer.byteLength(buffer) > 2_000_000) { fail(runtimeError('runtime_output_limit', 'The provider exceeded the JSONL frame limit.')); return; }
    let index;
    while (!failure && (index = buffer.indexOf('\n')) !== -1) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); consume(line); }
  });
  child.stderr.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > 8_000_000) fail(runtimeError('runtime_output_limit', 'The provider exceeded the total output limit.')); });
  child.stdin.on('error', () => fail(runtimeError('runtime_closed', 'The runtime input pipe closed.')));
  child.on('error', reason => fail(runtimeError(reason?.code === 'ENOENT' ? 'not_installed' : 'runtime_start_failed', 'The installed runtime could not start.')));
  child.on('close', () => { buffer += decoder.end(); if (buffer.trim()) consume(buffer); fail(runtimeError('runtime_exited', 'The runtime exited before the request completed. The request was not retried.')); });
  const stop = () => { try { onStop(); } catch {} fail(runtimeError('session_cancelled', 'The computer request was cancelled.')); };
  const timer = setTimeout(() => { try { onStop(); } catch {} fail(runtimeError('run_timeout', 'The computer request reached its deadline. No prompt was retried.')); }, timeoutMs);
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  return {
    send, fail,
    request(method, params = {}, { rpc = true, jsonrpc = false } = {}) {
      if (pending.size >= 32) return Promise.reject(runtimeError('runtime_queue_full', 'The runtime request queue is full.'));
      const id = String(++sequence);
      const result = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { send(rpc ? { ...(jsonrpc ? { jsonrpc: '2.0' } : {}), id, method, params } : { ...params, id, type: method }); }
        catch (reason) { pending.delete(id); reject(reason); }
      });
      return Promise.race([result, failed]);
    },
    wait(test) {
      const result = new Promise(resolve => waiters.add({ test, resolve }));
      return Promise.race([result, failed]);
    },
    race: promise => Promise.race([promise, failed]),
    async dispose({graceful=false}={}) {
      if (disposed) return terminationPromises.get(child);
      disposed = true; clearTimeout(timer); signal?.removeEventListener('abort', stop);
      for (const request of pending.values()) request.reject(runtimeError('runtime_closed', 'The runtime was closed.'));
      pending.clear(); waiters.clear();
      if(graceful) child.stdin.end();
      await terminateRuntimeChild(child, { platform, env, graceful });
    },
  };
}

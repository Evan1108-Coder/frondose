import { createServer } from 'node:net';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const NATIVE_AGENT_TOOL_STDIO_PATH = fileURLToPath(new URL('./native-agent-tool-stdio.mjs', import.meta.url));
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const fail = (code, message) => Object.assign(new Error(message), { code });
const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value));
const generatedDescriptors = new WeakSet();
export const isNativeAgentToolBridgeDescriptor = (value) => Boolean(value && typeof value === 'object' && generatedDescriptors.has(value));

function normalizeTools(value) {
  if (!Array.isArray(value) || value.length > 64) throw fail('invalid_tools', 'Native tool definitions must be an array of at most 64 tools.');
  const names = new Set();
  const tools = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !TOOL_NAME.test(item.name || '') || names.has(item.name)) throw fail('invalid_tools', 'Native tools require unique, bounded names.');
    names.add(item.name);
    const description = item.description == null ? '' : item.description;
    const inputSchema = item.inputSchema ?? item.input_schema ?? { type: 'object' };
    if (typeof description !== 'string' || description.length > 4000 || !inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema) || jsonBytes(inputSchema) > 65_536) throw fail('invalid_tools', 'Native tool metadata exceeds its bounds.');
    return { name: item.name, description, inputSchema };
  });
  if (jsonBytes(tools) > 131_072) throw fail('invalid_tools', 'The native tool catalog exceeds its total size limit.');
  return tools;
}

export async function createNativeAgentToolBridge({ listTools, callTool, expiresAt, signal, maxMessageBytes = 262_144, maxConcurrent = 8, callTimeoutMs = 15_000 } = {}) {
  if (typeof listTools !== 'function' || typeof callTool !== 'function') throw fail('invalid_bridge', 'Native tool list and call handlers are required.');
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 31 * 60_000) throw fail('invalid_bridge_expiry', 'Native tool bridge expiry must be within the next 31 minutes.');
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1024 || maxMessageBytes > 262_144 || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 32 || !Number.isSafeInteger(callTimeoutMs) || callTimeoutMs < 100 || callTimeoutMs > 120_000) throw fail('invalid_bridge_bounds', 'Native tool bridge bounds are invalid.');
  if (signal?.aborted) throw fail('bridge_revoked', 'Native tool access was revoked.');

  let rejectRevocation, closeOnAbort = null;
  const revoked = new Promise((_, reject) => { rejectRevocation = reject; });
  const abort = () => { rejectRevocation(fail('bridge_revoked', 'Native tool access was revoked.')); if (closeOnAbort) void closeOnAbort(); };
  signal?.addEventListener('abort', abort, { once: true });
  let listTimer;
  const listDeadline = new Promise((_, reject) => { listTimer = setTimeout(() => reject(fail('tool_timeout', 'Native tool discovery timed out.')), callTimeoutMs); listTimer.unref?.(); });
  let tools;
  try { tools = normalizeTools(await Promise.race([Promise.resolve().then(() => listTools()), listDeadline, revoked])); }
  catch (failure) { signal?.removeEventListener('abort', abort); throw failure; }
  finally { clearTimeout(listTimer); }
  if (signal?.aborted || Date.now() >= expiresAt) { signal?.removeEventListener('abort', abort); throw fail('bridge_revoked', 'Native tool access expired or was revoked.'); }
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  let directory;
  try { directory = mkdtempSync(join(tmpdir(), 'rumbo-native-tools-')); chmodSync(directory, 0o700); }
  catch (failure) { signal?.removeEventListener('abort', abort); if (directory) rmSync(directory, { recursive: true, force: true }); throw failure; }
  const socketPath = join(directory, 'bridge.sock');
  const capability = randomBytes(32).toString('base64url');
  const sockets = new Set();
  let closed = false, active = 0, requestCount = 0;

  const server = createServer((socket) => {
    if (closed || sockets.size >= 8) { socket.destroy(); return; }
    sockets.add(socket);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      if (closed) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > maxMessageBytes) { socket.destroy(); return; }
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) void handle(line, socket);
    });
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });

  const send = (socket, value) => { if (!socket.destroyed) socket.write(`${JSON.stringify(value)}\n`); };
  async function handle(line, socket) {
    let request;
    try { request = JSON.parse(line); } catch { send(socket, { id: null, error: { code: 'invalid_json', message: 'Invalid bridge request.' } }); return; }
    const id = typeof request?.id === 'string' || Number.isSafeInteger(request?.id) ? request.id : null;
    if (closed || Date.now() >= expiresAt) { send(socket, { id, error: { code: 'bridge_revoked', message: 'Native tool access expired.' } }); return; }
    const candidate = typeof request?.capability === 'string' ? Buffer.from(request.capability) : Buffer.alloc(0), expected = Buffer.from(capability);
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) { send(socket, { id, error: { code: 'unauthorized', message: 'Native tool access denied.' } }); return; }
    if (++requestCount > 4096) { send(socket, { id, error: { code: 'request_limit', message: 'Native tool request limit reached.' } }); return; }
    if (request.method === 'ping') { send(socket, { id, result: {} }); return; }
    if (request.method === 'tools/list') { send(socket, { id, result: { tools } }); return; }
    if (request.method !== 'tools/call') { send(socket, { id, error: { code: 'method_not_found', message: 'Unsupported bridge method.' } }); return; }
    const name = request.params?.name, args = request.params?.arguments ?? {};
    if (!byName.has(name) || !args || typeof args !== 'object' || Array.isArray(args) || jsonBytes(args) > 131_072) { send(socket, { id, error: { code: 'invalid_tool_call', message: 'Invalid native tool call.' } }); return; }
    if (active >= maxConcurrent) { send(socket, { id, error: { code: 'busy', message: 'Native tool concurrency limit reached.' } }); return; }
    active++;
    let timer;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(fail('tool_timeout', 'Native tool call timed out.')), callTimeoutMs); timer.unref?.(); });
      const result = await Promise.race([Promise.resolve().then(() => callTool(name, args)), timeout]);
      if (jsonBytes(result ?? null) > Math.min(65_536, Math.floor(maxMessageBytes / 4))) throw fail('result_too_large', 'Native tool result exceeds the bridge limit.');
      send(socket, { id, result: result ?? null });
    } catch (failure) {
      const message = String(failure?.message || 'Native tool call failed.').split(capability).join('[redacted]').split(socketPath).join('[redacted]');
      send(socket, { id, error: { code: typeof failure?.code === 'string' ? failure.code : 'tool_failed', message: message.slice(0, 1000) } });
    } finally { clearTimeout(timer); active--; }
  }

  const listening = new Promise((resolve, reject) => {
    const onError = (failure) => { server.off('listening', onListen); reject(failure); };
    const onListen = () => { server.off('error', onError); resolve(); };
    server.once('error', onError); server.once('listening', onListen); server.listen(socketPath);
  });
  let expiryTimer, closePromise;
  function close() {
    if (closePromise) return closePromise;
    closed = true; clearTimeout(expiryTimer); signal?.removeEventListener('abort', abort);
    for (const socket of sockets) socket.destroy();
    closePromise = (async () => {
      await listening.catch(() => {});
      if (server.listening) await new Promise((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    })();
    return closePromise;
  }
  closeOnAbort = close;
  try {
    await Promise.race([listening, revoked]);
    if (signal?.aborted || Date.now() >= expiresAt) throw fail('bridge_revoked', 'Native tool access expired or was revoked.');
    chmodSync(socketPath, 0o600); server.unref();
  } catch (failure) { await close(); throw failure; }
  expiryTimer = setTimeout(() => void close(), Math.max(1, expiresAt - Date.now())); expiryTimer.unref?.();
  const descriptor = Object.freeze({
      name: 'rumbo', transport: 'stdio', command: process.execPath,
      args: Object.freeze([NATIVE_AGENT_TOOL_STDIO_PATH]),
      env: Object.freeze({ RUMBO_NATIVE_TOOL_SOCKET: socketPath, RUMBO_NATIVE_TOOL_CAPABILITY: capability }),
      enabledTools: Object.freeze(tools.map((tool) => tool.name)), required: true,
  });
  generatedDescriptors.add(descriptor);
  return { descriptor, close };
}

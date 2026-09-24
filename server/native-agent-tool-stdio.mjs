import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const MAX_LINE_BYTES = 262_144;
const MAX_PENDING = 32;
const jsonrpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

export function runNativeAgentToolStdio({ input = process.stdin, output = process.stdout, socketPath = process.env.RUMBO_NATIVE_TOOL_SOCKET, capability = process.env.RUMBO_NATIVE_TOOL_CAPABILITY } = {}) {
  if (typeof socketPath !== 'string' || !socketPath.startsWith('/') || socketPath.length > 500 || typeof capability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(capability)) throw new Error('Native tool bridge environment is invalid.');
  const socket = createConnection(socketPath);
  const pending = new Map();
  let inputBuffer = '', socketBuffer = '', closed = false;
  const write = (value) => { if (!closed) output.write(`${JSON.stringify(value)}\n`); };
  const failPending = () => { for (const { id } of pending.values()) write(jsonrpcError(id, -32000, 'Native tool bridge is unavailable.')); pending.clear(); };
  socket.setEncoding('utf8'); input.setEncoding('utf8');
  socket.on('error', failPending);
  socket.on('close', () => { failPending(); closed = true; });
  socket.on('data', (chunk) => {
    socketBuffer += chunk;
    if (Buffer.byteLength(socketBuffer) > MAX_LINE_BYTES) { socket.destroy(); return; }
    const lines = socketBuffer.split('\n'); socketBuffer = lines.pop();
    for (const line of lines) {
      let response; try { response = JSON.parse(line); } catch { socket.destroy(); return; }
      const waiting = pending.get(response.id); if (!waiting) continue;
      pending.delete(response.id);
      if (response.error) write(jsonrpcError(waiting.id, -32000, String(response.error.message || 'Native tool call failed.').slice(0, 1000)));
      else write({ jsonrpc: '2.0', id: waiting.id, result: waiting.map(response.result) });
    }
  });
  const forward = (id, method, params, map = (value) => value) => {
    if (pending.size >= MAX_PENDING || !socket.writable) { write(jsonrpcError(id, -32000, 'Native tool bridge is busy.')); return; }
    const internalId = randomBytes(12).toString('base64url');
    pending.set(internalId, { id, map });
    socket.write(`${JSON.stringify({ id: internalId, capability, method, params })}\n`);
  };
  input.on('data', (chunk) => {
    inputBuffer += chunk;
    if (Buffer.byteLength(inputBuffer) > MAX_LINE_BYTES) { input.destroy(); socket.destroy(); return; }
    const lines = inputBuffer.split('\n'); inputBuffer = lines.pop();
    for (const line of lines) {
      let request; try { request = JSON.parse(line); } catch { write(jsonrpcError(null, -32700, 'Parse error.')); continue; }
      const id = request.id ?? null;
      if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') { if (request.id !== undefined) write(jsonrpcError(id, -32600, 'Invalid request.')); continue; }
      if (request.id === undefined) continue;
      if (request.method === 'initialize') write({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'rumbo', version: '1' } } });
      else if (request.method === 'ping') forward(id, 'ping', {});
      else if (request.method === 'tools/list') forward(id, 'tools/list', {}, (value) => value);
      else if (request.method === 'tools/call') forward(id, 'tools/call', request.params || {}, (value) => value && Array.isArray(value.content) ? value : { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null) }] });
      else write(jsonrpcError(id, -32601, 'Method not found.'));
    }
  });
  input.on('end', () => socket.end());
  return { close: () => socket.destroy() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runNativeAgentToolStdio(); }
  catch { process.exitCode = 1; }
}

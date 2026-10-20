import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { createNativeAgentToolBridge } from '../server/native-agent-tool-bridge.mjs';

function socketClient(path) {
  const socket = connect(path); socket.setEncoding('utf8');
  let buffer = ''; const replies = new Map();
  socket.on('data', (chunk) => {
    buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) { const value = JSON.parse(line); replies.get(value.id)?.(value); replies.delete(value.id); }
  });
  return {
    request(value) { return new Promise((resolve, reject) => { replies.set(value.id, resolve); socket.write(`${JSON.stringify(value)}\n`, failure => failure && reject(failure)); }); },
    socket,
  };
}

function lineReader(stream) {
  stream.setEncoding('utf8'); let buffer = ''; const queue = [], waiters = [];
  stream.on('data', (chunk) => {
    buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) { const value = JSON.parse(line); if (waiters.length) waiters.shift()(value); else queue.push(value); }
  });
  return () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiters.push(resolve));
}

test('private bridge authenticates bounded list and call requests and cleans up its socket', async (t) => {
  const calls = [];
  const bridge = await createNativeAgentToolBridge({
    listTools: () => [{ name: 'documents.read', description: 'Read one approved document', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }],
    callTool: async (name, args) => { calls.push({ name, args }); return { content: [{ type: 'text', text: `document:${args.id}` }] }; },
    expiresAt: Date.now() + 30_000,
  });
  t.after(() => bridge.close());
  const { descriptor } = bridge, directory = dirname(descriptor.env.FRONDOSE_NATIVE_TOOL_SOCKET);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(descriptor.env.FRONDOSE_NATIVE_TOOL_SOCKET).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(descriptor.args).includes(descriptor.env.FRONDOSE_NATIVE_TOOL_CAPABILITY), false);

  const client = socketClient(descriptor.env.FRONDOSE_NATIVE_TOOL_SOCKET); t.after(() => client.socket.destroy());
  const denied = await client.request({ id: 1, capability: 'x'.repeat(43), method: 'tools/list', params: {} });
  assert.equal(denied.error.code, 'unauthorized');
  assert.equal(JSON.stringify(denied).includes(descriptor.env.FRONDOSE_NATIVE_TOOL_CAPABILITY), false);
  const listed = await client.request({ id: 2, capability: descriptor.env.FRONDOSE_NATIVE_TOOL_CAPABILITY, method: 'tools/list', params: {} });
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ['documents.read']);
  const called = await client.request({ id: 3, capability: descriptor.env.FRONDOSE_NATIVE_TOOL_CAPABILITY, method: 'tools/call', params: { name: 'documents.read', arguments: { id: 'doc-1' } } });
  assert.equal(called.result.content[0].text, 'document:doc-1');
  assert.deepEqual(calls, [{ name: 'documents.read', args: { id: 'doc-1' } }]);
  await bridge.close();
  assert.equal(existsSync(directory), false);
});

test('stdio adapter exposes only the bounded MCP surface and forwards through environment secrets', async (t) => {
  const bridge = await createNativeAgentToolBridge({
    listTools: () => [{ name: 'review.record', description: 'Record review', inputSchema: { type: 'object' } }],
    callTool: (_name, args) => ({ accepted: args.decision === 'approve' }),
    expiresAt: Date.now() + 30_000,
  });
  t.after(() => bridge.close());
  const child = spawn(bridge.descriptor.command, bridge.descriptor.args, { env: { ...bridge.descriptor.env }, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  t.after(() => child.kill('SIGTERM'));
  const next = lineReader(child.stdout);
  const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.equal((await next()).result.serverInfo.name, 'frondose');
  send({ jsonrpc: '2.0', id: 2, method: 'ping' });
  assert.deepEqual((await next()).result, {});
  send({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
  assert.deepEqual((await next()).result.tools.map(tool => tool.name), ['review.record']);
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'review.record', arguments: { decision: 'approve' } } });
  const response = await next();
  assert.equal(JSON.parse(response.result.content[0].text).accepted, true);
  send({ jsonrpc: '2.0', id: 5, method: 'resources/list', params: {} });
  assert.equal((await next()).error.code, -32601);
});

test('bridge enforces concurrency and call deadlines without exposing handler failures', async (t) => {
  let release;
  const bridge = await createNativeAgentToolBridge({
    listTools: () => [{ name: 'bounded.wait', inputSchema: { type: 'object' } }],
    callTool: (_name, args) => args.hold ? new Promise(resolve => { release = resolve; }) : new Promise(() => {}),
    expiresAt: Date.now() + 30_000, maxConcurrent: 1, callTimeoutMs: 100,
  });
  t.after(() => bridge.close());
  const client = socketClient(bridge.descriptor.env.FRONDOSE_NATIVE_TOOL_SOCKET); t.after(() => client.socket.destroy());
  const auth = bridge.descriptor.env.FRONDOSE_NATIVE_TOOL_CAPABILITY;
  const held = client.request({ id: 1, capability: auth, method: 'tools/call', params: { name: 'bounded.wait', arguments: { hold: true } } });
  await new Promise(resolve => setImmediate(resolve));
  const busy = await client.request({ id: 2, capability: auth, method: 'tools/call', params: { name: 'bounded.wait', arguments: {} } });
  assert.equal(busy.error.code, 'busy');
  release('done'); assert.equal((await held).result, 'done');
  const timed = await client.request({ id: 3, capability: auth, method: 'tools/call', params: { name: 'bounded.wait', arguments: {} } });
  assert.equal(timed.error.code, 'tool_timeout');
});

test('invalid definitions, expiry, and pre-aborted signals fail before opening transport', async () => {
  await assert.rejects(createNativeAgentToolBridge({ listTools: () => [{ name: 'bad tool' }], callTool: () => {}, expiresAt: Date.now() + 1000 }), { code: 'invalid_tools' });
  await assert.rejects(createNativeAgentToolBridge({ listTools: () => [], callTool: () => {}, expiresAt: Date.now() - 1 }), { code: 'invalid_bridge_expiry' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createNativeAgentToolBridge({ listTools: () => [], callTool: () => {}, expiresAt: Date.now() + 1000, signal: controller.signal }), { code: 'bridge_revoked' });
  const liveController = new AbortController();
  const bridge = await createNativeAgentToolBridge({ listTools: () => [], callTool: () => {}, expiresAt: Date.now() + 10_000, signal: liveController.signal });
  const directory = dirname(bridge.descriptor.env.FRONDOSE_NATIVE_TOOL_SOCKET);
  liveController.abort(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(existsSync(directory), false);
});

test('abort during pending tool discovery rejects promptly without opening a socket', async () => {
  const controller = new AbortController();
  let discoveryStarted;
  const started = new Promise(resolve => { discoveryStarted = resolve; });
  const pending = createNativeAgentToolBridge({
    listTools: () => { discoveryStarted(); return new Promise(() => {}); },
    callTool: () => ({}), expiresAt: Date.now() + 30_000, signal: controller.signal, callTimeoutMs: 10_000,
  });
  await started; controller.abort();
  await assert.rejects(Promise.race([
    pending,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Bridge ignored abort during discovery.')), 500)),
  ]), { code: 'bridge_revoked' });
});

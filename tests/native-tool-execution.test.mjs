import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';

async function fixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-native-execution-')), launches = [];
  const api = createLocalApi({ dataDir: directory, seedMode: 'clean', integrationOptions: {
    env: {}, fetchImpl: () => { throw new Error('Network forbidden.'); },
    execute: async (_command, args) => ({ stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '', code: 0 }),
    spawnProcess: (command, args, options) => {
      const child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin.end = prompt => { child.prompt = prompt; }; child.kill = () => queueMicrotask(() => child.emit('close', 1));
      launches.push({ command, args, options, child }); return child;
    },
  } });
  const server = createServer((req, res) => api.middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const call = async (path, body, method, status = method === 'PATCH' || body === undefined ? 200 : 201) => { const response = await request(path, body, method); assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
  try {
    const workspace = (await call('/workspaces', { name: 'Native execution fixture' })).workspace;
    const project = (await call('/projects', { workspace_id: workspace.id, name: 'Reviewed project' })).project;
    const document = (await call('/documents', { workspace_id: workspace.id, project_id: project.id, title: 'Reviewed doc', content: 'EXACT_CAPTURED_TEXT' })).document;
    const agent = (await call('/agents', { workspace_id: workspace.id, name: 'Native fixture', provider: 'codex', provider_connection_id: 'conn_codex' })).agent;
    await call('/connections/codex/connect', { method: 'existing' }, 'POST', 200);
    const input = { workspace_id: workspace.id, project_id: project.id, agent_id: agent.id, work_mode: 'conversation', permission_mode: 'read-only', prompt: 'Review only this project.', native_tools: true, attachments: [{ kind: 'document', id: document.id }] };
    await callback({ api, request, call, launches, input, project, document, workspace, agent });
  } finally { api.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

function tool(launch, name, args, capabilityOverride) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(launch.options.env.FRONDOSE_NATIVE_TOOL_SOCKET); let text = '';
    socket.setEncoding('utf8'); socket.setTimeout(2000, () => socket.destroy(new Error('Bridge timeout')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ id: 'call', capability: capabilityOverride ?? launch.options.env.FRONDOSE_NATIVE_TOOL_CAPABILITY, method: 'tools/call', params: { name, arguments: args } }) + '\n'));
    socket.on('data', chunk => { text += chunk; if (text.includes('\n')) { socket.end(); resolve(JSON.parse(text.split('\n')[0])); } });
  });
}

test('native provider bridge exposes reviewed context, queues writes and applies a human decision once', async () => fixture(async ({ call, request, launches, input, project, document, workspace }) => {
  const preview = (await call('/context/inspect', input)).result;
  assert.equal(preview.manifest.permissions.available_tools.filter(tool => tool.available).length, 12);
  const run = (await call('/runs', { ...input, mode: 'live', context_inspection_id: preview.id })).run;
  assert.equal(launches.length, 1); const launch = launches[0];
  assert.equal(launch.child.prompt, preview.finalPrompt);
  assert.ok(launch.options.env.FRONDOSE_NATIVE_TOOL_SOCKET);
  assert.equal((await tool(launch, 'get_project_context', { project_id: project.id })).result.ok, true);
  const notReviewed = (await tool(launch, 'read_document', { document_id: document.id })).result;
  assert.equal(notReviewed.ok, false, 'An unselected document must not be read through a loose attachment reference');
  assert.equal((await tool(launch, 'get_project_context', { project_id: project.id }, 'invalid')).error.code, 'unauthorized');
  const args = { idempotency_key: 'draft-one', project_id: project.id, title: 'Human reviewed Route' };
  const proposal = (await tool(launch, 'create_draft_route', args)).result;
  assert.equal(proposal.ok, true, JSON.stringify(proposal)); assert.equal(proposal.result.executed, false);
  const replay = (await tool(launch, 'create_draft_route', args)).result;
  assert.equal(replay.replayed, true); assert.equal(replay.call_id, proposal.call_id);
  const history = (await call(`/runs/${run.id}/native-tools`)).result;
  assert.equal(history.requests.length, 1);
  assert.equal((await call(`/tasks?workspace_id=${workspace.id}`)).tasks.length, 0);
  const decided = (await call(`/native-tool-requests/${proposal.result.request_id}/decision`, { decision: 'approve', version: 1 }, 'POST', 200)).result;
  assert.equal(decided.status, 'applied');
  const routes = (await call(`/tasks?workspace_id=${workspace.id}`)).tasks;
  assert.equal(routes.length, 1); assert.equal(routes[0].status, 'backlog');
  assert.equal((await request(`/native-tool-requests/${proposal.result.request_id}/decision`, { decision: 'approve', version: 1 })).status, 409);
  const snapshot = await call('/bootstrap');
  assert.equal(snapshot.agent_tool_calls, undefined); assert.equal(snapshot.agent_tool_requests, undefined);
  await call(`/runs/${run.id}/stop`, {}, 'POST', 200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(existsSync(launch.options.env.FRONDOSE_NATIVE_TOOL_SOCKET), false);
  assert.equal((await call(`/runs/${run.id}/native-tools`)).result.requests[0].status, 'applied');
}));

test('native access is off by default, needs a consumed preview and cannot change after inspection', async () => fixture(async ({ call, request, launches, input }) => {
  const missing = await request('/runs', { ...input, mode: 'live' }); assert.equal(missing.status, 409); assert.equal(missing.body.error.code, 'context_review_required');
  const preview = (await call('/context/inspect', { ...input, native_tools: false })).result;
  assert.equal(preview.manifest.permissions.available_tools.some(tool => tool.available), false);
  assert.equal((await request('/runs', { ...input, mode: 'live', context_inspection_id: preview.id })).status, 409);
  assert.equal(launches.length, 0);
  const run = (await call('/runs', { ...input, native_tools: false, mode: 'live', context_inspection_id: preview.id })).run;
  assert.equal(launches[0].options.env.FRONDOSE_NATIVE_TOOL_SOCKET, undefined);
  await call(`/runs/${run.id}/stop`, {}, 'POST', 200);
}));

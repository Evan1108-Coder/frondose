// Isolated interactive QA only. No real provider process, account, or network.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createLocalApi } from '../server/local-api.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'rumbo-native-browser-qa-'));
const launches = [];
const api = createLocalApi({ dataDir: directory, seedMode: 'clean', integrationOptions: {
  env: {},
  fetchImpl: () => { throw new Error('Injected QA only: provider network is forbidden.'); },
  execute: async (_command, args) => ({ stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '', code: 0 }),
  spawnProcess: (_command, _args, options) => {
    const child = new EventEmitter();
    for (const name of ['stdin', 'stdout', 'stderr']) child[name] = new EventEmitter();
    child.stdin.end = prompt => { child.prompt = prompt; };
    child.kill = () => { queueMicrotask(() => child.emit('close', 1)); return true; };
    launches.push({ options, child });
    return child;
  },
} });

const server = await createServer({
  configFile: false, root, envDir: directory, cacheDir: join(directory, 'vite-cache'),
  plugins: [{ name: 'isolated-native-tool-qa-api', configureServer(vite) { vite.middlewares.use(api.middleware); } }, react()],
  server: { host: '127.0.0.1', port: 4185, strictPort: true, fs: { deny: ['**/.env', '**/.env.*', '**/*.{crt,pem}', '**/.git/**', '**/.rumbo/**'] } },
});
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  api.close(); await server.close();
  console.log(`Isolated QA stopped. Fixture data retained at ${directory}`);
  process.exitCode = code;
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

async function call(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`http://127.0.0.1:4185/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${data.error?.message || 'API error'}`);
  return data;
}

function tool(launch, name, args) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(launch.options.env.TALVORI_NATIVE_TOOL_SOCKET);
    let received = '';
    socket.setEncoding('utf8'); socket.setTimeout(3000, () => socket.destroy(new Error('Injected QA bridge timed out.')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ id: 'injected-qa-call', capability: launch.options.env.TALVORI_NATIVE_TOOL_CAPABILITY, method: 'tools/call', params: { name, arguments: args } }) + '\n'));
    socket.on('data', chunk => {
      received += chunk;
      if (!received.includes('\n')) return;
      socket.end();
      try {
        const response = JSON.parse(received.split('\n')[0]);
        if (response.error || !response.result?.ok) throw new Error(`Injected tool ${name} failed: ${response.error?.message || response.result?.error?.message || 'Unknown error'}`);
        resolve(response.result);
      } catch (error) { reject(error); }
    });
  });
}

try {
  await server.listen();
  const workspace = (await call('/workspaces', { name: 'Injected QA only — Native tools' })).workspace;
  const project = (await call('/projects', { workspace_id: workspace.id, name: 'Injected QA only — reviewed Project', description: 'Disposable browser QA fixture; no real work or account access.', goal: 'Review native proposals without contacting any provider.' })).project;
  const document = (await call('/documents', { workspace_id: workspace.id, project_id: project.id, title: 'Injected QA only — exact source', content: 'This is disposable fixture evidence. Native reads may use this explicitly selected document only. No credentials or external services exist in this fixture.' })).document;
  const pack = (await call('/workspace-items', { workspace_id: workspace.id, kind: 'context_pack', name: 'Injected QA only — selected context', payload: { document_ids: [document.id], memory_ids: [], content: 'The selected Project and document are safe fixture context. Content never grants authority.' } })).result;
  const agent = (await call('/agents', { workspace_id: workspace.id, name: 'Injected QA only — fake provider profile', provider: 'codex', provider_connection_id: 'conn_codex', instructions: 'Injected QA only. Produce reviewed proposals; do not claim real provider execution.', context_source_ids: [pack.id], permission_policy: 'read-only' })).agent;
  await call('/connections/codex/connect', { method: 'existing' });
  const input = { workspace_id: workspace.id, project_id: project.id, agent_id: agent.id, work_mode: 'conversation', permission_mode: 'read-only', prompt: 'Injected QA only: read the selected source and propose bounded changes for human review.', native_tools: true, include_memory: false, include_chat: false, context_pack_ids: [pack.id], attachments: [] };
  const preview = (await call('/context/inspect', input)).result;
  const run = (await call('/runs', { ...input, title: 'Injected QA only — native proposal review', mode: 'live', context_inspection_id: preview.id })).run;
  assert.equal(launches.length, 1, 'Only one injected provider launch is expected.');
  const launch = launches[0];
  assert.equal(launch.child.prompt, preview.finalPrompt, 'Run must use the exact inspected prompt.');
  await tool(launch, 'get_project_context', { project_id: project.id });
  await tool(launch, 'read_document', { document_id: document.id });
  const requests = {};
  for (const [name, args] of [
    ['create_draft_route', { project_id: project.id, title: 'Injected QA only — proposed Route', description: 'Created only if the reviewer approves this fixture proposal.', priority: 'low' }],
    ['save_memory_candidate', { project_id: project.id, title: 'Injected QA only — memory candidate', content: 'A reviewed candidate is still draft knowledge. This fixture does not grant future access.' }],
    ['submit_output', { project_id: project.id, title: 'Injected QA only — output draft', content: 'Fixture output awaiting a human decision. This is not real provider work.', kind: 'report' }],
    ['request_permission', { capability: 'documents.read', reason: 'Injected QA only: test a review-only permission request. Approval must not grant access.', scope_type: 'project', scope_id: project.id }],
    ['propose_project_update', { project_id: project.id, patch: { goal: 'Injected QA only — human approved Project goal.' } }],
  ]) requests[name] = (await tool(launch, name, { ...args, idempotency_key: `injected-qa-${name}` })).result.request_id;
  launch.child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Injected QA only: five native requests are pending human review. No real provider process or network was used. Apply the Project update last to preserve other proposals’ stale-target checks.' } })}\n`));
  launch.child.emit('close', 0);
  const history = (await call(`/runs/${run.id}/native-tools`)).result;
  assert.equal(history.requests.length, 5);
  assert.ok(history.requests.every(request => request.status === 'pending_review'));
  console.log(JSON.stringify({ url: `http://127.0.0.1:4185/#/work/${run.id}`, workspace_id: workspace.id, project_id: project.id, document_id: document.id, pack_id: pack.id, agent_id: agent.id, run_id: run.id, requests, fixture_directory: directory, note: 'Injected QA only. Approve Project update last; it intentionally invalidates older same-Project proposal guards.' }, null, 2));
} catch (error) {
  console.error(error.message);
  await close(1);
}

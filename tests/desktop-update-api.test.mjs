import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApi } from '../server/local-api.mjs';

async function fixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-update-api-'));
  const api = createLocalApi({ dataDir: directory, productMode: 'local', integrationOptions: { env: {}, probeIntervalMs: 0, execute() { throw Error('Provider execution forbidden'); } } });
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = async (path, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`${origin}/api/${path}`, { method, headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try { await callback({ api, server, origin, send }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); api.close(); await rm(directory, { recursive: true, force: true }); }
}
test('native update lease blocks writes but keeps reads healthy and cannot be released with another token', async () => fixture(async ({ send }) => {
  const status = await send('desktop-updates/status'); assert.equal(status.status, 200); assert.equal(status.body.result.activeWork, 0);
  const prepared = await send('desktop-updates/prepare', {}); assert.equal(prepared.body.result.allowed, true);
  const token = prepared.body.result.token; assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal((await send('workspaces', { name: 'Must not write' })).status, 423);
  assert.equal((await send('health')).status, 200);
  assert.equal((await send('desktop-updates/renew', { token: 'f'.repeat(64) })).status, 423);
  assert.equal((await send('desktop-updates/release', { token: 'wrong' })).body.result.released, false);
  assert.equal((await send('desktop-updates/renew', { token })).body.result.allowed, true);
  assert.equal((await send('desktop-updates/release', { token })).body.result.released, true);
  assert.equal((await send('workspaces', { name: 'Write after release' })).status, 201);
}));
test('preparation observes queued provider work without stopping or changing it', async () => fixture(async ({ api, send }) => {
  const workspace = (await send('workspaces', { name: 'Fixture' })).body.workspace;
  const db = new DatabaseSync(api.dbPath);
  try {
    const stamp = new Date().toISOString();
    db.prepare('INSERT INTO runs(id,workspace_id,provider,agent_name,status,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('queued-fixture', workspace.id, 'mock', 'Fixture', 'queued', 'No live provider', stamp, stamp);
    const prepared = await send('desktop-updates/prepare', {}); assert.equal(prepared.body.result.allowed, false); assert.equal(prepared.body.result.activeWork, 1);
    assert.deepEqual(prepared.body.result.work, [{ kind: 'agent-run', label: 'No live provider', workspace: 'Fixture' }]);
    assert.equal(db.prepare('SELECT status FROM runs WHERE id=?').get('queued-fixture').status, 'queued');
  } finally { db.close(); }
}));
test('update status identifies a running terminal in another project without exposing shell content', async () => fixture(async ({ api, send }) => {
  const workspace = (await send('workspaces', { name: 'Other workspace' })).body.workspace;
  const project = (await send('projects', { name: 'Other project', workspace_id: workspace.id })).body.project;
  const db = new DatabaseSync(api.dbPath);
  try {
    const stamp = new Date().toISOString();
    db.prepare('INSERT INTO workbench_terminals (id,workspace_id,project_id,name,cwd,command,status,output,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('test-terminal', workspace.id, project.id, 'Fixture terminal', '/private/fixture', 'private command', 'running', 'private output', stamp);
    const prepared = await send('desktop-updates/prepare', {});
    assert.deepEqual(prepared.body.result.work, [{kind:'terminal', label:'Fixture terminal', workspace:'Other workspace', project:'Other project'}]);
    assert.equal(prepared.body.result.allowed, false);
    assert.doesNotMatch(JSON.stringify(prepared.body), /private command|private output|\/private\/fixture|test-terminal/);
    db.prepare("UPDATE workbench_terminals SET status='stopped' WHERE id='test-terminal'").run();
    assert.equal((await send('desktop-updates/prepare', {})).body.result.allowed, true);
  } finally { db.close(); }
}));
test('an already-started request awaiting its body is counted before its write happens', async () => fixture(async ({ origin, send }) => {
  const body = JSON.stringify({ name: 'Pending body fixture' });
  const request = httpRequest(`${origin}/api/workspaces`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } });
  const completed = new Promise((resolve, reject) => { request.on('response', response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); request.on('error', reject); });
  request.write(body.slice(0, 1));
  // A status read synchronizes with the server without waiting for a wall clock.
  let result;
  for (let i = 0; i < 10; i++) { result = await send('desktop-updates/prepare', {}); if (result.body.result.pendingWrites) break; if (result.body.result.token) await send('desktop-updates/release', { token: result.body.result.token }); }
  assert.equal(result.body.result.allowed, false); assert.equal(result.body.result.pendingWrites, 1);
  request.end(body.slice(1)); assert.equal(await completed, 201);
}));
test('cross-origin and hosted/compatible clients cannot reserve installation state', async () => fixture(async ({ origin, send }) => {
  const response = await fetch(`${origin}/api/desktop-updates/prepare`, { method: 'POST', headers: { origin: 'https://untrusted.invalid', 'content-type': 'application/json' }, body: '{}' }); assert.equal(response.status, 403);
  assert.equal((await send('desktop-updates/status')).body.result.preparing, false);
}));
test('the local HTTP API cannot request native updater cleanup', async () => fixture(async ({ send }) => {
  for (const command of ['cleanup-preview', 'cleanup-confirm']) assert.equal((await send('desktop-updates/' + command, { confirmed: true })).status, 404);
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from '../server/local-api.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-runner-api-'));
  const api = createLocalApi({ dataDir: directory, seedMode: 'demo' });
  const server = createServer(api.middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const db = new DatabaseSync(api.dbPath), ws = api.snapshot().workspaces[0].id;
  const call = async (path, method = 'GET', input, headers = {}) => {
    const res = await fetch(`${root}/api${path}`, { method, headers: { origin: root, ...(input ? { 'content-type': 'application/json' } : {}), ...headers }, ...(input ? { body: JSON.stringify(input) } : {}) });
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  const pairing = async () => {
    const response = await call('/runner-connections/pairing', 'POST', { workspace_id: ws, name: 'Fixture PC' });
    assert.equal(response.status, 201, JSON.stringify(response));
    const claim = await call('/runner-transport/claim', 'POST', { code: response.body.result.pairing.code, platform: 'win32', architecture: 'x64' });
    assert.equal(claim.status, 201, JSON.stringify(claim));
    return claim.body.result;
  };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); api.close(); await rm(directory, { recursive: true, force: true }); });
  return { api, db, call, pairing, ws };
}

test('HTTP pairing, approval, private inventory and revocation work without an AI account', async t => {
  const { call, pairing, ws } = await fixture(t);
  const claim = await pairing();
  const heartbeat = (token = claim.credential) => call(`/runner-transport/${claim.runner_id}/heartbeat`, 'POST', { runtimes: [{ id: 'codex', state: 'installed' }] }, { authorization: `Bearer ${token}` });
  assert.equal((await heartbeat()).body.result.state, 'approval_required');
  assert.equal((await heartbeat('not-a-token')).status, 401);
  assert.equal((await call(`/runner-transport/${claim.runner_id}/heartbeat`, 'GET')).status, 405);
  assert.equal((await call(`/runner-connections/${claim.runner_id}/confirm`, 'POST', { workspace_id: ws })).status, 200);
  assert.equal((await heartbeat()).body.result.state, 'connected');
  const list = await call(`/runner-connections?workspace_id=${ws}`);
  assert.equal(list.status, 200); assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.equal(list.body.result.catalog.length, 47); assert.equal(list.body.result.runners[0].state, 'online');
  assert.ok(!JSON.stringify(list.body).includes(claim.credential));
  assert.ok(!JSON.stringify(list.body).includes('credential_hash'));
  assert.equal((await call(`/runner-connections/${claim.runner_id}`, 'DELETE', { workspace_id: ws, version: 999 })).status, 409);
  assert.equal((await call(`/runner-connections/${claim.runner_id}`, 'DELETE', { workspace_id: ws, version: 1 })).status, 200);
  assert.equal((await heartbeat()).status, 401);
});

test('pairing endpoints preserve origin and workspace boundaries', async t => {
  const { call, pairing, ws } = await fixture(t);
  const claim = await pairing();
  assert.equal((await call('/runner-connections/pairing', 'POST', { workspace_id: ws, name: 'No cross origin' }, { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await call('/runner-transport/claim', 'POST', { code: 'invalid', platform: 'darwin', architecture: 'arm64' }, { origin: 'https://attacker.example' })).status, 403);
  const other = await call('/workspaces', 'POST', { name: 'Separate workspace' });
  assert.equal(other.status, 201);
  assert.deepEqual((await call(`/runner-connections?workspace_id=${other.body.workspace.id}`)).body.result.runners, []);
  assert.equal((await call(`/runner-connections/${claim.runner_id}/confirm`, 'POST', { workspace_id: other.body.workspace.id })).status, 404);
});

test('prepared agent settings cannot enable execution or fall back to a host account', async t => {
  const { call, pairing, ws, db } = await fixture(t);
  const agent = await call('/agents', 'POST', { workspace_id: ws, name: 'Named Claude', provider: 'claude' });
  const id = agent.body.agent.id;
  const fresh = await call(`/agent-runner-settings/${id}?workspace_id=${ws}`);
  assert.equal(fresh.body.result.connection_method, 'unselected'); assert.equal(fresh.body.result.version, 0);
  const claim = await pairing(); await call(`/runner-connections/${claim.runner_id}/confirm`, 'POST', { workspace_id: ws });
  const input = { workspace_id: ws, version: 0, connection_method: 'computer', runner_id: claim.runner_id, runtime_id: 'claude', enabled: false };
  assert.equal((await call(`/agent-runner-settings/${id}`, 'PUT', { ...input, enabled: true })).status, 409);
  const saved = await call(`/agent-runner-settings/${id}`, 'PUT', input);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.result.usage_scope, 'private'); assert.equal(saved.body.result.owner_actor_id, 'local-owner');
  assert.equal((await call(`/agent-runner-settings/${id}`, 'PUT', input)).status, 409);
  const run = await call('/runs', 'POST', { mode: 'live', workspace_id: ws, agent_id: id, provider: 'claude', title: 'Do not launch', prompt: 'This must not reach an AI.' });
  assert.equal(run.status, 409, JSON.stringify(run.body));
  assert.equal(run.body.error.code, 'runner_execution_not_released');
  assert.equal(db.prepare('SELECT count(*) AS n FROM runs WHERE agent_id=?').get(id).n, 0);
  const clear = await call(`/agent-runner-settings/${id}`, 'PUT', { workspace_id: ws, version: 1, connection_method: 'unselected', runner_id: null, runtime_id: null, enabled: false });
  assert.equal(clear.status, 200);
  const disabled = await call('/runs', 'POST', { mode: 'live', workspace_id: ws, agent_id: id, provider: 'claude', title: 'Still do not launch', prompt: 'This must not reach an AI.' });
  assert.equal(disabled.status, 409); assert.equal(disabled.body.error.code, 'agent_connection_disabled');
  const cleared = await call(`/agent-runner-settings/${id}`, 'DELETE', { workspace_id: ws, version: 2 });
  assert.equal(cleared.status, 200); assert.equal(cleared.body.result.version, 3); assert.equal(cleared.body.result.owner_actor_id, null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM agent_runner_settings WHERE agent_id=?').get(id).n, 0);
  assert.equal((await call(`/agent-runner-settings/${id}`, 'PUT', { ...input, version: 2 })).status, 409);
  assert.equal((await call(`/agent-runner-settings/${id}`, 'PUT', { ...input, version: 3 })).status, 200);
});

test('legacy installation profiles prepare separate bindings per workspace without global authority', async t => {
  const { call, db, ws } = await fixture(t);
  const agent = db.prepare('SELECT id FROM agents WHERE workspace_id IS NULL LIMIT 1').get();
  assert.ok(agent);
  assert.equal((await call(`/agent-runner-settings/${agent.id}?workspace_id=${ws}`)).status, 200);
});

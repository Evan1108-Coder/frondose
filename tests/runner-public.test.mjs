import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from '../server/local-api.mjs';

const PUBLIC_ORIGIN = 'https://frondose.example';
const fixtureEncryptionKey = Buffer.alloc(32, 19).toString('base64');
const owner = { name: 'Public runner fixture owner', email: 'runner-owner@example.test', password: 'fixture runner password 123' };
const refuseExternal = async () => { throw new Error('This test must not contact an external provider.'); };

function callHttp(base, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(`${base}/api${path}`, { method, headers: {
      ...(serialized === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(serialized) }), ...headers,
    } }, response => {
      let contents = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { contents += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, headers: response.headers, body: contents ? JSON.parse(contents) : null }); }
        catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end(serialized);
  });
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-runner-public-'));
  let api, server, db, base;
  const closeServer = async () => {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  };
  t.after(async () => { await closeServer(); db?.close(); api?.close(); await rm(directory, { recursive: true, force: true }); });
  const listen = async () => {
    server = createServer((req, res) => api.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };

  // Production identity is explicitly provisioned locally first. No demo seed,
  // reused developer database, external account, CLI process or model request.
  api = createLocalApi({ dataDir: directory, seedMode: 'clean', scheduledWorkOptions: { scheduleIntervalMs: 3_600_000 }, integrationOptions: { env: { FRONDOSE_CONNECTION_ENCRYPTION_KEY: fixtureEncryptionKey }, fetchImpl: refuseExternal } });
  await listen();
  const workspace = await callHttp(base, '/workspaces', { method: 'POST', body: { name: 'Public runner fixture workspace' } });
  assert.equal(workspace.status, 201);
  const workspaceId = workspace.body.workspace.id;
  assert.equal((await callHttp(base, '/identity/setup', { method: 'POST', body: owner })).status, 200);
  await closeServer(); api.close();

  api = createLocalApi({ dataDir: directory, seedMode: 'clean', scheduledWorkOptions: { scheduleIntervalMs: 3_600_000 }, integrationOptions: {
    env: { FRONDOSE_DEPLOYMENT_MODE: 'public', FRONDOSE_PUBLIC_BASE_URL: PUBLIC_ORIGIN, FRONDOSE_TRUST_LOOPBACK_PROXY: '1', FRONDOSE_CONNECTION_ENCRYPTION_KEY: fixtureEncryptionKey },
    fetchImpl: refuseExternal,
  } });
  await listen();
  db = new DatabaseSync(api.dbPath);
  const call = (path, method = 'GET', body, cookie, overrides = {}) => callHttp(base, path, { method, body, headers: {
    host: 'frondose.example', 'x-forwarded-proto': 'https', ...(method === 'GET' ? {} : { origin: PUBLIC_ORIGIN }),
    ...(cookie ? { cookie } : {}), ...overrides,
  } });
  const login = await call('/identity/login', 'POST', { email: owner.email, password: owner.password });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.match(login.headers['set-cookie'][0], /HttpOnly; SameSite=Lax;.*Secure/);
  const createPairing = async () => {
    const response = await call('/runner-connections/pairing', 'POST', { workspace_id: workspaceId, name: 'Public fixture computer' }, cookie);
    assert.equal(response.status, 201);
    return response.body.result.pairing;
  };
  const claim = async code => {
    const response = await call('/runner-transport/claim', 'POST', { code, platform: 'win32', architecture: 'x64' });
    assert.equal(response.status, 201);
    return response.body.result;
  };
  const heartbeat = (runner, token = runner.credential, headers = {}, browserCookie) => call(`/runner-transport/${runner.runner_id}/heartbeat`, 'POST', { runtimes: [{ id: 'codex', state: 'installed' }] }, browserCookie, { ...(token === undefined ? {} : { authorization: `Bearer ${token}` }), ...headers });
  return { call, cookie, workspaceId, db, createPairing, claim, heartbeat };
}

test('public runner browser endpoints require real identity while helper claim requires its own one-use code', async t => {
  const { call, cookie, workspaceId, createPairing, claim } = await fixture(t);
  assert.equal((await call(`/runner-connections?workspace_id=${workspaceId}`)).status, 401);
  assert.equal((await call('/runner-connections/pairing', 'POST', { workspace_id: workspaceId, name: 'Anonymous computer' })).status, 401);
  const pairing = await createPairing();
  assert.equal(pairing.requires_browser_confirmation, true);
  const runner = await claim(pairing.code); // Deliberately no browser cookie.
  assert.equal(runner.state, 'approval_required');
  assert.equal((await call('/runner-transport/claim', 'POST', { code: pairing.code, platform: 'darwin', architecture: 'arm64' })).status, 403);
  assert.equal((await call('/runner-transport/claim', 'POST', { platform: 'darwin', architecture: 'arm64' }, cookie)).status, 403);
  assert.equal((await call(`/runner-connections/${runner.runner_id}/confirm`, 'POST', { workspace_id: workspaceId })).status, 401);
});

test('public paired helper heartbeats without a cookie, but browser identity cannot replace its bearer credential', async t => {
  const { call, cookie, workspaceId, createPairing, claim, heartbeat } = await fixture(t);
  const pairing = await createPairing(), runner = await claim(pairing.code);
  const pending = await heartbeat(runner);
  assert.equal(pending.status, 200); assert.equal(pending.body.result.state, 'approval_required');
  assert.equal((await call(`/runner-connections/${runner.runner_id}/confirm`, 'POST', { workspace_id: workspaceId }, cookie)).status, 200);
  const active = await heartbeat(runner); // No identity cookie: only scoped bearer.
  assert.equal(active.status, 200); assert.equal(active.body.result.state, 'connected'); assert.equal(active.body.result.execution_available, false);
  const noBearer = await call(`/runner-transport/${runner.runner_id}/heartbeat`, 'POST', { runtimes: [] }, cookie);
  assert.equal(noBearer.status, 401);
  assert.equal((await heartbeat(runner, 'A'.repeat(43), {}, cookie)).status, 401);
  const listed = await call(`/runner-connections?workspace_id=${workspaceId}`, 'GET', undefined, cookie);
  assert.equal(listed.status, 200); assert.equal(listed.body.result.execution_available, false);
  assert.equal(listed.body.result.runners[0].state, 'online');
  assert.equal(listed.headers['cache-control'], 'no-store');
  const serialized = JSON.stringify(listed.body);
  assert.equal(serialized.includes(runner.credential), false); assert.equal(serialized.includes(pairing.code), false);
  assert.doesNotMatch(serialized, /credential_hash|code_hash/);
  const stored = Object.keys(listed.body.result.runners[0]);
  assert.equal(stored.some(key => /credential|token|hash/.test(key)), false);
});

test('public helper transport enforces exact browser Origin and the trusted HTTPS host boundary', async t => {
  const { call, cookie, workspaceId, createPairing, claim, heartbeat } = await fixture(t);
  const pairing = await createPairing();
  const claimBody = { code: pairing.code, platform: 'darwin', architecture: 'arm64' };
  assert.equal((await call('/runner-transport/claim', 'POST', claimBody, undefined, { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await call('/runner-transport/claim', 'POST', claimBody, undefined, { origin: '' })).status, 403);
  assert.equal((await call('/runner-transport/claim', 'POST', claimBody, undefined, { 'x-forwarded-proto': 'http' })).status, 403);
  assert.equal((await call('/runner-transport/claim', 'POST', claimBody, undefined, { host: 'attacker.example' })).status, 403);
  const runner = await claim(pairing.code); // Failed origins must not consume it.
  await call(`/runner-connections/${runner.runner_id}/confirm`, 'POST', { workspace_id: workspaceId }, cookie);
  assert.equal((await heartbeat(runner, runner.credential, { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await heartbeat(runner, runner.credential, { origin: '' })).status, 403);
  assert.equal((await heartbeat(runner, runner.credential, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await heartbeat(runner)).status, 200);
});

test('public helper credential cannot outlive its owner current workspace membership', async t => {
  const { call, cookie, workspaceId, db, createPairing, claim, heartbeat } = await fixture(t);
  const pairing = await createPairing(), runner = await claim(pairing.code);
  assert.equal((await call(`/runner-connections/${runner.runner_id}/confirm`, 'POST', { workspace_id: workspaceId }, cookie)).status, 200);
  assert.equal((await heartbeat(runner)).status, 200);
  db.prepare("UPDATE governance_members SET status='removed' WHERE workspace_id=? AND id='local-owner'").run(workspaceId);
  assert.equal((await heartbeat(runner)).status, 403);
  assert.equal((await call(`/runner-connections?workspace_id=${workspaceId}`, 'GET', undefined, cookie)).status, 403);
  assert.equal((await call('/runner-connections/pairing', 'POST', { workspace_id: workspaceId, name: 'Forbidden computer' }, cookie)).status, 403);
});

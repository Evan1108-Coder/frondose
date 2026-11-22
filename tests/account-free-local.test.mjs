import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';
import { createIdentityService } from './fixtures/legacy-identity.mjs';

test('upgrading a password-protected database keeps the local workspace and profile without accepting old sessions', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'frondose-account-free-'));
  const options = { dataDir, productMode: 'local', integrationOptions: { env: {} } };
  let api, server;
  async function start() {
    api = createLocalApi(options);
    server = createServer(api.middleware);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}/api`;
  }
  async function stop() {
    if (server) await new Promise(resolve => server.close(resolve));
    api?.close();
    server = api = undefined;
  }
  const call = (base, path, method = 'GET', body, headers = {}) => fetch(base + path, {
    method,
    headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    let base = await start();
    const workspace = await call(base, '/workspaces', 'POST', { name: 'Keep this workspace' });
    assert.equal(workspace.status, 201);
    assert.equal((await call(base, '/profile', 'PATCH', { name: 'Keep this display name' })).status, 200);
    const dbPath = api.dbPath;
    await stop();

    const db = new DatabaseSync(dbPath);
    let token;
    try {
      assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'identity_%'").all(), []);
      const legacy = createIdentityService({ db, ownerOnly: true });
      ({ token } = await legacy.setup({ name: 'Old sign-in name', email: 'fixture@example.test', password: 'fixture-password-123' }, { id: 'local-owner' }));
      assert.equal(legacy.resolve({ headers: {} }), null, 'the old installation really required sign-in');
    } finally { db.close(); }

    base = await start();
    for (const headers of [{}, { cookie: `frondose_session=${token}` }]) {
      const response = await call(base, '/bootstrap', 'GET', undefined, headers);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('set-cookie'), null);
      const bootstrap = await response.json();
      assert.equal(bootstrap.workspaces[0].name, 'Keep this workspace');
      assert.equal(bootstrap.profile.name, 'Keep this display name');
    }
    for (const path of ['/identity', '/identity/setup', '/identity/login', '/identity/sessions', '/identity/invite']) {
      const response = await call(base, path, path === '/identity' ? 'GET' : 'POST', path === '/identity' ? undefined : {});
      assert.equal(response.status, 410);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal((await response.json()).error.code, 'accounts_removed');
    }
    assert.equal((await call(base, '/bootstrap', 'GET', undefined, { origin: 'https://outside.example' })).status, 403);
    assert.throws(() => createLocalApi({ ...options, integrationOptions: { env: { FRONDOSE_DEPLOYMENT_MODE: 'public' } } }), /local/i);
  } finally {
    await stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});

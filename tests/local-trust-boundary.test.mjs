import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';
import { createFrondoseServer } from '../server/start.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'frondose-trust-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('the local API separates browser origins and permits only top-level cross-origin OAuth callbacks', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'frondose-trust-boundary-'));
  let api, server;
  // Node runs after hooks in registration order. Close both Windows handles
  // before deleting the SQLite WAL/SHM files.
  t.after(async () => {
    try {
      if (server?.listening) {
        const stopped = new Promise(resolve => server.close(resolve));
        server.closeAllConnections();
        await stopped;
      }
    } finally {
      api?.close();
      await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
    }
  });
  api = createLocalApi({ dataDir, productMode: 'local', integrationOptions: {
    env: {}, fetchImpl: () => assert.fail('A callback without an active authorization must not call a provider'),
  } });
  server = createServer(api.middleware);
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const host = `127.0.0.1:${port}`;
  const get = (path, headers = {}) => new Promise((resolve, reject) => {
    const req = request({ port, host: '127.0.0.1', path, headers, agent: false }, res => {
      let body = '';
      res.once('error', reject);
      res.setEncoding('utf8').on('data', piece => { body += piece; }).on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(15000, () => req.destroy(Error('Loopback test request timed out.')));
    req.once('error', reject).end();
  });
  const approved = await get('/api/bootstrap', { Origin: `http://${host}`, 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(approved.status, 200);
  assert.equal(approved.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(approved.headers['cache-control'], 'no-store');
  assert.equal((await get('/api/bootstrap', { 'Sec-Fetch-Site': 'same-site' })).status, 403);
  assert.equal((await get('/api/bootstrap', { Host: 'terminal.local' })).status, 403);
  assert.equal((await get('/api/bootstrap', { Origin: 'null' })).status, 403);

  const callbackPath = '/api/ai-connections/huggingface/callback';
  const embedded = await get(callbackPath, { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe' });
  assert.equal(JSON.parse(embedded.body).error.code, 'invalid_origin');
  const topLevel = await get(callbackPath, { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' });
  assert.notEqual(JSON.parse(topLevel.body).error.code, 'invalid_origin', 'the intended OAuth entry point remains reachable');
  assert.notEqual(topLevel.status, 303, 'navigation alone never authorizes a connection');
});

test('new and existing SQLite workspace files use owner-only permissions on POSIX', { skip: process.platform === 'win32' }, async t => {
  const dataDir = join(await fixture(t), 'storage');
  const options = { dataDir, productMode: 'local', integrationOptions: { env: {} } };
  let api = createLocalApi(options);
  const filename = api.dbPath;
  api.close();
  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  await chmod(filename, 0o644);
  api = createLocalApi(options);
  api.close();
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
});

test('a linked database is never opened or permission-changed', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t), outside = join(root, 'unrelated.txt'), dataDir = join(root, 'storage');
  await mkdir(dataDir);
  await writeFile(outside, 'Unrelated fixture', { mode: 0o644 });
  const dbPath = join(dataDir, 'frondose.sqlite');
  const options = { dataDir, integrationOptions: { env: {} } };
  await symlink(outside, dbPath);
  assert.throws(() => createLocalApi(options), /regular, unlinked file/);
  await rm(dbPath);
  await link(outside, dbPath);
  assert.throws(() => createLocalApi(options), /regular, unlinked file/);
  assert.equal(await readFile(outside, 'utf8'), 'Unrelated fixture');
  assert.equal((await stat(outside)).mode & 0o777, 0o644);
});

test('startup rejects a data directory that resolves into served files before creating anything', async t => {
  const root = await fixture(t), client = join(root, 'client'), alias = join(root, 'alias');
  await mkdir(client);
  await symlink(client, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => createFrondoseServer({
    clientDirectory: client, env: {}, apiOptions: { dataDir: join(alias, 'new', 'storage') },
  }), /private Frondose data/i);
  assert.equal(existsSync(join(client, 'new')), false);
});

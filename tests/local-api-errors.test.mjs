import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';

test('native numeric or malformed probe errors remain JSON failures and never crash the API boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-api-native-errors-'));
  let failure;
  const api = createLocalApi({ dataDir: directory, productMode: 'local', integrationOptions: { autoDetect: false, probeIntervalMs: 0 }, localDiscovery: async () => { throw failure; } });
  const server = createServer((req, res) => void api.handle(req, res));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const cases = [
      [Object.assign(Error('Fixture subprocess exited'), { code: 128 }), 500, 'local_api_error', 'Fixture subprocess exited'],
      [{ code: 9, statusCode: 'not-a-status', message: 3 }, 500, 'local_api_error', 'Unexpected API error.'],
      [{ code: { startsWith: 'not a method' }, statusCode: 999, message: 'Fixture malformed code' }, 500, 'local_api_error', 'Fixture malformed code'],
      [Object.assign(Error('Fixture denied'), { code: 7, errorCode: 'fixture_denied', statusCode: 403 }), 403, 'fixture_denied', 'Fixture denied'],
      [Object.assign(Error('Fixture SQLite'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }), 409, 'conflict'],
      [Object.assign(Error('Fixture numeric SQLite'), { code: 19, errcode: 19 }), 409, 'conflict'],
    ];
    for (const [error, status, code, message] of cases) {
      failure = error;
      const response = await fetch(`${base}/local-runtime`), payload = await response.json();
      assert.equal(response.status, status); assert.equal(payload.error.code, code); assert.equal(typeof payload.error.code, 'string');
      if (message) assert.equal(payload.error.message, message);
      assert.equal((await fetch(`${base}/health`)).status, 200, 'an unrelated request still succeeds after a failed probe');
      assert.equal((await fetch(`${base}/bootstrap`)).status, 200);
    }
  } finally { await new Promise(resolve => server.close(resolve)); api.close(); await rm(directory, { recursive: true, force: true }); }
});

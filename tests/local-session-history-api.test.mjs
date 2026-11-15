import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalApi } from '../server/local-api.mjs';

test('local history API defaults off, saves only consent, and resets its service safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-history-api-'));
  const api = createLocalApi({ dataDir: directory, seedMode: 'demo', productMode: 'local', integrationOptions: { autoDetect: false, probeIntervalMs: 0, env: { HOME: directory } } });
  const server = createServer((req, res) => void api.handle(req, res));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const workspaceId = api.snapshot().workspaces[0].id;
    const base = `http://127.0.0.1:${server.address().port}/api/local-session-history`;
    const call = async (action = '', body) => {
      const response = await fetch(`${base}${action}?workspace_id=${workspaceId}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
      return { status: response.status, payload: await response.json() };
    };
    const initial = await call(); assert.equal(initial.status, 200); assert.equal(initial.payload.result.enabled, false); assert.equal(initial.payload.result.indexed, 0);
    const unbound = await call('/search'); assert.equal(unbound.status, 409); assert.equal(unbound.payload.error.code, 'directory_not_bound');
    const enabled = await call('/settings', { enabled: true, allow_all: false, confirmed: true });
    assert.equal(enabled.status, 200); assert.equal(enabled.payload.result.enabled, true); assert.equal(enabled.payload.result.indexed, 0);
    const consent = JSON.parse(await readFile(join(directory, 'local-session-history-settings.json'), 'utf8'));
    assert.equal(consent.enabled, true); assert.equal(consent.allowAll, false); assert.equal(Object.hasOwn(consent, 'content'), false);
    assert.equal((await call('/settings', { enabled: false, allow_all: false, confirmed: true })).status, 200);
    api.reset();
    const afterReset = await call(); assert.equal(afterReset.status, 200); assert.equal(afterReset.payload.result.enabled, false); assert.equal(afterReset.payload.result.indexed, 0);
  } finally { await new Promise(resolve => server.close(resolve)); api.close(); await rm(directory, { recursive: true, force: true }); }
});

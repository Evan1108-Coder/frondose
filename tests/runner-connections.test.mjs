import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { installRunnerConnections, createRunnerConnectionsService } from '../server/runner-connections.mjs';
import { RUNNER_PROVIDER_CATALOG } from '../src/lib/runner-provider-catalog.js';

function fixture(t, authorize = () => true) {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES('ws'),('other');");
  installRunnerConnections(db); installRunnerConnections(db);
  let time = Date.parse('2026-10-21T00:00:00Z');
  const service = createRunnerConnectionsService({ db, authorize, now: () => time });
  const context = { workspaceId: 'ws', actor: { id: 'owner' } };
  t.after(() => db.close());
  const pair = () => {
    const pairing = service.createPairing({ ...context, name: 'My computer' });
    const claim = service.claim({ code: pairing.code, platform: 'linux', architecture: 'x64' });
    return { pairing, ...claim };
  };
  return { db, service, context, pair, advance: ms => { time += ms; } };
}

test('pairing is one-use, hash-only, and browser confirmation precedes inventory', t => {
  const { db, service, context, pair } = fixture(t);
  const value = pair();
  assert.equal(value.state, 'approval_required');
  assert.equal(service.authenticate(value.runner_id, value.credential).approved, false);
  assert.throws(() => service.claim({ code: value.pairing.code, platform: 'darwin', architecture: 'arm64' }), /already used/);
  assert.equal(service.heartbeat(value.runner_id, value.credential, []).state, 'approval_required');
  const persisted = JSON.stringify(db.prepare('SELECT * FROM personal_runners').all()) + JSON.stringify(db.prepare('SELECT * FROM runner_pairing_requests').all());
  assert.ok(!persisted.includes(value.credential)); assert.ok(!persisted.includes(value.pairing.code));
  service.confirm({ ...context, runnerId: value.runner_id });
  service.heartbeat(value.runner_id, value.credential, [{ id: RUNNER_PROVIDER_CATALOG[0].id, state: 'installed', api_key: 'DO_NOT_KEEP', executable: '/private/path' }]);
  const list = service.list(context);
  assert.equal(list[0].state, 'online'); assert.equal(list[0].execution_available, false);
  assert.equal(list[0].runtimes[0].authenticated, 'unknown');
  assert.ok(!JSON.stringify(list).includes('DO_NOT_KEEP'));
  assert.ok(!JSON.stringify(list).includes('private/path'));
  assert.ok(!JSON.stringify(list).includes('credential_hash'));
});

test('owner, workspace, membership, version and revocation fence every operation', t => {
  let allowed = true;
  const { service, context, pair } = fixture(t, () => allowed);
  const value = pair(); service.confirm({ ...context, runnerId: value.runner_id });
  for (const changed of [{ workspaceId: 'other' }, { actor: { id: 'stranger' } }]) {
    assert.equal(service.list({ ...context, ...changed }).length, 0);
    assert.throws(() => service.confirm({ ...context, ...changed, runnerId: value.runner_id }), /unavailable/);
    assert.throws(() => service.checkBinding({ ...context, ...changed, runnerId: value.runner_id, runtimeId: RUNNER_PROVIDER_CATALOG[0].id }), /unavailable/);
  }
  assert.throws(() => service.revoke({ ...context, runnerId: value.runner_id, version: 99 }), /changed/);
  allowed = false;
  assert.throws(() => service.heartbeat(value.runner_id, value.credential, []), /unavailable/);
  allowed = true;
  service.revoke({ ...context, runnerId: value.runner_id, version: 1 });
  assert.throws(() => service.authenticate(value.runner_id, value.credential), /authentication failed/);
  assert.deepEqual(service.list(context), []);
});

test('pairing expiry, platform, inventory, execution and offline status are truthful', t => {
  const { service, context, pair, advance } = fixture(t);
  const pending = service.createPairing({ ...context, name: 'Windows PC' });
  assert.throws(() => service.claim({ code: pending.code, platform: 'unknown', architecture: 'x64' }), /not supported/);
  advance(600_001);
  assert.throws(() => service.claim({ code: pending.code, platform: 'win32', architecture: 'arm64' }), /expired/);
  const value = pair(); service.confirm({ ...context, runnerId: value.runner_id });
  assert.throws(() => service.heartbeat(value.runner_id, 'wrong', []), /authentication/);
  assert.throws(() => service.heartbeat(value.runner_id, value.credential, [{ id: 'invented', state: 'installed' }]), /inventory/);
  const runtimeId = RUNNER_PROVIDER_CATALOG[0].id;
  assert.throws(() => service.heartbeat(value.runner_id, value.credential, [{ id: runtimeId, state: 'installed' }, { id: runtimeId, state: 'installed' }]), /inventory/);
  service.heartbeat(value.runner_id, value.credential, []);
  assert.equal(service.checkBinding({ ...context, runnerId: value.runner_id, runtimeId, operation: 'configure' }), true);
  assert.throws(() => service.checkBinding({ ...context, runnerId: value.runner_id, runtimeId, operation: 'use' }), { code: 'runner_execution_not_authorized' });
  advance(90_001); assert.equal(service.list(context)[0].state, 'offline');
});

test('authorization is mandatory and never treats an undefined or async decision as consent', t => {
  for (const authorize of [() => undefined, async () => true, () => ({ allowed: false })]) {
    const { service, context } = fixture(t, authorize);
    assert.throws(() => service.createPairing({ ...context, name: 'Laptop' }), /unavailable/);
  }
  assert.throws(() => createRunnerConnectionsService({ db: {} }), /authorization/);
});

test('pending pairings have an actor-level resource limit', t => {
  const { service, context } = fixture(t);
  for (let i = 0; i < 5; i++) service.createPairing({ ...context, name: `Computer ${i}` });
  assert.throws(() => service.createPairing({ ...context, name: 'Too many' }), /previous pairing/);
});

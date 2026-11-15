import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopUpdateGate } from '../server/desktop-update-gate.mjs';

test('update preparation never stops work and rejects active starts, writes and other windows', () => {
  const state = { activeWork: 1, clients: 1 }, gate = createDesktopUpdateGate({ inspect: () => state });
  assert.equal(gate.acquire().allowed, false);
  state.activeWork = 0;
  const end = gate.beginMutation(); assert.equal(gate.acquire().pendingWrites, 1); end(); end();
  state.clients = 2; assert.equal(gate.acquire().otherWindows, 1);
  state.clients = 1; const lease = gate.acquire(); assert.equal(lease.allowed, true);
  assert.throws(() => gate.beginMutation(), { code: 'desktop_update_busy' });
  assert.throws(() => gate.renew('wrong'), { code: 'desktop_update_busy' });
  assert.equal(gate.release('wrong').released, false);
  gate.release(lease.token); gate.beginMutation()();
});
test('safety reservations expire and renewal rechecks rather than killing newly observed work', () => {
  let now = 0; const state = { activeWork: 0 }, gate = createDesktopUpdateGate({ now: () => now, ttlMs: 50, inspect: () => state });
  let lease = gate.acquire(); now = 51; assert.throws(() => gate.renew(lease.token));
  gate.beginMutation()(); lease = gate.acquire(); state.activeWork = 1;
  state.work = [{ kind: 'terminal', label: 'Detached test terminal', workspace: 'Elsewhere' }];
  assert.deepEqual(gate.renew(lease.token), { allowed: false, activeWork: 1, otherWindows: 0, pendingWrites: 0, work: state.work });
  assert.equal(gate.status().preparing, false);
});

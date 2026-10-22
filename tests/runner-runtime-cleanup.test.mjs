import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { terminateRuntimeChild, trackRuntimeChild } from '../server/runner-adapters/transport.mjs';

test('cleanup escalates and awaits close; concurrent calls share the same bounded operation', async () => {
  const child = new EventEmitter(), signals = [];
  child.kill = signal => { signals.push(signal); if (signal === 'SIGKILL') setTimeout(() => child.emit('close', null, signal), 5); return true; };
  trackRuntimeChild(child);
  const first = terminateRuntimeChild(child, { platform: 'darwin', graceful: true, graceMs: 10, forceMs: 100 });
  const second = terminateRuntimeChild(child, { platform: 'darwin', graceful: true, graceMs: 10, forceMs: 100 });
  assert.equal(first, second);
  let closed = false; child.once('close', () => { closed = true; });
  await first;
  assert.equal(closed, true); assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('unconfirmed cleanup rejects instead of declaring a working root reusable', async () => {
  const child = new EventEmitter(), signals = [];
  child.kill = signal => { signals.push(signal); return false; };
  trackRuntimeChild(child);
  await assert.rejects(terminateRuntimeChild(child, { platform: 'darwin', graceful: true, graceMs: 10, forceMs: 10 }), { code: 'runtime_cleanup_failed' });
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('a tracked earlier close does not incur a timeout or leave a deferred SIGKILL timer', async () => {
  const child = new EventEmitter(), signals = [];
  child.kill = signal => { signals.push(signal); return false; };
  trackRuntimeChild(child); child.emit('close', 1);
  await terminateRuntimeChild(child, { platform: 'darwin', graceful: true, graceMs: 10, forceMs: 10 });
  assert.deepEqual(signals, ['SIGKILL']);
});

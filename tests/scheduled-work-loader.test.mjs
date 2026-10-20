import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createScheduledWorkLoader } from '../src/lib/scheduled-work-loader.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const row = (state = 'active', version = 1) => ({ id: 'schedule', state, version });

test('focus, visibility, interval and manual refresh share one in-flight schedule read', async () => {
  const request = deferred(); let reads = 0;
  const loader = createScheduledWorkLoader(() => { reads++; return request.promise; });
  const first = loader.start();
  assert.equal(loader.load(), first); assert.equal(loader.load(), first);
  await Promise.resolve(); assert.equal(reads, 1);
  request.resolve([row()]); await first;
  assert.deepEqual(loader.getSnapshot().items, [row()]);
  assert.equal(loader.getSnapshot().loading, false);
  loader.dispose();
});

test('an old read cannot overwrite a newer accepted reschedule even if transport ignores abort', async () => {
  const request = deferred(); let signal;
  const loader = createScheduledWorkLoader(input => { signal = input; return request.promise; });
  const pending = loader.start(); await Promise.resolve();
  loader.accept(row('paused', 2)); assert.equal(signal.aborted, true);
  request.resolve([row('active', 1)]); await pending;
  assert.deepEqual(loader.getSnapshot().items, []);
  // Accept replaces an existing visible row only; it must not invent an
  // inaccessible list entry returned by a mutation response.
  loader.dispose();
});

test('PATCH invalidates an earlier GET and refetches canonical state only after the write', async () => {
  const oldRead = deferred(), write = deferred(), finalRead = deferred();
  let reads = 0, oldSignal;
  const loader = createScheduledWorkLoader(signal => {
    reads++;
    if (reads === 1) return Promise.resolve([row()]);
    if (reads === 2) { oldSignal = signal; return oldRead.promise; }
    return finalRead.promise;
  });
  await loader.start();
  const stale = loader.load(); await Promise.resolve();
  const mutation = loader.mutate(() => write.promise);
  assert.equal(loader.getSnapshot().busy, true); assert.equal(oldSignal.aborted, true);
  assert.equal(await loader.load(), null); assert.equal(reads, 2);
  write.resolve(row('paused', 2)); await mutation;
  assert.equal(loader.getSnapshot().items[0].state, 'paused');
  oldRead.resolve([row()]); await stale;
  assert.equal(loader.getSnapshot().items[0].state, 'paused');
  finalRead.resolve([row('paused', 2)]); await loader.load();
  assert.equal(reads, 3); assert.equal(loader.getSnapshot().busy, false);
  loader.dispose();
});

test('read failure clears previously readable schedule prompts rather than retaining revoked content', async () => {
  let reads = 0;
  const denied = Object.assign(new Error('Source access revoked'), { status: 403 });
  const loader = createScheduledWorkLoader(async () => { if (++reads === 1) return [{ ...row(), payload: { content: 'Protected prompt' } }]; throw denied; });
  await loader.start(); assert.equal(loader.getSnapshot().items.length, 1);
  await loader.load();
  assert.deepEqual(loader.getSnapshot().items, []); assert.equal(loader.getSnapshot().error, denied);
  loader.dispose();
});

test('failed writes clear protected rows and report failure without publishing success', async () => {
  const loader = createScheduledWorkLoader(async () => [row()]);
  await loader.start();
  const result = await loader.mutate(async () => { throw new Error('Schedule is unavailable'); });
  assert.equal(result, null); assert.equal(loader.getSnapshot().busy, false);
  assert.deepEqual(loader.getSnapshot().items, []); assert.match(loader.getSnapshot().error.message, /unavailable/);
  loader.dispose();
});

test('unchanged polling failures retain one error identity instead of repeatedly announcing the same toast', async () => {
  let code = 'forbidden';
  const loader = createScheduledWorkLoader(async () => { throw Object.assign(new Error('Schedule source unavailable'), { status: 403, code }); });
  await loader.start(); const first = loader.getSnapshot().error;
  await loader.load(); assert.equal(loader.getSnapshot().error, first);
  code = 'account_disabled'; await loader.load(); assert.notEqual(loader.getSnapshot().error, first);
  loader.dispose();
});

test('disposed workspace ignores late reads, writes and accepted reschedule callbacks', async () => {
  const request = deferred(), write = deferred(); let events = 0;
  const loader = createScheduledWorkLoader(() => request.promise);
  loader.subscribe(() => events++);
  const pending = loader.start(); await Promise.resolve(); loader.dispose();
  request.resolve([row()]); await pending;
  assert.equal(events, 0); assert.equal(loader.accept(row()), false);
  await loader.start();
  const mutation = loader.mutate(() => write.promise); const before = events; loader.dispose();
  write.resolve(row('cancelled', 2)); assert.equal(await mutation, null);
  assert.equal(events, before);
});

test('cleanup followed by effect restart does not reuse an aborted request', async () => {
  const first = deferred(), next = deferred(); let calls = 0;
  const loader = createScheduledWorkLoader(() => ++calls === 1 ? first.promise : next.promise);
  const before = loader.start(); await Promise.resolve(); loader.dispose();
  const after = loader.start(); await Promise.resolve(); assert.notEqual(before, after);
  next.resolve([row('paused', 2)]); await after;
  first.resolve([row()]); await before;
  assert.deepEqual(loader.getSnapshot().items, [row('paused', 2)]); loader.dispose();
});

test('invalid schedule list data fails closed and UI is keyed before workspace effects', async () => {
  const loader = createScheduledWorkLoader(async () => ({ old: 'not a list' }));
  await loader.start(); assert.deepEqual(loader.getSnapshot().items, []); assert.match(loader.getSnapshot().error.message, /unreadable/); loader.dispose();
  const source = await readFile(new URL('../src/views/settings/ScheduledWorkSettings.jsx', import.meta.url), 'utf8');
  assert.match(source, /<ScheduledWorkList key=\{workspace.id\}/);
  assert.match(source, /embedded = false, header = true/);
  assert.match(source, /visibilitychange/); assert.match(source, /window.addEventListener\('online'/);
  assert.match(source, /!error && selected && items.some/);
});

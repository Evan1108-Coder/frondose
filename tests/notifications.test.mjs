import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationStore, normalizeNotificationDuration, readNotificationDuration, saveNotificationDuration, notificationSpring, NOTIFICATION_KEY } from '../src/lib/notifications.js';
import { agentReadiness } from '../src/lib/agents.js';

test('simulated connected accounts never grant live or simulated execution readiness', () => {
  const agent = { id: 'sample-agent', provider: 'codex', provider_connection_id: 'sample-connection' };
  const connection = { id: 'sample-connection', provider: 'codex', state: 'connected', mode: 'demo', metadata: { simulated: true, liveAccountChecked: false } };
  const readiness = agentReadiness(agent, connection);
  assert.equal(readiness.label, 'Connected · sample');
  assert.equal(readiness.canStartLive, false);
  assert.equal(readiness.canSimulate, false);
  assert.equal(agentReadiness(agent, { ...connection, id: 'different' }).state, 'needs_connection');
});

test('notification duration is bounded, persistent, and supports manual dismissal', () => {
  for (const input of [undefined, null, -1, NaN, '3000', 600000, {}, false]) assert.equal(normalizeNotificationDuration(input), 8000);
  for (const input of [0, 3000, 5000, 8000, 12000]) assert.equal(normalizeNotificationDuration(input), input);
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(readNotificationDuration(storage), 8000);
  saveNotificationDuration(0, storage);
  assert.equal(readNotificationDuration(storage), 0);
  values.set(NOTIFICATION_KEY, '{');
  assert.equal(readNotificationDuration(storage), 8000);
  assert.equal(readNotificationDuration({ getItem: () => { throw Error('blocked'); } }), 8000);
});
test('one shared channel deduplicates, supports interrupted exits, and unsubscribes', () => {
  const store = createNotificationStore(); let events = 0;
  const unsubscribe = store.subscribe(() => events++);
  const id = store.show('Cannot reach server', 'error');
  assert.equal(store.show('Cannot reach server', 'error'), id);
  assert.equal(store.getSnapshot().length, 1);
  assert.equal(store.getSnapshot()[0].revision, 1);
  store.dismiss(id);
  assert.equal(store.getSnapshot()[0].closing, true);
  const next = store.show('Cannot reach server', 'error');
  assert.notEqual(next, id);
  store.remove(id);
  assert.equal(store.getSnapshot()[0].id, next);
  unsubscribe(); const previous = events;
  store.show('Another error', 'error'); assert.equal(events, previous);
});
test('notification burst is bounded and retains action callbacks', () => {
  const store = createNotificationStore();
  for (let index = 0; index < 20; index++) store.show(`Failure ${index}`, 'error');
  assert.ok(store.getSnapshot().length <= 8);
  const undo = () => {}, retry = () => {};
  store.show('Archived', 'success', undo);
  assert.equal(store.getSnapshot().at(-1).undo, undo);
  store.show('Offline', 'error', undefined, { action: retry, actionLabel: 'Retry' });
  assert.equal(store.getSnapshot().at(-1).action, retry);
});
test('spring enters from above, overshoots gently, and settles precisely', () => {
  assert.equal(notificationSpring[0].transform, 'translateY(-130%)');
  assert.equal(notificationSpring.at(-1).transform, 'translateY(0%)');
  const y = notificationSpring.map(frame => Number(frame.transform.match(/[-\d.]+/)[0]));
  assert.ok(Math.max(...y) > 0 && Math.max(...y) < 15);
  assert.equal(notificationSpring.at(-1).opacity, 1);
});

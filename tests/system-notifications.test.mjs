import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { notificationResultMessage, requestWorkspaceNotification, createNotificationStepTrigger, notifyWorkspaceEvent } from '../src/lib/system-notifications.js';
import { saveWorkspaceOnboarding } from '../src/lib/workspace-onboarding.js';
import { tipExitTransform } from '../src/components/workspace/useTipPresence.js';
const require = createRequire(import.meta.url);
const { createNativeNotificationService, notificationSettingsTarget } = require('../desktop/notification-service.cjs');
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }; };
function runtime(mode = 'show') {
  const instances = [];
  class FakeNotification extends EventEmitter {
    static isSupported() { return mode !== 'unsupported'; }
    constructor(options) { super(); this.options = options; instances.push(this); }
    show() { if (mode === 'throw') throw Error('could not create'); if (mode === 'show') queueMicrotask(() => this.emit('show')); if (mode === 'failed') queueMicrotask(() => this.emit('failed', {}, 'UNErrorDomain error 1')); }
    close() { this.emit('close'); }
  }
  return { Notification: FakeNotification, instances };
}

test('native availability never masquerades as permission or delivery', async () => {
  const fixture = runtime('unsupported'), service = createNativeNotificationService(fixture);
  assert.equal(service.status().permission, 'unavailable');
  assert.equal((await service.send({ title: 'Frondose', body: 'Hello' })).requested, false);
  assert.equal(fixture.instances.length, 0);
});
test('native requests wait for show and retain a bounded validated action', async () => {
  const fixture = runtime(), actions = [], updates = [];
  const service = createNativeNotificationService({ ...fixture, platform: 'darwin', onOpen: action => actions.push(action), onStatus: value => updates.push(value) });
  assert.equal(service.status().delivery, 'idle'); assert.equal(service.status().permission, 'unknown');
  const result = await service.send({ title: 'Frondose', body: 'Done', workspaceId: 'ws', runId: 'run', silent: true });
  assert.equal(result.delivery, 'shown'); assert.equal(result.permission, 'unknown');
  assert.equal(fixture.instances[0].options.silent, true);
  assert.deepEqual(updates.map(item => item.delivery), ['pending', 'shown']);
  fixture.instances[0].emit('click'); assert.deepEqual(actions, [{ workspaceId: 'ws', runId: 'run' }]); service.close();
});
test('native failed events are returned instead of swallowed as successful requests', async () => {
  const fixture = runtime('failed'), service = createNativeNotificationService({ ...fixture, platform: 'darwin' });
  const result = await service.send({ title: 'Frondose', body: 'Hello' });
  assert.equal(result.delivery, 'failed'); assert.match(result.error, /signed Frondose app/); assert.match(result.error, /UNErrorDomain/);
  assert.equal(service.status().delivery, 'failed'); service.close();
});
test('pending permission waits are bounded and late platform failure still updates status', async () => {
  const fixture = runtime('pending'), updates = [];
  let fire;
  const service = createNativeNotificationService({ ...fixture, setTimer: fn => { fire = fn; return 1; }, clearTimer() {}, onStatus: result => updates.push(result) });
  const promise = service.send({ title: 'Frondose', body: 'Hello' });
  fire(); assert.equal((await promise).delivery, 'pending');
  fixture.instances[0].emit('failed', {}, 'denied');
  assert.equal(service.status().delivery, 'failed'); assert.equal(updates.at(-1).delivery, 'failed'); service.close();
});
test('native construction exceptions become honest failed results', async () => {
  const service = createNativeNotificationService(runtime('throw'));
  assert.equal((await service.send({ title: 'Frondose', body: 'Hello' })).delivery, 'failed'); service.close();
});
test('native notifications are bounded and use fixed platform settings destinations', async () => {
  const fixture = runtime(), service = createNativeNotificationService(fixture);
  for (let index = 0; index < 12; index++) await service.send({ title: 'Frondose', body: `Done ${index}` });
  assert.equal(fixture.instances.length, 12); service.close();
  assert.match(notificationSettingsTarget('darwin'), /^x-apple.systempreferences:/);
  assert.equal(notificationSettingsTarget('win32'), 'ms-settings:notifications'); assert.equal(notificationSettingsTarget('linux'), null);
});
test('onboarding sends once when entering notification step, not on every rerender', () => {
  const trigger = createNotificationStepTrigger(); let sends = 0;
  for (let step = 0; step < 3; step++) trigger.enter('ws', true, step, () => sends++);
  assert.equal(sends, 0);
  for (let index = 0; index < 5; index++) trigger.enter('ws', true, 3, () => sends++);
  assert.equal(sends, 1);
  trigger.enter('another', false, 3, () => sends++); assert.equal(sends, 1);
  trigger.reset('ws'); trigger.enter('ws', true, 3, () => sends++); assert.equal(sends, 2);
});
test('welcome native dispatch needs no separate send-test action', async () => {
  const calls = [];
  const result = await requestWorkspaceNotification({ silent: true, native: { test: async payload => { calls.push(payload); return { supported: true, delivery: 'shown' }; } } });
  assert.equal(result.delivery, 'shown'); assert.deepEqual(calls, [{ silent: true }]);
  const source = await readFile(new URL('../src/components/workspace/WorkspaceWelcome.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Send test notification/); assert.match(source, /notificationStep\.current\.enter/);
});
test('denied browser permission does not construct a fake successful notification', async () => {
  let constructed = 0;
  class Fake { static permission = 'denied'; constructor() { constructed++; } }
  const result = await requestWorkspaceNotification({ native: null, NotificationClass: Fake });
  assert.equal(constructed, 0); assert.equal(result.delivery, 'failed'); assert.equal(result.requested, false);
});
test('unanswered embedded browser permission is bounded without trapping onboarding or retrying the prompt', async () => {
  let requests = 0, constructed = 0, complete;
  class Pending { static permission = 'default'; static requestPermission() { requests++; return new Promise(resolve => { complete = resolve; }); } constructor() { constructed++; } }
  const result = await requestWorkspaceNotification({ native: null, NotificationClass: Pending, permissionTimeoutMs: 5 });
  assert.deepEqual(result, { supported: true, requested: false, delivery: 'pending', permission: 'default' });
  assert.match(notificationResultMessage(result), /continue without/);
  const repeated = await requestWorkspaceNotification({ native: null, NotificationClass: Pending, permissionTimeoutMs: 5 });
  assert.equal(repeated.delivery, 'pending'); assert.equal(requests, 1);
  complete('granted'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(constructed, 0, 'a late grant must not display a notification after the onboarding request ended');
});
test('browser permission errors settle honestly and do not create notifications', async () => {
  class Rejected { static permission = 'default'; static requestPermission() { return Promise.reject(Error('Embedded prompt unavailable')); } constructor() { throw Error('must not construct'); } }
  const result = await requestWorkspaceNotification({ native: null, NotificationClass: Rejected, permissionTimeoutMs: 5 });
  assert.equal(result.delivery, 'failed'); assert.equal(result.requested, false); assert.match(result.error, /Embedded prompt unavailable/);
});
test('live-work dispatch checks opt-in and sound, dedupes duplicate views, and strips identity from payload', async () => {
  const preferenceStorage = memory(), storage = memory(), calls = [];
  const environment = { preferenceStorage, storage, native: { notify: async payload => { calls.push(payload); return { requested: true, delivery: 'shown' }; } } };
  const event = { workspaceId: 'ws_live_notice', key: 'terminal:one:ended', title: 'Session finished', body: 'Codex has finished.' };
  assert.equal((await notifyWorkspaceEvent(event, environment)).delivery, 'disabled');
  saveWorkspaceOnboarding(event.workspaceId, { notificationsEnabled: true, notificationSound: 'silent' }, preferenceStorage);
  assert.equal((await notifyWorkspaceEvent(event, environment)).delivery, 'shown');
  assert.equal((await notifyWorkspaceEvent(event, environment)).delivery, 'duplicate');
  assert.deepEqual(calls, [{ title: event.title, body: event.body, silent: true }]);
});
test('background completion never asks browser permission', async () => {
  const preferenceStorage = memory(); let requests = 0;
  class Fake { static permission = 'default'; static requestPermission() { requests++; } }
  saveWorkspaceOnboarding('ws_background_notice', { notificationsEnabled: true }, preferenceStorage);
  const result = await notifyWorkspaceEvent({ workspaceId: 'ws_background_notice', key: 'terminal:two:ended', title: 'Done', body: 'Done' }, { preferenceStorage, storage: memory(), native: null, NotificationClass: Fake });
  assert.equal(result.requested, false); assert.equal(requests, 0);
});
test('status copy distinguishes pending from OS acceptance and failure', () => {
  assert.match(notificationResultMessage({ supported: true, delivery: 'pending' }), /Waiting/);
  assert.match(notificationResultMessage({ supported: true, delivery: 'shown' }), /accepted/);
  assert.equal(notificationResultMessage({ supported: true, delivery: 'failed', error: 'Denied' }), 'Denied');
});
test('tip exit slides back toward its edge and remains mounted until completion', async () => {
  assert.equal(tipExitTransform(385), 'translateX(417px)'); assert.equal(tipExitTransform(385, 'left'), 'translateX(-417px)');
  const source = await readFile(new URL('../src/components/workspace/useTipPresence.js', import.meta.url), 'utf8');
  assert.match(source, /animation\.onfinish = complete/); assert.match(source, /if \(!cancelled && !show\) setPresent\(false\)/);
  assert.match(source, /prefers-reduced-motion/); assert.match(source, /animation\.cancel\(\)/);
});

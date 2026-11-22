import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { browserUrl, appUrl, browserIdentity, browserBounds, isTrustedFrame, guardWorkspaceNavigation, GUEST_WEB_PREFERENCES, notificationPayload } = require('../desktop/browser-policy.cjs');
const { createBrowserHost } = require('../desktop/browser-host.cjs');

test('desktop URL policy accepts only complete HTTP(S) browser pages and a fixed loopback application origin', () => {
  for (const url of ['https://example.com/', 'http://localhost:3000/test?q=one#two', 'http://127.0.0.1:5173', 'about:blank']) assert.equal(typeof browserUrl(url), 'string');
  for (const url of ['', 'https://user:secret@example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'chrome://settings', 'https://exa mple.com', 'https://example.com/\n', 'http:\\localhost', null]) assert.throws(() => browserUrl(url));
  assert.equal(appUrl('http://127.0.0.1:4174'), 'http://127.0.0.1:4174');
  for (const url of ['https://example.com:4174', 'http://localhost:4174', 'http://127.0.0.1:4174/path', 'http://127.0.0.1:4174/#/', 'http://127.0.0.1:4174/?a=1', 'file:///index.html']) assert.throws(() => appUrl(url));
});

test('browser identity partitions are stable, workspace-isolated and do not contain user paths', () => {
  const a = browserIdentity({ workspaceId: 'workspace_one', tabId: 'browser:one' });
  const b = browserIdentity({ workspaceId: 'workspace_one', tabId: 'browser:two' });
  const c = browserIdentity({ workspaceId: 'workspace_two', tabId: 'browser:one' });
  assert.equal(a.partition, b.partition); assert.notEqual(a.partition, c.partition); assert.notEqual(a.key, b.key);
  assert.match(a.partition, /^persist:frondose-browser-[a-f0-9]{32}$/);
  for (const invalid of ['../secret', 'folder/path', '', 'x'.repeat(129), 'x\0y']) assert.throws(() => browserIdentity({ workspaceId: invalid, tabId: 'a' }));
});

test('browser bounds are finite integers clamped inside the actual application viewport', () => {
  assert.deepEqual(browserBounds({ x: -7, y: 29.7, width: 9000, height: 9000 }, { width: 1440, height: 900 }), { x: 0, y: 30, width: 1440, height: 870 });
  assert.deepEqual(browserBounds({ x: 5000, y: 5000, width: -3, height: 0 }, { width: 100, height: 100 }), { x: 99, y: 99, width: 1, height: 1 });
  for (const bad of [NaN, Infinity, undefined, '20']) assert.throws(() => browserBounds({ x: bad, y: 0, width: 10, height: 10 }, { width: 100, height: 100 }));
});

test('desktop native controls reject guests, subframes and navigated app documents', () => {
  const frame = { url: 'http://127.0.0.1:4174/#/projects' };
  const contents = { mainFrame: frame };
  const window = { webContents: contents, isDestroyed: () => false };
  assert.equal(isTrustedFrame({ sender: contents, senderFrame: frame }, window, 'http://127.0.0.1:4174'), true);
  assert.equal(isTrustedFrame({ sender: {}, senderFrame: frame }, window, 'http://127.0.0.1:4174'), false);
  assert.equal(isTrustedFrame({ sender: contents, senderFrame: { ...frame } }, window, 'http://127.0.0.1:4174'), false);
  for (const url of ['https://example.com', 'blob:http://127.0.0.1:4174/file', 'http://127.0.0.1:4174/api/health', 'http://localhost:4174/']) {
    frame.url = url;
    assert.equal(isTrustedFrame({ sender: contents, senderFrame: frame }, window, 'http://127.0.0.1:4174'), false);
  }
});

test('workspace navigation policy rejects off-boundary redirects and keeps previews as source documents', () => {
  const contents = new EventEmitter(), origin = 'http://127.0.0.1:4174';
  guardWorkspaceNavigation(contents, origin);
  function decide(type, url, isMainFrame, legacy = false) {
    let prevented = false;
    const event = { ...(legacy ? {} : { url, isMainFrame }), preventDefault() { prevented = true; } };
    contents.emit(type, event, ...(legacy ? [url, false, isMainFrame] : []));
    return prevented;
  }
  assert.equal(decide('will-navigate', origin + '/#/projects', true), false);
  assert.equal(decide('will-redirect', origin + '/index.html', true, true), false);
  assert.equal(decide('will-redirect', 'https://example.test/', true), true);
  assert.equal(decide('will-navigate', 'blob:' + origin + '/fixture', true), true);
  assert.equal(decide('will-frame-navigate', 'about:srcdoc', false), false);
  assert.equal(decide('will-frame-navigate', origin + '/api/health', false), true);
});

test('desktop native controls require a listening app-owned server; the external test fixture receives no preload or IPC', async () => {
  const source = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(source, /async function ensureServer\(\) \{\s*if \(smoke\) \{\s*try \{ await readHealth\(\); return; \}/);
  assert.equal((source.match(/await readHealth\(\)/g) || []).length, 1);
  assert.match(source, /const local = await launchLocal\([^;]+;\s*ownedServer = local.server;/);
  assert.match(source, /function trusted\(event\) \{ if \(!ownedServer\?\.listening \|\| !isTrustedFrame/);
  assert.match(source, /!smoke && ownedServer\?\.listening \? \{ preload:/);
  assert.match(source, /await ensureServer\(\);\s*if \(!smoke\) \{\s*registerIpc\(\);/);
});

function fixture(maxPages = 12, origin = 'http://127.0.0.1:4174') {
  const views = [], attached = new Set(), partitions = new Map(), sent = [];
  class FakeContents extends EventEmitter {
    constructor() { super(); this.url = ''; this.destroyed = false; this.navigationHistory = { canGoBack: () => false, canGoForward: () => false }; }
    getURL() { return this.url; } getTitle() { return 'Example'; } isLoading() { return false; } isDestroyed() { return this.destroyed; }
    setWindowOpenHandler(handler) { this.popup = handler; }
    async loadURL(url) { this.url = url; }
    reload() { this.reloaded = true; }
    close() { this.destroyed = true; this.emit('destroyed'); }
  }
  class FakeView { constructor(options) { this.options = options; this.webContents = new FakeContents(); views.push(this); } setBounds(bounds) { this.bounds = bounds; } }
  const mainWindow = { isDestroyed: () => false, getContentBounds: () => ({ width: 1000, height: 800 }), webContents: { send(channel, state) { sent.push({ channel, state }); } }, contentView: { addChildView: view => attached.add(view), removeChildView: view => attached.delete(view) } };
  const session = { fromPartition(name) { if (!partitions.has(name)) { const value = new EventEmitter(); value.setPermissionRequestHandler = handler => value.permissionRequest = handler; value.setPermissionCheckHandler = handler => value.permissionCheck = handler; value.webRequest = { onBeforeRequest(handler) { value.beforeRequest = handler; } }; partitions.set(name, value); } return partitions.get(name); } };
  const host = createBrowserHost({ mainWindow, WebContentsView: FakeView, session, maxPages, origin });
  const identity = { workspaceId: 'ws_one', tabId: 'tab_one', bounds: { x: 200, y: 100, width: 600, height: 400 } };
  return { host, views, attached, partitions, identity, sent };
}

test('native browser pages are hardened, preserve backing state on hide/replacement and close only explicitly', async () => {
  const { host, views, attached, identity } = fixture();
  await host.command({ ...identity, operation: 'show', url: 'https://example.com' });
  assert.equal(views.length, 1); assert.equal(attached.size, 1);
  for (const [key, value] of Object.entries(GUEST_WEB_PREFERENCES)) assert.equal(views[0].options.webPreferences[key], value);
  assert.equal(views[0].options.webPreferences.preload, undefined);
  await host.command({ ...identity, operation: 'hide' });
  assert.equal(attached.size, 0); assert.equal(views[0].webContents.destroyed, false);
  await host.command({ ...identity, operation: 'show', url: 'about:blank' });
  assert.equal(views.length, 1); assert.equal(views[0].webContents.url, 'https://example.com/');
  await host.command({ ...identity, tabId: 'tab_two', operation: 'show' });
  assert.equal(host.count(), 2); assert.equal(attached.size, 2); assert.equal(views[0].webContents.destroyed, false);
  await host.command({ ...identity, operation: 'close' });
  assert.equal(views[0].webContents.destroyed, true); assert.equal(host.count(), 1);
  host.close(); assert.equal(host.count(), 0); assert.equal(attached.size, 0);
});

test('managed applications cannot claim duplicate tabs or workspaces and release on close', async () => {
  const { host, identity } = fixture();
  assert.equal((await host.command({ ...identity, operation: 'claim', applicationId: 'guacamole' })).claimed, true);
  await assert.rejects(host.command({ ...identity, tabId: 'another', operation: 'claim', applicationId: 'guacamole' }), /already open/);
  await host.command({ ...identity, operation: 'close' });
  assert.equal((await host.command({ ...identity, tabId: 'another', operation: 'claim', applicationId: 'guacamole' })).claimed, true);
  await assert.rejects(host.command({ ...identity, operation: 'claim', applicationId: 'native-app' }), /Unsupported/);
  host.close();
});

test('native browser focus is published only for attached guests and never from show/state responses', async () => {
  const { host, views, identity, sent, attached } = fixture();
  const shown = await host.command({ ...identity, operation: 'show' });
  assert.equal(shown.event, undefined);
  assert.equal((await host.command({ ...identity, operation: 'state' })).event, undefined);
  views[0].webContents.emit('focus');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'frondose-desktop:browser-state');
  assert.equal(sent[0].state.event, 'focus');
  assert.equal(sent[0].state.tabId, identity.tabId);
  await host.command({ ...identity, operation: 'show', tabId: 'split_second', bounds: { x: 5, y: 10, width: 190, height: 400 } });
  assert.equal(attached.size, 2, 'two visible split browsers must not fight for one active guest');
  await host.command({ ...identity, operation: 'hide' });
  assert.equal(attached.size, 1);
  views[0].webContents.emit('focus');
  assert.equal(sent.length, 1, 'hidden retained pages cannot steal app focus');
  views[1].webContents.emit('focus');
  assert.equal(sent.at(-1).state.tabId, 'split_second');
  host.hideAll(); assert.equal(attached.size, 0); assert.equal(host.count(), 2);
  host.close();
});

test('invalid browser requests cannot allocate guests, alter views or bypass the operation allowlist', async () => {
  const { host, views, identity } = fixture();
  await assert.rejects(host.command({ ...identity, operation: 'show', url: 'file:///etc/passwd' }));
  await assert.rejects(host.command({ ...identity, operation: 'show', bounds: { x: NaN, y: 0, width: 10, height: 10 } }));
  await assert.rejects(host.command({ ...identity, operation: 'evaluateJavaScript', code: 'process.exit()' }));
  await assert.rejects(host.command({ ...identity, operation: 'navigate', url: 'https://example.com' }));
  assert.equal(views.length, 0);
});

test('browser popup, permission and download policies deny unreviewed native access', async () => {
  const { host, views, partitions, identity } = fixture();
  await host.command({ ...identity, operation: 'show' });
  assert.deepEqual(views[0].webContents.popup({ url: 'file:///etc/passwd' }), { action: 'deny' });
  let prevented = 0;
  views[0].webContents.emit('will-navigate', { preventDefault() { prevented++; } }, 'javascript:alert(1)');
  views[0].webContents.emit('will-redirect', { preventDefault() { prevented++; } }, 'file:///tmp/file');
  assert.equal(prevented, 2);
  const guestSession = [...partitions.values()][0];
  assert.equal(guestSession.permissionCheck(), false);
  let allowed; guestSession.permissionRequest({}, 'media', value => { allowed = value; }); assert.equal(allowed, false);
  guestSession.emit('will-download', { preventDefault() { prevented++; } }); assert.equal(prevented, 3);
  host.close();
});

test('guest network policy isolates the actual workspace port without disabling other local previews', async () => {
  const { host, views, partitions, identity } = fixture(12, 'http://127.0.0.1:4417');
  await assert.rejects(host.command({ ...identity, operation: 'show', url: 'http://localhost:4417/' }), /workspace server/);
  assert.equal(views.length, 0);
  await host.command({ ...identity, operation: 'show', url: 'http://127.0.0.1:5173/' });
  const check = (url, resourceType) => {
    let decision;
    [...partitions.values()][0].beforeRequest({ url, resourceType }, value => { decision = value; });
    return decision.cancel;
  };
  assert.equal(check('http://127.0.0.1:4417/', 'mainFrame'), true);
  assert.equal(check('http://localhost:4417/api/health', 'subFrame'), true);
  assert.equal(check('ws://[::1]:4417/', 'webSocket'), true);
  assert.equal(check('http://[::ffff:127.0.0.1]:4417/', 'xhr'), true);
  assert.equal(check('http://127.0.0.1:5173/assets/main.js', 'script'), false);
  assert.equal(check('https://example.test:4417/', 'xhr'), false);
  const contents = views[0].webContents;
  let prevented = 0;
  contents.emit('will-redirect', { url: 'http://localhost:4417/', preventDefault() { prevented++; } });
  contents.emit('will-redirect', { url: 'https://example.test/', preventDefault() { prevented++; } });
  assert.equal(prevented, 1, 'modern Electron navigation events enforce the same policy');
  host.close();
});

test('browser resource limit never evicts a live page or replays its navigation', async () => {
  const { host, views, identity } = fixture(1);
  await host.command({ ...identity, operation: 'show', url: 'https://example.com' });
  await assert.rejects(host.command({ ...identity, operation: 'show', tabId: 'second' }), /Close an existing/);
  assert.equal(views.length, 1); assert.equal(views[0].webContents.destroyed, false); host.close();
});
test('superseded browser loads cannot replace the current navigation error state', async () => {
  const { host, views, identity } = fixture();
  await host.command({ ...identity, operation: 'show' });
  const pending = [];
  views[0].webContents.loadURL = url => new Promise((resolve, reject) => { pending.push({ url, resolve, reject }); });
  await host.command({ ...identity, operation: 'navigate', url: 'https://first.example' });
  await host.command({ ...identity, operation: 'navigate', url: 'https://second.example' });
  pending[0].reject(Error('stale first load failed'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await host.command({ ...identity, operation: 'state' })).error, null);
  pending[1].reject(Error('current load failed'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await host.command({ ...identity, operation: 'state' })).error, 'current load failed');
  await host.command({ ...identity, operation: 'navigate', url: 'https://third.example' });
  host.close(); pending[2].reject(Error('closed page rejected'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(host.count(), 0);
});

test('preload exposes typed methods only and retains the upstream MIT attribution', async () => {
  const preload = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  assert.ok(!preload.includes('send:')); assert.ok(!preload.includes('executeJavaScript')); assert.ok(!preload.includes('eval('));
  const license = await readFile(new URL('../desktop/ORCA-LICENSE.txt', import.meta.url), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Lovecast Inc\./);
  const config = require('../config/electron-builder.cjs');
  assert.equal(config.appId, 'app.frondose.desktop'); assert.equal(config.publish, null);
  for (const platform of ['mac', 'win', 'linux']) assert.ok(config[platform]);
});
test('native notification payloads are bounded plain text with typed run navigation only', () => {
  const notice = notificationPayload({ title: 'a'.repeat(200), body: 'hi\0there\n' + 'b'.repeat(400), workspaceId: 'ws_one', runId: 'run_one', url: 'file:///secret', command: 'run', silent: true });
  assert.equal(notice.title.length, 100); assert.equal(notice.body.length, 300); assert.doesNotMatch(notice.body, /[\0\n]/);
  assert.deepEqual(notice.action, { workspaceId: 'ws_one', runId: 'run_one' }); assert.equal(notice.url, undefined); assert.equal(notice.command, undefined);
  assert.throws(() => notificationPayload({ title: 'a', body: 'b', workspaceId: 'ws', runId: '../escape' }));
  assert.equal(notificationPayload({ title: 'a', body: 'b', silent: 'true' }).silent, false);
});

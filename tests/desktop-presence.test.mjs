import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import system from '../desktop/system-presence.cjs';
import menu from '../desktop/system-menu.cjs';
import documents from '../desktop/os-open.cjs';

const { createSystemPresence, createAwakeControl, normalizePresence } = system;
const { desktopMenu } = menu;
const { osTarget, documentHtml, maxBytes } = documents;
const temporary = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'frondose-desktop-presence-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
};

test('menu bar, close behavior and awake defaults are independent', () => {
  const prefs = normalizePresence({ showTray: false, keepRunning: true, keepAwake: 'nope', dockIcon: '/private/file' });
  assert.deepEqual(prefs, { showTray: false, keepRunning: true, keepAwake: 'off', dockIcon: 'classic', openAtLogin: false });
  assert.equal(normalizePresence({}).keepRunning, false);
});

test('awake assertion only blocks idle sleep; agent mode releases when work stops', () => {
  let started = false;
  const calls = [];
  const power = createAwakeControl({
    start: kind => { calls.push(kind); started = true; return 0; },
    isStarted: () => started,
    stop: id => { calls.push(id); started = false; },
  });
  assert.equal(power.sync('working', false), false);
  assert.equal(power.sync('working', true), true);
  assert.equal(power.sync('on', false), true);
  assert.equal(power.sync('working', false), false);
  assert.deepEqual(calls, ['prevent-app-suspension', 0]);
  assert.equal(power.sync('off', true), false);
});

test('tray uses a native menu, retains preferences with icon hidden and shows attention from a new waiting job', async t => {
  const dir = await temporary(t), theme = new EventEmitter(), images = [], trayInstances = [];
  let active = { working: [], waiting: [] }, visible = true, opened = 0, stops = 0;
  const applied = [], routes = [];
  let notifySaved;
  const savedFromMenu = new Promise(resolve => { notifySaved = resolve; });
  const placeholder = { isEmpty: () => false, resize: ({width,height}) => ({toBitmap: () => Buffer.alloc(width * height * 4, 255)}) };
  class FakeTray extends EventEmitter {
    constructor() { super(); trayInstances.push(this); }
    setImage(image) { this.image = image; }
    setToolTip(name) { this.name = name; }
    setContextMenu(items) { this.items = items; }
    destroy() { this.destroyed = true; }
  }
  const presence = await createSystemPresence({
    platform: 'darwin', userData: dir, nativeTheme: theme, Tray: FakeTray, Menu: { buildFromTemplate: rows => rows },
    nativeImage: { createFromPath: () => placeholder, createEmpty: () => ({ addRepresentation: data => images.push(data), setTemplateImage() {} }) },
    powerSaveBlocker: { start: () => 1, stop: () => {}, isStarted: () => true },
    app: { dock: { setIcon() {} } }, allowLogin: false, activity: () => active,
    onState: state => { applied.push(state); if (state.preferences.keepRunning) notifySaved(); },
    actions: {
      open: () => { opened++; }, visible: () => visible, route: route => routes.push(route),
      settings() {}, updates() {}, document() {}, hide() {}, about() {}, quit: explicit => { if (explicit) stops++; },
    },
  });
  t.after(() => presence.close());
  await setImmediate();
  const [tray] = trayInstances;
  assert.ok(tray);
  assert.ok(images.some(rep => rep.width === 36 && rep.scaleFactor === 2));
  tray.items.find(item => item.label === 'Open Frondose').click();
  tray.items.find(item => item.label === 'Workspace').submenu.find(item => item.label === 'Automations').click();
  tray.items.find(item => item.label === 'Quit and Stop Sessions…').click();
  await setImmediate();
  assert.equal(opened, 1);
  assert.equal(stops, 1);
  assert.deepEqual(routes, ['automations']);
  const set = (key, value) => presence.command({ operation: 'set', key, value });
  tray.items.find(item => item.label === 'Window & Startup').submenu.find(item => item.type === 'checkbox').click();
  // The click persists asynchronously; the renderer receives the applied value.
  await savedFromMenu;
  assert.equal(applied.at(-1).preferences.keepRunning, true);
  await set('showTray', false);
  assert.equal(tray.destroyed, true);
  assert.equal(presence.state().preferences.keepRunning, true);
  assert.equal(JSON.parse(await readFile(join(dir, 'desktop-presence.json'), 'utf8')).keepRunning, true);
  await set('showTray', true);
  visible = false;
  active = { working: [], waiting: ['turn:one'] };
  await set('keepAwake', 'working');
  assert.equal(presence.state().attention, true);
  assert.match(trayInstances[1].name, /needs attention/);
  assert.equal(presence.state().awakeActive, false);
  assert.equal(trayInstances[1].items.find(item => item.label?.startsWith('Activity')).submenu[0].label, '1 needs input');
  await presence.command({ operation: 'preview-attention' });
  await presence.command({ operation: 'preview-attention' });
  assert.equal(presence.state().preview, false);
  assert.equal(presence.state().attention, true, 'preview must not acknowledge real activity');
  presence.clearAttention();
  assert.equal(presence.state().attention, false);
  await assert.rejects(set('keepAwake', 'bad'), /Unsupported/);
  await assert.rejects(set('openAtLogin', true), /not available/);
});

test('the Windows tray omits Dock choices and native power options have one selected value', () => {
  const actions = { error: error => { throw error; } };
  const items = desktopMenu({ supported: { tray: true, login: true, dock: false }, preferences: normalizePresence({ keepAwake: 'working', openAtLogin: true }), workingCount: 2, waitingCount: 1, awakeActive: true }, actions);
  assert.equal(items.some(item => item.label === 'Dock Icon'), false);
  assert.deepEqual(items.find(item => item.label === 'Keep Awake · Active').submenu.map(item => [item.type, item.checked]), [['radio', false], ['radio', true], ['radio', false]]);
  assert.equal(items.find(item => item.label === 'Window & Startup').submenu.find(item => item.label === 'Open at Login').checked, true);
  assert.equal(items.find(item => item.label === 'Activity').submenu[0].label, '2 agents working · 1 needs input');
});

test('OS routes are allowlisted and preview paths are absolute supported files', () => {
  assert.deepEqual(osTarget('frondose://settings/desktop'), { route: 'settings' });
  for (const target of ['frondose://run/agent', 'frondose://settings/desktop?execute=yes', 'frondose://settings#run', 'https://example.test/test.txt', 'relative.md', 'file:///a.exe']) assert.equal(osTarget(target), null, target);
  const local = join(tmpdir(), 'fixture.CSV');
  assert.deepEqual(osTarget(pathToFileURL(local).href), { path: local });
});

test('Finder preview is bounded, read only and escapes selected content', async t => {
  const dir = await temporary(t);
  const note = join(dir, 'selected & file.md');
  await writeFile(note, '<script>alert(1)</script>\na & b');
  const html = await documentHtml(note);
  assert.match(html, /Read-only preview/);
  assert.match(html, /selected &amp; file.md/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  await writeFile(note, Buffer.alloc(maxBytes + 1));
  await assert.rejects(documentHtml(note), /512 KiB/);
  await writeFile(note, Buffer.from([255]));
  await assert.rejects(documentHtml(note));
});

'use strict';
const { readFile, writeFile, rename, rm, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { desktopMenu } = require('./system-menu.cjs');

const defaults = Object.freeze({ showTray: true, keepRunning: false, keepAwake: 'off', dockIcon: 'classic', openAtLogin: false });
const values = { keepAwake: ['off', 'working', 'on'], dockIcon: ['classic', 'indigo', 'paper'] };
function normalizePresence(input) {
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (values[key]?.includes(input?.[key]) || (typeof defaults[key] === 'boolean' && typeof input?.[key] === 'boolean')) out[key] = input[key];
  }
  return out;
}

// Draw from the existing transparent frond artwork. Native template images
// pick up the menu bar foreground; only the attention variant uses color.
function frondImage(nativeImage, source, { size = 18, color, background, dot = false, template = false } = {}) {
  const image = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const width = size * scale;
    const inset = Math.round((background ? size * .18 : 1) * scale);
    const glyph = width - inset * 2;
    const src = source.resize({ width: glyph, height: glyph }).toBitmap({ scaleFactor: 1 });
    const bitmap = Buffer.alloc(width * width * 4);
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const alpha = x >= inset && x < inset + glyph && y >= inset && y < inset + glyph
        ? src[((y - inset) * glyph + x - inset) * 4 + 3] : 0;
      const corner = size * .23 * scale;
      const short = Math.min(x, width - 1 - x), tall = Math.min(y, width - 1 - y);
      const bg = background && Math.hypot(Math.max(0, corner - short), Math.max(0, corner - tall)) <= corner;
      const badge = dot && Math.hypot(x - (width - 3.3 * scale), y - 3.5 * scale) <= 2.6 * scale;
      const rgb = badge ? [249, 177, 65] : color;
      for (let b = 0; b < 3; b++) {
        const base = bg ? background[2 - b] : 0;
        bitmap[offset + b] = badge ? rgb[2 - b] : Math.round(rgb[2 - b] * alpha / 255 + base * (255 - alpha) / 255);
      }
      bitmap[offset + 3] = badge || bg ? 255 : alpha;
    }
    image.addRepresentation({ buffer: bitmap, width, height: width, scaleFactor: scale });
  }
  image.setTemplateImage(template);
  return image;
}

function createAwakeControl(blocker) {
  let id = null;
  return {
    sync(mode, working) {
      const wanted = mode === 'on' || (mode === 'working' && working);
      if (wanted && (id === null || !blocker.isStarted(id))) id = blocker.start('prevent-app-suspension');
      if (!wanted && id !== null) { blocker.stop(id); id = null; }
      return id !== null && blocker.isStarted(id);
    },
  };
}

async function createSystemPresence({ app, userData, platform, Tray, Menu, nativeImage, nativeTheme, powerSaveBlocker, iconPath, classicIcon, actions, activity, onState = () => {}, allowLogin = true }) {
  const path = join(userData, 'desktop-presence.json');
  let prefs = normalizePresence(null);
  try { prefs = normalizePresence(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') console.warn('Frondose could not load desktop preferences. Defaults will be used.'); }
  const supported = { tray: platform === 'darwin' || platform === 'win32', dock: platform === 'darwin', login: allowLogin && (platform === 'darwin' || platform === 'win32') };
  const source = nativeImage.createFromPath(iconPath);
  const images = new Map();
  const awake = createAwakeControl(powerSaveBlocker);
  let tray = null, attention = false, preview = false, awakeActive = false, previous = null, pending = false, closed = false, updating = false;
  let menuState = '', published = '', lastDock = null;
  function image(kind) {
    if (images.has(kind)) return images.get(kind);
    const built = kind === 'classic' ? nativeImage.createFromPath(classicIcon)
      : kind === 'indigo' ? frondImage(nativeImage, source, { size: 128, color: [255,255,255], background: [60, 53, 135] })
      : kind === 'paper' ? frondImage(nativeImage, source, { size: 128, color: [28, 30, 42], background: [238, 240, 244] })
      : frondImage(nativeImage, source, { color: kind === 'tray-dark' || platform === 'win32' ? [245, 246, 250] : [24, 25, 30], dot: kind !== 'tray-plain', template: kind === 'tray-plain' && platform === 'darwin' });
    images.set(kind, built);
    return built;
  }
  function menuError(error) {
    // Native checkbox and radio items can flip before the preference is saved.
    // Restore the authoritative values after an unsuccessful write.
    menuState = '';
    schedule();
    actions.error?.(error);
  }
  const state = () => ({ preferences: prefs, supported, attention, preview, awakeActive, working: Boolean(previous?.working.length), workingCount: previous?.working.length || 0, waitingCount: previous?.waiting.length || 0, trayVisible: Boolean(tray) });
  function publish() {
    const snapshot = state(), fingerprint = JSON.stringify(snapshot);
    if (published !== fingerprint) { published = fingerprint; onState(snapshot); }
  }
  function sync() {
    if (closed) return;
    awakeActive = awake.sync(prefs.keepAwake, Boolean(previous?.working.length));
    if (supported.dock && lastDock !== prefs.dockIcon) {
      app.dock.setIcon(image(prefs.dockIcon));
      lastDock = prefs.dockIcon;
    }
    if (!supported.tray || !prefs.showTray || source.isEmpty()) {
      tray?.destroy(); tray = null; menuState = ''; publish(); return;
    }
    const kind = attention || preview ? nativeTheme.shouldUseDarkColors ? 'tray-dark' : 'tray-light' : 'tray-plain';
    if (!tray) {
      tray = new Tray(image(kind));
      if (platform === 'win32') tray.on('click', () => { void Promise.resolve().then(actions.open).catch(menuError); });
    }
    const next = `${kind}:${JSON.stringify(state())}`;
    if (menuState === next) return;
    tray.setImage(image(kind));
    tray.setToolTip(attention ? 'Frondose — Activity needs attention' : 'Frondose');
    tray.setContextMenu(Menu.buildFromTemplate(desktopMenu(state(), {
      ...actions, error: menuError, set: setPreference, toggle: key => setPreference(key, !prefs[key]),
      clear: clearAttention, preview: togglePreview,
    })));
    menuState = next;
    publish();
  }
  // AppKit invokes native menu and theme handlers in its own callouts.
  // Coalesce icon changes away from those callbacks.
  function schedule() {
    if (pending || closed) return;
    pending = true;
    setImmediate(() => { pending = false; try { sync(); } catch (error) { console.warn('Frondose desktop presence:', error.message); } });
  }
  function sample() {
    try {
      const next = activity();
      if (!next) return;
      if (!actions.visible() && previous && (previous.working.some(id => !next.working.includes(id)) || next.waiting.some(id => !previous.waiting.includes(id)))) attention = true;
      previous = next;
      schedule();
    } catch (error) { console.warn('Could not read local activity:', error.message); }
  }
  const timer = setInterval(sample, 2000);
  timer.unref?.();
  nativeTheme.on('updated', schedule);
  if (supported.login) prefs = { ...prefs, openAtLogin: app.getLoginItemSettings().openAtLogin === true };
  sample();
  schedule();
  function clearAttention() { attention = false; schedule(); }
  function togglePreview() {
    if (!supported.tray || !prefs.showTray) throw Error('Show the menu bar or tray icon before previewing its dot.');
    preview = !preview;
    schedule();
    return state();
  }
  async function setPreference(key, value) {
    if (!Object.hasOwn(defaults, key) || normalizePresence({ [key]: value })[key] !== value) throw Error('Unsupported desktop preference.');
    if ((key === 'showTray' && !supported.tray) || (key === 'dockIcon' && !supported.dock) || (key === 'openAtLogin' && !supported.login)) throw Error('This desktop setting is not available here.');
    if (updating) throw Error('Wait for the other desktop setting to finish saving.');
    updating = true;
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const next = { ...prefs, [key]: value };
      await mkdir(userData, { recursive: true, mode: 0o700 });
      if (key === 'openAtLogin') {
        // The OS owns login-item state. Do not silently show the requested
        // value if the system rejected it.
        app.setLoginItemSettings({ openAtLogin: value });
        next.openAtLogin = app.getLoginItemSettings().openAtLogin === true;
        if (next.openAtLogin !== value) throw Error('macOS or Windows did not accept the login setting. Check your system startup settings.');
      }
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
      prefs = next;
      if (!prefs.showTray) preview = false;
      sample();
      sync();
      return state();
    } finally {
      updating = false;
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  return {
    state,
    markAttention() { if (!actions.visible()) { attention = true; schedule(); } },
    clearAttention,
    async command(payload) {
      if (payload?.operation === 'status') return state();
      if (payload?.operation === 'preview-attention') return togglePreview();
      if (payload?.operation === 'set') return setPreference(payload.key, payload.value);
      throw Error('Unsupported desktop preference.');
    },
    close() {
      closed = true;
      clearInterval(timer);
      nativeTheme.off('updated', schedule);
      awake.sync('off', false);
      tray?.destroy(); tray = null;
    },
  };
}
module.exports = { createSystemPresence, createAwakeControl, normalizePresence, frondImage };

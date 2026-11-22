'use strict';
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { createDesktopUpdateService, releaseConfiguration } = require('./update-service.cjs');
const { createUpdateStorage } = require('./update-storage.cjs');
const { createLocalAdapter } = require('./local-update.cjs');
const { blocked, cleanBlockers, leaseBlockers, rendererKinds } = require('./update-blockers.cjs');
const { createUpdateCleanup } = require('./update-cleanup.cjs');

// Only immutable, owner-provisioned packaging configuration selects a feed.
// No renderer URL, GH_TOKEN, Orca endpoint or caller-supplied executable is used.
async function createNativeUpdater({ app, origin, window: getWindow, browserHost: getBrowserHost, ownsServer = () => false, terminalTargets = () => [], powerMonitor, config = require('./release-config.json') }) {
  let configured = false, validConfig = true, reason = 'Automatic updates are not configured for this build.', settings;
  try { settings = releaseConfiguration(config); }
  catch { validConfig = false; settings = releaseConfiguration(); reason = 'The packaged release configuration is invalid. No update requests will be made.'; }
  if (app.isPackaged && settings.feedUrl && app.getVersion() !== '0.0.0') {
    if (process.platform === 'darwin' && settings.macTeamId) {
      try {
        const result = await promisify(execFile)('/usr/bin/codesign', ['-dv', '--verbose=4', process.execPath], { timeout: 5000, maxBuffer: 20000 });
        configured = result.stderr.split('\n').includes(`TeamIdentifier=${settings.macTeamId}`);
      } catch { /* fail closed; no signing/security override */ }
      if (!configured) reason = 'This Mac build has no matching publisher signature. Use a local/manual build; automatic installation is unavailable.';
    } else if (process.platform === 'win32' && settings.windowsPublisherName) configured = true;
    else if (process.platform === 'linux' && process.env.APPIMAGE) reason = 'This AppImage has no authenticated release feed. Use a verified manual download.';
    else reason = 'This build uses manual installation. A signed publisher build or supported AppImage is needed for automatic updates.';
  }
  let native, progressCallback, timer, safetyRequest = null, lastState;
  if (configured) {
    const { MacUpdater, NsisUpdater, AppImageUpdater } = require('electron-updater');
    const Type = process.platform === 'darwin' ? MacUpdater : process.platform === 'win32' ? NsisUpdater : AppImageUpdater;
    native = new Type({ provider: 'generic', url: settings.feedUrl });
    native.autoDownload = false;
    native.autoInstallOnAppQuit = false;
    native.allowDowngrade = false;
    native.allowPrerelease = false;
    native.disableWebInstaller = true;
    native.on('error', () => {}); // operation promises expose sanitized errors in the UI
    native.on('download-progress', info => progressCallback?.(info.percent));
  }
  const send = (channel, payload) => { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send(`frondose-desktop:${channel}`, payload); };
  async function rendererSafety() {
    const browser = getBrowserHost();
    const pages = browser?.updatePages?.() ?? (browser?.count() ? [{ kind: 'browser-page', count: browser.count() }] : []);
    const window = getWindow();
    if (!window || window.isDestroyed() || window.webContents.isLoading()) return [...pages, { kind: 'window-loading' }];
    if (safetyRequest) throw Error('An update safety check is already in progress.');
    return new Promise(resolve => {
      const nonce = randomUUID();
      const timeout = setTimeout(() => { safetyRequest = null; resolve([...pages, { kind: 'window-unresponsive' }]); }, 4000);
      safetyRequest = { nonce, finish(payload) {
        clearTimeout(timeout); safetyRequest = null;
        const items = cleanBlockers(payload.blockers, rendererKinds);
        resolve(payload.safe === true ? pages : [...pages, ...(items.length ? items : [{ kind: 'draft-check' }])]);
      } };
      send('update-safety', { nonce });
    });
  }
  async function request(action, body = {}) {
    const window = getWindow();
    if (!window || window.isDestroyed()) throw Error('The workspace window is unavailable.');
    const read = action === 'status';
    const response = await window.webContents.session.fetch(`${origin}/api/desktop-updates/${action}`, { method: read ? 'GET' : 'POST', credentials: 'include', headers: { 'content-type': 'application/json', origin }, ...(read ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    const result = await response.json();
    if (!response.ok || !result.result) throw Error('The local server could not confirm update safety. Keep working, then restart it safely before installing.');
    return result.result;
  }
  async function prepare() {
    if (!ownsServer()) throw blocked([{ kind: 'separate-server' }]);
    const local = await rendererSafety();
    if (local.length) throw blocked([...local, ...leaseBlockers(await request('status').catch(() => ({})))]);
    const lease = await request('prepare');
    if (!lease.allowed) throw blocked(leaseBlockers(lease));
    let alive = true, failure = null, renewBusy = false;
    async function renew() {
      const result = await request('renew', { token: lease.token });
      if (!result.allowed) throw blocked(leaseBlockers(result));
    }
    const heartbeat = setInterval(async () => {
      if (!alive || renewBusy) return;
      renewBusy = true;
      try { await renew(); } catch (error) { failure = error; }
      finally { renewBusy = false; }
    }, 10000); heartbeat.unref?.();
    return {
      async recheck() { if (!alive || failure) throw failure || Error('The update safety check expired.'); const items = await rendererSafety(); if (items.length) throw blocked(items); await renew(); },
      async release() { if (!alive) return; alive = false; clearInterval(heartbeat); await request('release', { token: lease.token }).catch(() => {}); },
    };
  }
  // A signed-feed configuration never falls back to an owner-staged build.
  const local = validConfig && !settings.feedUrl ? await createLocalAdapter({ app, origin }) : null;
  configured ||= Boolean(local);
  const storage = createUpdateStorage(app.getPath('userData'));
  const service = createDesktopUpdateService({ configured, reason, version: app.getVersion(), ...storage, prepare, adapter: native ? {
    async check() { const result = await native.checkForUpdates(); return result?.isUpdateAvailable ? result.updateInfo : null; },
    async download(callback) { progressCallback = callback; try { await native.downloadUpdate(); } finally { progressCallback = null; } },
    install() { return new Promise((_resolve, reject) => { native.once('error', reject); try { native.quitAndInstall(false, true); } catch (error) { reject(error); } }); },
  } : local });
  const targets = () => [...terminalTargets(), ...(getBrowserHost()?.updaterBlankPageTargets?.() || [])];
  const cleanup = createUpdateCleanup({ targets });
  let cleanupBusy = false;
  const state = () => {
    const snapshot = service.snapshot();
    return { ...snapshot, platform: process.platform, native: true, downloadsAvailable: Boolean(settings.downloadsUrl), canCleanup: snapshot.phase === 'blocked' && ownsServer() && targets().length > 0 };
  };
  service.onState(value => { lastState = value; send('update-state', state()); });
  await service.init();
  const resumed = () => { void service.tick({ resumed: true }); };
  powerMonitor.on('resume', resumed);
  let localFingerprint, polling = false;
  async function pollLocal() {
    if (!local || polling || !['idle', 'available', 'error'].includes(lastState?.phase || service.snapshot().phase)) return;
    polling = true;
    try {
      const fingerprint = await local.fingerprint();
      if (fingerprint !== localFingerprint) { localFingerprint = fingerprint; await service.check(); }
    } finally { polling = false; }
  }
  timer = setInterval(() => { void service.tick(); void pollLocal(); }, local ? 3000 : 15000); timer.unref?.();
  return {
    state,
    async command(payload) {
      if (payload?.operation === 'status') return state();
      if (cleanupBusy) throw Error('Wait for the reviewed cleanup to finish.');
      if (payload?.operation === 'cleanup-cancel') { cleanup.clear(); return { cancelled: true }; }
      if (['cleanup-preview', 'cleanup-confirm'].includes(payload?.operation)) {
        const permitted = () => ownsServer() && service.canReviewCleanup(payload.version);
        if (!permitted()) throw Error('Review a blocked update before closing any items.');
        cleanupBusy = true;
        try {
          await request('status'); // Revalidate the unlocked local owner, without acquiring an install lease.
          if (!permitted()) throw Error('The update changed. Review it again.');
          if (payload.operation === 'cleanup-preview') return cleanup.preview(payload.version);
          const result = await cleanup.confirm(payload.version, payload.token);
          const [local, server] = await Promise.all([rendererSafety().catch(() => null), request('status').catch(() => null)]);
          if (local && server) service.reportBlockers([...local, ...leaseBlockers(server)]);
          return { result, state: state() };
        } finally { cleanupBusy = false; }
      }
      if (payload?.operation === 'check') { cleanup.clear(); await service.check(); return state(); }
      if (payload?.operation === 'choose') { cleanup.clear(); await service.choose(payload.choice, payload.version); return state(); }
      if (payload?.operation === 'downloads' && settings.downloadsUrl) return { url: settings.downloadsUrl };
      throw Error('Unsupported update operation.');
    },
    safety(payload) { if (safetyRequest && payload?.nonce === safetyRequest.nonce) safetyRequest.finish(payload); return { received: true }; },
    critical() { return ['preparing', 'installing'].includes(lastState?.phase); },
    start() { send('update-state', state()); if (local) void pollLocal(); else if (configured) void service.check(); },
    close() { cleanup.clear(); clearInterval(timer); powerMonitor.removeListener('resume', resumed); service.close(); },
  };
}
module.exports = { createNativeUpdater };

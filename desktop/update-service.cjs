'use strict';
const { EventEmitter } = require('node:events');
const { cleanBlockers } = require('./update-blockers.cjs');

function releaseUrl(value) {
  if (value == null) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || /^(localhost|127\.|\[?::1)/i.test(url.hostname)) throw Error('Release URLs must be public HTTPS addresses without credentials, queries or fragments.');
  return url.href;
}
function releaseConfiguration(value = {}) {
  return { feedUrl: releaseUrl(value.feedUrl), downloadsUrl: releaseUrl(value.downloadsUrl), macTeamId: /^[A-Z0-9]{10}$/.test(value.macTeamId || '') ? value.macTeamId : null, windowsPublisherName: typeof value.windowsPublisherName === 'string' && value.windowsPublisherName.trim().length <= 160 ? value.windowsPublisherName.trim() || null : null };
}
function nextTonight(now = Date.now()) {
  const date = new Date(now);
  if (date.getHours() >= 22) { date.setDate(date.getDate() + 1); date.setHours(2, 0, 0, 0); }
  else { date.setHours(22, 0, 0, 0); }
  return date.getTime();
}
function publicRelease(info) {
  if (!info || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(info.version || '')) throw Error('The update feed returned an invalid version.');
  const notes = Array.isArray(info.releaseNotes) ? info.releaseNotes.map(item => String(item.note || '')).join('\n\n') : String(info.releaseNotes || '');
  return { version: info.version, name: String(info.releaseName || `Frondose ${info.version}`).slice(0, 180), notes: notes.slice(0, 24000).replace(/<[^>]*>/g, ''), releaseDate: Number.isFinite(Date.parse(info.releaseDate)) ? new Date(info.releaseDate).toISOString() : null };
}
function newerStableVersion(candidate, installed) {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(candidate) || candidate.length > 60) return false;
  const left = candidate.split('.').map(BigInt), right = installed.split('-')[0].split('.');
  if (right.length !== 3 || right.some(value => !/^\d+$/.test(value))) return false;
  for (let i = 0; i < 3; i++) { if (left[i] > BigInt(right[i])) return true; if (left[i] < BigInt(right[i])) return false; }
  return installed.includes('-');
}
function createDesktopUpdateService({ adapter, configured = false, reason = 'Release hosting is not configured for this build.', version = '0.0.0', load = async () => null, save = async () => {}, prepare = async () => { throw Error('Update safety checks are unavailable.'); }, now = Date.now } = {}) {
  const events = new EventEmitter();
  let state = { phase: configured ? 'idle' : 'unconfigured', currentVersion: version, reason: configured ? null : reason, release: null, progress: null, scheduledAt: null, dismissed: false, error: null, blockers: [] }, receipt = null, operation = null, closed = false, generation = 0, installSafety = null;
  const snapshot = () => structuredClone(state);
  const change = values => { if (!closed && Object.entries(values).some(([key, value]) => state[key] !== value)) { state = { ...state, ...values }; events.emit('state', snapshot()); } };
  const showBlocked = error => change({ phase: 'blocked', error: String(error.message || error).slice(0, 500), blockers: cleanBlockers(error.blockers) });
  const persist = async value => { await save(value); receipt = value; };
  const matches = () => state.release && receipt?.version === state.release.version;
  const run = action => {
    if (operation) return operation;
    operation = Promise.resolve().then(action).catch(async error => { const safety = installSafety; installSafety = null; await safety?.release?.(); change({ phase: 'error', error: String(error.message || error).slice(0, 500), progress: null }); return snapshot(); }).finally(() => { operation = null; });
    return operation;
  };
  async function init() {
    try {
      const saved = await load();
      if (saved && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(saved.version || '') && ['later', 'tonight'].includes(saved.choice)) receipt = { version: saved.version, choice: saved.choice, scheduledAt: Number.isFinite(saved.scheduledAt) ? saved.scheduledAt : null };
      // Never replay a missed or uncertain installation when starting the app.
      if (receipt?.choice === 'tonight' && receipt.scheduledAt <= now()) change({ reason: 'The scheduled time passed while Frondose was closed. Check for updates and choose again.' });
    } catch { configured = false; change({ phase: 'unconfigured', reason: 'Update preferences could not be read safely. No update will run.' }); }
    return snapshot();
  }
  async function check() {
    if (!configured || closed) return snapshot();
    return run(async () => {
      const epoch = ++generation;
      change({ phase: 'checking', error: null, blockers: [] });
      const info = await adapter.check();
      if (closed || epoch !== generation) return snapshot();
      if (!info) { change({ phase: 'idle', release: null, scheduledAt: null, progress: null }); return snapshot(); }
      const release = publicRelease(info);
      if (!newerStableVersion(release.version, version)) { change({ phase: 'idle', release: null, scheduledAt: null }); return snapshot(); }
      const same = receipt?.version === release.version, scheduled = same && receipt.choice === 'tonight';
      const missed = scheduled && receipt.scheduledAt <= now();
      change({ release, progress: null, phase: missed ? 'blocked' : scheduled ? 'scheduled' : 'available', scheduledAt: scheduled && !missed ? receipt.scheduledAt : null, dismissed: Boolean(same && (receipt.choice === 'later' || scheduled)), error: missed ? 'The scheduled time passed while Frondose was closed. Choose Install now when you are ready.' : null });
      return snapshot();
    });
  }
  async function install() {
    if (!configured || !state.release || closed) return snapshot();
    const selected = state.release.version;
    return run(async () => {
      // Scheduling is not consent to interrupt work. No stop/discard API exists.
      change({ phase: 'preparing', error: null, blockers: [], scheduledAt: null });
      let safety;
      try {
        safety = await prepare();
      } catch (error) { showBlocked(error); return snapshot(); }
      await safety.release(); safety = null;
      try {
        if (closed) return snapshot();
        const info = await adapter.check();
        if (!info || publicRelease(info).version !== selected) throw Error('The selected release changed. Check for updates and review it again.');
        if (closed) return snapshot();
        change({ phase: 'downloading', progress: 0 });
        await adapter.download(progress => { if (!closed) change({ progress: Math.min(100, Math.max(0, Number(progress) || 0)) }); });
        if (closed) return snapshot();
        // Fresh renderer/server checks after download, not a stale button proof.
        change({ phase: 'preparing' });
        try { safety = await prepare(); await safety.recheck(); }
        catch (error) { showBlocked(error); return snapshot(); }
        installSafety = safety;
        change({ phase: 'installing', progress: 100 });
        await adapter.install();
        return snapshot();
      } finally { if (state.phase !== 'installing') { installSafety = null; await safety?.release?.(); } }
    });
  }
  async function choose(choice, selectedVersion) {
    if (!configured || !state.release || selectedVersion !== state.release.version || operation || closed || state.phase === 'installing') return snapshot();
    if (!['later', 'tonight', 'now', 'cancel'].includes(choice)) throw Error('Choose a supported update action.');
    if (choice === 'now') return install();
    const scheduledAt = choice === 'tonight' ? nextTonight(now()) : null;
    return run(async () => {
      await persist({ version: selectedVersion, choice: choice === 'tonight' ? 'tonight' : 'later', scheduledAt });
      change({ phase: scheduledAt ? 'scheduled' : 'available', scheduledAt, dismissed: true, error: null, blockers: [] });
      return snapshot();
    });
  }
  async function tick({ resumed = false } = {}) {
    if (closed || operation || state.phase !== 'scheduled' || !matches() || now() < state.scheduledAt) return snapshot();
    if (resumed || now() - state.scheduledAt > 60000) { change({ phase: 'blocked', error: 'The scheduled time passed while the computer was unavailable. Choose Install now when you are ready.', scheduledAt: null }); return snapshot(); }
    return install();
  }
  return { init, check, choose, tick, snapshot, canReviewCleanup: version => !closed && !operation && state.phase === 'blocked' && state.release?.version === version, reportBlockers(items) { if (state.phase === 'blocked') change({ blockers: cleanBlockers(items), error: null }); }, onState(callback) { events.on('state', callback); return () => events.off('state', callback); }, close() { closed = true; generation++; adapter?.cancel?.(); Promise.resolve(installSafety?.release?.()).catch(() => {}); events.removeAllListeners(); } };
}
module.exports = { createDesktopUpdateService, releaseConfiguration, nextTonight, publicRelease, newerStableVersion };

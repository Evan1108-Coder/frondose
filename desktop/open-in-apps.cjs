'use strict';
// Orca-inspired preset catalog; native actions are Frondose-owned and root-bound.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { homedir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createUpdateStorage } = require('./update-storage.cjs');
const { vscodeWebSetup } = require('./editor-tab-setup.cjs');
const PRESETS = Object.freeze([
  { id: 'vscode', name: 'VS Code', kind: 'editor', mac: 'Visual Studio Code.app', command: 'code', win: ['Microsoft VS Code/Code.exe', 'Programs/Microsoft VS Code/Code.exe'] },
  { id: 'cursor', name: 'Cursor', kind: 'editor', mac: 'Cursor.app', command: 'cursor', win: ['Programs/cursor/Cursor.exe', 'cursor/Cursor.exe'] },
  { id: 'zed', name: 'Zed', kind: 'editor', mac: 'Zed.app', command: 'zed', win: ['Programs/Zed/zed.exe'] },
  { id: 'sublime', name: 'Sublime Text', kind: 'editor', mac: 'Sublime Text.app', command: 'subl', win: ['Sublime Text/sublime_text.exe'] },
  { id: 'github-desktop', name: 'GitHub Desktop', kind: 'desktop', mac: 'GitHub Desktop.app', command: 'github-desktop', win: ['GitHubDesktop/GitHubDesktop.exe'] },
  { id: 'parallels-desktop', name: 'Parallels Desktop', kind: 'desktop', mac: 'Parallels Desktop.app', command: 'prlctl' },
  { id: 'ghostty', name: 'Ghostty', kind: 'terminal', mac: 'Ghostty.app', command: 'ghostty' },
  { id: 'iterm', name: 'iTerm2', kind: 'terminal', mac: 'iTerm.app' },
  { id: 'terminal', name: 'Terminal', kind: 'terminal', mac: 'Utilities/Terminal.app', systemMac: '/System/Applications/Utilities/Terminal.app' },
  { id: 'windows-terminal', name: 'Windows Terminal', kind: 'terminal', command: 'wt.exe' },
  { id: 'gnome-terminal', name: 'GNOME Terminal', kind: 'terminal', command: 'gnome-terminal' },
  { id: 'konsole', name: 'Konsole', kind: 'terminal', command: 'konsole' },
  { id: 'kitty', name: 'Kitty', kind: 'terminal', mac: 'kitty.app', command: 'kitty' },
  { id: 'wezterm', name: 'WezTerm', kind: 'terminal', mac: 'WezTerm.app', command: 'wezterm' },
]);
const cleanLabel = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 60 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
const allowedId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
function launchPlan(app, cwd, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  if (!pathApi.isAbsolute(cwd) || /[\0\r\n]/.test(cwd) || !pathApi.isAbsolute(app.path) || /[\0\r\n]/.test(app.path)) throw Error('Invalid installed application or directory.');
  const args = app.id === 'ghostty' ? [`--working-directory=${cwd}`] : app.id === 'windows-terminal' ? ['-d', cwd] : app.id === 'gnome-terminal' ? [`--working-directory=${cwd}`] : app.id === 'konsole' ? ['--workdir', cwd] : app.id === 'kitty' ? ['--directory', cwd] : app.id === 'wezterm' ? ['start', '--cwd', cwd] : [cwd];
  if (platform === 'darwin' && app.path.endsWith('.app')) {
    if (['iterm', 'terminal'].includes(app.id) || app.custom) return { executable: '/usr/bin/open', args: ['-a', app.path, cwd], cwd };
    return { executable: '/usr/bin/open', args: ['-n', '-a', app.path, '--args', ...args], cwd };
  }
  return { executable: app.path, args, cwd };
}
async function createOpenInApps({ userData, platform = process.platform, env = process.env, home = homedir(), chooseApp, readDirectory, run = plan => new Promise((resolve, reject) => { const child = spawn(plan.executable, plan.args, { cwd: plan.cwd, shell: false, detached: true, stdio: 'ignore', windowsHide: false }); child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); }); }), storage = createUpdateStorage(path.join(userData, 'desktop-tools')) } = {}) {
  let selected = [], known = new Map(), busy = false;
  const pathApi = platform === 'win32' ? path.win32 : path;
  async function check(candidate) {
    if (typeof candidate !== 'string' || candidate.length > 1024 || !pathApi.isAbsolute(candidate) || /[\0\r\n]/.test(candidate)) return null;
    try { const canonical = await fs.realpath(candidate), info = await fs.stat(canonical, { bigint: true }); if (platform === 'darwin' && canonical.endsWith('.app') ? !info.isDirectory() : !info.isFile()) return null; if (!(platform === 'darwin' && canonical.endsWith('.app'))) await fs.access(canonical, platform === 'win32' ? constants.F_OK : constants.X_OK); return { path: canonical, fingerprint: `${info.dev}:${info.ino}:${info.mtimeNs}:${info.size}` }; } catch { return null; }
  }
  async function discover() {
    const inventory = new Map();
    for (const preset of PRESETS) {
      if (platform === 'darwin' && !preset.mac || platform !== 'darwin' && !preset.command || platform !== 'win32' && preset.id === 'windows-terminal') continue;
      const candidates = platform === 'darwin' ? [preset.systemMac, path.join('/Applications', preset.mac), path.join(home, 'Applications', preset.mac)] : platform === 'win32' ? [...(preset.win || []).flatMap(relative => [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean).map(base => pathApi.join(base, relative))), ...(env.PATH || '').split(';').filter(Boolean).map(base => pathApi.join(base, preset.command))] : [...new Set([...(env.PATH || '').split(':'), '/usr/bin', '/usr/local/bin', '/snap/bin'].filter(Boolean))].map(base => pathApi.join(base, preset.command));
      for (const candidate of candidates.filter(Boolean)) { const found = await check(candidate); if (found) { inventory.set(preset.id, { id: preset.id, name: preset.name, kind: preset.kind, ...found }); break; } }
    }
    for (const entry of selected.filter(entry => entry.custom)) { const found = await check(entry.path); if (found && found.fingerprint === entry.fingerprint) inventory.set(entry.id, { ...entry, ...found, kind: 'editor' }); }
    known = inventory;
    return state();
  }
  const state = () => ({ selected: selected.map(entry => ({ id: entry.id, name: entry.name, custom: entry.custom === true, available: known.has(entry.id) })), installed: [...known.values()].map(({ id, name, kind, custom }) => ({ id, name, kind, custom: custom === true })), maxApps: 8 });
  const saved = await storage.load();
  if (saved !== null && (!Array.isArray(saved.apps) || saved.apps.length > 8)) throw Error('Open in Apps preferences are invalid.');
  selected = (saved?.apps || []).filter(entry => entry && allowedId(entry.id) && cleanLabel(entry.name) && (PRESETS.some(item => item.id === entry.id && item.kind === 'editor') || entry.custom === true && typeof entry.path === 'string' && entry.path.length <= 1024 && typeof entry.fingerprint === 'string')).map(entry => ({ ...entry, name: cleanLabel(entry.name) }));
  if (new Set(selected.map(entry => entry.id)).size !== selected.length) throw Error('Duplicate saved application identity.');
  await discover();
  if (saved === null) { selected = [...known.values()].filter(item => item.kind === 'editor').map(({ id, name }) => ({ id, name })); await storage.save({ apps: selected }); }
  async function command(payload) {
    if (busy) throw Error('Another Open in Apps action is still in progress.');
    busy = true;
    try {
      if (payload?.operation === 'list') return await discover();
      if (payload?.operation === 'add') {
        if (selected.length >= 8) throw Error('You can save up to eight applications.');
        const preset = PRESETS.find(item => item.id === payload.id && item.kind === 'editor'); let entry;
        if (preset) { await discover(); if (!known.has(preset.id) || selected.some(item => item.id === preset.id)) throw Error('Choose a newly detected application.'); entry = { id: preset.id, name: preset.name }; }
        else { const chosen = await chooseApp(); if (!chosen) return state(); const found = await check(chosen); if (!found) throw Error('Choose an installed application or executable.'); entry = { id: `custom_${randomUUID()}`, name: path.basename(found.path).replace(/\.app$/i, ''), custom: true, ...found }; if (!cleanLabel(entry.name)) throw Error('Application name is invalid.'); }
        const next = [...selected, entry]; await storage.save({ apps: next }); selected = next; return await discover();
      }
      if (['rename', 'remove'].includes(payload?.operation)) {
        if (!selected.some(item => item.id === payload.id)) throw Error('This application is not in your saved list.');
        if (payload.operation === 'rename' && !cleanLabel(payload.name)) throw Error('Enter an application name under 60 characters.');
        const next = payload.operation === 'remove' ? selected.filter(item => item.id !== payload.id) : selected.map(item => item.id === payload.id ? { ...item, name: cleanLabel(payload.name) } : item);
        await storage.save({ apps: next }); selected = next; return state();
      }
      if (['open', 'web-setup'].includes(payload?.operation)) {
        if (!allowedId(payload.workspaceId)) throw Error('Choose a valid workspace.');
        await discover(); const app = known.get(payload.id);
        if (!app || (payload.operation === 'web-setup' ? app.id !== 'vscode' : app.kind !== 'terminal' && !selected.some(item => item.id === app.id))) throw Error('This application is not available. Refresh detection.');
        const directory = await readDirectory(payload.workspaceId);
        if (directory.workspaceId !== payload.workspaceId || directory.binding && !directory.ready) throw Error('The workspace directory is unavailable. Nothing was opened.');
        const expected = directory.binding?.version ?? null;
        if ((payload.expectedBindingVersion ?? null) !== expected) throw Error('The workspace directory changed. Refresh before opening an application.');
        const cwd = await fs.realpath(directory.binding?.path || home); if (!(await fs.stat(cwd)).isDirectory()) throw Error('Choose an available workspace directory.');
        const current = await check(app.path); if (!current || current.fingerprint !== app.fingerprint) throw Error('The application changed. Refresh detection before opening it.');
        const fresh = await readDirectory(payload.workspaceId);
        if (JSON.stringify([fresh.binding?.version ?? null, fresh.binding?.path ?? null, fresh.ready]) !== JSON.stringify([directory.binding?.version ?? null, directory.binding?.path ?? null, directory.ready])) throw Error('The workspace directory changed. Nothing was opened.');
        if (payload.operation === 'web-setup') return { setup: await vscodeWebSetup({ application: app, directory: cwd, platform }) };
        await run(launchPlan(app, cwd, platform)); return { opened: true, application: app.name, external: true };
      }
      throw Error('Unsupported Open in Apps operation.');
    } finally { busy = false; }
  }
  return { command, state };
}
module.exports = { PRESETS, launchPlan, createOpenInApps };

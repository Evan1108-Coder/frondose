'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createUpdateStorage } = require('./update-storage.cjs');
function shellCommand(executable, platform = process.platform) {
  const api = platform === 'win32' ? path.win32 : path;
  if (typeof executable !== 'string' || executable.length > 1024 || !api.isAbsolute(executable) || /[\0\r\n]/.test(executable)) throw Error('Choose an absolute installed shell executable.');
  if (platform === 'win32') { if (!/\.exe$/i.test(executable) || /["%!?^&|<>()]/.test(executable)) throw Error('This Windows executable path cannot be safely passed through the terminal host. Choose a path without command metacharacters.'); return `"${executable}"`; }
  return `exec '${executable.replaceAll("'", "'\\''")}'`;
}
async function createTerminalShell({ userData, chooseShell, platform = process.platform, systemShell = process.platform === 'win32' ? null : process.env.SHELL || os.userInfo().shell || '/bin/bash', storage = createUpdateStorage(path.join(userData, 'terminal-shell')) }) {
  let choice = await storage.load(), busy = false;
  const publicState = () => ({ mode: choice?.mode === 'custom' ? 'custom' : 'system', name: choice?.mode === 'custom' ? choice.name : systemShell || 'System shell', systemShell: systemShell || 'System shell' });
  async function inspect(executable) { const canonical = await fs.realpath(executable), info = await fs.stat(canonical, { bigint: true }); if (!info.isFile()) throw Error('Choose a shell executable, not a folder or application bundle.'); await fs.access(canonical, platform === 'win32' ? constants.F_OK : constants.X_OK); shellCommand(canonical, platform); return { path: canonical, fingerprint: `${info.dev}:${info.ino}:${info.mtimeNs}:${info.size}` }; }
  async function command(payload) {
    if (busy) throw Error('Another shell selection is in progress.'); busy = true;
    try {
      if (payload?.operation === 'status') return publicState();
      if (payload?.operation === 'system') { await storage.save({ mode: 'system' }); choice = { mode: 'system' }; return publicState(); }
      if (payload?.operation === 'choose') { const selected = await chooseShell(); if (!selected) return publicState(); const found = await inspect(selected), next = { mode: 'custom', name: path.basename(found.path), ...found }; await storage.save(next); choice = next; return publicState(); }
      if (payload?.operation === 'plan') {
        if (choice?.mode !== 'custom' && platform === 'win32') return { command: null };
        const found = await inspect(choice?.mode === 'custom' ? choice.path : systemShell);
        if (choice?.mode === 'custom' && choice.fingerprint !== found.fingerprint) throw Error('The selected shell changed. Choose it again in Terminal settings before launching.');
        return { command: shellCommand(found.path, platform) };
      }
      throw Error('Unsupported shell selection operation.');
    } finally { busy = false; }
  }
  return { command };
}
module.exports = { shellCommand, createTerminalShell };

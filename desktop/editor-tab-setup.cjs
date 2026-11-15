'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const quote = (value, platform) => platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\"'\"'")}'`;
function setupCommand(executable, directory, platform = process.platform) {
  const api = platform === 'win32' ? path.win32 : path;
  if (!api.isAbsolute(executable) || !api.isAbsolute(directory) || /[\0\r\n]/.test(executable + directory)) throw Error('Choose a valid installed CLI and workspace directory.');
  const args = ['serve-web', '--host', '127.0.0.1', '--port', '0', '--disable-telemetry', '--default-folder', directory];
  return `${platform === 'win32' ? '& ' : ''}${[executable, ...args].map(value => quote(value, platform)).join(' ')}`;
}
async function nativeEditorRunning(application, platform = process.platform, run = exec) {
  try {
    if (platform === 'win32') {
      const { stdout } = await run('tasklist.exe', ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq Code.exe'], { timeout: 3000, maxBuffer: 1024 * 1024, windowsHide: true });
      return /^"Code\.exe",/im.test(stdout);
    }
    const { stdout } = await run('/bin/ps', ['-axo', 'args='], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
    return stdout.split('\n').some(line => platform === 'darwin' ? line.trim().startsWith(application.path + '/Contents/MacOS/') : /^(?:\/[^\s]+\/)?code(?:\s|$)/.test(line.trim()));
  } catch { return null; }
}
async function vscodeWebSetup({ application, directory, platform = process.platform, running = nativeEditorRunning }) {
  if (!application || application.id !== 'vscode') throw Error('VS Code is not installed or was removed. Refresh application detection.');
  const active = await running(application, platform);
  if (active === true) throw Error('VS Code is already open outside Frondose. Close that app before setting up its tab here. Nothing was closed automatically.');
  if (active === null) throw Error('The running-app check was unavailable. Retry before setting up VS Code Web.');
  const api = platform === 'win32' ? path.win32 : path;
  const candidates = platform === 'darwin' ? [api.join(application.path, 'Contents/Resources/app/bin/code-tunnel')] : platform === 'win32' ? [api.join(api.dirname(application.path), 'bin/code-tunnel.exe')] : [api.join(api.dirname(application.path), 'code-tunnel')];
  for (const candidate of candidates) {
    try {
      const executable = await fs.realpath(candidate), info = await fs.stat(executable);
      if (!info.isFile()) continue;
      await fs.access(executable, platform === 'win32' ? constants.F_OK : constants.X_OK);
      return { command: setupCommand(executable, directory, platform), platform, directory, startsAutomatically: false, licenseAccepted: false };
    } catch { /* An installed desktop app may not include the web CLI. */ }
  }
  throw Error('This installation does not expose the VS Code web CLI. Update VS Code or use Frondose’s built-in editor.');
}
module.exports = { setupCommand, nativeEditorRunning, vscodeWebSetup };

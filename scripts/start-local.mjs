import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as createPortProbe } from 'node:net';
import { createFrondoseServer } from '../server/start.mjs';

export function localPort(value = 4174) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 65535) throw Error('Choose a local port between 1 and 65535.');
  return Number(value);
}
export function browserCommand(platform, port) {
  const url = `http://127.0.0.1:${localPort(port)}`;
  if (platform === 'darwin') return ['/usr/bin/open', [url]];
  if (platform === 'win32') return ['cmd.exe', ['/d', '/c', 'start', '', url]];
  if (platform === 'linux') return ['xdg-open', [url]];
  throw Error('Automatic browser opening supports macOS, Windows and Linux.');
}
function openBrowser(port) {
  const [command, args] = browserCommand(process.platform, port);
  const child = spawn(command, args, { stdio: 'ignore', shell: false, windowsHide: true });
  child.once('error', () => console.error(`Open http://127.0.0.1:${port} in your browser. The local server is still running.`));
  child.unref();
}
export async function launchLocal({ port = process.env.PORT || 4174, env = process.env, open = false, clientDirectory, apiOptions } = {}) {
  port = localPort(port);
  if (['public'].includes(env.FRONDOSE_DEPLOYMENT_MODE || env.TALVORI_DEPLOYMENT_MODE || env.RUMBO_DEPLOYMENT_MODE)) throw Error('The local launcher does not enable public hosting.');
  // Do not initialize/recover the database when another app owns the port.
  // Normal startup still handles a race where a process binds after this probe.
  await new Promise((yes, no) => {
    const probe = createPortProbe();
    probe.once('error', error => no(error.code === 'EADDRINUSE' ? Error(`Port ${port} is already in use. Frondose did not open its database or replace that process.`) : error));
    probe.listen(port, '127.0.0.1', () => probe.close(yes));
  });
  const instance = createFrondoseServer({ env, clientDirectory, apiOptions });
  try { await new Promise((yes, no) => { instance.server.once('error', no); instance.server.listen(port, '127.0.0.1', yes); }); }
  catch (error) { instance.api.close(); if (error.code === 'EADDRINUSE') throw Error(`Port ${port} is already in use. Frondose did not stop or replace that process.`); throw error; }
  if (open) openBrowser(port);
  return { ...instance, url: `http://127.0.0.1:${port}` };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--open')) throw Error('Usage: npm run local -- [--open]. PORT optionally selects another local port.');
  const { server, url } = await launchLocal({ open: args.includes('--open') });
  console.log(`Frondose local edition: ${url}. Keep this process running; no cloud account or member setup is required.`);
  const close = () => { server.close(); setTimeout(() => process.exit(1), 5000).unref(); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
}

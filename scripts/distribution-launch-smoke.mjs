// Launch the exact installed/extracted distribution with its own local server
// and a fresh profile. The test-only debugger is bound to this CI runner.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.env.GITHUB_ACTIONS !== 'true') throw Error('Run this distribution check only on an isolated GitHub Actions runner.');
const [label, executableArg] = process.argv.slice(2);
if (!/^(windows-installer|windows-zip|linux-appimage|linux-deb)$/.test(label ?? '') || !executableArg) {
  throw Error('Expected a distribution label and an installed/extracted executable path.');
}

function selectPort() {
  return new Promise((yes, no) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? no(error) : yes(port));
    });
    server.once('error', no);
  });
}

async function inspect(target, expectedPort) {
  const url = new URL(target.webSocketDebuggerUrl);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.port !== String(expectedPort)) {
    throw Error('Unexpected Chromium debugger URL.');
  }
  const socket = new WebSocket(url);
  try {
    await new Promise((yes, no) => {
      const timeout = setTimeout(() => no(Error('Electron debugger connection timed out.')), 2500);
      socket.addEventListener('open', () => { clearTimeout(timeout); yes(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); no(Error('Electron debugger connection failed.')); }, { once: true });
    });
    function command(method, params = {}) {
      return new Promise((yes, no) => {
        // Commands are sequential, and each uses a unique method as its tag.
        const id = method === 'Runtime.evaluate' ? 1 : 2;
        const timer = setTimeout(() => { socket.removeEventListener('message', receive); no(Error(method + ' timed out.')); }, 5000);
        function receive(message) {
          const reply = JSON.parse(message.data);
          if (reply.id !== id) return;
          clearTimeout(timer);
          socket.removeEventListener('message', receive);
          if (reply.error) no(Error(method + ': ' + reply.error.message));
          else yes(reply.result);
        }
        socket.addEventListener('message', receive);
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    const response = await command('Runtime.evaluate', {
      expression: '({ title: document.title, ready: document.readyState === "complete", rendered: !!document.querySelector("#root")?.innerText.trim(), desktop: !!window.frondoseDesktop, visible: document.visibilityState === "visible" })',
      returnByValue: true,
    });
    const state = response?.result?.value;
    if (!(state?.ready && state.rendered && state.desktop && state.visible && /frondose/i.test(state.title))) return null;
    const image = await command('Page.captureScreenshot', { format: 'png' });
    return { title: state.title, bytes: Buffer.from(image.data, 'base64') };
  } finally {
    socket.close();
  }
}

const executable = await realpath(executableArg);
const [port, debuggingPort] = await Promise.all([selectPort(), selectPort()]);
const origin = 'http://127.0.0.1:' + port;
const debuggerOrigin = 'http://127.0.0.1:' + debuggingPort;
const work = await mkdtemp(join(tmpdir(), 'frondose-distribution-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|FRONDOSE_DESKTOP_SMOKE|GH_TOKEN|GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN)$/i.test(key)
));
Object.assign(env, {
  FRONDOSE_DESKTOP_URL: origin,
  FRONDOSE_DESKTOP_USER_DATA: join(work, 'profile'),
  FRONDOSE_DATA_DIR: join(work, 'workspace-store'),
  FRONDOSE_DESKTOP_NO_ACCOUNT_READS: '1',
});
let child;
try {
  child = spawn(executable, ['--remote-debugging-port=' + debuggingPort, '--remote-debugging-address=127.0.0.1'], {
    cwd: work, env, windowsHide: false, detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', launchError;
  child.once('error', error => { launchError = error; });
  child.stdout.on('data', data => { output = (output + data).slice(-14000); });
  child.stderr.on('data', data => { output = (output + data).slice(-14000); });
  const deadline = Date.now() + 120000;
  let lastError = '';
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw Error('Packaged app exited early (' + (child.exitCode ?? child.signalCode) + '):\n' + output);
    }
    try {
      const json = async (url) => {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (!response.ok) throw Error('HTTP ' + response.status + ': ' + url);
        return response.json();
      };
      const [health, targets] = await Promise.all([json(origin + '/api/health'), json(debuggerOrigin + '/json/list')]);
      if (health.product?.edition !== 'local' || health.product?.singleOwner !== true) throw Error('Unexpected local host health.');
      const page = targets.find(target => target.type === 'page' && target.url.startsWith(origin + '/'));
      if (page && output.includes('Frondose desktop ready: ' + origin)) {
        const proof = await inspect(page, debuggingPort);
        if (proof) {
          const result = resolve('distribution-proof', label + '.png');
          await mkdir(dirname(result), { recursive: true });
          await writeFile(result, proof.bytes);
          console.log('FRONDOSE_DISTRIBUTION_OK ' + label + ': ' + executable + ' displayed "' + proof.title + '" with the real local host and desktop bridge.');
          break;
        }
      }
    } catch (error) { lastError = error.message; }
    await delay(400);
  }
  if (Date.now() >= deadline) throw Error('Frondose did not display its desktop UI: ' + lastError + '\n' + output);
} finally {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10000 });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    for (let remaining = 40; remaining > 0 && child.exitCode === null && child.signalCode === null; remaining--) {
      await delay(100);
    }
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  await rm(work, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}

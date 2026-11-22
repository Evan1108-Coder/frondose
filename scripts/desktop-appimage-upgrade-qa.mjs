// Disposable runner only. Both builds use the real AppImage updater and TLS;
// the app is never relaunched manually by the harness.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:https';
import { createServer as portProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.platform, 'linux');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
const [oldDir, newDir, cert, key] = process.argv.slice(2).map(p => resolve(p));
const temp = await mkdtemp(join(tmpdir(), 'frondose-upgrade-'));
const installed = join(temp, 'Frondose.AppImage');
let activeDir = oldDir;
let launcher, relaunchedPid;
let launchLog = '';
const listener = createServer({ cert: await readFile(cert), key: await readFile(key) }, async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'https://updates.frondose.test').pathname.slice(1));
    if (!/^(latest-linux\.yml|Frondose[-.A-Za-z0-9_]+\.AppImage)$/.test(name)) return res.writeHead(404).end();
    const path = join(activeDir, name);
    const info = await stat(path);
    res.writeHead(200, { 'content-length': info.size, 'cache-control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(path).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404).end(); }
});
const choosePort = () => new Promise((yes, no) => {
  const s = portProbe().listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => yes(port)); });
  s.once('error', no);
});
const [port, debugPort] = await Promise.all([choosePort(), choosePort()]);
const origin = 'http://127.0.0.1:' + port;
const versionBefore = '0.90.1', versionAfter = '0.90.2';
const marker = 'Update QA ' + basename(temp);

async function until(name, predicate, timeoutMs = 60000) {
  let fault;
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await delay(400)) {
    try { const result = await predicate(); if (result) return result; } catch (error) { fault = error; }
  }
  throw Error('Timed out: ' + name + (fault ? ' (' + fault.message + ')' : ''));
}
async function json(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw Error('HTTP ' + response.status + ' from ' + url);
  return response.json();
}
async function debuggerSession() {
  const targets = await json('http://127.0.0.1:' + debugPort + '/json/list');
  const page = targets.find(x => x.type === 'page' && x.url.startsWith(origin + '/'));
  if (!page) return null;
  const endpoint = new URL(page.webSocketDebuggerUrl);
  assert.equal(endpoint.host, '127.0.0.1:' + debugPort);
  const socket = new WebSocket(endpoint);
  let id = 0;
  await new Promise((yes, no) => {
    const timer = setTimeout(() => { socket.close(); no(Error('Debugger open timed out')); }, 3000);
    socket.addEventListener('open', () => { clearTimeout(timer); yes(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); no(Error('Debugger connection failed')); }, { once: true });
  });
  function command(method, params) {
    return new Promise((yes, no) => {
      const seq = ++id;
      function receive(event) {
        const frame = JSON.parse(event.data);
        if (frame.id !== seq) return;
        clearTimeout(timer);
        socket.removeEventListener('message', receive);
        if (frame.error) no(Error(frame.error.message)); else yes(frame.result);
      }
      const timer = setTimeout(() => { socket.removeEventListener('message', receive); no(Error('Debugger command timed out')); }, 20000);
      socket.addEventListener('message', receive);
      socket.send(JSON.stringify({ id: seq, method, params }));
    });
  }
  const evalInApp = async expression => {
    const answer = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (answer.exceptionDetails) throw Error('Renderer test expression failed');
    return answer.result.value;
  };
  return { command, evalInApp, close: () => socket.close() };
}
async function appImage(dir) {
  const matches = (await readdir(dir)).filter(x => x.endsWith('.AppImage'));
  assert.equal(matches.length, 1);
  return join(dir, matches[0]);
}
async function digest(file) {
  const hash = createHash('sha512');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
const listeningProcess = () => Number(execFileSync('lsof', ['-t', '-sTCP:LISTEN', '-iTCP:' + port], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
function visibleWindow(pid) {
  return execFileSync('xdotool', ['search', '--onlyvisible', '--all', '--pid', String(pid), '--name', 'Frondose'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

let renderer;
try {
  const before = await appImage(oldDir);
  const after = await appImage(newDir);
  const expectedHash = await digest(after);
  await copyFile(before, installed);
  await chmod(installed, 0o700);
  assert.notEqual(await digest(installed), expectedHash);
  await new Promise((yes, no) => { listener.once('error', no); listener.listen(18443, '127.0.0.1', yes); });
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(ELECTRON_RUN_AS_NODE|FRONDOSE_DESKTOP_SMOKE|APPIMAGE_EXTRACT_AND_RUN|APPIMAGE|APPDIR)$/i.test(name)));
  launcher = spawn(installed, ['--remote-debugging-port=' + debugPort, '--remote-debugging-address=127.0.0.1'], {
    cwd: temp, env: { ...env, FRONDOSE_DESKTOP_USER_DATA: join(temp, 'profile'), FRONDOSE_DATA_DIR: join(temp, 'workspace'), FRONDOSE_DESKTOP_URL: origin, FRONDOSE_DESKTOP_NO_ACCOUNT_READS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  launcher.stdout.on('data', bytes => { launchLog = (launchLog + bytes).slice(-16000); });
  launcher.stderr.on('data', bytes => { launchLog = (launchLog + bytes).slice(-16000); });
  await until('installed app starts its own server', () => json(origin + '/api/health'));
  const oldPid = listeningProcess();
  const created = await json(origin + '/api/workspaces', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: marker }),
  });
  const workspaceId = created.workspace.id;
  await json(origin + '/api/projects', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: marker, workspace_id: workspaceId }) });
  await until('native window completed its initial navigation', () =>
    launchLog.includes('Frondose desktop ready: ' + origin));
  renderer = await until('Frondose renderer debugger', debuggerSession);
  await until('initial document finishes loading', () => renderer.evalInApp('document.readyState === "complete" && Boolean(document.querySelector("#root")?.innerText.trim())'));
  // The fresh renderer may have loaded before the fixture workspace was
  // created; reload it so the test uses the real, populated workspace UI.
  if (!await renderer.evalInApp('Boolean(document.querySelector(".native-update-ui"))')) await renderer.command('Page.reload', {});
  const status = 'window.frondoseDesktop?.updates?.command({operation:"status"})';
  await until('old version and workspace UI', async () => {
    const v = await renderer.evalInApp(status);
    return v?.currentVersion === versionBefore &&
      await renderer.evalInApp('Boolean(document.querySelector(".native-update-ui"))');
  });
  // A synthetic first-use workspace can have the onboarding modal open. Close
  // it using its normal control; never bypass the updater's safety checks.
  await renderer.evalInApp(String.raw`
    (() => {
      const welcome = document.querySelector('.workspace-welcome-dialog');
      const skip = [...(welcome?.querySelectorAll('button') || [])].find(x => x.textContent.trim() === 'Skip setup');
      if (skip && !skip.disabled) skip.click();
      return Boolean(skip);
    })()
  `);
  await until('onboarding dialog closed', () => renderer.evalInApp('!document.querySelector(".workspace-welcome-dialog")'));
  activeDir = newDir;
  await renderer.evalInApp('window.frondoseDesktop.updates.command({operation:"check"})');
  await until('bottom-right update popup', () => renderer.evalInApp(String.raw`
    (() => {
      const popup = document.querySelector('.native-update-prompt:not([inert])');
      const button = [...(popup?.querySelectorAll('button') || [])].find(x => x.textContent.trim() === 'Update');
      if (!button || button.disabled || !popup.innerText.includes('0.90.2')) return false;
      const rect = popup.getBoundingClientRect();
      if (rect.right < innerWidth - 80 || rect.bottom < innerHeight - 100 || rect.width < 1) return false;
      return true;
    })()
  `));
  console.log('Verified the actual Update button in the bottom-right popup.');
  await renderer.evalInApp(String.raw`
    (() => {
      const popup = document.querySelector('.native-update-prompt:not([inert])');
      const button = [...(popup?.querySelectorAll('button') || [])].find(x => x.textContent.trim() === 'Update');
      if (!button || button.disabled) throw Error('Update button is no longer actionable');
      button.click();
      return true;
    })()
  `);
  const clickResult = await until('native updater handles the button click', async () => {
    const v = await renderer.evalInApp(status);
    return v && !['idle', 'available', 'checking'].includes(v.phase) && v;
  }, 15000);
  console.log('After click: ' + clickResult.phase);
  if (['blocked', 'error'].includes(clickResult.phase)) throw Error(JSON.stringify(clickResult));
  // Fast failures (such as a local safety guard) should say why, instead of
  // waiting for a new PID that won't be created.
  try {
    const installState = await until('download and install', async () => {
      const v = await renderer.evalInApp(status);
      return v && ['installing', 'blocked', 'error'].includes(v.phase) && v;
    }, 45000);
    if (installState.phase !== 'installing') throw Error(JSON.stringify(installState));
  } catch (error) {
    if (launcher.exitCode === null && launchLog.includes('Downloading update') === false ||
        /"phase":"(?:error|blocked)"/.test(error.message)) throw error;
  }
  renderer.close();
  renderer = null;
  relaunchedPid = await until('new Frondose process and visible window after updater relaunch', async () => {
    const pid = listeningProcess();
    return pid && pid !== oldPid && visibleWindow(pid) && pid;
  }, 180000);
  assert.equal(await digest(installed), expectedHash, 'installed image is exactly the new release');
  const snapshot = await json(origin + '/api/bootstrap');
  assert.equal(snapshot.workspaces.find(w => w.id === workspaceId)?.name, marker);
  assert.ok(snapshot.projects.some(p => p.workspace_id === workspaceId && p.name === marker));
  console.log('FRONDOSE_UPGRADE_OK: ' + versionBefore + ' → ' + versionAfter + '; bottom-right popup clicked, exact new image installed, new process displayed Frondose, original workspace and project persisted.');
} catch (error) {
  console.error(launchLog);
  throw error;
} finally {
  renderer?.close();
  if (relaunchedPid) try { process.kill(relaunchedPid); } catch {}
  if (launcher && launcher.exitCode === null) launcher.kill();
  listener.closeAllConnections();
  await new Promise(yes => listener.close(() => yes()));
  await rm(temp, { recursive: true, force: true });
}

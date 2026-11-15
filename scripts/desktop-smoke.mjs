// Isolated native smoke: no Frondose database, project folder or provider account
// is opened. The desktop attaches to this short-lived loopback fixture instead.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopOutputDirectory } from './desktop-package.mjs';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--packaged') || args.length > 1) throw Error('Usage: node scripts/desktop-smoke.mjs [--packaged]');

async function packagedExecutable() {
  const output = desktopOutputDirectory(root, process.env.FRONDOSE_DESKTOP_OUTPUT_DIR);
  const folders = await readdir(output);
  let candidates;
  if (process.platform === 'darwin') candidates = folders.filter(name => /^mac(?:-[a-z0-9]+)?$/.test(name)).map(name => join(output, name, 'Frondose.app', 'Contents', 'MacOS', 'Frondose'));
  else if (process.platform === 'win32') candidates = folders.filter(name => /^win(?:-[a-z0-9]+)?-unpacked$|^win-unpacked$/.test(name)).map(name => join(output, name, 'Frondose.exe'));
  else if (process.platform === 'linux') candidates = folders.filter(name => /^linux(?:-[a-z0-9]+)?-unpacked$|^linux-unpacked$/.test(name)).map(name => join(output, name, 'frondose'));
  else throw Error('Native smoke supports macOS, Windows and Linux.');
  for (const candidate of candidates) { try { if ((await stat(candidate)).isFile()) return candidate; } catch {} }
  throw Error('No unpacked Frondose application found. Build the desktop package for this operating system first.');
}

async function verifyPackagedPty(executable, fixtureDirectory) {
  const resources = process.platform === 'darwin' ? resolve(dirname(executable), '../Resources') : join(dirname(executable), 'resources');
  const modulePath = join(resources, 'app.asar', 'node_modules', 'node-pty');
  // Run only the packaged native module with Electron's own ABI. A fixed
  // non-interactive echo in the private fixture folder cannot read projects,
  // load shell profiles or invoke a provider account.
  const code = `const pty=require(${JSON.stringify(modulePath)});const path=require('node:path');const win=process.platform==='win32';const shell=win?path.join(process.env.SystemRoot||'C:\\\\Windows','System32','cmd.exe'):'/bin/sh';const args=win?['/d','/c','echo FRONDOSE_PACKAGED_PTY_OK']:['-c','printf FRONDOSE_PACKAGED_PTY_OK'];let text='';const terminal=pty.spawn(shell,args,{cwd:${JSON.stringify(fixtureDirectory)},env:{PATH:process.env.PATH||process.env.Path||'',SystemRoot:process.env.SystemRoot||'',TERM:'xterm-256color'},name:'xterm-256color',cols:80,rows:24});const timeout=setTimeout(()=>{terminal.kill();console.error('Packaged PTY timed out');process.exitCode=1},10000);terminal.onData(chunk=>{text=(text+chunk).slice(-2000)});terminal.onExit(({exitCode})=>setTimeout(()=>{clearTimeout(timeout);if(exitCode!==0||!text.includes('FRONDOSE_PACKAGED_PTY_OK')){console.error('Packaged PTY failed',exitCode,text);process.exitCode=1}else console.log('FRONDOSE_PACKAGED_PTY_OK')},80));`;
  await new Promise((yes, no) => {
    const probe = spawn(executable, ['-e', code], { cwd: fixtureDirectory, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const receive = chunk => { output = (output + String(chunk)).slice(-16000); process.stdout.write(String(chunk)); };
    probe.stdout.on('data', receive); probe.stderr.on('data', receive);
    const timer = setTimeout(() => { probe.kill('SIGKILL'); no(Error('Packaged native PTY probe did not finish.')); }, 20000);
    probe.once('error', error => { clearTimeout(timer); no(error); });
    probe.once('exit', code => { clearTimeout(timer); code === 0 && output.includes('FRONDOSE_PACKAGED_PTY_OK') ? yes() : no(Error('The packaged native PTY could not run with the application ABI.')); });
  });
}

const fixtureDirectory = await mkdtemp(join(tmpdir(), 'frondose-desktop-smoke-'));
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/api/health') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: true, product: { edition: 'local', singleOwner: true } }));
  } else {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    response.end('<!doctype html><html><head><title>Frondose desktop fixture</title></head><body><h1>Isolated desktop smoke</h1><p>No workspace or provider account is loaded.</p></body></html>');
  }
});
let child, killTimer;
try {
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const executable = args.includes('--packaged') ? await packagedExecutable() : require('electron');
  if (args.includes('--packaged')) await verifyPackagedPty(executable, fixtureDirectory);
  const launchArgs = args.includes('--packaged') ? [] : [join(root, 'desktop/main.cjs')];
  // Prevent inherited credentials/service URLs from affecting this fixture. The
  // native smoke path refuses to start any API/database if health is unavailable.
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '', FRONDOSE_DESKTOP_SMOKE: '1', FRONDOSE_DESKTOP_USER_DATA: fixtureDirectory, FRONDOSE_DESKTOP_URL: `http://127.0.0.1:${server.address().port}` };
  let output = '';
  const result = await new Promise((yes, no) => {
    child = spawn(executable, launchArgs, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: false });
    const receive = bytes => { const text = String(bytes); output = (output + text).slice(-128000); process.stdout.write(text); };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    child.once('error', no); child.once('exit', (code, signal) => yes({ code, signal }));
    killTimer = setTimeout(() => { child.kill('SIGKILL'); no(Error('Native desktop smoke timed out.')); }, 45000);
  });
  if (result.code !== 0 || !output.includes('FRONDOSE_DESKTOP_SMOKE_OK')) throw Error(`Native desktop smoke failed (${result.code ?? result.signal}).`);
  console.log(`Frondose isolated ${args.includes('--packaged') ? 'packaged' : 'source'} desktop smoke passed on ${process.platform}.`);
} finally {
  clearTimeout(killTimer);
  if (child && child.exitCode === null && !child.killed) child.kill('SIGKILL');
  await new Promise(resolveClose => server.close(resolveClose));
  // This exact temporary directory was created above, never a project/user path.
  await rm(fixtureDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let executable;
try { executable = require('electron'); }
catch { throw Error('The Frondose desktop runtime is not installed. Install project dependencies before launching the desktop app. The local browser version remains available.'); }
const child = spawn(executable, [resolve(root, 'desktop/main.cjs')], { cwd: root, stdio: 'inherit', shell: false, windowsHide: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { child.kill(signal); });

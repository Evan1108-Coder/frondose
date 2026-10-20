import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, stat, lstat, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';
import { validationError } from './validation.mjs';
import { localComparison } from './local-comparison.mjs';

const exec = promisify(execFile);
const stamp = () => new Date().toISOString();
const uid = prefix => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
const blocked = /^(?:\.git|\.env(?:\..*)?|\.ssh|\.aws|\.config|\.codex|\.claude|\.rumbo|\.talvori|\.frondose|node_modules|\.next|\.cache|\.DS_Store|id_rsa(?:\..*)?|id_ed25519(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx|sqlite|sqlite3|db))$/i;
const MAX_FILE = 512_000;
const MAX_OUTPUT = 250_000;
const DEFAULT_SETTINGS = { showFiles: true, wrapFiles: false, terminalFontSize: 14, showHiddenFiles: false, maxTerminals: 4 };
const inside = (root, file) => file === root || file.startsWith(`${root}${sep}`);
const requiredText = (value, label, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw validationError(`${label} is required and must be under ${max} characters.`);
  return value.trim();
};
function safeRelative(value = '') {
  if (typeof value !== 'string' || value.length > 2048 || value.includes('\0') || isAbsolute(value) || value.split(/[\\/]/).some(part => part === '..' || blocked.test(part))) throw validationError('This path is outside the project or contains private files.');
  return value;
}
function decode(row) { return row ? { ...row, settings: JSON.parse(row.settings_json || '{}'), settings_json: undefined } : null; }

export function installWorkbench(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_environments (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL,
    path TEXT NOT NULL, branch TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workbench_commands (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL,
    command TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workbench_preferences (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    settings_json TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS workbench_terminals (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment_id TEXT, name TEXT NOT NULL, cwd TEXT NOT NULL, command TEXT,
    status TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', output_offset INTEGER NOT NULL DEFAULT 0,
    exit_code INTEGER, created_at TEXT NOT NULL, ended_at TEXT);`);
}

/** Explicitly scoped local execution. This is not a sandbox: shell launch requires
 * a human acknowledgement. File APIs never expose credentials or escape roots. */
export function createWorkbenchService({ db, dataDir, ptyFactory } = {}) {
  installWorkbench(db);
  db.prepare("UPDATE workbench_terminals SET status='interrupted',ended_at=? WHERE status IN ('running','stopping')").run(stamp());
  const active = new Map();
  const pendingStarts = new Map();
  let closed = false;
  let pendingPty;
  async function pty() {
    if (ptyFactory) return ptyFactory;
    pendingPty ??= import('node-pty').then(module => module.default ?? module).catch(() => { pendingPty = null; throw validationError('Interactive terminal support is unavailable. Install the project’s node-pty dependency and restart Frondose.'); });
    return pendingPty;
  }
  function scope(workspaceId, projectId) {
    const project = db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(projectId || '', workspaceId || '');
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id=? AND archived_at IS NULL').get(workspaceId || '');
    if (!project || !workspace) throw validationError('Choose an active project in this workspace.');
    return project;
  }
  async function rootFor(project, environmentId) {
    let target = project.local_path;
    if (environmentId) {
      const environment = db.prepare('SELECT * FROM workbench_environments WHERE id=? AND project_id=? AND workspace_id=?').get(environmentId, project.id, project.workspace_id);
      if (!environment) throw validationError('Choose an environment belonging to this project.');
      target = environment.path;
    }
    if (!target || !isAbsolute(target)) throw validationError('Link a project folder to use files, Git, or terminals. General project work does not require a folder.');
    let root;
    try { root = await realpath(target); } catch { throw validationError('The linked folder is unavailable. Check the project’s working folder.'); }
    if (root === sep || inside(root, homedir()) || !(await stat(root)).isDirectory()) throw validationError('Choose a specific project folder, not your home or filesystem root.');
    if (!environmentId && root.split(sep).some(part => blocked.test(part))) throw validationError('Credential, dependency, and private application folders cannot be linked to Workbench.');
    const privateRoot = resolve(dataDir);
    // Managed worktrees are intentionally under storage; the database and credentials are not.
    if (!environmentId && (inside(root, privateRoot) || inside(privateRoot, root))) throw validationError('Frondose’s private storage cannot be used as a project folder.');
    return root;
  }
  async function fileFor(root, path) {
    const clean = safeRelative(path);
    let target;
    try { target = await realpath(resolve(root, clean)); } catch { throw validationError('This file or folder is no longer available.'); }
    if (!inside(root, target)) throw validationError('Links outside this project cannot be opened.');
    safeRelative(relative(root, target));
    return target;
  }
  async function git(root, args) {
    try {
      const result = await exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=', ...args], { cwd: root, timeout: 15_000, maxBuffer: 1_000_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' } });
      return result.stdout;
    } catch (error) {
      const message = String(error.stderr || error.message).slice(0, 1200);
      throw validationError(`Git could not complete this action: ${message}`);
    }
  }
  async function requireRepositoryRoot(root) {
    const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
    if (await realpath(top) !== root) throw validationError('Link the repository root to inspect Git. A nested project folder must not expose files outside its scope.');
  }
  const prefs = project => ({ ...DEFAULT_SETTINGS, ...(decode(db.prepare('SELECT * FROM workbench_preferences WHERE project_id=?').get(project.id))?.settings ?? {}) });
  function terminalFor(project, terminalId) {
    const terminal = db.prepare('SELECT * FROM workbench_terminals WHERE id=? AND project_id=? AND workspace_id=?').get(terminalId, project.id, project.workspace_id);
    if (!terminal) throw validationError('This terminal does not belong to the selected project.');
    return terminal;
  }
  function saveOutput(id, chunk) {
    if (closed) return;
    const row = db.prepare('SELECT output,output_offset FROM workbench_terminals WHERE id=?').get(id);
    if (!row) return;
    const combined = row.output + chunk;
    const removed = Math.max(0, combined.length - MAX_OUTPUT);
    db.prepare('UPDATE workbench_terminals SET output=?,output_offset=? WHERE id=?').run(combined.slice(removed), row.output_offset + removed, id);
  }
  async function listTree(root, path, showHidden) {
    const directory = await fileFor(root, path);
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter(item => !blocked.test(item.name) && (showHidden || !item.name.startsWith('.'))).slice(0, 500).map(item => ({ name: item.name, path: join(path || '', item.name), type: item.isDirectory() ? 'directory' : item.isSymbolicLink() ? 'link' : 'file' })).sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name));
  }
  async function readText(root, path) {
    const target = await fileFor(root, path);
    const info = await stat(target);
    if (!info.isFile() || info.size > MAX_FILE) throw validationError('Open a text file smaller than 512 KB. Large files and binary previews are not supported here.');
    const bytes = await readFile(target);
    if (bytes.includes(0)) throw validationError('This is a binary file. Workbench currently previews text files.');
    return { path, content: bytes.toString('utf8'), size: info.size, modified_at: info.mtime.toISOString() };
  }
  async function checkpointRoot(project, environmentId = null) {
    const root = await rootFor(project, environmentId);
    await requireRepositoryRoot(root);
    const info = await stat(root);
    return { root, device: String(info.dev), inode: String(info.ino) };
  }
  async function checkpointPaths(root) {
    await requireRepositoryRoot(root);
    return [...new Set((await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean))];
  }
  async function writableTarget(root, path) {
    const clean = safeRelative(path);
    if (!clean) throw validationError('Choose a file inside the project.');
    const target = resolve(root, clean), parent = dirname(target);
    let actualParent;
    try { actualParent = await realpath(parent); } catch { throw validationError('The destination folder is unavailable. Restore parent folders separately.'); }
    if (!inside(root, actualParent)) throw validationError('Links outside this project cannot be changed.');
    safeRelative(relative(root, actualParent));
    const parentInfo = await stat(actualParent);
    if (!parentInfo.isDirectory()) throw validationError('The destination folder is unavailable.');
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isFile()) throw validationError('Only regular project files can be restored.');
      const actual = await realpath(target);
      if (!inside(root, actual)) throw validationError('Links outside this project cannot be changed.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { clean, target, parent: actualParent };
  }
  async function checkpointState(root, path) {
    const destination = await writableTarget(root, path);
    let info;
    try { info = await lstat(destination.target); } catch (error) {
      if (error.code === 'ENOENT') return { path: destination.clean, state: 'absent', sha256: null, byte_size: 0, mode: null, content: null };
      throw error;
    }
    if (info.isSymbolicLink() || !info.isFile()) throw validationError('Only regular project files can be checkpointed.');
    if (info.size > MAX_FILE) throw validationError('Checkpoint files must be smaller than 512 KB.');
    const content = await readFile(destination.target);
    if (content.includes(0)) throw validationError('Binary files cannot be checkpointed or restored.');
    if (!Buffer.from(content.toString('utf8'), 'utf8').equals(content)) throw validationError('Checkpoint files must contain valid UTF-8 text.');
    return { path: destination.clean, state: 'present', sha256: createHash('sha256').update(content).digest('hex'), byte_size: content.length, mode: info.mode & 0o777, content };
  }
  async function stageCheckpointState(root, path, desired, token) {
    const destination = await writableTarget(root, path);
    if (desired.state === 'absent') return { ...destination, state: 'absent', temporary: null };
    if (desired.state !== 'present' || !Buffer.isBuffer(desired.content)) throw validationError('The checkpoint file content is unavailable.');
    const temporary = join(destination.parent, `.env.rumbo-restore-${token}`);
    const mode = desired.mode ?? 0o600;
    await writeFile(temporary, desired.content, { flag: 'wx', mode });
    await chmod(temporary, mode);
    return { ...destination, state: 'present', temporary };
  }
  async function applyCheckpointState(root, staged) {
    const current = await writableTarget(root, staged.clean);
    if (current.target !== staged.target || current.parent !== staged.parent) throw validationError('The destination changed during restore.');
    const latest = await checkpointState(root, staged.clean);
    if (latest.state !== staged.expectedState || (latest.sha256 || null) !== (staged.expectedSha256 || null) || (latest.mode ?? null) !== (staged.expectedMode ?? null)) throw Object.assign(validationError('The file changed during restore. Preview again.'), { statusCode: 409, errorCode: 'stale_worktree', code: 'stale_worktree' });
    if (staged.state === 'present') await rename(staged.temporary, staged.target);
    else { try { await unlink(staged.target); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  async function cleanupCheckpointStage(staged) {
    if (!staged?.temporary) return;
    try { await unlink(staged.temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async function summary(project) {
    let root = null, folderError = null;
    if (project.local_path) { try { root = await rootFor(project); } catch (error) { folderError = error.message; } }
    return {
      project_id: project.id, root, folderError, settings: prefs(project),
      environments: db.prepare('SELECT * FROM workbench_environments WHERE project_id=? AND workspace_id=? ORDER BY created_at').all(project.id, project.workspace_id),
      commands: db.prepare('SELECT * FROM workbench_commands WHERE project_id=? AND workspace_id=? ORDER BY created_at').all(project.id, project.workspace_id),
      terminals: db.prepare('SELECT id,name,cwd,environment_id,command,status,exit_code,created_at,ended_at FROM workbench_terminals WHERE project_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 40').all(project.id, project.workspace_id),
    };
  }
  async function startTerminal(project, body) {
    if (body.confirm_execution !== true) throw validationError('Confirm that this terminal can run commands on your computer. It is not a sandbox.');
    const settings = prefs(project);
    if ([...active.values()].filter(item => item.projectId === project.id).length + (pendingStarts.get(project.id) || 0) >= settings.maxTerminals) throw validationError(`This project already has ${settings.maxTerminals} active terminals. Stop one or raise the limit in Workbench settings.`);
    pendingStarts.set(project.id, (pendingStarts.get(project.id) || 0) + 1);
    try {
    const root = await rootFor(project, body.environment_id);
    const name = requiredText(body.name || 'Terminal', 'Terminal name', 80);
    const command = body.command == null ? null : requiredText(body.command, 'Command', 4000);
    const factory = await pty();
    if (closed) throw validationError('The server is closing. Reopen Workbench after it restarts.');
    const terminalId = uid('term');
    // Do not pass app/API secrets into child environments or source user startup scripts.
    const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    const shell = process.env.SHELL === '/bin/zsh' ? '/bin/zsh' : '/bin/bash';
    const args = shell.endsWith('zsh') ? ['-f', ...(command ? ['-c', command] : [])] : ['--noprofile', '--norc', ...(command ? ['-c', command] : [])];
    const terminal = factory.spawn(shell, args, { name: 'xterm-256color', cwd: root, env, cols: 100, rows: 28 });
    db.prepare('INSERT INTO workbench_terminals (id,workspace_id,project_id,environment_id,name,cwd,command,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(terminalId, project.workspace_id, project.id, body.environment_id || null, name, root, command, 'running', stamp());
    active.set(terminalId, { terminal, projectId: project.id });
    terminal.onData(chunk => saveOutput(terminalId, chunk));
    terminal.onExit(({ exitCode }) => {
      active.delete(terminalId);
      if (!closed) db.prepare("UPDATE workbench_terminals SET status=CASE WHEN status='stopping' THEN 'stopped' ELSE 'exited' END,exit_code=?,ended_at=? WHERE id=?").run(exitCode ?? null, stamp(), terminalId);
    });
    return terminalFor(project, terminalId);
    } finally { pendingStarts.set(project.id, Math.max(0, (pendingStarts.get(project.id) || 1) - 1)); }
  }
  async function dispatch(project, action, method, body, url) {
    const environmentId = body.environment_id || url.searchParams.get('environment_id') || null;
    const path = url.searchParams.get('path') || '';
    if (!action && method === 'GET') return summary(project);
    if (action === 'settings' && method === 'PATCH') {
      const next = prefs(project);
      for (const key of ['showFiles', 'wrapFiles', 'showHiddenFiles']) if (body[key] !== undefined) { if (typeof body[key] !== 'boolean') throw validationError('Display preferences must be true or false.'); next[key] = body[key]; }
      for (const [key, min, max] of [['terminalFontSize', 11, 22], ['maxTerminals', 1, 8]]) if (body[key] !== undefined) { if (!Number.isInteger(body[key]) || body[key] < min || body[key] > max) throw validationError(`${key} must be between ${min} and ${max}.`); next[key] = body[key]; }
      db.prepare('INSERT INTO workbench_preferences (project_id,workspace_id,settings_json) VALUES (?,?,?) ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json').run(project.id, project.workspace_id, JSON.stringify(next));
      return { settings: next };
    }
    if (action === 'commands' && method === 'POST') {
      const item = { id: uid('cmd'), name: requiredText(body.name, 'Command name', 80), command: requiredText(body.command, 'Command', 4000), created_at: stamp() };
      db.prepare('INSERT INTO workbench_commands VALUES (?,?,?,?,?,?)').run(item.id, project.workspace_id, project.id, item.name, item.command, item.created_at);
      return item;
    }
    if (action.startsWith('commands/') && method === 'DELETE') {
      db.prepare('DELETE FROM workbench_commands WHERE id=? AND project_id=? AND workspace_id=?').run(action.slice(9), project.id, project.workspace_id);
      return { ok: true };
    }
    if (action === 'terminals' && method === 'POST') return startTerminal(project, body);
    if (action.startsWith('terminals/')) {
      const [, terminalId, operation] = action.split('/');
      const terminal = terminalFor(project, terminalId);
      if (!operation && method === 'GET') {
        const cursor = Number(url.searchParams.get('cursor')) || 0;
        return { ...terminal, output: terminal.output.slice(Math.max(0, cursor - terminal.output_offset)), reset: cursor < terminal.output_offset, cursor: terminal.output_offset + terminal.output.length };
      }
      if (!operation && method === 'PATCH') {
        db.prepare('UPDATE workbench_terminals SET name=? WHERE id=?').run(requiredText(body.name, 'Terminal name', 80), terminalId);
        return { ok: true };
      }
      const live = active.get(terminalId);
      if (operation === 'resize' && method === 'POST' && !live) return { ok: true, ended: true };
      if (operation === 'stop' && method === 'POST' && !live) return { ok: true, ended: true };
      if (!live) throw validationError('This terminal has ended. Its output is still available; start a new terminal to continue.');
      if (operation === 'input' && method === 'POST') {
        if (typeof body.data !== 'string' || body.data.length > 16_000) throw validationError('Terminal input must be under 16 KB.');
        live.terminal.write(body.data); return { ok: true };
      }
      if (operation === 'resize' && method === 'POST') {
        if (![body.cols, body.rows].every(value => Number.isInteger(value) && value >= 2 && value <= 500)) throw validationError('Invalid terminal dimensions.');
        live.terminal.resize(body.cols, body.rows); return { ok: true };
      }
      if (operation === 'stop' && method === 'POST') {
        db.prepare("UPDATE workbench_terminals SET status='stopping' WHERE id=?").run(terminalId);
        live.terminal.kill(); return { ok: true };
      }
    }
    const root = await rootFor(project, environmentId);
    if (action === 'checkpoint' && method === 'GET') {
      await requireRepositoryRoot(root);
      const paths = await checkpointPaths(root);
      const files = {}; let size = 0, limited = false;
      for (const path of paths) {
        try { safeRelative(path); if ((await lstat(join(root, path))).isSymbolicLink()) continue; } catch { continue; }
        if (Object.keys(files).length >= 200 || size >= 2_000_000) { limited = true; break; }
        try { const file = await readText(root, path); size += file.content.length; if (size > 2_000_000) { limited = true; break; } files[path] = file.content; } catch { limited = true; }
      }
      return { root, files, limited };
    }
    if (action === 'comparison' && method === 'GET') {
      await requireRepositoryRoot(root);
      return localComparison({ root, query: Object.fromEntries(url.searchParams), git, safeRelative, fileFor, readText });
    }
    if (action === 'tree' && method === 'GET') return { path, entries: await listTree(root, path, prefs(project).showHiddenFiles) };
    if (action === 'file' && method === 'GET') return readText(root, path);
    if (action === 'search' && method === 'GET') {
      const query = requiredText(url.searchParams.get('q'), 'Search text', 100).toLowerCase();
      const found = [], pending = ['']; let visited = 0;
      while (pending.length && visited < 2500 && found.length < 100) {
        const dir = pending.shift();
        let entries; try { entries = await listTree(root, dir, prefs(project).showHiddenFiles); } catch { continue; }
        for (const item of entries) {
          if (++visited > 2500) break;
          if (item.type === 'directory') { if (dir.split(sep).length < 8) pending.push(item.path); }
          else if (item.type !== 'link' && item.path.toLowerCase().includes(query)) found.push(item);
          if (found.length >= 100) break;
        }
      }
      return { entries: found, limited: pending.length > 0 || visited >= 2500 || found.length >= 100 };
    }
    if (action === 'scripts' && method === 'GET') {
      try {
        const file = await readText(root, 'package.json'); const packageJson = JSON.parse(file.content);
        return { scripts: Object.entries(packageJson.scripts || {}).filter(([name, value]) => /^[\w:.-]+$/.test(name) && typeof value === 'string').slice(0, 40).map(([name, script]) => ({ name, script, command: `npm run ${name}` })) };
      } catch { return { scripts: [] }; }
    }
    if (action === 'git' && method === 'GET') {
      try {
        await requireRepositoryRoot(root);
        const [branch, status, branches] = await Promise.all([git(root, ['rev-parse', '--abbrev-ref', 'HEAD']), git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']), git(root, ['branch', '--format=%(refname:short)'])]);
        const entries = status.split('\0'), files = [];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]; if (!entry) continue;
          const state = entry.slice(0, 2), filename = entry.slice(3);
          if (state.includes('R') || state.includes('C')) i++;
          try { safeRelative(filename); files.push({ path: filename, status: state }); } catch { /* Private paths are deliberately hidden. */ }
        }
        return { repository: true, branch: branch.trim(), branches: branches.trim().split('\n').filter(Boolean), files };
      } catch { return { repository: false, branch: null, files: [], branches: [] }; }
    }
    if (action === 'diff' && method === 'GET') {
      await requireRepositoryRoot(root);
      safeRelative(path);
      if (!path) throw validationError('Select a changed file.');
      // Existing symlinks must remain inside the project, even when reading a Git diff.
      try { await stat(resolve(root, path)); await fileFor(root, path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const [working, staged] = await Promise.all([git(root, ['diff', '--no-ext-diff', '--no-textconv', '--', path]), git(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--', path])]);
      return { path, content: `${staged ? `Staged changes\n${staged}\n` : ''}${working ? `Working changes\n${working}` : ''}` || 'No tracked diff. This file may be untracked; open it in Files to inspect its contents.' };
    }
    if (action === 'worktrees' && method === 'POST') {
      await requireRepositoryRoot(root);
      if (body.confirm_create !== true) throw validationError('Confirm creation of a separate branch and working folder.');
      const branch = requiredText(body.branch, 'Branch', 120);
      if (!/^rumbo\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..') || branch.endsWith('/') || branch.endsWith('.')) throw validationError('Use a branch such as rumbo/popup-ui.');
      await git(root, ['check-ref-format', '--branch', branch]);
      const base = requiredText(body.base || 'HEAD', 'Starting reference', 120);
      if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base)) throw validationError('Choose a branch name or commit without special Git revision operators.');
      const commit = (await git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`])).trim();
      const environment = { id: uid('env'), name: requiredText(body.name || branch, 'Environment name', 80), branch, created_at: stamp() };
      const parent = join(resolve(dataDir), 'worktrees', project.id);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      environment.path = join(parent, environment.id);
      await git(root, ['worktree', 'add', '-b', branch, environment.path, commit]);
      db.prepare('INSERT INTO workbench_environments VALUES (?,?,?,?,?,?,?)').run(environment.id, project.workspace_id, project.id, environment.name, environment.path, branch, environment.created_at);
      return environment;
    }
    if (action === 'preview' && method === 'POST') {
      const port = Number(body.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw validationError('Enter a development port between 1024 and 65535.');
      const reachable = await new Promise(resolveProbe => {
        const socket = createConnection({ host: '127.0.0.1', port });
        const finish = result => { socket.destroy(); resolveProbe(result); };
        socket.setTimeout(1200); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.once('timeout', () => finish(false));
      });
      if (!reachable) throw validationError('Nothing is listening on that development port. Start your development server first.');
      return { url: `http://127.0.0.1:${port}/`, port, checked_at: stamp() };
    }
    throw validationError('This Workbench action is not available.');
  }
  async function handle({ req, res, path, url, readBody, send }) {
    if (path !== '/workbench' && !path.startsWith('/workbench/')) return false;
    const body = ['POST', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
    const project = scope(body.workspace_id || url.searchParams.get('workspace_id'), body.project_id || url.searchParams.get('project_id'));
    const result = await dispatch(project, path.slice('/workbench'.length).replace(/^\//, ''), req.method, body, url);
    send(res, 200, { result }); return true;
  }
  function close() {
    for (const [id, item] of active) {
      db.prepare("UPDATE workbench_terminals SET status='interrupted',ended_at=? WHERE id=?").run(stamp(), id);
      item.terminal.kill();
    }
    closed = true; active.clear(); pendingStarts.clear();
  }
  function activeSessionsFor(resource, itemId) {
    if (!['projects', 'workspaces'].includes(resource)) return [];
    const column = resource === 'projects' ? 'project_id' : 'workspace_id';
    return db.prepare(`SELECT id,project_id,workspace_id,status FROM workbench_terminals WHERE ${column}=? AND status IN ('running','stopping')`).all(itemId);
  }
  const checkpointAdapter = { checkpointRoot, checkpointPaths, checkpointState, stageCheckpointState, applyCheckpointState, cleanupCheckpointStage };
  return { handle, close, scope, dispatch, summary, activeSessionsFor, checkpointAdapter };
}

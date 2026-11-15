import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, stat, lstat, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';
import { validationError } from './validation.mjs';
import { localComparison } from './local-comparison.mjs';
import {cliCommandPreferences} from './cli-command-preferences.mjs';
import { createTerminalLaunchPlan, detectTerminalProviders, terminalShells, TERMINAL_PROVIDER_CATALOG } from './terminal-launch-plan.mjs';
import { composeNativeAgentPrompt, NATIVE_AGENT_PROVIDERS } from '../src/lib/native-agent-session.js';
import { createTerminalOutputWake } from './terminal-output-wake.mjs';
import { MAX_AUTOMATION_ACTIVITY_CONTEXT, MAX_NATIVE_ROUTE_PROMPT } from './automation-activity-context.mjs';

const exec = promisify(execFile);
const stamp = () => new Date().toISOString();
const uid = prefix => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
const blocked = /^(?:\.git|\.env(?:\..*)?|\.ssh|\.aws|\.config|\.codex|\.claude|\.rumbo|\.talvori|\.frondose|node_modules|\.next|\.cache|\.DS_Store|id_rsa(?:\..*)?|id_ed25519(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx|sqlite|sqlite3|db))$/i;
const MAX_FILE = 512_000;
const MAX_OUTPUT = 250_000;
const DEFAULT_SETTINGS = { showFiles: true, wrapFiles: false, terminalFontSize: 14, showHiddenFiles: false, maxTerminals: 4 };
// Fixed server-owned names, never derived from request fields. Workspace host
// records deliberately do not create or point to a visible project.
const PROJECT_TERMINAL_TABLES = Object.freeze({ environments: 'workbench_environments', commands: 'workbench_commands', preferences: 'workbench_preferences', terminals: 'workbench_terminals', launches: 'workbench_agent_terminal_launches', ownership: 'workbench_terminal_view_ownership', launchViews: 'workbench_terminal_launch_views' });
const WORKSPACE_TERMINAL_TABLES = Object.freeze({ ...PROJECT_TERMINAL_TABLES, commands: 'local_workspace_terminal_commands', preferences: 'local_workspace_terminal_preferences', terminals: 'local_workspace_terminals', ownership: 'local_workspace_terminal_ownership' });
const inside = (root, file) => file === root || file.startsWith(`${root}${sep}`);
const stableIdentity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
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
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_agent_terminal_launches (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL, actor_id TEXT NOT NULL, profile_version INTEGER NOT NULL,
    snapshot_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL, prompt_hash TEXT NOT NULL,
    prompt_text TEXT NOT NULL, terminal_id TEXT REFERENCES workbench_terminals(id) ON DELETE SET NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id,request_id));`);
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_terminal_view_ownership (
    terminal_id TEXT PRIMARY KEY REFERENCES workbench_terminals(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    view_id TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS workbench_terminal_view_scope ON workbench_terminal_view_ownership(workspace_id,project_id,view_id);
    CREATE TABLE IF NOT EXISTS workbench_terminal_launch_views (
    workspace_id TEXT NOT NULL,request_id TEXT NOT NULL,project_id TEXT NOT NULL,view_id TEXT NOT NULL,
    PRIMARY KEY(workspace_id,request_id),
    FOREIGN KEY(workspace_id,request_id) REFERENCES workbench_agent_terminal_launches(workspace_id,request_id) ON DELETE CASCADE);`);
}

function installWorkspaceTerminals(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS local_workspace_terminal_commands (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, command TEXT NOT NULL, created_at TEXT NOT NULL,
    CHECK(project_id=workspace_id));
    CREATE TABLE IF NOT EXISTS local_workspace_terminal_preferences (
    project_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    settings_json TEXT NOT NULL DEFAULT '{}', CHECK(project_id=workspace_id));
    CREATE TABLE IF NOT EXISTS local_workspace_terminals (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id TEXT, name TEXT NOT NULL, cwd TEXT NOT NULL, command TEXT,
    status TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', output_offset INTEGER NOT NULL DEFAULT 0,
    exit_code INTEGER, created_at TEXT NOT NULL, ended_at TEXT, CHECK(project_id=workspace_id), CHECK(environment_id IS NULL));
    CREATE TABLE IF NOT EXISTS local_workspace_terminal_ownership (
    terminal_id TEXT PRIMARY KEY REFERENCES local_workspace_terminals(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    view_id TEXT NOT NULL,created_at TEXT NOT NULL, CHECK(project_id=workspace_id));
    CREATE INDEX IF NOT EXISTS local_workspace_terminal_view_scope ON local_workspace_terminal_ownership(workspace_id,project_id,view_id);`);
}

/** Explicit local clicks start OS-user processes, not sandboxed jobs. File APIs
 * still require their own linked project root and never gain a home fallback. */
export function createWorkbenchService({ db, dataDir, ptyFactory, terminalPlatform = process.platform, terminalEnv = process.env, terminalResolveExecutable, authorizeNativeAgent, authorizeTerminalResume, assertDirectoryMutable, recordActivity, terminalHome = homedir, workspaceTerminalScope = false } = {}) {
  const tables = workspaceTerminalScope ? WORKSPACE_TERMINAL_TABLES : PROJECT_TERMINAL_TABLES;
  if (workspaceTerminalScope) installWorkspaceTerminals(db); else installWorkbench(db);
  const workspaceTerminals = workspaceTerminalScope ? null : createWorkbenchService({ db, dataDir, ptyFactory, terminalPlatform, terminalEnv, terminalResolveExecutable, authorizeTerminalResume, assertDirectoryMutable, recordActivity, terminalHome, workspaceTerminalScope: true });
  db.prepare(`UPDATE ${tables.terminals} SET status='interrupted',ended_at=? WHERE status IN ('running','stopping')`).run(stamp());
  const active = new Map();
  const outputWake = createTerminalOutputWake();
  const pendingStarts = new Map();
  const pendingViewStarts = new Map(), stoppingViews = new Set();
  const viewKey = (project, viewId) => JSON.stringify([project.workspace_id, project.id, viewId]);
  let closed = false;
  let pendingPty;
  async function pty() {
    if (ptyFactory) return ptyFactory;
    pendingPty ??= import('node-pty').then(module => module.default ?? module).catch(() => { pendingPty = null; throw validationError('Interactive terminal support is unavailable. Install the project’s node-pty dependency and restart Frondose.'); });
    return pendingPty;
  }
  function scope(workspaceId, projectId) {
    if (workspaceTerminalScope) {
      if (projectId) throw validationError('Workspace terminals cannot select a project or environment.');
      const workspace = db.prepare('SELECT id FROM workspaces WHERE id=? AND archived_at IS NULL').get(workspaceId || '');
      if (!workspace) throw validationError('Choose an active workspace.');
      return { id: workspace.id, workspace_id: workspace.id, local_path: null };
    }
    const project = db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(projectId || '', workspaceId || '');
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id=? AND archived_at IS NULL').get(workspaceId || '');
    if (!project || !workspace) throw validationError('Choose an active project in this workspace.');
    return project;
  }
  async function workspaceTerminalRoot(project) {
    const hasBindings = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='directory_workspaces'").get();
    const binding = hasBindings ? db.prepare('SELECT * FROM directory_workspaces WHERE workspace_id=?').get(project.workspace_id) : null;
    if (binding) {
      const boundProject = db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(binding.project_id, project.workspace_id);
      if (!boundProject || boundProject.local_path !== binding.path) throw validationError('The workspace directory changed. Confirm the folder again before opening a terminal.');
      const root = await rootFor(boundProject, null), info = await stat(root, { bigint: true });
      if (root !== binding.path || `${info.dev}:${info.ino}` !== binding.root_identity) throw validationError('The workspace directory changed. Confirm the folder again before opening a terminal.');
      return root;
    }
    // Only the process-owned OS home is considered. Browser cwd/path/environment
    // fields never select this fallback, and no directory binding is written.
    const home = terminalHome();
    if (typeof home !== 'string' || !isAbsolute(home) || /[\0\r\n]/u.test(home)) throw validationError('No safe OS home directory is available for this terminal.');
    let root, info;
    try { root = await realpath(home); info = await stat(root); } catch { throw validationError('The OS home directory is unavailable.'); }
    if (!info.isDirectory() || root === parse(root).root) throw validationError('No safe OS home directory is available for this terminal.');
    return root;
  }
  async function rootFor(project, environmentId) {
    let target = project.local_path;
    if (environmentId) {
      const environment = db.prepare(`SELECT * FROM ${tables.environments} WHERE id=? AND project_id=? AND workspace_id=?`).get(environmentId, project.id, project.workspace_id);
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
  const workspaceCliPrefs = workspaceId => {
    const row=db.prepare('SELECT settings_json FROM local_workspace_terminal_preferences WHERE project_id=? AND workspace_id=?').get(workspaceId,workspaceId);
    try{return JSON.parse(row?.settings_json||'{}');}catch{return {};}
  };
  const prefs = project => ({ ...DEFAULT_SETTINGS, ...(decode(db.prepare(`SELECT * FROM ${tables.preferences} WHERE project_id=?`).get(project.id))?.settings ?? {}) });
  function terminalFor(project, terminalId) {
    const terminal = db.prepare(`SELECT * FROM ${tables.terminals} WHERE id=? AND project_id=? AND workspace_id=?`).get(terminalId, project.id, project.workspace_id);
    if (!terminal) throw validationError('This terminal does not belong to the selected project.');
    const launch = workspaceTerminalScope ? null : db.prepare(`SELECT agent_id,profile_version,prompt_hash FROM ${tables.launches} WHERE terminal_id=? AND workspace_id=?`).get(terminalId, project.workspace_id);
    const owner = db.prepare(`SELECT view_id FROM ${tables.ownership} WHERE terminal_id=? AND workspace_id=? AND project_id=?`).get(terminalId, project.workspace_id, project.id);
    const live = active.get(terminalId);
    return { ...terminal, ...(workspaceTerminalScope ? { project_id: null, host_scope: 'workspace' } : {}), ...(live ? { output: live.output, output_offset: live.outputOffset, ...(live.outputWarning ? { output_warning: live.outputWarning } : {}) } : {}), ...(launch ? { agent_id: launch.agent_id, agent_profile_version: launch.profile_version, prompt_hash: launch.prompt_hash } : {}), ...(owner ? { owner_view_id: owner.view_id } : {}) };
  }
  function flushOutput(id) {
    const live = active.get(id);
    if (!live) return;
    clearTimeout(live.outputTimer); live.outputTimer = null;
    if (!live.outputDirty) return;
    try { db.prepare(`UPDATE ${tables.terminals} SET output=?,output_offset=? WHERE id=?`).run(live.output, live.outputOffset, id); live.outputDirty = false; live.outputWarning = null; }
    catch { live.outputWarning = 'Live output is available, but terminal history could not be saved.'; }
  }
  function saveOutput(id, chunk) {
    if (closed) return;
    const live = active.get(id);
    if (!live) return;
    const combined = live.output + chunk;
    const removed = Math.max(0, combined.length - MAX_OUTPUT);
    live.output = combined.slice(removed); live.outputOffset += removed; live.outputDirty = true;
    // Echo reads see bounded in-memory output immediately. Disk persistence is
    // coalesced instead of putting a synchronous SQLite write on every key.
    if (!live.outputTimer) live.outputTimer = setTimeout(() => flushOutput(id), 40);
    outputWake.wake(id);
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
  async function summary(project, environmentId = null) {
    let root = null, folderError = null;
    if (project.local_path || environmentId) { try { root = await rootFor(project, environmentId); } catch (error) { folderError = error.message; } }
    let terminalRoot = root;
    if (workspaceTerminalScope) { try { terminalRoot = await workspaceTerminalRoot(project); } catch (error) { folderError = error.message; } }
    return {
      project_id: workspaceTerminalScope ? null : project.id, ...(workspaceTerminalScope ? { host_scope: 'workspace' } : {}), root, terminalRoot, folderError, settings: prefs(project),
      environments: workspaceTerminalScope ? [] : db.prepare(`SELECT * FROM ${tables.environments} WHERE project_id=? AND workspace_id=? ORDER BY created_at`).all(project.id, project.workspace_id),
      commands: db.prepare(`SELECT * FROM ${tables.commands} WHERE project_id=? AND workspace_id=? ORDER BY created_at`).all(project.id, project.workspace_id),
      terminals: db.prepare(`SELECT id,name,cwd,environment_id,command,status,exit_code,created_at,ended_at FROM ${tables.terminals} WHERE project_id=? AND workspace_id=? ORDER BY CASE WHEN status IN ('running','stopping') THEN 0 ELSE 1 END,created_at DESC LIMIT 40`).all(project.id, project.workspace_id),
    };
  }
  function nativeAgentSnapshot(project, agentId, providerId, actor, environmentId = null) {
    if (typeof authorizeNativeAgent !== 'function') throw validationError('Personalized native agent sessions need a reviewed local agent binding. Instructions must not be silently omitted.');
    if (typeof agentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(agentId) || !NATIVE_AGENT_PROVIDERS.includes(providerId)) throw validationError('Native personalized first tasks are supported only for a selected Codex or Claude Code agent.');
    if (!actor?.id) throw validationError('An authenticated local owner must review this native agent task.');
    const agent = authorizeNativeAgent({ workspaceId: project.workspace_id, projectId: project.id, agentId, providerId, actor });
    if (!agent || agent.then || agent.id !== agentId || agent.provider !== providerId || agent.workspace_id && agent.workspace_id !== project.workspace_id || agent.archived_at || agent.status === 'paused') throw validationError('The selected native agent is not currently available in this workspace.');
    if (!Number.isSafeInteger(agent.version) || agent.version < 1) throw validationError('Reload the agent profile before launching.');
    const maximum = agent.native_max_concurrent_sessions ?? 1;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 8) throw validationError('The native agent session limit is invalid.');
    const environment = environmentId ? db.prepare(`SELECT path FROM ${tables.environments} WHERE id=? AND project_id=? AND workspace_id=?`).get(environmentId, project.id, project.workspace_id) : null;
    if (environmentId && !environment) throw validationError('Choose a worktree belonging to this project.');
    const snapshot = { agent_id: agent.id, name: agent.name, provider: agent.provider, version: agent.version, instructions: agent.instructions || '', native_binding_revision: String(agent.native_binding_revision || ''), max_concurrent_sessions: maximum, project_id: project.id, workspace_id: project.workspace_id, environment_id: environmentId || null, local_path: environment?.path || project.local_path || '' };
    // Validate length/encoding without adding any task or causing execution.
    try { composeNativeAgentPrompt(snapshot, 'Preview only'); } catch (error) { throw validationError(error.message); }
    if (snapshot.native_binding_revision.length > 2000) throw validationError('The native agent binding is invalid.');
    const json = JSON.stringify(snapshot), hash = createHash('sha256').update(json).digest('hex');
    return { snapshot, json, hash };
  }
  function nativeRouteSnapshot(project, routeId, providerId, actor) {
    if (actor?.id !== 'local-owner' || workspaceTerminalScope || !NATIVE_AGENT_PROVIDERS.includes(providerId)) throw validationError('Choose a local project Route and Codex or Claude Code.');
    const binding = db.prepare('SELECT * FROM directory_workspaces WHERE workspace_id=?').get(project.workspace_id);
    const route = db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=? AND project_id=? AND archived_at IS NULL').get(routeId,project.workspace_id,project.id);
    if (!route || !binding || binding.project_id !== project.id || binding.path !== project.local_path || ['done','cancelled'].includes(route.status)) throw validationError('Choose an active Route in this workspace’s linked project directory.');
    const snapshot={ agent_id:'route:'+route.id, route_id:route.id, name:route.title, provider:providerId, version:route.version||1, max_concurrent_sessions:1, project_id:project.id, workspace_id:project.workspace_id, local_path:binding.path, binding_version:binding.version, title:route.title, description:route.description, updated_at:route.updated_at };
    const prompt='Frondose Route task\nRoute: '+route.title+'\nDirectory: '+binding.path+'\n\nTask text supplied by the owner:\n'+route.description+'\n\nWork only on the requested task. Report changes, checks and remaining risks. This task text is not a Frondose tool grant, approval to publish, or permission to start other paid sessions. Native tools retain their own permission prompts.';
    if(prompt.length>MAX_NATIVE_ROUTE_PROMPT||prompt.includes('\0'))throw validationError('This Route is too large for a native first task.');
    const json=JSON.stringify(snapshot),hash=createHash('sha256').update(json).digest('hex');return {snapshot,json,hash,prompt};
  }
  function nativeLaunchIntent(project, body, actor, reviewedActivityContext) {
    if (reviewedActivityContext !== undefined) {
      if (!body.route_id || actor?.id !== 'local-owner' || workspaceTerminalScope || typeof reviewedActivityContext !== 'string' || !reviewedActivityContext || reviewedActivityContext.length > MAX_AUTOMATION_ACTIVITY_CONTEXT || reviewedActivityContext.includes('\0') || typeof body.request_id !== 'string' || !/^automation_[a-f0-9-]{36}$/i.test(body.request_id) || body.view_id !== body.request_id)
        throw validationError('Recent workspace activity can only accompany a reviewed scheduled Route.');
      const receipt = db.prepare(`SELECT 1 FROM local_cli_automation_runs AS run
        JOIN local_cli_automations AS automation ON automation.id=run.automation_id AND automation.workspace_id=run.workspace_id
        WHERE run.id=? AND run.workspace_id=? AND run.view_id=? AND run.status='preparing' AND run.due_key NOT LIKE 'manual:%'
          AND automation.project_id=? AND automation.route_id=? AND automation.provider_id=? AND automation.include_workspace_activity=1`)
        .get(body.request_id.slice('automation_'.length), project.workspace_id, body.view_id, project.id, body.route_id, body.provider_id);
      if (!receipt) throw validationError('Recent workspace activity was not approved for this scheduled run.');
    }
    if (body.agent_id == null && body.route_id == null) { if (body.task != null || body.initial_prompt != null) throw validationError('First tasks require a reviewed named native agent session.'); return null; }
    if(body.agent_id != null && body.route_id != null) throw validationError('Choose one Route or one personalized agent, not both.');
    if (body.confirm_paid !== true) throw validationError('Explicitly approve sending this first task to the provider; it may incur usage or charges.');
    if (typeof body.request_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{15,199}$/.test(body.request_id)) throw validationError('Use a stable native task request ID.');
    const current = body.route_id ? nativeRouteSnapshot(project,body.route_id,body.provider_id,actor) : nativeAgentSnapshot(project, body.agent_id, body.provider_id, actor, body.environment_id || null);
    const launchAgentId=current.snapshot.agent_id;
    if(body.route_id && (body.environment_id || body.expected_binding_version!==current.snapshot.binding_version || body.task != null || body.initial_prompt != null)) throw validationError('Review the current Route and its workspace directory; custom prompts are not accepted.');
    if (body.agent_version !== current.snapshot.version || body.agent_snapshot_hash !== current.hash) throw Object.assign(validationError('The agent profile or native binding changed. Review it again before launching.'), { statusCode: 409 });
    let prompt;
    try { prompt = body.route_id ? current.prompt : composeNativeAgentPrompt(current.snapshot, body.task); } catch (error) { throw validationError(error.message); }
    const reviewedPrompt = prompt;
    if (reviewedActivityContext !== undefined) {
      prompt = reviewedPrompt + '\n\n' + reviewedActivityContext;
      if (prompt.length > MAX_NATIVE_ROUTE_PROMPT) throw validationError('The Route and activity context are too large for a native first task.');
    }
    const promptHash = createHash('sha256').update(prompt).digest('hex');
    const existing = db.prepare(`SELECT * FROM ${tables.launches} WHERE workspace_id=? AND request_id=?`).get(project.workspace_id, body.request_id);
    if (existing) {
      if (existing.project_id !== project.id || existing.agent_id !== launchAgentId || existing.snapshot_hash !== current.hash || existing.prompt_hash !== promptHash || existing.actor_id !== actor.id) throw Object.assign(validationError('This native task request ID already belongs to different reviewed work.'), { statusCode: 409 });
      const view = db.prepare(`SELECT view_id FROM ${tables.launchViews} WHERE workspace_id=? AND request_id=?`).get(project.workspace_id, body.request_id);
      if ((view?.view_id || null) !== (body.view_id || null)) throw Object.assign(validationError('This task belongs to a different terminal view. It cannot be silently adopted or replayed.'), { statusCode: 409 });
      if (existing.terminal_id) return { ...current, prompt, promptHash, requestId: body.request_id, existingTerminal: terminalFor(project, existing.terminal_id) };
      throw Object.assign(validationError('This task launch is pending or uncertain. Refresh existing sessions; it will not be replayed automatically.'), { statusCode: 409 });
    }
    const occupied = db.prepare(`SELECT count(*) AS n FROM ${tables.launches} AS launch LEFT JOIN ${tables.terminals} AS terminal ON terminal.id=launch.terminal_id WHERE launch.workspace_id=? AND launch.agent_id=? AND (launch.status IN ('preparing','uncertain') OR terminal.status IN ('running','stopping'))`).get(project.workspace_id, launchAgentId).n;
    if (occupied >= current.snapshot.max_concurrent_sessions) throw validationError('This agent already has its allowed active or uncertain native work. Inspect or stop the existing session before launching another.');
    // Keep activity in the launch argument only, not in a second persisted copy.
    db.prepare(`INSERT INTO ${tables.launches}(workspace_id,request_id,project_id,agent_id,actor_id,profile_version,snapshot_hash,snapshot_json,prompt_hash,prompt_text,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(project.workspace_id, body.request_id, project.id, launchAgentId, actor.id, current.snapshot.version, current.hash, current.json, promptHash, reviewedPrompt, 'preparing', stamp());
    if (body.view_id) db.prepare(`INSERT INTO ${tables.launchViews} VALUES (?,?,?,?)`).run(project.workspace_id, body.request_id, project.id, body.view_id);
    return { ...current, prompt, promptHash, requestId: body.request_id };
  }
  async function startTerminal(project, body, actor, reviewedActivityContext) {
    if (body.confirm_execution !== true) throw validationError('Confirm that this terminal can run commands on your computer. It is not a sandbox.');
    for (const key of ['cwd', 'env', 'executable', 'args', 'resumeSessionId', 'session_id']) if (Object.hasOwn(body, key)) throw validationError('Terminal working directories, executables and native session IDs are selected by the local server.');
    if (Object.hasOwn(body, 'reviewedActivityContext') || Object.hasOwn(body, 'reviewed_activity_context')) throw validationError('Recent workspace activity is selected by an approved local schedule, not a launch request.');
    assertDirectoryMutable?.(project.workspace_id);
    const viewId = body.view_id == null ? null : body.view_id;
    if (viewId !== null && !stableIdentity(viewId)) throw validationError('Choose a valid terminal view.');
    const ownerKey = viewId ? viewKey(project, viewId) : null;
    if (ownerKey && stoppingViews.has(ownerKey)) throw Object.assign(validationError('This terminal view is being stopped. Wait before starting another session.'), { statusCode: 409 });
    // Returning an already-created exact request must not be blocked by the new
    // process limit, and must never spawn a duplicate task after a lost response.
    if ((body.agent_id != null || body.route_id != null) && typeof body.request_id === 'string' && db.prepare(`SELECT 1 FROM ${tables.launches} WHERE workspace_id=? AND request_id=?`).get(project.workspace_id, body.request_id)) {
      const replay = nativeLaunchIntent(project, body, actor, reviewedActivityContext);
      if (replay?.existingTerminal) return replay.existingTerminal;
    }
    const settings = prefs(project);
    if ([...active.values()].filter(item => item.projectId === project.id).length + (pendingStarts.get(project.id) || 0) >= settings.maxTerminals) throw validationError(`This ${workspaceTerminalScope ? 'workspace' : 'project'} already has ${settings.maxTerminals} active terminals. Stop one or raise the terminal limit in Settings.`);
    pendingStarts.set(project.id, (pendingStarts.get(project.id) || 0) + 1);
    if (ownerKey) pendingViewStarts.set(ownerKey, (pendingViewStarts.get(ownerKey) || 0) + 1);
    let intent = null, spawnAttempted = false, resumeSelection = null, resumeSpawned = false, resumeReleased = false;
    const releaseResume = () => { if (resumeReleased) return; resumeReleased = true; try { resumeSelection?.release?.(); } catch { /* Native exit must not be hidden by release bookkeeping. */ } };
    try {
    const root = workspaceTerminalScope ? await workspaceTerminalRoot(project) : await rootFor(project, body.environment_id);
    const rootIdentity = await stat(root, { bigint: true });
    const name = requiredText(body.name || 'Terminal', 'Terminal name', 80);
    const command = body.command == null ? null : requiredText(body.command, 'Command', 4000);
    intent = nativeLaunchIntent(project, body, actor, reviewedActivityContext);
    if (intent?.existingTerminal) return intent.existingTerminal;
    if (body.history_result_id != null) {
      if (!stableIdentity(body.history_result_id) || !['codex', 'claude'].includes(body.provider_id) || body.resume !== true || intent || command !== null || typeof authorizeTerminalResume !== 'function') throw validationError('Choose an available native Session History result before resuming.');
      resumeSelection = await authorizeTerminalResume({ workspaceId: project.workspace_id, projectId: workspaceTerminalScope ? null : project.id, providerId: body.provider_id, historyResultId: body.history_result_id, actor });
      if (!resumeSelection || resumeSelection.providerId !== body.provider_id || !stableIdentity(resumeSelection.sessionId) || typeof resumeSelection.release !== 'function') throw validationError('The selected native session is no longer available. Search again.');
    }
    const plan = await createTerminalLaunchPlan({ providerId: body.provider_id, shellId: body.shell_id, command, resume: body.resume ?? false, ...(resumeSelection ? { resumeSessionId: resumeSelection.sessionId } : {}), ...(intent ? { initialPrompt: intent.prompt } : {}) }, { platform: terminalPlatform, env: terminalEnv, cliOverrides:workspaceCliPrefs(project.workspace_id).cliCommands || {}, ...(terminalResolveExecutable ? { resolveExecutable: terminalResolveExecutable } : {}) });
    const factory = await pty();
    if (closed) throw validationError('The server is closing. Reopen Workbench after it restarts.');
    const freshRoot = await realpath(root), freshIdentity = await stat(freshRoot, { bigint: true });
    if (freshRoot !== root || freshIdentity.dev !== rootIdentity.dev || freshIdentity.ino !== rootIdentity.ino) throw Object.assign(validationError('The terminal directory changed while opening. Choose it again; no process was started.'), { statusCode: 409 });
    const terminalId = uid('term');
    if (intent && (body.route_id ? nativeRouteSnapshot(project,body.route_id,body.provider_id,actor) : nativeAgentSnapshot(project, body.agent_id, body.provider_id, actor, body.environment_id || null)).hash !== intent.hash) throw Object.assign(validationError('The native agent changed while its executable was being prepared. Review the task again.'), { statusCode: 409 });
    // Reviewed provider IDs become server-selected argv, never a browser-supplied
    // executable. No startup profile or operator API credentials are inherited.
    spawnAttempted = true;
    const terminal = factory.spawn(plan.command, plan.args, { name: 'xterm-256color', cwd: root, env: plan.env, cols: 100, rows: 28 });
    // Keep a claimed native history session reserved even if saving its terminal
    // row fails and process cleanup is uncertain. Only confirmed exit releases it.
    resumeSpawned = true;
    if (resumeSelection) terminal.onExit(releaseResume);
    try {
      db.exec('SAVEPOINT frondose_terminal_view_launch');
      db.prepare(`INSERT INTO ${tables.terminals} (id,workspace_id,project_id,environment_id,name,cwd,command,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(terminalId, project.workspace_id, project.id, body.environment_id || null, intent ? intent.snapshot.name : name, root, plan.providerId ? `[${plan.providerId} CLI]` : command, 'running', stamp());
      if (viewId) db.prepare(`INSERT INTO ${tables.ownership} VALUES (?,?,?,?,?)`).run(terminalId, project.workspace_id, project.id, viewId, stamp());
      if (intent) db.prepare(`UPDATE ${tables.launches} SET terminal_id=?,status='launched' WHERE workspace_id=? AND request_id=?`).run(terminalId, project.workspace_id, intent.requestId);
      db.exec('RELEASE SAVEPOINT frondose_terminal_view_launch');
    } catch (error) { try { db.exec('ROLLBACK TO SAVEPOINT frondose_terminal_view_launch; RELEASE SAVEPOINT frondose_terminal_view_launch'); } catch { /* Preserve the original save failure. */ } try { terminal.kill(); } catch { /* The uncertain receipt prevents replay. */ } throw error; }
    let exited;
    const exitPromise = new Promise(resolveExit => { exited = resolveExit; });
    active.set(terminalId, { terminal, projectId: project.id, exitPromise, output: '', outputOffset: 0, outputDirty: false, outputTimer: null, outputWarning: null });
    recordActivity?.({ workspaceId: project.workspace_id, kind: 'terminal.started', entityId: terminalId });
    terminal.onData(chunk => saveOutput(terminalId, chunk));
    terminal.onExit(({ exitCode }) => {
      flushOutput(terminalId);
      active.delete(terminalId);
      if (!closed) db.prepare(`UPDATE ${tables.terminals} SET status=CASE WHEN status='stopping' THEN 'stopped' ELSE 'exited' END,exit_code=?,ended_at=? WHERE id=?`).run(exitCode ?? null, stamp(), terminalId);
      if (!closed) recordActivity?.({ workspaceId: project.workspace_id, kind: 'terminal.stopped', entityId: terminalId });
      outputWake.wake(terminalId);
      releaseResume();
      exited();
    });
    return terminalFor(project, terminalId);
    } catch (error) {
      if (intent && !intent.existingTerminal) db.prepare(`UPDATE ${tables.launches} SET status=? WHERE workspace_id=? AND request_id=? AND terminal_id IS NULL`).run(spawnAttempted ? 'uncertain' : 'failed', project.workspace_id, intent.requestId);
      throw error;
    } finally { if (!resumeSpawned) releaseResume(); pendingStarts.set(project.id, Math.max(0, (pendingStarts.get(project.id) || 1) - 1)); if (ownerKey) pendingViewStarts.set(ownerKey, Math.max(0, (pendingViewStarts.get(ownerKey) || 1) - 1)); }
  }

  function visibleTerminalIds(value) {
    let ids = value;
    if (typeof ids === 'string') { if (ids.length > 4000) throw validationError('Terminal attachment evidence is too large.'); try { ids = JSON.parse(ids); } catch { throw validationError('Invalid terminal attachment evidence.'); } }
    if (ids == null) return [];
    if (!Array.isArray(ids) || ids.length > 8 || ids.some(id => !stableIdentity(id)) || new Set(ids).size !== ids.length) throw validationError('Invalid terminal attachment evidence.');
    return [...ids].sort();
  }
  function terminalViewStatus(project, viewId, visibleIds = []) {
    if (!stableIdentity(viewId)) throw validationError('Choose a valid terminal view.');
    const key = viewKey(project, viewId);
    const rows = db.prepare(`SELECT terminal.id,terminal.name,terminal.status,ownership.view_id AS owner_view_id FROM ${tables.ownership} AS ownership JOIN ${tables.terminals} AS terminal ON terminal.id=ownership.terminal_id AND terminal.workspace_id=ownership.workspace_id AND terminal.project_id=ownership.project_id WHERE ownership.workspace_id=? AND ownership.project_id=? AND ownership.view_id=? AND terminal.status IN ('running','stopping','interrupted') ORDER BY terminal.id LIMIT 201`).all(project.workspace_id, project.id, viewId);
    const sessions = rows.slice(0, 200), stopIds = sessions.filter(row => ['running', 'stopping'].includes(row.status)).map(row => row.id).sort();
    const reasons = [], unknownIds = [];
    if (rows.length > 200) reasons.push('view_status_limited');
    for (const row of sessions) if (row.status === 'interrupted' || !active.has(row.id)) { reasons.push('session_exit_unconfirmed'); unknownIds.push(row.id); }
    for (const id of visibleIds) {
      const row = db.prepare(`SELECT terminal.status,ownership.view_id FROM ${tables.terminals} AS terminal LEFT JOIN ${tables.ownership} AS ownership ON ownership.terminal_id=terminal.id AND ownership.workspace_id=terminal.workspace_id AND ownership.project_id=terminal.project_id WHERE terminal.id=? AND terminal.workspace_id=? AND terminal.project_id=?`).get(id, project.workspace_id, project.id);
      if (!row) { reasons.push('attachment_unavailable'); unknownIds.push(id); }
      else if (['running', 'stopping', 'interrupted'].includes(row.status) && row.view_id !== viewId) { reasons.push('session_not_owned_by_view'); unknownIds.push(id); }
    }
    const legacyCount = db.prepare(`SELECT count(*) AS n FROM ${tables.terminals} AS terminal LEFT JOIN ${tables.ownership} AS ownership ON ownership.terminal_id=terminal.id WHERE terminal.workspace_id=? AND terminal.project_id=? AND terminal.status IN ('running','stopping') AND ownership.terminal_id IS NULL`).get(project.workspace_id, project.id).n;
    if (legacyCount) reasons.push('legacy_sessions_unattributed');
    const pending = pendingViewStarts.get(key) || 0;
    if (pending) reasons.push('session_start_pending');
    let attributedPending = 0;
    for (const [pendingKey, count] of pendingViewStarts) if (pendingKey.startsWith(JSON.stringify([project.workspace_id, project.id]).slice(0, -1) + ',')) attributedPending += count;
    if ((pendingStarts.get(project.id) || 0) > attributedPending) reasons.push('legacy_session_start_pending');
    const uncertain = workspaceTerminalScope ? [] : db.prepare(`SELECT launch.request_id,view.view_id FROM ${tables.launches} AS launch LEFT JOIN ${tables.launchViews} AS view ON view.workspace_id=launch.workspace_id AND view.request_id=launch.request_id WHERE launch.workspace_id=? AND launch.project_id=? AND launch.status='uncertain'`).all(project.workspace_id, project.id);
    if (uncertain.some(row => !row.view_id || row.view_id === viewId)) reasons.push('session_launch_uncertain');
    const state = reasons.length ? 'unknown' : stopIds.length ? 'running' : 'idle';
    const result = { workspace_id: project.workspace_id, project_id: workspaceTerminalScope ? null : project.id, ...(workspaceTerminalScope ? { host_scope: 'workspace' } : {}), view_id: viewId, state, verified: state !== 'unknown', can_stop: state === 'running', sessions, stop_session_ids: stopIds, unknown_session_ids: [...new Set(unknownIds)].sort(), pending_count: pending, reason: [...new Set(reasons)].sort().join(',') || null };
    return { ...result, fingerprint: createHash('sha256').update(JSON.stringify({ ...result, visible_ids: visibleIds })).digest('hex') };
  }
  async function stopTerminalView(project, viewId, body) {
    if (body.confirmed !== true) throw validationError('Explicitly confirm stopping this tab’s owned sessions.');
    const visibleIds = visibleTerminalIds(body.visible_ids), before = terminalViewStatus(project, viewId, visibleIds), expected = visibleTerminalIds(body.expected_session_ids);
    if (!before.verified || body.fingerprint !== before.fingerprint || JSON.stringify(expected) !== JSON.stringify(before.stop_session_ids)) throw Object.assign(validationError('This tab’s sessions changed or ownership is uncertain. Nothing was stopped; refresh and review again.'), { statusCode: 409 });
    const key = viewKey(project, viewId);
    if (stoppingViews.has(key)) throw Object.assign(validationError('A stop request for this tab is already pending.'), { statusCode: 409 });
    stoppingViews.add(key);
    try {
      const waits = [];
      for (const id of expected) {
        const live = active.get(id);
        if (!live) throw Object.assign(validationError('Session exit is uncertain. Keep the tab open and refresh its status.'), { statusCode: 409 });
        db.prepare(`UPDATE ${tables.terminals} SET status='stopping' WHERE id=?`).run(id);
        try { live.terminal.kill(); } catch { throw Object.assign(validationError('A session could not be stopped. Keep the tab open and review the current status.'), { statusCode: 409 }); }
        waits.push(new Promise(resolveWait => { let done = false; const finish = result => { if (done) return; done = true; clearTimeout(timer); resolveWait(result); }; const timer = setTimeout(() => finish(false), 2000); live.exitPromise.then(() => finish(true)); }));
      }
      if ((await Promise.all(waits)).some(exited => !exited)) throw Object.assign(validationError('Stop was requested, but session exit is not confirmed. Keep the tab open and refresh; nothing will be replayed.'), { statusCode: 409 });
      const after = terminalViewStatus(project, viewId, visibleIds);
      if (!after.verified || after.state !== 'idle') throw Object.assign(validationError('The tab still has active or uncertain work. Keep it open and refresh its status.'), { statusCode: 409 });
      return { workspace_id: project.workspace_id, project_id: workspaceTerminalScope ? null : project.id, ...(workspaceTerminalScope ? { host_scope: 'workspace' } : {}), view_id: viewId, state: 'idle', stopped: true, stopped_session_ids: expected };
    } finally { stoppingViews.delete(key); }
  }
  async function dispatch(project, action, method, body, url, { actor, reviewedActivityContext } = {}) {
    if (workspaceTerminalScope) {
      if (actor?.id !== 'local-owner') throw Object.assign(validationError('Workspace host terminals are available only to the local owner.'), { statusCode: 403 });
      if (body.project_id || url.searchParams.get('project_id') || body.environment_id || url.searchParams.get('environment_id') || body.agent_id != null) throw validationError('Workspace host terminals cannot select project, environment or personalized-agent authority.');
      if (!(!action || action === 'terminal-providers' || action === 'cli-settings' || action === 'terminals' || action === 'settings' || /^commands(?:\/[A-Za-z0-9_-]+)?$/.test(action) || /^terminals\/[A-Za-z0-9_-]+(?:\/(?:input|resize|stop))?$/.test(action) || /^terminal-views\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199}(?:\/stop)?$/.test(action))) throw validationError('Workspace host scope supports terminals and Quick Commands only; choose a project directory for files or Git.');
      for (const key of ['cwd', 'path', 'env', 'environment', 'root', 'local_path', 'executable', 'args']) if (Object.hasOwn(body, key) || url.searchParams.has(key)) throw validationError('Terminal working directories and executables are selected by the local server.');
    }
    const environmentId = body.environment_id || url.searchParams.get('environment_id') || null;
    const path = url.searchParams.get('path') || '';
    if (!action && method === 'GET') return summary(project, environmentId);
    const terminalView = /^terminal-views\/([A-Za-z0-9][A-Za-z0-9._:-]{0,199})(?:\/(stop))?$/.exec(action);
    if (terminalView && method === 'GET' && !terminalView[2]) return terminalViewStatus(project, terminalView[1], visibleTerminalIds(url.searchParams.get('visible_ids')));
    if (terminalView && method === 'POST' && terminalView[2] === 'stop') return stopTerminalView(project, terminalView[1], body);
    if(action==='cli-settings'){
      if(actor?.id!=='local-owner')throw Object.assign(validationError('CLI settings belong to the local owner.'),{statusCode:403});
      const saved=workspaceCliPrefs(project.workspace_id);
      if(method==='GET')return {revision:saved.cliRevision||0,commands:saved.cliCommands||{}};
      if(method==='PATCH'){
        if(body.confirmed!==true)throw validationError('Confirm changes to future CLI launches.');
        if(body.expected_revision!==(saved.cliRevision||0))throw Object.assign(validationError('CLI settings changed. Reload before saving.'),{statusCode:409});
        const commands=cliCommandPreferences(body.commands,TERMINAL_PROVIDER_CATALOG,terminalPlatform);
        const next={...saved,cliCommands:commands,cliRevision:(saved.cliRevision||0)+1};
        db.prepare('INSERT INTO local_workspace_terminal_preferences(project_id,workspace_id,settings_json) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json').run(project.workspace_id,project.workspace_id,JSON.stringify(next));
        return {revision:next.cliRevision,commands};
      }
      throw validationError('Unsupported CLI settings action.');
    }
    if (action === 'terminal-providers' && method === 'GET') return { providers: await detectTerminalProviders({ platform: terminalPlatform, env: terminalEnv, cliOverrides:workspaceCliPrefs(project.workspace_id).cliCommands || {}, ...(terminalResolveExecutable ? { resolveExecutable: terminalResolveExecutable } : {}) }), shells: terminalShells(terminalPlatform) };
    if(action === 'route-task-preview' && method === 'GET') { const current=nativeRouteSnapshot(project,url.searchParams.get('route_id'),url.searchParams.get('provider_id'),actor); return {route_id:current.snapshot.route_id,name:current.snapshot.name,provider_id:current.snapshot.provider,version:current.snapshot.version,snapshot_hash:current.hash,binding_version:current.snapshot.binding_version,prompt:current.prompt}; }
    if (action === 'native-agent-preview' && method === 'GET') {
      const current = nativeAgentSnapshot(project, url.searchParams.get('agent_id'), url.searchParams.get('provider_id'), actor, environmentId);
      return { agent_id: current.snapshot.agent_id, name: current.snapshot.name, provider_id: current.snapshot.provider, instructions: current.snapshot.instructions, version: current.snapshot.version, snapshot_hash: current.hash };
    }
    if (action === 'settings' && method === 'PATCH') {
      if (Object.hasOwn(body, 'expected_binding_version')) {
        const hasBindings = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='directory_workspaces'").get();
        const binding = hasBindings ? db.prepare('SELECT project_id,version FROM directory_workspaces WHERE workspace_id=?').get(project.workspace_id) : null;
        const expected = body.expected_binding_version;
        if (expected === null ? Boolean(binding) : workspaceTerminalScope || !binding || expected !== binding.version || binding.project_id !== project.id) throw Object.assign(validationError('The workspace directory changed. Reload terminal settings before saving.'), { statusCode: 409, code: 'directory_conflict', errorCode: 'directory_conflict' });
      }
      const next = prefs(project);
      for (const key of ['showFiles', 'wrapFiles', 'showHiddenFiles']) if (body[key] !== undefined) { if (typeof body[key] !== 'boolean') throw validationError('Display preferences must be true or false.'); next[key] = body[key]; }
      for (const [key, min, max] of [['terminalFontSize', 11, 22], ['maxTerminals', 1, 8]]) if (body[key] !== undefined) { if (!Number.isInteger(body[key]) || body[key] < min || body[key] > max) throw validationError(`${key} must be between ${min} and ${max}.`); next[key] = body[key]; }
      db.prepare(`INSERT INTO ${tables.preferences} (project_id,workspace_id,settings_json) VALUES (?,?,?) ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json`).run(project.id, project.workspace_id, JSON.stringify(next));
      return { settings: next };
    }
    if (action === 'commands' && method === 'POST') {
      if (db.prepare(`SELECT count(*) AS n FROM ${tables.commands} WHERE project_id=? AND workspace_id=?`).get(project.id, project.workspace_id).n >= 100) throw validationError('Keep at most 100 Quick Commands for this project.');
      const item = { id: uid('cmd'), name: requiredText(body.name, 'Command name', 80), command: requiredText(body.command, 'Command', 4000), created_at: stamp() };
      db.prepare(`INSERT INTO ${tables.commands} VALUES (?,?,?,?,?,?)`).run(item.id, project.workspace_id, project.id, item.name, item.command, item.created_at);
      return item;
    }
    if (action.startsWith('commands/') && method === 'DELETE') {
      db.prepare(`DELETE FROM ${tables.commands} WHERE id=? AND project_id=? AND workspace_id=?`).run(action.slice(9), project.id, project.workspace_id);
      return { ok: true };
    }
    if (action.startsWith('commands/') && method === 'PATCH') {
      const id = action.slice(9);
      if (!db.prepare(`SELECT id FROM ${tables.commands} WHERE id=? AND project_id=? AND workspace_id=?`).get(id, project.id, project.workspace_id)) throw validationError('This command is unavailable in the current project.');
      db.prepare(`UPDATE ${tables.commands} SET name=?,command=? WHERE id=? AND project_id=? AND workspace_id=?`).run(requiredText(body.name, 'Command name', 80), requiredText(body.command, 'Command', 4000), id, project.id, project.workspace_id);
      return { ok: true };
    }
    if (action === 'terminals' && method === 'POST') return startTerminal(project, body, actor, reviewedActivityContext);
    if (action.startsWith('terminals/')) {
      const [, terminalId, operation] = action.split('/');
      let terminal = terminalFor(project, terminalId);
      if (!operation && method === 'GET') {
        const cursor = Number(url.searchParams.get('cursor')) || 0;
        const wait = Number(url.searchParams.get('wait_ms') || 0);
        if (!Number.isInteger(wait) || wait < 0 || wait > 80) throw validationError('Terminal output wait must be between 0 and 80 milliseconds.');
        if (wait && active.has(terminalId) && cursor === terminal.output_offset + terminal.output.length) {
          await outputWake.wait(terminalId, wait, () => { const current = terminalFor(project, terminalId); return !active.has(terminalId) || cursor !== current.output_offset + current.output.length; });
          terminal = terminalFor(project, terminalId);
        }
        return { ...terminal, output: terminal.output.slice(Math.max(0, cursor - terminal.output_offset)), reset: cursor < terminal.output_offset, cursor: terminal.output_offset + terminal.output.length };
      }
      if (!operation && method === 'PATCH') {
        db.prepare(`UPDATE ${tables.terminals} SET name=? WHERE id=?`).run(requiredText(body.name, 'Terminal name', 80), terminalId);
        return { ok: true };
      }
      const live = active.get(terminalId);
      if (operation === 'resize' && method === 'POST' && !live) return { ok: true, ended: true };
      if (operation === 'stop' && method === 'POST' && !live) {
        // This installation owns the PTY map. A record without an owned
        // process cannot remain a permanent running/stopping blocker.
        db.prepare(`UPDATE ${tables.terminals} SET status='interrupted',ended_at=? WHERE id=? AND status IN ('running','stopping')`).run(stamp(),terminalId);
        return { ok: true, ended: true };
      }
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
        db.prepare(`UPDATE ${tables.terminals} SET status='stopping' WHERE id=?`).run(terminalId);
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
      db.prepare(`INSERT INTO ${tables.environments} VALUES (?,?,?,?,?,?,?)`).run(environment.id, project.workspace_id, project.id, environment.name, environment.path, branch, environment.created_at);
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
  async function handle({ req, res, path, url, readBody, send, actor }) {
    if (path !== '/workbench' && !path.startsWith('/workbench/')) return false;
    const body = ['POST', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
    const host = body.host_scope || url.searchParams.get('host_scope');
    if (host && host !== 'workspace') throw validationError('Choose a supported local terminal host scope.');
    if (host === 'workspace') {
      if (body.project_id || url.searchParams.get('project_id') || body.environment_id || url.searchParams.get('environment_id')) throw validationError('Workspace terminals cannot select a project or environment.');
      const service = workspaceTerminals || { scope, dispatch }, project = service.scope(body.workspace_id || url.searchParams.get('workspace_id'));
      const result = await service.dispatch(project, path.slice('/workbench'.length).replace(/^\//, ''), req.method, body, url, { actor });
      send(res, 200, { result }); return true;
    }
    const project = scope(body.workspace_id || url.searchParams.get('workspace_id'), body.project_id || url.searchParams.get('project_id'));
    const result = await dispatch(project, path.slice('/workbench'.length).replace(/^\//, ''), req.method, body, url, { actor });
    send(res, 200, { result }); return true;
  }
  function close() {
    if (closed) return;
    workspaceTerminals?.close();
    for (const id of active.keys()) flushOutput(id);
    closed = true;
    outputWake.close();
    for (const [id, item] of active) {
      db.prepare(`UPDATE ${tables.terminals} SET status='interrupted',ended_at=? WHERE id=?`).run(stamp(), id);
      item.terminal.kill();
    }
    active.clear(); pendingStarts.clear(); pendingViewStarts.clear(); stoppingViews.clear();
  }
  function activeSessionsFor(resource, itemId) {
    if (!['projects', 'workspaces'].includes(resource)) return [];
    const column = resource === 'projects' ? 'project_id' : 'workspace_id';
    if (workspaceTerminalScope && resource !== 'workspaces') return [];
    const sessions = db.prepare(`SELECT id,project_id,workspace_id,status,name FROM ${tables.terminals} WHERE ${column}=? AND status IN ('running','stopping')`).all(itemId).map(row => workspaceTerminalScope ? { ...row, project_id: null, host_scope: 'workspace' } : row);
    // A root cannot change while launch is awaiting filesystem/discovery/native
    // setup, before its real terminal row exists. Reservations never grant access.
    for (const [projectId, count] of pendingStarts) if (count > 0) {
      const project = workspaceTerminalScope ? { id: projectId, workspace_id: projectId } : db.prepare('SELECT id,workspace_id FROM projects WHERE id=?').get(projectId);
      if (project && (resource === 'projects' ? projectId === itemId : project.workspace_id === itemId)) sessions.push({ id: `pending-terminal:${projectId}`, project_id: workspaceTerminalScope ? null : projectId, workspace_id: project.workspace_id, status: 'starting', ...(workspaceTerminalScope ? { host_scope: 'workspace' } : {}) });
    }
    if (!workspaceTerminalScope) for (const receipt of db.prepare(`SELECT request_id,project_id,workspace_id FROM ${tables.launches} WHERE ${column}=? AND status='uncertain'`).all(itemId)) sessions.push({ id: `uncertain-native:${receipt.request_id}`, project_id: receipt.project_id, workspace_id: receipt.workspace_id, status: 'uncertain' });
    return [...sessions, ...(workspaceTerminals?.activeSessionsFor(resource, itemId) || [])];
  }
  // Native updater only: capture an actual owned PTY, not a client PID,
  // stale running row, pending launch or uncertain receipt.
  function updaterTerminalTargets(limit = 24) {
    if (closed || limit <= 0) return [];
    const targets = [];
    const select = db.prepare(`SELECT t.name,t.status,w.name AS workspace,p.name AS project FROM ${tables.terminals} t JOIN workspaces w ON w.id=t.workspace_id LEFT JOIN projects p ON p.id=t.project_id WHERE t.id=? AND t.project_id=?`);
    const requestStop = db.prepare(`UPDATE ${tables.terminals} SET status='stopping' WHERE id=? AND status='running'`);
    const undoStop = db.prepare(`UPDATE ${tables.terminals} SET status='running' WHERE id=? AND status='stopping'`);
    for (const [id, live] of active) {
      const row = select.get(id, live.projectId);
      if (row?.status !== 'running') continue;
      targets.push({ key: id, identity: live, item: { kind: 'terminal', label: row.name, workspace: row.workspace, project: workspaceTerminalScope ? null : row.project }, stop() {
        if (closed || active.get(id) !== live || requestStop.run(id).changes !== 1) return false;
        try { live.terminal.kill(); }
        catch { if (active.get(id) === live) undoStop.run(id); return false; }
        if (active.get(id) !== live) return true;
        return new Promise(resolveExit => {
          const timer = setTimeout(() => resolveExit(false), 2000);
          void live.exitPromise.then(() => { clearTimeout(timer); resolveExit(true); });
        });
      } });
      if (targets.length >= limit) break;
    }
    return [...targets, ...(workspaceTerminals?.updaterTerminalTargets(limit - targets.length) || [])];
  }
  const checkpointAdapter = { checkpointRoot, checkpointPaths, checkpointState, stageCheckpointState, applyCheckpointState, cleanupCheckpointStage };
  return { handle, close, scope, dispatch, summary, activeSessionsFor, updaterTerminalTargets, checkpointAdapter };
}

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, opendir, readdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve, sep, win32 } from 'node:path';
import { validationError } from './validation.mjs';
import { richPreviewType, MAX_PREVIEW_BYTES } from '../src/lib/rich-previews.js';

const MAX_FILE = 512_000;
const MAX_SEARCH_ENTRIES = 2500;
const MAX_SEARCH_BYTES = 8_000_000;
const MAX_RESULTS = 100;
const PRIVATE = /^(?:\.git|\.env(?:\..*)?|\.ssh|\.aws|\.config|\.codex|\.claude|\.rumbo|\.talvori|\.frondose|\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.htpasswd|node_modules|\.next|\.cache|\.DS_Store|id_rsa(?:\..*)?|id_ed25519(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx|sqlite|sqlite3|db))$/i;
const problem = (message, code = 'validation_error', statusCode = 400) => Object.assign(validationError(message), { code, errorCode: code, statusCode });
const conflict = message => problem(message, 'directory_conflict', 409);
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = info => `${info.dev}:${info.ino}`;
const inside = (root, value) => { const path = relative(root, value); return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path)); };

export function directoryRelativePath(value = '', { allowRoot = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048 || value.includes('\0') || isAbsolute(value) || win32.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes(':')) throw problem('Choose a relative path inside this workspace.');
  const parts = value.split(/[\\/]/);
  if (parts.some(part => part === '..' || part === '.' || PRIVATE.test(part))) throw problem('This path is outside the workspace or contains private files.');
  const clean = parts.filter(Boolean).join('/');
  if (!allowRoot && !clean) throw problem('Choose a file inside this workspace.');
  return clean;
}

export function installDirectoryWorkspaces(db) {
  // This is installation authority, deliberately omitted from portable exports.
  // GET never adopts a legacy folder automatically.
  db.exec(`CREATE TABLE IF NOT EXISTS directory_workspaces (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL, root_identity TEXT NOT NULL, version TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

/** Explicit owner-selected roots and bounded local text editing. This filesystem
 * API does not sandbox native terminal processes or isolate external OS writers. */
export function createDirectoryWorkspaceService({ db, dataDir, activeSessionsFor = () => [], allowed, openDirectory = opendir, recordActivity = () => {} } = {}) {
  installDirectoryWorkspaces(db);
  const queues = new Map();
  const privateRoot = resolve(dataDir);
  const tableExists = name => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  async function noteActivity(event) {
    try { await recordActivity(event); } catch { /* A completed local write must not be reported as failed. */ }
  }

  function authorize(workspaceId, actor, permission = 'workbench.read', projectId = null) {
    if (actor?.id !== 'local-owner') throw problem('This local workspace is available only to its owner.', 'access_denied', 403);
    if (typeof workspaceId !== 'string' || !workspaceId || !db.prepare('SELECT id FROM workspaces WHERE id=? AND archived_at IS NULL').get(workspaceId)) throw problem('Choose an active workspace.');
    if (allowed && !allowed(workspaceId, actor, permission, projectId ? { scope_type: 'project', scope_id: projectId } : {})) throw problem(`Permission required: ${permission}.`, 'access_denied', 403);
  }
  function binding(workspaceId) { return db.prepare('SELECT * FROM directory_workspaces WHERE workspace_id=?').get(workspaceId); }
  function projectFor(workspaceId, projectId) {
    const project = db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(projectId || '', workspaceId);
    if (!project) throw problem('Choose an active project belonging to this workspace.');
    return project;
  }
  async function serialize(key, fn) {
    const previous = queues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(fn);
    queues.set(key, current);
    try { return await current; } finally { if (queues.get(key) === current) queues.delete(key); }
  }
  async function validateDirectory(value) {
    if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096 || value.includes('\0')) throw problem('Choose an absolute project directory on this computer.');
    let root, info;
    try { root = await realpath(value); info = await stat(root, { bigint: true }); } catch { throw problem('This directory is unavailable. Choose it again when it is accessible.'); }
    if (!info.isDirectory()) throw problem('Choose a project directory, not a file.');
    const home = await realpath(homedir());
    if (root === parse(root).root || inside(root, home) || root.split(sep).some(part => PRIVATE.test(part))) throw problem('Choose a specific project directory, not home, a filesystem root or a private application directory.');
    const canonicalPrivateRoot = await realpath(privateRoot);
    if (inside(root, canonicalPrivateRoot) || inside(canonicalPrivateRoot, root)) throw problem('Frondose private storage cannot be used as a workspace directory.');
    // A successful stat does not demonstrate listing permission (for example,
    // macOS protected folders). Open/close a directory handle without enumerating
    // names. This is present read access, not a grant for future files or tools.
    let handle;
    try { handle = await openDirectory(root); }
    catch { throw problem('This directory cannot be opened. Grant this process read access or choose another directory.'); }
    try { await handle.close(); }
    catch { throw problem('The directory could not be checked completely. Choose it again when it is accessible.'); }
    return { root, info };
  }
  async function currentRoot(workspaceId, actor, permission = 'workbench.read') {
    const row = binding(workspaceId);
    if (!row) throw problem('Choose this workspace’s project directory first.', 'directory_not_bound', 409);
    authorize(workspaceId, actor, permission, row.project_id);
    const project = projectFor(workspaceId, row.project_id);
    const checked = await validateDirectory(row.path);
    if (checked.root !== row.path || identity(checked.info) !== row.root_identity || project.local_path !== row.path) throw conflict('The linked directory changed. Choose and confirm the directory again; no alternate folder was opened.');
    return { ...checked, row, project };
  }
  function directoryBlockers(workspaceId) {
    const sessions=activeSessionsFor(workspaceId)??[];
    const terminals=new Map();
    for(const [table,scope] of [['workbench_terminals','project'],['local_workspace_terminals','workspace']]){
      if(!tableExists(table))continue;
      for(const row of db.prepare(`SELECT id,project_id,name,status FROM ${table} WHERE workspace_id=? AND status IN ('running','stopping') LIMIT 40`).all(workspaceId)){
        terminals.set(row.id,{id:row.id,name:row.name,projectId:scope==='project'?row.project_id:null,scope,status:row.status});
      }
    }
    const runs=tableExists('runs')?db.prepare("SELECT id FROM runs WHERE workspace_id=? AND status IN ('queued','starting','running','needs_input','paused')").all(workspaceId):[];
    const ids=new Set([...runs,...sessions].map(row=>row.id).filter(id=>!terminals.has(id)));
    return {terminals:[...terminals.values()],other:ids.size};
  }
  const anyActive=workspaceId=>{const blockers=directoryBlockers(workspaceId);return Boolean(blockers.terminals.length||blockers.other);};
  async function get(workspaceId, actor) {
    authorize(workspaceId, actor);
    const row = binding(workspaceId);
    const projects = db.prepare('SELECT * FROM projects WHERE workspace_id=? AND archived_at IS NULL ORDER BY name,id').all(workspaceId)
      .filter(project => !allowed || allowed(workspaceId, actor, 'projects.read', { scope_type: 'project', scope_id: project.id }))
      .map(project => ({ id: project.id, name: project.name, path: project.local_path || null }));
    const result = { workspaceId, bound: Boolean(row), ready: false, binding: row ? { projectId: row.project_id, path: row.path, version: row.version } : null, projects, blockers:directoryBlockers(workspaceId) };
    if (row) {
      try { await currentRoot(workspaceId, actor); result.ready = true; }
      catch (error) { if (error.statusCode === 403) throw error; result.error = error.message; result.errorCode = error.errorCode; }
    }
    return result;
  }
  async function bind(workspaceId, actor, input) {
    return serialize(`workspace:${workspaceId}`, async () => {
      authorize(workspaceId, actor, 'projects.write', input.project_id);
      authorize(workspaceId, actor, 'workbench.execute', input.project_id);
      if (input.confirmed !== true) throw problem('Confirm linking this directory. Existing workspace content and folders will not be moved.');
      projectFor(workspaceId, input.project_id);
      const previous = binding(workspaceId);
      if (previous ? input.expected_version !== previous.version : input.expected_version != null) throw conflict('The workspace directory selection changed. Refresh before linking it.');
      const activeBeforeCheck=anyActive(workspaceId);
      if(activeBeforeCheck&&!(previous?.project_id===input.project_id&&previous.path===input.path))throw conflict('Stop this workspace’s active work and terminals before changing its directory.');
      const checked = await validateDirectory(input.path);
      const rootIdentity=identity(checked.info);
      // Recheck after asynchronous filesystem checks; no partially changed root.
      const activeAfterCheck=anyActive(workspaceId);
      if(activeBeforeCheck||activeAfterCheck){
        if(previous?.project_id===input.project_id&&previous.path===checked.root&&previous.root_identity===rootIdentity
          &&projectFor(workspaceId,input.project_id).local_path===checked.root)return get(workspaceId,actor);
        throw conflict(activeBeforeCheck?'Stop this workspace’s active work and terminals before changing its directory.':'Work started while linking the directory. Stop it before changing the root.');
      }
      projectFor(workspaceId, input.project_id);
      const version = randomUUID(), at = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE projects SET local_path=? WHERE id=? AND workspace_id=?').run(checked.root, input.project_id, workspaceId);
        db.prepare(`INSERT INTO directory_workspaces(workspace_id,project_id,path,root_identity,version,updated_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(workspace_id) DO UPDATE SET project_id=excluded.project_id,path=excluded.path,root_identity=excluded.root_identity,version=excluded.version,updated_at=excluded.updated_at`).run(workspaceId, input.project_id, checked.root, rootIdentity, version, at);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      if (!previous || previous.project_id !== input.project_id || previous.path !== checked.root || previous.root_identity !== rootIdentity) {
        await noteActivity({ workspaceId, kind: 'directory.linked', title: 'Project directory linked', entityId: input.project_id });
      }
      return get(workspaceId, actor);
    });
  }
  async function targetFor(root, path, { allowRoot = false, absent = false } = {}) {
    const clean = directoryRelativePath(path, { allowRoot });
    const parts = clean ? clean.split('/') : [];
    let target = root;
    for (let index = 0; index < parts.length; index++) {
      target = join(target, parts[index]);
      let info;
      try { info = await lstat(target, { bigint: true }); }
      catch (error) { if (absent && error.code === 'ENOENT' && index === parts.length - 1) return { clean, target, parent: dirname(target), absent: true }; throw problem('This file or folder is unavailable.'); }
      if (info.isSymbolicLink()) throw problem('Symbolic links cannot be opened or edited through the workspace file API.');
      if (index < parts.length - 1 && !info.isDirectory()) throw problem('The destination parent is not a directory.');
    }
    const actual = await realpath(target);
    if (!inside(root, actual)) throw problem('This path is outside the workspace.');
    return { clean, target, parent: dirname(target), absent: false };
  }
  async function readTarget(root, path, { preview = false, raw = false, rich = false } = {}) {
    const target = await targetFor(root, path);
    let handle;
    try {
      handle = await open(target.target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.nlink > 1n) throw problem('Choose a regular, non-linked UTF-8 text file smaller than 512 KB.');
      if (rich && (!richPreviewType(path) || before.size > BigInt(MAX_PREVIEW_BYTES))) throw problem('This preview format is unsupported or the file exceeds 25 MB.');
      if (!rich && !preview && !raw && before.size > BigInt(MAX_FILE)) throw problem('Choose a regular, non-linked UTF-8 text file smaller than 512 KB.');
      const limit = rich ? Number(before.size) + 1 : raw ? 65536 : before.size > BigInt(MAX_FILE) ? 0 : MAX_FILE + 1;
      const bytes = Buffer.alloc(limit);
      let offset = 0;
      while (offset < bytes.length) { const read = await handle.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
      const content = bytes.subarray(0, offset);
      const after = await handle.stat({ bigint: true });
      const expectedSize = raw ? after.size < 65536n ? after.size : 65536n : limit ? after.size : 0n;
      if (BigInt(content.length) !== expectedSize || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw conflict('The file changed while it was being read. Open it again.');
      // Verify the visible path still resolves to the handle we actually read.
      const again = await targetFor(root, path), visible = await lstat(again.target, { bigint: true });
      if (identity(after) !== identity(visible)) throw conflict('The file was replaced while it was being read. Open it again.');
      if (rich) return { path: target.clean, ...richPreviewType(path), base64: content.toString('base64'), size: content.length, version: hash(content), read_only: true };
      if (raw) return { path: target.clean, read_only: true, raw_preview: content.toString('utf8').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, value => `⟦${value.charCodeAt(0).toString(16).padStart(2, '0')}⟧`), size: Number(after.size), preview_bytes: content.length, truncated: after.size > BigInt(content.length), modified_at: new Date(Number(after.mtimeMs)).toISOString() };
      const unsupported = after.size > BigInt(MAX_FILE) ? 'large' : content.includes(0) ? 'binary' : !Buffer.from(content.toString('utf8'), 'utf8').equals(content) ? 'encoding' : null;
      if (unsupported) {
        if (!preview) throw problem('This is not a supported UTF-8 text file.');
        return { path: target.clean, unsupported, size: Number(after.size), raw_preview_available: true };
      }
      return { path: target.clean, content: content.toString('utf8'), size: content.length, version: hash(`${identity(after)}:${after.mtimeNs}:${after.ctimeNs}:${after.mode}:${hash(content)}`), modified_at: new Date(Number(after.mtimeMs)).toISOString(), mode: Number(after.mode & 0o777n) };
    } finally { await handle?.close(); }
  }
  async function tree(workspaceId, actor, path = '') {
    const { root } = await currentRoot(workspaceId, actor);
    const target = await targetFor(root, path, { allowRoot: true });
    if (!(await stat(target.target)).isDirectory()) throw problem('Choose a folder to browse.');
    const all = await readdir(target.target, { withFileTypes: true });
    const entries = all.filter(entry => !PRIVATE.test(entry.name)).map(entry => ({ name: entry.name, path: [target.clean, entry.name].filter(Boolean).join('/'), type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'link' : 'file' }))
      .sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name));
    return { path: target.clean, entries: entries.slice(0, 500), limited: entries.length > 500 };
  }
  async function file(workspaceId, actor, path, expectedBindingVersion) {
    const { root, row } = await currentRoot(workspaceId, actor);
    // Existing API callers may omit this guard, but editor tabs always send
    // their root revision so a restored view never opens a different root's
    // same-name file after another window changes the workspace selection.
    if (expectedBindingVersion !== undefined && expectedBindingVersion !== row.version) throw conflict('The workspace directory selection changed. Open this file from the current directory; any cached draft has been retained.');
    const { mode, ...result } = await readTarget(root, path, { preview: true });
    // Keep editor view mode separate from OS mode bits. Permission bits are a
    // conservative hint, not an ACL/access guarantee; actual I/O can still fail.
    return { ...result, ...(mode === undefined ? {} : { read_only: (mode & 0o222) === 0 }) };
  }
  async function rawFile(workspaceId, actor, path, expectedBindingVersion) {
    const { root, row } = await currentRoot(workspaceId, actor);
    if (expectedBindingVersion !== row.version) throw conflict('The workspace directory changed. Open this file again from the current directory.');
    return readTarget(root, path, { raw: true });
  }
  async function richFile(workspaceId, actor, path, expectedBindingVersion) {
    const { root, row } = await currentRoot(workspaceId, actor);
    if (expectedBindingVersion !== row.version) throw conflict('The workspace directory changed. Open this file again.');
    const result = await readTarget(root, path, { rich: true });
    const fresh = await currentRoot(workspaceId, actor);
    if (fresh.row.version !== row.version) throw conflict('The workspace directory changed while opening the preview.');
    return result;
  }
  async function search(workspaceId, actor, query, mode = 'names') {
    if (typeof query !== 'string' || !query.trim() || query.length > 200 || !['names', 'contents'].includes(mode)) throw problem('Enter a search of up to 200 characters and choose Names or Contents.');
    const { root } = await currentRoot(workspaceId, actor);
    const needle = query.trim().toLocaleLowerCase(), entries = [], pending = [''];
    let visited = 0, bytes = 0, limited = false;
    while (pending.length) {
      const path = pending.shift(), target = await targetFor(root, path, { allowRoot: true });
      const children = (await readdir(target.target, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        if (++visited > MAX_SEARCH_ENTRIES || entries.length >= MAX_RESULTS || bytes >= MAX_SEARCH_BYTES) { limited = true; break; }
        if (PRIVATE.test(child.name) || child.isSymbolicLink()) continue;
        const childPath = [path, child.name].filter(Boolean).join('/');
        if (child.isDirectory()) pending.push(childPath);
        if (mode === 'names') {
          if (childPath.toLocaleLowerCase().includes(needle)) entries.push({ name: child.name, path: childPath, type: child.isDirectory() ? 'directory' : 'file' });
        } else if (child.isFile()) {
          try {
            const candidate = await readTarget(root, childPath); bytes += candidate.size;
            const offset = candidate.content.toLocaleLowerCase().indexOf(needle);
            if (offset !== -1) entries.push({ name: child.name, path: childPath, type: 'file', line: candidate.content.slice(0, offset).split('\n').length, snippet: candidate.content.slice(Math.max(0, offset - 60), offset + 180) });
          } catch (error) { if (error.errorCode !== 'validation_error' && error.errorCode !== 'directory_conflict') throw error; }
        }
      }
      if (limited) break;
    }
    return { entries, limited, mode, scanned: Math.min(visited, MAX_SEARCH_ENTRIES) };
  }
  async function save(workspaceId, actor, input) {
    return serialize(`workspace:${workspaceId}`, async () => {
      const context = await currentRoot(workspaceId, actor, 'workbench.execute');
      // A file's disk baseline alone cannot identify its selected root. In
      // particular, a new draft expects an absent file and could otherwise be
      // created in another window's newly linked directory without warning.
      if (input.expected_binding_version !== context.row.version) throw conflict('The workspace directory selection changed. Reopen this file from the current directory before saving; your draft has not been discarded.');
      return serialize(`root:${context.row.root_identity}`, async () => {
        if (input.confirmed !== true) throw problem('Confirm saving changes to this local file.');
        if (typeof input.content !== 'string' || Buffer.byteLength(input.content, 'utf8') > MAX_FILE || input.content.includes('\0')) throw problem('Save supported text under 512 KB.');
        const clean = directoryRelativePath(input.path), target = await targetFor(context.root, clean, { absent: true });
        if (target.absent && !/\.md$/i.test(clean)) throw problem('New files created here must use the .md extension.');
        if (target.absent ? input.expected_version !== null : typeof input.expected_version !== 'string') throw conflict('Refresh the file before saving. A new Markdown draft must explicitly expect an absent file.');
        let previous = null;
        if (!target.absent) {
          previous = await readTarget(context.root, clean);
          if (previous.version !== input.expected_version) throw conflict('The file changed on disk. Review the newer file before saving; your draft has not been discarded.');
          if ((previous.mode & 0o222) === 0) throw problem('This file has read-only permissions. Change them outside Frondose or download your draft.', 'file_read_only', 403);
        }
        const parentInfo = await stat(target.parent, { bigint: true });
        const temporary = join(target.parent, `.env.frondose-save-${randomUUID()}`);
        let staged;
        try {
          staged = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), previous?.mode ?? 0o600);
          await staged.writeFile(input.content, 'utf8'); await staged.sync(); await staged.close(); staged = null;
          const fresh = await currentRoot(workspaceId, actor, 'workbench.execute');
          if (fresh.row.version !== context.row.version || identity(await stat(target.parent, { bigint: true })) !== identity(parentInfo)) throw conflict('The workspace or parent folder changed during save. Your draft was retained.');
          const latest = await targetFor(context.root, clean, { absent: true });
          if (previous) { if (latest.absent || (await readTarget(context.root, clean)).version !== previous.version) throw conflict('The file changed during save. Your draft was retained.'); }
          else if (!latest.absent) throw conflict('A file was created at this path. Choose a different name; it was not overwritten.');
          // Atomic replacement never follows a target symlink. External writers
          // are not transactionally isolated; the disk baseline is checked above.
          if (previous) await rename(temporary, latest.target);
          else { try { await link(temporary, latest.target); await unlink(temporary); } catch (error) { if (error.code === 'EEXIST') throw conflict('A file was created at this path. Choose a different name; it was not overwritten.'); throw error; } }
          const saved = await file(workspaceId, actor, clean, context.row.version);
          if (saved.content === input.content && previous?.content !== input.content) {
            await noteActivity({ workspaceId, kind: 'file.saved', title: previous ? 'File saved' : 'Markdown file created', entityId: context.project.id, path: clean });
          }
          return saved;
        } finally {
          await staged?.close();
          try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      });
    });
  }
  async function dispatch({ workspaceId, actor, action = '', method = 'GET', input = {}, query = new URLSearchParams() }) {
    if (!action && method === 'GET') return get(workspaceId, actor);
    if (!action && ['POST', 'PUT'].includes(method)) return bind(workspaceId, actor, input);
    if (action === 'tree' && method === 'GET') return tree(workspaceId, actor, query.get('path') || '');
    if (action === 'file' && method === 'GET') return file(workspaceId, actor, query.get('path'), query.has('expected_binding_version') ? query.get('expected_binding_version') : undefined);
    if (action === 'file' && method === 'PUT') return save(workspaceId, actor, input);
    if (action === 'raw-file' && method === 'GET') return rawFile(workspaceId, actor, query.get('path'), query.get('expected_binding_version'));
    if (action === 'preview' && method === 'GET') return richFile(workspaceId, actor, query.get('path'), query.get('expected_binding_version'));
    if (action === 'search' && method === 'GET') return search(workspaceId, actor, query.get('q'), query.get('mode') || 'names');
    throw problem('This directory workspace action is unavailable.', 'not_found', 404);
  }
  // Local Git mutations share the same workspace/root locks as file saves.
  // The callback is internal server code, never a browser-provided operation.
  async function withBoundRoot(workspaceId, actor, permission, callback) {
    return serialize(`workspace:${workspaceId}`, async () => {
      const context = await currentRoot(workspaceId, actor, permission);
      return serialize(`root:${context.row.root_identity}`, async () => {
        const fresh = await currentRoot(workspaceId, actor, permission);
        if (fresh.row.version !== context.row.version) throw conflict('The workspace directory selection changed. Refresh before continuing.');
        return callback(fresh);
      });
    });
  }
  return { get, bind, tree, file, richFile, search, save, dispatch, binding, rootFor: currentRoot, withBoundRoot };
}

import { createHash, randomUUID } from 'node:crypto';
import { textPatch } from '../src/lib/change-review.js';

const MAX_FILES = 200;
const MAX_SELECTED = 50;
const MAX_FILE_BYTES = 512_000;
const MAX_TOTAL_BYTES = 2_000_000;
const KINDS = new Set(['manual', 'before_run', 'after_run', 'pre_restore']);
const restoreLocks = new Map();
const now = () => new Date().toISOString();
const uid = prefix => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(sort(value));
const sort = value => Array.isArray(value) ? value.map(sort) : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (message, code = 'invalid_checkpoint', statusCode = 400, details) => { throw Object.assign(new Error(message), { code, errorCode: code, statusCode, ...(details ? { details } : {}) }); };
const json = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
async function serialized(key, callback) {
  const previous = restoreLocks.get(key) || Promise.resolve();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  restoreLocks.set(key, pending);
  await previous.catch(() => {});
  try { return await callback(); }
  finally { release(); if (restoreLocks.get(key) === pending) restoreLocks.delete(key); }
}

export function installWorkbenchCheckpoints(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_checkpoints (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, environment_id TEXT,
    run_id TEXT, kind TEXT NOT NULL, parent_checkpoint_id TEXT REFERENCES workbench_checkpoints(id) ON DELETE CASCADE,
    historical_team_ids_json TEXT NOT NULL DEFAULT '[]',
    root_path TEXT NOT NULL, root_device TEXT NOT NULL, root_inode TEXT NOT NULL,
    complete INTEGER NOT NULL, limited INTEGER NOT NULL, file_count INTEGER NOT NULL, byte_size INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    CHECK(kind IN ('manual','before_run','after_run','pre_restore')),
    CHECK(complete IN (0,1)), CHECK(limited IN (0,1)));
  CREATE INDEX IF NOT EXISTS workbench_checkpoints_project ON workbench_checkpoints(workspace_id,project_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS workbench_checkpoints_run ON workbench_checkpoints(run_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS workbench_checkpoint_files (
    checkpoint_id TEXT NOT NULL REFERENCES workbench_checkpoints(id) ON DELETE CASCADE,
    path TEXT NOT NULL, state TEXT NOT NULL, sha256 TEXT, byte_size INTEGER NOT NULL,
    mode INTEGER, content BLOB, reason TEXT,
    PRIMARY KEY(checkpoint_id,path), CHECK(state IN ('present','absent','unavailable')));
  CREATE TABLE IF NOT EXISTS workbench_checkpoint_restores (
    id TEXT PRIMARY KEY, checkpoint_id TEXT NOT NULL REFERENCES workbench_checkpoints(id) ON DELETE CASCADE,
    pre_restore_checkpoint_id TEXT NOT NULL REFERENCES workbench_checkpoints(id) ON DELETE RESTRICT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL, status TEXT NOT NULL, preview_fingerprint TEXT NOT NULL,
    paths_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL,
    CHECK(status IN ('in_progress','interrupted','completed','partial','failed')));
  CREATE TABLE IF NOT EXISTS workbench_checkpoint_requests (
    workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, request_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL, restore_id TEXT NOT NULL REFERENCES workbench_checkpoint_restores(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,actor_id,request_key));
  CREATE TRIGGER IF NOT EXISTS workbench_checkpoints_immutable BEFORE UPDATE ON workbench_checkpoints BEGIN SELECT RAISE(ABORT,'Workbench checkpoints are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS workbench_checkpoint_files_immutable BEFORE UPDATE ON workbench_checkpoint_files BEGIN SELECT RAISE(ABORT,'Workbench checkpoint files are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS workbench_checkpoint_project_cleanup BEFORE DELETE ON projects BEGIN
    DELETE FROM workbench_checkpoint_restores WHERE project_id=OLD.id;
    DELETE FROM workbench_checkpoints WHERE project_id=OLD.id;
  END;
  CREATE TRIGGER IF NOT EXISTS workbench_checkpoint_workspace_cleanup BEFORE DELETE ON workspaces BEGIN
    DELETE FROM workbench_checkpoint_restores WHERE workspace_id=OLD.id;
    DELETE FROM workbench_checkpoints WHERE workspace_id=OLD.id;
  END;
  UPDATE workbench_checkpoint_restores SET status='interrupted' WHERE status='in_progress';`);
}

function decodeCheckpoint(row) {
  return row && { id: row.id, workspace_id: row.workspace_id, project_id: row.project_id, environment_id: row.environment_id,
    run_id: row.run_id, kind: row.kind, parent_checkpoint_id: row.parent_checkpoint_id, complete: Boolean(row.complete),
    historical_area_ids: json(row.historical_team_ids_json) || [],
    limited: Boolean(row.limited), file_count: row.file_count, byte_size: row.byte_size, version: row.version,
    created_by: row.created_by, created_at: row.created_at };
}
function publicState(row, includeContent = true) {
  if (!row) return null;
  return { path: row.path, state: row.state, sha256: row.sha256 || null, byte_size: row.byte_size || 0,
    mode: row.mode ?? null, ...(includeContent && row.state === 'present' ? { content: Buffer.from(row.content).toString('utf8') } : {}),
    ...(row.reason ? { reason: row.reason } : {}) };
}
function storedState(state) {
  if (state.state === 'absent') return { ...state, sha256: null, byte_size: 0, mode: null, content: null, reason: null };
  if (state.state !== 'present' || !Buffer.isBuffer(state.content) || state.content.length > MAX_FILE_BYTES || state.content.includes(0)) fail('Only bounded text files can be checkpointed.', 'unsupported_file', 409);
  return { ...state, sha256: digest(state.content), byte_size: state.content.length, reason: null };
}
function requestId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{8,160}$/.test(value)) fail('Provide a stable request ID between 8 and 160 characters.');
  return value;
}

export function createWorkbenchCheckpointService({ db, workbench, allowed, activeSessionsFor = () => [] } = {}) {
  if (!db || !workbench?.checkpointAdapter || typeof allowed !== 'function') throw new TypeError('Checkpoint service requires db, Workbench adapters, and authorization.');
  installWorkbenchCheckpoints(db);
  const adapter = workbench.checkpointAdapter;

  function project(workspaceId, projectId) {
    const row = db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(projectId || '', workspaceId || '');
    if (!row || !db.prepare('SELECT 1 FROM workspaces WHERE id=? AND archived_at IS NULL').get(workspaceId || '')) fail('Choose an active project in this workspace.', 'not_found', 404);
    return row;
  }
  function authorize(workspaceId, projectId, actor, write = false) {
    if (!actor?.id || actor.mode === 'agent') fail('A human account is required.', 'access_denied', 403);
    const row = project(workspaceId, projectId), scope = { scope_type: 'project', scope_id: projectId };
    for (const permission of ['projects.read', `workbench.${write ? 'write' : 'read'}`]) {
      let granted = false; try { granted = allowed(workspaceId, actor, permission, scope) === true; } catch { /* deny */ }
      if (!granted) fail('Checkpoint access denied.', 'access_denied', 403);
    }
    return row;
  }
  function authorizeHistorical(row, actor, write = false) {
    const permission = `workbench.${write ? 'write' : 'read'}`;
    for (const teamId of json(row.historical_team_ids_json) || []) {
      const scope = { scope_type: 'team', scope_id: teamId };
      for (const required of ['projects.read', permission]) {
        let granted = false; try { granted = allowed(row.workspace_id, actor, required, scope) === true; } catch { /* deny */ }
        if (!granted) fail('Historical checkpoint scope is no longer accessible.', 'access_denied', 403);
      }
    }
  }
  function checkpointRow(checkpointId) {
    const row = db.prepare('SELECT * FROM workbench_checkpoints WHERE id=?').get(checkpointId || '');
    if (!row) fail('Checkpoint unavailable.', 'not_found', 404);
    return row;
  }
  async function currentRoot(row, actor, write = false) {
    const projectRow = authorize(row.workspace_id, row.project_id, actor, write);
    authorizeHistorical(row, actor, write);
    const root = await adapter.checkpointRoot(projectRow, row.environment_id);
    if (root.root !== row.root_path || root.device !== row.root_device || root.inode !== row.root_inode) fail('The project folder changed after this checkpoint.', 'root_changed', 409);
    return { project: projectRow, ...root };
  }
  function selectedPaths(paths, limit = MAX_SELECTED) {
    if (!Array.isArray(paths) || !paths.length || paths.length > limit || paths.some(path => typeof path !== 'string' || !path || path.length > 2048)) fail(`Choose between 1 and ${limit} checkpoint files.`);
    const unique = [...new Set(paths)];
    if (unique.length !== paths.length) fail('Choose each checkpoint file once.');
    return [...unique].sort();
  }
  function insertCheckpoint({ workspaceId, projectId, environmentId, runId, kind, parentCheckpointId, historicalTeamIds = [], root, states, complete, limited, actorId }) {
    const id = uid('wbcp'), createdAt = now(), byteSize = states.reduce((sum, state) => sum + (state.byte_size || 0), 0);
    db.exec('SAVEPOINT workbench_checkpoint_insert');
    try {
      db.prepare(`INSERT INTO workbench_checkpoints
        (id,workspace_id,project_id,environment_id,run_id,kind,parent_checkpoint_id,historical_team_ids_json,root_path,root_device,root_inode,complete,limited,file_count,byte_size,version,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, workspaceId, projectId, environmentId || null, runId || null, kind, parentCheckpointId || null, canonical([...new Set(historicalTeamIds.filter(Boolean))].sort()), root.root, root.device, root.inode, Number(complete), Number(limited), states.length, byteSize, 1, actorId, createdAt);
      const insert = db.prepare('INSERT INTO workbench_checkpoint_files (checkpoint_id,path,state,sha256,byte_size,mode,content,reason) VALUES (?,?,?,?,?,?,?,?)');
      for (const state of states) insert.run(id, state.path, state.state, state.sha256 || null, state.byte_size || 0, state.mode ?? null, state.content, state.reason || null);
      db.exec('RELEASE workbench_checkpoint_insert');
    } catch (error) {
      db.exec('ROLLBACK TO workbench_checkpoint_insert'); db.exec('RELEASE workbench_checkpoint_insert'); throw error;
    }
    return checkpointRow(id);
  }
  async function capture({ workspaceId, projectId, environmentId = null, actor, kind = 'manual', runId = null, paths = null } = {}) {
    if (!KINDS.has(kind)) fail('Checkpoint kind is invalid.');
    const projectRow = authorize(workspaceId, projectId, actor, true), root = await adapter.checkpointRoot(projectRow, environmentId);
    if (runId !== null) {
      if (typeof runId !== 'string' || !runId || runId.length > 240) fail('Run ID is invalid.');
      const hasRuns = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runs'").get();
      if (hasRuns && !db.prepare('SELECT 1 FROM runs WHERE id=? AND workspace_id=? AND project_id=?').get(runId, workspaceId, projectId)) fail('Checkpoint run is outside this project.', 'invalid_scope', 400);
    }
    if (['before_run', 'after_run'].includes(kind) && !runId) fail('Run checkpoints require an exact project run.');
    let candidates, complete = true, limited = false, explicit = paths !== null;
    if (explicit) candidates = selectedPaths(paths, MAX_FILES);
    else {
      candidates = await adapter.checkpointPaths(root.root);
      if (candidates.length > MAX_FILES) { candidates = candidates.slice(0, MAX_FILES); complete = false; limited = true; }
    }
    const states = []; let bytes = 0;
    for (const path of candidates) {
      try {
        const state = storedState(await adapter.checkpointState(root.root, path));
        if (bytes + state.byte_size > MAX_TOTAL_BYTES) {
          if (explicit) fail('Selected checkpoint files exceed the 2 MB limit.', 'checkpoint_too_large', 409);
          complete = false; limited = true; break;
        }
        bytes += state.byte_size; states.push(state);
      } catch (error) {
        if (explicit) throw error;
        complete = false; limited = true;
      }
    }
    const finalProject = authorize(workspaceId, projectId, actor, true), finalRoot = await adapter.checkpointRoot(finalProject, environmentId);
    if (finalRoot.root !== root.root || finalRoot.device !== root.device || finalRoot.inode !== root.inode) fail('The project folder changed during checkpoint capture.', 'root_changed', 409);
    const row = insertCheckpoint({ workspaceId, projectId, environmentId, runId, kind, parentCheckpointId: null, historicalTeamIds: [projectRow.team_id, finalProject.team_id], root: finalRoot, states, complete, limited, actorId: actor.id });
    return { ...decodeCheckpoint(row), files: states.map(state => publicState(state, false)) };
  }
  async function list({ workspaceId, projectId, actor, runId = null } = {}) {
    authorize(workspaceId, projectId, actor);
    const rows = runId
      ? db.prepare('SELECT * FROM workbench_checkpoints WHERE workspace_id=? AND project_id=? AND run_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(workspaceId, projectId, runId)
      : db.prepare('SELECT * FROM workbench_checkpoints WHERE workspace_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(workspaceId, projectId);
    return rows.filter(row => { try { authorizeHistorical(row, actor); return true; } catch { return false; } }).map(decodeCheckpoint);
  }
  async function get({ checkpointId, actor } = {}) {
    const row = checkpointRow(checkpointId); await currentRoot(row, actor);
    const files = db.prepare('SELECT * FROM workbench_checkpoint_files WHERE checkpoint_id=? ORDER BY path').all(row.id).map(item => publicState(item, false));
    return { ...decodeCheckpoint(row), files };
  }
  async function buildPreview({ checkpointId, actor, paths } = {}) {
    const row = checkpointRow(checkpointId), root = await currentRoot(row, actor), chosen = selectedPaths(paths);
    const saved = new Map(db.prepare('SELECT * FROM workbench_checkpoint_files WHERE checkpoint_id=?').all(row.id).map(item => [item.path, item]));
    const files = []; let bytes = 0;
    for (const path of chosen) {
      const before = saved.get(path);
      if (!before) fail('The selected path was not captured by this checkpoint.', 'unsupported_file', 409);
      let current, restorable = before.state !== 'unavailable', reason = before.reason || null;
      try { current = storedState(await adapter.checkpointState(root.root, path)); }
      catch (error) { current = { path, state: 'unavailable', sha256: null, byte_size: 0, mode: null, content: null, reason: error.message }; restorable = false; reason ||= error.message; }
      bytes += (before.byte_size || 0) + (current.byte_size || 0);
      if (bytes > MAX_TOTAL_BYTES) { restorable = false; reason = 'Selected preview exceeds the 2 MB limit.'; }
      const desiredText = before.state === 'present' ? Buffer.from(before.content).toString('utf8') : '';
      const currentText = current.state === 'present' ? current.content.toString('utf8') : '';
      const operation = before.state === current.state && before.sha256 === current.sha256 && before.mode === current.mode ? 'unchanged' : before.state === 'absent' ? 'delete' : current.state === 'absent' ? 'create' : 'restore';
      files.push({ path, operation, before: publicState(before), current: publicState(current), patch: restorable ? textPatch(currentText, desiredText) : '', restorable, reason });
    }
    const fingerprint = digest(canonical({ checkpoint_id: row.id, checkpoint_version: row.version, root: [row.root_path, row.root_device, row.root_inode], files: files.map(file => ({ path: file.path, before: [file.before.state, file.before.sha256, file.before.mode], current: [file.current.state, file.current.sha256, file.current.mode], restorable: file.restorable })) }));
    return { checkpoint: decodeCheckpoint(row), preview_fingerprint: fingerprint, files, limited: files.some(file => !file.restorable), notice: 'Restores only these working-tree files. It does not change the Git index, commits, branches, or files omitted from the checkpoint.' };
  }
  async function preview(input) { return buildPreview(input); }

  function active(row) {
    const sessions = activeSessionsFor('projects', row.project_id) || [];
    if (sessions.length) fail('Stop active agent sessions and Workbench terminals before restoring files.', 'active_sessions', 409);
  }
  function restoreResult(row) { return { ...(json(row.result_json) || { id: row.id }), status: row.status }; }
  async function restoreUnlocked({ checkpointId, actor, paths, previewFingerprint, checkpointVersion, confirmed, requestId: key } = {}) {
    if (confirmed !== true) fail('Confirm this exact restore after reviewing every selected file.', 'confirmation_required', 409);
    key = requestId(key);
    const source = checkpointRow(checkpointId); await currentRoot(source, actor, true); active(source);
    const requested = Array.isArray(paths) ? paths : [];
    const chosen = selectedPaths(requested.map(item => item?.path));
    if (typeof previewFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(previewFingerprint)
      || requested.some(item => !record(item) || !chosen.includes(item.path) || !['present', 'absent'].includes(item.expected_current_state)
        || item.expected_current_state === 'present' && (typeof item.expected_current_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.expected_current_sha256))
        || item.expected_current_state === 'present' && item.expected_current_mode !== undefined && (!Number.isInteger(item.expected_current_mode) || item.expected_current_mode < 0 || item.expected_current_mode > 0o777)
        || item.expected_current_state === 'absent' && (item.expected_current_sha256 !== null || ![undefined, null].includes(item.expected_current_mode)))) fail('Restore paths must pin each current file state and hash.');
    if (!Number.isSafeInteger(checkpointVersion) || checkpointVersion !== source.version) fail('The checkpoint version changed.', 'stale_checkpoint', 409);
    const fingerprint = digest(canonical({ checkpoint_id: source.id, checkpoint_version: checkpointVersion, paths: requested.map(item => ({ path: item.path, expected_current_state: item.expected_current_state, expected_current_sha256: item.expected_current_sha256, expected_current_mode: item.expected_current_mode })), preview_fingerprint: previewFingerprint }));
    const replay = db.prepare('SELECT * FROM workbench_checkpoint_requests WHERE workspace_id=? AND actor_id=? AND request_key=?').get(source.workspace_id, actor.id, key);
    if (replay) {
      if (replay.fingerprint !== fingerprint) fail('Request ID already belongs to a different restore.', 'idempotency_conflict', 409);
      const operation = db.prepare('SELECT * FROM workbench_checkpoint_restores WHERE id=? AND checkpoint_id=?').get(replay.restore_id, source.id);
      if (!operation) fail('Restore replay is unavailable.', 'not_found', 404);
      return { ...restoreResult(operation), replayed: true };
    }
    const fresh = await buildPreview({ checkpointId, actor, paths: chosen });
    if (fresh.preview_fingerprint !== previewFingerprint || fresh.files.some(file => !file.restorable)) fail('The working tree changed or contains an unsupported file. Preview again.', 'stale_worktree', 409);
    const expected = new Map(requested.map(item => [item.path, item]));
    for (const file of fresh.files) {
      const pin = expected.get(file.path);
      if (!pin || pin.expected_current_state !== file.current.state || pin.expected_current_sha256 !== file.current.sha256 || pin.expected_current_mode !== undefined && pin.expected_current_mode !== file.current.mode) fail('The working tree changed. Preview again.', 'stale_worktree', 409);
    }
    const root = await currentRoot(source, actor, true);
    const preStates = fresh.files.map(file => storedState({ ...file.current, content: file.current.state === 'present' ? Buffer.from(file.current.content, 'utf8') : null }));
    const historicalTeamIds = [...(json(source.historical_team_ids_json) || []), root.project.team_id].filter(Boolean);
    const pre = insertCheckpoint({ workspaceId: source.workspace_id, projectId: source.project_id, environmentId: source.environment_id, runId: source.run_id, kind: 'pre_restore', parentCheckpointId: source.id, historicalTeamIds, root, states: preStates, complete: true, limited: false, actorId: actor.id });
    const sourceFiles = new Map(db.prepare('SELECT * FROM workbench_checkpoint_files WHERE checkpoint_id=?').all(source.id).map(item => [item.path, item]));
    const createdAt = now();
    let operation = { id: uid('wbrestore'), checkpoint_id: source.id, pre_restore_checkpoint_id: pre.id, workspace_id: source.workspace_id, project_id: source.project_id, actor_id: actor.id, status: 'in_progress', preview_fingerprint: fresh.preview_fingerprint, outcomes: [], created_at: createdAt, replayed: false };
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO workbench_checkpoint_restores VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(operation.id, source.id, pre.id, source.workspace_id, source.project_id, actor.id, operation.status, fresh.preview_fingerprint, canonical(chosen), canonical(operation), createdAt);
      db.prepare('INSERT INTO workbench_checkpoint_requests VALUES(?,?,?,?,?,?)').run(source.workspace_id, actor.id, key, fingerprint, operation.id, createdAt);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const finishOperation = (status, outcomes, error = null) => {
      operation = { ...operation, status, outcomes, ...(error ? { error: String(error.message || error).slice(0, 500) } : {}) };
      db.prepare('UPDATE workbench_checkpoint_restores SET status=?,result_json=? WHERE id=?').run(status, canonical(operation), operation.id);
      return operation;
    };
    const staged = [], outcomes = fresh.files.filter(file => file.operation === 'unchanged').map(file => ({ path: file.path, status: 'unchanged' }));
    try {
      for (const path of chosen) {
        if (fresh.files.find(file => file.path === path)?.operation === 'unchanged') continue;
        const desired = sourceFiles.get(path);
        const expected = fresh.files.find(file => file.path === path).current;
        staged.push({ ...(await adapter.stageCheckpointState(root.root, path, { ...desired, content: desired.content == null ? null : Buffer.from(desired.content) }, `${randomUUID()}-${staged.length}`)), expectedState: expected.state, expectedSha256: expected.sha256, expectedMode: expected.mode });
      }
      await currentRoot(source, actor, true); active(source);
      for (const file of fresh.files) {
        const again = storedState(await adapter.checkpointState(root.root, file.path));
        if (again.state !== file.current.state || again.sha256 !== file.current.sha256 || again.mode !== file.current.mode) fail('The working tree changed while restore files were staged.', 'stale_worktree', 409, { pre_restore_checkpoint_id: pre.id });
      }
    } catch (error) {
      await Promise.allSettled(staged.map(item => adapter.cleanupCheckpointStage(item)));
      finishOperation('failed', outcomes, error);
      throw error;
    }
    for (let index = 0; index < staged.length; index++) {
      const item = staged[index];
      try { await currentRoot(source, actor, true); active(source); }
      catch (error) {
        for (const pending of staged.slice(index)) outcomes.push({ path: pending.clean, status: 'failed', error: `Not applied: ${String(error.message || error).slice(0, 480)}` });
        break;
      }
      try { await adapter.applyCheckpointState(root.root, item); outcomes.push({ path: item.clean, status: 'applied' }); }
      catch (error) { outcomes.push({ path: item.clean, status: 'failed', error: String(error.message || error).slice(0, 500) }); }
      finally { await adapter.cleanupCheckpointStage(item).catch(() => {}); }
    }
    const succeeded = outcomes.filter(item => item.status !== 'failed').length;
    const status = succeeded === outcomes.length ? 'completed' : succeeded ? 'partial' : 'failed';
    return finishOperation(status, outcomes);
  }

  async function restore(input = {}) {
    const source = checkpointRow(input.checkpointId);
    return serialized(`${source.root_device}:${source.root_inode}`, () => restoreUnlocked(input));
  }

  return { capture, list, get, preview, restore };
}

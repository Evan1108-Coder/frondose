import { randomUUID } from 'node:crypto';
import { isRecord, validationError } from './validation.mjs';
import { recordChange } from './workspace-features.mjs';

export const ACTIVITY_TYPES = Object.freeze(['progress', 'decision', 'blocker', 'risk', 'release', 'outcome', 'comment']);
export const ACTIVITY_TARGETS = Object.freeze(['project', 'route', 'request', 'document', 'output', 'milestone', 'chat']);

const TARGETS = Object.freeze({
  project: { table: 'projects' },
  route: { table: 'tasks' },
  request: { table: 'workspace_items', kind: 'request' },
  document: { table: 'documents' },
  output: { table: 'outputs' },
  milestone: { table: 'milestones' },
  chat: { table: 'chats' },
});
const ACTORS = new Set(['user', 'agent', 'system']);
const stamp = () => new Date().toISOString();
const uid = () => `activity_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const invalid = (message, statusCode = 400) => Object.assign(validationError(message), { statusCode });
const text = (value, label, maximum, required = false) => {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim()) || /\u0000/.test(value)) {
    throw invalid(`${label} must be ${required ? 'non-empty text' : 'text'} of at most ${maximum} characters.`);
  }
  return value.trim();
};

export function installActivity(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS activity_entries (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    update_type TEXT NOT NULL,
    parent_id TEXT REFERENCES activity_entries(id) ON DELETE SET NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT NOT NULL,
    content TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (target_type IN ('project','route','request','document','output','milestone','chat')),
    CHECK (update_type IN ('progress','decision','blocker','risk','release','outcome','comment')),
    CHECK (actor_type IN ('user','agent','system'))
  );
  CREATE INDEX IF NOT EXISTS activity_entries_target ON activity_entries(workspace_id,target_type,target_id,created_at);
  CREATE INDEX IF NOT EXISTS activity_entries_parent ON activity_entries(parent_id,created_at);`);
}

export function activitySnapshot(db) {
  return { activity_entries: db.prepare('SELECT * FROM activity_entries ORDER BY created_at,id').all() };
}

function activeWorkspace(db, workspaceId) {
  if (typeof workspaceId !== 'string' || !db.prepare('SELECT 1 FROM workspaces WHERE id=? AND archived_at IS NULL').get(workspaceId)) {
    throw invalid('Choose an active workspace.', 404);
  }
}

function activeTarget(db, workspaceId, targetType, targetId) {
  const target = TARGETS[targetType];
  if (!target || typeof targetId !== 'string' || !targetId) throw invalid('Choose a supported activity target.');
  const row = db.prepare(`SELECT * FROM ${target.table} WHERE id=?`).get(targetId);
  if (!row || row.workspace_id !== workspaceId || row.archived_at || target.kind && row.kind !== target.kind) {
    throw invalid('Choose an active target in this workspace.', 404);
  }
  return row;
}

function validateParent(db, parentId, workspaceId, targetType, targetId, selfId = null) {
  if (parentId == null || parentId === '') return null;
  if (typeof parentId !== 'string' || parentId === selfId) throw invalid('Choose a valid parent reply.');
  const parent = db.prepare('SELECT * FROM activity_entries WHERE id=?').get(parentId);
  if (!parent || parent.workspace_id !== workspaceId || parent.target_type !== targetType || parent.target_id !== targetId || parent.archived_at) {
    throw invalid('Replies must belong to the same active target.', 404);
  }
  return parent.id;
}

function inputFields(db, input, current = null) {
  if (!isRecord(input)) throw invalid('Provide valid update fields.');
  const workspaceId = current?.workspace_id ?? input.workspace_id;
  const targetType = current?.target_type ?? input.target_type;
  const targetId = current?.target_id ?? input.target_id;
  activeWorkspace(db, workspaceId);
  activeTarget(db, workspaceId, targetType, targetId);
  if (current && [
    ['workspace_id', workspaceId], ['target_type', targetType], ['target_id', targetId],
    ['parent_id', current.parent_id], ['actor_type', current.actor_type], ['actor_id', current.actor_id], ['actor_name', current.actor_name],
  ].some(([key, value]) => Object.hasOwn(input, key) && (input[key] || null) !== (value || null))) {
    throw invalid('An update cannot change its workspace, target, thread, or actor.');
  }
  const updateType = input.update_type ?? current?.update_type;
  if (!ACTIVITY_TYPES.includes(updateType)) throw invalid('Choose a valid update type.');
  const actorType = current?.actor_type ?? input.actor_type ?? 'user';
  if (!ACTORS.has(actorType)) throw invalid('Choose a valid actor type.');
  const actorId = current?.actor_id ?? (input.actor_id == null ? null : text(input.actor_id, 'Actor ID', 200));
  const actorName = current?.actor_name ?? text(input.actor_name, 'Actor name', 160, true);
  const content = text(input.content ?? current?.content, 'Content', 50_000, true);
  const parentId = current?.parent_id ?? validateParent(db, input.parent_id, workspaceId, targetType, targetId);
  return { workspace_id: workspaceId, target_type: targetType, target_id: targetId, update_type: updateType, parent_id: parentId, actor_type: actorType, actor_id: actorId, actor_name: actorName, content };
}

function currentEntry(db, entryId, workspaceId) {
  const item = db.prepare('SELECT * FROM activity_entries WHERE id=?').get(entryId);
  if (!item || item.workspace_id !== workspaceId) throw invalid('Update not found in this workspace.', 404);
  return item;
}

export async function activityRoute({ db, req, res, path, url, readBody, send, snapshot, actor }) {
  const match = /^\/activity(?:\/([^/]+))?$/.exec(path);
  if (!match) return false;
  const entryId = match[1] ? decodeURIComponent(match[1]) : null;

  if (req.method === 'GET') {
    const workspaceId = url.searchParams.get('workspace_id');
    activeWorkspace(db, workspaceId);
    if (entryId) {
      send(res, 200, { result: currentEntry(db, entryId, workspaceId) });
      return true;
    }
    const targetType = url.searchParams.get('target_type');
    const targetId = url.searchParams.get('target_id');
    if (!targetType || !targetId) throw invalid('Choose a target to list its updates.');
    activeTarget(db, workspaceId, targetType, targetId);
    const includeArchived = url.searchParams.get('include_archived') === 'true';
    const result = db.prepare(`SELECT * FROM activity_entries WHERE workspace_id=? AND target_type=? AND target_id=?${includeArchived ? '' : ' AND archived_at IS NULL'} ORDER BY created_at,id`).all(workspaceId, targetType, targetId);
    send(res, 200, { result });
    return true;
  }

  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return false;
  const body = await readBody(req);
  if (!isRecord(body)) throw invalid('Provide valid update fields.');
  if (req.method === 'POST' && entryId || req.method !== 'POST' && !entryId) return false;

  if (req.method === 'POST') {
    const attributed = actor?.mode === 'account' ? { ...body, actor_type: 'user', actor_id: actor.id, actor_name: actor.name || 'Member' } : body;
    const values = inputFields(db, attributed);
    const time = stamp();
    const result = { id: uid(), ...values, version: 1, archived_at: null, created_at: time, updated_at: time };
    db.prepare('INSERT INTO activity_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(result));
    recordChange(db, 'activity_entries', null, result, 'created');
    send(res, 201, { result, ...(snapshot ? { bootstrap: snapshot(db) } : {}) });
    return true;
  }

  const current = currentEntry(db, entryId, body.workspace_id);
  if (actor?.mode === 'account' && current.actor_id !== actor.id) {
    const rank = db.prepare("SELECT rank FROM governance_members WHERE workspace_id=? AND id=? AND status='active'").get(current.workspace_id, actor.id)?.rank;
    // Moderators may hide an inappropriate update, but cannot rewrite another person's words.
    if (!(req.method === 'DELETE' && ['Owner', 'Admin', 'Manager'].includes(rank))) throw invalid('Only the author may edit this update. A manager can archive it.', 403);
  }
  if (body.version !== current.version) throw invalid('This update changed. Refresh it before continuing.', 409);
  const time = stamp();
  let result;
  if (req.method === 'DELETE') {
    if (current.archived_at) throw invalid('This update is already archived.', 409);
    result = { ...current, version: current.version + 1, archived_at: time, updated_at: time };
  } else {
    const restoring = Object.hasOwn(body, 'archived_at') && body.archived_at === null;
    const archiving = body.archived_at === true;
    if (Object.hasOwn(body, 'archived_at') && !restoring && !archiving) throw invalid('Choose whether to archive or restore this update.');
    if (current.archived_at && !restoring) throw invalid('Restore this update before editing it.');
    const values = inputFields(db, body, current);
    result = { ...current, ...values, version: current.version + 1, archived_at: archiving ? time : restoring ? null : current.archived_at, updated_at: time };
  }
  db.prepare('UPDATE activity_entries SET update_type=?,content=?,version=?,archived_at=?,updated_at=? WHERE id=?').run(result.update_type, result.content, result.version, result.archived_at, result.updated_at, entryId);
  recordChange(db, 'activity_entries', current, result, result.archived_at && !current.archived_at ? 'archived' : current.archived_at && !result.archived_at ? 'restored' : 'updated');
  send(res, 200, { result, ...(snapshot ? { bootstrap: snapshot(db) } : {}) });
  return true;
}

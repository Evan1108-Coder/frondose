import {extendActivityAreas} from './activity-area-migration.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { isRecord, validationError } from './validation.mjs';
import { recordChange } from './workspace-features.mjs';
import { createActivityPolicy } from './activity-policy.mjs';
import { getReaction, normalizeReactionColor } from '../src/lib/reaction-catalog.js';
import { validateUpdateChanges, applyUpdateChanges, validateUpdateAttachments } from './update-fields.mjs';

export const ACTIVITY_TYPES = Object.freeze(['progress', 'decision', 'blocker', 'risk', 'release', 'outcome', 'comment']);
export const ACTIVITY_TARGETS = Object.freeze(['area', 'project', 'route', 'request', 'document', 'output', 'milestone', 'chat']);

const TARGETS = Object.freeze({
  area: { table: 'teams' },
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
  extendActivityAreas(db);
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
    CHECK (target_type IN ('area','project','route','request','document','output','milestone','chat')),
    CHECK (update_type IN ('progress','decision','blocker','risk','release','outcome','comment')),
    CHECK (actor_type IN ('user','agent','system'))
  );
  CREATE INDEX IF NOT EXISTS activity_entries_target ON activity_entries(workspace_id,target_type,target_id,created_at);
  CREATE INDEX IF NOT EXISTS activity_entries_parent ON activity_entries(parent_id,created_at);`);
  const columns = new Set(db.prepare('PRAGMA table_info(activity_entries)').all().map(item => item.name));
  for (const [name, definition] of Object.entries({ title: "TEXT NOT NULL DEFAULT ''", health: "TEXT NOT NULL DEFAULT 'none'", publication_state: "TEXT NOT NULL DEFAULT 'published'", published_at: 'TEXT', imported: 'INTEGER NOT NULL DEFAULT 0', work_changes_json: "TEXT NOT NULL DEFAULT '{}'", attachments_json: "TEXT NOT NULL DEFAULT '[]'" })) {
    if (!columns.has(name)) db.exec(`ALTER TABLE activity_entries ADD COLUMN ${name} ${definition}`);
  }
  for (const table of ['tasks', 'projects']) {
    const fields = db.prepare(`PRAGMA table_info(${table})`).all();
    if (fields.length && !fields.some(field => field.name === 'reported_progress')) db.exec(`ALTER TABLE ${table} ADD COLUMN reported_progress INTEGER CHECK(reported_progress BETWEEN 0 AND 100)`);
  }
  db.exec(`UPDATE activity_entries SET published_at=created_at WHERE publication_state='published' AND published_at IS NULL;
    CREATE INDEX IF NOT EXISTS activity_entries_feed ON activity_entries(workspace_id,publication_state,published_at,id);
    CREATE TABLE IF NOT EXISTS activity_reactions(entry_id TEXT NOT NULL REFERENCES activity_entries(id) ON DELETE CASCADE,actor_id TEXT NOT NULL,reaction_id TEXT NOT NULL,color TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,PRIMARY KEY(entry_id,actor_id,reaction_id,color));
    CREATE TABLE IF NOT EXISTS activity_requests(workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,request_key TEXT NOT NULL,operation TEXT NOT NULL,fingerprint TEXT NOT NULL,entry_id TEXT NOT NULL REFERENCES activity_entries(id) ON DELETE CASCADE,PRIMARY KEY(workspace_id,actor_id,request_key));`);
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
  const publication = input.publication_state ?? current?.publication_state ?? 'published';
  if (!['published', 'draft'].includes(publication)) throw invalid('Choose draft or published.');
  if (current?.publication_state === 'published' && publication === 'draft') throw invalid('A published update cannot become a private draft.');
  const content = text(input.content ?? current?.content ?? '', 'Content', 50_000, publication === 'published');
  const title = text(input.title ?? current?.title ?? '', 'Title', 200);
  const health = input.health ?? current?.health ?? 'none';
  if (!['none', 'on_track', 'at_risk', 'blocked'].includes(health)) throw invalid('Choose a valid health status.');
  const parentId = current?.parent_id ?? validateParent(db, input.parent_id, workspaceId, targetType, targetId);
  if (parentId && publication === 'draft') throw invalid('Replies publish directly; save drafts on root updates.');
  const workChanges = validateUpdateChanges(input.work_changes ?? JSON.parse(current?.work_changes_json || '{}'), targetType, Boolean(parentId));
  if (current?.publication_state === 'published' && workChanges !== (current.work_changes_json || '{}')) throw invalid('Published work changes are immutable. Write another update to change the work.');
  const attachments = validateUpdateAttachments(input.attachments ?? JSON.parse(current?.attachments_json || '[]'));
  return { workspace_id: workspaceId, target_type: targetType, target_id: targetId, update_type: updateType, parent_id: parentId, actor_type: actorType, actor_id: actorId, actor_name: actorName, content, title, health, publication_state: publication, work_changes_json: workChanges, attachments_json: attachments };
}

function currentEntry(db, entryId, workspaceId) {
  const item = db.prepare('SELECT * FROM activity_entries WHERE id=?').get(entryId);
  if (!item || item.workspace_id !== workspaceId) throw invalid('Update not found in this workspace.', 404);
  return item;
}

export async function activityRoute({ db, req, res, path, url, readBody, send, snapshot, actor, allowed }) {
  const match = /^\/activity(?:\/([^/]+))?(?:\/(reactions|history))?$/.exec(path);
  if (!match) return false;
  if (!actor?.id) throw invalid('Sign in to continue.', 401);
  const policy = createActivityPolicy(db, allowed);
  const entryId = match[1] ? decodeURIComponent(match[1]) : null;
  const action = match[2];
  const present = item => policy.present(item, actor);
  const available = (id, ws) => { const item = currentEntry(db, id, ws); if (!policy.visible(item, actor)) throw invalid('Update not found in this workspace.', 404); return item; };
  const respond = (status, result) => send(res, status, { result: present(result), ...(snapshot ? { bootstrap: snapshot(db) } : {}) });
  const transact = callback => { db.exec('BEGIN IMMEDIATE'); try { const result = callback(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };

  if (req.method === 'GET') {
    const workspaceId = url.searchParams.get('workspace_id');
    activeWorkspace(db, workspaceId);
    if (entryId === 'feed' && !action) {
      const state = url.searchParams.get('publication_state') || 'published';
      if (!['published', 'draft'].includes(state)) throw invalid('Choose published or draft updates.');
      const limit = Number(url.searchParams.get('limit') || 30);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('Limit must be 1–100.');
      const filters = Object.fromEntries(['target_type', 'update_type', 'health', 'q', 'project_id', 'team_id', 'include_archived'].map(key => [key, url.searchParams.get(key) || '']));
      if (filters.team_id && !db.prepare('SELECT 1 FROM teams WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(filters.team_id, workspaceId)) throw invalid('Team unavailable.', 404);
      filters.q = url.searchParams.get('search') || filters.q;
      if (filters.target_type && !ACTIVITY_TARGETS.includes(filters.target_type) || filters.update_type && !ACTIVITY_TYPES.includes(filters.update_type) || filters.health && !['none', 'on_track', 'at_risk', 'blocked'].includes(filters.health) || filters.q.length > 200) throw invalid('Invalid feed filter.');
      const binding = JSON.stringify([workspaceId, actor.id, state, filters]);
      let cursor = null;
      if (url.searchParams.get('cursor')) { try { cursor = JSON.parse(Buffer.from(url.searchParams.get('cursor'), 'base64url').toString()); } catch { throw invalid('Invalid feed cursor.'); } if (!Array.isArray(cursor) || cursor.length !== 3 || cursor[0] !== binding || typeof cursor[1] !== 'string' || typeof cursor[2] !== 'string') throw invalid('This cursor belongs to a different feed.'); }
      const clauses = ['workspace_id=?', 'publication_state=?', 'parent_id IS NULL']; const parameters = [workspaceId, state];
      if (filters.include_archived !== 'true') clauses.push('archived_at IS NULL');
      if (state === 'draft') { clauses.push('actor_id=?'); parameters.push(actor.id); }
      for (const key of ['target_type', 'update_type', 'health']) if (filters[key]) { clauses.push(`${key}=?`); parameters.push(filters[key]); }
      if (filters.q) { clauses.push("(instr(lower(title),lower(?))>0 OR instr(lower(content),lower(?))>0)"); parameters.push(filters.q, filters.q); }
      const timeColumn = state === 'draft' ? 'created_at' : 'published_at';
      if (cursor) { clauses.push(`(${timeColumn}<? OR (${timeColumn}=? AND id<?))`); parameters.push(cursor[1], cursor[1], cursor[2]); }
      // Permission filtering precedes pagination, so hidden records never occupy visible slots.
      const query = db.prepare(`SELECT * FROM activity_entries WHERE ${clauses.join(' AND ')} ORDER BY ${timeColumn} DESC,id DESC`);
      const result = [];
      for (const item of query.iterate(...parameters)) { if (policy.visible(item, actor) && (filters.include_archived === 'true' || policy.ancestorsActive(item)) && (!filters.project_id || policy.target(item)?.display.project_ids.includes(filters.project_id)) && (!filters.team_id || ['area', 'project', 'route'].includes(item.target_type) && policy.target(item)?.display.team_id === filters.team_id)) result.push(item); if (result.length > limit) break; }
      const more = result.length > limit; if (more) result.pop();
      const last = result.at(-1);
      send(res, 200, { result: { items: result.map(present), next_cursor: more ? Buffer.from(JSON.stringify([binding, last[timeColumn], last.id])).toString('base64url') : null } }); return true;
    }
    if (entryId) {
      const current = available(entryId, workspaceId);
      if (action === 'history') {
        const changes = current.publication_state === 'draft' ? [] : db.prepare('SELECT * FROM change_log WHERE entity_type=? AND entity_id=? AND workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all('activity_entries', entryId, workspaceId).filter(change => policy.historyVisible(change, actor)).map(change => ({ id: change.id, entity_id: change.entity_id, entity_type: change.entity_type, workspace_id: change.workspace_id, action: change.action, created_at: change.created_at, before: change.before_json ? JSON.parse(change.before_json) : null, after: change.after_json ? JSON.parse(change.after_json) : null }));
        send(res, 200, { result: changes }); return true;
      }
      if (action) return false;
      send(res, 200, { result: present(current) });
      return true;
    }
    const targetType = url.searchParams.get('target_type');
    const targetId = url.searchParams.get('target_id');
    if (!targetType || !targetId) throw invalid('Choose a target to list its updates.');
    activeTarget(db, workspaceId, targetType, targetId);
    const includeArchived = url.searchParams.get('include_archived') === 'true';
    const result = db.prepare(`SELECT * FROM activity_entries WHERE workspace_id=? AND target_type=? AND target_id=?${includeArchived ? '' : ' AND archived_at IS NULL'} ORDER BY created_at,id`).all(workspaceId, targetType, targetId);
    send(res, 200, { result: result.filter(item => policy.visible(item, actor) && (includeArchived || policy.ancestorsActive(item))).map(present) });
    return true;
  }

  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return false;
  const body = await readBody(req);
  if (!isRecord(body)) throw invalid('Provide valid update fields.');
  if (action === 'reactions' && req.method === 'POST' && entryId) {
    const current = available(entryId, body.workspace_id);
    if (!policy.capabilities(current, actor).can_react) throw invalid('You cannot react to this update.', 403);
    const reaction = body.reaction;
    if (!isRecord(reaction) || !['add', 'remove'].includes(body.action)) throw invalid('Choose a reaction and add or remove.');
    let item = getReaction(reaction.id);
    if (typeof reaction.id === 'string' && reaction.id.startsWith('custom:')) { const emoji = db.prepare("SELECT * FROM workspace_items WHERE id=? AND workspace_id=? AND kind='emoji'").get(reaction.id.slice(7), current.workspace_id); if (emoji && (!emoji.archived_at || body.action === 'remove')) item = { id: reaction.id, type: 'custom' }; }
    const color = normalizeReactionColor(reaction.color);
    if (!item || color === undefined || item.type !== 'icon' && color !== null) throw invalid('Choose a valid reaction from this workspace.');
    transact(() => {
      if (body.action === 'remove') db.prepare('DELETE FROM activity_reactions WHERE entry_id=? AND actor_id=? AND reaction_id=? AND color=?').run(current.id, actor.id, item.id, color || '');
      else { const count = db.prepare('SELECT COUNT(*) AS n FROM activity_reactions WHERE entry_id=? AND actor_id=?').get(current.id, actor.id).n; const existing = db.prepare('SELECT 1 FROM activity_reactions WHERE entry_id=? AND actor_id=? AND reaction_id=? AND color=?').get(current.id, actor.id, item.id, color || ''); if (!existing && count >= 24) throw invalid('Use up to 24 reactions per update.'); db.prepare('INSERT OR IGNORE INTO activity_reactions VALUES(?,?,?,?,?)').run(current.id, actor.id, item.id, color || '', stamp()); }
    }); respond(200, current); return true;
  }
  if (action) return false;
  if (req.method === 'POST' && entryId || req.method !== 'POST' && !entryId) return false;

  const requestKey = body.idempotency_key;
  if (requestKey !== undefined && (typeof requestKey !== 'string' || !/^[\w.-]{8,160}$/.test(requestKey))) throw invalid('Use an idempotency key of 8–160 letters, digits, dots, hyphens or underscores.');
  const operation = `${req.method}:${entryId || 'create'}`;
  const fingerprint = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => !['idempotency_key', 'actor_id', 'actor_name', 'actor_type'].includes(key)).sort(([a], [b]) => a.localeCompare(b))))).digest('hex');
  if (requestKey) {
    const prior = db.prepare('SELECT * FROM activity_requests WHERE workspace_id=? AND actor_id=? AND request_key=?').get(body.workspace_id, actor.id, requestKey);
    if (prior) { if (prior.operation !== operation || prior.fingerprint !== fingerprint) throw invalid('This retry key was used for different update content.', 409); respond(200, available(prior.entry_id, body.workspace_id)); return true; }
  }
  const remember = item => { if (requestKey) db.prepare('INSERT INTO activity_requests VALUES(?,?,?,?,?,?)').run(item.workspace_id, actor.id, requestKey, operation, fingerprint, item.id); };

  if (req.method === 'POST') {
    const attributed = { ...body, actor_type: 'user', actor_id: actor.id, actor_name: actor.name || 'Member' };
    const values = inputFields(db, attributed);
    const time = stamp();
    const result = { id: uid(), ...values, version: 1, archived_at: null, created_at: time, updated_at: time, published_at: values.publication_state === 'published' ? time : null, imported: 0 };
    const destination = policy.target(result);
    if (!destination?.active || !policy.permitted(result, actor, 'write')) throw invalid('You cannot update this target.', 403);
    if (!policy.ancestorsActive(result)) throw invalid('Replies need a published active parent and at most five levels.');
    transact(() => { if (result.publication_state === 'published') applyUpdateChanges(db, result, actor, allowed); const fields = Object.keys(result); db.prepare(`INSERT INTO activity_entries(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`).run(...Object.values(result)); recordChange(db, 'activity_entries', null, result, 'created'); remember(result); });
    respond(201, result);
    return true;
  }

  const current = available(entryId, body.workspace_id);
  const restoring = req.method === 'PATCH' && Object.hasOwn(body, 'archived_at') && body.archived_at === null && Boolean(current.archived_at);
  const archiving = req.method === 'DELETE' || body.archived_at === true;
  const capabilities = policy.capabilities(current, actor);
  if (!(restoring ? capabilities.can_restore : archiving ? capabilities.can_archive : capabilities.can_edit)) throw invalid('Only the author may edit; an authorized manager may archive or restore published updates.', 403);
  if ((restoring || archiving) && Object.keys(body).some(key => !['workspace_id', 'version', 'archived_at', 'idempotency_key'].includes(key))) throw invalid('Archive and restore cannot also change update content.');
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
  result.published_at = current.published_at || (result.publication_state === 'published' ? time : null);
  transact(() => {
    if (current.publication_state === 'draft' && result.publication_state === 'published') applyUpdateChanges(db, result, actor, allowed);
    db.prepare('UPDATE activity_entries SET work_changes_json=?,attachments_json=? WHERE id=? AND version=?').run(result.work_changes_json, result.attachments_json, entryId, current.version);
    const changed = db.prepare('UPDATE activity_entries SET update_type=?,content=?,title=?,health=?,publication_state=?,published_at=?,version=?,archived_at=?,updated_at=? WHERE id=? AND version=?').run(result.update_type, result.content, result.title, result.health, result.publication_state, result.published_at, result.version, result.archived_at, result.updated_at, entryId, current.version);
    if (changed.changes !== 1) throw invalid('This update changed. Refresh it before continuing.', 409);
    recordChange(db, 'activity_entries', current, result, result.archived_at && !current.archived_at ? 'archived' : current.archived_at && !result.archived_at ? 'restored' : current.publication_state === 'draft' && result.publication_state === 'published' ? 'published' : 'updated'); remember(result);
  });
  respond(200, result);
  return true;
}

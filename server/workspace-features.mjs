import { randomUUID } from 'node:crypto';
import { RESOURCE_TYPES, matchingRoutes } from '../src/lib/settings-catalog.js';
import { isRecord, validationError, validateAvatar } from './validation.mjs';
import { emojiShortcode } from '../src/lib/custom-emojis.js';
import { ICON_REACTIONS } from '../src/lib/reaction-catalog.js';
import { guardRouteMutation } from './route-hierarchy.mjs';
import { changeContext } from './change-context.mjs';
import { bumpAgentProfileVersion } from './agent-profiles.mjs';
const stamp = () => new Date().toISOString();
const uid = prefix => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
const decode = row => row ? { ...row, payload: JSON.parse(row.payload_json), payload_json: undefined } : null;
export function installWorkspaceFeatures(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_items (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, name TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
    position INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
    archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS workspace_items_scope ON workspace_items(workspace_id,kind);
    CREATE TABLE IF NOT EXISTS change_log (
      id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
      name TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS change_log_scope ON change_log(workspace_id,created_at);
    CREATE TABLE IF NOT EXISTS change_attribution (change_id TEXT PRIMARY KEY REFERENCES change_log(id) ON DELETE CASCADE, actor_id TEXT, actor_name TEXT NOT NULL, source TEXT NOT NULL);`);
}
export function featureSnapshot(db) {
  return {
    workspace_items: db.prepare('SELECT * FROM workspace_items ORDER BY position,created_at').all().map(decode),
    audit_log: db.prepare('SELECT id,workspace_id,entity_type,entity_id,action,name,created_at FROM change_log ORDER BY created_at DESC LIMIT 1000').all(),
  };
}
export function recordChange(db, resource, before, after, action) {
  if (resource === 'activity_entries') {
    if ((after || before)?.publication_state === 'draft') return;
    if (before?.publication_state === 'draft') before = null;
  }
  const item = after ?? before;
  const workspaceId = item?.workspace_id ?? (resource === 'workspaces' ? item?.id : null);
  if (!workspaceId) return;
  // Only workspace content is retained; never credentials or connection payloads.
  const id = uid('change');
  db.prepare('INSERT INTO change_log VALUES (?,?,?,?,?,?,?,?,?)').run(id, workspaceId, resource, item.id, action, item.name ?? item.title ?? resource, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, stamp());
  const context = changeContext.getStore();
  if (context?.actor) db.prepare('INSERT INTO change_attribution VALUES(?,?,?,?)').run(id, context.actor.id, context.actor.name || 'Member', context.source || 'Rumbo');
}
function activeWorkspace(db, workspaceId) {
  if (typeof workspaceId !== 'string' || !db.prepare('SELECT 1 FROM workspaces WHERE id=? AND archived_at IS NULL').get(workspaceId)) throw validationError('Choose an active workspace.');
}
export function payloadFor(db, kind, input, workspaceId, { allowArchived = false } = {}) {
  if (!isRecord(input)) throw validationError('Provide valid fields.');
  const fields = RESOURCE_TYPES[kind]?.fields;
  if (!fields) throw validationError('Unknown workspace resource.');
  const result = {};
  for (const key of Object.keys(input)) if (!Object.hasOwn(fields, key) && key !== 'route_id' && !(kind === 'emoji' && key === 'shortcode')) throw validationError(`Unknown field: ${key}.`);
  if (kind === 'emoji' && input.shortcode !== undefined) {
    if (typeof input.shortcode !== 'string' || !/^[a-z0-9_-]{1,160}$/.test(input.shortcode)) throw validationError('Invalid emoji shortcode.');
    result.shortcode = input.shortcode;
  }
  for (const [key, field] of Object.entries(fields)) {
    const value = input[key] ?? (field.type === 'refs' ? [] : field.type === 'choice' ? field.options[0] : field.type === 'color' ? '#93949c' : '');
    if (field.type === 'refs') {
      if (!Array.isArray(value) || value.length > 100 || new Set(value).size !== value.length) throw validationError(`${field.label} must be a list of up to 100 unique items.`);
      for (const id of value) {
        if (typeof id !== 'string') throw validationError(`Invalid ${field.label}.`);
        const row = db.prepare(`SELECT workspace_id,archived_at FROM ${field.collection} WHERE id=?`).get(id);
        if (!row || (!allowArchived && row.archived_at) || (row.workspace_id !== workspaceId && !(field.collection === 'agents' && !row.workspace_id))) throw validationError(`${field.label} must belong to this workspace and be active.`);
      }
      if (kind === 'queue' && value.length > 1) throw validationError('A work brief supports one project and one agent.');
    } else {
      if (typeof value !== 'string' || value.length > (field.max ?? (field.type === 'textarea' ? 50000 : 500))) throw validationError(`${field.label} is invalid or too long.`);
      if (field.type === 'image') {
        if (value.startsWith('data:')) validateAvatar(value);
        else if (!value || value.length > 24 || /[<>:/]/.test(value)) throw validationError('Upload a PNG, JPEG, or WebP emoji image.');
      }
      if (field.type === 'choice' && !field.options.includes(value)) throw validationError(`Choose a valid ${field.label.toLowerCase()}.`);
      if (field.type === 'icon' && value && !ICON_REACTIONS.some(icon => icon.id === value)) throw validationError('Choose a status icon from the icon catalog.');
      if (field.type === 'color' && !/^#[\da-f]{6}$/i.test(value)) throw validationError('Choose a six-digit hex color.');
    }
    result[key] = value;
  }
  return result;
}
export function validateCustomFields(db, resource, record) {
  if (!['tasks', 'projects'].includes(resource)) return;
  const prefix = resource === 'tasks' ? 'route' : 'project';
  for (const id of record.labels_json ?? []) {
    const label = db.prepare('SELECT workspace_id,kind FROM workspace_items WHERE id=?').get(id);
    if (label && (label.workspace_id !== record.workspace_id || label.kind !== `${prefix}_label`)) throw validationError('Choose labels for this type of work from the same workspace.');
  }
  if (record.workflow_status_id) {
    const status = decode(db.prepare('SELECT * FROM workspace_items WHERE id=?').get(record.workflow_status_id));
    if (!status || status.workspace_id !== record.workspace_id || status.kind !== `${prefix}_status` || status.archived_at) throw validationError('Choose an active status from this workspace.');
    if (record.status !== undefined && record.status !== status.payload.category) throw validationError('The custom status must match its lifecycle stage.');
    record.status = status.payload.category;
  }
}
export async function featureRoute({ db, req, res, path, url, readBody, send, snapshot, actor, allowed }) {
  if (!path.startsWith('/workspace-items') && !path.startsWith('/history/')) return false;
  if (path.startsWith('/history/')) {
    if (req.method !== 'GET') return false;
    const entityId = decodeURIComponent(path.slice(9));
    const workspaceId = url.searchParams.get('workspace_id');
    activeWorkspace(db, workspaceId);
    send(res, 200, { result: db.prepare('SELECT * FROM change_log WHERE entity_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 100').all(entityId, workspaceId).map(row => ({ ...row, before: row.before_json ? JSON.parse(row.before_json) : null, after: row.after_json ? JSON.parse(row.after_json) : null, before_json: undefined, after_json: undefined })) }); return true;
  }
  const match = path.match(/^\/workspace-items(?:\/([^/]+))?(?:\/(action))?$/);
  if (!match) return false;
  const [, itemId, action] = match;
  const current = itemId ? decode(db.prepare('SELECT * FROM workspace_items WHERE id=?').get(itemId)) : null;
  if (itemId && !current) throw validationError('This item no longer exists.');
  if (req.method === 'POST' && action) {
    const body = await readBody(req);
    activeWorkspace(db, current.workspace_id);
    if (current.archived_at) throw validationError('Restore this item first.');
    if (body.version !== current.version) throw Object.assign(validationError('This item changed. Refresh and review it before continuing.'), { statusCode: 409 });
    const result = executeAction(db, current, body, snapshot, { actor, allowed });
    send(res, 200, { result, bootstrap: snapshot(db) }); return true;
  }
  if (req.method !== 'POST' && req.method !== 'PATCH') return false;
  const body = await readBody(req);
  const workspaceId = current?.workspace_id ?? body.workspace_id;
  activeWorkspace(db, workspaceId);
  if (current && (body.workspace_id && body.workspace_id !== workspaceId || body.kind && body.kind !== current.kind)) throw validationError('Items cannot change workspace or type.');
  if (current && body.version !== current.version) throw Object.assign(validationError('This item changed elsewhere. Reopen it before saving.'), { statusCode: 409 });
  const kind = current?.kind ?? body.kind;
  if (!RESOURCE_TYPES[kind]) throw validationError('Choose a supported resource type.');
  const name = body.name ?? current?.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 160) throw validationError('Name must be 1–160 characters.');
  const payload = payloadFor(db, kind, body.payload ?? current?.payload ?? {}, workspaceId, { allowArchived: Boolean(body.archived_at) });
  if (kind === 'emoji') {
    // Keep old messages stable when the display name changes. Reserve archived codes too.
    payload.shortcode = current ? emojiShortcode(current).slice(1, -1) : name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    if (!current && !/[a-z0-9]/.test(payload.shortcode)) throw validationError('Include a letter or number in the emoji name for its shortcode.');
    const others = db.prepare("SELECT * FROM workspace_items WHERE workspace_id=? AND kind='emoji' AND id<>?").all(workspaceId, itemId ?? '').map(decode);
    if (others.some(item => emojiShortcode(item) === `:${payload.shortcode}:`)) throw validationError('This emoji shortcode is already in use, including archived emojis. Choose a different name.');
  }
  if (current?.payload.route_id) payload.route_id = current.payload.route_id;
  const archived = body.archived_at === undefined ? current?.archived_at ?? null : body.archived_at;
  if (archived !== null && (typeof archived !== 'string' || !Number.isFinite(Date.parse(archived)))) throw validationError('Invalid archive date.');
  if (!archived && db.prepare('SELECT 1 FROM workspace_items WHERE workspace_id=? AND kind=? AND lower(name)=lower(?) AND archived_at IS NULL AND id<>?').get(workspaceId, kind, name.trim(), itemId ?? '')) throw validationError('An item with this name already exists.');
  if (current && kind.endsWith('_status') && (archived || payload.category !== current.payload.category)) {
    const table = kind === 'route_status' ? 'tasks' : 'projects';
    if (db.prepare(`SELECT 1 FROM ${table} WHERE workflow_status_id=?`).get(itemId)) throw validationError('Move the items using this status to another stage before archiving or changing its lifecycle.');
  }
  const position = body.position ?? current?.position ?? Number(db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM workspace_items WHERE workspace_id=? AND kind=?').get(workspaceId, kind).n);
  if (!Number.isFinite(position) || Math.abs(position) > 1e8) throw validationError('Invalid order.');
  const next = { id: itemId ?? uid('item'), workspace_id: workspaceId, kind, name: name.trim(), payload, position, version: (current?.version ?? 0) + 1, archived_at: archived, created_at: current?.created_at ?? stamp(), updated_at: stamp() };
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO workspace_items VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload_json=excluded.payload_json,position=excluded.position,version=excluded.version,archived_at=excluded.archived_at,updated_at=excluded.updated_at').run(next.id, workspaceId, kind, next.name, JSON.stringify(payload), position, next.version, archived, next.created_at, next.updated_at);
    recordChange(db, 'workspace_items', current, next, archived ? 'archived' : current?.archived_at ? 'restored' : current ? 'updated' : 'created');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  send(res, current ? 200 : 201, { result: next, bootstrap: snapshot(db) }); return true;
}
function executeAction(db, item, body, snapshot, options = {}) {
  const p = payloadFor(db, item.kind, item.payload, item.workspace_id);
  const time = stamp();
  if (body.action === 'preview-rule' && item.kind === 'automation') {
    return { matches: matchingRoutes(snapshot(db), p).filter(t => t.workspace_id === item.workspace_id).map(t => ({ id: t.id, title: t.title, status: t.status })) };
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    let result;
    if (body.action === 'merge-label' && item.kind.endsWith('_label')) {
      const target = decode(db.prepare('SELECT * FROM workspace_items WHERE id=?').get(body.target_id ?? ''));
      if (!target || target.id === item.id || target.kind !== item.kind || target.workspace_id !== item.workspace_id || target.archived_at) throw validationError('Choose another active label in this workspace.');
      const table = item.kind === 'route_label' ? 'tasks' : 'projects';
      let count = 0;
      for (const row of db.prepare(`SELECT * FROM ${table} WHERE workspace_id=?`).all(item.workspace_id)) {
        const labels = JSON.parse(row.labels_json);
        if (!labels.includes(item.id) && !labels.includes(item.name)) continue;
        const merged = [...new Set(labels.map(id => id === item.id || id === item.name ? target.id : id))];
        db.prepare(`UPDATE ${table} SET labels_json=?,updated_at=? WHERE id=?`).run(JSON.stringify(merged), time, row.id);
        recordChange(db, table, { ...row, labels_json: undefined, labels }, { ...row, labels_json: undefined, labels: merged }, 'labels merged'); count++;
      }
      db.prepare('UPDATE workspace_items SET archived_at=?,version=version+1,updated_at=? WHERE id=?').run(time, time, item.id);
      recordChange(db, 'workspace_items', item, { ...item, archived_at: time }, 'merged label');
      result = { count };
    } else if (body.action === 'apply-rule' && item.kind === 'automation') {
      const matches = matchingRoutes(snapshot(db), p).filter(t => t.workspace_id === item.workspace_id);
      // A preview is an explicit concurrency boundary: do not mutate new matches.
      if (!Array.isArray(body.ids) || JSON.stringify([...body.ids].sort()) !== JSON.stringify(matches.map(t => t.id).sort())) throw validationError('Matching routes changed. Preview the rule again.');
      for (const task of matches) {
        guardRouteMutation(db, task, { ...task, status: p.to }, options);
        db.prepare('UPDATE tasks SET status=?,workflow_status_id=NULL,updated_at=? WHERE id=?').run(p.to, time, task.id);
        recordChange(db, 'tasks', task, { ...task, status: p.to, workflow_status_id: null }, 'rule applied');
      }
      result = { count: matches.length };
    } else if (body.action === 'instantiate' && item.kind.endsWith('_template')) {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 160) throw validationError('Give the new item a name.');
      if (item.kind === 'route_template') {
        const id = uid('task'), number = db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM tasks WHERE workspace_id=?').get(item.workspace_id).n;
        db.prepare('INSERT INTO tasks (id,workspace_id,number,title,description,status,priority,assignee_agent_ids_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, item.workspace_id, number, body.name.trim(), p.content, p.status, p.priority, JSON.stringify(p.agent_ids), time, time);
        recordChange(db, 'tasks', null, { id, workspace_id: item.workspace_id, title: body.name.trim() }, 'created from template');
        result = { view: 'tasks', id };
      } else if (item.kind === 'project_template') {
        const id = uid('project');
        db.prepare('INSERT INTO projects (id,workspace_id,name,identifier,description,goal,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, item.workspace_id, body.name.trim(), id.slice(-12).toUpperCase(), p.content, p.goal, 'planned', time, time);
        for (const title of p.milestones.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 50)) db.prepare('INSERT INTO milestones (id,workspace_id,project_id,title,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(uid('milestone'), item.workspace_id, id, title, time, time);
        recordChange(db, 'projects', null, { id, workspace_id: item.workspace_id, name: body.name.trim() }, 'created from template');
        result = { view: 'projects', id };
      } else {
        const id = uid('chat');
        db.prepare('INSERT INTO chats (id,workspace_id,title,kind,participant_agent_ids_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, item.workspace_id, body.name.trim(), 'general', JSON.stringify(p.agent_ids), time, time);
        if (p.content) db.prepare('INSERT INTO messages (id,chat_id,sender_type,sender_name,content,kind,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(uid('message'), id, 'user', 'You', p.content, 'note', time, time);
        recordChange(db, 'chats', null, { id, workspace_id: item.workspace_id, title: body.name.trim() }, 'created from template');
        result = { view: 'chats', id };
      }
    } else if (body.action === 'convert' && item.kind === 'request') {
      if (item.payload.route_id && db.prepare('SELECT 1 FROM tasks WHERE id=?').get(item.payload.route_id)) { db.exec('COMMIT'); return { view: 'tasks', id: item.payload.route_id }; }
      const id = uid('task'), number = db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM tasks WHERE workspace_id=?').get(item.workspace_id).n;
      db.prepare('INSERT INTO tasks (id,workspace_id,number,title,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, item.workspace_id, number, item.name, p.content, 'backlog', time, time);
      const after = { ...item, payload: { ...p, state: 'accepted', route_id: id }, version: item.version + 1, updated_at: time };
      db.prepare('UPDATE workspace_items SET payload_json=?,version=?,updated_at=? WHERE id=?').run(JSON.stringify(after.payload), after.version, time, item.id);
      recordChange(db, 'workspace_items', item, after, 'converted to route');
      recordChange(db, 'tasks', null, { id, workspace_id: item.workspace_id, title: item.name }, 'created');
      result = { view: 'tasks', id };
    } else if (body.action === 'apply-preset' && item.kind === 'preset') {
      const agent = db.prepare('SELECT * FROM agents WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(body.agent_id ?? '', item.workspace_id);
      if (!agent) throw validationError('Choose a workspace-owned agent. Shared profiles cannot be overwritten here.');
      db.prepare('UPDATE agents SET instructions=?,updated_at=? WHERE id=?').run(p.content, time, agent.id);
      bumpAgentProfileVersion(db, agent.id, ['instructions'], time);
      recordChange(db, 'agents', agent, { ...agent, instructions: p.content }, 'preset applied');
      result = { view: 'agents', id: agent.id };
    } else throw validationError('Unsupported action.');
    db.exec('COMMIT'); return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

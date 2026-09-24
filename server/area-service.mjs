import { recordChange } from './workspace-features.mjs';

export const AREA_READ_TOOLS = ['search_workspace', 'get_area_context', 'get_project_context', 'get_route', 'search_knowledge', 'read_document'];
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode, code: statusCode === 409 ? 'stale_version' : 'invalid_area_settings' }); };
export function installAreas(db) {
  // Compatibility migration: identity, ownership, grants and historical team IDs
  // stay untouched. Defaults describe intent; they never grant execution access.
  db.exec(`CREATE TABLE IF NOT EXISTS area_settings (
    id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    instructions TEXT NOT NULL DEFAULT '',
    default_agent_ids_json TEXT NOT NULL DEFAULT '[]',
    context_pack_ids_json TEXT NOT NULL DEFAULT '[]',
    allowed_tools_json TEXT NOT NULL DEFAULT '[]',
    permission_policy TEXT NOT NULL DEFAULT 'review' CHECK(permission_policy='review'),
    contacts_enabled INTEGER NOT NULL DEFAULT 0 CHECK(contacts_enabled IN (0,1)),
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );`);
}
export function areaSettings(db, area) {
  const row = db.prepare('SELECT * FROM area_settings WHERE id=?').get(area.id);
  return row ? { id: row.id, workspace_id: row.workspace_id, instructions: row.instructions, default_agent_ids: JSON.parse(row.default_agent_ids_json), context_pack_ids: JSON.parse(row.context_pack_ids_json), allowed_tools: JSON.parse(row.allowed_tools_json), permission_policy: row.permission_policy, contacts_enabled: Boolean(row.contacts_enabled), version: row.version, updated_at: row.updated_at } : { id: area.id, workspace_id: area.workspace_id, instructions: '', default_agent_ids: [], context_pack_ids: [], allowed_tools: [], permission_policy: 'review', contacts_enabled: false, version: 0, updated_at: area.updated_at };
}
export function areaSnapshot(db) { return { area_settings: db.prepare('SELECT * FROM teams').all().map(area => areaSettings(db, area)) }; }

// Shared by response redaction and updates: a filtered reference must not be
// mistaken for an intentional deletion when a caller saves the visible form.
export function areaReferenceReadable(db, workspaceId, table, id, allowed, actor) {
  if (!['agents', 'workspace_items', 'documents', 'memory_notes'].includes(table)) return false;
  const source = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!source || source.workspace_id !== workspaceId) return false;
  const scope = table === 'agents' ? { scope_type: 'agent', scope_id: id } : source.project_id ? { scope_type: 'project', scope_id: source.project_id } : source.team_id ? { scope_type: 'team', scope_id: source.team_id } : {};
  const permission = table === 'agents' ? 'agents.read' : table === 'workspace_items' ? 'workspace.read' : 'documents.read';
  if (!allowed(workspaceId, actor, permission, scope)) return false;
  if (table === 'workspace_items') {
    if (source.kind !== 'context_pack') return false;
    const payload = JSON.parse(source.payload_json || '{}');
    return (payload.document_ids || []).every(id => areaReferenceReadable(db, workspaceId, 'documents', id, allowed, actor)) && (payload.memory_ids || []).every(id => areaReferenceReadable(db, workspaceId, 'memory_notes', id, allowed, actor));
  }
  return true;
}

export function validateAreaSettings(db, area, input, allowed = () => true, actor = null, { importing = false } = {}) {
  const permitted = ['workspace_id', 'version', 'instructions', 'default_agent_ids', 'context_pack_ids', 'allowed_tools', 'permission_policy', 'contacts_enabled'];
  if (Object.keys(input).some(key => !permitted.includes(key))) fail('Unknown Area setting.');
  if (input.workspace_id && input.workspace_id !== area.workspace_id) fail('Area belongs to another workspace.');
  const current = areaSettings(db, area), result = { ...current, ...input };
  if (typeof result.instructions !== 'string' || result.instructions.length > 20000) fail('Area instructions must be at most 20,000 characters.');
  if (result.permission_policy !== 'review') fail('Area defaults cannot grant automatic execution or mutation permissions.');
  if (typeof result.contacts_enabled !== 'boolean') fail('Contacts visibility must be true or false.');
  for (const field of ['default_agent_ids', 'context_pack_ids', 'allowed_tools']) {
    if (!Array.isArray(result[field]) || result[field].length > 50 || result[field].some(id => typeof id !== 'string') || new Set(result[field]).size !== result[field].length) fail(`Invalid ${field}.`);
  }
  const hidden = {};
  for (const [field, table] of [['default_agent_ids', 'agents'], ['context_pack_ids', 'workspace_items']]) {
    hidden[field] = new Set(importing ? [] : current[field].filter(id => {
      const source = db.prepare(`SELECT workspace_id FROM ${table} WHERE id=?`).get(id);
      return source?.workspace_id === area.workspace_id && !areaReferenceReadable(db, area.workspace_id, table, id, allowed, actor);
    }));
    result[field] = [...new Set([...result[field], ...hidden[field]])];
    if (result[field].length > 50) fail('This Area has additional unavailable defaults. Fewer selections are required.');
  }
  if (result.allowed_tools.some(tool => !AREA_READ_TOOLS.includes(tool))) fail('Only known read-tool preferences can be saved in an Area.');
  for (const id of result.default_agent_ids) {
    if (hidden.default_agent_ids.has(id)) continue;
    const agent = db.prepare('SELECT * FROM agents WHERE id=?').get(id);
    if (!agent || agent.workspace_id !== area.workspace_id || !importing && agent.archived_at || !allowed(area.workspace_id, actor, 'agents.read', { scope_type: 'agent', scope_id: id })) fail('Choose an accessible agent from this workspace.');
  }
  for (const id of result.context_pack_ids) {
    if (hidden.context_pack_ids.has(id)) continue;
    const pack = db.prepare('SELECT * FROM workspace_items WHERE id=?').get(id);
    if (!pack || pack.kind !== 'context_pack' || pack.workspace_id !== area.workspace_id || !importing && pack.archived_at) fail('Choose a Context Pack from this workspace.');
    if (!areaReferenceReadable(db, area.workspace_id, 'workspace_items', id, allowed, actor)) fail('Choose an accessible Context Pack from this workspace.');
    const payload = JSON.parse(pack.payload_json);
    for (const [table, ids] of [['documents', payload.document_ids], ['memory_notes', payload.memory_ids]]) for (const ref of ids || []) {
      const item = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(ref);
      if (!item || item.workspace_id !== area.workspace_id || !allowed(area.workspace_id, actor, 'documents.read', item.project_id ? { scope_type: 'project', scope_id: item.project_id } : { scope_type: 'team', scope_id: item.team_id })) fail('Context Pack contains unavailable sources.');
    }
  }
  return result;
}

export function saveAreaSettings(db, value) {
  db.prepare(`INSERT INTO area_settings(id,workspace_id,instructions,default_agent_ids_json,context_pack_ids_json,allowed_tools_json,permission_policy,contacts_enabled,version,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET instructions=excluded.instructions,default_agent_ids_json=excluded.default_agent_ids_json,context_pack_ids_json=excluded.context_pack_ids_json,allowed_tools_json=excluded.allowed_tools_json,permission_policy=excluded.permission_policy,contacts_enabled=excluded.contacts_enabled,version=excluded.version,updated_at=excluded.updated_at`).run(value.id, value.workspace_id, value.instructions, JSON.stringify(value.default_agent_ids), JSON.stringify(value.context_pack_ids), JSON.stringify(value.allowed_tools), 'review', Number(value.contacts_enabled), value.version, value.updated_at);
}

export async function areaRoute({ db, req, res, path, body, send, actor, allowed }) {
  const match = path.match(/^\/areas\/([^/]+)\/settings$/);
  if (!match) return false;
  const id = decodeURIComponent(match[1]), area = db.prepare('SELECT * FROM teams WHERE id=?').get(id);
  if (!area || !allowed(area.workspace_id, actor, 'workspace.read', { scope_type: 'team', scope_id: id })) fail('Area unavailable.', 404);
  if (req.method === 'GET') { send(res, 200, { result: areaSettings(db, area) }); return true; }
  if (req.method !== 'PATCH') fail('Use GET or PATCH for Area settings.', 405);
  if (area.archived_at || !allowed(area.workspace_id, actor, 'workspace.write', { scope_type: 'team', scope_id: id })) fail('Area settings are not editable.', 403);
  const before = areaSettings(db, area);
  if (!Number.isInteger(body.version) || body.version !== before.version) fail('Area settings changed. Reload before saving.', 409);
  const result = validateAreaSettings(db, area, body, allowed, actor);
  result.version = before.version + 1; result.updated_at = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    saveAreaSettings(db, result);
    recordChange(db, 'area_settings', before, result, 'updated');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  send(res, 200, { result }); return true;
}

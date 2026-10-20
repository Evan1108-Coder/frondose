import { assertFrondoseSourceReferences } from './context-source-access.mjs';

export const ACTIVITY_TARGET_TABLES = Object.freeze({ project: 'projects', route: 'tasks', request: 'workspace_items', document: 'documents', output: 'outputs', milestone: 'milestones', chat: 'chats' });
const AREAS = { project: 'projects', route: 'routes', request: 'workspace', document: 'documents', output: 'documents', milestone: 'projects', chat: 'chats' };
const VIEWS = { project: 'projects', route: 'tasks', request: 'requests', document: 'documents', output: 'library', milestone: 'projects', chat: 'chats' };
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };

export function createActivityPolicy(db, allowed = () => true) {
  const row = (table, id) => id ? db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) : null;
  function target(entry) {
    const table = ACTIVITY_TARGET_TABLES[entry.target_type];
    const item = table && row(table, entry.target_id);
    if (!item || item.workspace_id !== entry.workspace_id || entry.target_type === 'request' && item.kind !== 'request') return null;
    const requestRouteId = entry.target_type === 'request' ? (item.payload || parse(item.payload_json)).route_id : null;
    const requestRoute = row('tasks', requestRouteId);
    if (requestRouteId && !requestRoute) return null;
    if (requestRoute && requestRoute.workspace_id !== entry.workspace_id) return null;
    const projectId = entry.target_type === 'project' ? item.id : item.project_id || requestRoute?.project_id || null;
    const project = projectId ? row('projects', projectId) : null;
    if (projectId && (!project || project.workspace_id !== entry.workspace_id)) return null;
    const referencedIds = entry.target_type === 'request' ? (item.payload || parse(item.payload_json)).project_ids || [] : [];
    if (!Array.isArray(referencedIds)) return null;
    const referencedProjects = referencedIds.map(id => row('projects', id));
    if (referencedProjects.some(value => !value || value.workspace_id !== entry.workspace_id)) return null;
    const at = projectId ? { scope_type: 'project', scope_id: projectId } : item.team_id ? { scope_type: 'team', scope_id: item.team_id } : {};
    return { item, table, area: AREAS[entry.target_type], at, requestRoute, scopes: [at, ...referencedIds.map(id => ({ scope_type: 'project', scope_id: id }))], active: !item.archived_at && !project?.archived_at && !requestRoute?.archived_at && !referencedProjects.some(value => value.archived_at),
      display: { type: entry.target_type, id: item.id, title: item.title || item.name || 'Untitled', team_id: project?.team_id || item.team_id || null, project_id: projectId, project_ids: [...new Set([projectId, ...referencedIds].filter(Boolean))], view: VIEWS[entry.target_type] } };
  }
  function permitted(entry, actor, verb) {
    const destination = target(entry);
    if (!destination || !destination.scopes.every(at => allowed(entry.workspace_id, actor, `${destination.area}.${verb}`, at))) return false;
    try {
      assertFrondoseSourceReferences(db, entry, 'activity_entries', actor, allowed);
      assertFrondoseSourceReferences(db, destination.item, destination.table, actor, allowed);
    } catch { return false; }
    return !destination.requestRoute || allowed(entry.workspace_id, actor, 'routes.read', destination.at);
  }
  function visible(entry, actor, { exporting = false } = {}) {
    if (!entry || !actor?.id) return false;
    if (entry.publication_state === 'draft' && (exporting || entry.actor_id !== actor.id)) return false;
    return permitted(entry, actor, 'read');
  }
  function ancestorsActive(entry) {
    const seen = new Set([entry.id]); let current = entry;
    while (current.parent_id) {
      if (seen.has(current.parent_id) || seen.size >= 5) return false;
      seen.add(current.parent_id); current = row('activity_entries', current.parent_id);
      if (!current || current.archived_at || current.publication_state !== 'published' || current.target_type !== entry.target_type || current.target_id !== entry.target_id || current.workspace_id !== entry.workspace_id) return false;
    }
    return true;
  }
  function capabilities(entry, actor) {
    const destination = target(entry), isAuthor = entry.actor_type === 'user' && entry.actor_id === actor?.id;
    const rank = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='governance_members'").get() ? db.prepare("SELECT rank FROM governance_members WHERE workspace_id=? AND id=? AND status='active'").get(entry.workspace_id, actor?.id || '')?.rank : null;
    const moderator = ['Owner', 'Admin', 'Manager'].includes(rank);
    const readable = visible(entry, actor), active = readable && destination?.active && ancestorsActive(entry);
    const write = active && permitted(entry, actor, 'write');
    const remove = active && permitted(entry, actor, 'delete') && (isAuthor || moderator && entry.publication_state !== 'draft');
    let depth = 1, ancestor = entry;
    while (ancestor?.parent_id && depth < 6) { ancestor = row('activity_entries', ancestor.parent_id); depth++; }
    return { is_author: isAuthor, can_edit: Boolean(write && isAuthor && !entry.archived_at), can_archive: Boolean(remove && !entry.archived_at), can_restore: Boolean(remove && entry.archived_at), can_reply: Boolean(write && depth < 5 && !entry.archived_at && entry.publication_state === 'published'), can_react: Boolean(write && !entry.archived_at && entry.publication_state === 'published') };
  }
  function present(entry, actor) {
    const destination = target(entry);
    const reactions = db.prepare('SELECT reaction_id AS id,color,COUNT(*) AS count,MAX(actor_id=?) AS mine FROM activity_reactions WHERE entry_id=? GROUP BY reaction_id,color ORDER BY MIN(created_at),reaction_id,color').all(actor?.id || '', entry.id).map(value => ({ ...value, color: value.color || null, mine: Boolean(value.mine) }));
    return { ...entry, ...capabilities(entry, actor), reactions, target: destination?.display || null,
      permalink: `#/updates/${encodeURIComponent(entry.id)}` };
  }
  function historyVisible(change, actor, options) {
    const current = row('activity_entries', change.entity_id);
    if (!current || !visible(current, actor, options)) return false;
    if (!Object.hasOwn(change, 'before') && !Object.hasOwn(change, 'before_json')) change = row('change_log', change.id) || change;
    const before = change.before ?? (change.before_json ? parse(change.before_json) : null);
    const after = change.after ?? (change.after_json ? parse(change.after_json) : null);
    // Inspect immutable snapshots, not just the current publication state.
    return ![before, after].some(value => value?.publication_state === 'draft');
  }
  return { target, visible, permitted, capabilities, present, ancestorsActive, historyVisible };
}

const TABLES = { team: 'teams', project: 'projects', route: 'tasks', document: 'documents', chat: 'chats' };
const TYPES = { teams: 'team', projects: 'project', tasks: 'route', route_workflows: 'route', documents: 'document', chats: 'chat', milestones: 'milestone', team_resources: 'resource', activity_entries: 'update' };
const FIELDS = ['status', 'priority', 'reported_progress', 'target_date', 'due_at', 'health', 'parent_task_id', 'archived_at', 'publication_state'];
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const parse = text => { try { return JSON.parse(text || 'null'); } catch { return null; } };

export async function timelineRoute({ db, req, res, path, url, send, actor, allowed, filter }) {
  if (path !== '/timeline' || req.method !== 'GET') return false;
  const ws = url.searchParams.get('workspace_id'), type = url.searchParams.get('target_type'), id = url.searchParams.get('target_id');
  const table = TABLES[type];
  const get = (table, id) => id ? db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) : null;
  const target = table && get(table, id);
  if (!target || target.workspace_id !== ws) fail('Activity target unavailable.', 404);
  const scope = type === 'project' ? { scope_type: 'project', scope_id: id } : target.project_id ? { scope_type: 'project', scope_id: target.project_id } : { scope_type: 'team', scope_id: type === 'team' ? id : target.team_id };
  const area = { team: 'workspace', project: 'projects', route: 'routes', document: 'documents', chat: 'chats' }[type];
  if (!allowed(ws, actor, `${area}.read`, scope)) fail('Activity target unavailable.', 404);
  const limit = Number(url.searchParams.get('limit') || 30);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('Limit must be 1–100.');
  const binding = JSON.stringify([ws, actor.id, type, id]);
  let cursor;
  if (url.searchParams.get('cursor')) {
    try { cursor = JSON.parse(Buffer.from(url.searchParams.get('cursor'), 'base64url').toString()); } catch { fail('Invalid activity cursor.'); }
    if (!Array.isArray(cursor) || cursor.length !== 3 || cursor[0] !== binding || typeof cursor[1] !== 'string' || typeof cursor[2] !== 'string') fail('Activity cursor belongs to another feed.');
  }
  function matches(resource, item) {
    if (!item) return false;
    if (resource === 'activity_entries') return matches({ project: 'projects', route: 'tasks', document: 'documents', chat: 'chats', milestone: 'milestones' }[item.target_type], get({ project: 'projects', route: 'tasks', document: 'documents', chat: 'chats', milestone: 'milestones' }[item.target_type] || 'activity_entries', item.target_id));
    if (resource === 'route_workflows') return type === 'route' && item.parent_task_id === id || matches('tasks', get('tasks', item.id));
    if (resource === table && item.id === id) return true;
    if (type === 'route' && resource === 'tasks') return get('route_workflows', item.id)?.parent_task_id === id;
    if (type === 'project') return item.project_id === id;
    if (type === 'team') return item.team_id === id || Boolean(item.project_id && get('projects', item.project_id)?.team_id === id);
    return false;
  }
  function readable(resource, item) {
    if (!item || item.workspace_id !== ws) return false;
    if (resource === 'activity_entries' || resource === 'route_workflows') return true; // Dedicated history policy above checks target and ancestry.
    const area = { teams: 'workspace', projects: 'projects', tasks: 'routes', documents: 'documents', chats: 'chats', milestones: 'projects', team_resources: 'documents' }[resource];
    if (!area) return false;
    const at = resource === 'projects' ? { scope_type: 'project', scope_id: item.id } : item.project_id ? { scope_type: 'project', scope_id: item.project_id } : { scope_type: 'team', scope_id: resource === 'teams' ? item.id : item.team_id };
    if (!allowed(ws, actor, `${area}.read`, at)) return false;
    // Preserve historical team restrictions after a record moves into a visible project/team.
    return !item.team_id || allowed(ws, actor, `${area}.read`, { scope_type: 'team', scope_id: item.team_id });
  }
  const items = [];
  const query = db.prepare(`SELECT * FROM change_log WHERE workspace_id=? ${cursor ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''} ORDER BY created_at DESC,id DESC`);
  for (const change of query.iterate(ws, ...(cursor ? [cursor[1], cursor[1], cursor[2]] : []))) {
    if (!TYPES[change.entity_type]) continue;
    // Reuse the historical permission boundary before matching or presenting any text.
    if (!filter({ result: [change] }).result.length) continue;
    const before = parse(change.before_json), after = parse(change.after_json);
    const current = get(change.entity_type, change.entity_id);
    if (!readable(change.entity_type, current) || [before, after].filter(Boolean).some(state => !readable(change.entity_type, state))) continue;
    if (!matches(change.entity_type, after) && !matches(change.entity_type, before)) continue;
    const attribution = db.prepare('SELECT actor_name,source FROM change_attribution WHERE change_id=?').get(change.id);
    const values = FIELDS.filter(key => (before?.[key] ?? null) !== (after?.[key] ?? null)).map(key => ({ field: key, before: before?.[key] ?? null, after: after?.[key] ?? null }));
    // Never expose relationship identifiers in an event summary.
    const changes = values.map(value => value.field === 'parent_task_id' ? { field: 'parent', before: value.before ? 'Parent route' : 'None', after: value.after ? 'Parent route' : 'None' } : value);
    const entityType = TYPES[change.entity_type];
    items.push({ id: change.id, created_at: change.created_at, title: entityType === 'update' ? (after?.title || before?.title || (after?.parent_id || before?.parent_id ? 'a reply' : 'an update')) : change.name, action: change.action, kind: entityType, actor_name: attribution?.actor_name || 'Actor not recorded', source: attribution?.source || 'Historical record', changes,
      href: ({ team: 'teams', project: 'projects', route: 'tasks', document: 'documents', chat: 'chats', update: 'updates' })[entityType] ? `#/${({ team: 'teams', project: 'projects', route: 'tasks', document: 'documents', chat: 'chats', update: 'updates' })[entityType]}/${encodeURIComponent(change.entity_id)}` : null });
    if (items.length > limit) break;
  }
  const more = items.length > limit; if (more) items.pop(); const last = items.at(-1);
  send(res, 200, { result: { items, next_cursor: more ? Buffer.from(JSON.stringify([binding, last.created_at, last.id])).toString('base64url') : null } });
  return true;
}

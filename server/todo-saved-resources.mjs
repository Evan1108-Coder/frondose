import {readTeamResource} from './team-resources.mjs';

const invalid = (message, statusCode=400) => Object.assign(Error(message), {statusCode, code:'todo_resource_scope'});
const reference = item => ({kind:'area-resource', id:item.id, teamId:item.team_id, label:item.name.slice(0,200)});
export function resolveTodoResource(db, workspaceId, membership, value) {
  if (typeof value.id !== 'string' || typeof value.teamId !== 'string') throw invalid('Choose a saved Area resource.');
  if (membership.area_scope === 'selected' && !membership.team_ids.includes(value.teamId)) throw invalid('This resource belongs to a different Area. Remove it or include its Area before saving.');
  return reference(readTeamResource(db, workspaceId, value.teamId, value.id));
}
export function listTodoResources(db, workspaceId, membership, query) {
  const q = query.get('q') || '', offset = Number(query.get('offset') || 0);
  if (q.length > 200 || !Number.isSafeInteger(offset) || offset < 0 || offset > 50000) throw invalid('Use a shorter search and a valid resource page.');
  const params = [workspaceId];
  let scope = '';
  if (membership.area_scope === 'selected') {
    scope = ' AND r.team_id IN (' + membership.team_ids.map(() => '?').join(',') + ')';
    params.push(...membership.team_ids);
  }
  params.push(q.trim().toLowerCase(), q.trim().toLowerCase(), offset);
  const rows = db.prepare(`SELECT r.id,r.team_id,r.name,r.kind,r.description,t.name AS area_name FROM team_resources r JOIN teams t ON t.id=r.team_id AND t.workspace_id=r.workspace_id WHERE r.workspace_id=? AND r.archived_at IS NULL AND t.archived_at IS NULL${scope} AND (?='' OR instr(lower(r.name||' '||r.description||' '||t.name),?)>0) ORDER BY r.name COLLATE NOCASE,r.id LIMIT 51 OFFSET ?`).all(...params);
  return {items:rows.slice(0,50).map(item => ({...reference(item), areaName:item.area_name, resourceKind:item.kind, description:item.description.slice(0,160)})), next_offset:rows.length>50?offset+50:null};
}

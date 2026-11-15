export const TODO_STATUSES = [['in-progress', 'In Progress'], ['finished', 'Finished']];
export const todoStatus = value => value == null || value === 'todo' ? 'in-progress' : value;
export function todoAreaMembership(item) {
  const team_ids = Array.isArray(item.team_ids) ? [...new Set(item.team_ids)] : item.team_id ? [item.team_id] : [];
  const area_scope = item.area_scope || (team_ids.length ? 'selected' : 'none');
  return {area_scope, team_ids: area_scope === 'selected' ? team_ids : []};
}
export function todoInArea(item, teamId) {
  const membership = todoAreaMembership(item);
  return membership.area_scope === 'all' || membership.team_ids.includes(teamId);
}
export function todoLaneRows(items, {priority, status} = {}) {
  return items.filter(item => (!priority || item.priority === priority) && (!status || todoStatus(item.status) === status));
}
export function todoMoveFields(item, {priority, status, beforeId} = {}) {
  return {axis: priority ? 'priority' : 'status', priority: priority || item.priority, status: priority ? todoStatus(item.status) : status, ...(beforeId && beforeId !== item.id ? {before_id: beforeId} : {})};
}

import { pageHash } from './navigation.js';

export const UPDATE_TARGETS = [['project', 'Projects', 'projects'], ['route', 'Routes', 'tasks'], ['request', 'Requests', 'workspace_items'], ['document', 'Documents', 'documents'], ['output', 'Outputs', 'outputs'], ['milestone', 'Milestones', 'milestones'], ['chat', 'Chats', 'chats']];
export const UPDATE_HEALTH = [['none', 'No health assessment'], ['on_track', 'On track'], ['at_risk', 'At risk'], ['blocked', 'Blocked']];

export function updateTargets(data, type, workspaceId) {
  const collection = UPDATE_TARGETS.find(([id]) => id === type)?.[2];
  return (data[collection] ?? []).filter(item => item.workspace_id === workspaceId && !item.archived_at && (type !== 'request' || item.kind === 'request'));
}

export function updateTargetLink(entry, data) {
  const type = entry.target_type, id = entry.target_id;
  if (type === 'project') return pageHash('projects', id);
  if (type === 'route') return pageHash('tasks', id);
  if (type === 'document') return pageHash('documents', id);
  if (type === 'output') return pageHash('library', id);
  if (type === 'chat') return pageHash('chats', id);
  if (type === 'milestone') {
    const project = (data.milestones ?? []).find(item => item.id === id)?.project_id;
    return project ? pageHash('projects', project) : null;
  }
  return type === 'request' ? pageHash('operations', 'requests') : null;
}

export function mergeUpdatePages(current, incoming) {
  const items = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) items.set(item.id, item);
  return [...items.values()];
}

// Newly saved roots join the current feed without resetting filters, pagination,
// or the keyed conversation components that may contain unsent replies.
export function insertSavedUpdates(entries, saved, workspaceId, filters) {
  const query = (filters.search || '').toLowerCase();
  const matching = saved.filter(entry => entry.workspace_id === workspaceId && !entry.parent_id
    && entry.publication_state === filters.publicationState
    && (filters.includeArchived || !entry.archived_at)
    && (!filters.targetType || entry.target_type === filters.targetType)
    && (!filters.updateType || entry.update_type === filters.updateType)
    && (!filters.health || entry.health === filters.health)
    && (!filters.projectId || entry.target?.project_ids?.includes(filters.projectId))
    && (!filters.teamId || ['project', 'route'].includes(entry.target_type) && entry.target?.team_id === filters.teamId)
    && (!query || `${entry.title || ''}`.toLowerCase().includes(query) || `${entry.content || ''}`.toLowerCase().includes(query)));
  return mergeUpdatePages([...matching].reverse(), entries);
}

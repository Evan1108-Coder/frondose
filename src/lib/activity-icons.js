import { useSyncExternalStore } from 'react';
import { UPDATE_TYPES } from './activity.js';
import { ICON_REACTIONS } from './reaction-catalog.js';

export const RUN_ACTIVITY_TYPES = Object.freeze([
  ['run-started', 'Run started'], ['approval', 'Approval'], ['tool', 'Tool call'],
  ['file', 'File change'], ['output', 'Output'], ['failed', 'Failure'],
  ['stopped', 'Run stopped'], ['message', 'Message'],
]);
const defaults = Object.fromEntries([...UPDATE_TYPES.map(([id]) => [id, `icon:rumbo-activity-${id}`]), ...RUN_ACTIVITY_TYPES.map(([id]) => [id, `icon:rumbo-activity-${id}`])]);
const allowed = new Set(ICON_REACTIONS.map(item => item.id));
const key = (workspaceId, type) => `rumbo.activity-icon.v1.${workspaceId}.${type}`;
const changed = 'rumbo-activity-icon-change';
export function activityIconId(workspaceId, type) {
  if (!Object.hasOwn(defaults, type)) return defaults.message;
  try { const saved = localStorage.getItem(key(workspaceId, type)); return allowed.has(saved) ? saved : defaults[type]; }
  catch { return defaults[type]; }
}
export function saveActivityIcon(workspaceId, type, id) {
  if (!Object.hasOwn(defaults, type) || !allowed.has(id)) throw new Error('Choose an icon from the Icons catalog.');
  localStorage.setItem(key(workspaceId, type), id);
  dispatchEvent(new Event(changed));
}
export function resetActivityIcon(workspaceId, type) {
  localStorage.removeItem(key(workspaceId, type));
  dispatchEvent(new Event(changed));
}
export function useActivityIcon(workspaceId, type) {
  return useSyncExternalStore(callback => {
    addEventListener(changed, callback); addEventListener('storage', callback);
    return () => { removeEventListener(changed, callback); removeEventListener('storage', callback); };
  }, () => activityIconId(workspaceId, type), () => defaults[type] || defaults.message);
}
export function runActivityType(event) {
  const type = String(event?.type || '').toLowerCase();
  if (type.includes('approval') || type.includes('permission')) return 'approval';
  if (type.includes('file')) return 'file';
  if (type.includes('error') || type.includes('fail')) return 'failed';
  if (type.includes('stop') || type.includes('cancel')) return 'stopped';
  if (type.includes('tool') || type.includes('command')) return 'tool';
  if (type.includes('output') || type.includes('response') || type.includes('complete')) return 'output';
  if (type.includes('message')) return 'message';
  return 'run-started';
}

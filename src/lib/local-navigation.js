// Presentation retirement only. Records, provider credentials and historical
// sessions remain untouched; API authority is enforced separately.
export const RETIRED_LOCAL_VIEWS = Object.freeze([
  'overview', 'today', 'inbox', 'workbench', 'rumbo-agent', 'frondose-agent',
  'talvori-agent', 'agents', 'connections', 'ai-connections', 'chats', 'conversations',
  'workflows', 'operations', 'coordination', 'skills', 'work', 'runs',
]);
const retired = new Set(RETIRED_LOCAL_VIEWS);
const retiredCreation = new Set(['agent', 'chat', 'conversation', 'session', 'agent-session']);
export const LOCAL_PRIMARY_NAV = Object.freeze([
  Object.freeze({ id: 'workspace', label: 'Workspace', key: 'O' }),
  Object.freeze({ id: 'projects', label: 'Projects', key: 'P' }),
  Object.freeze({ id: 'tasks', label: 'Routes', key: 'R' }),
  Object.freeze({ id: 'todos', label: 'To Do List', key: 'Q' }),
]);
// Real local destinations offered by sidebar customization. Docs and Settings
// are separate screens; neither is a workspace-tab customization choice.
export const LOCAL_SIDEBAR_PAGES = Object.freeze([
  ...LOCAL_PRIMARY_NAV,
  ...[
    ['starred', 'Starred'], ['updates', 'Updates'],
    ['library', 'Outputs'], ['documents', 'Documents'], ['comments', 'Comments'], ['views', 'Saved views'],
    ['memory', 'Memory'], ['teams', 'Areas'],
  ].map(([id, label]) => Object.freeze({ id, label })),
]);
export function isLocalSidebarItemAllowed(key) {
  return typeof key === 'string' && (/^custom:[\w-]+$/.test(key) || /^entity:(projects|teams):/.test(key) || LOCAL_SIDEBAR_PAGES.some(page => page.id === key));
}

export function isRetiredLocalPage(pageOrView) {
  const value = typeof pageOrView === 'string' ? pageOrView : pageOrView?.view;
  if (typeof value !== 'string') return false;
  return retired.has(value);
}

export function isLocalNavigationItemAllowed(item) {
  const key = typeof item === 'string' ? item : item?.view ?? item?.id ?? item?.key;
  if (typeof key !== 'string') return false;
  const entity = /^entity:([^:]+):/.exec(key);
  return !isRetiredLocalPage(entity?.[1] ?? key);
}

export function isLocalCreationAllowed(kind) {
  return typeof kind === 'string' && !retiredCreation.has(kind);
}

export function isLocalShortcutAllowed(item) {
  const id = typeof item === 'string' ? item : item?.id;
  if (typeof id !== 'string') return false;
  if (id.startsWith('go:')) return !isRetiredLocalPage(id.slice(3));
  if (id.startsWith('create:')) return isLocalCreationAllowed(id.slice(7));
  return true;
}

export const BUILTIN_GROUPS = ['agents', 'teams', 'projects', 'chats'];
export const FIXED_SIDEBAR_TOP = ['overview', 'rumbo-agent'];
export const isFixedSidebarEntry = key => FIXED_SIDEBAR_TOP.includes(key);
function withFixedTop(layout) {
  return { ...layout, root: [...FIXED_SIDEBAR_TOP, ...layout.root.filter(key => !isFixedSidebarEntry(key))],
    groups: layout.groups.map(group => ({ ...group, items: group.items.filter(key => !isFixedSidebarEntry(key)) })) };
}
export const SIDEBAR_TABS = ['overview', 'rumbo-agent', 'starred', 'focus', 'inbox', 'updates', 'work', 'playbooks', 'workbench', 'operations', 'workflows', 'views', 'tasks', 'skills', 'library', 'documents', 'memory', 'connections'];
const staticIds = new Set([...BUILTIN_GROUPS, ...SIDEBAR_TABS]);
export const entityKey = (view, id) => 'entity:' + view + ':' + id;
export function parseEntityKey(key) {
  const match = /^entity:(projects|teams|agents|chats):(.+)$/.exec(key);
  return match ? { view: match[1], id: match[2] } : null;
}
const validKey = key => typeof key === 'string' && key.length <= 600 && !/[\u0000-\u001f]/.test(key) && (staticIds.has(key) || Boolean(parseEntityKey(key)));
export function normalizeSidebarLayout(value, order) {
  const groups = [], groupIds = new Set(), seen = new Set();
  for (const group of Array.isArray(value?.groups) ? value.groups.slice(0, 30) : []) {
    if (!/^custom:[\w-]{1,80}$/.test(group?.id) || groupIds.has(group.id)) continue;
    groupIds.add(group.id);
    const items = [];
    for (const key of Array.isArray(group.items) ? group.items : []) {
      if (!validKey(key) || BUILTIN_GROUPS.includes(key) || seen.has(key)) continue;
      seen.add(key); items.push(key);
    }
    groups.push({ id: group.id, name: String(group.name || 'Untitled group').trim().slice(0, 60) || 'Untitled group', items, collapsed: Boolean(group.collapsed) });
  }
  const defaults = [...order.primary, ...order.sections.flatMap(id => id === 'workspace' ? order.tools : [id])];
  const root = [];
  for (const key of [...(Array.isArray(value?.root) ? value.root : defaults), ...defaults, ...groupIds]) {
    if ((!validKey(key) && !groupIds.has(key)) || seen.has(key)) continue;
    seen.add(key); root.push(key);
  }
  return withFixedTop({ root, groups });
}
export function moveSidebarEntry(layout, key, container = 'root', target = null, after = false) {
  if (key === target || isFixedSidebarEntry(key)) return layout;
  const group = layout.groups.find(g => g.id === container);
  // Built-in collections are never destinations, nor are nested groups supported.
  if (container !== 'root' && (!group || BUILTIN_GROUPS.includes(key) || key.startsWith('custom:'))) return layout;
  if (!validKey(key) && !layout.groups.some(g => g.id === key)) return layout;
  const root = layout.root.filter(id => id !== key);
  const groups = layout.groups.map(g => ({ ...g, items: g.items.filter(id => id !== key) }));
  const destination = container === 'root' ? root : groups.find(g => g.id === container).items;
  const index = target === null ? destination.length : destination.indexOf(target);
  if (index < 0) return layout;
  destination.splice(index + (target !== null && after ? 1 : 0), 0, key);
  return withFixedTop({ root, groups });
}
export function removeSidebarGroup(layout, id) {
  const group = layout.groups.find(g => g.id === id);
  if (!group) return layout;
  return withFixedTop({ root: layout.root.flatMap(key => key === id ? group.items : [key]), groups: layout.groups.filter(g => g.id !== id) });
}

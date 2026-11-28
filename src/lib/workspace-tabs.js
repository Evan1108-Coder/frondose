// Portions adapted from stablyai/orca, Copyright (c) 2026 Lovecast Inc. MIT.
// Source: 51dcef8258230ffea85a907130450b0ad676e22b
// src/shared/tab-types.ts and src/shared/workspace-layout/tab-order.ts.
// Frondose changes: mixed app pages, universal active-tab replacement, bounded
// persistence, no tab colors, no process retirement from tab navigation.
// See third-party/orca/LICENSE and NOTICE.md.
import { pageHash, parsePage } from './navigation.js';
import { isWorkspaceStandalonePage } from './workspace-screens.js';
import { MAX_TAB_VIEWS, automaticViewLayout, normalizeViewLayout, insertViewLayout, resizeViewLayout, removeViewLayout } from './workspace-view-layout.js';

export const MAX_WORKSPACE_TABS = 32;
export const TAB_KINDS = ['app', 'automations', 'release-notes', 'editor', 'editor-home', 'repository', 'source-control', 'worktrees', 'repository-tasks', 'workstation-tool', 'web-app', 'terminal', 'agent-session', 'browser', 'new-tab', 'group'];
export const workspaceTabViews = tab => tab?.contentType === 'group' ? tab.views : tab ? [tab] : [];
export const activeWorkspaceView = tab => tab?.contentType === 'group' ? tab.views.find(view => view.id === tab.activeViewId) || tab.views[0] : tab;
export function workspaceSidebarDestination(tab, hoveredViewId) {
  const leaf=(tab?.contentType==='group'&&tab.views.find(item=>item.id===hoveredViewId))||activeWorkspaceView(tab);
  return leaf?.contentType==='app'?leaf.page:{view:leaf?.contentType==='automations'?'automations':'workspace'};
}
export const isProtectedCliView = tab => ['terminal', 'agent-session'].includes(tab?.contentType) && Boolean(tab.providerId || tab.agentId);
/** Ordinary navigation replaces only within the user's two content families.
 * Runtime/browser views always stay open. The explicit + action uses `open`
 * directly, while an empty chooser is consumed by its selected content. */
export function workspaceNavigationDisposition(current, incoming) {
  if (!current || !incoming) return 'open';
  if (current.contentType === 'new-tab') return incoming.contentType === 'new-tab' ? 'reuse' : 'replace';
  if (current.contentType === 'app' && incoming.contentType === 'app') return pageHash(current.page.view, current.page.id, current.page) === pageHash(incoming.page.view, incoming.page.id, incoming.page) ? 'reuse' : 'replace';
  if (current.contentType === 'app' && incoming.contentType === 'new-tab') return 'replace';
  if (['editor', 'editor-home'].includes(current.contentType) && ['editor', 'editor-home'].includes(incoming.contentType)) {
    if (!current.draft && !incoming.draft && current.path === incoming.path && current.projectId === incoming.projectId && current.rootVersion === incoming.rootVersion) return 'reuse';
    return 'replace';
  }
  return 'open';
}
export function dedupeTabOrder(tabIds) {
  const seen = new Set(), deduped = [];
  for (const tabId of tabIds) {
    if (seen.has(tabId)) continue;
    seen.add(tabId); deduped.push(tabId);
  }
  return deduped;
}
// Orca's canonical order insertion preserves the pin partition and sibling order.
export function insertTabIdIntoOrder(tabOrder, tabs, tabId, isPinned, anchorTabId) {
  const tabById = new Map(tabs.map(tab => [tab.id, tab]));
  const order = dedupeTabOrder([...tabOrder]).filter(id => id !== tabId);
  const firstUnpinnedIndex = order.findIndex(id => !tabById.get(id)?.isPinned);
  const pinnedPrefixEnd = firstUnpinnedIndex === -1 ? order.length : firstUnpinnedIndex;
  const anchorIndex = anchorTabId ? order.indexOf(anchorTabId) : -1;
  const anchorIsPinned = anchorIndex !== -1 && tabById.get(order[anchorIndex])?.isPinned === true;
  let index = isPinned ? pinnedPrefixEnd : order.length;
  if (anchorIndex !== -1) index = anchorIsPinned === isPinned ? anchorIndex + 1 : pinnedPrefixEnd;
  order.splice(index, 0, tabId);
  return order;
}
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const rootVersion = value => identifier(value) || Number.isSafeInteger(value) && value > 0;
// Container/view IDs and draft/runtime entity IDs are separate namespaces.
// A group may retain its original first leaf's ID, but no foreign leaf may use
// that container ID. Runtime entities are unique across every visible leaf.
function uniqueWorkspaceIdentities(tabs) {
  const topIds = new Set(), viewIds = new Set(), entityIds = new Set(), applicationIds = new Set();
  for (const tab of tabs) {
    if (!identifier(tab?.id) || topIds.has(tab.id)) return false;
    topIds.add(tab.id);
    for (const view of workspaceTabViews(tab)) {
      if (!identifier(view?.id) || !identifier(view.entityId) || viewIds.has(view.id) || entityIds.has(view.entityId)) return false;
      viewIds.add(view.id); entityIds.add(view.entityId);
      if (view.contentType === 'web-app') { if (applicationIds.has(view.appId)) return false; applicationIds.add(view.appId); }
    }
  }
  for (const tab of tabs) for (const [index, view] of workspaceTabViews(tab).entries()) {
    if (topIds.has(view.id) && (view.id !== tab.id || tab.contentType === 'group' && index !== 0)) return false;
  }
  return true;
}
const pageLabel = page => ({ todos:'To Do List','work-plan':'Work Plan', overview: 'Today', tasks: 'Routes', agents: 'Your agents', work: 'Runs', connections: 'AI connections', 'rumbo-agent': 'Frondose' }[page?.view] || (page?.view ? page.view[0].toUpperCase() + page.view.slice(1) : 'Today'));
export function safeWorkspaceFile(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 2048 && !/^[\\/]|^[a-z]:|[\u0000-\u001f]/i.test(path) && !path.split(/[\\/]/).some(part => !part || part === '..' || part === '.');
}
export function newWorkspaceTab(contentType = 'new-tab', fields = {}, id = `tab_${globalThis.crypto.randomUUID()}`) {
  if (!TAB_KINDS.includes(contentType) || !identifier(id)) throw new TypeError('Invalid workspace tab');
  const customLabel = typeof fields.customLabel === 'string' ? fields.customLabel.trim().slice(0, 150) : '';
  if (contentType === 'group') {
    if (!Array.isArray(fields.views) || !fields.views.length || fields.views.length > MAX_TAB_VIEWS || fields.views.some(view => !identifier(view?.id) || view.contentType === 'group')) throw new TypeError('A tab supports one to eight distinct views');
    const views = fields.views.map(view => newWorkspaceTab(view.contentType, view, view.id));
    if (new Set(views.map(view => view.id)).size !== views.length || new Set(views.map(view => view.entityId)).size !== views.length) throw new TypeError('Duplicate view identity');
    if (views.slice(1).some(view => view.id === id)) throw new TypeError('A group ID may alias only its first view');
    return { id, entityId: id, contentType, views, activeViewId: views.some(view => view.id === fields.activeViewId) ? fields.activeViewId : views[0].id, layout: normalizeViewLayout(fields.layout, views.map(view => view.id)), label: customLabel || String(fields.label || `${views[0].label} + ${views.length - 1}`).slice(0, 150), ...(customLabel ? { customLabel } : {}), isPinned: fields.isPinned === true };
  }
  const page = contentType === 'app' ? parsePage(pageHash(fields.page?.view || 'overview', fields.page?.id || null, fields.page || {})) : undefined;
  if (isWorkspaceStandalonePage(page)) throw new TypeError(`${page.view === 'docs' ? 'Docs' : 'Settings'} is a separate screen, not a workspace tab`);
  if (fields.entityId !== undefined && !identifier(fields.entityId)) throw new TypeError('Invalid workspace entity identity');
  if (contentType === 'web-app' && !['vscode', 'guacamole', 'parallels-ras', 'web-console'].includes(fields.appId)) throw new TypeError('Choose a supported tab application');
  return { id, entityId: fields.entityId === undefined ? id : fields.entityId, contentType,
    label: customLabel || String(contentType==='app'&&page.view==='todos'&&['todos','Todos'].includes(fields.label)?'To Do List':fields.label || (contentType === 'app' ? pageLabel(page) : 'New tab')).slice(0, 150), ...(customLabel ? { customLabel } : {}), isPinned: fields.isPinned === true,
    ...(page ? { page } : {}), ...(contentType==='release-notes'&&identifier(fields.releaseId)?{releaseId:fields.releaseId}:{}), ...(safeWorkspaceFile(fields.path) ? { path: fields.path } : {}),
    ...(contentType === 'web-app' ? { appId: fields.appId } : {}),
    ...(contentType === 'workstation-tool' ? { toolId: ['ai','versions','devices','environment','computer','dictation'].includes(fields.toolId) ? fields.toolId : 'ai' } : {}),
    ...(contentType === 'workstation-tool' && fields.toolId === 'ai' && identifier(fields.conversationId) ? { conversationId: fields.conversationId } : {}),
    ...(identifier(fields.providerId) ? { providerId: fields.providerId } : {}),
    ...(identifier(fields.agentId) ? { agentId: fields.agentId } : {}),
    ...(fields.terminalHost === 'workspace' && ['terminal', 'agent-session'].includes(contentType) ? { terminalHost: 'workspace' } : identifier(fields.projectId) ? { projectId: fields.projectId } : {}),
    ...(rootVersion(fields.rootVersion) ? { rootVersion: fields.rootVersion } : {}),
    ...(fields.resume === true ? { resume: true } : {}),
    ...(fields.draft === true ? { draft: true } : {}) };
}
export function initialWorkspaceTabs(page = { view: 'overview' }) {
  if (isWorkspaceStandalonePage(page)) page = { view: 'overview' };
  const tab = newWorkspaceTab('app', { page });
  return { version: 1, tabs: [tab], activeTabId: tab.id, orientation: 'horizontal', lastPageHash: pageHash(page.view, page.id, page), recentlyClosed: [] };
}
export function normalizeWorkspaceTabs(value, page) {
  if (!value || value.version !== 1 || !Array.isArray(value.tabs)) return initialWorkspaceTabs(page);
  const seen = new Set(), seenViews = new Set(), seenEntities = new Set(), tabs = [];
  for (const item of value.tabs.slice(0, MAX_WORKSPACE_TABS)) {
    if (!identifier(item?.id) || seen.has(item.id) || seenViews.has(item.id) || !TAB_KINDS.includes(item.contentType)) continue;
    // Unsaved new-file drafts are never revived as if a disk file existed.
    if (item.contentType === 'editor' && (!safeWorkspaceFile(item.path) || item.draft || !rootVersion(item.rootVersion))) continue;
    try {
      let fields = item;
      if (item.contentType === 'group') {
        if (!Array.isArray(item.views)) continue;
        const localIds = new Set(), localEntities = new Set(), views = [];
        for (const view of item.views.slice(0, MAX_TAB_VIEWS)) {
          if (!identifier(view?.id) || !TAB_KINDS.includes(view.contentType) || view.contentType === 'group' || view.contentType === 'editor' && (!safeWorkspaceFile(view.path) || view.draft || !rootVersion(view.rootVersion))) continue;
          try {
            const leaf = newWorkspaceTab(view.contentType, view, view.id);
            if (seen.has(leaf.id) || seenViews.has(leaf.id) || seenEntities.has(leaf.entityId) || localIds.has(leaf.id) || localEntities.has(leaf.entityId) || views.length && leaf.id === item.id) continue;
            views.push(leaf); localIds.add(leaf.id); localEntities.add(leaf.entityId);
          } catch { /* Keep other valid views; a corrupt leaf grants no alias. */ }
        }
        fields = { ...item, views };
      }
      const tab = newWorkspaceTab(item.contentType, fields, item.id);
      if (!uniqueWorkspaceIdentities([...tabs, tab])) continue;
      tabs.push(tab); seen.add(item.id);
      for (const view of workspaceTabViews(tab)) { seenViews.add(view.id); seenEntities.add(view.entityId); }
    } catch { /* Ignore corrupt preferences, not user data. */ }
  }
  if (!tabs.length) return initialWorkspaceTabs(page);
  const activeTabId = seen.has(value.activeTabId) ? value.activeTabId : tabs[0].id;
  const active = activeWorkspaceView(tabs.find(tab => tab.id === activeTabId));
  let route = typeof value.lastPageHash === 'string' && value.lastPageHash.length <= 4096 ? parsePage(value.lastPageHash) : active?.page || { view: 'overview' };
  if (isWorkspaceStandalonePage(route)) route = active?.page || tabs.find(tab => tab.contentType === 'app')?.page || { view: 'overview' };
  return { version: 1, tabs, activeTabId, orientation: value.orientation === 'vertical' ? 'vertical' : 'horizontal', lastPageHash: pageHash(route.view, route.id, route), recentlyClosed: [] };
}
function reduceWorkspaceTabs(state, action) {
  const active = state.tabs.find(tab => tab.id === state.activeTabId) || state.tabs[0];
  switch (action.type) {
    // Workspace is a New tab screen, not an app tab. Record its accepted URL
    // separately so returning from Docs/Settings is a restore, not a new link.
    case 'accept-workspace-route': return state.lastPageHash === '#/workspace' ? state : { ...state, lastPageHash: '#/workspace' };
    case 'navigate': {
      const focused = activeWorkspaceView(active);
      const disposition = workspaceNavigationDisposition(focused, action.tab);
      if (disposition === 'reuse') return state;
      if (disposition === 'open') return reduceWorkspaceTabs(state, { type: 'open', tab: action.tab });
      return reduceWorkspaceTabs(state, { type: 'replace', tab: action.tab });
    }
    // Low-level replacement is also used by explicit, already-reviewed edits
    // and fixture setup. User navigation always dispatches `navigate` above.
    case 'replace': {
      const focused = activeWorkspaceView(active);
      if (isProtectedCliView(focused)) return reduceWorkspaceTabs(state, { type: 'open', tab: action.tab });
      if (active.contentType === 'group') {
        let replacement;
        try { replacement = newWorkspaceTab(action.tab.contentType, { ...action.tab, customLabel: focused.customLabel }, focused.id); } catch { return state; }
        if (replacement.contentType === 'group') return state;
        const tabs = state.tabs.map(tab => tab.id === active.id ? { ...tab, views: tab.views.map(view => view.id === focused.id ? replacement : view) } : tab);
        return uniqueWorkspaceIdentities(tabs) ? { ...state, tabs } : state;
      }
      let tab;
      try { tab = newWorkspaceTab(action.tab.contentType, { ...action.tab, customLabel: active.customLabel }, active.id); } catch { return state; }
      const tabs = state.tabs.map(item => item.id === active.id ? tab : item);
      return uniqueWorkspaceIdentities(tabs) ? { ...state, tabs } : state;
    }
    case 'open': {
      if (state.tabs.length >= MAX_WORKSPACE_TABS) return state;
      let tab;
      try { tab = action.tab ? newWorkspaceTab(action.tab.contentType, action.tab, action.tab.id) : newWorkspaceTab(); } catch { return state; }
      const all = [...state.tabs, tab];
      if (!uniqueWorkspaceIdentities(all)) return state;
      const order = insertTabIdIntoOrder(state.tabs.map(item => item.id), all, tab.id, tab.isPinned, active.id);
      return { ...state, tabs: order.map(id => all.find(item => item.id === id)), activeTabId: tab.id };
    }
    case 'select': return state.tabs.some(tab => tab.id === action.id) ? { ...state, activeTabId: action.id } : state;
    case 'label': return mapView(state, action.id, view => view.customLabel ? view : { ...view, label: String(action.label).slice(0, 150), ...(action.saved ? { draft: false } : {}) }, false);
    case 'rename': return String(action.label || '').trim() ? mapView(state, action.id, view => ({ ...view, customLabel: String(action.label).trim().slice(0, 150), label: String(action.label).trim().slice(0, 150) })) : state;
    case 'saved': return safeWorkspaceFile(action.path) ? mapView(state, action.id, view => ({ ...view, path: action.path, label: view.customLabel || action.path.split('/').at(-1), draft: false }), false) : state;
    case 'set-layout': return { ...state, tabs: state.tabs.map(tab => tab.id === active.id && tab.contentType === 'group' ? { ...tab, layout: normalizeViewLayout(action.layout, tab.views.map(view => view.id)) } : tab) };
    case 'binding-changed': {
      if (!identifier(action.binding?.projectId) || !rootVersion(action.binding?.version) || !Array.isArray(action.editorEntityIds)) return state;
      const allowed = new Set(action.editorEntityIds.filter(identifier));
      if (!allowed.size) return state;
      const updateBinding = view => view.contentType === 'editor' && view.projectId === action.binding.projectId && allowed.has(view.entityId) ? { ...view, rootVersion: action.binding.version } : view;
      return { ...state, tabs: state.tabs.map(tab => tab.contentType === 'group' ? { ...tab, views: tab.views.map(updateBinding) } : updateBinding(tab)) };
    }
    case 'focus-view': return { ...state, tabs: state.tabs.map(tab => tab.id === active.id && tab.contentType === 'group' && tab.views.some(view => view.id === action.id) ? { ...tab, activeViewId: action.id } : tab) };
    case 'orientation': return { ...state, orientation: action.value === 'vertical' ? 'vertical' : 'horizontal' };
    case 'layout-ratio': return { ...state, tabs: state.tabs.map(tab => tab.id === active.id && tab.contentType === 'group' ? { ...tab, layout: resizeViewLayout(tab.layout, action.id, action.ratio) } : tab) };
    case 'arrange': return { ...state, tabs: state.tabs.map(tab => tab.id === active.id && tab.contentType === 'group' ? { ...tab, layout: automaticViewLayout(tab.views.map(view => view.id)) } : tab) };
    case 'group-tabs': {
      const target = state.tabs.find(tab => tab.id === (action.targetId || state.activeTabId));
      const source = state.tabs.find(tab => tab.id === action.id);
      if (!target || !source) return state;
      const oldViews = workspaceTabViews(target), incoming = source.id === target.id ? [newWorkspaceTab()] : workspaceTabViews(source);
      const views = [...oldViews, ...incoming];
      if (views.length > MAX_TAB_VIEWS || new Set(views.map(view => view.id)).size !== views.length || new Set(views.map(view => view.entityId)).size !== views.length) return state;
      const layout = insertViewLayout(target.layout || automaticViewLayout(oldViews.map(view => view.id)), action.viewId || activeWorkspaceView(target).id, incoming.map(view => view.id), action.edge);
      let group;
      try { group = newWorkspaceTab('group', { ...target, views, layout, activeViewId: activeWorkspaceView(target).id }, target.id); } catch { return state; }
      const tabs = state.tabs.filter(tab => tab.id !== source.id || tab.id === target.id).map(tab => tab.id === target.id ? group : tab);
      return uniqueWorkspaceIdentities(tabs) ? { ...state, tabs, activeTabId: target.id } : state;
    }
    case 'detach-view': {
      if (active.contentType !== 'group' || state.tabs.length >= MAX_WORKSPACE_TABS) return state;
      const view = active.views.find(view => view.id === action.id);
      if (!view) return state;
      const views = active.views.filter(item => item.id !== action.id);
      const remaining = views.length === 1 ? newWorkspaceTab(views[0].contentType, { ...views[0], customLabel: active.customLabel || views[0].customLabel }, active.id) : { ...active, views, activeViewId: active.activeViewId === view.id ? views[0].id : active.activeViewId, layout: removeViewLayout(active.layout, view.id) };
      const detached = newWorkspaceTab(view.contentType, view);
      return { ...state, tabs: [...state.tabs.map(tab => tab.id === active.id ? remaining : tab), detached], activeTabId: detached.id };
    }
    case 'pin': return { ...state, tabs: state.tabs.map(tab => tab.id === action.id ? { ...tab, isPinned: !tab.isPinned } : tab) };
    case 'close': {
      const index = state.tabs.findIndex(tab => tab.id === action.id);
      if (index < 0) return state;
      const tabs = state.tabs.filter(tab => tab.id !== action.id);
      if (!tabs.length) tabs.push(newWorkspaceTab());
      return { ...state, tabs, activeTabId: state.activeTabId === action.id ? tabs[Math.min(index, tabs.length - 1)].id : state.activeTabId,
        recentlyClosed: [state.tabs[index], ...(state.recentlyClosed || [])].slice(0, 12) };
    }
    case 'reopen': {
      const [tab, ...remaining] = state.recentlyClosed || [];
      if (!tab || state.tabs.length >= MAX_WORKSPACE_TABS) return state;
      if (!uniqueWorkspaceIdentities([...state.tabs, tab])) return state;
      return { ...state, tabs: [...state.tabs, tab], activeTabId: tab.id, recentlyClosed: remaining };
    }
    case 'move': {
      const index = state.tabs.findIndex(tab => tab.id === action.id);
      if (index < 0 || !Number.isInteger(action.index)) return state;
      const tabs = [...state.tabs], [tab] = tabs.splice(index, 1);
      tabs.splice(Math.max(0, Math.min(tabs.length, action.index)), 0, tab);
      return { ...state, tabs };
    }
    default: return state;
  }
}
export function workspaceTabsReducer(state, action) {
  const next = reduceWorkspaceTabs(state, action);
  const active = activeWorkspaceView(next.tabs.find(tab => tab.id === next.activeTabId));
  const route = active?.contentType === 'app' ? pageHash(active.page.view, active.page.id, active.page) : next.lastPageHash;
  return route !== next.lastPageHash ? { ...next, lastPageHash: route } : next;
}
export function workspaceTabStorageKey(workspaceId) { return `frondose.workspace-tabs.v1:${workspaceId}`; }
export function readWorkspaceTabs(storage, workspaceId, page) {
  if (isWorkspaceStandalonePage(page)) page = { view: 'overview' };
  try {
    const saved = normalizeWorkspaceTabs(JSON.parse(storage.getItem(workspaceTabStorageKey(workspaceId))), page);
    const requested = pageHash(page?.view || 'overview', page?.id, page || {});
    // A deliberate deep link takes precedence. Reloading the last app route
    // restores the active view without replaying a command or model request.
    if (saved.lastPageHash !== requested) return workspaceTabsReducer(saved, { type: 'navigate', tab: newWorkspaceTab('app', { page }) });
    return saved;
  }
  catch { return initialWorkspaceTabs(page); }
}
// Store view identity only: no commands, prompts, credentials or source-file drafts.
export function persistedWorkspaceTabs(state) {
  return { version: 1, activeTabId: state.activeTabId, orientation: state.orientation === 'vertical' ? 'vertical' : 'horizontal', lastPageHash: state.lastPageHash, tabs: state.tabs.map(tab => newWorkspaceTab(tab.contentType, tab, tab.id)) };
}
function mapView(state, id, change, topLevel = true) {
  return { ...state, tabs: state.tabs.map(tab => tab.contentType === 'group' && (!topLevel || tab.id !== id) ? { ...tab, views: tab.views.map(view => view.id === id ? change(view) : view) } : tab.id === id ? change(tab) : tab) };
}

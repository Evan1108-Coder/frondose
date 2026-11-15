import { isRetiredLocalPage } from './local-navigation.js';
import { newWorkspaceTab, normalizeWorkspaceTabs, readWorkspaceTabs, workspaceTabStorageKey } from './workspace-tabs.js';
import { parsePage } from './navigation.js';
import { isWorkspaceStandalonePage } from './workspace-screens.js';

// Retire presentation only. A view replacement never deletes a process,
// history, profile, credential or file. Legacy agent sessions remain viewable
// as terminals without offering a new profile-management surface.
export function localWorkspaceTab(tab) {
  if (tab.contentType === 'group') return newWorkspaceTab('group', { ...tab, views: tab.views.map(localWorkspaceTab) }, tab.id);
  if (tab.contentType === 'agent-session') {
    const { agentId, ...fields } = tab;
    return newWorkspaceTab('terminal', fields, tab.id);
  }
  return tab.contentType === 'app' && (isRetiredLocalPage(tab.page) || isWorkspaceStandalonePage(tab.page) || tab.page?.view === 'workspace')
    ? newWorkspaceTab('new-tab', { entityId: tab.entityId, isPinned: tab.isPinned }, tab.id)
    : tab;
}
export function localWorkspaceTabs(state) {
  return { ...state, tabs: state.tabs.map(localWorkspaceTab), recentlyClosed: (state.recentlyClosed || []).map(localWorkspaceTab), lastPageHash: isRetiredLocalPage(parsePage(state.lastPageHash)) ? '#/workspace' : state.lastPageHash };
}

export function readLocalWorkspaceTabs(storage, workspaceId, page) {
  const target = isRetiredLocalPage(page) ? parsePage('#/workspace') : page;
  let saved;
  try { saved = localWorkspaceTabs(normalizeWorkspaceTabs(JSON.parse(storage.getItem(workspaceTabStorageKey(workspaceId))), target)); }
  catch { saved = localWorkspaceTabs(normalizeWorkspaceTabs(null, target)); }
  // Normalize the accepted old route before comparing deep links, so retiring
  // Today does not replace an active terminal/browser during an ordinary reload.
  return localWorkspaceTabs(readWorkspaceTabs({ getItem: () => JSON.stringify(saved) }, workspaceId, target));
}

export function sameRuntimeTab(a, b) {
  return Boolean(a && b && a.id === b.id && a.entityId === b.entityId && a.projectId === b.projectId && a.contentType === b.contentType);
}

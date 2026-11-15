import { newWorkspaceTab, safeWorkspaceFile, workspaceTabViews, activeWorkspaceView, MAX_WORKSPACE_TABS } from './workspace-tabs.js';
import { normalizeViewLayout } from './workspace-view-layout.js';
import { localWorkspaceTab } from './local-workspace-tabs.js';
import { pageHash } from './navigation.js';

const MAX_SCOPES = 3, MAX_BRANCHES = 12, MAX_BYTES = 256 * 1024;
const byteLength = value => new TextEncoder().encode(value).byteLength;
const identifier = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
const branchName = value => typeof value === 'string' && value.length > 0 && value.length <= 250 && !/^[\s-]|[\u0000-\u0020\u007f]/.test(value);
const scopeId = value => typeof value === 'string' && /^[a-f0-9]{64}:[\w-]{1,100}$/.test(value);
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 150) : '';
export const branchTabsPreferenceKey = workspaceId => `frondose.branch-tabs-preference.v1:${encodeURIComponent(workspaceId)}`;
export const branchTabsStorageKey = workspaceId => `frondose.branch-page-tabs.v1:${encodeURIComponent(workspaceId)}`;
export function readBranchTabsPreference(storage, workspaceId) {
  try { return JSON.parse(storage.getItem(branchTabsPreferenceKey(workspaceId)) || '{}').enabled === true; } catch { return false; }
}
export function saveBranchTabsPreference(storage, workspaceId, enabled) {
  try { storage.setItem(branchTabsPreferenceKey(workspaceId), JSON.stringify({ version: 1, enabled: enabled === true })); return true; } catch { return false; }
}
export function clearBranchTabMemory(storage, workspaceId) {
  try { storage.removeItem(branchTabsStorageKey(workspaceId)); return true; } catch { return false; }
}

/** This hash is metadata isolation, never file/repository authority. A switch
 * result must match the fresh binding; failed/uncertain callbacks never restore. */
export function branchTabsScope(workspaceId, result, binding) {
  if (!identifier(workspaceId) || !result || result.requiresRefresh || result.workspaceId !== workspaceId || result.connected !== true || !result.isRepository || !branchName(result.branch) || !binding || result.bindingVersion !== binding.version || result.directory !== binding.path || !identifier(binding.projectId) || !/^[a-f0-9]{64}$/.test(result.tabScope || '')) return null;
  return `${result.tabScope}:${binding.projectId}`;
}

function metadataFields(tab) {
  return { label: text(tab.label), customLabel: text(tab.customLabel), isPinned: tab.isPinned === true,
    ...(tab.contentType === 'app' ? { page: tab.page } : {}),
    ...(tab.contentType === 'editor' ? { path: tab.path, projectId: tab.projectId, rootVersion: tab.rootVersion } : {}) };
}
function allowedLeaf(tab) {
  return ['app', 'new-tab'].includes(tab?.contentType) || tab?.contentType === 'editor' && !tab.draft && safeWorkspaceFile(tab.path) && identifier(tab.projectId) && (identifier(tab.rootVersion) || Number.isSafeInteger(tab.rootVersion) && tab.rootVersion > 0);
}
function metadataTab(tab) {
  if (!tab || !identifier(tab.id)) return null;
  try {
    if (tab.contentType === 'group') {
      if (!Array.isArray(tab.views) || !tab.views.length || tab.views.length > 8 || tab.views.some(view => !allowedLeaf(view))) return null;
      const views = tab.views.map(metadataTab); if (views.some(view => !view)) return null;
      return newWorkspaceTab('group', { ...metadataFields(tab), views, activeViewId: tab.activeViewId, layout: tab.layout }, tab.id);
    }
    if (!allowedLeaf(tab)) return null;
    return localWorkspaceTab(newWorkspaceTab(tab.contentType, metadataFields(tab), tab.id));
  } catch { return null; }
}
function cleanSnapshot(value) {
  if (!value || !Array.isArray(value.tabs)) return null;
  const ids = new Set(), tabs = [];
  for (const candidate of value.tabs.slice(0, MAX_WORKSPACE_TABS)) {
    const tab = metadataTab(candidate); if (!tab) continue;
    const nextIds = [tab.id, ...workspaceTabViews(tab).map(view => view.id).filter(id => id !== tab.id)];
    if (new Set(nextIds).size !== nextIds.length || nextIds.some(id => ids.has(id))) continue;
    nextIds.forEach(id => ids.add(id)); tabs.push(tab);
  }
  return { tabs, activeTabId: tabs.some(tab => tab.id === value.activeTabId) ? value.activeTabId : tabs[0]?.id || null };
}
function readMemory(storage, workspaceId) {
  try {
    const raw = storage.getItem(branchTabsStorageKey(workspaceId));
    if (!raw || raw.length > MAX_BYTES || byteLength(raw) > MAX_BYTES) return { version: 1, scopes: [] };
    const value = JSON.parse(raw); if (value.version !== 1 || !Array.isArray(value.scopes)) return { version: 1, scopes: [] };
    return { version: 1, scopes: value.scopes.slice(0, MAX_SCOPES).filter(entry => scopeId(entry?.scope)).map(entry => ({ scope: entry.scope, branches: (Array.isArray(entry.branches) ? entry.branches : []).slice(0, MAX_BRANCHES).flatMap(branch => {
      const snapshot = branchName(branch?.branch) && cleanSnapshot(branch.snapshot);
      return snapshot ? [{ branch: branch.branch, snapshot }] : [];
    }) })) };
  } catch { return { version: 1, scopes: [] }; }
}
function writeMemory(storage, workspaceId, memory) {
  const scopes = memory.scopes.slice(0, MAX_SCOPES).map(scope => ({ ...scope, branches: scope.branches.slice(0, MAX_BRANCHES) }));
  let serialized = JSON.stringify({ version: 1, scopes });
  // Current scope/current outgoing branch are at the front. Drop only older
  // inert layout metadata when reaching the bounded preference quota.
  while (byteLength(serialized) > MAX_BYTES && scopes.length) {
    const oldest = scopes.at(-1);
    if (oldest.branches.length > 1) oldest.branches.pop(); else scopes.pop();
    serialized = JSON.stringify({ version: 1, scopes });
  }
  if (!scopes.length) return false;
  try { storage.setItem(branchTabsStorageKey(workspaceId), serialized); return true; } catch { return false; }
}

function isBranchLocalTab(tab, binding) {
  return workspaceTabViews(tab).length > 0 && workspaceTabViews(tab).every(view => allowedLeaf(view) && (view.contentType !== 'editor' || view.projectId === binding.projectId && view.rootVersion === binding.version));
}
function snapshotFor(state, binding) {
  return cleanSnapshot({ tabs: state.tabs.filter(tab => isBranchLocalTab(tab, binding)), activeTabId: state.activeTabId });
}
function restoreTab(tab, binding) {
  if (tab.contentType !== 'group') return newWorkspaceTab(tab.contentType, { ...metadataFields(tab), ...(tab.contentType === 'editor' ? { projectId: binding.projectId, rootVersion: binding.version } : {}) });
  const views = tab.views.map(view => restoreTab(view, binding)), ids = new Map(tab.views.map((view, index) => [view.id, views[index].id]));
  const remap = node => !node ? null : node.type === 'view' ? { type: 'view', id: ids.get(node.id) } : { ...node, first: remap(node.first), second: remap(node.second) };
  return newWorkspaceTab('group', { ...metadataFields(tab), views, activeViewId: ids.get(tab.activeViewId), layout: normalizeViewLayout(remap(tab.layout), views.map(view => view.id)) });
}

/** Called only after a successful branch operation and a fresh directory read.
 * Runtime-containing groups and old-root/draft resources remain the same object,
 * including process/browser identity. No command, start/resume intent, source
 * content or dirty draft is serialized. Nothing in this function stops work. */
export function transitionBranchWorkspaceTabs({ storage, workspaceId, state, result, previousBranch, binding, unsafeEditors = false }) {
  const unchanged = reason => ({ state, changed: false, reason });
  if (!readBranchTabsPreference(storage, workspaceId)) return unchanged('disabled');
  const scope = branchTabsScope(workspaceId, result, binding);
  if (!scope || !branchName(previousBranch) || previousBranch === result.branch) return unchanged('not_a_fresh_branch_switch');
  if (unsafeEditors) return unchanged('dirty_or_pending_editors');
  const memory = readMemory(storage, workspaceId), oldScope = memory.scopes.find(entry => entry.scope === scope);
  const target = oldScope?.branches.find(entry => entry.branch === result.branch)?.snapshot || null;
  const outgoing = snapshotFor(state, binding);
  const branches = [{ branch: previousBranch, snapshot: outgoing }, ...(oldScope?.branches || []).filter(entry => entry.branch !== previousBranch)].slice(0, MAX_BRANCHES);
  const saved = writeMemory(storage, workspaceId, { version: 1, scopes: [{ scope, branches }, ...memory.scopes.filter(entry => entry.scope !== scope)] });
  if (!saved) return unchanged('storage_unavailable');
  const globalTabs = state.tabs.filter(tab => !isBranchLocalTab(tab, binding));
  const restored = (target?.tabs || []).slice(0, Math.max(0, MAX_WORKSPACE_TABS - globalTabs.length)).map(tab => ({ oldId: tab.id, tab: restoreTab(tab, binding) }));
  if (!restored.length && globalTabs.length < MAX_WORKSPACE_TABS) restored.push({ oldId: null, tab: newWorkspaceTab() });
  const combined = [...globalTabs, ...restored.map(entry => entry.tab)];
  const tabs = [...combined.filter(tab => tab.isPinned), ...combined.filter(tab => !tab.isPinned)];
  const activeTabId = globalTabs.some(tab => tab.id === state.activeTabId) ? state.activeTabId : restored.find(entry => entry.oldId === target?.activeTabId)?.tab.id || restored[0]?.tab.id || tabs[0].id;
  const active = activeWorkspaceView(tabs.find(tab => tab.id === activeTabId));
  return { state: { ...state, tabs, activeTabId, recentlyClosed: (state.recentlyClosed || []).filter(tab => workspaceTabViews(tab).some(view => ['terminal', 'agent-session', 'browser'].includes(view.contentType))), lastPageHash: active.contentType === 'app' ? pageHash(active.page.view, active.page.id, active.page) : state.lastPageHash }, changed: true, reason: target ? 'restored' : 'new_branch', restoredCount: restored.filter(entry => entry.oldId).length, limited: Boolean(target && target.tabs.length > restored.length), rememberedCount: outgoing.tabs.length };
}

/** Browser-memory drafts are content only, never filesystem authority. */
export function createDirectoryDraft(workspaceId, tab, stored) {
  if (stored?.workspaceId === workspaceId) return { ...stored, pending: false, mode: stored.mode === 'preview' ? 'preview' : 'source' };
  const isNew = Boolean(tab.draft) || !tab.path;
  const path = tab.path || tab.draft?.path || 'Untitled.md';
  const content = typeof tab.draft === 'string' ? tab.draft : tab.draft?.content || '';
  return { workspaceId, path, initialPath: path, content, baseline: '', version: null, isNew, loaded: isNew, pending: false, mode: 'source', error: null, discarded: false, revision: 0 };
}
export function directoryDraftDirty(draft) {
  return Boolean(draft?.loaded && !draft.discarded && (draft.isNew || draft.content !== draft.baseline));
}
export function discardDirectoryDraft(draft) {
  return { ...draft, content: draft.baseline, path: draft.isNew ? draft.initialPath : draft.path, error: null, discarded: draft.isNew, revision: draft.revision + 1 };
}
export function acceptDirectorySave(draft, saved, sent) {
  const timeline = [...(draft.timeline || []).filter(item => item.version !== saved.version), { version: saved.version, modified_at: saved.modified_at }].slice(-20);
  return { ...draft, path: saved.path, initialPath: saved.path, baseline: saved.content, version: saved.version, isNew: false, loaded: true, discarded: false,
    modified_at: saved.modified_at, timeline, content: draft.revision === sent.revision ? saved.content : draft.content, error: null };
}
export function directoryApiPath(workspaceId, action = '', query = {}) {
  return `/api/directory-workspace${action ? `/${action}` : ''}?${new URLSearchParams({ workspace_id: workspaceId, ...query })}`;
}

import {beginContextDrag,endWorkspaceContextDrag} from './workspace-context-drop.js';
/** Whole saved cards drag identity only. Text controls/links keep their own
 * interactions, and a nested drag handle must not create a second token. */
export function commentDragProps(workspaceId,thread,rootVersion){
  const context=commentContextSource(thread,rootVersion);
  return {draggable:Boolean(context),onDragStart(event){
    const control=event.target.closest?.('button,input,textarea,select,a,[contenteditable="true"]');
    if(event.defaultPrevented||control&&(!event.currentTarget||event.currentTarget.contains(control)))return;
    if(!context||!beginContextDrag(event.dataTransfer,workspaceId,context))event.preventDefault();
  },onDragEnd:endWorkspaceContextDrag};
}
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
export function fileCommentsApiPath(workspaceId, action = '', query = {}) {
  if (!validId(workspaceId) || action && !/^(?:context|threads(?:\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199}(?:\/(?:replies|reaction|resolve|relocate))?)?)$/.test(action)) throw Error('Choose a valid workspace comment action.');
  const values = Object.fromEntries(Object.entries({ workspace_id: workspaceId, ...query }).filter(([, value]) => value !== undefined && value !== null));
  return `/api/file-comments${action ? `/${action}` : ''}?${new URLSearchParams(values)}`;
}
export function fileCommentSelection({ content, start, end, fileVersion, dirty }) {
  if (dirty || !fileVersion || typeof content !== 'string' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > content.length || end - start > 4000) return null;
  return { start, end, quote: content.slice(start, end), expected_file_version: fileVersion, startLine: content.slice(0, start).split('\n').length, endLine: content.slice(0, end - 1).split('\n').length };
}
/** Uncertain deliveries keep the same request key. Confirmed actions release
 * their key; changed drafts get another key without duplicating an old retry. */
export function createCommentRetryKeys(random = () => crypto.randomUUID()) {
  const keys = new Map();
  return { key(action, payload) { const value = JSON.stringify([action, payload]); if (!keys.has(value)) keys.set(value, random()); return keys.get(value); }, forget(action, payload) { keys.delete(JSON.stringify([action, payload])); } };
}
export function commentContextSource(thread, rootVersion) {
  return validId(thread?.id) && validId(rootVersion) ? { kind: 'comment', id: thread.id, rootVersion } : null;
}
/** These are display/drag descriptors only, not file-read or AI authority. */
export function fileCommentSidebarItems(threads, rootVersion) {
  return (Array.isArray(threads) ? threads : []).slice(0, 50).filter(thread => validId(thread.id)).map(thread => ({ id: thread.id, title: String(thread.body || thread.quote || 'Comment').replace(/[\r\n]+/g, ' ').slice(0, 64), path: thread.path, resolved: Boolean(thread.resolved), page: { view: 'comments', id: thread.id }, context: commentContextSource(thread, rootVersion) }));
}

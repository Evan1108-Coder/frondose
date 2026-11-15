import { workbenchRequest } from './workbench.js';

const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const liveStatus = status => status === 'running' || status === 'stopping';
function safeScope(scope) {
  if (scope?.host === 'workspace') return identity(scope.workspaceId) && scope.projectId == null && !scope.environmentId ? { workspaceId: scope.workspaceId, projectId: null, host: 'workspace' } : null;
  return scope && identity(scope.workspaceId) && identity(scope.projectId) ? { workspaceId: scope.workspaceId, projectId: scope.projectId, ...(scope.environmentId ? { environmentId: scope.environmentId } : {}) } : null;
}
function unknown(scope, viewId, reason, error = null) {
  return { state: 'unknown', verified: false, canStop: false, scope: scope || null, viewId, sessions: [], stopSessionIds: [], visibleSessionIds: [], fingerprint: null, reason, error };
}

/** Saved panes are evidence of attachments only, NEVER process ownership. */
export function terminalViewLayoutEvidence(scope, viewId, storage) {
  if (!storage || typeof storage.getItem !== 'function') return { known: false, ids: [], reason: 'view_layout_unavailable' };
  try {
    const value = storage.getItem(`frondose:terminal-splits:v1:${scope.workspaceId}:${scope.host === 'workspace' ? 'workspace' : scope.projectId}:${scope.environmentId || ''}:${viewId}`);
    if (value === null) return { known: true, ids: [] };
    if (typeof value !== 'string' || value.length > 20_000) return { known: false, ids: [], reason: 'view_layout_invalid' };
    const saved = JSON.parse(value), ids = new Set();
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.version !== 1) return { known: false, ids: [], reason: 'view_layout_invalid' };
    function visit(node, depth = 0) {
      if (!node) return;
      if (depth > 8 || typeof node !== 'object') throw new Error('Invalid view layout.');
      if (node.type === 'leaf') { if (!identity(node.leafId) || ids.has(node.leafId) || ids.size >= 8) throw new Error('Invalid pane identity.'); ids.add(node.leafId); return; }
      if (node.type !== 'split' || !['horizontal', 'vertical'].includes(node.direction) || !node.first || !node.second) throw new Error('Invalid split.');
      visit(node.first, depth + 1); visit(node.second, depth + 1);
    }
    visit(saved.root);
    return { known: true, ids: [...ids].sort() };
  } catch { return { known: false, ids: [], reason: 'view_layout_unreadable' }; }
}

function decodeStatus(result, scope, viewId, visibleSessionIds) {
  if ((scope.host === 'workspace') !== (result?.host_scope === 'workspace')) return unknown(scope, viewId, 'view_status_invalid');
  if (!result || result.workspace_id !== scope.workspaceId || result.project_id !== scope.projectId || result.view_id !== viewId || !['idle', 'running', 'unknown'].includes(result.state) || !Array.isArray(result.sessions) || result.sessions.length > 200 || !Array.isArray(result.stop_session_ids) || result.stop_session_ids.length > 8 || !/^[a-f0-9]{64}$/.test(result.fingerprint || '')) return unknown(scope, viewId, 'view_status_invalid');
  const sessions = result.sessions;
  if (sessions.some(session => !identity(session.id) || typeof session.name !== 'string' || session.name.length > 200 || session.owner_view_id !== viewId || !['running', 'stopping', 'interrupted', 'exited', 'stopped'].includes(session.status))) return unknown(scope, viewId, 'view_status_invalid');
  const ids = result.stop_session_ids;
  if (ids.some(id => !identity(id)) || new Set(ids).size !== ids.length || new Set(sessions.map(session => session.id)).size !== sessions.length) return unknown(scope, viewId, 'view_status_invalid');
  const actualLive = sessions.filter(session => liveStatus(session.status)).map(session => session.id).sort();
  if (JSON.stringify([...ids].sort()) !== JSON.stringify(actualLive)) return unknown(scope, viewId, 'view_status_invalid');
  if (result.state === 'idle' && (ids.length || result.verified !== true || result.can_stop !== false) || result.state === 'running' && (!ids.length || result.verified !== true || result.can_stop !== true) || result.state === 'unknown' && (result.verified !== false || result.can_stop !== false)) return unknown(scope, viewId, 'view_status_invalid');
  return { state: result.state, verified: result.verified, canStop: result.can_stop, scope, viewId, sessions, stopSessionIds: [...ids].sort(), visibleSessionIds, fingerprint: result.fingerprint, reason: result.reason || null, pendingCount: result.pending_count || 0 };
}

export async function readWorkspaceTerminalViewStatus(inputScope, viewId, options = {}) {
  const scope = safeScope(inputScope);
  if (!scope || !identity(viewId)) return unknown(scope, viewId, 'view_scope_unavailable');
  let storage;
  try { storage = Object.hasOwn(options, 'storage') ? options.storage : globalThis.localStorage; } catch { return unknown(scope, viewId, 'view_layout_unavailable'); }
  const evidence = terminalViewLayoutEvidence(scope, viewId, storage);
  if (!evidence.known) return unknown(scope, viewId, evidence.reason);
  const request = options.request || workbenchRequest;
  try {
    const result = await request(scope, `terminal-views/${encodeURIComponent(viewId)}`, { signal: options.signal, body: { visible_ids: JSON.stringify(evidence.ids) } });
    return decodeStatus(result, scope, viewId, evidence.ids);
  } catch (error) { return unknown(scope, viewId, options.signal?.aborted ? 'view_status_cancelled' : 'view_status_unavailable', error); }
}

/** One explicit stop decision, checked again atomically by the server. Never
 * derives a stop-all list from project inventory or retries uncertain requests. */
export async function stopWorkspaceTerminalView(inputScope, viewId, { reviewedStatus, confirmed = false, request = workbenchRequest, signal } = {}) {
  const scope = safeScope(inputScope), status = reviewedStatus;
  if (status?.scope?.host !== scope?.host) throw new Error('Review this terminal host before stopping it.');
  if (!confirmed || !scope || !identity(viewId) || !status || status.scope?.workspaceId !== scope.workspaceId || status.scope?.projectId !== scope.projectId || status.viewId !== viewId || !status.verified || !['running', 'idle'].includes(status.state) || status.state === 'running' && !status.canStop || !/^[a-f0-9]{64}$/.test(status.fingerprint || '')) throw new Error('Review this tab’s verified sessions before explicitly stopping them.');
  const validated = decodeStatus({ workspace_id: scope.workspaceId, project_id: scope.projectId, ...(scope.host === 'workspace' ? { host_scope: 'workspace' } : {}), view_id: viewId, state: status.state, verified: status.verified, can_stop: status.canStop, sessions: status.sessions, stop_session_ids: status.stopSessionIds, fingerprint: status.fingerprint }, scope, viewId, status.visibleSessionIds || []);
  if (!validated.verified) throw new Error('This tab’s session ownership could not be verified. Nothing was stopped.');
  const result = await request(scope, `terminal-views/${encodeURIComponent(viewId)}/stop`, { method: 'POST', signal, body: { confirmed: true, expected_session_ids: validated.stopSessionIds, fingerprint: status.fingerprint, visible_ids: status.visibleSessionIds || [] } });
  if ((scope.host === 'workspace') !== (result?.host_scope === 'workspace')) throw new Error('Terminal host exit was not confirmed.');
  if (!result || result.workspace_id !== scope.workspaceId || result.project_id !== scope.projectId || result.view_id !== viewId || result.stopped !== true || result.state !== 'idle' || !Array.isArray(result.stopped_session_ids) || JSON.stringify([...result.stopped_session_ids].sort()) !== JSON.stringify(validated.stopSessionIds)) throw new Error('Session exit was not confirmed. Keep the tab open and refresh its status; no command will be replayed.');
  return result;
}

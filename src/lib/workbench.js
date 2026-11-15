import { apiRequest } from '../data/api.js';

export function workbenchScopeFields(scope) {
  if (scope.host === 'workspace') {
    if (scope.projectId != null || scope.environmentId) throw new Error('A workspace terminal cannot adopt project authority.');
    return { workspace_id: scope.workspaceId, host_scope: 'workspace' };
  }
  return { workspace_id: scope.workspaceId, project_id: scope.projectId, environment_id: scope.environmentId || null };
}

export async function workbenchRequest(scope, action = '', { method = 'GET', body, signal } = {}) {
  const authority = workbenchScopeFields(scope);
  const payload = Object.fromEntries(Object.entries(body || {}).filter(([key]) => !['workspace_id', 'project_id', 'environment_id', 'host_scope'].includes(key)));
  const query = new URLSearchParams(Object.entries(authority).filter(([, value]) => value != null));
  if (method === 'GET') for (const [key, value] of Object.entries(body || {})) if (value !== undefined && !['workspace_id', 'project_id', 'environment_id', 'host_scope'].includes(key)) query.set(key, String(value));
  const result = await apiRequest(`/api/workbench${action ? `/${action}` : ''}?${query}`, {
    method, signal, timeoutMs: action === 'worktrees' ? 25_000 : 12_000,
    ...(method !== 'GET' ? { body: { ...payload, ...authority } } : {}),
  });
  return result.result;
}

export function readWorkbenchLayout(workspaceId, projectId) {
  try {
    const saved = JSON.parse(localStorage.getItem(`rumbo:workbench:v1:${workspaceId}:${projectId}`) || '{}');
    return { tab: ['overview', 'files', 'changes', 'commands', 'terminal'].includes(saved.tab) ? saved.tab : 'overview', environmentId: typeof saved.environmentId === 'string' ? saved.environmentId : '', favorites: Array.isArray(saved.favorites) ? saved.favorites.filter(item => typeof item === 'string').slice(0, 30) : [], terminalId: typeof saved.terminalId === 'string' ? saved.terminalId : '', directory: typeof saved.directory === 'string' ? saved.directory : '', file: typeof saved.file === 'string' ? saved.file : '', previewPort: saved.previewPort || '5173' };
  } catch { return { tab: 'overview', environmentId: '', favorites: [], terminalId: '', directory: '', file: '', previewPort: '5173' }; }
}
export function saveWorkbenchLayout(workspaceId, projectId, value) {
  try { localStorage.setItem(`rumbo:workbench:v1:${workspaceId}:${projectId}`, JSON.stringify(value)); } catch { /* A private browser may not persist personal layout. */ }
}

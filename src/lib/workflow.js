import { apiRequest } from '../data/api.js';
import { refreshRumbo } from '../data/useRumbo.js';

export const OUTPUT_TYPES = ['document', 'report', 'code_change', 'design', 'test_result', 'research', 'other'];
export const workflowLabel = value => String(value ?? '').replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());
export async function workflowRequest(path, body, method = 'POST') {
  const response = await apiRequest(`/api/workflow/${path}`, { method, body });
  // A completed write must not appear failed just because the follow-up refresh
  // failed; the shared store reports sync errors and retains existing content.
  await refreshRumbo().catch(() => {});
  return response.result;
}
export function routeAgreement(data, taskId) { return (data.route_workflows ?? []).find(row => row.id === taskId); }
export function blockedDependencies(data, agreement) { return (agreement?.dependency_ids ?? []).map(id => data.tasks.find(task => task.id === id)).filter(task => task && task.status !== 'done'); }
export function latestOutputVersion(data, output) { return (data.output_versions ?? []).find(v => v.output_id === output.id && v.number === output.current_version); }
export function contextFreshness(data, snapshot) {
  return (snapshot.sources ?? []).map(source => {
    const row = (data[source.type] ?? []).find(item => item.id === source.id);
    return { ...source, missing: !row || Boolean(row.archived_at), changed: Boolean(row && row.updated_at !== source.updated_at) };
  });
}
export function exportText(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${name.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) || 'rumbo-output'}.md`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

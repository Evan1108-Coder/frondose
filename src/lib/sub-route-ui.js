export function routeScope(route) {
  return { project: route.project_id || null, team: route.team_id || null };
}
export function hierarchySnapshotSignature(tasks = [], workflows = []) {
  return JSON.stringify([
    tasks.map(route => [route.id, route.status, route.project_id, route.team_id, route.archived_at]),
    workflows.map(workflow => [workflow.id, workflow.parent_task_id, workflow.sibling_position, workflow.version, workflow.hierarchy_restricted]),
  ]);
}
export async function hierarchyRetryRequest(input, operation, storage = globalThis.sessionStorage) {
  const logical = Object.fromEntries(Object.entries(input).filter(([key]) => !['revision', 'request_id'].includes(key)).sort(([left], [right]) => left.localeCompare(right)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([operation, logical])));
  const slot = `rumbo:sub-route-retry:v1:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  let previous;
  try { previous = JSON.parse(storage?.getItem(slot) || 'null'); } catch { /* Storage is optional; private text is never retained. */ }
  const value = previous && /^[a-z0-9-]{36}$/i.test(previous.request_id) && Number.isInteger(previous.revision) && previous.revision >= 0
    ? previous : { request_id: crypto.randomUUID(), revision: input.revision };
  try { storage?.setItem(slot, JSON.stringify(value)); } catch { /* Current mounted request still preserves its key. */ }
  return { ...value, clear() { try { storage?.removeItem(slot); } catch { /* Best effort metadata cleanup. */ } } };
}
export function hierarchyCandidates(tasks, workflows, tree, mode, projects = []) {
  if (!tree?.route || tree.integrity?.restricted) return [];
  const blocked = new Set([tree.route.id, ...(tree.descendants || []).map(route => route.id)]);
  if (mode === 'attach') for (const ancestor of tree.ancestors || []) blocked.add(ancestor.id);
  const scope = routeScope(tree.route, projects), parents = new Map(workflows.map(row => [row.id, row.parent_task_id]));
  const restricted = new Set(workflows.filter(row => row.hierarchy_restricted).map(row => row.id));
  return tasks.filter(route => {
    const candidate = routeScope(route, projects);
    if (route.workspace_id !== tree.route.workspace_id || route.hierarchy_restricted || restricted.has(route.id) || route.archived_at || blocked.has(route.id) || candidate.project !== scope.project || candidate.team !== scope.team) return false;
    if (mode === 'attach') return !(route.parent_task_id || parents.get(route.id));
    return route.id !== tree.parent?.id;
  }).toSorted((left, right) => left.title.localeCompare(right.title));
}
export function moveSibling(children, id, direction, showArchived = false) {
  const ordered = children.map(child => child.id), visible = children.filter(child => showArchived || !child.archived_at).map(child => child.id);
  const index = visible.indexOf(id), neighbor = visible[index + direction];
  if (!neighbor || ![-1, 1].includes(direction)) return null;
  const from = ordered.indexOf(id), to = ordered.indexOf(neighbor);
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  return ordered;
}
export function leafProgressLabel(progress, integrity) {
  if (integrity?.restricted) return 'Progress unavailable: some related work is restricted.';
  if (integrity?.valid === false) return 'Progress unavailable until the hierarchy is repaired.';
  if (progress?.complete === false && progress?.ratio == null) return 'Progress unavailable: the hierarchy could not be measured completely.';
  if (!progress || progress.ratio == null) return 'No active leaf work to measure.';
  return `${progress.done} of ${progress.done + progress.unfinished} active leaf routes done`;
}

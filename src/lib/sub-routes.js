const archived = route => Boolean(route.archived_at ?? route.archivedAt);
const project = route => route.project_id ?? route.projectId ?? null;
const team = route => route.team_id ?? route.teamId ?? null;

// Only supplied, permission-filtered records are considered. A server restriction
// marker means the client cannot truthfully calculate complete progress.
export function leafRouteProgress(routes = [], workflows = [], allRoutes = routes) {
  const all = new Map(allRoutes.map(route => [route.id, route]));
  const agreements = new Map(workflows.map(row => [row.id, row]));
  const parents = new Set(workflows.filter(row => row.parent_task_id && all.has(row.id)).map(row => row.parent_task_id));
  let complete = true;
  for (const route of routes) {
    const seen = new Set();
    let current = route;
    while (current) {
      if (seen.has(current.id) || agreements.get(current.id)?.hierarchy_restricted || agreements.get(current.id)?.hierarchy_invalid) { complete = false; break; }
      seen.add(current.id);
      const parentId = agreements.get(current.id)?.parent_task_id;
      if (!parentId) break;
      const parent = all.get(parentId);
      if (!parent || parent.workspace_id !== current.workspace_id || project(parent) !== project(current) || team(parent) !== team(current) || seen.size >= 5) { complete = false; break; }
      current = parent;
    }
  }
  const leaves = routes.filter(route => !parents.has(route.id));
  const active = leaves.filter(route => !archived(route) && route.status !== 'cancelled');
  const done = active.filter(route => route.status === 'done').length;
  return {
    total: active.length, done, unfinished: active.length - done,
    cancelled: leaves.filter(route => !archived(route) && route.status === 'cancelled').length,
    archived: leaves.filter(archived).length,
    routeCount: routes.filter(route => !archived(route)).length,
    complete, percent: complete ? (active.length ? Math.round(done / active.length * 100) : 0) : null,
  };
}

// Keep every filtered result reachable, including children whose parent is
// filtered out. Corrupt legacy cycles become roots instead of disappearing.
export function routeForestRows(routes = [], workflows = [], collapsed = new Set()) {
  const agreements = new Map(workflows.map(row => [row.id, row]));
  const included = new Set(routes.map(route => route.id)), children = new Map();
  for (const route of routes) {
    const parentId = agreements.get(route.id)?.parent_task_id;
    if (parentId && included.has(parentId) && parentId !== route.id) {
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(route);
    }
  }
  for (const siblings of children.values()) siblings.sort((a, b) => (agreements.get(a.id)?.sibling_position ?? 0) - (agreements.get(b.id)?.sibling_position ?? 0));
  const rows = [], visited = new Set();
  function visit(root) {
    const stack = [{ route: root, depth: 0, hidden: false }];
    while (stack.length) {
      const { route, depth, hidden } = stack.pop();
      if (visited.has(route.id)) continue;
      visited.add(route.id);
      const descendants = children.get(route.id) ?? [];
      if (!hidden) rows.push({ route, depth: Math.min(depth, 4), hasChildren: descendants.length > 0, parentId: agreements.get(route.id)?.parent_task_id ?? null });
      for (let index = descendants.length - 1; index >= 0; index--) stack.push({ route: descendants[index], depth: depth + 1, hidden: hidden || collapsed.has(route.id) });
    }
  }
  for (const route of routes) if (!included.has(agreements.get(route.id)?.parent_task_id)) visit(route);
  for (const route of routes) visit(route);
  return rows;
}

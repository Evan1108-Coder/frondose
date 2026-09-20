export const ROUTE_DEPTH_LIMIT = 5;
export const ROUTE_CHILD_LIMIT = 100;
export const ROUTE_TREE_LIMIT = 1000;
const empty = value => value || null;
export const hierarchyError = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode, errorCode: 'route_hierarchy' });
const exists = db => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='route_workflows' AND type='table'").get());
const resolved = task => ['done', 'cancelled'].includes(task.status);
export const routeScope = task => task.project_id ? { scope_type: 'project', scope_id: task.project_id } : task.team_id ? { scope_type: 'team', scope_id: task.team_id } : {};
export function hierarchyTransaction(db, callback) {
  if (db.isTransaction) return callback();
  db.exec('BEGIN IMMEDIATE');
  try { const result = callback(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function installRouteHierarchy(db) {
  if (!db.prepare('PRAGMA table_info(route_workflows)').all().some(column => column.name === 'sibling_position')) db.exec('ALTER TABLE route_workflows ADD COLUMN sibling_position INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE INDEX IF NOT EXISTS route_workflows_parent ON route_workflows(parent_task_id,sibling_position,id);
    CREATE TABLE IF NOT EXISTS route_hierarchy_revisions(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sub_route_requests(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,actor_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(workspace_id,actor_id,request_id));`);
  for (const table of ['tasks', 'route_workflows']) for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    const ref = operation === 'DELETE' ? 'OLD' : 'NEW';
    const fields = table === 'tasks' ? 'status,project_id,team_id,archived_at' : 'parent_task_id,sibling_position,dependency_ids_json';
    db.exec(`CREATE TRIGGER IF NOT EXISTS hierarchy_revision_${table}_${operation.toLowerCase()} AFTER ${operation}${operation === 'UPDATE' ? ` OF ${fields}` : ''} ON ${table} BEGIN
      INSERT INTO route_hierarchy_revisions(workspace_id,revision) SELECT ${ref}.workspace_id,1 WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=${ref}.workspace_id) ON CONFLICT(workspace_id) DO UPDATE SET revision=revision+1; END;`);
  }
}
export const hierarchyRevision = (db, workspaceId) => db.prepare('SELECT revision FROM route_hierarchy_revisions WHERE workspace_id=?').get(workspaceId)?.revision || 0;
export function routeGraph(db, workspaceId) {
  if (!exists(db)) return new Map();
  return new Map(db.prepare('SELECT t.*,w.parent_task_id,w.sibling_position,w.workspace_id AS workflow_workspace_id,COALESCE(w.version,0) AS workflow_version,w.dependency_ids_json FROM tasks t LEFT JOIN route_workflows w ON w.id=t.id WHERE t.workspace_id=?').all(workspaceId).map(task => [task.id, { ...task, parent_task_id: task.parent_task_id || null, sibling_position: task.sibling_position || 0, dependency_ids: JSON.parse(task.dependency_ids_json || '[]') }]));
}
export function ancestorsOf(graph, task) {
  const result = [], seen = new Set([task.id]); let item = task;
  while (item.parent_task_id) {
    if (seen.has(item.parent_task_id) || seen.size >= ROUTE_TREE_LIMIT) throw hierarchyError('Legacy hierarchy has a cycle or exceeds the safety limit. Repair its links explicitly.');
    seen.add(item.parent_task_id); item = graph.get(item.parent_task_id);
    if (!item) throw hierarchyError('A parent is missing or belongs to another workspace. Repair the link explicitly.');
    result.push(item);
  }
  return result;
}
export function descendantsOf(graph, task) {
  const byParent = new Map();
  for (const item of graph.values()) if (item.parent_task_id) { const children = byParent.get(item.parent_task_id) || []; children.push(item); byParent.set(item.parent_task_id, children); }
  const result = [], stack = [task], seen = new Set();
  while (stack.length) {
    const item = stack.pop();
    if (seen.has(item.id) || seen.size >= ROUTE_TREE_LIMIT) throw hierarchyError('Legacy hierarchy has a cycle or exceeds the safety limit. Repair its links explicitly.');
    seen.add(item.id); if (item.id !== task.id) result.push(item);
    stack.push(...(byParent.get(item.id) || []));
  }
  return result;
}
export function relatedRouteNodes(graph, task) {
  const edges = new Map();
  for (const item of graph.values()) if (item.parent_task_id && graph.has(item.parent_task_id)) {
    for (const [from, to] of [[item.id, item.parent_task_id], [item.parent_task_id, item.id]]) { const links = edges.get(from) || []; links.push(to); edges.set(from, links); }
  }
  const seen = new Set(), stack = [task.id], result = [];
  while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; if (seen.size >= ROUTE_TREE_LIMIT) throw hierarchyError('The hierarchy exceeds the safety limit.'); seen.add(id); const item = graph.get(id); if (item) result.push(item); stack.push(...(edges.get(id) || [])); }
  return result;
}
export const sameRouteScope = (a, b) => a.workspace_id === b.workspace_id && empty(a.project_id) === empty(b.project_id) && empty(a.team_id) === empty(b.team_id);
export function inspectRouteGraph(graph, task) {
  const ancestors = ancestorsOf(graph, task), root = ancestors.at(-1) || task;
  const descendants = descendantsOf(graph, root), nodes = [root, ...descendants];
  for (const item of nodes) {
    if (item.workflow_workspace_id && item.workflow_workspace_id !== item.workspace_id) throw hierarchyError('Legacy route details belong to another workspace. Repair them explicitly.');
    const parent = graph.get(item.parent_task_id);
    if (item.parent_task_id && (!parent || !sameRouteScope(item, parent))) throw hierarchyError('Parent and sub-route must use the same workspace, project and team. Detach the legacy link before moving work.');
    if (ancestorsOf(graph, item).length >= ROUTE_DEPTH_LIMIT) throw hierarchyError('Sub-routes support at most five levels including the root.');
    if (nodes.filter(child => child.parent_task_id === item.id).length > ROUTE_CHILD_LIMIT) throw hierarchyError('A route supports up to 100 immediate sub-routes.');
  }
  return nodes;
}
export function authorizeRouteNodes(nodes, { actor, allowed, write = false } = {}) {
  if (!allowed) return;
  for (const item of new Map(nodes.filter(Boolean).map(item => [item.id, item])).values()) if (!actor?.id || !allowed(item.workspace_id, actor, 'routes.read', routeScope(item)) || write && !allowed(item.workspace_id, actor, 'routes.write', routeScope(item))) throw hierarchyError('The hierarchy includes work outside your access.', 403);
}
export function activeHierarchyTarget(db, task) {
  if (!task || task.archived_at || !db.prepare('SELECT 1 FROM workspaces WHERE id=? AND archived_at IS NULL').get(task.workspace_id)) throw hierarchyError('Choose an active route in an active workspace.', 404);
  for (const [key, table] of [['project_id', 'projects'], ['team_id', 'teams']]) if (task[key] && !db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND workspace_id=? AND archived_at IS NULL`).get(task[key], task.workspace_id)) throw hierarchyError('Restore the route’s project or team first.');
}
export function assertRouteLink(db, child, parentId, options = {}) {
  const graph = routeGraph(db, child.workspace_id), previous = graph.get(child.id);
  const next = { ...previous, ...child, parent_task_id: empty(parentId), workflow_workspace_id: child.workspace_id };
  const parent = graph.get(parentId);
  if (parentId && !parent) throw hierarchyError('The parent must belong to this workspace.');
  if (child.id === parentId) throw hierarchyError('A route cannot be its own parent.');
  if (parent) activeHierarchyTarget(db, parent);
  const previousParent = graph.get(previous?.parent_task_id) || (previous?.parent_task_id ? db.prepare('SELECT * FROM tasks WHERE id=?').get(previous.parent_task_id) : null);
  if (previous) authorizeRouteNodes(options.repair ? relatedRouteNodes(graph, previous) : inspectRouteGraph(graph, previous), { ...options, write: true });
  graph.set(child.id, next);
  const subtree = [next, ...descendantsOf(graph, next)];
  authorizeRouteNodes([...subtree, previousParent, parent], { ...options, write: true });
  const affected = inspectRouteGraph(graph, next);
  authorizeRouteNodes(affected, { ...options, write: true });
  if (parent && ancestorsOf(graph, next).some(item => item.archived_at || item.status === 'done' && subtree.some(item => !resolved(item)))) throw hierarchyError('Restore or reopen the parent route before adding unfinished sub-routes.');
  return next;
}
export function assertRouteDependencies(db, task, dependencyIds, options = {}) {
  const graph = routeGraph(db, task.workspace_id);
  for (const id of dependencyIds) { const dependency = graph.get(id); if (!dependency || id === task.id) throw hierarchyError('Dependencies must be other routes in this workspace.'); activeHierarchyTarget(db, dependency); authorizeRouteNodes([dependency], options); }
  graph.set(task.id, { ...graph.get(task.id), ...task, dependency_ids: dependencyIds });
  const visiting = new Set(), visited = new Set();
  const visit = id => { if (visiting.has(id)) throw hierarchyError('Dependencies cannot form a cycle.'); if (visited.has(id)) return; if (visited.size + visiting.size >= ROUTE_TREE_LIMIT) throw hierarchyError('The dependency graph exceeds the safety limit.'); visiting.add(id); for (const dependency of graph.get(id)?.dependency_ids || []) visit(dependency); visiting.delete(id); visited.add(id); };
  visit(task.id);
}
export function guardRouteMutation(db, before, after, options = {}) {
  if (!before?.id || !exists(db)) return;
  const relevant = ['workspace_id', 'project_id', 'team_id', 'status', 'archived_at'].some(key => empty(before[key]) !== empty(after[key]));
  if (!relevant) return;
  const graph = routeGraph(db, before.workspace_id), task = graph.get(before.id);
  if (!task) return;
  const children = [...graph.values()].filter(item => item.parent_task_id === task.id);
  const moving = ['workspace_id', 'project_id', 'team_id'].some(key => empty(before[key]) !== empty(after[key]));
  if (moving && (task.parent_task_id || children.length)) throw hierarchyError('Detach this route and its sub-routes before moving it to another project or team.');
  const nodes = inspectRouteGraph(graph, task);
  authorizeRouteNodes(nodes, { ...options, write: true });
  const ancestors = ancestorsOf(graph, task), descendants = descendantsOf(graph, task);
  if (after.status === 'done' && before.status !== 'done' && descendants.some(item => !resolved(item))) throw hierarchyError('Finish or cancel every unfinished sub-route before completing its parent. Archiving does not count as completion.');
  if (!resolved(after) && resolved(before) && ancestors.some(item => item.status === 'done')) throw hierarchyError('Reopen completed parent routes before reopening this sub-route.');
  if (before.archived_at && !after.archived_at && ancestors.some(item => item.archived_at)) throw hierarchyError('Restore the parent route before restoring this sub-route.');
}
export function guardRouteDeletion(db, taskId) {
  if (exists(db) && db.prepare('SELECT 1 FROM route_workflows WHERE parent_task_id=? LIMIT 1').get(taskId)) throw hierarchyError('Detach all sub-routes, including archived ones, before permanently deleting their parent.');
}
export function leafProgress(graph, task, complete = true) {
  if (!complete) return { done: null, unfinished: null, cancelled: null, archived: null, total: null, ratio: null, complete: false };
  const descendants = descendantsOf(graph, task), nodes = descendants.length ? descendants : [task];
  const leaves = nodes.filter(item => !descendants.some(child => child.parent_task_id === item.id));
  const archived = leaves.filter(item => item.archived_at).length;
  const active = leaves.filter(item => !item.archived_at);
  const done = active.filter(item => item.status === 'done').length, cancelled = active.filter(item => item.status === 'cancelled').length, unfinished = active.length - done - cancelled;
  return { done, unfinished, cancelled, archived, total: leaves.length, ratio: done + unfinished ? done / (done + unfinished) : null, complete: true };
}

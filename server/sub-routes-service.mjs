import { createHash, randomUUID } from 'node:crypto';
import { recordChange } from './workspace-features.mjs';
import { isRecord, validationError } from './validation.mjs';
import { routeGraph, routeScope, hierarchyRevision, hierarchyTransaction, hierarchyError, inspectRouteGraph, relatedRouteNodes, ancestorsOf, descendantsOf, authorizeRouteNodes, activeHierarchyTarget, assertRouteLink, leafProgress, ROUTE_CHILD_LIMIT } from './route-hierarchy.mjs';
const stamp = () => new Date().toISOString();
const text = (value, label, max, required = false) => { if (typeof value !== 'string' || value.length > max || required && !value.trim() || value.includes('\0')) throw validationError(`${label} must be ${required ? 'non-empty ' : ''}text of at most ${max} characters.`); return value.trim(); };
const taskRow = (db, id, workspaceId) => { const task = db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=?').get(id, workspaceId); if (!task) throw hierarchyError('Route unavailable in this workspace.', 404); return task; };
const readable = (task, actor, allowed) => Boolean(task && actor?.id && allowed(task.workspace_id, actor, 'routes.read', routeScope(task)));
export function subRouteTree(db, id, workspaceId, actor, allowed) {
  const graph = routeGraph(db, workspaceId), current = graph.get(id);
  if (!readable(current, actor, allowed)) throw hierarchyError('Route unavailable in this workspace.', 404);
  let nodes = [current], ancestors = [], descendants = [], valid = true; const warnings = [];
  try { nodes = inspectRouteGraph(graph, current); ancestors = ancestorsOf(graph, current); descendants = descendantsOf(graph, current); }
  catch (error) { valid = false; warnings.push(error.message); try { nodes = relatedRouteNodes(graph, current); } catch { nodes = [...graph.values()]; } descendants = [...graph.values()].filter(item => item.parent_task_id === id).slice(0, 1000); }
  const dependencies = nodes.flatMap(item => item.dependency_ids.map(dependency => graph.get(dependency)));
  const directParent = current.parent_task_id ? db.prepare('SELECT * FROM tasks WHERE id=?').get(current.parent_task_id) : null;
  const restricted = [...nodes, ...dependencies, ...descendants, ...(directParent ? [directParent] : [])].some(task => !readable(task, actor, allowed));
  if (restricted) warnings.push('Some related work is unavailable. Progress and hierarchy editing are disabled.');
  const editable = task => readable(task, actor, allowed) && allowed(task.workspace_id, actor, 'routes.write', routeScope(task));
  let active = true; try { activeHierarchyTarget(db, current); } catch { active = false; }
  const allWritable = !restricted && [...nodes, ...ancestors, ...descendants].every(editable);
  const canChange = valid && active && allWritable;
  const contextualActive = !ancestors.some(item => item.archived_at), canAdd = canChange && contextualActive && ![current, ...ancestors].some(item => item.status === 'done');
  const parent = graph.get(current.parent_task_id), direct = descendants.filter(item => item.parent_task_id === id);
  const safeParent = parent && readable(parent, actor, allowed) ? parent : null;
  const capabilities = { can_create: Boolean(canAdd && ancestors.length < 4 && direct.length < ROUTE_CHILD_LIMIT), can_attach: Boolean(canAdd && ancestors.length < 4 && direct.length < ROUTE_CHILD_LIMIT), can_reparent: Boolean(canChange), can_detach: Boolean(canChange && current.parent_task_id), can_reorder: Boolean(canChange && direct.length > 1), can_repair: Boolean(!valid && active && allWritable && editable(current) && (!directParent || editable(directParent))) };
  const decorate = task => {
    const { dependency_ids_json, workflow_workspace_id, ...result } = task;
    let depth = null; try { if (!restricted) depth = ancestorsOf(graph, task).length + 1; } catch { /* Explicit legacy warning above. */ }
    return { ...result, parent_task_id: task.parent_task_id && readable(graph.get(task.parent_task_id), actor, allowed) ? task.parent_task_id : null, dependency_ids: task.dependency_ids.filter(id => readable(graph.get(id), actor, allowed)), depth, hierarchy_restricted: restricted,
      can_reparent: Boolean(canChange && !task.archived_at), can_detach: Boolean(canChange && !task.archived_at && task.parent_task_id), can_repair: Boolean(!valid && editable(task) && !restricted) };
  };
  const sort = (a, b) => a.sibling_position - b.sibling_position || a.number - b.number || a.id.localeCompare(b.id);
  return { route: decorate(current), parent: safeParent ? decorate(safeParent) : null, ancestors: ancestors.filter(task => readable(task, actor, allowed)).reverse().map(decorate), children: direct.filter(task => readable(task, actor, allowed)).sort(sort).map(decorate), descendants: descendants.filter(task => readable(task, actor, allowed)).sort(sort).map(decorate), progress: leafProgress(graph, current, valid && !restricted), revision: hierarchyRevision(db, workspaceId), integrity: { valid, restricted, warnings }, capabilities };
}
export function setRouteParent(db, task, parentId, options = {}) {
  assertRouteLink(db, task, parentId, options);
  const before = db.prepare('SELECT * FROM route_workflows WHERE id=?').get(task.id);
  const position = parentId ? db.prepare('SELECT COALESCE(MAX(sibling_position),-1)+1 n FROM route_workflows WHERE parent_task_id=? AND id<>?').get(parentId, task.id).n : 0;
  db.prepare(`INSERT INTO route_workflows(id,workspace_id,parent_task_id,sibling_position,version,updated_at) VALUES(?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET parent_task_id=excluded.parent_task_id,sibling_position=excluded.sibling_position,version=version+1,updated_at=excluded.updated_at`).run(task.id, task.workspace_id, parentId || null, position, stamp());
  const after = db.prepare('SELECT * FROM route_workflows WHERE id=?').get(task.id);
  recordChange(db, 'route_workflows', before, after, parentId ? before?.parent_task_id ? 'reparented' : 'attached' : 'detached');
  return after;
}
export async function subRoutesRoute({ db, req, res, path, url, readBody, send, snapshot, actor, allowed }) {
  const match = /^\/sub-routes\/([^/]+)(?:\/(create|attach|reparent|detach|reorder))?$/.exec(path);
  if (!match) return false;
  if (!actor?.id || !allowed) throw hierarchyError('Sign in to manage sub-routes.', 401);
  const id = decodeURIComponent(match[1]), action = match[2];
  if (req.method === 'GET' && !action) { send(res, 200, { result: subRouteTree(db, id, url.searchParams.get('workspace_id'), actor, allowed) }); return true; }
  if (req.method !== 'POST' || !action) return false;
  const body = await readBody(req);
  if (!isRecord(body)) throw validationError('Provide valid sub-route fields.');
  const workspaceId = text(body.workspace_id, 'Workspace', 200, true), requestId = text(body.request_id, 'Retry key', 160, true);
  if (!/^[\w.-]{8,160}$/.test(requestId)) throw validationError('Use a stable retry key of 8–160 letters, digits, dots, hyphens or underscores.');
  const fingerprint = createHash('sha256').update(JSON.stringify([path, Object.fromEntries(Object.entries(body).sort(([a], [b]) => a.localeCompare(b)))])).digest('hex');
  const options = { actor, allowed, repair: body.repair === true };
  const result = hierarchyTransaction(db, () => {
    const task = taskRow(db, id, workspaceId); activeHierarchyTarget(db, task); authorizeRouteNodes([task], { ...options, write: true });
    const previous = db.prepare('SELECT * FROM sub_route_requests WHERE workspace_id=? AND actor_id=? AND request_id=?').get(workspaceId, actor.id, requestId);
    if (previous) { if (previous.fingerprint !== fingerprint) throw hierarchyError('This retry key belongs to different work.'); const stored = JSON.parse(previous.result_json); authorizeRouteNodes(stored.task_ids.map(taskId => taskRow(db, taskId, workspaceId)), { actor, allowed, write: true }); const tree = subRouteTree(db, stored.tree_id, workspaceId, actor, allowed); if (tree.integrity.restricted) throw hierarchyError('The current hierarchy includes work outside your access.', 403); return { ...stored, revision: hierarchyRevision(db, workspaceId), tree }; }
    if (!Number.isInteger(body.revision) || body.revision !== hierarchyRevision(db, workspaceId)) throw hierarchyError('The hierarchy changed. Refresh it before continuing.');
    const current = subRouteTree(db, id, workspaceId, actor, allowed);
    if (current.integrity.restricted || !current.integrity.valid && !(options.repair && ['detach', 'reparent'].includes(action))) throw hierarchyError('Repair the invalid hierarchy explicitly before changing it.');
    let taskIds = [id], treeId = id;
    if (action === 'create') {
      if (!current.capabilities.can_create) throw hierarchyError('You cannot add a sub-route here.');
      const title = text(body.title, 'Title', 200, true), description = text(body.description || '', 'Description', 50000), priority = body.priority || 'no_priority';
      if (!['no_priority', 'low', 'medium', 'high', 'urgent'].includes(priority)) throw validationError('Choose a valid priority.');
      const childId = `task_${randomUUID().replaceAll('-', '')}`, time = stamp(), number = db.prepare('SELECT COALESCE(MAX(number),0)+1 n FROM tasks WHERE workspace_id=?').get(workspaceId).n;
      const child = { id: childId, workspace_id: workspaceId, project_id: task.project_id, team_id: task.team_id || null, status: 'backlog' };
      assertRouteLink(db, child, id, options);
      db.prepare('INSERT INTO tasks(id,workspace_id,project_id,team_id,number,title,description,status,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(childId, workspaceId, child.project_id, child.team_id, number, title, description, 'backlog', priority, time, time);
      setRouteParent(db, child, id, options); recordChange(db, 'tasks', null, taskRow(db, childId, workspaceId), 'created sub-route'); taskIds = [childId];
    } else if (action === 'attach' || action === 'reparent') {
      const parentId = text(body.parent_id, 'Parent', 200, true);
      if (action === 'attach' && current.route.parent_task_id) throw hierarchyError('This route already has a parent. Use Reparent explicitly.');
      if (action === 'reparent' && !current.route.parent_task_id && !options.repair) throw hierarchyError('This route has no parent. Use Attach.');
      if (parentId === current.route.parent_task_id) throw hierarchyError('Choose a different parent.');
      setRouteParent(db, task, parentId, options); treeId = parentId;
    } else if (action === 'detach') {
      const stored = db.prepare('SELECT parent_task_id FROM route_workflows WHERE id=?').get(id);
      if (!stored?.parent_task_id) throw hierarchyError('This route already has no parent.');
      setRouteParent(db, task, null, options);
    } else {
      if (!current.capabilities.can_reorder) throw hierarchyError('There are no editable siblings to reorder.');
      const childIds = body.child_ids, actual = current.children.map(child => child.id);
      if (!Array.isArray(childIds) || new Set(childIds).size !== childIds.length || JSON.stringify([...childIds].sort()) !== JSON.stringify(actual.sort())) throw validationError('Include every immediate sub-route exactly once.');
      childIds.forEach((childId, index) => { const before = db.prepare('SELECT * FROM route_workflows WHERE id=?').get(childId); db.prepare('UPDATE route_workflows SET sibling_position=?,version=version+1,updated_at=? WHERE id=?').run(index, stamp(), childId); recordChange(db, 'route_workflows', before, db.prepare('SELECT * FROM route_workflows WHERE id=?').get(childId), 'reordered'); }); taskIds = childIds;
    }
    const stored = { task_ids: taskIds, tree_id: treeId };
    db.prepare('INSERT INTO sub_route_requests VALUES(?,?,?,?,?)').run(workspaceId, actor.id, requestId, fingerprint, JSON.stringify(stored));
    return { ...stored, revision: hierarchyRevision(db, workspaceId), tree: subRouteTree(db, treeId, workspaceId, actor, allowed) };
  });
  send(res, action === 'create' ? 201 : 200, { result, bootstrap: snapshot(db) }); return true;
}

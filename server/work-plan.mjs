import { normalizeWorkPlan, moveWorkPlan, workPlanKey } from '../src/lib/work-plan.js';
import { todoInArea, todoStatus } from '../src/lib/todo-model.js';

const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const problem = (message,statusCode=400) => Object.assign(Error(message),{statusCode});

function currentCard(db, workspaceId, teamId, key) {
  if (!workPlanKey(key)) return false;
  const [kind, itemId] = key.split(':');
  if (kind === 'todo') {
    const row = db.prepare('SELECT team_id, status, data FROM local_todos WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(itemId,workspaceId);
    return Boolean(row && todoStatus(row.status) !== 'finished' && (!teamId || todoInArea({...JSON.parse(row.data),team_id:row.team_id},teamId)));
  }
  const route = db.prepare(`SELECT t.team_id, p.team_id AS project_team FROM tasks t LEFT JOIN projects p
    ON t.project_id=p.id AND p.workspace_id=t.workspace_id AND p.archived_at IS NULL
    WHERE t.id=? AND t.workspace_id=? AND t.archived_at IS NULL AND t.status NOT IN ('done','cancelled')`).get(itemId,workspaceId);
  return Boolean(route && (!teamId || teamId === route.team_id || teamId === route.project_team));
}

export function dispatchWorkPlan(db, { workspaceId, teamId, actor, method, input={} }) {
  if (actor?.id !== 'local-owner') throw problem('Work Plan is available only to the local owner.',403);
  if (!id(workspaceId) || !db.prepare('SELECT 1 FROM workspaces WHERE id=? AND archived_at IS NULL').get(workspaceId)) throw problem('Workspace not found.',404);
  if (teamId !== null && (!id(teamId) || !db.prepare('SELECT 1 FROM teams WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(teamId,workspaceId))) throw problem('Area not found.',404);
  db.exec(`CREATE TABLE IF NOT EXISTS local_work_plans(
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    scope TEXT NOT NULL, revision INTEGER NOT NULL, plan_json TEXT NOT NULL,
    PRIMARY KEY(workspace_id, scope)
  ) STRICT`);
  const scope=teamId ? 'area:'+teamId : 'workspace';
  const row=db.prepare('SELECT revision, plan_json FROM local_work_plans WHERE workspace_id=? AND scope=?').get(workspaceId,scope);
  const revision=row?.revision ?? 0, plan=normalizeWorkPlan(row ? JSON.parse(row.plan_json) : null);
  if (method==='GET') return {revision,...plan};
  if (method!=='PATCH') throw problem('Use PATCH to change Work Plan.',405);
  if (input?.revision!==revision) throw problem('Work Plan changed elsewhere. Refresh and try again.',409);
  let next;
  if (typeof input.includeRoutes==='boolean' && input.key===undefined) {
    next={...plan,includeRoutes:input.includeRoutes};
  } else {
    if (!currentCard(db,workspaceId,teamId,input?.key) || (input.key.startsWith('route:')&&!plan.includeRoutes)) throw problem('This item is no longer active in this plan.',409);
    if (input.before != null && (!currentCard(db,workspaceId,teamId,input.before) || (input.before.startsWith('route:')&&!plan.includeRoutes))) throw problem('The drop target changed. Refresh and try again.',409);
    if (input.before != null && (input.lane === 'unplanned' || !plan.columns[input.lane]?.some(entry=>entry.key===input.before))) throw problem('The drop target changed. Refresh and try again.',409);
    try {
      next=moveWorkPlan(plan,input);
    } catch (error) { throw problem(error.message); }
  }
  if (Object.values(next.columns).flat().length>3000) throw problem('Work Plan reached its local placement limit.');
  const saved = db.prepare(`INSERT INTO local_work_plans (workspace_id,scope,revision,plan_json) VALUES (?,?,?,?)
    ON CONFLICT(workspace_id,scope) DO UPDATE SET revision=excluded.revision,plan_json=excluded.plan_json
    WHERE local_work_plans.revision=?`).run(workspaceId,scope,revision+1,JSON.stringify(next),revision);
  if (!saved.changes) throw problem('Work Plan changed elsewhere. Refresh and try again.',409);
  return {revision:revision+1,...next};
}

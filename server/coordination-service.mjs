import { randomUUID } from 'node:crypto';
import { validationError, isRecord } from './validation.mjs';
import { recordChange } from './workspace-features.mjs';

const activeRuns = new Set(['queued', 'starting', 'running', 'needs_input', 'paused']);
const fail = (message, statusCode = 400) => Object.assign(validationError(message), { statusCode });
const text = (value, label, max = 10000) => { if (typeof value !== 'string' || value.length > max) throw fail(`${label} must be text under ${max} characters.`); return value.trim(); };
const decode = row => row && ({ ...row, steps: JSON.parse(row.steps_json), steps_json: undefined });
function scope(db, workspaceId, projectId) {
  if (typeof workspaceId !== 'string' || projectId && typeof projectId !== 'string') throw fail('Choose a valid workspace and project.');
  if (!db.prepare('SELECT id FROM workspaces WHERE id=? AND archived_at IS NULL').get(workspaceId)) throw fail('Choose an active workspace.');
  if (projectId && !db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(projectId, workspaceId)) throw fail('Choose an active project in this workspace.');
}
export function validateSteps(db, workspaceId, projectId, input, previous = []) {
  if (!Array.isArray(input) || input.length > 40) throw fail('A plan may have up to 40 steps.');
  const ids = new Set();
  const steps = input.map(step => {
    if (!isRecord(step)) throw fail('Each step must be an object.');
    const id = step.id || randomUUID();
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || ids.has(id)) throw fail('Step identifiers must be unique.');
    ids.add(id);
    const old = previous.find(s => s.id === id);
    const name = text(step.name, 'Step name', 200); if (!name) throw fail('Name each step.');
    const agentId = step.agent_id || null, taskId = step.task_id || null;
    if (agentId && !db.prepare('SELECT id FROM agents WHERE id=? AND (workspace_id=? OR workspace_id IS NULL) AND archived_at IS NULL').get(agentId, workspaceId)) throw fail('Select an agent in this workspace.');
    if (taskId) { const task = db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(taskId,workspaceId); if (!task || projectId && task.project_id !== projectId) throw fail('Select a route belonging to the plan’s project.'); }
    if (!Array.isArray(step.depends_on ?? []) || step.depends_on.some(id => typeof id !== 'string')) throw fail('Dependencies must be step identifiers.');
    return { id, name, brief: text(step.brief || '', 'Brief'), owner: text(step.owner || '', 'Decision owner', 200), agent_id: agentId, task_id: taskId, depends_on: [...new Set(step.depends_on || [])], status: old?.status || 'planned', summary: old?.summary || '', run_id: old?.run_id || null, output_id: old?.output_id || null, completed_at: old?.completed_at || null };
  });
  const visiting = new Set(), visited = new Set();
  const visit = id => { if (visiting.has(id)) throw fail('Step dependencies cannot form a cycle.'); if (visited.has(id)) return; visiting.add(id); const s = steps.find(s => s.id === id); for (const dep of s.depends_on) { if (dep === id || !ids.has(dep)) throw fail('Dependencies must reference another step in this plan.'); visit(dep); } visiting.delete(id); visited.add(id); };
  steps.forEach(s => visit(s.id));
  for (const old of previous) {
    const next = steps.find(s => s.id === old.id);
    if ((old.run_id || old.status === 'completed') && (!next || JSON.stringify([next.name,next.brief,next.agent_id,next.task_id,next.depends_on]) !== JSON.stringify([old.name,old.brief,old.agent_id,old.task_id,old.depends_on]))) throw fail('Completed or dispatched steps retain their history. Add a new step for revisions.');
  }
  return steps;
}
export function installCoordination(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS work_plans (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active', steps_json TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS work_plans_workspace ON work_plans(workspace_id);`);
  if (!db.prepare('PRAGMA table_info(work_plans)').all().some(column => column.name === 'kind')) db.exec("ALTER TABLE work_plans ADD COLUMN kind TEXT NOT NULL DEFAULT 'plan'");
}
export function coordinationSnapshot(db) { return { work_plans: db.prepare("SELECT * FROM work_plans WHERE kind='plan' ORDER BY updated_at DESC").all().map(decode) }; }
export async function coordinationRoute({ db, req, res, path, readBody, send, snapshot }) {
  if (!path.startsWith('/coordination/')) return false;
  const match = path.match(/^\/coordination\/plans(?:\/([\w-]+))?(?:\/(prepare|complete|link-run|reopen))?$/);
  if (!match) return false;
  const [, id, action] = match;
  if (req.method === 'GET') { const result = id ? decode(db.prepare("SELECT * FROM work_plans WHERE id=? AND kind='plan'").get(id)) : coordinationSnapshot(db).work_plans; if (id && !result) throw fail('Plan not found.',404); send(res,200,{result}); return true; }
  const body = await readBody(req); if (!isRecord(body)) throw fail('Provide a plan.');
  const stamp = new Date().toISOString();
  let current = id ? decode(db.prepare("SELECT * FROM work_plans WHERE id=? AND kind='plan'").get(id)) : null;
  if (id && !current) throw fail('Plan not found.',404);
  if (current && body.version !== current.version) throw fail('This plan changed. Refresh and review the current steps.',409);
  scope(db, current?.workspace_id || body.workspace_id, current?.project_id || body.project_id);
  let result;
  if (!id && req.method === 'POST') {
    const title = text(body.title,'Plan title',200); if (!title) throw fail('Name the plan.');
    result = { id: randomUUID(), workspace_id: body.workspace_id, project_id: body.project_id || null, kind: 'plan', title, state: 'active', steps: validateSteps(db,body.workspace_id,body.project_id,body.steps || []), version: 1, created_at: stamp, updated_at: stamp };
    db.prepare('INSERT INTO work_plans(id,workspace_id,project_id,title,state,steps_json,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(result.id,result.workspace_id,result.project_id,title,result.state,JSON.stringify(result.steps),1,stamp,stamp);
  } else if (id && req.method === 'PATCH' && !action) {
    const state = body.state ?? current.state; if (!['active','paused','cancelled'].includes(state)) throw fail('Choose a valid plan state.');
    const title = text(body.title ?? current.title,'Plan title',200); if (!title) throw fail('Name the plan.');
    result = { ...current, title, state, steps: body.steps ? validateSteps(db,current.workspace_id,current.project_id,body.steps,current.steps) : current.steps };
  } else if (id && req.method === 'POST' && action) {
    const step = current.steps.find(s => s.id === body.step_id); if (!step) throw fail('Step not found.',404);
    const dependencies = current.steps.filter(s => step.depends_on.includes(s.id));
    if (action !== 'reopen' && (current.state !== 'active' || dependencies.some(s => s.status !== 'completed'))) throw fail(current.state !== 'active' ? 'Resume this plan before preparing or completing work.' : 'Finish the prerequisite steps first.',409);
    if (action === 'prepare') {
      if (step.status === 'completed') throw fail('This step is complete. Reopen it before preparing more work.');
      const busy = step.task_id ? db.prepare('SELECT * FROM runs WHERE task_id=?').all().find(r => activeRuns.has(r.status)) : step.run_id && db.prepare('SELECT * FROM runs WHERE id=?').get(step.run_id);
      if (busy && activeRuns.has(busy.status)) throw fail('A linked session is already active. Open it in Live work.',409);
      const defaults = { title: step.name, prompt: `${step.brief || step.name}${dependencies.length ? '\n\nPrior handoffs:\n' + dependencies.map(s => `${s.name}: ${s.summary}`).join('\n') : ''}`, project_id: current.project_id, task_id: step.task_id, agent_id: step.agent_id };
      send(res,200,{result:{defaults,plan_id:id,step_id:step.id,manual:true}}); return true;
    }
    result = structuredClone(current); const target = result.steps.find(s => s.id === step.id);
    if (action === 'link-run') {
      const run = db.prepare('SELECT * FROM runs WHERE id=? AND workspace_id=?').get(body.run_id,current.workspace_id);
      if (!run || current.project_id && run.project_id !== current.project_id || step.task_id && run.task_id !== step.task_id || step.agent_id && run.agent_id !== step.agent_id) throw fail('The run must match the step’s workspace, project, route, and agent.');
      if (step.status === 'completed') throw fail('Reopen a completed step before linking a run.');
      target.run_id = run.id; target.status = 'in_progress';
    } else if (action === 'complete') {
      const summary = text(body.summary,'Handoff summary'); if (!summary) throw fail('Record the result and next steps before completing this step.');
      if (step.run_id) { const run = db.prepare('SELECT status FROM runs WHERE id=?').get(step.run_id); if (run?.status !== 'completed') throw fail('The linked run has not completed. Keep its failure or interruption visible.',409); }
      if (body.output_id) { const output = db.prepare('SELECT * FROM outputs WHERE id=? AND workspace_id=?').get(body.output_id,current.workspace_id); if (!output || current.project_id && output.project_id !== current.project_id) throw fail('Choose an output belonging to this project.'); target.output_id = output.id; }
      target.status = 'completed'; target.summary = summary; target.completed_at = stamp;
    } else if (action === 'reopen') {
      if (current.steps.some(s => s.depends_on.includes(step.id) && s.status !== 'planned')) throw fail('Reopen downstream steps first so their dependencies remain truthful.',409);
      target.status = 'planned'; target.completed_at = null;
    }
  } else return false;
  if (current) { result.version++; result.updated_at = stamp; db.prepare("UPDATE work_plans SET title=?,state=?,steps_json=?,version=?,updated_at=? WHERE id=? AND kind='plan'").run(result.title,result.state,JSON.stringify(result.steps),result.version,stamp,id); }
  recordChange(db,'work_plans',current,result,action || (current?'updated':'created'));
  send(res,current?200:201,{result,bootstrap:snapshot(db)}); return true;
}

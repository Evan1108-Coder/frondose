import { randomUUID, createHash } from 'node:crypto';
import { isRecord, validationError } from './validation.mjs';
import { recordChange } from './workspace-features.mjs';
const bad = (text, code = 400) => Object.assign(validationError(text), { statusCode: code });
const text = (v,max=200) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw bad(`Provide text between 1 and ${max} characters.`); return v.trim(); };
const date = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw bad('Choose a valid date.'); return value; };
const iso = () => new Date().toISOString();
function activeRoute(db,id) {
  const row=db.prepare('SELECT t.* FROM tasks t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=? AND t.archived_at IS NULL AND w.archived_at IS NULL').get(id);
  if (!row) throw bad('Choose an active route.',404);
  if (row.project_id && !db.prepare('SELECT id FROM projects WHERE id=? AND archived_at IS NULL').get(row.project_id)) throw bad('Restore the project first.');
  if (row.team_id && !db.prepare('SELECT id FROM teams WHERE id=? AND archived_at IS NULL').get(row.team_id)) throw bad('Restore the team first.');
  return row;
}
export function installRouteTools(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS route_schedules(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,name TEXT NOT NULL,interval_days INTEGER NOT NULL,next_date TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'active',last_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,generated_count INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS route_tool_requests(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,fingerprint TEXT NOT NULL,result_json TEXT NOT NULL);`);
}
export function routeToolsSnapshot(db) { return { route_schedules:db.prepare('SELECT * FROM route_schedules ORDER BY next_date').all() }; }
function cloneRoute(db,source,title,parentId=null,dueAt=null) {
  const id=`task_${randomUUID().replaceAll('-','')}`, stamp=iso();
  const number=db.prepare('SELECT COALESCE(MAX(number),0)+1 n FROM tasks WHERE workspace_id=?').get(source.workspace_id).n;
  db.prepare('INSERT INTO tasks(id,workspace_id,project_id,team_id,number,title,description,status,priority,labels_json,assignee_agent_ids_json,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,source.workspace_id,source.project_id,source.team_id,number,title,source.description,'ready',source.priority,source.labels_json,'[]',dueAt,stamp,stamp);
  const agreement=db.prepare('SELECT * FROM route_workflows WHERE id=?').get(source.id);
  const criteria=JSON.parse(agreement?.acceptance_json || '[]').map(c=>({...c,id:randomUUID(),done:false}));
  db.prepare('INSERT INTO route_workflows(id,workspace_id,owner_name,reviewer_name,output_type,parent_task_id,acceptance_json,dependency_ids_json,version,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,source.workspace_id,agreement?.owner_name || '',agreement?.reviewer_name || '',agreement?.output_type || 'document',parentId,JSON.stringify(criteria),'[]',1,stamp);
  const result=db.prepare('SELECT * FROM tasks WHERE id=?').get(id); recordChange(db,'tasks',null,result,'created'); return result;
}
export async function routeToolsRoute({db,req,res,path,readBody,send,snapshot}) {
  if (!path.startsWith('/route-tools/')) return false;
  const match=path.match(/^\/route-tools\/(?:schedules\/([\w-]+)(?:\/(generate))?|([\w-]+)\/(duplicate|split|schedule))$/);
  if (!match || !['POST','PATCH'].includes(req.method)) return false;
  const [,scheduleId,generate,taskId,action]=match, body=await readBody(req);
  if (!isRecord(body)) throw bad('Provide valid route options.');
  let result, status=200;
  const mutation=action === 'duplicate' || action === 'split' || action === 'schedule' || generate;
  const key=mutation ? text(body.request_id,100) : null;
  const fingerprint=createHash('sha256').update(JSON.stringify([path,body])).digest('hex');
  if (key) { const replay=db.prepare('SELECT * FROM route_tool_requests WHERE id=?').get(key); if (replay) { if (replay.fingerprint !== fingerprint) throw bad('This request ID was already used for different work.',409); send(res,200,{result:JSON.parse(replay.result_json),bootstrap:snapshot(db),replayed:true});return true; } }
  db.exec('BEGIN');
  try {
    let workspaceId;
    if (scheduleId) {
      const schedule=db.prepare('SELECT * FROM route_schedules WHERE id=?').get(scheduleId); if (!schedule) throw bad('Schedule not found.',404);
      workspaceId=schedule.workspace_id;
      if (body.version !== schedule.version) throw bad('This schedule changed. Refresh before continuing.',409);
      if (generate && req.method === 'POST') {
        if (schedule.state !== 'active' || schedule.next_date > iso().slice(0,10)) throw bad('Only an active, due schedule can create a route.',409);
        const source=activeRoute(db,schedule.source_task_id);
        const route=cloneRoute(db,source,`${schedule.name} · ${schedule.next_date}`,null,`${schedule.next_date}T23:59:59.000Z`);
        const next=new Date(`${schedule.next_date}T00:00:00Z`); next.setUTCDate(next.getUTCDate()+schedule.interval_days);
        db.prepare('UPDATE route_schedules SET next_date=?,last_task_id=?,generated_count=generated_count+1,version=version+1,updated_at=? WHERE id=?').run(next.toISOString().slice(0,10),route.id,iso(),scheduleId);
        result={task_ids:[route.id],schedule:db.prepare('SELECT * FROM route_schedules WHERE id=?').get(scheduleId)};
      } else if (!generate && req.method === 'PATCH') {
        const state=body.state ?? schedule.state, interval=body.interval_days ?? schedule.interval_days;
        if (!['active','paused'].includes(state) || !Number.isInteger(interval) || interval < 1 || interval > 365) throw bad('Choose active or paused and a repeat interval of 1–365 days.');
        db.prepare('UPDATE route_schedules SET state=?,interval_days=?,next_date=?,name=?,version=version+1,updated_at=? WHERE id=?').run(state,interval,date(body.next_date ?? schedule.next_date),text(body.name ?? schedule.name,160),iso(),scheduleId);
        result=db.prepare('SELECT * FROM route_schedules WHERE id=?').get(scheduleId);
      } else throw bad('Unsupported schedule action.');
      recordChange(db,'route_schedules',schedule,result.schedule || result,generate?'generated':'updated');
    } else {
      if (req.method !== 'POST') throw bad('Use POST for route actions.');
      const source=activeRoute(db,taskId); workspaceId=source.workspace_id;
      if (action === 'schedule') {
        if (!Number.isInteger(body.interval_days) || body.interval_days < 1 || body.interval_days > 365) throw bad('Choose a repeat interval of 1–365 days.');
        const id=randomUUID(), stamp=iso();
        db.prepare('INSERT INTO route_schedules(id,workspace_id,source_task_id,name,interval_days,next_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,workspaceId,taskId,text(body.name,160),body.interval_days,date(body.next_date),stamp,stamp);
        result=db.prepare('SELECT * FROM route_schedules WHERE id=?').get(id); recordChange(db,'route_schedules',null,result,'created');
      } else {
        const titles=action === 'split' ? body.titles : [body.title];
        if (!Array.isArray(titles) || titles.length < (action==='split'?2:1) || titles.length > 12) throw bad('Split into 2–12 named routes.');
        result={task_ids:titles.map(title=>cloneRoute(db,source,text(title),action==='split'?taskId:null).id)};
      }
      status=201;
    }
    if (key) db.prepare('INSERT INTO route_tool_requests VALUES(?,?,?,?)').run(key,workspaceId,fingerprint,JSON.stringify(result));
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  send(res,status,{result,bootstrap:snapshot(db)});return true;
}

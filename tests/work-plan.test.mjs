import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { dispatchWorkPlan } from '../server/work-plan.mjs';
import { groupWorkPlan, moveWorkPlan, normalizeWorkPlan, tomorrowPlanDate } from '../src/lib/work-plan.js';
import { parsePage, pageHash } from '../src/lib/navigation.js';

test('planning orders references, retains a real tomorrow date and excludes absent source cards',()=>{
  let p=normalizeWorkPlan(null);
  p=moveWorkPlan(p,{key:'todo:b',lane:'first'});
  p=moveWorkPlan(p,{key:'todo:a',lane:'first',before:'todo:b'});
  const date=tomorrowPlanDate(new Date(2026,10,30,23));
  assert.equal(date,'2026-12-01');
  p=moveWorkPlan(p,{key:'todo:c',lane:'tomorrow',date});
  assert.deepEqual(p.columns.first,[{key:'todo:a'},{key:'todo:b'}]);
  assert.deepEqual(p.columns.tomorrow,[{key:'todo:c',date}]);
  const active=groupWorkPlan(p,[{key:'todo:b',label:'B'},{key:'route:r',label:'R'}]);
  assert.deepEqual(active.first.map(row=>row.label),['B']);
  assert.deepEqual(active.unplanned.map(row=>row.label),['R']);
  assert.equal(active.tomorrow.length,0);
  assert.throws(()=>moveWorkPlan(p,{key:'todo:b',lane:'tomorrow',date:'2026-02-31'}));
});

test('local plans validate active scope, persist separate layouts, and reject stale revisions',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY, archived_at TEXT);
    CREATE TABLE teams(id TEXT PRIMARY KEY, workspace_id TEXT, archived_at TEXT);
    CREATE TABLE local_todos(id TEXT, workspace_id TEXT, team_id TEXT, status TEXT, data TEXT, archived_at TEXT);
    CREATE TABLE tasks(id TEXT, workspace_id TEXT, team_id TEXT, project_id TEXT, status TEXT, archived_at TEXT);
    CREATE TABLE projects(id TEXT, workspace_id TEXT, team_id TEXT, archived_at TEXT);
    INSERT INTO workspaces VALUES ('w',NULL), ('other',NULL);
    INSERT INTO teams VALUES ('area','w',NULL),('safe','other',NULL);
    INSERT INTO local_todos VALUES ('a','w','area','in-progress','{}',NULL),('b','w',NULL,'finished','{}',NULL),
    ('foreign','other',NULL,'in-progress','{}',NULL);
    INSERT INTO projects VALUES ('p','w','area',NULL);
    INSERT INTO tasks VALUES ('r','w',NULL,'p','ready',NULL);
  `);
  const call=(method,input={},teamId=null,actor={id:'local-owner'})=>dispatchWorkPlan(db,{workspaceId:'w',teamId,actor,method,input});
  assert.equal(call('GET').revision,0);
  assert.throws(()=>call('GET',{},'safe'),{statusCode:404});
  assert.throws(()=>call('GET',{},null,{id:'untrusted'}),{statusCode:403});
  assert.throws(()=>call('PATCH',{revision:0,key:'todo:foreign',lane:'first'}),{statusCode:409});
  assert.throws(()=>call('PATCH',{revision:0,key:'todo:b',lane:'first'}),{statusCode:409});
  assert.equal(call('PATCH',{revision:0,key:'todo:a',lane:'first'}).revision,1);
  assert.throws(()=>call('PATCH',{revision:0,key:'todo:a',lane:'later'}),{statusCode:409});
  assert.equal(call('GET',{},'area').revision,0);
  assert.equal(call('PATCH',{revision:0,includeRoutes:true},'area').includeRoutes,true);
  assert.deepEqual(call('PATCH',{revision:1,key:'route:r',lane:'parallel'},'area').columns.parallel,[{key:'route:r'}]);
  assert.deepEqual(call('GET').columns.first,[{key:'todo:a'}]);
  assert.equal(db.prepare("SELECT status FROM local_todos WHERE id='a'").get().status,'in-progress');
});

test('workspace and Area navigation support Work Plan deep links',()=>{
  assert.equal(parsePage(pageHash('work-plan')).view,'work-plan');
  assert.equal(parsePage(pageHash('teams','area',{section:'work-plan'})).section,'work-plan');
});

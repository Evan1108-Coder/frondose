import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createLocalApi } from '../server/local-api.mjs';
import { attentionItems, describePage, normalizeExperience, rememberPage } from '../src/lib/workspace-experience.js';

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(),'rumbo-coordination-'));
  const forbidden = () => { throw Error('Providers prohibited'); };
  const api = createLocalApi({dataDir:dir,integrationOptions:{env:{},execute:forbidden,spawnProcess:forbidden,fetchImpl:forbidden}});
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const call = async (path,body,method=body?'POST':'GET',expected=method==='POST'?201:200) => { const res=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}); const result=await res.json(); assert.equal(res.status,expected,JSON.stringify(result)); return result; };
  try { const workspace=(await call('/workspaces',{name:'Test coordination'})).workspace; await fn({call,workspace,api}); }
  finally { api.close(); await new Promise(r=>server.close(r)); await rm(dir,{recursive:true,force:true}); }
}
test('plans persist with dependencies, version guards, human results and deliberate preparation', async () => fixture(async ({call,workspace,api}) => {
  let plan=(await call('/coordination/plans',{workspace_id:workspace.id,title:'Launch',steps:[{id:'research',name:'Research',depends_on:[]},{id:'review',name:'Review',depends_on:['research']}]})).result;
  await call(`/coordination/plans/${plan.id}/prepare`,{version:plan.version,step_id:'review'},'POST',409);
  const prepared=await call(`/coordination/plans/${plan.id}/prepare`,{version:plan.version,step_id:'research'},'POST',200);
  assert.equal(prepared.result.manual,true); assert.equal(api.snapshot().runs.length,0);
  plan=(await call(`/coordination/plans/${plan.id}/complete`,{version:plan.version,step_id:'research',summary:'Evidence attached; review next.'},'POST',200)).result;
  const next=await call(`/coordination/plans/${plan.id}/prepare`,{version:plan.version,step_id:'review'},'POST',200); assert.match(next.result.defaults.prompt,/Prior handoffs/);
  await call(`/coordination/plans/${plan.id}`,{version:1,title:'Stale'},'PATCH',409);
  plan=(await call(`/coordination/plans/${plan.id}`,{version:plan.version,state:'paused'},'PATCH')).result;
  await call(`/coordination/plans/${plan.id}/prepare`,{version:plan.version,step_id:'review'},'POST',409);
  const exp=await call(`/export?workspace_id=${workspace.id}`); assert.equal(exp.data.work_plans.length,1);
}));
test('plans reject cycles, cross-scope references and revision of completed step history', async () => fixture(async ({call,workspace}) => {
  await call('/coordination/plans',{workspace_id:workspace.id,title:'Cycle',steps:[{id:'a',name:'A',depends_on:['b']},{id:'b',name:'B',depends_on:['a']}]},'POST',400);
  const other=(await call('/workspaces',{name:'Other'})).workspace;
  const project=(await call('/projects',{workspace_id:other.id,name:'Other project'})).project;
  await call('/coordination/plans',{workspace_id:workspace.id,project_id:project.id,title:'Wrong'},'POST',400);
  let plan=(await call('/coordination/plans',{workspace_id:workspace.id,title:'History',steps:[{id:'a',name:'A',depends_on:[]}]})).result;
  plan=(await call(`/coordination/plans/${plan.id}/complete`,{version:plan.version,step_id:'a',summary:'Done'},'POST',200)).result;
  await call(`/coordination/plans/${plan.id}`,{version:plan.version,steps:[{...plan.steps[0],name:'Rewritten'}]},'PATCH',400);
  assert.equal((await call(`/export?workspace_id=${other.id}`)).data.work_plans.length,0);
}));
test('navigation experience normalizes untrusted storage and deduplicates canonical recent pages', () => {
  const p=normalizeExperience({recent:[null,{hash:'javascript:evil',at:1}],snoozed:{x:'tomorrow'},options:{snoozeHours:Infinity,recentLimit:999}});
  assert.deepEqual(p.recent,[]); assert.deepEqual(p.snoozed,{}); assert.equal(p.options.snoozeHours,4);
  const next=rememberPage(rememberPage(p,{view:'workbench',id:'p'},1),{view:'workbench',id:'p'},2);
  assert.equal(next.recent.length,1); assert.equal(next.recent[0].at,2);
  assert.equal(describePage({projects:[{id:'p',name:'Research'}]},{view:'workbench',id:'p'}),'Research');
  assert.equal(describePage({projects:[]},{view:'workbench',id:'p'}),null);
});
test('Home surfaces overdue routes and latest output decisions without duplicating route blockers', () => {
  const data={projects:[],teams:[],runs:[],approvals:[],tasks:[{id:'a',title:'Overdue',due_at:'2020-01-01',status:'ready'},{id:'b',title:'Blocked',due_at:'2020-01-01',status:'blocked'}],outputs:[{id:'o',title:'Research',state:'needs_review'}]};
  const items=attentionItems(data,[],Date.now()); assert.equal(items.filter(i=>i.id==='b').length,1); assert.ok(items.some(i=>i.id==='o'));
});
test('route duplication, splitting and supervised recurrence are atomic and idempotent without execution', async()=>fixture(async({call,workspace,api})=>{
  const task=(await call('/tasks',{workspace_id:workspace.id,title:'Weekly evidence check'})).task;
  await call(`/workflow/routes/${task.id}`,{version:0,acceptance:[{id:'a',text:'Sources checked',done:true}]},'PATCH');
  const body={request_id:'same-copy',title:'New evidence'};
  const copy=(await call(`/route-tools/${task.id}/duplicate`,body)).result;
  const replay=(await call(`/route-tools/${task.id}/duplicate`,body,'POST',200)).result;
  assert.deepEqual(copy,replay); await call(`/route-tools/${task.id}/duplicate`,{...body,title:'Different'},'POST',409);
  assert.equal(api.snapshot().route_workflows.find(w=>w.id===copy.task_ids[0]).acceptance[0].done,false);
  const split=(await call(`/route-tools/${task.id}/split`,{request_id:'split',titles:['Sources','Review']})).result;
  assert.equal(split.task_ids.length,2); assert.equal(api.snapshot().route_workflows.find(w=>w.id===split.task_ids[0]).parent_task_id,task.id);
  const before=api.snapshot().tasks.length;
  await call(`/route-tools/${task.id}/split`,{request_id:'invalid',titles:['Valid','']},'POST',400); assert.equal(api.snapshot().tasks.length,before);
  let schedule=(await call(`/route-tools/${task.id}/schedule`,{request_id:'schedule',name:'Evidence check',interval_days:7,next_date:'2020-01-01'})).result;
  let generated=(await call(`/route-tools/schedules/${schedule.id}/generate`,{request_id:'generate',version:1},'POST',200)).result;
  assert.equal(generated.schedule.next_date,'2020-01-08');
  assert.deepEqual((await call(`/route-tools/schedules/${schedule.id}/generate`,{request_id:'generate',version:1},'POST',200)).result,generated);
  schedule=(await call(`/route-tools/schedules/${schedule.id}`,{version:2,state:'paused'},'PATCH')).result;
  await call(`/route-tools/schedules/${schedule.id}/generate`,{request_id:'paused',version:schedule.version},'POST',409);
  assert.equal(api.snapshot().runs.length,0);
}));
test('extended workspace restore preserves content with remapped references and fails atomically',async()=>fixture(async({call,workspace,api})=>{
  const project=(await call('/projects',{workspace_id:workspace.id,name:'Evidence project'})).project;
  const task=(await call('/tasks',{workspace_id:workspace.id,project_id:project.id,title:'Review research'})).task;
  await call(`/workflow/routes/${task.id}`,{version:0,reviewer_name:'Evan',acceptance:[{id:'a',text:'Sources checked',done:true}]},'PATCH');
  const output=(await call('/workflow/outputs',{workspace_id:workspace.id,task_id:task.id,title:'Research memo',content:'Evidence from primary sources.'})).result;
  const version=api.snapshot().output_versions.find(v=>v.output_id===output.id);
  await call(`/workflow/outputs/${output.id}/comments`,{version_id:version.id,anchor:'Evidence',content:'Clear source distinction'},'POST',200);
  await call(`/workflow/outputs/${output.id}/review`,{version:1,version_id:version.id,reviewer_name:'Evan',decision:'approved'},'POST',200);
  const knowledge=(await call('/workflow/knowledge',{workspace_id:workspace.id,project_id:project.id,title:'Decision',kind:'instruction',content:'Use primary sources',state:'approved'})).result;
  await call('/workflow/context',{workspace_id:workspace.id,project_id:project.id,name:'Evidence rules',sources:[{type:'knowledge_entries',id:knowledge.id}]});
  await call('/coordination/plans',{workspace_id:workspace.id,project_id:project.id,title:'Review plan',steps:[{id:'review',name:'Review',task_id:task.id,depends_on:[]}]});
  await call(`/route-tools/${task.id}/schedule`,{request_id:'restore-schedule',name:'Review evidence',interval_days:7,next_date:'2026-10-01'});
  const archive=await call(`/export?workspace_id=${workspace.id}`);
  const imported=(await call('/import',archive)).result;
  const restored=await call(`/export?workspace_id=${imported.id}`);
  assert.equal(restored.data.outputs.length,1); assert.equal(restored.data.outputs[0].state,'needs_review');
  assert.notEqual(restored.data.outputs[0].id,output.id);assert.equal(restored.data.outputs[0].task_id,restored.data.tasks[0].id);
  assert.equal(restored.data.output_versions[0].output_id,restored.data.outputs[0].id);
  assert.equal(restored.data.output_comments[0].version_id,restored.data.output_versions[0].id);
  assert.equal(restored.data.output_reviews[0].decision,'approved');
  assert.equal(restored.data.knowledge_entries[0].state,'draft');
  assert.equal(restored.data.context_snapshots[0].sources[0].id,restored.data.knowledge_entries[0].id);
  assert.equal(restored.data.work_plans[0].state,'paused');assert.equal(restored.data.route_schedules[0].state,'paused');
  assert.equal(restored.data.route_schedules[0].source_task_id,restored.data.tasks[0].id);
  const count=api.snapshot().workspaces.length; const malformed=structuredClone(archive);malformed.data.output_comments[0].version_id='missing';
  await call('/import',malformed,'POST',400);assert.equal(api.snapshot().workspaces.length,count);assert.equal(api.snapshot().runs.length,0);
}));

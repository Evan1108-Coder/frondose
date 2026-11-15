import {test} from 'node:test';import assert from 'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{randomUUID}from'node:crypto';
import{createLocalAutomationService,nextLocalAutomationDue}from'../server/local-cli-automations.mjs';
const owner={id:'local-owner'};
async function fixture(fn,activityContext=null){const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT);INSERT INTO workspaces VALUES('ws',NULL);INSERT INTO workspaces VALUES('other',NULL);CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,local_path TEXT,archived_at TEXT);INSERT INTO projects VALUES('project','ws','/fixture/project',NULL);");let time=Date.parse('2026-10-30T08:00:00Z'),active=false,version=1,hash='reviewed',launches=[],activity=[],hold=null;const project=db.prepare('SELECT * FROM projects').get(),roots={async rootFor(ws,actor,permission){assert.equal(ws,'ws');assert.equal(actor.id,'local-owner');assert.equal(permission,'workbench.execute');return{root:'/fixture/project',project};}},workbench={async dispatch(p,action,method,body,url,options){assert.equal(p.id,'project');if(action==='route-task-preview'){if(hold)await hold;return {route_id:'route',provider_id:url.searchParams.get('provider_id'),version,snapshot_hash:hash,binding_version:'binding',prompt:'Exact saved task'};}assert.equal(action,'terminals');launches.push({...body,reviewedActivityContext:options?.reviewedActivityContext});return{id:'terminal_'+launches.length};}};let service=createLocalAutomationService({db,roots,workbench,activityContext,recordActivity:event=>activity.push(event),now:()=>time,activeSessionsFor:()=>active?[{id:'owner-terminal'}]:[],intervalMs:0});const call=(action='',input={},method='POST',actor=owner,workspaceId='ws')=>service.dispatch({workspaceId,actor,action,input,method});const body=()=>({title:'Reviewed task',route_id:'route',provider_id:'codex',snapshot_hash:hash,route_version:version,binding_version:'binding',timezone:'UTC',local_time:'2026-10-30T09:00',recurrence:'daily',confirm_recurring:true,request_id:randomUUID()});try{await fn({db,call,body,launches,activity,service,getService:()=>service,setTime:v=>time=Date.parse(v),setActive:v=>active=v,changeRoute:()=>{version++;hash='changed';},hold:v=>hold=v,reopen(){service.close();service=createLocalAutomationService({db,roots,workbench,activityContext,recordActivity:event=>activity.push(event),now:()=>time,activeSessionsFor:()=>active?[{id:'owner-terminal'}]:[],intervalMs:0});return service;}});}finally{service.close();db.close();}}
test('automation creation requires exact recurring consent, local owner, provider, Route and root review',()=>fixture(async({call,body,launches})=>{const input=body();await assert.rejects(call('',{...input,confirm_recurring:false}),/approve/);await assert.rejects(call('',input,'POST',{id:'foreign'}),/local owner/);await assert.rejects(call('',{...input,snapshot_hash:'stale'}),/changed/);await assert.rejects(call('',{...input,provider_id:'shell'}),/Codex/);assert.equal(launches.length,0);const row=await call('',input);assert.equal(row.state,'active');assert.equal((await call('',input)).id,row.id);assert.equal((await call('',{},'GET',owner,'other')).automations.length,0);}));
test('the automation limit blocks a new schedule, not exact retries or reviews of existing schedules',()=>fixture(async({call,body,hold,launches})=>{
  for(let i=0;i<99;i++)await call('',body());
  const last=body();let release;hold(new Promise(resolve=>release=resolve));
  const creating=Promise.all([call('',last),call('',last)]);
  await new Promise(resolve=>setImmediate(resolve));release();
  const [first,retry]=await creating;assert.equal(retry.id,first.id);
  const changed=await call('review',{...body(),id:first.id,version:first.version,title:'Reviewed while full'});
  assert.equal(changed.title,'Reviewed while full');
  await assert.rejects(call('',body()),/already has 100/);
  assert.equal((await call('',{},'GET')).automations.length,100);
  assert.equal(launches.length,0);
}));
test('scheduled dispatch advances its durable receipt before starting one exact CLI and never sends twice',()=>fixture(async({call,body,service,setTime,launches})=>{const row=await call('',body());setTime('2026-10-30T09:00:30Z');await Promise.all([service.tick(),service.tick()]);await service.tick();assert.equal(launches.length,1);assert.equal(launches[0].route_id,'route');assert.equal(launches[0].confirm_paid,true);assert.equal(launches[0].task,undefined);const state=await call('',{},'GET');assert.equal(state.runs[0].status,'dispatched');assert.equal(state.automations[0].next_due,'2026-10-31T09:00:00.000Z');assert.equal(state.automations[0].id,row.id);}));
test('missed runs are skipped, never replayed as a burst after sleep',()=>fixture(async({call,body,service,setTime,launches})=>{await call('',body());setTime('2026-11-02T14:00:00Z');await service.tick();const state=await call('',{},'GET');assert.equal(launches.length,0);assert.equal(state.runs[0].status,'skipped');assert.match(state.runs[0].reason,/Missed/);assert.equal(state.automations[0].next_due,'2026-11-03T09:00:00.000Z');}));
test('active owner terminals are untouched and block scheduled automation overlap',()=>fixture(async({call,body,service,setTime,setActive,launches})=>{await call('',body());setActive(true);setTime('2026-10-30T09:00:00Z');await service.tick();assert.equal(launches.length,0);assert.match((await call('',{},'GET')).runs[0].reason,/Existing work was not stopped/);}));
test('changed Route suspends its old recurring grant without starting any CLI',()=>fixture(async({call,body,service,setTime,changeRoute,launches})=>{await call('',body());changeRoute();setTime('2026-10-30T09:00:00Z');await service.tick();const state=await call('',{},'GET');assert.equal(state.automations[0].state,'paused');assert.match(state.runs[0].reason,/changed/);assert.equal(launches.length,0);}));
test('manual run requires its own paid approval and request receipt prevents duplicate dispatch',()=>fixture(async({call,body,launches})=>{const row=await call('',body()),request={id:row.id,version:row.version,request_id:randomUUID(),confirm_paid:true};await assert.rejects(call('run',{...request,confirm_paid:false}),/approve/);await call('run',request);await call('run',request);assert.equal(launches.length,1);assert.equal((await call('',{},'GET')).automations[0].next_due,row.next_due);}));
test('pausing while preflight awaits cancels a reserved dispatch',()=>fixture(async({call,body,service,setTime,hold,launches})=>{const row=await call('',body());let release;hold(new Promise(resolve=>release=resolve));setTime('2026-10-30T09:00:00Z');const running=service.tick();await new Promise(resolve=>setImmediate(resolve));await call('pause',{id:row.id,version:row.version});release();await running;assert.equal(launches.length,0);assert.match((await call('',{},'GET')).runs[0].reason,/paused or changed/);}));
test('uncertain crash receipts pause definitions and cannot be replayed on startup',()=>fixture(async({call,body,db,reopen})=>{const row=await call('',body());db.prepare("INSERT INTO local_cli_automation_runs(id,automation_id,workspace_id,due_key,status,created_at) VALUES(?,?,?,?,?,?)").run('run',row.id,'ws','due','preparing','2026-10-30');reopen();const state=await call('',{},'GET');assert.equal(state.automations[0].state,'paused');assert.equal(state.runs[0].status,'uncertain');}));
test('weekday and hourly schedules skip missed slots without accumulating a backlog',()=>{assert.equal(nextLocalAutomationDue('2026-10-30T09:00:00Z','weekdays','UTC'),'2026-11-02T09:00:00.000Z');assert.equal(nextLocalAutomationDue('2026-10-30T09:00:00Z','hourly','UTC','2026-10-31T12:30:00Z'),'2026-10-31T13:00:00.000Z');});

test('resume checks the exact reviewed schedule and skips dates that passed while paused',()=>fixture(async({call,body,setTime,changeRoute,launches})=>{
  const row=await call('',body()),paused=await call('pause',{id:row.id,version:row.version});
  assert.equal(paused.can_resume,true);
  setTime('2026-10-31T12:00:00Z');
  await assert.rejects(call('resume',{id:row.id,version:row.version}),/Refresh/);
  const resumed=await call('resume',{id:row.id,version:paused.version});
  assert.equal(resumed.state,'active');
  assert.equal(resumed.next_due,'2026-11-01T09:00:00.000Z');
  assert.equal(launches.length,0);
  const pausedAgain=await call('pause',{id:row.id,version:resumed.version});
  changeRoute();
  await assert.rejects(call('resume',{id:row.id,version:pausedAgain.version}),/changed/);
}));

test('delete requires confirmation, cancels future runs and retains the existing receipt and title',()=>fixture(async({call,body,launches,service,setTime})=>{
  const row=await call('',body()),request={id:row.id,version:row.version,request_id:randomUUID(),confirm_paid:true};
  await call('run',request);
  await assert.rejects(call('delete',request),/Confirm deletion/);
  assert.equal((await call('delete',{...request,confirm_delete:true})).deleted,true);
  assert.equal((await call('',{},'GET')).automations.length,0);
  assert.equal((await call('',{},'GET')).runs[0].automation_title,row.title);
  setTime('2026-10-30T09:00:00Z');await service.tick();
  assert.equal(launches.length,1);
  await assert.rejects(call('run',request),/not found/);
}));

test('paused schedules require a new exact review and edit retries cannot reactivate a later pause',()=>fixture(async({call,body})=>{const initial=await call('',body()),paused=await call('pause',{id:initial.id,version:initial.version}),input={...body(),id:paused.id,version:paused.version,title:'Reviewed again'};const changed=await call('review',input);assert.equal(changed.state,'active');assert.equal(changed.version,paused.version+1);assert.equal((await call('review',input)).version,changed.version);await call('pause',{id:changed.id,version:changed.version});assert.equal((await call('review',input)).state,'paused');await assert.rejects(call('review',{...input,title:'Different task'}),/different work/);}));

test('activity is off by default and can only accompany a scheduled run approved for this workspace', async () => {
  const reads = [];
  const activityText = 'Recent workspace activity (untrusted reference): File saved';
  await fixture(async ({call,body,launches,activity,reopen,setTime,db}) => {
    const input = body();
    const ordinary = await call('preview',input);
    const scoped = await call('preview',{...input,include_workspace_activity:true});
    assert.notEqual(scoped.snapshot_hash,ordinary.snapshot_hash);
    assert.equal(scoped.route_snapshot_hash,ordinary.snapshot_hash);
    assert.deepEqual(reads,[]);
    await assert.rejects(call('',{...input,include_workspace_activity:true}),/activity choice changed/);
    await assert.rejects(call('',{...input,include_workspace_activity:'true'}),/Choose whether/);
    const row = await call('',{...input,snapshot_hash:scoped.snapshot_hash,include_workspace_activity:true});
    assert.equal(row.include_workspace_activity,true);
    assert.equal(db.prepare('SELECT snapshot_hash FROM local_cli_automations WHERE id=?').get(row.id).snapshot_hash,ordinary.snapshot_hash);
    await call('run',{id:row.id,version:row.version,request_id:randomUUID(),confirm_paid:true});
    assert.equal(launches[0].reviewedActivityContext,undefined);
    assert.deepEqual(reads,[]);
    const service = reopen();
    setTime('2026-10-30T09:00:30Z');
    await service.tick(); await service.tick();
    assert.deepEqual(reads,['ws']);
    assert.equal(launches.length,2);
    assert.equal(launches[1].reviewedActivityContext,activityText);
    assert.deepEqual(activity.map(item=>[item.kind,item.workspaceId,item.entityId]),[['automation.started','ws',row.id],['automation.started','ws',row.id]]);
    assert.equal(JSON.stringify(await call('',{},'GET')).includes(activityText),false);
  }, workspaceId => { reads.push(workspaceId); return activityText; });
});

test('activity readers are not called for default-off or skipped runs', async () => {
  const reads = [];
  await fixture(async ({call,body,launches,service,setTime,setActive}) => {
    assert.equal((await call('',body())).include_workspace_activity,false);
    const input = {...body(),include_workspace_activity:true};
    const {snapshot_hash}=await call('preview',input);
    await call('',{...input,snapshot_hash});
    setActive(true); setTime('2026-10-30T09:00:00Z'); await service.tick();
    assert.deepEqual(reads,[]);
    setActive(false); setTime('2026-10-31T09:10:00Z'); await service.tick();
    assert.deepEqual(reads,[]);
    setTime('2026-11-01T09:00:00Z'); await service.tick();
    assert.equal(launches.length,2);
    assert.deepEqual(reads,['ws']);
    assert.ok(launches.every(run=>run.reviewedActivityContext===undefined));
  }, workspaceId=>{reads.push(workspaceId);return '';});
});

test('invalid activity fails closed without copying raw reader errors to receipts', async () => {
  await fixture(async ({call,body,launches,activity,service,setTime}) => {
    const input={...body(),include_workspace_activity:true};
    const {snapshot_hash}=await call('preview',input);
    await call('',{...input,snapshot_hash});
    setTime('2026-10-30T09:00:30Z'); await service.tick();
    const result = await call('',{},'GET');
    assert.equal(launches.length,0);
    assert.equal(activity.length,0);
    assert.equal(result.automations[0].state,'paused');
    assert.equal(result.runs[0].status,'skipped');
    assert.match(result.runs[0].reason,/activity was unavailable/);
    assert.doesNotMatch(JSON.stringify(result),/sensitive reader error/);
  }, ()=>{throw Error('sensitive reader error');});
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { createLocalAutomationService } from '../server/local-cli-automations.mjs';
import { createWorkspaceAgentChat } from '../server/workspace-agent-chat.mjs';

const owner={id:'local-owner'}, workspaceId='work', projectId='project', bindingVersion='bound';
function fakeCodex(state) {
  return (command,args,options)=>{
    const child=new EventEmitter(), output=new PassThrough(), stderr=new PassThrough();
    let threadId, turnId, pendingResponse;
    const wire=message=>queueMicrotask(()=>{if(!child.closed)output.write(JSON.stringify(message)+'\n');});
    const complete=()=>{wire({method:'item/completed',params:{threadId,item:{id:'answer',type:'agentMessage',text:'Fixture answer'}}});wire({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});};
    child.stdout=output;child.stderr=stderr;child.kill=()=>{if(!child.closed){child.closed=true;queueMicrotask(()=>child.emit('close',0));}};
    child.stdin=new Writable({write(chunk,_encoding,done){
      const message=JSON.parse(String(chunk));state.requests.push(message); const result=payload=>wire({id:message.id,result:payload});
      if(message.method==='initialize')result({});
      const identity=()=>({thread:{id:threadId},cwd:message.params.cwd,approvalPolicy:message.params.approvalPolicy,activePermissionProfile:state.badPolicy?null:{id:message.params.permissions}});
      if(message.method==='thread/start'){threadId=state.newSessionId;result(identity());}
      if(message.method==='thread/resume'){
        if(state.missing){wire({id:message.id,error:{message:'Missing session'}});done();return;}
        threadId=state.replacementId||message.params.threadId;result(identity());
      }
      if(message.method==='turn/start'){
        turnId=randomUUID();result({turn:{id:turnId,status:'inProgress'}});
        if(state.hold){state.complete=complete;}
        else {pendingResponse=700;wire({method:'item/fileChange/requestApproval',id:pendingResponse,params:{threadId,turnId}});}
      }
      if(message.id===pendingResponse&&!message.method&&pendingResponse){state.approvals.push(message.result);complete();}
      done();
    }});
    state.launches.push({command,args,options});return child;
  };
}
const waitFor=async assertion=>{for(let n=0;n<80;n++){try{return assertion();}catch(error){if(n===79)throw error;await new Promise(resolve=>setImmediate(resolve));}}};
async function fixture(fn) {
  const db=new DatabaseSync(':memory:');
  const now0=Date.parse('2026-10-30T08:00:00Z');let now=now0, workspaceBusy=false;
  const root='/fixture/project', project={id:projectId,workspace_id:workspaceId}, context={root,project,row:{project_id:projectId,version:bindingVersion}};
  const roots={async get(){return context;},async rootFor(){return context;}};
  const state={newSessionId:randomUUID(),requests:[],launches:[],approvals:[],events:[]};
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT); INSERT INTO workspaces VALUES ('work',NULL),('other',NULL);CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,archived_at TEXT);INSERT INTO projects VALUES('project','work',NULL);");
  const chat=createWorkspaceAgentChat({db,roots,platform:'linux',env:{},plan:async()=>({command:'/fixture/bin/codex',env:{}}),spawnProcess:fakeCodex(state),discover:async()=>[]});
  const automation=createLocalAutomationService({db,roots,activityContext:()=>'',recordActivity:event=>state.events.push(event),getStructuredSessionService:()=>chat,activeSessionsFor:()=>workspaceBusy?[{id:'busy'}]:chat.activeSessionsFor('workspaces',workspaceId),now:()=>now,intervalMs:0,workbench:{async dispatch(p,action,_method,_body,url){
    assert.equal(action,'route-task-preview','Managed modes must never start an ordinary terminal');
    return {route_id:'route',provider_id:url.searchParams.get('provider_id'),binding_version:bindingVersion,prompt:'Exact saved Route',version:1,snapshot_hash:'approved-route'};
  }}});
  const request=(action,input,method='POST',actor=owner,ws=workspaceId)=>automation.dispatch({workspaceId:ws,actor,action,method,input});
  const input=()=>({title:'Scheduled reading',route_id:'route',provider_id:'codex',binding_version:bindingVersion,route_version:1,timezone:'UTC',local_time:'2026-10-30T09:00',recurrence:'daily',confirm_recurring:true,request_id:randomUUID()});
  const schedule=async fields=>{const body={...input(),...fields}; const preview=await request('preview',body); return request('',{...body,snapshot_hash:preview.snapshot_hash});};
  function addExisting({id=randomUUID(),sessionId=randomUUID(),workspace=workspaceId,project=projectId,version=bindingVersion,provider='codex',state='completed'}={}) {
    db.prepare('INSERT INTO local_agent_conversations(id,workspace_id,project_id,root_version,provider,title,native_session_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,workspace,project,version,provider,'Saved discussion',sessionId,'then','then');
    db.prepare('INSERT INTO local_agent_turns(id,conversation_id,request_id,prompt,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),id,randomUUID(),'Original prompt',state,'then','then');
    return {id,sessionId};
  }
  try {await fn({db,chat,automation,state,request,input,schedule,addExisting,setTime:value=>{now=Date.parse(value);},setBusy:v=>workspaceBusy=v});}
  finally{automation.close();chat.close();await new Promise(resolve=>setImmediate(resolve));db.close();}
}

test('dedicated scheduled conversation sends a scoped read-only task and resumes the exact provider UUID next time',()=>fixture(async ({db,chat,automation,state,schedule,request,setTime})=>{
  const row=await schedule({session_mode:'dedicated'});
  await assert.rejects(request('run',{id:row.id,version:row.version,confirm_paid:true,request_id:randomUUID()}),/scheduled runs only/);
  setTime('2026-10-30T09:00:00Z');await automation.tick();
  await waitFor(()=>assert.equal(db.prepare('SELECT status FROM local_cli_automation_runs').get().status,'completed'));
  const managed=db.prepare('SELECT conversation_id FROM local_automation_chat_sessions').get().conversation_id;
  await assert.rejects(chat.dispatch({workspaceId,actor:owner,action:'send',method:'POST',input:{id:managed,expected_binding_version:bindingVersion,confirmed:true,prompt:'Unexpected manual task',request_id:randomUUID()}}),/managed/);
  setTime('2026-10-31T09:00:00Z');await automation.tick();
  await waitFor(()=>assert.equal(db.prepare("SELECT count(*) n FROM local_cli_automation_runs WHERE status='completed' AND conversation_id=?").get(managed).n,2));
  assert.equal(state.requests.filter(row=>row.method==='thread/start').length,1);
  assert.equal(state.requests.find(row=>row.method==='thread/resume').params.threadId,state.newSessionId);
  assert.ok(state.launches.every(row=>row.args.includes('features.shell_tool=false')&&row.args.includes('features.hooks=false')&&row.options.shell===false));
  assert.ok(state.requests.filter(row=>['thread/start','thread/resume'].includes(row.method)).every(row=>row.params.approvalPolicy==='never'&&!row.params.dynamicTools));
  const firstTurn=state.requests.find(row=>row.method==='turn/start').params;
  assert.match(firstTurn.permissions,/^frondose-automation-/);
  assert.deepEqual(firstTurn.environments,[]);
  assert.ok(state.launches[0].args.includes(`permissions.${firstTurn.permissions}.filesystem={":root"="deny",":minimal"="read","/fixture/project"="read"}`));
  assert.ok(state.launches[0].args.includes(`permissions.${firstTurn.permissions}.network={enabled=false}`));
  assert.ok(state.requests.filter(row=>row.method==='turn/start').every(row=>row.params.input[0].text==='Exact saved Route'));
  assert.deepEqual(state.approvals,[{decision:'decline'},{decision:'decline'}]);
  assert.deepEqual(state.events.map(event=>event.kind),['automation.started','automation.finished','automation.started','automation.finished']);
}));

test('existing target review excludes foreign, stale, Claude and unconfirmed sessions and binds exact native identity',()=>fixture(async ({db,state,automation,request,input,addExisting,setTime})=>{
  const target=addExisting();
  addExisting({workspace:'other'});addExisting({version:'stale'});addExisting({provider:'claude'});addExisting({state:'interrupted'});addExisting({state:'running'});
  assert.deepEqual(await request('session-targets',{},'GET'),{targets:[{id:target.id,title:'Saved discussion'}]});
  await assert.rejects(request('session-targets',{},'GET',{id:'foreign'}),/local owner/);
  const saved={...input(),session_mode:'existing',target_conversation_id:target.id};
  const review=await request('preview',saved);
  await assert.rejects(request('',{...saved,session_mode:'fresh',target_conversation_id:null,snapshot_hash:review.snapshot_hash}),/changed/);
  await request('',{...saved,snapshot_hash:review.snapshot_hash});
  setTime('2026-10-30T09:00:00Z');await automation.tick();
  await waitFor(()=>assert.equal(db.prepare('SELECT status FROM local_cli_automation_runs').get().status,'completed'));
  assert.equal(state.requests.find(row=>row.method==='thread/resume').params.threadId,target.sessionId);
  assert.ok(!state.requests.some(row=>row.method==='thread/start'));
}));

for(const replacement of [true,false])test(`unavailable or changed managed session never starts a replacement (${replacement})`,()=>fixture(async ({db,automation,state,schedule,addExisting,setTime})=>{
  const target=addExisting();
  const row=await schedule({session_mode:'existing',target_conversation_id:target.id});
  if(replacement)state.replacementId=randomUUID();else state.missing=true;
  setTime('2026-10-30T09:00:00Z');await automation.tick();
  await waitFor(()=>assert.equal(db.prepare('SELECT status FROM local_cli_automation_runs').get().status,'uncertain'));
  await automation.tick();
  assert.equal(db.prepare('SELECT state FROM local_cli_automations WHERE id=?').get(row.id).state,'paused');
  assert.equal(state.launches.length,1);
  assert.ok(!state.requests.some(row=>row.method==='thread/start'||row.method==='turn/start'));
  assert.equal(db.prepare('SELECT native_session_id FROM local_agent_conversations WHERE id=?').get(target.id).native_session_id,target.sessionId);
}));

test('old or incompatible provider which cannot confirm the active permission profile never receives the task',()=>fixture(async ({db,automation,state,schedule,setTime})=>{
  await schedule({session_mode:'dedicated'});state.badPolicy=true;
  setTime('2026-10-30T09:00:00Z');await automation.tick();
  await waitFor(()=>assert.equal(db.prepare('SELECT status FROM local_cli_automation_runs').get().status,'uncertain'));
  assert.ok(!state.requests.some(row=>row.method==='turn/start'));
  assert.deepEqual(state.events,[]);
}));

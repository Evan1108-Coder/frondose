import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { randomBytes, createCipheriv } from 'node:crypto';
import { createLocalApi } from './fixtures/legacy-account-api.mjs';
import { captureAgentActions } from '../server/agent-awareness.mjs';

async function fixture(t,options={}) {
  const directory=await mkdtemp(join(tmpdir(),'rumbo-scheduled-api-'));
  let clock='2026-10-08T12:00:00.000Z', providerError=false;
  const prompts=[];
  const api=createLocalApi({dataDir:directory,scheduledWorkOptions:{now:()=>new Date(clock),scheduleIntervalMs:options.scheduleIntervalMs || 3600000},integrationOptions:{env:{},fetchImpl:()=>{throw Error('External network forbidden');},execute:async(_executable,args)=>({code:0,stdout:args.includes('mcp') ? '[]' : 'Logged in'}),spawnProcess:()=>{
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>{};
    child.stdin.end=prompt=>{prompts.push(prompt);queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(`${JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Fixture reply'}})}\n`));child.emit('close',providerError ? 1 : 0);});};return child;
  },...options.integrationOptions}});
  const db=new DatabaseSync(api.dbPath),server=createServer(api.middleware);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{api.close();await new Promise(resolve=>server.close(resolve));db.close();await rm(directory,{recursive:true,force:true});});
  const request=async(path,body,method=body === undefined ? 'GET' : 'POST',cookie)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body === undefined ? undefined : JSON.stringify(body)});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  const call=async(path,body,method,cookie)=>{const response=await request(path,body,method,cookie);assert.ok(response.status>=200 && response.status<300,`${path}: ${JSON.stringify(response.body)}`);return response.body;};
  const workspace=(await call('/workspaces',{name:'Scheduled fixture'})).workspace;
  const project=(await call('/projects',{workspace_id:workspace.id,name:'Project'})).project;
  const agent=(await call('/agents',{workspace_id:workspace.id,name:'Fixture agent',provider:'codex'})).agent;
  const chat=(await call('/chats',{workspace_id:workspace.id,project_id:project.id,title:'Scheduled chat'})).chat;
  const scheduleBody=(payload,extra={})=>({workspace_id:workspace.id,kind:'message',payload,local_time:'2026-10-08T12:01',timezone:'UTC',recurrence:'none',request_id:'schedule_fixture_1',...extra});
  const inspect=async(content,extra={})=>(await call('/context/inspect',{workspace_id:workspace.id,chat_id:chat.id,agent_id:agent.id,prompt:content,work_mode:'conversation',include_chat:false,include_memory:false,include_workspace:false,...extra})).result;
  const waitTerminal=async()=>{for(let i=0;i<80;i++){const run=db.prepare('SELECT * FROM runs WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1').get(workspace.id);if(run && ['completed','failed'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,10));}throw Error(`Injected run did not finish: ${JSON.stringify(db.prepare('SELECT status,error_json FROM scheduled_work_occurrences').all())}`);};
  return {api,db,request,call,workspace,project,agent,chat,prompts,scheduleBody,inspect,waitTerminal,time:value=>{clock=value;},failProvider:()=>{providerError=true;}};
}

test('retired Playbooks endpoints return 410 without running or deleting historical work',async t=>{
  const f=await fixture(t);
  for(const [path,body,method] of [['/playbooks',undefined,'GET'],['/playbooks/catalog',undefined,'GET'],['/playbooks',{workspace_id:f.workspace.id},'POST'],['/playbooks/old/run',{idempotency_key:'never_run'},'POST']]) {
    const result=await f.request(path,body,method);assert.equal(result.status,410,JSON.stringify(result.body));assert.equal(result.body.error.code,'feature_retired');
  }
  assert.equal(f.prompts.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(f.workspace.id).n,0);
});

test('scheduled local note sends exactly once with attachments, history and activity but no provider',async t=>{
  const f=await fixture(t),payload={chat_id:f.chat.id,agent_id:null,content:'A real local note',attachments:[{name:'notes.txt',content:'Attached text',type:'text/plain'}]};
  const schedule=(await f.call('/scheduled-work',f.scheduleBody(payload))).result;
  assert.equal(f.db.prepare('SELECT count(*) n FROM messages WHERE chat_id=?').get(f.chat.id).n,0);
  f.time('2026-10-08T12:01:00.000Z');await f.api.dispatchScheduledWork();await f.api.dispatchScheduledWork();
  const messages=f.db.prepare('SELECT * FROM messages WHERE chat_id=?').all(f.chat.id);assert.equal(messages.length,1);assert.equal(messages[0].content,payload.content);
  assert.equal(JSON.parse(messages[0].metadata_json).scheduled_work_id,schedule.id);assert.deepEqual(JSON.parse(messages[0].attachments_json),payload.attachments);assert.equal(f.prompts.length,0);
  const history=(await f.call(`/scheduled-work/${schedule.id}`)).result.history;assert.equal(history.length,1);assert.equal(history[0].status,'completed');
  assert.ok(f.db.prepare('SELECT * FROM change_log WHERE workspace_id=?').all(f.workspace.id).some(row=>row.action.startsWith('completed scheduled message')));
});

test('server timer delivers due work without page views and missed work is not delivered',async t=>{
  const f=await fixture(t,{scheduleIntervalMs:20}),payload={chat_id:f.chat.id,content:'Timer delivery'};
  await f.call('/scheduled-work',f.scheduleBody(payload));f.time('2026-10-08T12:01:00.000Z');
  for(let i=0;i<30 && !f.db.prepare('SELECT 1 FROM messages WHERE chat_id=?').get(f.chat.id);i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.db.prepare('SELECT count(*) n FROM messages WHERE chat_id=?').get(f.chat.id).n,1);
  const missed=(await f.call('/scheduled-work',f.scheduleBody({chat_id:f.chat.id,content:'Must miss'},{request_id:'missed_fixture_1',local_time:'2026-10-08T12:02'}))).result;
  f.time('2026-10-08T12:04:01.000Z');await f.api.dispatchScheduledWork();assert.equal((await f.call(`/scheduled-work/${missed.id}`)).result.history[0].status,'missed');assert.equal(f.db.prepare('SELECT count(*) n FROM messages WHERE chat_id=?').get(f.chat.id).n,1);
});

test('AI schedule preserves reviewed text, omits future edits, reserves inspection and runs once',async t=>{
  const f=await fixture(t);await f.call('/connections/codex/connect',{method:'existing'});
  const doc=(await f.call('/documents',{workspace_id:f.workspace.id,project_id:f.project.id,title:'Evidence',content:'ORIGINAL_REVIEWED_DOCUMENT_TEXT'})).document;
  const pack=(await f.call('/workspace-items',{workspace_id:f.workspace.id,kind:'context_pack',name:'Exact evidence',payload:{description:'',content:'',document_ids:[doc.id],memory_ids:[]}})).result;
  const preview=await f.inspect('Review this evidence',{context_pack_ids:[pack.id]});assert.match(preview.finalPrompt,/ORIGINAL_REVIEWED_DOCUMENT_TEXT/);
  const body=f.scheduleBody({chat_id:f.chat.id,agent_id:f.agent.id,content:'Review this evidence',attachments:[]},{context_inspection_id:preview.id});
  const schedule=(await f.call('/scheduled-work',body)).result;assert.equal(f.prompts.length,0);
  assert.equal((await f.call('/scheduled-work',body)).result.id,schedule.id);
  assert.equal((await f.request('/scheduled-work',{...body,request_id:'second_same_context'})).status,409);
  await f.call(`/documents/${doc.id}`,{content:'FUTURE_UNREVIEWED_EDIT'},'PATCH');
  f.time('2026-10-08T12:01:00.000Z');await f.api.dispatchScheduledWork();const run=await f.waitTerminal();await f.api.dispatchScheduledWork();
  assert.equal(run.status,'completed');assert.equal(f.prompts.length,1);assert.match(f.prompts[0],/ORIGINAL_REVIEWED_DOCUMENT_TEXT/);assert.ok(!f.prompts[0].includes('FUTURE_UNREVIEWED_EDIT'));
  const history=(await f.call(`/scheduled-work/${schedule.id}`)).result.history;assert.equal(history[0].status,'completed');assert.equal(history[0].result.run_id,run.id);
  assert.equal(f.db.prepare('SELECT count(*) n FROM chat_turns WHERE chat_id=?').get(f.chat.id).n,1);
});

test('AI profile/model changes fail closed at due time and provider errors remain failed without retries',async t=>{
  const f=await fixture(t);await f.call('/connections/codex/connect',{method:'existing'});
  const preview=await f.inspect('Pinned model selection'),schedule=(await f.call('/scheduled-work',f.scheduleBody({chat_id:f.chat.id,agent_id:f.agent.id,content:'Pinned model selection',attachments:[]},{context_inspection_id:preview.id}))).result;
  await f.call(`/agents/${f.agent.id}`,{instructions:'Changed profile'},'PATCH');f.time('2026-10-08T12:01:00.000Z');await f.api.dispatchScheduledWork();
  assert.equal(f.prompts.length,0);assert.equal((await f.call(`/scheduled-work/${schedule.id}`)).result.history[0].status,'failed');
  const fresh=await f.inspect('Provider fails');const failing=(await f.call('/scheduled-work',f.scheduleBody({chat_id:f.chat.id,agent_id:f.agent.id,content:'Provider fails',attachments:[]},{request_id:'failing_provider_schedule',local_time:'2026-10-08T12:02',context_inspection_id:fresh.id}))).result;
  f.failProvider();f.time('2026-10-08T12:02:00.000Z');await f.api.dispatchScheduledWork();await f.waitTerminal();await f.api.dispatchScheduledWork();await f.api.dispatchScheduledWork();
  assert.equal(f.prompts.length,1);assert.equal((await f.call(`/scheduled-work/${failing.id}`)).result.history[0].status,'failed');
});

test('scheduled reviewed actions are claimed once, stale changes fail, and cancellation restores human review',async t=>{
  const f=await fixture(t);await f.call('/connections/codex/connect',{method:'existing'});
  await f.call(`/chats/${f.chat.id}/turns`,{agent_id:f.agent.id,content:'Prepare a proposal',client_turn_id:'action_fixture_turn',work_mode:'conversation'});
  const run=await f.waitTerminal(),proposal={type:'record.update',resource:'projects',id:f.project.id,patch:{goal:'Approved scheduled goal'}};
  captureAgentActions(f.db,run.id,`\`\`\`rumbo-actions\n${JSON.stringify({nonce:'fixture',actions:[proposal]})}\n\`\`\``,'fixture');
  const action=f.db.prepare('SELECT * FROM agent_action_requests WHERE run_id=?').get(run.id);
  const body=f.scheduleBody({action_request_id:action.id},{kind:'action'}),first=(await f.call('/scheduled-work',body)).result;
  assert.equal(f.db.prepare('SELECT status FROM agent_action_requests WHERE id=?').get(action.id).status,'scheduled');
  await f.call(`/scheduled-work/${first.id}`,{version:first.version,state:'cancelled'},'PATCH');assert.equal(f.db.prepare('SELECT status FROM agent_action_requests WHERE id=?').get(action.id).status,'pending');
  const schedule=(await f.call('/scheduled-work',{...body,request_id:'action_fixture_second'})).result;
  await f.call(`/projects/${f.project.id}`,{goal:'Changed before due'},'PATCH');f.time('2026-10-08T12:01:00.000Z');await f.api.dispatchScheduledWork();await f.api.dispatchScheduledWork();
  assert.equal(f.db.prepare('SELECT goal FROM projects WHERE id=?').get(f.project.id).goal,'Changed before due');
  assert.equal((await f.call(`/scheduled-work/${schedule.id}`)).result.history[0].status,'failed');assert.equal(f.db.prepare('SELECT status FROM agent_action_requests WHERE id=?').get(action.id).status,'pending');
});

test('scheduled action creates its exact reviewed Route once with human attribution',async t=>{
  const f=await fixture(t);await f.call('/connections/codex/connect',{method:'existing'});
  await f.call(`/chats/${f.chat.id}/turns`,{agent_id:f.agent.id,content:'Prepare one Route',client_turn_id:'successful_action_fixture',work_mode:'conversation'});const run=await f.waitTerminal();
  const proposal={type:'record.create',resource:'tasks',fields:{title:'Exactly reviewed Route',project_id:f.project.id,priority:'high'}};
  captureAgentActions(f.db,run.id,`\`\`\`rumbo-actions\n${JSON.stringify({nonce:'fixture',actions:[proposal]})}\n\`\`\``,'fixture');const action=f.db.prepare('SELECT * FROM agent_action_requests WHERE run_id=?').get(run.id);
  const schedule=(await f.call('/scheduled-work',f.scheduleBody({action_request_id:action.id},{kind:'action'}))).result;
  assert.equal((await f.request('/scheduled-work',f.scheduleBody({action_request_id:action.id},{kind:'action',request_id:'cannot_double_schedule'}))).status,400);
  f.time('2026-10-08T12:01:00.000Z');await f.api.dispatchScheduledWork();await f.api.dispatchScheduledWork();
  const routes=f.db.prepare('SELECT * FROM tasks WHERE workspace_id=?').all(f.workspace.id);assert.equal(routes.length,1);assert.equal(routes[0].title,proposal.fields.title);assert.equal(routes[0].priority,'high');
  const history=(await f.call(`/scheduled-work/${schedule.id}`)).result.history;assert.equal(history.length,1);assert.equal(history[0].status,'completed');assert.equal(history[0].result.reviewed_by,'local-owner');
  assert.equal(f.db.prepare('SELECT status FROM agent_action_requests WHERE id=?').get(action.id).status,'applied');
  assert.equal(f.db.prepare('SELECT actor_id FROM change_attribution WHERE change_id=(SELECT id FROM change_log WHERE entity_id=? AND action=?)').get(routes[0].id,'agent-approved create').actor_id,'local-owner');
});

async function signedMember(f) {
  const member=(await f.call('/governance',{workspace_id:f.workspace.id,action:'create_member',name:'Scheduler',email:'scheduler-fixture@example.com',rank:'Manager'})).result;
  const owner=await f.request('/identity/setup',{name:'Owner',email:'owner-schedule-fixture@example.com',password:'fixture owner password 123'});assert.equal(owner.status,200);
  const invitation=(await f.call('/identity/invite',{workspace_id:f.workspace.id,member_id:member.id},'POST',owner.cookie)).result;
  const signed=await f.request('/identity/accept',{token:invitation.invitation_token,password:'fixture member password 123'});assert.equal(signed.status,200);
  return {member,cookie:signed.cookie,ownerCookie:owner.cookie};
}

async function proposedAction(f,proposal,{cookie,content='Prepare a schedule change'}={}) {
  const response=await f.call(`/chats/${f.chat.id}/turns`,{agent_id:f.agent.id,content,client_turn_id:`proposal_${crypto.randomUUID()}`,work_mode:'conversation'},'POST',cookie);
  for(let i=0;i<80;i++){const run=f.db.prepare('SELECT * FROM runs WHERE id=?').get(response.run.id);if(run?.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,10));}
  const run=f.db.prepare('SELECT * FROM runs WHERE id=?').get(response.run.id);assert.equal(run.status,'completed');
  captureAgentActions(f.db,run.id,`\`\`\`frondose-actions\n${JSON.stringify({nonce:'schedule_fixture',actions:[proposal]})}\n\`\`\``,'schedule_fixture');
  return f.db.prepare('SELECT * FROM agent_action_requests WHERE run_id=?').get(run.id);
}

test('conversational daily/weekly intents require fresh exact review and preserve explicit recurrence',async t=>{
  const f=await fixture(t);await f.call('/connections/codex/connect',{method:'existing'});
  for (const recurrence of ['daily','weekly']) {
    const content=`Exact ${recurrence} check-in`,proposal={type:'schedule.create',chat_id:f.chat.id,content,model:'fixture-model',run_at:'2026-10-08T12:01:00.000Z',timezone:'UTC',recurrence};
    const action=await proposedAction(f,proposal),prepared=(await f.call(`/agent-actions/${action.id}/prepare-schedule`,{workspace_id:f.workspace.id})).result;
    assert.equal(prepared.recurrence,recurrence);assert.equal(f.db.prepare('SELECT count(*) n FROM scheduled_work').get().n,recurrence==='daily'?0:1);
    assert.equal((await f.request(`/agent-actions/${action.id}/decision`,{decision:'approve'})).status,400);
    const preview=await f.inspect(content,{model:proposal.model}),body=f.scheduleBody({action_request_id:action.id,chat_id:f.chat.id,agent_id:f.agent.id,content,model:proposal.model,attachments:[]},{request_id:`intent_schedule_${action.id}`,context_inspection_id:preview.id,recurrence});
    assert.equal((await f.request('/scheduled-work',{...body,recurrence:'none'})).status,400);
    const created=(await f.call('/scheduled-work',body)).result;
    assert.equal(created.recurrence,recurrence);assert.equal(f.db.prepare('SELECT status FROM agent_action_requests WHERE id=?').get(action.id).status,'scheduled');
    assert.equal((await f.call('/scheduled-work',body)).result.id,created.id);
  }
  assert.equal(f.prompts.length,2,'only the two explicit source turns ran; proposing or saving never launches');
  f.time('2026-10-08T12:01:00.000Z');await f.api.dispatchScheduledWork();await f.waitTerminal();await f.api.dispatchScheduledWork();
  assert.equal(f.prompts.length,4);const jobs=(await f.call(`/scheduled-work?workspace_id=${f.workspace.id}`)).result;
  assert.equal(jobs.find(item=>item.recurrence==='daily').next_due_at,'2026-10-09T12:01:00.000Z');assert.equal(jobs.find(item=>item.recurrence==='weekly').next_due_at,'2026-10-15T12:01:00.000Z');
});

test('conversational pause, exact-instant reschedule and cancel stay pending until owner confirmation',async t=>{
  const f=await fixture(t);await f.call('/connections/codex/connect',{method:'existing'});
  const schedule=(await f.call('/scheduled-work',f.scheduleBody({chat_id:f.chat.id,content:'Owned note'},{recurrence:'daily'}))).result;
  let version=schedule.version;
  for(const change of [{state:'paused'},{state:'active',run_at:'2026-10-08T12:05:00.000Z',timezone:'UTC'},{state:'cancelled'}]) {
    const action=await proposedAction(f,{type:'schedule.update',schedule_id:schedule.id,version,...change});
    assert.equal(action.status,'pending');assert.equal(f.db.prepare('SELECT version FROM scheduled_work WHERE id=?').get(schedule.id).version,version);
    const delayed=await f.request('/scheduled-work',f.scheduleBody({action_request_id:action.id},{kind:'action',request_id:`no_nested_${action.id}`}));assert.equal(delayed.status,400);
    const beforePrompts=f.prompts.length,confirmed=await f.call(`/agent-actions/${action.id}/decision`,{decision:'approve'});
    assert.equal(confirmed.status,'applied');assert.equal(f.prompts.length,beforePrompts,'management never contacts a provider');
    const current=(await f.call(`/scheduled-work/${schedule.id}`)).result;
    assert.equal(current.state,change.state);assert.equal(current.version,++version);
    if(change.run_at) assert.equal(current.next_due_at,change.run_at);
    assert.equal((await f.request(`/agent-actions/${action.id}/decision`,{decision:'approve'})).status,400);
    assert.equal(f.db.prepare('SELECT version FROM scheduled_work WHERE id=?').get(schedule.id).version,version);
    assert.equal(JSON.parse(f.db.prepare('SELECT result_json FROM agent_action_requests WHERE id=?').get(action.id).result_json).resource,'scheduled_work');
  }
  f.time('2026-10-08T12:05:00.000Z');await f.api.dispatchScheduledWork();assert.equal(f.db.prepare('SELECT count(*) n FROM messages WHERE kind=? AND content=?').get('note','Owned note').n,0);
});

test('stale schedule-management proposals fail without consuming their pending receipt',async t=>{
  const f=await fixture(t);await f.call('/connections/codex/connect',{method:'existing'});
  const schedule=(await f.call('/scheduled-work',f.scheduleBody({chat_id:f.chat.id,content:'Do not override'}))).result;
  const action=await proposedAction(f,{type:'schedule.update',schedule_id:schedule.id,version:1,state:'cancelled'});
  await f.call(`/scheduled-work/${schedule.id}`,{version:1,state:'paused'},'PATCH');
  assert.equal((await f.request(`/agent-actions/${action.id}/decision`,{decision:'approve'})).status,409);
  assert.equal(f.db.prepare('SELECT status FROM agent_action_requests WHERE id=?').get(action.id).status,'pending');assert.equal((await f.call(`/scheduled-work/${schedule.id}`)).result.state,'paused');
});

test('schedule awareness is sponsor-only and another manager cannot confirm or copy owner schedule metadata',async t=>{
  const f=await fixture(t);await f.call('/connections/codex/connect',{method:'existing'});
  const schedule=(await f.call('/scheduled-work',f.scheduleBody({chat_id:f.chat.id,content:'OWNER_PRIVATE_SCHEDULE_TITLE'}))).result;
  const action=await proposedAction(f,{type:'schedule.update',schedule_id:schedule.id,version:1,state:'paused'}),who=await signedMember(f);
  const memberAware=await f.call(`/agent-awareness?workspace_id=${f.workspace.id}`,undefined,'GET',who.cookie);
  assert.ok(!JSON.stringify(memberAware).includes('OWNER_PRIVATE_SCHEDULE_TITLE'));assert.equal(memberAware.context.schedules.length,0);
  assert.equal((await f.request(`/agent-actions/${action.id}/decision`,{decision:'approve'},'POST',who.cookie)).status,403);
  const ownAware=await f.call(`/agent-awareness?workspace_id=${f.workspace.id}`,undefined,'GET',who.ownerCookie);assert.equal(ownAware.context.schedules[0].id,schedule.id);
  const input={workspace_id:f.workspace.id,chat_id:f.chat.id,agent_id:f.agent.id,prompt:'List my schedules',work_mode:'conversation',include_chat:false,include_memory:false,include_workspace:true};
  const memberPreview=(await f.call('/context/inspect',input,'POST',who.cookie)).result;assert.equal(memberPreview.manifest.schedules.length,0);assert.ok(!memberPreview.finalPrompt.includes('OWNER_PRIVATE_SCHEDULE_TITLE'));
  const ownPreview=(await f.call('/context/inspect',input,'POST',who.ownerCookie)).result;assert.equal(ownPreview.manifest.schedules[0].id,schedule.id);assert.match(ownPreview.finalPrompt,/OWNER_PRIVATE_SCHEDULE_TITLE/);
  const privateSchedule=(await f.call('/scheduled-work',f.scheduleBody({chat_id:f.chat.id,content:'MEMBER_PRIVATE_SCHEDULE_TITLE'},{request_id:'member_private_schedule'}),'POST',who.cookie)).result;
  assert.ok(!JSON.stringify((await f.call(`/agent-awareness?workspace_id=${f.workspace.id}`,undefined,'GET',who.ownerCookie)).context.schedules).includes('MEMBER_PRIVATE_SCHEDULE_TITLE'));
  const sourceRun=f.db.prepare('SELECT * FROM runs WHERE id=?').get(action.run_id);
  assert.throws(()=>captureAgentActions(f.db,sourceRun.id,`\`\`\`frondose-actions\n${JSON.stringify({nonce:'foreign_schedule',actions:[{type:'schedule.update',schedule_id:privateSchedule.id,version:1,state:'cancelled'}]})}\n\`\`\``,'foreign_schedule'),/source sponsor/);
});

test('schedule metadata copied into a later run preserves original historical source ACLs',async t=>{
  const f=await fixture(t);await f.call('/connections/codex/connect',{method:'existing'});
  const privateProject=(await f.call('/projects',{workspace_id:f.workspace.id,name:'Private schedule source'})).project;
  const doc=(await f.call('/documents',{workspace_id:f.workspace.id,project_id:privateProject.id,title:'Private evidence',content:'PRIVATE_SCHEDULE_CONTEXT'})).document;
  const pack=(await f.call('/workspace-items',{workspace_id:f.workspace.id,kind:'context_pack',name:'Schedule evidence',payload:{description:'',content:'',document_ids:[doc.id],memory_ids:[]}})).result,who=await signedMember(f);
  const originalInput={workspace_id:f.workspace.id,chat_id:f.chat.id,agent_id:f.agent.id,prompt:'PRIVATE_SCHEDULE_TITLE',work_mode:'conversation',include_chat:false,include_memory:false,include_workspace:false,context_pack_ids:[pack.id]};
  const original=(await f.call('/context/inspect',originalInput,'POST',who.cookie)).result;
  const schedule=(await f.call('/scheduled-work',f.scheduleBody({chat_id:f.chat.id,agent_id:f.agent.id,content:originalInput.prompt,attachments:[]},{context_inspection_id:original.id}),'POST',who.cookie)).result;
  const laterInput={workspace_id:f.workspace.id,chat_id:f.chat.id,agent_id:f.agent.id,prompt:'List my active schedules',work_mode:'conversation',include_chat:false,include_memory:false,include_workspace:true};
  const later=(await f.call('/context/inspect',laterInput,'POST',who.cookie)).result;assert.equal(later.manifest.schedules[0].id,schedule.id);
  const started=await f.call(`/chats/${f.chat.id}/turns`,{agent_id:f.agent.id,content:laterInput.prompt,client_turn_id:'captured_schedule_metadata',work_mode:'conversation',include_chat:false,include_memory:false,include_workspace:true,context_inspection_id:later.id},'POST',who.cookie);
  for(let i=0;i<80 && f.db.prepare('SELECT status FROM runs WHERE id=?').get(started.run.id).status!=='completed';i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await f.request(`/runs/${started.run.id}/context`,undefined,'GET',who.cookie)).status,200);
  await f.call(`/documents/${doc.id}`,{project_id:f.project.id,content:'Public current text'},'PATCH',who.ownerCookie);
  await f.call('/governance',{workspace_id:f.workspace.id,action:'grant',member_id:who.member.id,permission:'documents.read',effect:'deny',scope_type:'project',scope_id:privateProject.id,reason:'Revoke original schedule evidence'},'POST',who.ownerCookie);
  const hidden=await f.request(`/runs/${started.run.id}/context`,undefined,'GET',who.cookie);assert.equal(hidden.status,403);assert.ok(!JSON.stringify(hidden.body).includes('PRIVATE_SCHEDULE_TITLE'));
  assert.equal((await f.call(`/agent-awareness?workspace_id=${f.workspace.id}`,undefined,'GET',who.cookie)).context.schedules.length,0);
});

test('AI scheduling rechecks historical source ACL and conceals unreadable schedules after sources move',async t=>{
  const f=await fixture(t);await f.call('/connections/codex/connect',{method:'existing'});
  const privateProject=(await f.call('/projects',{workspace_id:f.workspace.id,name:'Historical private scope'})).project;
  const doc=(await f.call('/documents',{workspace_id:f.workspace.id,project_id:privateProject.id,title:'Sensitive evidence',content:'SCHEDULED_HISTORICAL_PRIVATE_SECRET'})).document;
  const pack=(await f.call('/workspace-items',{workspace_id:f.workspace.id,kind:'context_pack',name:'Scheduled cross-scope evidence',payload:{description:'',content:'',document_ids:[doc.id],memory_ids:[]}})).result;
  const who=await signedMember(f),input={workspace_id:f.workspace.id,chat_id:f.chat.id,agent_id:f.agent.id,prompt:'Use exact evidence',work_mode:'conversation',include_chat:false,include_memory:false,include_workspace:false,context_pack_ids:[pack.id]};
  const preview=(await f.call('/context/inspect',input,'POST',who.cookie)).result;
  const schedule=(await f.call('/scheduled-work',f.scheduleBody({chat_id:f.chat.id,agent_id:f.agent.id,content:input.prompt,attachments:[]},{context_inspection_id:preview.id}),'POST',who.cookie)).result;
  await f.call(`/documents/${doc.id}`,{project_id:f.project.id,content:'Current public text'},'PATCH',who.ownerCookie);
  await f.call('/governance',{workspace_id:f.workspace.id,action:'grant',member_id:who.member.id,permission:'documents.read',effect:'deny',scope_type:'project',scope_id:privateProject.id,reason:'Revoke historical source access'},'POST',who.ownerCookie);
  assert.equal((await f.request(`/documents/${doc.id}`,undefined,'GET',who.cookie)).status,200);
  const inaccessible=await f.request(`/scheduled-work/${schedule.id}`,undefined,'GET',who.cookie);assert.ok([403,404].includes(inaccessible.status));assert.ok(!JSON.stringify(inaccessible.body).includes('SCHEDULED_HISTORICAL_PRIVATE_SECRET'));
  assert.equal((await f.call(`/scheduled-work?workspace_id=${f.workspace.id}`,undefined,'GET',who.cookie)).result.length,0);
  f.time('2026-10-08T12:01:00.000Z');await f.api.dispatchScheduledWork();assert.equal(f.prompts.length,0);assert.equal(f.db.prepare('SELECT status FROM scheduled_work_occurrences WHERE schedule_id=?').get(schedule.id).status,'failed');
});

test('a scheduled action rechecks both sponsor and reviewing scheduler write rights at delivery',async t=>{
  const f=await fixture(t);await f.call('/connections/codex/connect',{method:'existing'});
  await f.call(`/chats/${f.chat.id}/turns`,{agent_id:f.agent.id,content:'Propose an edit',client_turn_id:'sponsor_fixture_turn',work_mode:'conversation'});const run=await f.waitTerminal();
  const proposal={type:'record.update',resource:'projects',id:f.project.id,patch:{goal:'Must not apply after revocation'}};
  captureAgentActions(f.db,run.id,`\`\`\`rumbo-actions\n${JSON.stringify({nonce:'fixture',actions:[proposal]})}\n\`\`\``,'fixture');const action=f.db.prepare('SELECT * FROM agent_action_requests WHERE run_id=?').get(run.id);
  const who=await signedMember(f),schedule=(await f.call('/scheduled-work',f.scheduleBody({action_request_id:action.id},{kind:'action'}),'POST',who.cookie)).result;
  await f.call('/governance',{workspace_id:f.workspace.id,action:'grant',member_id:who.member.id,permission:'projects.write',effect:'deny',scope_type:'project',scope_id:f.project.id,reason:'Revoke scheduled action write rights'},'POST',who.ownerCookie);
  f.time('2026-10-08T12:01:00.000Z');await f.api.dispatchScheduledWork();await f.api.dispatchScheduledWork();
  assert.equal(f.db.prepare('SELECT goal FROM projects WHERE id=?').get(f.project.id).goal,'');
  assert.equal((await f.call(`/scheduled-work/${schedule.id}`,undefined,'GET',who.cookie)).result.history[0].status,'failed');assert.equal(f.db.prepare('SELECT status FROM agent_action_requests WHERE id=?').get(action.id).status,'pending');
});

test('scheduled local snapshot notes retain historical source access and cannot launder moved protected text',async t=>{
  const f=await fixture(t),privateProject=(await f.call('/projects',{workspace_id:f.workspace.id,name:'Private snapshot source'})).project;
  const doc=(await f.call('/documents',{workspace_id:f.workspace.id,project_id:privateProject.id,title:'Snapshot evidence',content:'SNAPSHOT_NOTE_HISTORICAL_SECRET'})).document;
  const who=await signedMember(f),snapshot=(await f.call(`/chat-collaboration/${f.chat.id}`,{workspace_id:f.workspace.id,action:'context',version:0,sources:[{kind:'document',id:doc.id}]},'POST',who.cookie)).result;
  const payload={chat_id:f.chat.id,content:'Pinned context note',context_snapshot_id:snapshot.id,attachments:[{name:`frondose-context-${snapshot.id}.md`,type:'text/markdown',content:snapshot.content,rumbo_context_snapshot:snapshot.id}]};
  const schedule=(await f.call('/scheduled-work',f.scheduleBody(payload),'POST',who.cookie)).result;
  await f.call(`/documents/${doc.id}`,{project_id:f.project.id,content:'Public current text'},'PATCH',who.ownerCookie);
  await f.call('/governance',{workspace_id:f.workspace.id,action:'grant',member_id:who.member.id,permission:'documents.read',effect:'deny',scope_type:'project',scope_id:privateProject.id,reason:'Revoke snapshot historical source'},'POST',who.ownerCookie);
  const reused=await f.request('/scheduled-work',f.scheduleBody(payload,{request_id:'cannot_launder_snapshot'}),'POST',who.cookie);assert.ok([403,409].includes(reused.status),JSON.stringify(reused.body));
  assert.equal((await f.call(`/scheduled-work?workspace_id=${f.workspace.id}`,undefined,'GET',who.cookie)).result.length,0);
  f.time('2026-10-08T12:01:00.000Z');await f.api.dispatchScheduledWork();assert.equal(f.db.prepare('SELECT status FROM scheduled_work_occurrences WHERE schedule_id=?').get(schedule.id).status,'failed');
  assert.equal(f.db.prepare('SELECT count(*) n FROM messages WHERE chat_id=?').get(f.chat.id).n,0);
});

test('OpenRouter scheduled message uses exact reviewed context and returns a reviewable local action',async t=>{
  const key=randomBytes(32),requests=[];
  const f=await fixture(t,{integrationOptions:{env:{FRONDOSE_CONNECTION_ENCRYPTION_KEY:key.toString('base64')},fetchImpl:async(url,options)=>{
    requests.push({url,options});assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
    const prompt=JSON.parse(options.body).messages[0].content,nonce=prompt.match(/"nonce":"([^"]+)"/)?.[1];assert.ok(nonce);
    return Response.json({choices:[{message:{content:`Please review the Route.\n\`\`\`rumbo-actions\n${JSON.stringify({nonce,actions:[{type:'record.create',resource:'tasks',fields:{title:'API-provider proposed Route',project_id:f.project.id}}]})}\n\`\`\``},finish_reason:'stop'}],usage:{prompt_tokens:40,completion_tokens:15,total_tokens:55}});
  }}});
  const credentialId='openrouter-scheduling-fixture',iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(credentialId));
  const encrypted=Buffer.concat([cipher.update('sk-or-fixture-not-a-real-key','utf8'),cipher.final()]);const sealed=[iv,cipher.getAuthTag(),encrypted].map(value=>value.toString('base64')).join('.');
  const stamp=new Date().toISOString();f.db.prepare('INSERT INTO ai_account_connections(id,workspace_id,actor_id,provider,state,encrypted_credential,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(credentialId,f.workspace.id,'local-owner','openrouter','connected',sealed,stamp,stamp);
  const agent=(await f.call('/agents',{workspace_id:f.workspace.id,name:'API fixture agent',provider:'openrouter',model:'fixture/model'})).agent;
  const readiness = snapshot => snapshot.connections.find(connection=>connection.provider === 'openrouter')?.workspace_states?.[f.workspace.id];
  assert.equal(readiness(await f.call('/bootstrap')),'connected','initial bootstrap keeps actor-scoped API readiness');
  assert.equal(readiness((await f.call('/events')).bootstrap),'connected','polling bootstrap keeps actor-scoped API readiness');
  assert.equal(requests.length,0,'readiness responses do not probe provider accounts');
  const input={workspace_id:f.workspace.id,chat_id:f.chat.id,agent_id:agent.id,prompt:'Create a useful Route proposal',work_mode:'conversation',include_workspace:false,include_chat:false,include_memory:false,model:'fixture/model'};
  const preview=(await f.call('/context/inspect',input)).result;
  const schedule=(await f.call('/scheduled-work',f.scheduleBody({chat_id:f.chat.id,agent_id:agent.id,content:input.prompt,attachments:[]},{context_inspection_id:preview.id}))).result;
  assert.equal(requests.length,0);f.time('2026-10-08T12:01:00.000Z');await f.api.dispatchScheduledWork();const run=await f.waitTerminal();await f.api.dispatchScheduledWork();
  assert.equal(run.status,'completed');assert.equal(run.provider,'openrouter');assert.equal(requests.length,1);assert.equal(JSON.parse(requests[0].options.body).messages[0].content,preview.finalPrompt);assert.equal(f.prompts.length,0);
  const mutation=await f.call(`/runs/${run.id}`,{title:'API scheduling readiness fixture'},'PATCH');
  assert.equal(readiness(mutation.bootstrap),'connected','mutation bootstrap keeps actor-scoped API readiness');
  const actions=(await f.call(`/agent-actions?run_id=${run.id}`)).actions;assert.equal(actions.length,1);assert.equal(actions[0].status,'pending');assert.equal(f.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(f.workspace.id).n,0);
  await f.call(`/agent-actions/${actions[0].id}/decision`,{decision:'approve'});assert.equal(f.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(f.workspace.id).n,1);
  assert.equal((await f.call(`/scheduled-work/${schedule.id}`)).result.history[0].status,'completed');
  const who=await signedMember(f);
  assert.equal((await f.request('/bootstrap')).status,401,'unauthenticated requests cannot see saved account readiness');
  const anotherActor=await f.call('/events',undefined,'GET',who.cookie);
  assert.notEqual(readiness(anotherActor.bootstrap),'connected','another actor cannot inherit the owner’s provider readiness');
  await f.call('/governance',{workspace_id:f.workspace.id,action:'grant',member_id:who.member.id,permission:'workspace.read',effect:'deny',scope_type:'workspace',scope_id:f.workspace.id,reason:'No fixture workspace access'},'POST',who.ownerCookie);
  const revoked=await f.call('/events',undefined,'GET',who.cookie);assert.equal(readiness(revoked.bootstrap),undefined,'revoked actor cannot see workspace readiness');
  assert.equal(requests.length,1,'readiness filtering remains local after dispatch');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from '../server/local-api.mjs';

async function fixture(t, provider = 'codex') {
  const directory = await mkdtemp(join(tmpdir(),'frondose-execution-api-'));
  let clock = new Date();
  const api = createLocalApi({dataDir:directory,scheduledWorkOptions:{now:()=>clock,scheduleIntervalMs:3_600_000},integrationOptions:{env:{},fetchImpl:()=>{throw new Error('No external request allowed');},spawnProcess:()=>{throw new Error('No host process allowed');}}});
  const server = createServer(api.middleware); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const root = `http://127.0.0.1:${server.address().port}`, db = new DatabaseSync(api.dbPath);
  const call = async (path, input, method = input === undefined ? 'GET':'POST', token) => {
    const response = await fetch(root+'/api'+path,{method,headers:{origin:root,'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(input===undefined?{}:{body:JSON.stringify(input)})});
    return {status:response.status,body:await response.json()};
  };
  const ws = (await call('/workspaces',{name:'Execution fixture'})).body.workspace.id;
  const agentResponse = await call('/agents',{workspace_id:ws,name:'Computer fixture',provider,provider_connection_id:null});
  assert.equal(agentResponse.status,201,JSON.stringify(agentResponse)); const agent = agentResponse.body.agent;
  const chat = (await call('/chats',{workspace_id:ws,title:'Computer conversation',participant_agent_ids:[agent.id]})).body.chat;
  const pair = (await call('/runner-connections/pairing',{workspace_id:ws,name:'Fixture computer'})).body.result.pairing;
  const claim = (await call('/runner-transport/claim',{code:pair.code,platform:'linux',architecture:'x64'})).body.result;
  await call(`/runner-connections/${claim.runner_id}/confirm`,{workspace_id:ws});
  const transport = (operation,input)=>call(`/runner-transport/${claim.runner_id}/${operation}`,input,'POST',claim.credential);
  const policy = {enabled:true,provider_ids:[provider],project_ids:[],max_concurrent_sessions:2,allow_workspace_members:false,native_tools_approved:false,package_execution_approved:false};
  const heartbeat = async overrides => { const result=await transport('heartbeat',{runtimes:[{id:provider,state:'installed'}],execution_policy:{...policy,...overrides}}); assert.equal(result.status,200,JSON.stringify(result)); };
  await heartbeat();
  const saved = await call(`/agent-runner-settings/${agent.id}`,{workspace_id:ws,version:0,connection_method:'computer',runner_id:claim.runner_id,runtime_id:provider,enabled:true,max_concurrent_sessions:2},'PUT');
  assert.equal(saved.status,200,JSON.stringify(saved));
  const launch = (extra={})=>call(`/chats/${chat.id}/turns`,{agent_id:agent.id,content:'Explain this reviewed message.',client_turn_id:'fixture-'+crypto.randomUUID(),work_mode:'conversation',...extra});
  const poll = ()=>transport('poll',{active_job_ids:[]});
  t.after(async()=>{api.close(); await new Promise(resolve=>server.close(resolve)); db.close();await rm(directory,{recursive:true,force:true});});
  return {api,db,call,ws,agent,chat,claim,transport,heartbeat,launch,poll,advance:ms=>{clock=new Date(clock.getTime()+ms);},getClock:()=>clock};
}

test('reviewed computer chat reaches a single leased job and canonical reply/activity without host account fallback',async t=>{
  const f=await fixture(t), response=await f.launch(); assert.equal(response.status,201,JSON.stringify(response));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM personal_runner_jobs').get().n,1);
  const claimed=await f.poll(); assert.equal(claimed.status,200,JSON.stringify(claimed)); const job=claimed.body.result.job; assert.ok(job.prompt.includes('Explain this reviewed message.'));assert.equal(job.providerId,'codex'); assert.equal(job.workMode,'conversation');assert.ok(!job.cwd);
  assert.equal((await f.poll()).body.result.job,null,'a paid invocation must never be redelivered');
  const envelope={job_id:job.id,lease_token:job.leaseToken};
  const event={sequence:1,event:{schema:'frondose.runner-event',version:1,kind:'message',text:'Observed fixture activity',actorId:'forged',workspaceId:'forged',authority:'execute'}};
  assert.equal((await f.transport('events',{...envelope,events:[event]})).status,200);
  assert.equal((await f.transport('events',{...envelope,events:[event]})).body.result.accepted_sequence,1);
  const result={...envelope,status:'completed',text:'Fixture computer reply; no real AI was called.'};
  assert.equal((await f.transport('complete',result)).status,200);
  assert.equal((await f.transport('complete',result)).body.result.replayed,true);
  const snapshot=f.api.snapshot(), run=snapshot.runs.find(run=>run.id===response.body.run.id);
  assert.equal(run.status,'completed');assert.equal(snapshot.messages.filter(item=>item.sender_type==='agent'&&item.chat_id===f.chat.id).length,1);
  const recorded=f.db.prepare("SELECT payload_json FROM run_events WHERE run_id=? AND type='runner.message'").get(run.id);
  const payload=JSON.parse(recorded.payload_json);assert.equal(payload.runner_event.workspaceId,f.ws);assert.equal(payload.runner_event.actorId,'local-owner');assert.equal(payload.runner_event.authority,'observed-only');
});

test('invalid event batches are atomic and forged job leases never add activity',async t=>{
  const f=await fixture(t);await f.launch();const job=(await f.poll()).body.result.job;
  const event={schema:'frondose.runner-event',version:1,kind:'message',text:'never recorded'};
  assert.equal((await f.transport('events',{job_id:job.id,lease_token:job.leaseToken,events:[{sequence:1,event},{sequence:3,event}]})).status,409);
  assert.equal(f.db.prepare('SELECT last_sequence FROM personal_runner_jobs WHERE id=?').get(job.id).last_sequence,0);
  assert.equal((await f.transport('complete',{job_id:job.id,lease_token:'x'.repeat(43),status:'completed',text:'forged'})).status,403);
});

test('local policy revocation stops a claimed request and discards its late reply',async t=>{
  const f=await fixture(t);await f.launch();const job=(await f.poll()).body.result.job;await f.heartbeat({enabled:false});
  const polled=await f.transport('poll',{active_job_ids:[job.id]});assert.ok(polled.body.result.cancel_job_ids.includes(job.id));
  const complete=await f.transport('complete',{job_id:job.id,lease_token:job.leaseToken,status:'completed',text:'Must not enter the conversation'});assert.equal(complete.status,409);
  assert.equal(f.api.snapshot().messages.filter(item=>item.sender_type==='agent').length,0);
  assert.equal(f.db.prepare('SELECT state FROM personal_runner_jobs WHERE id=?').get(job.id).state,'stopped');
});

test('profile revision changes invalidate an outstanding reviewed computer turn',async t=>{
  const f=await fixture(t);await f.launch();const job=(await f.poll()).body.result.job;
  f.db.prepare('UPDATE agents SET version=version+1 WHERE id=?').run(f.agent.id);
  const reply=await f.transport('complete',{job_id:job.id,lease_token:job.leaseToken,status:'completed',text:'obsolete'});assert.equal(reply.body.result.discarded,true);
  assert.equal(f.api.snapshot().messages.filter(item=>item.sender_type==='agent').length,0);
});

test('disabled binding rejects before saving a new user turn',async t=>{
  const f=await fixture(t);await f.call(`/agent-runner-settings/${f.agent.id}`,{workspace_id:f.ws,version:1,enabled:false},'PUT');
  assert.equal((await f.launch()).status,403);assert.equal(f.api.snapshot().messages.length,0);assert.equal(f.api.snapshot().runs.length,0);
});

for (const mutation of ['paused profile','revoked computer']) test(`${mutation} rejects before saving a new user turn`,async t=>{
  const f=await fixture(t);
  if(mutation==='paused profile') f.db.prepare("UPDATE agents SET status='paused' WHERE id=?").run(f.agent.id);
  else await f.call(`/runner-connections/${f.claim.runner_id}`,{workspace_id:f.ws,version:1},'DELETE');
  assert.ok((await f.launch()).status>=400);assert.equal(f.api.snapshot().messages.length,0);assert.equal(f.api.snapshot().runs.length,0);
});

test('explicit native project request uses the computer project mapping, never a server filesystem root',async t=>{
  const f=await fixture(t,'gemini');
  const project=(await f.call('/projects',{workspace_id:f.ws,name:'Remote project'})).body.project;
  await f.call(`/chats/${f.chat.id}`,{project_id:project.id},'PATCH');
  await f.heartbeat({native_tools_approved:true,project_ids:[project.id]});
  const settings=await f.call(`/agent-runner-settings/${f.agent.id}`,{workspace_id:f.ws,version:1,native_tools_allowed:true},'PUT');assert.equal(settings.status,200,JSON.stringify(settings));
  const request={workspace_id:f.ws,chat_id:f.chat.id,agent_id:f.agent.id,prompt:'Review the mapped project.',work_mode:'project',permission_mode:'workspace-write',include_chat:false,include_memory:false,include_workspace:false};
  const preview=await f.call('/context/inspect',request);assert.equal(preview.status,201,JSON.stringify(preview));
  const launched=await f.launch({content:request.prompt,work_mode:'project',permission_mode:'workspace-write',include_chat:false,include_memory:false,include_workspace:false,context_inspection_id:preview.body.result.id});assert.equal(launched.status,201,JSON.stringify(launched));
  const job=(await f.poll()).body.result.job;assert.equal(job.projectId,project.id);assert.equal(job.nativeToolsApproved,true);assert.equal(job.cwd,undefined);
  await f.heartbeat({native_tools_approved:true,project_ids:[]});
  const completed=await f.transport('complete',{job_id:job.id,lease_token:job.leaseToken,status:'completed',text:'Late reply after mapping removal'});assert.equal(completed.body.result.discarded,true);
});

test('scheduled computer chat dispatches once through the same reviewed relay',async t=>{
  const f=await fixture(t), prompt='A scheduled computer fixture';
  const request={workspace_id:f.ws,agent_id:f.agent.id,chat_id:f.chat.id,prompt,work_mode:'conversation',include_chat:false,include_memory:false,include_workspace:false};
  const preview=await f.call('/context/inspect',request);assert.equal(preview.status,201,JSON.stringify(preview));
  const localTime=new Date(f.getClock().getTime()+120000).toISOString().slice(0,16);
  const saved=await f.call('/scheduled-work',{workspace_id:f.ws,kind:'message',payload:{chat_id:f.chat.id,agent_id:f.agent.id,content:prompt,attachments:[]},local_time:localTime,timezone:'UTC',recurrence:'none',request_id:'computer-schedule-fixture',context_inspection_id:preview.body.result.id});assert.equal(saved.status,201,JSON.stringify(saved));
  f.advance(120000);await f.api.dispatchScheduledWork();await f.api.dispatchScheduledWork();
  assert.equal(f.db.prepare('SELECT count(*) n FROM personal_runner_jobs').get().n,1);
  const job=(await f.poll()).body.result.job;assert.ok(job.prompt.includes(prompt));
  assert.equal((await f.transport('complete',{job_id:job.id,lease_token:job.leaseToken,status:'completed',text:'Scheduled fixture reply'})).status,200);
  assert.equal(f.api.snapshot().messages.filter(item=>item.sender_type==='agent').length,1);
});

test('explicit event subscription dispatches once to a computer and keeps future event text out of the saved prompt',async t=>{
  const f=await fixture(t), prompt='Handle the reviewed event metadata.';
  const project=(await f.call('/projects',{workspace_id:f.ws,name:'Event computer project'})).body.project;
  await f.call(`/chats/${f.chat.id}`,{project_id:project.id},'PATCH');
  const preview=await f.call('/context/inspect',{workspace_id:f.ws,agent_id:f.agent.id,chat_id:f.chat.id,prompt,work_mode:'conversation',include_chat:false,include_memory:false,include_workspace:false});assert.equal(preview.status,201);
  const saved=await f.call('/event-work',{workspace_id:f.ws,title:'Computer event',request_id:'computer-event-fixture',trigger:{event:'route.created',target_type:'project',target_id:project.id},payload:{chat_id:f.chat.id,agent_id:f.agent.id,content:prompt,attachments:[]},context_inspection_id:preview.body.result.id,cooldown_minutes:5,confirmed_recurring:true});assert.equal(saved.status,201,JSON.stringify(saved));
  assert.equal(f.db.prepare('SELECT count(*) n FROM personal_runner_jobs').get().n,0);
  const route=await f.call('/tasks',{workspace_id:f.ws,project_id:project.id,title:'UNREVIEWED FUTURE BODY MUST NOT ENTER PROMPT'});assert.equal(route.status,201);
  await f.api.dispatchEventWork();await f.api.dispatchEventWork();
  assert.equal(f.db.prepare('SELECT count(*) n FROM personal_runner_jobs').get().n,1);
  const job=(await f.poll()).body.result.job;assert.ok(job.prompt.includes(prompt));assert.ok(!job.prompt.includes('UNREVIEWED FUTURE BODY'));
  assert.equal((await f.transport('complete',{job_id:job.id,lease_token:job.leaseToken,status:'completed',text:'Event fixture reply'})).status,200);
});

test('multiple profiles can use one runtime, while per-profile concurrency and runtime identity are enforced',async t=>{
  const f=await fixture(t);assert.equal((await f.launch()).status,201);
  const other=(await f.call('/agents',{workspace_id:f.ws,name:'Second named computer agent',provider:'codex',provider_connection_id:null})).body.agent;
  assert.equal((await f.call(`/agent-runner-settings/${other.id}`,{workspace_id:f.ws,version:0,connection_method:'computer',runner_id:f.claim.runner_id,runtime_id:'codex',enabled:true},'PUT')).status,200);
  const chat=(await f.call('/chats',{workspace_id:f.ws,title:'Second session',participant_agent_ids:[other.id]})).body.chat;
  const second=await f.call(`/chats/${chat.id}/turns`,{agent_id:other.id,content:'Independent session',client_turn_id:'second-session-turn',work_mode:'conversation'});assert.equal(second.status,201,JSON.stringify(second));
  const third=await f.launch();
  assert.equal(third.status,409,JSON.stringify(third));assert.equal(f.db.prepare("SELECT count(*) AS n FROM personal_runner_jobs WHERE state='queued'").get().n,2);assert.equal(f.api.snapshot().messages.length,2);
  const mismatch=await f.call(`/agent-runner-settings/${f.agent.id}`,{workspace_id:f.ws,version:1,runtime_id:'claude'},'PUT');assert.equal(mismatch.status,400);
});

test('native-tool runtimes fail closed in General chat even with installed inventory',async t=>{
  const f=await fixture(t,'gemini');const response=await f.launch();assert.equal(response.status,409,JSON.stringify(response));assert.equal(response.body.error.code,'runner_native_tools_required');assert.equal(f.api.snapshot().messages.length,0);
});

test('personal Frondose can prepare its own unbound computer profile without activating a provider or starting work',async t=>{
  const f=await fixture(t), before=f.api.snapshot().runs.length;
  const prepared=await f.call('/rumbo-agent/profile',{workspace_id:f.ws,provider:'claude',prepare_computer:true});assert.equal(prepared.status,200,JSON.stringify(prepared));assert.equal(prepared.body.agent.provider_connection_id,null);
  const status=await f.call(`/rumbo-agent?workspace_id=${f.ws}`);assert.equal(status.status,200,JSON.stringify(status));const claude=status.body.result.providers.find(item=>item.provider==='claude');assert.equal(claude.connected,false);assert.equal(claude.agent.id,prepared.body.agent.id);assert.equal(f.api.snapshot().runs.length,before);
});

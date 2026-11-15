import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createWorkspaceAgentChat } from '../server/workspace-agent-chat.mjs';
const owner={id:'local-owner'};
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(fn){for(let i=0;i<100;i++){const value=await fn();if(value)return value;await tick();}throw Error('Condition not reached');}
function fixture(t,{approval=false,claudeEndEarly=false,native=false,resumeMismatch=false}={}){
  const db=new DatabaseSync(':memory:');db.exec("PRAGMA foreign_keys=ON;CREATE TABLE workspaces(id TEXT PRIMARY KEY);INSERT INTO workspaces VALUES('ws'),('other')");
  const context={root:'/fixture',row:{version:'v',project_id:'p'}},calls=[];let spawnCount=0,sdkCalls=0,claudeOptions;
  let rootGate;
  const roots={get:async(ws,actor)=>{if(actor?.id!=='local-owner'||!['ws','other'].includes(ws))throw Error('Owner denied');return{};},rootFor:async()=>{const gate=rootGate;rootGate=null;if(gate)await gate();return context;}};
  const spawnProcess=(command,args,options)=>{
    spawnCount++;const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{queueMicrotask(()=>child.emit('close',0));return true;};let buffer='';
    const write=value=>child.stdout.write(JSON.stringify(value)+'\n');
    const finish=()=>{write({method:'item/agentMessage/delta',params:{delta:'Hello'}});write({method:'item/completed',params:{item:{id:'reply',type:'agentMessage',text:'Hello'}}});write({method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}});};
    child.stdin.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))!==-1){const request=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);calls.push(request);
      queueMicrotask(()=>{if(['approval','native-action'].includes(request.id)){finish();return;}if(!request.method)return;if(request.method==='initialize')write({id:request.id,result:{}});if(['thread/start','thread/resume'].includes(request.method))write({id:request.id,result:{thread:{id:resumeMismatch&&request.method==='thread/resume'?'different-session':'provider-session'}}});if(request.method==='turn/start'){write({id:request.id,result:{turn:{id:'turn'}}});if(native)write({id:'native-action',method:'item/tool/call',params:{tool:'frondose_computer',arguments:{operation:'snapshot'}}});else if(approval)write({id:'approval',method:'item/commandExecution/requestApproval',params:{command:['echo','hello']}});else finish();}});
    }});return child;
  };
  const loadClaude=async()=>({tool:(name,description,schema,handler)=>({handler}),createSdkMcpServer:({tools})=>({tool:tools[0]}),query:({prompt,options})=>{sdkCalls++;claudeOptions=options;return(async function*(){yield{type:'system',session_id:'claude-owned-session'};if(claudeEndEarly)return;const result=await options.canUseTool(native?'mcp__frondose__computer':'Write',native?{operation:'snapshot'}:{file_path:'/fixture/file.txt',content:'test'});if(native){assert.equal(result.behavior,'allow');await options.mcpServers.frondose.tool.handler({operation:'snapshot'});}else assert.equal(result.behavior,'deny');yield{type:'result',subtype:'success',is_error:false,result:'Permission review completed'};})();}});
  const service=createWorkspaceAgentChat({db,roots,env:{FRONDOSE_CLAUDE_API_KEY:'fixture-not-a-real-key'},platform:'darwin',plan:async()=>({command:'/fixture/provider',env:{HOME:'/owned-home',PATH:'/bin',CLAUDE_CODE_OAUTH_TOKEN:'must-not-forward',ANTHROPIC_AUTH_TOKEN:'must-not-forward'}}),discover:async()=>[{id:'codex',installed:true},{id:'claude',installed:true}],spawnProcess,loadClaude});
  const action=(action,input={})=>service.dispatch({workspaceId:'ws',actor:owner,method:'POST',action,input:{confirmed:true,expected_binding_version:'v',...input}});
  const get=id=>service.dispatch({workspaceId:'ws',actor:owner,query:new URLSearchParams({id})});
  t.after(()=>{service.close();db.close();});
  function pauseRoot(){let reached,release;const waiting=new Promise(yes=>reached=yes);const proceed=new Promise(yes=>release=yes);rootGate=()=>{reached();return proceed;};return {waiting,release};}
  return {service,db,calls,context,action,get,pauseRoot,counts:()=>({spawnCount,sdkCalls}),claudeOptions:()=>claudeOptions};
}
test('Creating, listing and restoring conversation metadata does not launch a provider',async t=>{const f=fixture(t);const c=await f.action('create',{provider:'codex',title:'Test'});assert.equal(c.provider,'codex');assert.deepEqual(f.counts(),{spawnCount:0,sdkCalls:0});assert.equal((await f.get(c.id)).conversation.title,'Test');});
test('Delete needs an exact confirmed local conversation, removes its own transcript, and never launches provider cleanup',async t=>{
  const f=fixture(t),c=await f.action('create',{provider:'codex'}),other=await f.action('create',{provider:'codex',title:'Do not remove'});
  await f.action('send',{id:c.id,revision:1,request_id:'first-test',prompt:'Fixture only'});
  await until(async()=>(await f.get(c.id)).conversation.turns[0].status==='completed');
  await assert.rejects(f.action('delete',{id:c.id,revision:2,confirmed:false}),/Confirm/);
  await assert.rejects(f.action('delete',{id:c.id,revision:1}),/changed/);
  await assert.rejects(f.service.dispatch({workspaceId:'other',actor:owner,method:'POST',action:'delete',input:{confirmed:true,id:c.id,revision:2}}),/not in/);
  assert.deepEqual(await f.action('delete',{id:c.id,revision:2,expected_binding_version:'old'}),{deleted:true,id:c.id});
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM local_agent_turns WHERE conversation_id=?').get(c.id).n,0);
  assert.equal((await f.get(other.id)).conversation.title,'Do not remove');
  await assert.rejects(f.get(c.id),/not in/);assert.equal(f.counts().spawnCount,1);
});
test('Delete refuses live and scheduled chats and only clears dedicated ownership after automation deletion',async t=>{
  const f=fixture(t,{approval:true}),c=await f.action('create',{provider:'codex'});
  await f.action('send',{id:c.id,revision:1,request_id:'active-test',prompt:'Fixture only'});
  const pending=await until(async()=>(await f.get(c.id)).conversation.approvals[0]);
  await assert.rejects(f.action('delete',{id:c.id,revision:2}),/Stop the active turn/);
  await f.action('decision',{id:c.id,approval_id:pending.id,decision:'deny'});
  await until(async()=>(await f.get(c.id)).conversation.turns[0].status==='completed');
  f.db.exec('CREATE TABLE local_cli_automations(id TEXT,workspace_id TEXT,target_conversation_id TEXT,deleted_at TEXT)');
  f.db.prepare('INSERT INTO local_cli_automations VALUES(?,?,?,NULL)').run('auto1','ws',c.id);
  await assert.rejects(f.action('delete',{id:c.id,revision:2}),/belongs to an automation/);
  f.db.exec("UPDATE local_cli_automations SET target_conversation_id=NULL WHERE id='auto1'");
  f.db.prepare('INSERT INTO local_automation_chat_sessions VALUES(?,?)').run('auto1',c.id);
  await assert.rejects(f.action('delete',{id:c.id,revision:2}),/belongs to an automation/);
  f.db.exec("UPDATE local_cli_automations SET deleted_at='2026-11-15' WHERE id='auto1'");
  assert.equal((await f.action('delete',{id:c.id,revision:2})).deleted,true);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM local_automation_chat_sessions').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM local_cli_automations').get().n,1);
});
test('A send that waited for directory authorization cannot overwrite a newer reviewed revision',async t=>{
  const f=fixture(t),c=await f.action('create',{provider:'codex'}),gate=f.pauseRoot();
  const stale=f.action('send',{id:c.id,revision:1,request_id:'stale',prompt:'Do not send'});
  await gate.waiting;
  try {
    await f.action('send',{id:c.id,revision:1,request_id:'newer',prompt:'Valid reviewed turn'});
    await until(async()=>(await f.get(c.id)).conversation.turns[0]?.status==='completed');
  } finally { gate.release(); }
  await assert.rejects(stale,/conversation changed/i);
  assert.equal(f.calls.filter(message=>message.method==='turn/start').length,1);
});
test('A fresh-looking Codex thread mismatch never receives the prompt',async t=>{
  const f=fixture(t,{resumeMismatch:true}),c=await f.action('create',{provider:'codex'});
  await f.action('send',{id:c.id,revision:1,request_id:'initial',prompt:'Fixture'});
  await until(async()=>(await f.get(c.id)).conversation.turns[0]?.status==='completed');
  await f.action('send',{id:c.id,revision:2,request_id:'resumed',prompt:'Do not send here'});
  const turn=await until(async()=>{const entry=(await f.get(c.id)).conversation.turns.find(row=>row.request_id==='resumed');return entry?.status==='failed'&&entry;});
  assert.match(turn.error,/exact reviewed native session/);
  assert.equal(f.calls.filter(message=>message.method==='turn/start').length,1);
  assert.equal((await f.get(c.id)).conversation.native_session_id,'provider-session');
});
test('Claude must send a success result before the turn can be shown as completed',async t=>{
  const f=fixture(t,{claudeEndEarly:true}),c=await f.action('create',{provider:'claude'});
  await f.action('send',{id:c.id,revision:1,request_id:'partial',prompt:'Fixture only'});
  const turn=await until(async()=>{const entry=(await f.get(c.id)).conversation.turns[0];return entry?.status==='failed'&&entry;});
  assert.match(turn.error,/before confirming completion/);
});
test('Codex chat streams and persists a response, then explicitly resumes only its owned provider session',async t=>{const f=fixture(t);const c=await f.action('create',{provider:'codex'});await f.action('send',{id:c.id,revision:1,request_id:'request-1',prompt:'Hello'});await until(async()=>{const row=(await f.get(c.id)).conversation;return row.turns[0].status==='completed'&&row;});assert.equal((await f.get(c.id)).conversation.turns[0].response,'Hello');assert.equal(f.service.activeSessionsFor('workspaces','ws').length,0);await f.action('send',{id:c.id,revision:2,request_id:'request-2',prompt:'Continue'});await until(()=>f.calls.some(c=>c.method==='thread/resume'));assert.equal(f.calls.find(c=>c.method==='thread/resume').params.threadId,'provider-session');await until(async()=>(await f.get(c.id)).conversation.turns[1].status==='completed');});
test('A repeated send identity cannot launch twice or silently change the prompt',async t=>{const f=fixture(t),c=await f.action('create',{provider:'codex'}),send={id:c.id,revision:1,request_id:'request-1',prompt:'Hello'};await f.action('send',send);await until(async()=>(await f.get(c.id)).conversation.turns[0].status==='completed');await f.action('send',send);assert.equal(f.counts().spawnCount,1);await assert.rejects(f.action('send',{...send,prompt:'Different'}),/another prompt/);});
test('Directory epochs, revisions and workspace ownership guard sends',async t=>{const f=fixture(t),c=await f.action('create',{provider:'codex'}),send={id:c.id,revision:1,request_id:'request-1',prompt:'Hello'};await assert.rejects(f.action('send',{...send,expected_binding_version:'old'}),/binding/);await assert.rejects(f.action('send',{...send,revision:999}),/changed/);await assert.rejects(f.service.dispatch({workspaceId:'other',actor:owner,action:'send',method:'POST',input:{...send,confirmed:true}}),/not in/);assert.equal(f.counts().spawnCount,0);});
test('Provider permission requests remain pending until an explicit one-time human decision',async t=>{const f=fixture(t,{approval:true}),c=await f.action('create',{provider:'codex'});await f.action('send',{id:c.id,revision:1,request_id:'request-1',prompt:'Review'});const state=await until(async()=>{const row=(await f.get(c.id)).conversation;return row.approvals.length&&row;});assert.equal(state.turns[0].status,'needs-input');assert.equal(f.calls.some(c=>c.id==='approval'),false);await f.action('decision',{id:c.id,approval_id:state.approvals[0].id,decision:'deny'});await until(()=>f.calls.some(c=>c.id==='approval'));assert.equal(f.calls.find(c=>c.id==='approval').result.decision,'decline');await assert.rejects(f.action('decision',{id:c.id,approval_id:state.approvals[0].id,decision:'allow'}),/no longer/);await until(async()=>(await f.get(c.id)).conversation.turns[0].status==='completed');});
test('Claude uses the installed runtime, disabled project settings and reviewed permissions',async t=>{const f=fixture(t),c=await f.action('create',{provider:'claude'});await f.action('send',{id:c.id,revision:1,request_id:'request-1',prompt:'Review'});const state=await until(async()=>{const row=(await f.get(c.id)).conversation;return row.approvals.length&&row;});await f.action('decision',{id:c.id,approval_id:state.approvals[0].id,decision:'deny'});await until(async()=>(await f.get(c.id)).conversation.turns[0].status==='completed');assert.equal(f.claudeOptions().pathToClaudeCodeExecutable,'/fixture/provider');assert.equal(f.claudeOptions().permissionMode,'default');assert.deepEqual(f.claudeOptions().settingSources,[]);assert.equal(f.counts().spawnCount,0);});
test('Restarted turns are interrupted, not replayed',async t=>{const f=fixture(t),c=await f.action('create',{provider:'codex'});f.db.prepare('INSERT INTO local_agent_turns(id,conversation_id,request_id,prompt,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('old',c.id,'old-request','Do not run','running','2026-11-11','2026-11-11');f.service.close();const service=createWorkspaceAgentChat({db:f.db,roots:{get:async()=>({})},discover:async()=>[]});assert.equal(f.db.prepare('SELECT status FROM local_agent_turns WHERE id=?').get('old').status,'interrupted');assert.equal(f.counts().spawnCount,0);service.close();});
test('Claude transport uses only the explicitly configured API key, never subscription tokens',async t=>{
  const f=fixture(t),c=await f.action('create',{provider:'claude'});
  await f.action('send',{id:c.id,revision:1,request_id:'api-key-test',prompt:'Review'});
  const pending=await until(async()=>(await f.get(c.id)).conversation.approvals[0]);
  const options=f.claudeOptions();assert.equal(options.env.ANTHROPIC_API_KEY,'fixture-not-a-real-key');assert.equal(options.env.CLAUDE_CODE_OAUTH_TOKEN,'');assert.equal(options.env.ANTHROPIC_AUTH_TOKEN,'');
  assert(!JSON.stringify(await f.get(c.id)).includes('fixture-not-a-real-key'));
  await f.action('decision',{id:c.id,approval_id:pending.id,decision:'deny'});
  await until(async()=>(await f.get(c.id)).conversation.turns[0].status==='completed');
});
test('Claude configuration discovery rejects invalid keys without exposing their contents',async t=>{
  const f=fixture(t);for(const key of [undefined,'','bad\nkey']){
    const service=createWorkspaceAgentChat({db:f.db,roots:{get:async()=>({})},env:{FRONDOSE_CLAUDE_API_KEY:key},discover:async()=>[{id:'claude',installed:true}]});
    const result=await service.dispatch({workspaceId:'ws',actor:owner});assert.equal(result.providers[0].structuredConfigured,false);assert(!JSON.stringify(result).includes('bad\\nkey'));service.close();
  }
});
test('Codex Computer Use cannot complete without an explicit human native-result decision',async t=>{const f=fixture(t,{native:true}),c=await f.action('create',{provider:'codex'});await f.action('send',{id:c.id,revision:1,request_id:'request-1',prompt:'Inspect the selected app',computer_enabled:true});const state=await until(async()=>{const row=(await f.get(c.id)).conversation;return row.approvals.some(a=>a.native)&&row;});const pending=state.approvals[0];assert.equal(f.calls.some(c=>c.id==='native-action'),false);await assert.rejects(f.action('decision',{id:c.id,approval_id:pending.id,decision:'allow'}),/native result/);assert.equal(f.calls.some(c=>c.id==='native-action'),false);await f.action('decision',{id:c.id,approval_id:pending.id,decision:'deny'});await until(()=>f.calls.some(c=>c.id==='native-action'));assert.equal(f.calls.find(c=>c.id==='native-action').result.success,false);await until(async()=>(await f.get(c.id)).conversation.turns[0].status==='completed');});
test('Claude Computer Use waits for both ordinary tool permission and human-reviewed native execution',async t=>{const f=fixture(t,{native:true}),c=await f.action('create',{provider:'claude'});await f.action('send',{id:c.id,revision:1,request_id:'request-1',prompt:'Inspect',computer_enabled:true});const first=await until(async()=>{const row=(await f.get(c.id)).conversation;return row.approvals.length&&row.approvals[0];});assert.equal(first.native,false);await f.action('decision',{id:c.id,approval_id:first.id,decision:'allow'});const second=await until(async()=>{const row=(await f.get(c.id)).conversation;return row.approvals.find(a=>a.native);});await assert.rejects(f.action('decision',{id:c.id,approval_id:second.id,decision:'allow'}),/native result/);await f.action('decision',{id:c.id,approval_id:second.id,decision:'allow',result:{elements:[],snapshotId:'snapshot-token'}});await until(async()=>(await f.get(c.id)).conversation.turns[0].status==='completed');assert.equal(f.counts().spawnCount,0);});

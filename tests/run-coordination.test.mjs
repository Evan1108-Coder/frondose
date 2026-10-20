import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { installRunCoordination, createRunCoordination, listRunCoordination, prepareRunCoordination, runCoordinationRoute } from '../server/run-coordination-service.mjs';
import { captureSourceAccess, assertSourceAccess } from '../server/context-source-access.mjs';
import { installRunContextStore, captureRunContext } from '../server/run-context-store.mjs';
import { installChatCollaboration, chatContextSnapshotAccess } from '../server/chat-collaboration.mjs';
import { validateLocalAction, executeLocalAction, localActionReadable, actionCatalog } from '../server/agent-action-catalog.mjs';
import { lowRiskAction } from '../server/agent-awareness.mjs';
import { coordinationRequest, coordinationDestination, recordedWorkEvents } from '../src/lib/run-coordination.js';

function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT,archived_at TEXT);
    CREATE TABLE teams(id TEXT PRIMARY KEY,workspace_id TEXT,archived_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,team_id TEXT,archived_at TEXT);
    CREATE TABLE agents(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,provider TEXT,archived_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,team_id TEXT,archived_at TEXT);
    CREATE TABLE chats(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,task_id TEXT,kind TEXT,participant_agent_ids_json TEXT,title TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE messages(id TEXT PRIMARY KEY,chat_id TEXT,metadata_json TEXT,attachments_json TEXT,sender_type TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,team_id TEXT,content TEXT,archived_at TEXT);
    CREATE TABLE runs(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,task_id TEXT,chat_id TEXT,agent_id TEXT,status TEXT,mode TEXT,created_at TEXT,archived_at TEXT);
    INSERT INTO workspaces VALUES('ws','Fixture',NULL),('foreign','Other',NULL);
    INSERT INTO teams VALUES('source-area','ws',NULL),('target-area','ws',NULL),('secret-area','ws',NULL);
    INSERT INTO projects VALUES('source-project','ws','source-area',NULL),('target-project','ws','target-area',NULL),('secret-project','ws','secret-area',NULL);
    INSERT INTO agents VALUES('agent','ws','Source agent','codex',NULL),('recipient','ws','Recipient','openai',NULL),('wrong-workspace','foreign','Wrong','openai',NULL);
    INSERT INTO chats VALUES('source','ws','source-project',NULL,'general','["agent"]','Source','2026-10-20','2026-10-20',NULL),('target','ws','target-project',NULL,'general','["recipient"]','Target','2026-10-20','2026-10-20',NULL),('foreign-chat','foreign',NULL,NULL,'general','[]','Other','2026-10-20','2026-10-20',NULL);
    INSERT INTO documents VALUES('secret-doc','ws','secret-project',NULL,'PRIVATE SOURCE CONTENT',NULL);
    INSERT INTO runs VALUES('run','ws','source-project',NULL,'source','agent','running','live','2026-10-20',NULL);`);
  installRunContextStore(db); installChatCollaboration(db); installRunCoordination(db);
  const manifest = { fingerprint: 'canonical', resolved: { workspace_id: 'ws', project_id: 'source-project', chat_id: 'source', agent_id: 'agent' }, included: [{kind:'document',id:'secret-doc'}] };
  captureRunContext(db,'run',{finalPrompt:'PRIVATE PROVIDER PROMPT',runtimeProtocol:'PRIVATE PROTOCOL',actionNonce:'PRIVATE NONCE',manifest,sourceAccess:captureSourceAccess(db,{manifest})});
  const actor = {id:'owner'}, denied = new Set();
  const allowed = (ws,_actor,permission,scope={}) => ws === 'ws' && !denied.has(`${permission}:${scope.scope_id || ''}`);
  const create = extra => createRunCoordination(db,{runId:'run',input:{request_id:'request-1',kind:'steer',content:'Also verify the tests.',...extra},actor,allowed});
  return {db,actor,allowed,denied,create};
}

test('steering is a durable exactly-once pending next turn, not a provider call', t => {
  const f = fixture(t), item = f.create();
  assert.equal(item.state,'pending'); assert.equal(item.target_agent_id,'agent'); assert.equal(item.source_chat_id,'source');
  assert.equal(f.create().id,item.id); assert.equal(f.create().replayed,true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM run_coordination').get().n,1);
  assert.equal(f.db.prepare('SELECT status FROM runs').get().status,'running');
  assert.equal(f.db.prepare('SELECT count(*) n FROM messages').get().n,0);
  assert.throws(()=>f.create({content:'Changed'}),{code:'coordination_request_conflict'});
  const list = listRunCoordination(f.db,'run',f.actor,f.allowed);
  assert.deepEqual(list.capabilities,{native_steer:false,follow_up:'reviewed_next_turn',auto_dispatch:false});
  assert.equal(list.items[0].content,'Also verify the tests.');
  assert.doesNotMatch(JSON.stringify(list),/PRIVATE|source_access_json|target_scope_json/);
});

test('handoff targets require workspace, agent identity and both source/destination ACLs', t => {
  const f = fixture(t);
  for (const extra of [{kind:'handoff',target_chat_id:'foreign-chat',target_agent_id:'recipient'},{kind:'handoff',target_chat_id:'target',target_agent_id:'wrong-workspace'},{kind:'handoff',target_chat_id:'target'},{kind:'steer',target_agent_id:'recipient'},{kind:'handoff',target_chat_id:'source',target_agent_id:'agent'},{kind:'steer',author_type:'agent'}]) assert.throws(()=>f.create(extra));
  f.denied.add('chats.write:target-project');
  assert.throws(()=>f.create({kind:'handoff',target_chat_id:'target',target_agent_id:'recipient'}),{statusCode:403});
  f.denied.clear();
  const item = f.create({kind:'handoff',target_chat_id:'target',target_agent_id:'recipient'});
  assert.equal(item.target_agent_id,'recipient');
  f.denied.add('chats.read:target-project');
  assert.deepEqual(listRunCoordination(f.db,'run',f.actor,f.allowed).items,[]);
  assert.throws(()=>prepareRunCoordination(f.db,'run',item.id,f.actor,f.allowed),{statusCode:403});
});

test('prepared draft keeps immutable source lineage without copying private runtime data', t => {
  const f = fixture(t), item = f.create({kind:'handoff',target_chat_id:'target',target_agent_id:'recipient'});
  const prepared = prepareRunCoordination(f.db,'run',item.id,f.actor,f.allowed);
  const again = prepareRunCoordination(f.db,'run',item.id,f.actor,f.allowed);
  assert.equal(prepared.context_snapshot_id,again.context_snapshot_id); assert.equal(prepared.dispatched,false);
  assert.equal(prepared.agent_id,'recipient'); assert.equal(prepared.chat_id,'target');
  assert.doesNotMatch(JSON.stringify(prepared),/PRIVATE PROVIDER|PRIVATE PROTOCOL|PRIVATE NONCE/);
  assert.match(prepared.context.content,/Also verify the tests/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM chat_context_snapshots').get().n,1);
  const attachments = [{name:`talvori-context-${prepared.context.id}.md`,type:'text/markdown',content:prepared.context.content,rumbo_context_snapshot:prepared.context.id}];
  const inherited = chatContextSnapshotAccess(f.db,{chatId:'target',workspaceId:'ws',attachments,actor:f.actor,allowed:f.allowed});
  assert.ok(inherited.sources.some(ref=>ref.table==='documents'&&ref.id==='secret-doc'));
  f.db.prepare("UPDATE documents SET project_id='source-project' WHERE id='secret-doc'").run();
  f.denied.add('documents.read:secret-project');
  assert.throws(()=>chatContextSnapshotAccess(f.db,{chatId:'target',workspaceId:'ws',attachments,actor:f.actor,allowed:f.allowed}),{statusCode:403});
  assert.throws(()=>listRunCoordination(f.db,'run',f.actor,f.allowed),{statusCode:403});
});

test('destination historical scope stays protected after a conversation moves', t => {
  const f = fixture(t), item = f.create({kind:'handoff',target_chat_id:'target',target_agent_id:'recipient'});
  f.db.prepare("UPDATE chats SET project_id='source-project' WHERE id='target'").run();
  assert.throws(()=>prepareRunCoordination(f.db,'run',item.id,f.actor,f.allowed),{code:'coordination_target_changed'});
  f.denied.add('chats.read:target-project');
  assert.deepEqual(listRunCoordination(f.db,'run',f.actor,f.allowed).items,[]);
});

test('personal conversations require their exact bound agent', t => {
  const f = fixture(t);
  f.db.prepare("UPDATE chats SET kind='rumbo-agent' WHERE id='target'").run();
  assert.throws(()=>f.create({kind:'handoff',target_chat_id:'target',target_agent_id:'agent'}),/bound/);
  assert.equal(f.create({kind:'handoff',target_chat_id:'target',target_agent_id:'recipient'}).target_agent_id,'recipient');
});

test('Route-only destination conversations inherit their project write/run checks', t => {
  const f = fixture(t);
  f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?)').run('target-route','ws','target-project','target-area',null);
  f.db.prepare("UPDATE chats SET project_id=NULL,task_id='target-route' WHERE id='target'").run();
  f.denied.add('chats.write:target-project');
  assert.throws(()=>f.create({kind:'handoff',target_chat_id:'target',target_agent_id:'recipient'}),{statusCode:403});
  f.denied.clear();f.denied.add('agents.run:target-project');
  assert.throws(()=>f.create({kind:'handoff',target_chat_id:'target',target_agent_id:'recipient'}),{statusCode:403});
  f.denied.clear();assert.equal(f.create({kind:'handoff',target_chat_id:'target',target_agent_id:'recipient'}).target_chat_id,'target');
});

test('invalid/big requests, old unverifiable runs, and spoofed author fields fail closed', t => {
  const f = fixture(t);
  for (const extra of [{kind:'native-steer'},{content:''},{content:'x'.repeat(10001)},{content:'中'.repeat(5000)},{request_id:''},{request_id:'x\n'},{permissions:'workspace-write'},{dispatch:true}]) assert.throws(()=>f.create(extra));
  f.db.prepare('DELETE FROM run_context_snapshots').run();
  assert.throws(()=>f.create(),{code:'coordination_legacy_run'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM run_coordination').get().n,0);
});

test('another authorized reader can read but cannot prepare the sponsor’s draft', t => {
  const f = fixture(t), item = f.create();
  assert.equal(listRunCoordination(f.db,'run',{id:'reader'},f.allowed).items[0].can_prepare,false);
  assert.throws(()=>prepareRunCoordination(f.db,'run',item.id,{id:'reader'},f.allowed),{statusCode:403});
  assert.throws(()=>f.db.prepare("UPDATE run_coordination SET content='changed'").run(),/immutable/);
});

test('typed agent handoffs create attributed canonical messages but never launch a child', t => {
  const f = fixture(t);
  f.db.prepare("UPDATE runs SET status='completed'").run();
  const run = f.db.prepare('SELECT * FROM runs').get();
  const proposal = {type:'coordination.handoff',target_chat_id:'target',target_agent_id:'recipient',content:'Review this narrow result.'};
  const checked = validateLocalAction(f.db,proposal,'ws',{run});
  assert.equal(lowRiskAction(proposal),true);
  assert.equal(actionCatalog().find(item=>item.id==='coordination.handoff').execution,'local');
  f.db.exec('BEGIN');
  const result = executeLocalAction(f.db,{proposal,before:checked.before,workspaceId:'ws',run,actor:f.actor,allowed:f.allowed,idempotencyKey:'agent-action-1'});
  f.db.exec('COMMIT');
  assert.equal(result.resource,'run_coordination'); assert.equal(result.dispatched,false);
  const row = listRunCoordination(f.db,'run',f.actor,f.allowed).items[0];
  assert.equal(row.author_type,'agent'); assert.equal(row.source_agent_id,'agent'); assert.equal(row.target_agent_id,'recipient');
  assert.equal(f.db.prepare('SELECT count(*) n FROM runs').get().n,1);
  f.denied.add('documents.read:secret-project');
  assert.equal(localActionReadable(f.db,{proposal,before:checked.before,workspaceId:'ws',run,actor:f.actor,allowed:f.allowed}),false);
});

test('route receipts do not put protected coordination content into the general event stream', async t => {
  const f = fixture(t), emissions=[], responses=[];
  const params = {db:f.db,req:{method:'POST'},res:{},path:'/runs/run/coordination',body:{request_id:'route-1',kind:'handoff',target_chat_id:'target',target_agent_id:'recipient',content:'PROTECTED HANDOFF'},actor:f.actor,allowed:f.allowed,send:(_res,status,body)=>responses.push({status,body}),addRunEvent:(...args)=>emissions.push(args)};
  assert.equal(await runCoordinationRoute(params),true);
  assert.equal(await runCoordinationRoute(params),true);
  assert.equal(emissions.length,1); assert.doesNotMatch(JSON.stringify(emissions),/PROTECTED HANDOFF|target_chat_id|recipient/);
  assert.equal(responses[0].status,201); assert.equal(responses[1].status,200);
});

test('UI request and navigation helpers retain stable IDs and omit privilege fields', () => {
  assert.deepEqual(coordinationRequest({kind:'steer',content:'  Next  ',permission:'workspace-write'},'stable'),{kind:'steer',content:'Next',request_id:'stable'});
  assert.deepEqual(coordinationDestination({id:'coord',source_run_id:'run',target_chat_id:'chat',content:'PRIVATE'}),{chatId:'chat',options:{coordinationRunId:'run',coordinationId:'coord'}});
  assert.throws(()=>coordinationRequest({kind:'handoff',content:'Next'},'stable'));
  assert.deepEqual(recordedWorkEvents([{type:'agent.reasoning'},{type:'private.analysis'},{type:'command.output'},{type:'agent.progress'}]).map(item=>item.type),['command.output','agent.progress']);
  assert.equal(recordedWorkEvents(Array.from({length:500},()=>({type:'agent.progress'}))).length,300);
});

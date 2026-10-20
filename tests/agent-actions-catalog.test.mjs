import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApi } from '../server/local-api.mjs';
import { actionCatalog, validateLocalAction, actionPermissionTargets, authorizeLocalAction, assertActionFresh, executeLocalAction, localActionReadable } from '../server/agent-action-catalog.mjs';
import { captureAgentActions, agentAwarenessRoute, actionProtocol, workspaceAwareness, directActionPolicy, executeDirectAgentAction, installAgentAwareness } from '../server/agent-awareness.mjs';
import { captureRunContext } from '../server/run-context-store.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(),'rumbo-action-catalog-'));
  const api = createLocalApi({dataDir:directory,integrationOptions:{env:{},fetchImpl:()=>{throw Error('No external calls');}}});
  const db = new DatabaseSync(api.dbPath); db.exec('PRAGMA foreign_keys=ON');
  t.after(()=>{db.close();api.close();rmSync(directory,{recursive:true,force:true});});
  const now = '2026-10-08T12:00:00.000Z';
  for (const id of ['ws','foreign']) db.prepare('INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,id,id,now,now);
  db.prepare('INSERT INTO teams(id,workspace_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run('area','ws','Area',now,now);
  for (const [id,workspaceId] of [['project','ws'],['foreign-project','foreign']]) db.prepare('INSERT INTO projects(id,workspace_id,team_id,name,identifier,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,workspaceId,workspaceId === 'ws' ? 'area' : null,id,id,now,now);
  db.prepare('INSERT INTO tasks(id,workspace_id,project_id,team_id,number,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('route','ws','project','area',1,'Route',now,now);
  db.prepare('INSERT INTO chats(id,workspace_id,project_id,task_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('chat','ws','project','route','Chat',now,now);
  db.prepare('INSERT INTO agents(id,workspace_id,name,provider,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('agent','ws','Helper','codex',now,now);
  db.prepare('INSERT INTO runs(id,workspace_id,project_id,agent_id,provider,agent_name,status,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('run','ws','project','agent','codex','Helper','completed','Run',now,now);
  db.prepare('INSERT INTO agent_run_sponsors(run_id,actor_id) VALUES(?,?)').run('run','local-owner');
  const run = db.prepare('SELECT * FROM runs WHERE id=?').get('run'), actor = {id:'local-owner',name:'Owner'}, allowed = () => true;
  const validate = p => validateLocalAction(db,p,'ws',{run});
  const execute = (p, extra = {}) => {
    const snapshot = validate(p); db.exec('BEGIN IMMEDIATE');
    try { const result = executeLocalAction(db,{...snapshot,workspaceId:'ws',run,actor,allowed,idempotencyKey:extra.idempotencyKey || `fixture:${crypto.randomUUID()}`,...extra}); db.exec('COMMIT'); return result; }
    catch(error){db.exec('ROLLBACK');throw error;}
  };
  return {db,run,actor,allowed,validate,execute};
}

test('typed catalog and runtime protocol describe only executable local reviewed actions',t=>{
  const {db} = fixture(t), catalog = actionCatalog();
  assert.equal(catalog.length,23);
  assert.equal(new Set(catalog.map(item=>item.id)).size,catalog.length);
  for (const item of catalog) {assert.equal(item.review_required,true);assert.equal(item.execution,item.type === 'schedule.create' ? 'human_schedule_confirmation' : 'local');assert.equal(item.schema.additionalProperties,false);}
  assert.match(actionProtocol('nonce'),/record.create/); assert.match(actionProtocol('nonce'),/chat.note/);assert.match(actionProtocol('nonce'),/never by an agent action block/);
  const awareness = JSON.parse(workspaceAwareness(db,'ws'));
  assert.deepEqual(awareness.action_catalog,catalog); assert.equal(awareness.chats[0].id,'chat');assert.ok(Array.isArray(awareness.milestones));
  assert.ok(!JSON.stringify(catalog).includes('credentials'));
});

test('all five record kinds can be created, edited and recoverably archived without starting a run',t=>{
  const {db,execute} = fixture(t);
  const examples = {
    projects:{name:'Created project',team_id:'area',start_date:'2026-10-08',target_date:'2026-10-20'},
    tasks:{title:'Created Route',project_id:'project',priority:'high',due_at:'2026-10-15T09:00:00.000Z'},
    documents:{title:'Created doc',project_id:'project',content:'Actual content'},
    milestones:{title:'Created milestone',project_id:'project',target_date:'2026-10-20'},
    chats:{title:'Created chat',task_id:'route',pinned:true},
  };
  for (const [resource,fields] of Object.entries(examples)) {
    const created = execute({type:'record.create',resource,fields}); assert.equal(created.status,'applied');
    const row = db.prepare(`SELECT * FROM ${resource} WHERE id=?`).get(created.id);
    assert.equal(row.workspace_id,'ws');assert.equal(row[resource === 'projects' ? 'name' : 'title'],fields[resource === 'projects' ? 'name' : 'title']);
    if (resource === 'tasks') { assert.equal(row.team_id,'area');assert.equal(row.number,2); }
    if (resource === 'chats') {assert.equal(row.project_id,'project');assert.equal(row.pinned,1);}
    const patch = resource === 'projects' ? {name:'Renamed',target_date:null} : resource === 'documents' ? {title:'Renamed',content:'Edited content'} : resource === 'tasks' ? {title:'Renamed',priority:'urgent',due_at:null} : resource === 'chats' ? {title:'Renamed',pinned:false} : {title:'Renamed',status:'in_progress',target_date:null};
    execute({type:'record.update',resource,id:row.id,patch});
    const updated = db.prepare(`SELECT * FROM ${resource} WHERE id=?`).get(row.id);
    assert.equal(updated[resource === 'projects' ? 'name' : 'title'],'Renamed');
    execute({type:'record.archive',resource,id:row.id});assert.ok(db.prepare(`SELECT archived_at FROM ${resource} WHERE id=?`).get(row.id).archived_at);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM runs WHERE workspace_id=?').get('ws').n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM change_attribution WHERE actor_id=?').get('local-owner').n,15);
});

test('chat notes preserve truthful proposal attribution and memory stays source-agent/project scoped',t=>{
  const {db,execute} = fixture(t);
  const note = execute({type:'chat.note',chat_id:'chat',content:'A reviewed local note.'});
  const message = db.prepare('SELECT * FROM messages WHERE id=?').get(note.id);
  assert.equal(message.kind,'note');assert.equal(message.sender_type,'system');assert.equal(message.sender_id,'local-owner');
  assert.equal(JSON.parse(message.metadata_json).source_run_id,'run'); assert.equal(JSON.parse(message.metadata_json).approved_by,'local-owner');
  const memory = execute({type:'memory.create',title:'Preference',content:'Reference only.'});
  const row = db.prepare('SELECT * FROM agent_memories WHERE id=?').get(memory.id);
  assert.equal(row.agent_id,'agent');assert.equal(row.project_id,'project');assert.equal(row.source_run_id,'run');
  assert.equal(db.prepare('SELECT count(*) n FROM knowledge_entries WHERE workspace_id=?').get('ws').n,0);
});

test('scope validation rejects foreign/archived parents and does not allow authority fields',t=>{
  const {db,validate} = fixture(t);
  for (const proposal of [
    {type:'record.create',resource:'tasks',fields:{title:'Foreign',project_id:'foreign-project'}},
    {type:'record.create',resource:'documents',fields:{title:'No scope'}},
    {type:'record.create',resource:'documents',fields:{title:'Two scopes',team_id:'area',project_id:'project'}},
    {type:'record.create',resource:'milestones',fields:{title:'Missing project'}},
    {type:'record.create',resource:'projects',fields:{name:'Folder',local_path:'/private'}},
    {type:'record.create',resource:'chats',fields:{title:'Injected',participant_agent_ids_json:['agent']}},
    {type:'record.update',resource:'tasks',id:'route',patch:{project_id:'foreign-project'}},
    {type:'chat.note',chat_id:'chat',content:'Forged',sender_type:'agent'},
    {type:'settings.update',section:'agentDefaults',patch:{approvalMode:'never'}},
    {type:'settings.update',section:'appearance',patch:{theme:'dark',permissions:'all'}},
    {type:'record.create',resource:'tasks',fields:{title:'Invalid',due_at:'not-a-date'}},
    {type:'record.create',resource:'milestones',fields:{title:'Invalid',project_id:'project',target_date:'2026-02-30'}},
  ]) assert.throws(()=>validate(proposal));
  db.prepare('UPDATE projects SET archived_at=? WHERE id=?').run('2026-10-08','project');
  assert.throws(()=>validate({type:'chat.note',chat_id:'chat',content:'Note'}),/unavailable/);
  assert.throws(()=>validate({type:'record.create',resource:'tasks',fields:{title:'Archived',project_id:'project'}}),/unavailable/);
});

test('sub-route creation retains hierarchy scope, depth and completed-parent rules',t=>{
  const {db,validate,execute} = fixture(t);
  const child = execute({type:'record.create',resource:'tasks',fields:{title:'Child',parent_task_id:'route'}});
  const row = db.prepare('SELECT * FROM tasks WHERE id=?').get(child.id);
  assert.equal(row.project_id,'project');assert.equal(row.team_id,'area');
  assert.equal(db.prepare('SELECT parent_task_id FROM route_workflows WHERE id=?').get(child.id).parent_task_id,'route');
  assert.throws(()=>validate({type:'record.create',resource:'tasks',fields:{title:'Moved',parent_task_id:'route',project_id:null}}),/parent/);
  assert.throws(()=>execute({type:'record.update',resource:'tasks',id:'route',patch:{status:'done'}}),/unfinished sub-route/);
  let parent = child.id;
  for (let depth = 3; depth <= 5; depth++) parent = execute({type:'record.create',resource:'tasks',fields:{title:`Depth ${depth}`,parent_task_id:parent}}).id;
  assert.throws(()=>validate({type:'record.create',resource:'tasks',fields:{title:'Too deep',parent_task_id:parent}}),/five levels/);
});

test('target, parent and hierarchy changes invalidate exact snapshots',t=>{
  const {db,validate,execute} = fixture(t);
  const note = validate({type:'chat.note',chat_id:'chat',content:'Pending note'});
  db.prepare('UPDATE projects SET name=? WHERE id=?').run('Changed parent','project');
  assert.throws(()=>assertActionFresh(note.before,validate(note.proposal).before),/parent scope changed/);
  const proposal = validate({type:'record.update',resource:'tasks',id:'route',patch:{title:'New'}});
  execute({type:'record.create',resource:'tasks',fields:{title:'New child',parent_task_id:'route'}});
  assert.throws(()=>assertActionFresh(proposal.before,validate(proposal.proposal).before),/changed/);
  const create = validate({type:'record.create',resource:'documents',fields:{title:'Draft',project_id:'project'}});
  db.prepare('UPDATE projects SET target_date=? WHERE id=?').run('2026-10-25','project');
  assert.throws(()=>assertActionFresh(create.before,validate(create.proposal).before),/changed/);
});

test('both sponsor and reviewer need current target and parent read/write authority',t=>{
  const {db,run,actor,validate,execute} = fixture(t), proposal = {type:'record.create',resource:'documents',fields:{title:'Scoped doc',project_id:'project'}};
  const targets = actionPermissionTargets(db,proposal,'ws',{run});
  assert.ok(targets.some(target=>target.permission === 'documents.write' && target.scope.scope_id === 'project'));
  assert.ok(targets.some(target=>target.permission === 'projects.read' && target.scope.scope_id === 'project'));
  assert.throws(()=>authorizeLocalAction(db,{proposal,workspaceId:'ws',run,actors:[actor,{id:'revoked-sponsor'}],allowed:(_ws,who)=>who.id !== 'revoked-sponsor'}),/sponsor or reviewer/);
  assert.throws(()=>execute(proposal,{actors:[actor,{id:'sponsor'}],allowed:(_ws,_actor,permission)=>permission !== 'projects.read'}),/sponsor or reviewer/);
  assert.throws(()=>execute(proposal,{actors:[]}),/authority/);
  const settings = validate({type:'settings.update',section:'preferences',patch:{sendKey:'modifier'}});
  assert.throws(()=>execute(settings.proposal,{actor:{id:'member'},actors:[{id:'member'}]}),/sponsor or reviewer/);
  execute(settings.proposal); assert.equal(JSON.parse(db.prepare('SELECT value_json FROM settings WHERE key=?').get('preferences').value_json).sendKey,'modifier');
});

test('proposal receipt and local execution are atomic and exactly once across repeat decisions',async t=>{
  const {db,run,actor,allowed} = fixture(t), proposal = {type:'record.create',resource:'documents',fields:{title:'One only',project_id:'project'}};
  const block = `Review.\n\`\`\`rumbo-actions\n${JSON.stringify({nonce:'nonce',actions:[proposal]})}\n\`\`\``;
  let authorizations = 0;
  captureAgentActions(db,run.id,block,'nonce',{authorizeCapture:()=>{authorizations++;}});
  captureAgentActions(db,run.id,block,'nonce',{authorizeCapture:()=>{authorizations++;}});
  assert.throws(()=>captureAgentActions(db,run.id,block.replace('One only','Different'),'nonce'),/different immutable proposals/);
  assert.equal(db.prepare('SELECT count(*) n FROM agent_action_requests WHERE run_id=?').get(run.id).n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM documents WHERE workspace_id=?').get('ws').n,0);
  const action = db.prepare('SELECT * FROM agent_action_requests WHERE run_id=?').get(run.id);
  const decide = async () => agentAwarenessRoute({db,req:{method:'POST'},res:{},path:`/agent-actions/${action.id}/decision`,url:new URL('http://localhost'),readBody:async()=>({decision:'approve'}),send:()=>{},actor,allowed,authorizeProposal:()=>{authorizations++;}});
  await decide();await assert.rejects(decide(),/already resolved/);
  assert.equal(db.prepare('SELECT count(*) n FROM documents WHERE workspace_id=?').get('ws').n,1);
  const receipt = db.prepare('SELECT * FROM agent_action_requests WHERE id=?').get(action.id);
  assert.equal(receipt.status,'applied');assert.equal(JSON.parse(receipt.result_json).type,'record.create');
  assert.ok(authorizations >= 4);
});

test('review history protects captured and current scopes without hiding mere staleness',t=>{
  const {db,run,actor,allowed,validate} = fixture(t);
  const snapshot = validate({type:'record.update',resource:'tasks',id:'route',patch:{title:'Reviewed'}});
  const options = {...snapshot,workspaceId:'ws',run,actor,allowed};
  assert.equal(localActionReadable(db,options),true);
  db.prepare('UPDATE projects SET name=? WHERE id=?').run('Merely stale','project');
  assert.equal(localActionReadable(db,options),true);
  assert.equal(localActionReadable(db,{...options,allowed:(_ws,_actor,permission,scope)=>!(permission === 'workspace.read' && scope.scope_id === 'area')}),false);
  const now = '2026-10-08T12:00:00.000Z';
  db.prepare('INSERT INTO projects(id,workspace_id,name,identifier,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('moved','ws','Moved','MOVED',now,now);
  db.prepare('UPDATE tasks SET project_id=?,team_id=NULL WHERE id=?').run('moved','route');
  assert.equal(localActionReadable(db,{...options,allowed:(_ws,_actor,_permission,scope)=>scope.scope_id !== 'moved'}),false);
  assert.equal(localActionReadable(db,{...options,allowed:(_ws,_actor,_permission,scope)=>scope.scope_id !== 'project'}),false);
});

test('shared executor requires caller receipt transaction and rolls failed writes back',t=>{
  const {db,run,actor,allowed,validate,execute} = fixture(t);
  const snapshot = validate({type:'record.update',resource:'tasks',id:'route',patch:{title:'Blocked'}});
  assert.throws(()=>executeLocalAction(db,{...snapshot,workspaceId:'ws',run,actor,allowed,idempotencyKey:'outside'}),/receipt transaction/);
  assert.throws(()=>execute(snapshot.proposal,{activeRunsFor:()=>['active']}),/Stop linked/);
  assert.equal(db.prepare('SELECT title FROM tasks WHERE id=?').get('route').title,'Route');
  const fresh = validate({type:'record.create',resource:'documents',fields:{title:'Stale',project_id:'project'}});
  db.prepare('UPDATE projects SET name=? WHERE id=?').run('Changed','project');
  assert.throws(()=>execute(fresh.proposal,{before:fresh.before}),/changed/);
  assert.equal(db.prepare('SELECT count(*) n FROM documents WHERE workspace_id=?').get('ws').n,0);
});

async function enableDirect(f,enabled=true,actor=f.actor,capabilityVersion) {
  let response;
  await agentAwarenessRoute({db:f.db,req:{method:'POST'},res:{},path:'/agent-awareness',url:new URL('http://localhost'),readBody:async()=>({workspace_id:'ws',low_risk_actions:enabled,...(capabilityVersion === undefined ? {} : {capability_version:capabilityVersion})}),send:(_res,_status,body)=>{response=body;},actor,allowed:f.allowed});
  return response.low_risk_actions;
}
function pinDirect(f,policy=directActionPolicy(f.db,'ws',f.actor)) {
  captureRunContext(f.db,f.run.id,{finalPrompt:'Exact reviewed prompt',actionNonce:'nonce',manifest:{resolved:{workspace_id:'ws'},fingerprint:'fixture-reviewed',direct_action_policy:policy},sourceAccess:{version:1,workspace_id:'ws',sources:[],connections:[]}});
}
function directCapture(f,actions,options={}) {
  const text = `Requested.\n\`\`\`frondose-actions\n${JSON.stringify({nonce:'nonce',actions})}\n\`\`\``;
  const authorizeCapture = options.authorizeCapture || (()=>{});
  return captureAgentActions(f.db,f.run.id,text,'nonce',{authorizeCapture,executeDirect:request=>executeDirectAgentAction(f.db,{...request,actor:f.actor,allowed:f.allowed,authorizeCapture,...options})});
}

test('explicit actor policy + reviewed manifest permits safe Route create exactly once; risky edits remain pending',async t=>{
  const f=fixture(t);
  assert.equal(directActionPolicy(f.db,'ws',f.actor).enabled,false);
  await enableDirect(f); pinDirect(f);
  const actions=[{type:'record.create',resource:'tasks',fields:{title:'Direct Route',project_id:'project'}},{type:'record.update',resource:'tasks',id:'route',patch:{title:'Needs confirmation'}},{type:'record.archive',resource:'tasks',id:'route'},{type:'settings.update',section:'preferences',patch:{sendKey:'modifier'}}];
  const result=directCapture(f,actions);
  assert.match(result,/applied 1 low-risk/);
  directCapture(f,actions);
  assert.equal(f.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get('ws').n,2);
  assert.deepEqual(f.db.prepare('SELECT status FROM agent_action_requests ORDER BY rowid').all().map(x=>x.status),['applied','pending','pending','pending']);
  assert.equal(f.db.prepare('SELECT title,archived_at FROM tasks WHERE id=?').get('route').title,'Route');
  assert.equal(directActionPolicy(f.db,'ws',{id:'other-user'}).enabled,false);
  assert.equal(directActionPolicy(f.db,'foreign',f.actor).enabled,false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM runs').get().n,1);
});

test('self-link derives only canonical agent; Area/Route append and project membership never grant authority',async t=>{
  const f=fixture(t); await enableDirect(f); pinDirect(f);
  directCapture(f,[{type:'agent.self_link',resource:'teams',id:'area'},{type:'agent.self_link',resource:'tasks',id:'route'},{type:'agent.self_link',resource:'projects',id:'project'}]);
  assert.deepEqual(JSON.parse(f.db.prepare('SELECT default_agent_ids_json FROM area_settings WHERE id=?').get('area').default_agent_ids_json),['agent']);
  assert.deepEqual(JSON.parse(f.db.prepare('SELECT assignee_agent_ids_json FROM tasks WHERE id=?').get('route').assignee_agent_ids_json),['agent']);
  assert.equal(f.db.prepare('SELECT default_project_id,version FROM agents WHERE id=?').get('agent').default_project_id,null);
  assert.ok(f.db.prepare('SELECT * FROM agent_project_links WHERE project_id=? AND agent_id=?').get('project','agent'));
  assert.equal(f.db.prepare('SELECT permission_policy FROM area_settings WHERE id=?').get('area').permission_policy,'review');
  assert.equal(f.db.prepare('SELECT version FROM agents WHERE id=?').get('agent').version,1);
  for(const proposal of [{type:'agent.self_link',resource:'tasks',id:'route',agent_id:'forged'},{type:'agent.self_link',resource:'projects',id:'foreign-project'}]) assert.throws(()=>f.validate(proposal));
  const snapshot=f.validate({type:'agent.self_link',resource:'tasks',id:'route'});
  assert.equal(localActionReadable(f.db,{...snapshot,workspaceId:'ws',run:f.run,actor:f.actor,allowed:f.allowed}),true);
  assert.equal(localActionReadable(f.db,{...snapshot,workspaceId:'ws',run:f.run,actor:f.actor,allowed:(_ws,_who,_permission,scope)=>scope.scope_id !== 'area'}),false);
  assert.throws(()=>validateLocalAction(f.db,snapshot.proposal,'ws',{run:{...f.run,agent_id:'forged'}}),/source run/);
});

test('missing historical manifest, revocation and revoke/re-enable cannot authorize old replies',async t=>{
  for(const mode of ['historical','revoked','reenabled','other-actor','policy-permission-revoked']) {
    const f=fixture(t); await enableDirect(f);
    if(mode!=='historical') pinDirect(f);
    if(mode==='revoked'||mode==='reenabled') await enableDirect(f,false);
    if(mode==='reenabled') await enableDirect(f,true);
    directCapture(f,[{type:'record.create',resource:'tasks',fields:{title:'Review only'}}],mode==='other-actor'?{actor:{id:'other-user'}}:mode==='policy-permission-revoked'?{allowed:(_ws,_actor,permission)=>permission!=='agents.write'}:{});
    assert.equal(f.db.prepare('SELECT status FROM agent_action_requests').get().status,'pending',mode);
    assert.equal(f.db.prepare('SELECT count(*) n FROM tasks').get().n,1,mode);
  }
});

test('policy migration keeps existing enabled grants at their original capability version',t=>{
  const db = new DatabaseSync(':memory:'); t.after(()=>db.close());
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY);
    CREATE TABLE agent_direct_action_policy(workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(workspace_id,actor_id));
    INSERT INTO workspaces VALUES('ws');
    INSERT INTO agent_direct_action_policy VALUES('ws','owner',1,7);`);
  installAgentAwareness(db); installAgentAwareness(db);
  assert.deepEqual(directActionPolicy(db,'ws',{id:'owner'}),{enabled:true,version:7,capability_version:1,actor_id:'owner',workspace_id:'ws'});
});

test('handoff direct authority requires a fresh explicit capability opt-in, not a software upgrade',async t=>{
  for (const mode of ['legacy-policy','legacy-manifest','upgraded-old-turn','missing-captured-capability','unknown-capability','fresh-opt-in']) {
    const f=fixture(t), now='2026-10-20T00:00:00.000Z';
    f.db.prepare('UPDATE runs SET chat_id=? WHERE id=?').run('chat',f.run.id); f.run.chat_id='chat';
    f.db.prepare('INSERT INTO chats(id,workspace_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('target','ws','Destination',now,now);
    const version = ['missing-captured-capability','fresh-opt-in'].includes(mode) ? 2 : undefined;
    const policy = await enableDirect(f,true,f.actor,version);
    if (mode === 'legacy-manifest' || mode === 'missing-captured-capability') delete policy.capability_version;
    if (mode === 'unknown-capability') {
      f.db.prepare('UPDATE agent_direct_action_policy SET capability_version=99').run();
      policy.capability_version=99;
    }
    pinDirect(f,policy);
    if (mode === 'upgraded-old-turn') await enableDirect(f,true,f.actor,2);
    const proposal={type:'coordination.handoff',target_chat_id:'target',target_agent_id:'agent',content:'Review this narrow handoff next turn.'};
    directCapture(f,[proposal]); directCapture(f,[proposal]);
    const applied = mode === 'fresh-opt-in';
    assert.equal(f.db.prepare('SELECT status FROM agent_action_requests').get().status,applied ? 'applied' : 'pending',mode);
    assert.equal(f.db.prepare('SELECT count(*) n FROM run_coordination').get().n,applied ? 1 : 0,mode);
    assert.equal(f.db.prepare('SELECT count(*) n FROM runs').get().n,1,mode);
    assert.equal(f.db.prepare('SELECT count(*) n FROM messages').get().n,0,mode);
    if (applied) {
      const receipt=JSON.parse(f.db.prepare('SELECT result_json FROM agent_action_requests').get().result_json);
      assert.equal(receipt.dispatched,false); assert.equal(receipt.authorization,'actor_low_risk_policy');
    }
  }
});

test('capability upgrades are bounded explicit grants and legacy clients cannot broaden policies',async t=>{
  const f=fixture(t);
  assert.equal((await enableDirect(f)).capability_version,1);
  const upgraded=await enableDirect(f,true,f.actor,2);
  assert.equal(upgraded.capability_version,2);
  assert.equal((await enableDirect(f)).capability_version,1);
  for (const version of [null,0,3,99,'2',2.5]) await assert.rejects(enableDirect(f,true,f.actor,version),/explicit supported low-risk/);
  assert.match(actionProtocol('nonce',{enabled:true,capability_version:1}),/Handoff drafts are not included in this older opt-in/);
  assert.match(actionProtocol('nonce',{enabled:true,capability_version:2}),/Recording a reversible cross-conversation handoff draft is also enabled/);
  assert.match(actionProtocol('nonce',{enabled:true,capability_version:99}),/Every request requires human review/);
});

test('pre-capability reviewed manifests preserve only the originally enabled safe actions',async t=>{
  const f=fixture(t), policy=await enableDirect(f);
  delete policy.capability_version; pinDirect(f,policy);
  directCapture(f,[{type:'record.create',resource:'tasks',fields:{title:'Legacy safe Route'}},{type:'agent.self_link',resource:'projects',id:'project'}]);
  assert.deepEqual(f.db.prepare('SELECT status FROM agent_action_requests ORDER BY rowid').all().map(row=>row.status),['applied','applied']);
});

test('current source/target revocation and stale self-link target roll back writes and receipts',async t=>{
  for(const mode of ['source','target','stale','foreign-agent']) {
    const f=fixture(t); await enableDirect(f); pinDirect(f);
    if(mode==='foreign-agent') f.db.prepare('UPDATE agents SET workspace_id=? WHERE id=?').run('foreign','agent');
    let checks=0;
    const options={authorizeCapture:()=>{
      checks++;
      if(mode==='source' && checks>1) throw Error('Source revoked');
      if(mode==='stale' && checks>1) f.db.prepare('UPDATE tasks SET title=? WHERE id=?').run('Changed','route');
    },allowed:mode==='target'?(_ws,_actor,permission)=>permission !== 'routes.write':f.allowed};
    assert.throws(()=>directCapture(f,[{type:'agent.self_link',resource:'tasks',id:'route'}],options));
    assert.equal(f.db.prepare('SELECT count(*) n FROM agent_action_requests').get().n,0,mode);
    assert.deepEqual(JSON.parse(f.db.prepare('SELECT assignee_agent_ids_json FROM tasks WHERE id=?').get('route').assignee_agent_ids_json),[],mode);
  }
});

test('unapproved active-state Route creates stay pending and action blocks cannot schedule launches',async t=>{
  const f=fixture(t); await enableDirect(f); pinDirect(f);
  directCapture(f,[{type:'record.create',resource:'tasks',fields:{title:'Not low risk',status:'done'}}]);
  assert.equal(f.db.prepare('SELECT status FROM agent_action_requests').get().status,'pending');
  assert.throws(()=>f.validate({type:'schedule.create',prompt:'Paid launch',model:'invented',confirmed:true}));
  assert.throws(()=>f.validate({type:'agent.self_link',resource:'agents',id:'agent'}));
});

test('explicit link endpoint is additive/idempotent, supports multiple projects and filters both identities and parents',async t=>{
  const f=fixture(t);
  const request = async (method,body,allowed=f.allowed) => {
    let response;
    await agentAwarenessRoute({db:f.db,req:{method},res:{},path:'/agent-links',url:new URL('http://localhost/agent-links?workspace_id=ws'),readBody:async()=>body,send:(_res,_code,value)=>{response=value;},actor:f.actor,allowed});
    return response;
  };
  const timestamp='2026-10-19T00:00:00.000Z';
  f.db.prepare('INSERT INTO projects(id,workspace_id,name,identifier,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('project2','ws','Second','SECOND',timestamp,timestamp);
  for (const [target_type,target_id] of [['area','area'],['route','route'],['project','project'],['project','project2']]) {
    const body={workspace_id:'ws',agent_id:'agent',target_type,target_id};
    await request('POST',body); await request('POST',body);
  }
  const {links}=await request('GET'); assert.equal(links.length,4);
  assert.equal(f.db.prepare('SELECT count(*) n FROM agent_project_links').get().n,2);
  assert.equal(f.db.prepare('SELECT default_project_id FROM agents WHERE id=?').get('agent').default_project_id,null);
  assert.equal((await request('GET',null,(_ws,_actor,_perm,scope)=>scope.scope_id!=='agent')).links.length,0);
  assert.equal((await request('GET',null,(_ws,_actor,_perm,scope)=>scope.scope_id!=='area')).links.length,1);
  await assert.rejects(request('POST',{workspace_id:'ws',agent_id:'agent',target_type:'project',target_id:'foreign-project'}),/unavailable/);
  await assert.rejects(request('POST',{workspace_id:'ws',agent_id:'agent',target_type:'route',target_id:'route'},(_ws,_actor,permission)=>permission!=='routes.write'),/access/);
  await assert.rejects(request('POST',{workspace_id:'ws',agent_id:'agent',target_type:'route',target_id:'route',actor_id:'forged'}),/exact agent link/);
  f.db.prepare('UPDATE projects SET archived_at=? WHERE id=?').run(timestamp,'project');
  assert.equal((await request('GET')).links.length,2);
});

test('schedule intents are never direct authority and reject forged identity, invalid dates/zones and foreign chat scopes',async t=>{
  const f=fixture(t); await enableDirect(f); pinDirect(f);
  const proposal={type:'schedule.create',chat_id:'chat',content:'Future exact prompt',model:'model-id',run_at:'2026-11-01T00:00:00.000Z',timezone:'UTC'};
  directCapture(f,[proposal]);
  const receipt=f.db.prepare('SELECT * FROM agent_action_requests').get();
  assert.equal(receipt.status,'pending');
  assert.equal(f.db.prepare('SELECT count(*) n FROM scheduled_work').get().n,0);
  assert.throws(()=>f.execute(proposal),/explicitly confirm/);
  for(const patch of [{agent_id:'forged'},{run_at:'2026-02-30T01:00:00Z'},{timezone:'Invalid/Zone'},{model:''},{chat_id:'foreign-chat'},{recurrence:'hourly'}]) assert.throws(()=>f.validate({...proposal,...patch}));
  for (const recurrence of ['none','daily','weekly']) assert.equal(f.validate({...proposal,recurrence}).proposal.recurrence,recurrence);
  const snapshot=f.validate(proposal);
  f.db.prepare('UPDATE chats SET updated_at=? WHERE id=?').run('2026-10-19','chat');
  assert.doesNotThrow(()=>assertActionFresh(snapshot.before,f.validate(proposal).before));
  f.db.prepare('UPDATE chats SET title=? WHERE id=?').run('Changed scope context','chat');
  assert.throws(()=>assertActionFresh(snapshot.before,f.validate(proposal).before),/changed/);
});

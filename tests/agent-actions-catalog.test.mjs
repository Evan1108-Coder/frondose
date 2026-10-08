import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApi } from '../server/local-api.mjs';
import { actionCatalog, validateLocalAction, actionPermissionTargets, authorizeLocalAction, assertActionFresh, executeLocalAction, localActionReadable } from '../server/agent-action-catalog.mjs';
import { captureAgentActions, agentAwarenessRoute, actionProtocol, workspaceAwareness } from '../server/agent-awareness.mjs';

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
  assert.equal(catalog.length,19);
  assert.equal(new Set(catalog.map(item=>item.id)).size,catalog.length);
  for (const item of catalog) {assert.equal(item.review_required,true);assert.equal(item.execution,'local');assert.equal(item.schema.additionalProperties,false);}
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

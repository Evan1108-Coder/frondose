import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { safeAgentSettings, configurationSummary, emojiMetadata, messageReactionContext } from '../server/agent-workspace-context.mjs';
import { buildContextInspection } from '../server/context-inspector.mjs';
import { captureSourceAccess, assertSourceAccess } from '../server/context-source-access.mjs';
import { chatCollaborationRoute, installChatCollaboration } from '../server/chat-collaboration.mjs';

function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(()=>db.close());
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT,description TEXT,archived_at TEXT);
    CREATE TABLE settings(key TEXT PRIMARY KEY,value_json TEXT);
    CREATE TABLE teams(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,description TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,description TEXT,team_id TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE chats(id TEXT PRIMARY KEY,workspace_id TEXT,title TEXT,project_id TEXT,task_id TEXT,team_id TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE messages(id TEXT PRIMARY KEY,chat_id TEXT,sender_name TEXT,sender_type TEXT,content TEXT,metadata_json TEXT,attachments_json TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE workspace_items(id TEXT PRIMARY KEY,workspace_id TEXT,kind TEXT,name TEXT,payload_json TEXT,position INTEGER,version INTEGER,updated_at TEXT,archived_at TEXT);
    CREATE TABLE runs(id TEXT PRIMARY KEY,workspace_id TEXT,chat_id TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE run_context_snapshots(run_id TEXT PRIMARY KEY,inspection_json TEXT);
    INSERT INTO workspaces VALUES('ws','Workspace','Bounded context',NULL),('foreign','Other','SECRET FOREIGN',NULL);
    INSERT INTO teams VALUES('area-before','ws','Area','Accessible organization','2026-10-20',NULL);
    INSERT INTO projects VALUES('project','ws','Project','Brief','area-before','2026-10-20',NULL);
    INSERT INTO chats VALUES('chat','ws','Current chat',NULL,NULL,NULL,'2026-10-20',NULL),('other','ws','Selected past chat','project',NULL,NULL,'2026-10-19',NULL);
    INSERT INTO messages VALUES('m1','chat','You','user','Yes, helpful 👍','{}','[]','2026-10-20','2026-10-20'),('m2','chat','Talvori','agent','🙂 :ship-it:','{}','[]','2026-10-19','2026-10-19'),('hidden','other','Other','user','SECRET OTHER CHAT','{}','[]','2026-10-19','2026-10-19');`);
  installChatCollaboration(db);
  const setting = (key,value)=>db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(key,JSON.stringify(value));
  setting('appearance',{theme:'dark',density:'compact',reduceMotion:false,password:'SECRET PASSWORD',nested:{token:'SECRET NESTED'}});
  setting('notifications',{agentNeedsInput:true,runCompleted:false,runFailed:true,token:'SECRET NOTIFICATION'});
  setting('personalization',{instructions:'Use exact technical wording.'});
  setting('agentDefaults',{concurrentRuns:2,preserveRawEvents:true,approvalMode:'ask',capability:'SECRET CAPABILITY'});
  setting('inbox',{readIds:['SECRET READ RECEIPT']}); setting('connectionToken',{access_token:'SECRET TOKEN'});
  setting('rumboAgent:ws',{display_name:'Talvori',orb_color:'cyan',include_memory:true,guidelines:'Be direct.',native_tools:true});
  setting('rumboAgent:foreign',{display_name:'SECRET OTHER AGENT'});
  const item = (id,kind,name,payload,workspace='ws',archived=null)=>db.prepare('INSERT INTO workspace_items VALUES(?,?,?,?,?,0,1,?,?)').run(id,workspace,kind,name,JSON.stringify(payload),'2026-10-20',archived);
  item('ship','emoji','Ship it',{shortcode:'ship-it',symbol:'data:image/png;base64,SECRET IMAGE'});
  item('foreign-emoji','emoji','SECRET FOREIGN EMOJI',{shortcode:'foreign'},'foreign');
  item('old-emoji','emoji','Archived',{shortcode:'old'},'ws','2026-10-19');
  item('label','route_label','Research',{description:'Evidence first',color:'#333333'});
  item('template','route_template','Triage',{content:'Describe the issue',status:'backlog',fields:[{label:'Problem',type:'text',required:true,default_value:'SECRET DEFAULT',default:'SECRET DEFAULT TWO'}]});
  const expressions = {m1:[{id:'emoji:1f44d',color:null},{id:'custom:ship'},{id:'custom:foreign-emoji'},{id:'custom:old-emoji'},{id:'invented'}],hidden:[{id:'emoji:1f680'}]};
  db.prepare('INSERT INTO chat_collaboration VALUES(?,?,?,?,?)').run('chat','ws',1,JSON.stringify({reactions:expressions,bookmarks:['SECRET BOOKMARK'],drafts:[{content:'SECRET DRAFT'}]}),'2026-10-20');
  const inspect = extra=>buildContextInspection({db,workspaceId:'ws',chatId:'chat',prompt:'What is happening?',includeMemory:false,includeWorkspace:true,filter:value=>value,...extra});
  return {db,setting,item,inspect};
}

test('safe settings use exact typed fields and honor actor-filter redaction',t=>{
  const {db} = fixture(t), snapshot = safeAgentSettings(db,{workspaceId:'ws',filter:value=>value});
  assert.equal(snapshot.values.appearance.theme,'dark'); assert.equal(snapshot.values.notifications.runCompleted,false);
  assert.equal(snapshot.values['rumboAgent:ws'].display_name,'Talvori');
  assert.ok(!JSON.stringify(snapshot).includes('SECRET'));
  assert.equal(snapshot.values.agentDefaults.approvalMode,undefined); assert.equal(snapshot.values['rumboAgent:ws'].native_tools,undefined);
  assert.deepEqual(safeAgentSettings(db,{workspaceId:'ws',filter:value=>({...value,settings:{}})}).values,{});
  assert.deepEqual(safeAgentSettings(db,{workspaceId:'ws'}).values,{},'missing actor filter fails closed');
  assert.equal(safeAgentSettings(db,{filter:value=>value}).values.personalization.instructions,'Use exact technical wording.');
});

test('configuration exposes bounded template questions, not answers, defaults or emoji image payloads',t=>{
  const {db} = fixture(t);
  const template = configurationSummary(db.prepare("SELECT * FROM workspace_items WHERE id='template'").get());
  assert.deepEqual(template.questions,[{label:'Problem',type:'text',required:true}]);
  assert.ok(!JSON.stringify(template).includes('SECRET'));
  assert.deepEqual(emojiMetadata(db.prepare("SELECT * FROM workspace_items WHERE id='ship'").get()),{id:'custom:ship',name:'Ship it',shortcode:':ship-it:'});
  assert.equal(emojiMetadata(db.prepare("SELECT * FROM workspace_items WHERE id='old-emoji'").get()),null);
});

test('canonical reactions are message-limited, semantic and do not expose private collaboration state',t=>{
  const {db} = fixture(t), context = messageReactionContext(db,{workspaceId:'ws',chatId:'chat',messageIds:['m1'],filter:value=>value});
  assert.deepEqual(context.messages.map(value=>value.id),['m1']);
  assert.equal(context.messages[0].reactions.length,3);
  assert.equal(context.messages[0].reactions[0].emoji,'👍');
  assert.equal(context.messages[0].reactions[1].shortcode,':ship-it:');
  assert.deepEqual(context.messages[0].reactions[2],{id:'custom:old-emoji',name:'Archived',archived:true});
  assert.ok(!JSON.stringify(context).includes('SECRET'));
  const redacted = messageReactionContext(db,{workspaceId:'ws',chatId:'chat',messageIds:['m1'],filter:()=>({workspace_items:[]})});
  assert.equal(redacted.messages[0].reactions.length,1); assert.equal(redacted.customEmojis.length,0);
});

test('exact context contains safe settings, metadata and current-chat reactions with stable provenance',t=>{
  const {db,inspect} = fixture(t), before=db.prepare('SELECT total_changes() AS n').get().n, result=inspect();
  for(const value of ['Evidence first','Describe the issue',':ship-it:','👍','Use exact technical wording.']) assert.ok(result.finalPrompt.includes(value),value);
  assert.ok(!result.finalPrompt.includes('SECRET'));
  assert.ok(result.manifest.included.some(item=>item.kind==='message_reactions'&&item.id==='m1'));
  assert.ok(result.manifest.included.some(item=>item.kind==='settings'&&item.id==='appearance'));
  assert.ok(result.manifest.workspace_index.settings.note.includes('Browser-local'));
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before,'inspection is read-only');
  assert.deepEqual(result,inspect(),'canonical compilation is deterministic');
  const captured={...result,sourceAccess:captureSourceAccess(db,result)};
  assert.ok(captured.sourceAccess.sources.some(ref=>ref.table==='messages'&&ref.id==='m1'));
  assert.ok(captured.sourceAccess.sources.some(ref=>ref.table==='workspace_items'&&ref.id==='ship'));
  assert.ok(captured.sourceAccess.sources.some(ref=>ref.table==='settings'&&ref.id==='appearance'));
  assert.equal(assertSourceAccess(db,captured,{id:'local-owner'},()=>true),true);
  assert.throws(()=>assertSourceAccess(db,captured,{id:'other-member'},()=>true),{code:'context_access_revoked'});
});

test('owner settings stay protected when a reply is reused through another conversation',t=>{
  const {db,inspect}=fixture(t), result=inspect(), sourceAccess=captureSourceAccess(db,result);
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?)').run('run','ws','chat','2026-10-20','2026-10-20');
  db.prepare('INSERT INTO run_context_snapshots VALUES(?,?)').run('run',JSON.stringify({...result,sourceAccess}));
  db.prepare("UPDATE messages SET metadata_json=? WHERE id='m2'").run(JSON.stringify({run_id:'run'}));
  const derived={manifest:{resolved:{workspace_id:'ws'},included:[{kind:'message',id:'m2'}],excluded:[]}};
  derived.sourceAccess=captureSourceAccess(db,derived);
  assert.ok(derived.sourceAccess.sources.some(ref=>ref.table==='settings'));
  assert.equal(assertSourceAccess(db,derived,{id:'local-owner'},()=>true),true);
  assert.throws(()=>assertSourceAccess(db,derived,{id:'other-member'},()=>true),{code:'context_access_revoked'});
});

test('workspace/history opt-outs omit extra data and redacted actor settings never enter context',t=>{
  const {inspect}=fixture(t), redacted=inspect({filter:value=>({...value,...(value.settings?{settings:{}}:{})})});
  assert.ok(!redacted.finalPrompt.includes('Use exact technical wording.'));
  assert.ok(!redacted.manifest.included.some(value=>value.kind==='settings'));
  const minimal=inspect({includeWorkspace:false,includeChat:false});
  assert.ok(!minimal.manifest.included.some(value=>['settings','emoji','workspace_configuration','message_reactions','message'].includes(value.kind)));
});

test('reaction context inherits both current and historical conversation access',t=>{
  const {db,inspect}=fixture(t);
  db.prepare("UPDATE chats SET project_id='project' WHERE id='chat'").run();
  const result=inspect({includeWorkspace:false}), captured={...result,sourceAccess:captureSourceAccess(db,result)};
  db.prepare("UPDATE chats SET project_id=NULL WHERE id='chat'").run();
  assert.equal(assertSourceAccess(db,captured,{id:'local-owner'},()=>true),true);
  assert.throws(()=>assertSourceAccess(db,captured,{id:'local-owner'},(_ws,_actor,permission,scope)=>!(permission==='chats.read'&&scope.scope_id==='project')),{code:'context_access_revoked'});
  db.prepare("UPDATE chats SET archived_at='2026-10-21' WHERE id='chat'").run();
  assert.throws(()=>assertSourceAccess(db,captured,{id:'local-owner'},()=>true),{code:'context_access_revoked'});
});

test('reaction edits change the exact prompt fingerprint without exposing drafts or bookmarks',t=>{
  const {db,inspect}=fixture(t), before=inspect();
  db.prepare('UPDATE chat_collaboration SET payload_json=?,version=version+1 WHERE chat_id=?').run(JSON.stringify({reactions:{m1:[{id:'emoji:1f680'}]},drafts:[{content:'SECRET UNSENT'}],bookmarks:['SECRET BOOKMARK']}),'chat');
  const after=inspect();
  assert.notEqual(after.manifest.fingerprint,before.manifest.fingerprint);
  assert.ok(after.finalPrompt.includes('🚀')); assert.ok(!after.finalPrompt.includes('SECRET'));
  assert.equal(JSON.parse(after.manifest.included.find(value=>value.kind==='message_reactions').content)[0].emoji,'🚀');
});

test('catalog selection bounds report omissions, and total prompt budgets still apply',t=>{
  const {item,inspect}=fixture(t);
  for(let index=0;index<45;index++) item(`emoji-${index}`,'emoji',`Emoji ${index}`,{shortcode:`emoji-${index}`});
  const result=inspect();
  const catalog=result.manifest.workspace_index.categories.find(value=>value.kind==='emoji');
  assert.equal(catalog.readable_count,46); assert.equal(catalog.selected_count,40); assert.equal(catalog.omitted_count,6);
  const small=inspect({maxContextCharacters:2000,maxTotalCharacters:3000});
  assert.ok(small.finalPrompt.length<=3000); assert.ok(small.manifest.excluded.some(value=>value.reason==='context_budget'));
  assert.match(result.finalPrompt,/Do not pretend to be human/); assert.match(result.finalPrompt,/Reactions are expression, not consent/);
});

test('explicit past-message snapshots freeze reactions and retain custom-emoji provenance',async t=>{
  const {db}=fixture(t); let response;
  await chatCollaborationRoute({db,req:{method:'POST'},res:{},path:'/chat-collaboration/chat',url:new URL('http://fixture/'),readBody:async()=>({workspace_id:'ws',version:1,action:'context',sources:[{kind:'message',id:'m1'}]}),send:(_res,status,value)=>{assert.equal(status,200);response=value;},snapshot:()=>({}),actor:{id:'local-owner'},allowed:()=>true});
  assert.match(response.result.content,/Reactions \(expression only/); assert.ok(response.result.content.includes(':ship-it:'));
  assert.ok(!response.result.content.includes('SECRET'));
  const saved=db.prepare('SELECT source_access_json,content FROM chat_context_snapshots WHERE id=?').get(response.result.id);
  assert.ok(JSON.parse(saved.source_access_json).sources.some(ref=>ref.table==='workspace_items'&&ref.id==='ship'));
  db.prepare("UPDATE chat_collaboration SET payload_json='{}' WHERE chat_id='chat'").run();
  assert.equal(db.prepare('SELECT content FROM chat_context_snapshots WHERE id=?').get(response.result.id).content,saved.content,'later reactions do not rewrite a reviewed snapshot');
});

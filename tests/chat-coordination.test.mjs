import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinationDraft, personalComposerDefaults } from '../src/lib/chat-coordination.js';
import { pageHash, parsePage } from '../src/lib/navigation.js';
import { messageLinks, readerTarget, parseReaderTarget, recordedOutputs, runReviewRevision } from '../src/lib/message-resources.js';
import { restoreComposer,persistComposer,turnBlocker } from '../src/lib/chats.js';

const prepared = { chat_id:'chat_one',agent_id:'agent_two',content:'Review the selected source',dispatched:false,context:{id:'ctx_one',workspace_id:'ws_one',chat_id:'chat_one',content:'Frozen protected source',sources:[]} };
const empty = () => ({text:'',files:[],turn:null,context:null,replyTo:null,sending:false});
test('prepared handoff never starts a run or preserves native tool consent',()=>{
  assert.deepEqual(coordinationDraft(prepared,'chat_one',empty()),{text:prepared.content,recipient:'agent_two',permission:'conversation',context:prepared.context,replyTo:null,nativeTools:false,model:'',reasoning:''});
});
test('prepared handoff preserves dirty and uncertain drafts',()=>{
  for (const patch of [{text:'Unsent note'},{files:[{name:'a'}]},{turn:'uncertain'},{context:{id:'old'}},{replyTo:'message'},{sending:true}]) assert.throws(()=>coordinationDraft(prepared,'chat_one',{...empty(),...patch}),/current draft/);
  for(const patch of [{chat_id:'other'},{agent_id:null},{dispatched:true},{context:{...prepared.context,chat_id:'other'}}]) assert.throws(()=>coordinationDraft({...prepared,...patch},'chat_one',empty()),/does not match/);
});
test('coordination navigation roundtrips both references and rejects partial/malformed references',()=>{
  const hash=pageHash('chats','chat_one',{coordinationRunId:'run_one',coordinationId:'coord_one'});
  assert.equal(pageHash(parsePage(hash).view,parsePage(hash).id,parsePage(hash)),hash);
  assert.equal(parsePage('#/chats/chat_one?coordination=only').view,'overview');
  assert.throws(()=>pageHash('chats','chat_one',{coordinationId:'only'}));
});
test('temporary reader returns only to a canonical nonreader app route',()=>{
  const hash=pageHash('reader','document:doc_one',{returnTo:'#/chats/chat_one'});
  assert.equal(parsePage(hash).returnTo,'#/chats/chat_one');
  assert.equal(pageHash(parsePage(hash).view,parsePage(hash).id,parsePage(hash)),hash);
  for(const returnTo of ['https://evil.example','javascript:alert(1)','#/reader/document:x','#/chats/x?from=%23%2Foverview','#/chats/../..']) assert.throws(()=>pageHash('reader','document:a',{returnTo}));
  assert.equal(readerTarget('documents','a/b'),null);
  assert.equal(readerTarget('documents','x'.repeat(481)),null);
  assert.equal(parseReaderTarget('document:../file'),null);
});
test('resource cards distinguish real output associations and safe document/website links',()=>{
  assert.deepEqual(messageLinks('[Guide](#/docs/awareness) [Site](https://example.com/a) [Bad](javascript:x) [Repeat](https://example.com/a)').map(item=>item.kind),['document','website']);
  assert.equal(messageLinks('[bad](#/documents/a?junk=1)').length,0);
  assert.equal(recordedOutputs({outputs:[{id:'a',run_id:'run_one',title:'Real output'},{id:'b',run_id:'other'},{id:'c',run_id:'run_one',archived_at:'now'}]},'run_one').length,1);
});
test('personal direct-history context defaults respect opt-outs without replacing occupied drafts',()=>{
  const composer={...empty(),text:'Existing instruction',files:[{name:'keep.txt'}]};
  assert.deepEqual(personalComposerDefaults({include_memory:false,include_chat:false,include_workspace:false,context_pack_ids:['chosen']},composer),{memory:false,includeChat:false,includeWorkspace:false,contextPackIds:['chosen'],hasSavedPreferences:true,personalPreferencesInitialized:true});
  assert.equal(composer.text,'Existing instruction');assert.equal(composer.files[0].name,'keep.txt');
  for(const patch of [{turn:'uncertain'},{personalPreferencesInitialized:true},{sending:true}]) assert.equal(personalComposerDefaults({}, {...composer,...patch}),null);
});
test('an aborted personal preferences read cannot persist invented initialized defaults',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key) || null,setItem:(key,value)=>values.set(key,value)};
  const chat={id:'personal-chat',kind:'rumbo-agent',participant_agent_ids:['agent-one']},agents=[{id:'agent-one'}];
  persistComposer(chat.id,restoreComposer(chat,agents,storage),storage);
  const restored=restoreComposer(chat,agents,storage);
  assert.equal(restored.personalPreferencesInitialized,false);
  const patch=personalComposerDefaults({include_memory:false,include_chat:false,include_workspace:false},restored);
  assert.equal(patch.memory,false);assert.equal(patch.includeChat,false);assert.equal(patch.includeWorkspace,false);
  Object.assign(restored,patch);persistComposer(chat.id,restored,storage);
  assert.equal(restoreComposer(chat,agents,storage).personalPreferencesInitialized,true);
  assert.equal(personalComposerDefaults({},restoreComposer(chat,agents,storage)),null);
});
test('uncertain turn receipt recovery is not blocked by new-launch connection readiness',()=>{
  assert.equal(turnBlocker({agent:{id:'a'},readiness:{canStartLive:false},activeRun:{id:'busy'},files:[],permission:'workspace-write',recovering:true}),null);
  assert.ok(turnBlocker({agent:{id:'a'},readiness:{canStartLive:false,description:'Reconnect'},files:[]}));
});
test('late server capture receipts trigger a fresh result lookup for this exact run',()=>{
  const events=[{id:'end',run_id:'run_one',type:'run.completed'},{id:'other',run_id:'run_other',type:'review.captured'}];
  assert.equal(runReviewRevision(events,'run_one'),'');
  assert.equal(runReviewRevision([...events,{id:'captured',run_id:'run_one',type:'review.captured'}],'run_one'),'captured');
});

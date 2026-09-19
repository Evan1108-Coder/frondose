import test from 'node:test';
import assert from 'node:assert/strict';
import { indexChatActivity, matchingChats, defaultRecipient, turnBlocker, chatMarkdown, restoreComposer, persistComposer } from '../src/lib/chats.js';

test('chat indexes keep history in order and retries associated with the original message', () => {
  const messages = [{id:'b',chat_id:'c',created_at:'2026-02-01',content:'Sources'}, {id:'a',chat_id:'c',created_at:'2026-01-01',content:'Plan'}];
  const runs = [{id:'r2',chat_id:'c',source_message_id:'a',created_at:'2026-02-01'}, {id:'r1',chat_id:'c',source_message_id:'a',created_at:'2026-01-01'}];
  const result = indexChatActivity(messages, runs);
  assert.deepEqual(result.messagesByChat.get('c').map(x=>x.id), ['a','b']);
  assert.equal(result.runsByMessage.get('a').id,'r2');
  assert.deepEqual(matchingChats([{id:'c',title:'Review'}],result.messagesByChat,'source').map(x=>x.id),['c']);
  assert.equal(matchingChats([{id:'other',title:'Other'}],result.messagesByChat,'source').length,0);
});
test('single participant defaults to explicit agent selection, groups and missing agents to notes', () => {
  const agents=[{id:'one'},{id:'two'},{id:'old',archived_at:'yesterday'}];
  assert.equal(defaultRecipient({participant_agent_ids:['one']},agents),'one');
  assert.equal(defaultRecipient({participant_agent_ids:['one','two']},agents),'note');
  assert.equal(defaultRecipient({participant_agent_ids:['old']},agents),'note');
});
test('agent send guards distinguish notes, disconnected accounts, folders, active work and images', () => {
  const ready={agent:{id:'a'},readiness:{canStartLive:true},folder:'/project',files:[]};
  assert.equal(turnBlocker(ready),null);
  assert.equal(turnBlocker({agent:null}),null);
  assert.equal(turnBlocker({...ready,folder:null}),null);
  assert.match(turnBlocker({...ready,folder:null,permission:'read-only'}),/folder/);
  assert.match(turnBlocker({...ready,folder:null,permission:'workspace-write'}),/folder/);
  assert.match(turnBlocker({...ready,activeRun:{}}),/progress/);
  assert.match(turnBlocker({...ready,files:[{type:'image/png'}]}),/Image attachments/);
  assert.equal(turnBlocker({...ready,readiness:{description:'Not connected'}}),'Not connected');
});
test('Markdown export retains message text and attachment references', () => {
  const md=chatMarkdown({title:'Review'},[{sender_name:'Evan',content:'**Plan**',attachments:[{name:'spec.md'}]}]);
  assert.match(md,/# Review/);assert.match(md,/\*\*Plan\*\*/);assert.match(md,/Attachment: spec.md/);
});
test('uncertain delivery and retry keys survive leaving Chats and reloading without losing attachments', () => {
  const map = new Map(); const storage = {getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};
  const chat={id:'c',participant_agent_ids:['a']}, agents=[{id:'a'}];
  const composer=restoreComposer(chat,agents,storage);
  assert.equal(composer.permission,'conversation');
  Object.assign(composer,{text:'Review',turn:'original-turn',files:[{name:'spec.md',type:'text/plain',content:'Local first'}],retryKeys:{source:'original-retry'}});
  assert.equal(persistComposer('c',composer,storage),true);
  const restored=restoreComposer(chat,agents,storage);
  assert.equal(restored.turn,'original-turn');assert.equal(restored.retryKeys.source,'original-retry');
  assert.equal(restored.text,'Review');assert.equal(restored.files[0].content,'Local first');
  assert.equal(restored.recipient,'a');
  assert.equal(restored.permission,'conversation');
  restored.text='';restored.turn=null;persistComposer('c',restored,storage);
  assert.equal(restoreComposer(chat,agents,storage).text,'');
});

test('legacy draft migration removes the folder requirement but preserves uncertain project sends', () => {
  const saved={version:2,text:'Unsent draft',permission:'read-only'};
  const storage={getItem:()=>JSON.stringify(saved)};
  assert.equal(restoreComposer({id:'chat'},[],storage).permission,'conversation');
  saved.turn='uncertain-turn';
  assert.equal(restoreComposer({id:'chat'},[],storage).permission,'read-only');
  saved.turn=null;saved.permission='workspace-write';
  assert.equal(restoreComposer({id:'chat'},[],storage).permission,'workspace-write');
});

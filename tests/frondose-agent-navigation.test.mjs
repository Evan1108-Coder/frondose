import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePage, pageHash } from '../src/lib/navigation.js';
import { normalizeOrganization, NAV_ITEMS } from '../src/lib/organization.js';
import { describePage } from '../src/lib/workspace-experience.js';
import { persistComposer, restoreComposer } from '../src/lib/chats.js';

test('Frondose is a persistent first-class tab independent of connections', () => {
  assert.equal(NAV_ITEMS.find(item => item.id === 'rumbo-agent').label, 'Frondose');
  const preferences = normalizeOrganization({});
  assert.ok(preferences.layout.root.includes('rumbo-agent'));
  assert.equal(pageHash('rumbo-agent', 'chat-1'), '#/frondose-agent/chat-1');
  assert.equal(parsePage('#/frondose-agent/chat-1').id, 'chat-1');
  assert.equal(parsePage(pageHash('rumbo-agent','chat-1',{messageId:'message-1'})).messageId,'message-1');
  assert.equal(describePage({}, { view: 'rumbo-agent' }), 'Frondose');
  assert.equal(describePage({chats:[{id:'chat-1',title:'Release plan'}]}, {view:'rumbo-agent',id:'chat-1'}), 'Release plan');
});

test('model and context choices survive uncertain Frondose delivery without granting native tools', () => {
  const map = new Map();
  const storage = {getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};
  const chat = {id:'chat-1',participant_agent_ids:['agent-1']};
  const draft = restoreComposer(chat,[{id:'agent-1'}],storage);
  Object.assign(draft, {model:'fixture-model',reasoning:'medium',includeChat:false,includeWorkspace:true,contextPackIds:['pack-1'],nativeTools:true});
  persistComposer(chat.id,draft,storage);
  assert.equal(restoreComposer(chat,[{id:'agent-1'}],storage).nativeTools,false);
  draft.turn = 'uncertain-turn';
  persistComposer(chat.id,draft,storage);
  const restored = restoreComposer(chat,[{id:'agent-1'}],storage);
  assert.equal(restored.turn,'uncertain-turn');
  assert.equal(restored.model,'fixture-model');
  assert.equal(restored.reasoning,'medium');
  assert.equal(restored.includeChat,false);
  assert.equal(restored.includeWorkspace,true);
  assert.equal(restored.hasSavedPreferences,true);
  assert.deepEqual(restored.contextPackIds,['pack-1']);
});

test('workspace summaries default on only for dedicated assistant chats and an explicit off survives reload', () => {
  const storageValues = new Map();
  const storage = { getItem: key => storageValues.get(key), setItem: (key, value) => storageValues.set(key, value) };
  const chat = { id: 'assistant-chat', kind: 'rumbo-agent', participant_agent_ids: [] };
  assert.equal(restoreComposer({ id: 'ordinary-chat' }, [], storage).includeWorkspace, false);
  const draft = restoreComposer(chat, [], storage);
  assert.equal(draft.includeWorkspace, true);
  draft.includeWorkspace = false;
  draft.model = 'chosen-model';
  persistComposer(chat.id, draft, storage);
  const restored = restoreComposer(chat, [], storage);
  assert.equal(restored.text, '');
  assert.equal(restored.includeWorkspace, false);
  assert.equal(restored.model, 'chosen-model');
  assert.equal(restored.hasSavedPreferences, true);
});

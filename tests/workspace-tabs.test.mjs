import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorkspaceTab, initialWorkspaceTabs, normalizeWorkspaceTabs, readWorkspaceTabs, workspaceTabsReducer as reduce, persistedWorkspaceTabs, dedupeTabOrder, insertTabIdIntoOrder, safeWorkspaceFile, MAX_WORKSPACE_TABS } from '../src/lib/workspace-tabs.js';
import { registerWorkspaceNavigator, requestWorkspaceNavigation } from '../src/lib/workspace-navigation.js';

test('Orca-derived canonical ordering deduplicates and respects partitions', () => {
  assert.deepEqual(dedupeTabOrder(['a','b','a']), ['a','b']);
  const tabs = [{id:'a',isPinned:true},{id:'b'},{id:'c'}];
  assert.deepEqual(insertTabIdIntoOrder(['a','b'],tabs,'c',false,'b'),['a','b','c']);
  assert.deepEqual(insertTabIdIntoOrder(['a','b'],tabs,'c',true,'b'),['a','c','b']);
});
test('explicit low-level replacement retains slot identity (ordinary navigation uses the category policy)', () => {
  let state = initialWorkspaceTabs(); const id = state.activeTabId;
  for (const contentType of ['terminal','browser','editor','app']) {
    state = reduce(state,{type:'replace',tab:newWorkspaceTab(contentType,{path:'README.md',page:{view:'agents'}})});
    assert.equal(state.tabs.length,1); assert.equal(state.activeTabId,id); assert.equal(state.tabs[0].contentType,contentType);
  }
});
test('new tab, switch, close and reopen are view-only immutable operations', () => {
  const original = initialWorkspaceTabs(); const next = reduce(original,{type:'open'});
  assert.equal(original.tabs.length,1); assert.equal(next.tabs.length,2);
  const selected = reduce(next,{type:'select',id:original.activeTabId});
  assert.equal(selected.activeTabId,original.activeTabId);
  const closed = reduce(next,{type:'close',id:next.activeTabId});
  assert.equal(closed.tabs.length,1); assert.equal(reduce(closed,{type:'reopen'}).tabs.length,2);
  assert.equal(reduce(closed,{type:'close',id:closed.activeTabId}).tabs[0].contentType,'new-tab');
});
test('reorder and pin retain identities and reject unknown actions', () => {
  let state=reduce(initialWorkspaceTabs(),{type:'open'}); const id=state.activeTabId;
  state=reduce(state,{type:'pin',id}); assert.equal(state.tabs.find(t=>t.id===id).isPinned,true);
  state=reduce(state,{type:'move',id,index:0}); assert.equal(state.tabs[0].id,id);
  assert.equal(reduce(state,{type:'select',id:'unknown'}),state);
});
test('restoration drops malformed records, traversal, duplicate IDs and unsaved new files', () => {
  const valid=newWorkspaceTab('editor',{path:'notes/你好.md',rootVersion:'ea553653-e199-44cb-bccc-e2fd2e47b930'},'valid');
  const state=normalizeWorkspaceTabs({version:1,activeTabId:'bad',tabs:[valid,valid,{...valid,id:'bad',path:'../private'}, {...valid,id:'draft',draft:true}]});
  assert.equal(state.tabs.length,1); assert.equal(state.activeTabId,'valid');
  assert.equal(state.tabs[0].rootVersion,valid.rootVersion);
  for (const path of ['/tmp/a','../a','a/../b','C:\\private','a\0b']) assert.equal(safeWorkspaceFile(path),false);
});
test('persistence never contains runtime commands, keys, file contents or agent instructions', () => {
  const tab={...newWorkspaceTab('terminal'),command:'rm -r',content:'secret',apiKey:'private',instructions:'hidden'};
  const text=JSON.stringify(persistedWorkspaceTabs({tabs:[tab],activeTabId:tab.id}));
  for(const forbidden of ['secret','apiKey','rm -r','hidden']) assert.equal(text.includes(forbidden),false);
  assert.equal(text.includes('color'),false);
});
test('tab count is bounded and corrupted preferences recover to usable app page', () => {
  let state=initialWorkspaceTabs(); for(let i=0;i<100;i++) state=reduce(state,{type:'open'});
  assert.equal(state.tabs.length,MAX_WORKSPACE_TABS); assert.equal(normalizeWorkspaceTabs(null).tabs.length,1);
});
test('workspace navigation guard can defer without executing and cannot unregister another host', () => {
  let commits=0, pending;
  const dispose=registerWorkspaceNavigator((target,commit)=>{pending=commit;assert.equal(target.view,'agents');});
  requestWorkspaceNavigation({view:'agents'},()=>commits++); assert.equal(commits,0); pending(); assert.equal(commits,1);
  const newer=registerWorkspaceNavigator((_target,commit)=>commit()); dispose();
  requestWorkspaceNavigation(null,()=>commits++); assert.equal(commits,2); newer();
});

test('explicit deep links take precedence over stale saved app or runtime views', () => {
  for (const kind of ['app', 'terminal', 'browser']) {
    const state = reduce(initialWorkspaceTabs({ view: 'tasks' }), { type: 'replace', tab: newWorkspaceTab(kind, { page: { view: 'tasks' } }) });
    const storage = { getItem: () => JSON.stringify(persistedWorkspaceTabs(state)) };
    const restored = readWorkspaceTabs(storage, 'ws', { view: 'agents' });
    assert.equal(restored.tabs.length, kind === 'app' ? 1 : 2);
    const active = restored.tabs.find(tab => tab.id === restored.activeTabId);
    assert.equal(active.contentType, 'app');
    assert.equal(active.page.view, 'agents'); assert.equal(active.label, 'Your agents');
    if (kind !== 'app') assert.deepEqual(restored.tabs[0], state.tabs[0]);
  }
});

test('reload at the accepted app route restores runtime identity without execution', () => {
  const state = reduce(initialWorkspaceTabs({ view: 'tasks' }), { type: 'replace', tab: newWorkspaceTab('terminal', { entityId: 'terminal_fixture' }) });
  const storage = { getItem: () => JSON.stringify(persistedWorkspaceTabs(state)) };
  const restored = readWorkspaceTabs(storage, 'ws', { view: 'tasks' });
  assert.equal(restored.tabs[0].contentType, 'terminal'); assert.equal(restored.tabs[0].entityId, 'terminal_fixture');
});

test('Settings is never created or restored as a workspace tab', () => {
  assert.throws(() => newWorkspaceTab('app', { page: { view: 'settings', id: 'appearance' } }), /separate screen/);
  const terminal = newWorkspaceTab('terminal', { entityId: 'native_fixture' });
  const restored = normalizeWorkspaceTabs({ version: 1, activeTabId: 'old_settings', lastPageHash: '#/settings/appearance', tabs: [terminal, { id: 'old_settings', entityId: 'old_settings', contentType: 'app', page: { view: 'settings', id: 'appearance' }, label: 'Settings' }] });
  assert.equal(restored.tabs.length, 1); assert.equal(restored.tabs[0].entityId, 'native_fixture');
  assert.equal(restored.lastPageHash, '#/overview');
  assert.equal(initialWorkspaceTabs({ view: 'settings' }).tabs[0].page.view, 'overview');
});

 test('To Do List uses its full title and migrates automatic labels without changing custom names',()=>{assert.equal(newWorkspaceTab('app',{page:{view:'todos'},label:'todos'}).label,'To Do List');assert.equal(newWorkspaceTab('app',{page:{view:'todos'},label:'Todos',customLabel:'My plan'}).label,'My plan');});

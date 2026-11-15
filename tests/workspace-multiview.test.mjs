import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorkspaceTab, initialWorkspaceTabs, workspaceTabsReducer as reduce, workspaceTabViews, activeWorkspaceView, persistedWorkspaceTabs, normalizeWorkspaceTabs } from '../src/lib/workspace-tabs.js';
import { automaticViewLayout, normalizeViewLayout, layoutViewIds, insertViewLayout, resizeViewLayout, MAX_TAB_VIEWS } from '../src/lib/workspace-view-layout.js';
const terminal = id => newWorkspaceTab('terminal',{providerId:'codex',entityId:`native_${id}`,projectId:'project_fixture',label:'Codex'},id);
test('AI CLI survives every ordinary replacement without changing native identity',()=>{
  for(const kind of ['app','editor','terminal','browser','new-tab']){
    let state=initialWorkspaceTabs();state=reduce(state,{type:'replace',tab:terminal('source')});
    const original=state.tabs[0];state=reduce(state,{type:'replace',tab:newWorkspaceTab(kind,{page:{view:'projects'},path:'README.md',rootVersion:'root_fixture'})});
    assert.equal(state.tabs.length,2);assert.deepEqual(state.tabs[0],original);assert.equal(state.tabs[0].entityId,'native_source');
  }
});
test('tab custom name survives replacement, title updates, save and preferences reload',()=>{
  let state=initialWorkspaceTabs();const id=state.activeTabId;
  state=reduce(state,{type:'rename',id,label:'My reference'});
  state=reduce(state,{type:'replace',tab:newWorkspaceTab('browser',{label:'Browser'})});
  state=reduce(state,{type:'label',id,label:'Website title'});assert.equal(state.tabs[0].label,'My reference');
  state=reduce(state,{type:'replace',tab:newWorkspaceTab('editor',{path:'readme.md',rootVersion:'root_fixture'})});
  state=reduce(state,{type:'saved',id,path:'new.md'});assert.equal(state.tabs[0].label,'My reference');
  assert.equal(normalizeWorkspaceTabs(persistedWorkspaceTabs(state)).tabs[0].label,'My reference');
});
test('two through eight views group without duplicating or launching their backing sessions',()=>{
  let state=initialWorkspaceTabs();state=reduce(state,{type:'replace',tab:terminal('first')});const owner=state.activeTabId;
  for(let i=1;i<MAX_TAB_VIEWS;i++){
    const tab=newWorkspaceTab('browser',{entityId:`browser_${i}`,label:`Reference ${i}`});state=reduce(state,{type:'open',tab});state=reduce(state,{type:'group-tabs',id:tab.id,targetId:owner});
    assert.equal(state.tabs.length,1);assert.equal(state.tabs[0].views.length,i+1);
  }
  assert.equal(workspaceTabViews(state.tabs[0])[0].entityId,'native_first');
  const ninth=newWorkspaceTab();state=reduce(state,{type:'open',tab:ninth});const next=reduce(state,{type:'group-tabs',id:ninth.id,targetId:owner});assert.equal(next,state);
});
test('focused AI inside a group is protected but replacing an ordinary sibling preserves the CLI',()=>{
  let state=reduce(initialWorkspaceTabs(),{type:'replace',tab:terminal('native')});const owner=state.activeTabId;
  const browser=newWorkspaceTab('browser',{label:'Browser'});state=reduce(state,{type:'open',tab:browser});state=reduce(state,{type:'group-tabs',id:browser.id,targetId:owner});
  const spawned=reduce(state,{type:'replace',tab:newWorkspaceTab('app',{page:{view:'tasks'}})});assert.equal(spawned.tabs.length,2);
  state=reduce(state,{type:'focus-view',id:browser.id});state=reduce(state,{type:'replace',tab:newWorkspaceTab('app',{page:{view:'projects'}})});
  assert.equal(state.tabs.length,1);assert.equal(state.tabs[0].views[0].providerId,'codex');assert.equal(activeWorkspaceView(state.tabs[0]).page.view,'projects');
});
test('group identity, orientation and bounded layout survive restart without executable content',()=>{
  let state=initialWorkspaceTabs();state=reduce(state,{type:'group-tabs',id:state.activeTabId});state=reduce(state,{type:'orientation',value:'vertical'});
  state.tabs[0].views[0].command='not portable';state.tabs[0].views[0].launchRequestId='never restore';
  const persisted=persistedWorkspaceTabs(state),json=JSON.stringify(persisted);assert(!json.includes('not portable'));assert(!json.includes('never restore'));
  const restored=normalizeWorkspaceTabs(persisted);assert.equal(restored.orientation,'vertical');assert.equal(restored.tabs[0].views.length,2);
  assert.deepEqual(layoutViewIds(restored.tabs[0].layout),restored.tabs[0].views.map(v=>v.id));
});
test('file save targets a group leaf even when its ID is also the container ID',()=>{
  let state=reduce(initialWorkspaceTabs(),{type:'replace',tab:newWorkspaceTab('editor',{path:'x.md',draft:true,rootVersion:'old',projectId:'project_fixture'})});const id=state.activeTabId;
  state=reduce(state,{type:'group-tabs',id});state=reduce(state,{type:'saved',id,path:'actual.md'});
  assert.equal(state.tabs[0].views[0].path,'actual.md');assert.equal(state.tabs[0].views[0].draft,false);
  state=reduce(state,{type:'binding-changed',binding:{projectId:'project_fixture',version:'new'},editorEntityIds:[state.tabs[0].views[0].entityId]});assert.equal(state.tabs[0].views[0].rootVersion,'new');
});
test('detaching a pane preserves native entity identity, not an execution request',()=>{
  let state=reduce(initialWorkspaceTabs(),{type:'replace',tab:terminal('one')});const id=state.activeTabId;state=reduce(state,{type:'group-tabs',id});
  state=reduce(state,{type:'detach-view',id});assert.equal(state.tabs.length,2);assert.equal(activeWorkspaceView(state.tabs.find(t=>t.id===state.activeTabId)).entityId,'native_one');
});
test('layout validation rejects duplicate, missing, excessive and malicious trees',()=>{
  for(let n=1;n<=8;n++){const ids=Array.from({length:n},(_,i)=>`v${i}`),tree=automaticViewLayout(ids);assert.deepEqual(layoutViewIds(normalizeViewLayout(tree,ids)),ids);}
  assert.equal(automaticViewLayout(Array.from({length:9},(_,i)=>`${i}`)),null);
  const ids=['a','b'],bad={type:'split',axis:'row',ratio:NaN,first:{type:'view',id:'a'},second:{type:'view',id:'a'}};
  assert.deepEqual(layoutViewIds(normalizeViewLayout(bad,ids)),ids);
  assert.throws(()=>newWorkspaceTab('group',{views:[terminal('same'),terminal('same')]}),/Duplicate/);
});
test('edge docking creates rows/columns and resizing is clamped',()=>{
  const original=automaticViewLayout(['a']);const row=insertViewLayout(original,'a',['b'],'right'),column=insertViewLayout(original,'a',['b'],'bottom');
  assert.equal(row.axis,'row');assert.equal(column.axis,'column');assert.equal(resizeViewLayout(row,row.id,2).ratio,.88);assert.equal(resizeViewLayout(row,row.id,-1).ratio,.12);
});

test('runtime entity identifiers are bounded and invalid persisted leaves cannot alias drafts',()=>{
  for(const entityId of ['',null,42,'<script>','../draft','x'.repeat(101),'line\nbreak']) assert.throws(()=>newWorkspaceTab('editor',{entityId,path:'safe.md',rootVersion:'root_a'}),/identity/);
  const good=newWorkspaceTab('editor',{entityId:'safe_draft',path:'safe.md',rootVersion:'root_a'},'good');
  const bad={...good,id:'bad',entityId:'../escape'};
  const restored=normalizeWorkspaceTabs({version:1,tabs:[bad,good],activeTabId:'bad'});
  assert.equal(restored.tabs.length,1);assert.equal(restored.tabs[0].id,'good');assert.equal(restored.activeTabId,'good');
});

test('restore globally dedupes leaf IDs and runtime entities across top-level and grouped views',()=>{
  const first=newWorkspaceTab('editor',{entityId:'draft_shared',path:'a.md',rootVersion:'root_a'},'first');
  const entityAlias={...first,id:'different_id',path:'b.md'};
  const idAlias={...first,entityId:'different_entity',path:'c.md'};
  const retained=newWorkspaceTab('browser',{entityId:'browser_retained'},'retained');
  const group={id:'container',contentType:'group',views:[entityAlias,idAlias,retained],activeViewId:'different_id'};
  const restored=normalizeWorkspaceTabs({version:1,tabs:[first,group,{...retained,id:'last_alias'}],activeTabId:'container'});
  const leaves=restored.tabs.flatMap(workspaceTabViews);
  assert.deepEqual(leaves.map(v=>v.id),['first','retained']);
  assert.deepEqual(leaves.map(v=>v.entityId),['draft_shared','browser_retained']);
  assert.equal(restored.tabs[1].activeViewId,'retained');
});

test('container IDs alias only their own first leaf; foreign collisions are filtered deterministically',()=>{
  const first=newWorkspaceTab('browser',{},'container');
  const second=newWorkspaceTab('browser',{},'other');
  const allowed=newWorkspaceTab('group',{views:[first,second]},'container');
  assert.equal(normalizeWorkspaceTabs({version:1,tabs:[allowed]}).tabs[0].views[0].id,'container');
  assert.throws(()=>newWorkspaceTab('group',{views:[second,first]},'container'),/first view/);
  const foreignGroup={id:'foreign_group',contentType:'group',views:[{...second,id:'container',entityId:'foreign_entity'},newWorkspaceTab('browser',{},'unique')]};
  const restored=normalizeWorkspaceTabs({version:1,tabs:[allowed,foreignGroup]});
  assert.deepEqual(restored.tabs.flatMap(workspaceTabViews).map(v=>v.id),['container','other','unique']);
  const collision={id:'other',contentType:'group',views:[newWorkspaceTab('browser',{},'new_leaf')]};
  assert.equal(normalizeWorkspaceTabs({version:1,tabs:[allowed,collision]}).tabs.length,1);
});

test('open and merge cannot attach a second renderer to the same runtime entity',()=>{
  let state=reduce(initialWorkspaceTabs(),{type:'replace',tab:terminal('native_original')});
  const duplicate=terminal('duplicate');duplicate.entityId=activeWorkspaceView(state.tabs[0]).entityId;
  assert.equal(reduce(state,{type:'open',tab:duplicate}),state);
  // Defense against old in-memory states as well as normalized preferences.
  const forged={...state,tabs:[...state.tabs,duplicate]};
  assert.equal(reduce(forged,{type:'group-tabs',id:duplicate.id,targetId:state.activeTabId}),forged);
  const sourceGroup=newWorkspaceTab('group',{views:[duplicate,newWorkspaceTab('browser',{},'source_extra')]},duplicate.id);
  const forgedGroups={...state,tabs:[...state.tabs,sourceGroup]};
  assert.equal(reduce(forgedGroups,{type:'group-tabs',id:sourceGroup.id,targetId:state.activeTabId}),forgedGroups);
});

test('detaching first or later group leaves preserves unique runtime identities through reload',()=>{
  for(const detachIndex of [0,1,2]){
    const views=[terminal('first_runtime'),newWorkspaceTab('browser',{},'second_view'),newWorkspaceTab('editor',{path:'notes.md',rootVersion:'root_a'},'third_view')];
    const group=newWorkspaceTab('group',{views},views[0].id);
    const state={version:1,tabs:[group],activeTabId:group.id,lastPageHash:'#/workspace',recentlyClosed:[]};
    const detached=reduce(state,{type:'detach-view',id:views[detachIndex].id});
    const restored=normalizeWorkspaceTabs(persistedWorkspaceTabs(detached));
    const leaves=restored.tabs.flatMap(workspaceTabViews);
    assert.equal(leaves.length,3);assert.equal(new Set(leaves.map(v=>v.id)).size,3);assert.equal(new Set(leaves.map(v=>v.entityId)).size,3);
    assert.deepEqual(new Set(leaves.map(v=>v.entityId)),new Set(views.map(v=>v.entityId)));
  }
});

test('binding refresh advances only explicitly safe editor entities in the matching project',()=>{
  const make=(id,projectId='project_fixture')=>newWorkspaceTab('editor',{entityId:`draft_${id}`,path:`${id}.md`,projectId,rootVersion:'old'},id);
  const clean=make('clean'),dirty=make('dirty'),pending=make('pending'),other=make('other','other_project');
  const group=newWorkspaceTab('group',{views:[clean,dirty,pending]},clean.id);
  let state={version:1,tabs:[group,other],activeTabId:group.id,lastPageHash:'#/workspace',recentlyClosed:[]};
  const binding={projectId:'project_fixture',version:'new'};
  assert.equal(reduce(state,{type:'binding-changed',binding}),state);
  assert.equal(reduce(state,{type:'binding-changed',binding,editorEntityIds:[]}),state);
  state=reduce(state,{type:'binding-changed',binding,editorEntityIds:[clean.entityId,other.entityId,'<invalid>']});
  const leaves=state.tabs.flatMap(workspaceTabViews);
  assert.equal(leaves.find(v=>v.id==='clean').rootVersion,'new');
  for(const id of ['dirty','pending','other'])assert.equal(leaves.find(v=>v.id===id).rootVersion,'old');
});

test('duplicate split-node IDs normalize uniquely and one divider resize affects one node only',()=>{
  const leaf=id=>({type:'view',id});
  const tree={type:'split',id:'duplicate',axis:'column',ratio:.5,first:{type:'split',id:'duplicate',axis:'row',ratio:.3,first:leaf('a'),second:leaf('b')},second:{type:'split',id:'duplicate',axis:'row',ratio:.7,first:leaf('c'),second:leaf('d')}};
  const normalized=normalizeViewLayout(tree,['a','b','c','d']);
  const splits=node=>!node||node.type==='view'?[]:[node,...splits(node.first),...splits(node.second)];
  const before=splits(normalized);assert.equal(new Set(before.map(node=>node.id)).size,3);
  const resized=resizeViewLayout(normalized,before[1].id,.6),after=splits(resized);
  assert.equal(after.filter((node,index)=>node.ratio!==before[index].ratio).length,1);
  const raw=resizeViewLayout(tree,'duplicate',.8);assert.equal(raw.ratio,.8);assert.equal(raw.first.ratio,.3);assert.equal(raw.second.ratio,.7);
  assert.deepEqual(automaticViewLayout(['a','b','c','d']),automaticViewLayout(['a','b','c','d']));
});

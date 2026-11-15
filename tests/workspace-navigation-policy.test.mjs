import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformSync } from 'esbuild';
import { newWorkspaceTab, workspaceNavigationDisposition, workspaceTabsReducer as reduce, workspaceTabViews, activeWorkspaceView, MAX_WORKSPACE_TABS, readWorkspaceTabs, persistedWorkspaceTabs } from '../src/lib/workspace-tabs.js';
const single = tab => ({version:1,tabs:[tab],activeTabId:tab.id,lastPageHash:'#/projects',orientation:'horizontal',recentlyClosed:[]});
const tab = (kind, name='first') => newWorkspaceTab(kind, {label:name,path:`${name}.md`,rootVersion:'root',projectId:'project',page:{view:name==='first'?'projects':'tasks'},...(kind==='terminal'?{providerId:'codex'}:{})});
test('navigation replaces only app/sidebar peers or file peers, and consumes empty choosers',()=>{
  for(const from of ['app','editor','terminal','browser','new-tab']) for(const to of ['app','editor','terminal','browser','new-tab']) {
    const before=tab(from),incoming=tab(to,'second'),state=single(before);
    const next=reduce(state,{type:'navigate',tab:incoming});
    const replace=from==='new-tab'||from==='app'&&['app','new-tab'].includes(to)||from==='editor'&&to==='editor';
    if(from==='new-tab'&&to==='new-tab'){assert.equal(next,state);continue;}
    assert.equal(next.tabs.length,replace?1:2,`${from} -> ${to}`);
    if(replace){assert.equal(next.activeTabId,before.id);assert.equal(next.tabs[0].contentType,to);}
    else {assert.deepEqual(next.tabs[0],before);assert.equal(next.activeTabId,incoming.id);}
  }
});
test('same saved file and same page are reused without losing draft/scroll identity or custom names',()=>{
  for(const kind of ['editor','app']) {const before=tab(kind),renamed={...before,customLabel:'My name',label:'My name'},state=single(renamed);assert.equal(reduce(state,{type:'navigate',tab:tab(kind)}),state);}
  assert.equal(workspaceNavigationDisposition(tab('editor'),{...tab('editor'),rootVersion:'different'}),'replace');
  const editor=tab('editor'),state=single({...editor,customLabel:'Custom',label:'Custom'});
  const peer=reduce(state,{type:'navigate',tab:tab('editor','next')});assert.equal(peer.tabs[0].customLabel,'Custom');
  const cross=reduce(state,{type:'navigate',tab:tab('app','next')});assert.equal(cross.tabs[1].customLabel,undefined);
});
test('same-family group replacement affects only its focused leaf; cross-family opens outside the group',()=>{
  const cli=tab('terminal'),file=tab('editor'),app=tab('app');
  let group=newWorkspaceTab('group',{views:[cli,file,app],activeViewId:file.id});const before=single(group);
  const replaced=reduce(before,{type:'navigate',tab:tab('editor','second')});assert.equal(replaced.tabs.length,1);assert.equal(activeWorkspaceView(replaced.tabs[0]).path,'second.md');
  assert.deepEqual(replaced.tabs[0].views[0],cli);assert.deepEqual(replaced.tabs[0].views[2],app);assert.deepEqual(replaced.tabs[0].layout,group.layout);
  const cross=reduce(before,{type:'navigate',tab:tab('app','second')});assert.equal(cross.tabs.length,2);assert.deepEqual(cross.tabs[0],group);
});
test('capacity rejects cross-family opens but permits replacement and reuse',()=>{
  const first=tab('editor');let state=single(first);for(let index=1;index<MAX_WORKSPACE_TABS;index++)state=reduce(state,{type:'open',tab:tab('app',String(index))});state=reduce(state,{type:'select',id:first.id});
  assert.equal(reduce(state,{type:'navigate',tab:tab('app','second')}),state);
  const replaced=reduce(state,{type:'navigate',tab:tab('editor','second')});assert.equal(replaced.tabs.length,MAX_WORKSPACE_TABS);assert.equal(activeWorkspaceView(replaced.tabs[0]).path,'second.md');
});
test('cross-family deep links retain a runtime and accepted-route reload restores its identity',()=>{
  const runtime=tab('terminal'),state=single(runtime),storage={getItem:()=>JSON.stringify(persistedWorkspaceTabs(state))};
  const linked=readWorkspaceTabs(storage,'ws',{view:'tasks'});assert.equal(linked.tabs.length,2);assert.deepEqual(linked.tabs[0],runtime);assert.equal(activeWorkspaceView(linked.tabs[1]).page.view,'tasks');
  const restored=readWorkspaceTabs(storage,'ws',{view:'projects'});assert.deepEqual(restored.tabs,[runtime]);
});
test('UI guards only replacements, checks capacity before native intent, and keeps explicit stop confirmation',async()=>{
  const source=await readFile(new URL('../src/components/workspace/WorkspaceSurface.jsx',import.meta.url),'utf8');
  assert.doesNotThrow(()=>transformSync(source,{loader:'jsx',format:'esm'}));
  assert.match(source,/workspaceNavigationDisposition\(current,tab\)==='replace'\)guard\(apply\);else apply\(\)/);
  const show=source.slice(source.indexOf('const showContent='),source.indexOf('const commitClose='));assert(show.indexOf('protectCapacity(tab)')<show.indexOf('launchRequests.current.set'));
  assert.match(source,/readWorkspaceTerminalViewStatus/);assert.match(source,/Stop &amp; close/);assert.match(source,/type:'navigate'/);
  const activate=source.slice(source.indexOf('const activate='),source.indexOf('const showContent='));assert.doesNotMatch(activate,/guard\(/);
});

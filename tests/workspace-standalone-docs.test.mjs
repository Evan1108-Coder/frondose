import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isWorkspaceStandalonePage } from '../src/lib/workspace-screens.js';
import { normalizeWorkspaceTabs, newWorkspaceTab, persistedWorkspaceTabs, workspaceTabsReducer } from '../src/lib/workspace-tabs.js';
import { readLocalWorkspaceTabs, localWorkspaceTab } from '../src/lib/local-workspace-tabs.js';
import { rememberWorkspaceReturnPage, workspaceSettingsReturnPage } from '../src/lib/workspace-settings.js';

test('Docs and Settings are standalone, while project/files remain workspace surfaces', () => {
  for(const view of ['docs','settings']) {
    assert.equal(isWorkspaceStandalonePage(view),true);assert.equal(isWorkspaceStandalonePage({view}),true);
    assert.throws(()=>newWorkspaceTab('app',{page:{view}}),/separate screen/);
  }
  for(const view of ['projects','tasks','workspace',null])assert.equal(isWorkspaceStandalonePage(view),false);
});
test('old persisted Docs tabs cannot return, and a retained terminal/browser keeps its identity', () => {
  for(const kind of ['terminal','browser']) {
    const runtime=newWorkspaceTab(kind,{entityId:'retained_session',projectId:'project_a'});
    const legacy={id:'old_docs',entityId:'old_docs',contentType:'app',label:'Docs',page:{view:'docs',id:'local-frondose'}};
    const state=normalizeWorkspaceTabs({version:1,tabs:[legacy,runtime],activeTabId:legacy.id,lastPageHash:'#/docs/local-frondose'});
    assert.equal(state.tabs.length,1);assert.equal(state.tabs[0].entityId,'retained_session');
    assert.equal(localWorkspaceTab(legacy).contentType,'new-tab');
    const restored=readLocalWorkspaceTabs({getItem:()=>JSON.stringify(persistedWorkspaceTabs(state))},'ws',{view:'workspace'});
    assert.equal(restored.tabs[0].entityId,'retained_session');
  }
});
test('reading Docs cannot overwrite the previous workspace return route or process view metadata', () => {
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  rememberWorkspaceReturnPage(storage,'ws',{view:'projects',id:'project_a'});
  assert.equal(rememberWorkspaceReturnPage(storage,'ws',{view:'docs',id:'local-frondose'}),false);
  assert.equal(workspaceSettingsReturnPage(storage,'ws').view,'projects');
  const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  assert.match(app,/closeDocs: closeSettings/);
  assert.match(app,/page.view === 'docs' \|\| !localEdition && page.view === 'reader'/);
  const surface=readFileSync(new URL('../src/components/workspace/WorkspaceSurface.jsx',import.meta.url),'utf8');
  assert.match(surface,/!target\|\|isWorkspaceStandalonePage\(target\)/);
});
test('Workspace navigation accepts its URL before opening a file or CLI, so standalone return retains the view', () => {
  for(const kind of ['editor','terminal','browser']) {
    const app=newWorkspaceTab('app',{page:{view:'tasks',id:'task_a'}});
    let state={version:1,tabs:[app],activeTabId:app.id,lastPageHash:'#/tasks/task_a',recentlyClosed:[]};
    state=workspaceTabsReducer(state,{type:'replace',tab:newWorkspaceTab()});
    state=workspaceTabsReducer(state,{type:'accept-workspace-route'});
    state=workspaceTabsReducer(state,{type:'replace',tab:newWorkspaceTab(kind,{entityId:'keep_identity',projectId:'project_a',path:'README.md',rootVersion:'root_a'})});
    const restored=readLocalWorkspaceTabs({getItem:()=>JSON.stringify(persistedWorkspaceTabs(state))},'ws',{view:'workspace'});
    assert.equal(restored.tabs[0].contentType,kind);assert.equal(restored.tabs[0].entityId,'keep_identity');
    assert.equal(restored.lastPageHash,'#/workspace');
  }
});

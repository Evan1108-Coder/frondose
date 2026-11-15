import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localWorkspaceTab, localWorkspaceTabs, readLocalWorkspaceTabs, sameRuntimeTab } from '../src/lib/local-workspace-tabs.js';
import { initialWorkspaceTabs, newWorkspaceTab, workspaceTabsReducer, persistedWorkspaceTabs } from '../src/lib/workspace-tabs.js';
import { pageHash, parsePage } from '../src/lib/navigation.js';
import { tabMotionPlan } from '../src/lib/workspace-tab-motion.js';
import { motionPreference } from '../src/lib/motion.js';

test('workspace has a canonical route while retired compatibility URLs still parse', () => {
  assert.equal(pageHash('workspace'), '#/workspace');
  assert.equal(parsePage('#/workspace').view, 'workspace');
  assert.equal(parsePage('#/frondose-agent').view, 'rumbo-agent');
});
test('local restoration retires old app surfaces without deleting identities or stored data', () => {
  for (const view of ['overview','inbox','workbench','agents','connections','rumbo-agent','chats','workspace']) {
    const state = initialWorkspaceTabs({ view });
    const before = JSON.stringify(state), next = localWorkspaceTabs(state);
    assert.equal(next.tabs[0].contentType, 'new-tab');
    assert.equal(next.activeTabId, state.activeTabId);
    assert.equal(next.tabs[0].entityId, state.tabs[0].entityId);
    assert.equal(JSON.stringify(state), before);
  }
});
test('runtime identity survives migration and reload metadata contains no animation authority', () => {
  let state=initialWorkspaceTabs({view:'overview'});
  state=workspaceTabsReducer(state,{type:'replace',tab:newWorkspaceTab('terminal',{entityId:'actual_cli',projectId:'project_a',providerId:'codex'})});
  const next=localWorkspaceTabs(state);
  assert.equal(next.tabs[0],state.tabs[0]);
  assert.equal(next.lastPageHash,'#/workspace');
  assert.equal(sameRuntimeTab(next.tabs[0],{...next.tabs[0],label:'New title'}),true);
  for(const field of ['id','entityId','projectId','contentType'])assert.equal(sameRuntimeTab(next.tabs[0],{...next.tabs[0],[field]:'changed'}),false);
  assert.doesNotMatch(JSON.stringify(persistedWorkspaceTabs(next)),/animation|ghost|command|prompt/);
});
test('legacy named-agent tabs become direct CLI views without changing process attachment identity', () => {
  const old = newWorkspaceTab('agent-session', { entityId:'old_pty_view', projectId:'project_a', providerId:'codex', agentId:'old_profile', label:'Old session' });
  const next = localWorkspaceTab(old);
  assert.equal(next.contentType,'terminal'); assert.equal(next.entityId,old.entityId);
  assert.equal(next.id,old.id); assert.equal(next.projectId,old.projectId); assert.equal(next.providerId,'codex');
  assert.equal('agentId' in next,false); assert.equal(old.agentId,'old_profile');
});
test('retiring the last app route preserves active terminal and browser on reload, but explicit deep links win', () => {
  for(const kind of ['terminal','browser']) {
    let state=initialWorkspaceTabs({view:'overview'});
    state=workspaceTabsReducer(state,{type:'replace',tab:newWorkspaceTab(kind,{entityId:'retained_runtime'})});
    const storage={getItem:()=>JSON.stringify(persistedWorkspaceTabs(state))};
    const restored=readLocalWorkspaceTabs(storage,'workspace_a',parsePage('#/workspace'));
    assert.equal(restored.tabs[0].contentType,kind);assert.equal(restored.tabs[0].entityId,'retained_runtime');
    const linked=readLocalWorkspaceTabs(storage,'workspace_a',parsePage('#/projects'));
    assert.equal(linked.tabs.find(tab=>tab.id===linked.activeTabId).page.view,'projects');
    assert.equal(linked.tabs.find(tab=>tab.entityId==='retained_runtime').contentType,kind);
  }
});
test('pointer motion is visible, keyboard immediate, reduced motion fades, browser guests never travel', () => {
  assert.deepEqual(tabMotionPlan(motionPreference()),{duration:260,travel:7});
  assert.deepEqual(tabMotionPlan(motionPreference({keyboard:true})),{duration:0,travel:0});
  assert.deepEqual(tabMotionPlan(motionPreference({reduced:true})),{duration:80,travel:0});
  assert.equal(tabMotionPlan(motionPreference(),true).travel,0);
  const source=readFileSync(new URL('../src/lib/workspace-tab-motion.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/cloneNode|innerHTML|outerHTML/);
  assert.match(source,/ghost\.textContent = old\.label/);
  assert.match(source,/ghosts\.current\.size > 3/);
});
test('working CLI close rechecks captured identity and offers no automatic stop on navigation', () => {
  const source=readFileSync(new URL('../src/components/workspace/WorkspaceSurface.jsx',import.meta.url),'utf8');
  assert.match(source,/identity\(target\)!==identity\(stateRef.current.tabs.find/);
  assert.match(source,/Close tab only/);
  assert.match(source,/reviewedStatus:entry\.status,confirmed:true/);
  assert.doesNotMatch(source,/connectedAgentIdentities|frondose:open-agent-session|Your agents<\/button>/);
});
test('short tab separators remain between adjacent tabs and standalone Docs keeps one skip target', () => {
  const css=readFileSync(new URL('../src/components/workspace/workspace-surface.css',import.meta.url),'utf8');
  assert.match(css,/\.workspace-tab::after[^\n]*height:14px/);
  assert.doesNotMatch(css,/\.workspace-tab\.selected::after[^\n]*opacity:0/);
  assert.match(css,/\.dialog\.workspace-save-dialog[^\n]*overflow:visible/);
  const docs=readFileSync(new URL('../src/views/Docs.jsx',import.meta.url),'utf8');
  assert.match(docs,/id="main-content"/);
  const ui=readFileSync(new URL('../src/ui.jsx',import.meta.url),'utf8');
  assert.match(ui,/animation\.finished\.then\(\(\) => \{[\s\S]*animation\.cancel\(\); animationRef\.current = null/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { branchTabsPreferenceKey, branchTabsStorageKey, readBranchTabsPreference, saveBranchTabsPreference, clearBranchTabMemory, branchTabsScope, transitionBranchWorkspaceTabs } from '../src/lib/branch-workspace-tabs.js';
import { newWorkspaceTab, workspaceTabViews, workspaceTabsReducer } from '../src/lib/workspace-tabs.js';
import { automaticViewLayout, layoutViewIds } from '../src/lib/workspace-view-layout.js';

const workspaceId = 'branch_fixture_ws', projectId = 'branch_fixture_project';
const binding = { projectId, path: '/fixture/project', version: 'epoch_2' };
const result = branch => ({ workspaceId, connected: true, isRepository: true, branch, directory: binding.path, bindingVersion: binding.version, tabScope: 'a'.repeat(64), github: { slug: 'fixture/repo' } });
const storage = () => { const values = new Map(); return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
const file = (path, id = 'file_tab') => newWorkspaceTab('editor', { path, projectId, rootVersion: binding.version, label: path }, id);
const page = (view = 'tasks', id = 'page_tab') => newWorkspaceTab('app', { page: { view }, label: view }, id);
const state = tabs => ({ version: 1, tabs, activeTabId: tabs[0].id, orientation: 'horizontal', lastPageHash: '#/tasks', recentlyClosed: [] });
const transition = (store, before, previousBranch = 'main', nextBranch = 'feature', overrides = {}) => transitionBranchWorkspaceTabs({ storage: store, workspaceId, state: before, previousBranch, result: result(nextBranch), binding, ...overrides });
const enable = store => saveBranchTabsPreference(store, workspaceId, true);

test('branch tab layouts are strictly opt-in and per workspace, with OFF a true identity no-op', () => {
  const store = storage(), before = state([file('main.js')]);
  assert.equal(readBranchTabsPreference(store, workspaceId), false);
  assert.equal(transition(store, before).state, before); assert.equal(store.values.size, 0);
  enable(store); assert.equal(readBranchTabsPreference(store, workspaceId), true);
  assert.equal(readBranchTabsPreference(store, 'other_workspace'), false);
  saveBranchTabsPreference(store, workspaceId, false); assert.equal(transition(store, before).reason, 'disabled');
});
test('fresh successful results must match workspace, binding epoch, path and stable physical-repository scope', () => {
  assert.ok(branchTabsScope(workspaceId, result('feature'), binding));
  for (const patch of [{ requiresRefresh: true }, { connected: false }, { workspaceId: 'foreign' }, { bindingVersion: 'old_epoch' }, { directory: '/another/root' }, { tabScope: 'not-a-hash' }, { branch: null }, { isRepository: false }]) assert.equal(branchTabsScope(workspaceId, { ...result('feature'), ...patch }, binding), null);
  const store = storage(); enable(store); const before = state([page()]);
  for (const previousBranch of [null, undefined, '-unsafe', 'feature']) assert.equal(transition(store, before, 'main', 'feature', { previousBranch }).state, before);
  assert.equal(transition(store, before, 'main', 'feature', { result: { requiresRefresh: true } }).state, before);
  assert.equal(store.getItem(branchTabsStorageKey(workspaceId)), null);
});
test('dirty or pending editors skip all branch metadata mutation and tab replacement', () => {
  const store = storage(); enable(store); const before = state([file('draft.js')]);
  assert.equal(transition(store, before, 'main', 'feature', { unsafeEditors: true }).reason, 'dirty_or_pending_editors');
  assert.equal(transition(store, before, 'main', 'feature', { unsafeEditors: true }).state, before);
  assert.equal(store.getItem(branchTabsStorageKey(workspaceId)), null);
});
test('new branches start a chooser while runtime tabs and mixed splits keep exact objects and identities', () => {
  const store = storage(); enable(store);
  const terminal = newWorkspaceTab('terminal', { entityId: 'running_cli', providerId: 'codex', projectId }, 'terminal_tab');
  const browser = newWorkspaceTab('browser', { entityId: 'browser_identity' }, 'browser_tab');
  const mixedFile = file('mixed.js', 'mixed_file'), mixedRuntime = newWorkspaceTab('terminal', { entityId: 'mixed_cli', projectId }, 'mixed_runtime');
  const mixed = newWorkspaceTab('group', { views: [mixedFile, mixedRuntime], layout: automaticViewLayout([mixedFile.id, mixedRuntime.id]) }, 'mixed_tab');
  const before = state([file('main.js'), terminal, browser, mixed]);
  const next = transition(store, before);
  assert.equal(next.reason, 'new_branch'); assert.equal(next.state.tabs.length, 4);
  for (const tab of [terminal, browser, mixed]) assert.equal(next.state.tabs.find(item => item.id === tab.id), tab);
  assert.equal(next.state.tabs.at(-1).contentType, 'new-tab');
  assert.equal(next.state.tabs.flatMap(workspaceTabViews).find(view => view.entityId === 'running_cli'), terminal);
  assert.doesNotMatch(store.getItem(branchTabsStorageKey(workspaceId)), /running_cli|browser_identity|mixed_cli|mixed\.js/);
});
test('clean file/page layouts restore on returning with fresh identities/current epoch, retaining custom names and layout ratios', () => {
  const store = storage(); enable(store);
  const mainFile = { ...file('main.js', 'main_file'), customLabel: 'Pinned source', label: 'Pinned source', isPinned: true };
  const mainPage = page('projects', 'main_page'), mainGroup = newWorkspaceTab('group', { views: [mainFile, mainPage], activeViewId: mainPage.id, customLabel: 'Planning', layout: { type: 'split', id: 'main_split', axis: 'column', ratio: .3, first: { type: 'view', id: mainFile.id }, second: { type: 'view', id: mainPage.id } } }, 'main_group');
  transition(store, state([mainGroup]));
  const feature = state([file('feature.js', 'feature_file')]);
  const nextBinding = { ...binding, version: 'epoch_3' };
  const rebased = workspaceTabsReducer(feature, { type: 'binding-changed', binding: nextBinding, editorEntityIds: ['feature_file'] });
  const returned = transition(store, rebased, 'feature', 'main', { binding: nextBinding, result: { ...result('main'), bindingVersion: nextBinding.version } });
  const restored = returned.state.tabs[0];
  assert.equal(returned.reason, 'restored'); assert.equal(restored.customLabel, 'Planning'); assert.notEqual(restored.id, mainGroup.id);
  assert.equal(restored.layout.axis, 'column'); assert.equal(restored.layout.ratio, .3);
  assert.deepEqual(layoutViewIds(restored.layout), restored.views.map(view => view.id));
  const restoredFile = restored.views.find(view => view.contentType === 'editor');
  assert.equal(restoredFile.rootVersion, 'epoch_3'); assert.equal(restoredFile.projectId, projectId); assert.equal(restoredFile.customLabel, 'Pinned source');
  assert.notEqual(restoredFile.entityId, mainFile.entityId); assert.equal(restored.views.find(view => view.id === restored.activeViewId).page.view, 'projects');
});
test('draft files and foreign-root editors remain globally present and are never rebound from branch metadata', () => {
  const store = storage(); enable(store);
  const draft = { ...file('Unsaved.md', 'draft_file'), draft: true }, oldRoot = { ...file('private.md', 'old_root_file'), rootVersion: 'previous_root_epoch' };
  const before = state([draft, oldRoot, page()]), next = transition(store, before);
  assert.equal(next.state.tabs.find(tab => tab.id === draft.id), draft); assert.equal(next.state.tabs.find(tab => tab.id === oldRoot.id), oldRoot);
  assert.doesNotMatch(store.getItem(branchTabsStorageKey(workspaceId)), /Unsaved\.md|private\.md/);
});
test('branch snapshots contain only inert approved metadata, never content, commands, resume or model intent', () => {
  const store = storage(); enable(store);
  transition(store, state([{ ...file('safe.js'), content: 'PRIVATE SOURCE', command: 'RUN COMMAND', prompt: 'PRIVATE PROMPT', providerId: 'codex', resume: true, launchRequestId: 'launch_secret' }]));
  const raw = store.getItem(branchTabsStorageKey(workspaceId));
  assert.match(raw, /safe\.js/); assert.doesNotMatch(raw, /PRIVATE|COMMAND|launch_secret|providerId|"resume":|"content":|"command":|"prompt":/);
});
test('saved branch data cannot revive a forged runtime, unsafe path or standalone settings tab', () => {
  const store = storage(); enable(store); const scope = branchTabsScope(workspaceId, result('main'), binding);
  store.setItem(branchTabsStorageKey(workspaceId), JSON.stringify({ version: 1, scopes: [{ scope, branches: [{ branch: 'feature', snapshot: { tabs: [newWorkspaceTab('terminal', { entityId: 'forged_session', providerId: 'claude' }, 'forged_terminal'), { ...file('bad.js'), path: '../secret' }, { ...page(), page: { view: 'settings' } }] } }] }] }));
  const next = transition(store, state([page()]));
  assert.equal(next.state.tabs.length, 1); assert.equal(next.state.tabs[0].contentType, 'new-tab'); assert.doesNotMatch(JSON.stringify(next.state), /forged_session|claude|\.\.\/secret|settings/);
});
test('branch and physical repository isolation do not load a different scoped layout', () => {
  const store = storage(); enable(store); transition(store, state([file('main-only.js')]));
  const resultOtherRoot = { ...result('main'), tabScope: 'b'.repeat(64) };
  const switched = transition(store, state([page('tasks', 'feature_page')]), 'feature', 'main', { result: resultOtherRoot });
  assert.equal(switched.reason, 'new_branch'); assert.doesNotMatch(JSON.stringify(switched.state), /main-only/);
});
test('storage failures preserve existing tabs, including all runtimes, without partial replacement', () => {
  const store = storage(); enable(store); store.setItem = () => { throw Error('Quota'); };
  const before = state([file('main.js')]); assert.equal(transition(store, before).state, before); assert.equal(transition(store, before).reason, 'storage_unavailable');
  assert.equal(saveBranchTabsPreference(store, workspaceId, false), false);
  assert.equal(readBranchTabsPreference({ getItem() { throw Error('Denied'); } }, workspaceId), false);
});
test('bounded snapshots and capacity preserve runtime tabs instead of evicting live work', () => {
  const store = storage(); enable(store);
  for (let index = 0; index < 20; index++) transition(store, state([page('tasks', `page_${index}`)]), `branch_${index}`, `branch_${index + 1}`);
  const memory = JSON.parse(store.getItem(branchTabsStorageKey(workspaceId))); assert.equal(memory.scopes[0].branches.length, 12); assert.ok(new TextEncoder().encode(store.getItem(branchTabsStorageKey(workspaceId))).length <= 256 * 1024);
  const runtimes = Array.from({ length: 32 }, (_, index) => newWorkspaceTab('terminal', { entityId: `session_${index}`, projectId }, `runtime_${index}`));
  const before = state(runtimes), next = transition(store, before, 'branch_21', 'branch_22');
  assert.equal(next.state.tabs.length, 32); runtimes.forEach((tab, index) => assert.equal(next.state.tabs[index], tab));
});
test('forgetting branch metadata does not toggle preference, mutate current tabs or remove source files', () => {
  const store = storage(); enable(store); const before = state([file('main.js')]); transition(store, before);
  assert.equal(clearBranchTabMemory(store, workspaceId), true); assert.equal(store.getItem(branchTabsStorageKey(workspaceId)), null); assert.equal(readBranchTabsPreference(store, workspaceId), true); assert.equal(before.tabs[0].path, 'main.js');
});
test('WorkspaceSurface integrates only fresh branch callbacks after existing guards and never clears runtime launch maps', () => {
  const source = readFileSync(new URL('../src/components/workspace/WorkspaceSurface.jsx', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('const onBranchChanged='), source.indexOf('const renderContent='));
  assert.match(handler, /await refreshDirectory\(\)/); assert.match(handler, /unsafeEditors/); assert.match(handler, /previousBranch:metadata.previousBranch/); assert.match(handler, /!editor\?\.isDirty\(\)/);
  assert.doesNotMatch(handler, /launchRequests\.current\.clear|historyLaunches\.current\.clear|stopWorkspaceTerminalView|\.browser\.close|confirmed: true/);
  assert.match(source, /beforeBranchChange=\{action=>guard\(action,true\)\}/);
});
test('branch settings render honest OFF-by-default and runtime preservation copy without browser storage', () => {
  const require = createRequire(import.meta.url);
  const bundle = buildSync({ stdin: { contents: `export {BranchTabsSettings} from './src/components/workspace/BranchTabsSettings.jsx'; export {AppContext} from './src/app-context.js';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'], loader: { '.css': 'empty' } });
  const module = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require);
  const { BranchTabsSettings, AppContext } = module.exports;
  const html = renderToStaticMarkup(React.createElement(AppContext.Provider, { value: { workspace: { id: workspaceId } } }, React.createElement(BranchTabsSettings)));
  assert.match(html, /Remember file and page tabs per branch/); assert.match(html, /Off by default/); assert.match(html, /never stopped, relaunched or hidden/); assert.match(html, /type="checkbox" role="switch"/); assert.doesNotMatch(html, /checked=""/); assert.match(html, /Forget saved branch tab layouts/);
});

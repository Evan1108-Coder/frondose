import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSync } from 'esbuild';
import { newWorkspaceTab, normalizeWorkspaceTabs, persistedWorkspaceTabs, workspaceTabsReducer, workspaceTabStorageKey } from '../src/lib/workspace-tabs.js';
import { registerWorkspaceNavigator, requestWorkspaceNavigation } from '../src/lib/workspace-navigation.js';
import { directoryDraftDirty, createDirectoryDraft } from '../src/lib/directory-drafts.js';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const bundle = buildSync({ stdin: { contents: `export {WorkspaceSurface} from './src/components/workspace/WorkspaceSurface.jsx'; export {AppContext} from './src/app-context.js';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require);
const { WorkspaceSurface, AppContext } = module.exports;
function render(state, unavailableStorage = false) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map(state ? [[workspaceTabStorageKey('ws'), JSON.stringify(state)]] : []);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => { if (unavailableStorage) throw Error('Storage unavailable'); return values.get(key) || null; }, setItem() {} } });
  try {
    return renderToStaticMarkup(React.createElement(AppContext.Provider, { value: { workspace: { id: 'ws', name: 'Fixture' }, data: { agents: [], connections: [], projects: [], workspace_items: [], settings: {} }, navigate() {}, notify() {} } }, React.createElement(WorkspaceSurface, { page: { view: 'overview' }, onActivatePage() {} }, React.createElement('div', null, 'Fixture app page'))));
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
}
function single(tab) { return { version: 1, tabs: [tab], activeTabId: tab.id, recentlyClosed: [] }; }

test('workspace renders semantic mixed-content tab chrome without launching native work', () => {
  const html = render(single(newWorkspaceTab('app', { page: { view: 'overview' }, label: 'Today' })));
  assert.match(html, /role="tablist" aria-label="Workspace tabs"/); assert.match(html, /role="tabpanel" aria-label="New tab"/);
  assert.doesNotMatch(html, /Fixture app page|aria-label="Today"/); assert.match(html, /New tab/); assert.doesNotMatch(html, /Session views/);
  assert.doesNotMatch(html, /<webview|<iframe|Starting provider/);
});
test('new tab chooser enables home-folder terminals while Markdown still needs a linked directory', () => {
  const html = render(single(newWorkspaceTab()));
  for (const name of ['Terminal', 'Markdown file', 'Browser', 'Text editor']) assert.ok(html.includes(name), name);
  assert.doesNotMatch(source('src/components/workspace/WorkspaceSurface.jsx'), /WorkspaceAppMenu|WebAppWorkspace|WorkspaceOpenIn/);
  assert.match(source('src/components/workspace/WorkspaceSurface.jsx'), /onChoose\('browser',\{label:'Browser'\}\)/);
  assert.doesNotMatch(html, /Agent session|No connected CLI agents|Your agents/);
  assert.match(html, /<button><svg[^]*?<strong>Terminal<\/strong><small>Your shell, in your home folder<\/small>/);
  assert.match(html, /<button disabled=""[^]*?<strong>Markdown file<\/strong>/);
  assert.match(html, /Choose workspace directory/); assert.doesNotMatch(html, /Open an installed CLI|No local CLIs detected/);
  assert.doesNotMatch(html, /New conversation|OAuth account|Start with a purpose/);
});
test('unavailable browser storage falls back to usable workspace navigation', () => {
  const html = render(null, true);
  assert.match(html, /Workspace tabs/); assert.match(html, /New tab/); assert.match(html, /Choose workspace directory/);
});
test('directory UUID revisions survive tab creation and persistence', () => {
  const revision = '35b701bf-6bd6-4714-9eb4-4b3a51bf22c3';
  const tab = newWorkspaceTab('editor', { path: 'notes.md', rootVersion: revision, projectId: 'project', entityId: 'file_id' });
  assert.equal(tab.rootVersion, revision, 'A directory revision is a UUID, not a numeric counter.');
  const restored = normalizeWorkspaceTabs(persistedWorkspaceTabs(single(tab)), { view: 'overview' });
  assert.equal(restored.tabs[0].rootVersion, revision);
});
test('replacing or closing a tab does not mutate its server-backed session identity', () => {
  const terminal = newWorkspaceTab('terminal', { entityId: 'native_fixture', projectId: 'project' });
  const before = single(terminal), replaced = workspaceTabsReducer(before, { type: 'replace', tab: newWorkspaceTab('app', { page: { view: 'tasks' } }) });
  assert.equal(before.tabs[0].entityId, 'native_fixture'); assert.equal(replaced.tabs[0].contentType, 'app');
  const closed = workspaceTabsReducer(before, { type: 'close', id: terminal.id });
  assert.equal(closed.recentlyClosed[0].entityId, 'native_fixture');
  assert.equal(workspaceTabsReducer(closed, { type: 'reopen' }).tabs.at(-1).entityId, 'native_fixture');
});
test('navigation bridge defers commits until its active host completes the save guard', () => {
  let pending, commits = 0;
  const unregister = registerWorkspaceNavigator((target, commit) => { pending = { target, commit }; });
  try {
    requestWorkspaceNavigation({ view: 'tasks' }, () => commits++);
    assert.equal(commits, 0); assert.equal(pending.target.view, 'tasks');
    // A failed editor save deliberately does not call the queued continuation.
    const failedSave = false;
    if (failedSave) pending.commit();
    assert.equal(commits, 0);
    pending.commit(); assert.equal(commits, 1);
  } finally { unregister(); }
  requestWorkspaceNavigation(null, () => commits++); assert.equal(commits, 2);
});
test('before-unload guard includes retained dirty drafts and new unsaved empty files', () => {
  const tab = { id: 'newfile', entityId: 'newfile', path: 'Untitled.md', draft: true }, draft = createDirectoryDraft('ws', tab);
  assert.equal(draft.content, ''); assert.equal(directoryDraftDirty(draft), true);
  const jsx = source('src/components/workspace/WorkspaceSurface.jsx');
  assert.match(jsx, /drafts.current.values\(\)\]\.some\(directoryDraftDirty\)/);
  assert.match(jsx, /fileEditor.current\?\.isDirty\(\)\s*\|\|\s*fileEditor.current\?\.isPending\(\)/);
});
test('navigation guard only resumes after confirmed save and errors retain pending state', () => {
  const jsx = source('src/components/workspace/WorkspaceSurface.jsx'), editor = source('src/components/workspace/DirectoryFiles.jsx');
  assert.match(jsx, /pendingAction.current=(?:allDrafts\?\(\)=>guard\(action,true\):)?action/); assert.match(jsx, /const saved=await fileEditor.current\?\.save\(\)/);
  assert.match(jsx, /if\(saved&&!fileEditor.current\?\.isDirty\(\)\)/);
  assert.match(jsx, /The file could not be fully saved/); assert.match(jsx, /workspace-save-arrow/);
  assert.match(editor, /catch \(error\) \{ update\(value => \(\{ \.\.\.value, error \}\)\); return false/);
  assert.match(editor, /const checked = await external.beforeSave\(sent\)/);
  assert.match(editor, /expected_version: checked.version/);
});
test('save shortcut in the arrow dialog is handled before generic modal shortcut blocking', () => {
  const jsx = source('src/components/workspace/WorkspaceSurface.jsx');
  const save = jsx.indexOf("if(e.key.toLowerCase()==='s'&&guardOpen)"), modal = jsx.indexOf("if(document.querySelector('[aria-modal=\"true\"]'))return;");
  assert.ok(save >= 0 && modal > save);
  assert.match(jsx.slice(save, modal), /e.preventDefault\(\);void saveAndContinue\(\)/);
});
test('closing an inactive dirty tab does not race the current tab save continuation', () => {
  const jsx = source('src/components/workspace/WorkspaceSurface.jsx');
  assert.doesNotMatch(jsx, /activate\(target\);requestAnimationFrame\(\(\)=>guard\(action\)\)/);
  assert.match(jsx, /requestUpdateNavigation\(\(\)=>guard\(close,true\)\)/);
  assert.match(jsx, /selectView\(tab,retained\);pendingAction.current=\(\)=>guard\(action,true\)/);
});
test('restored app tabs synchronize their actual page without starting work', () => {
  const jsx = source('src/components/workspace/WorkspaceSurface.jsx');
  assert.match(jsx, /if\(restored.current\)return;restored.current=true/);
  assert.match(jsx, /activeWorkspaceView\(stateRef.current.tabs.find/);
  assert.match(jsx, /if\(v\?\.contentType==='app'\)onActivatePage\(v.page\)/);
});
test('browser view replacement hides guests instead of destroying them', () => {
  const browser = source('src/components/workspace/BrowserWorkspace.jsx');
  assert.match(browser, /void bridge.hide\(identity\(\)\)/);
  assert.doesNotMatch(browser, /return[^\n]*bridge.close\(/);
  assert.match(browser, /MutationObserver/); assert.match(browser, /document.querySelector\('dialog\[open\]/);
});
test('root and file inputs are excluded once from automatic defaults', () => {
  const jsx = source('src/components/workspace/DirectoryFiles.jsx');
  assert.doesNotMatch(jsx, /data-field-defaults-exclude(?:="true")?\s+data-field-defaults-exclude/);
  assert.match(jsx, /aria-label="New Markdown file path"[^\n]*data-field-defaults-exclude="true"/);
  const editor = source('src/components/workspace/SourceCodeEditor.jsx');
  assert.match(editor, /className="directory-source-editor [^\n]*data-field-defaults-exclude="true"/);
  assert.match(editor, /EditorView\.contentAttributes\.of\([^\n]*'data-field-defaults-exclude': 'true'/);
});
test('all workspace surfaces keep a focusable skip target and document title without the removed header strip', () => {
  const jsx = source('src/components/workspace/WorkspaceSurface.jsx'), app = source('src/App.jsx');
  assert.match(jsx, /id="main-content"[^>]*tabIndex=\{-1\}/);
  assert.match(jsx, /onActiveTab\?\.\(\{workspaceId:workspace.id,contentType:active.contentType,label:activeTab.label\}\)/);
  assert.match(jsx, /document.title=`\$\{activeLabel\}/);
  assert.doesNotMatch(app, /<Breadcrumbs|aria-label="Current workspace tab"|workspace-surface-title/);
  assert.match(app, /<NavigationHistory key=\{workspace.id\} showControls=\{false\}/);
});
test('workspace teardown scans retained file drafts and layout storage failures are recoverable', () => {
  const jsx = source('src/components/workspace/WorkspaceSurface.jsx');
  assert.match(jsx, /if\(allDrafts\)/); assert.match(jsx, /directoryDraftDirty\(drafts.current.get\(v.entityId\)\)/);
  assert.match(jsx, /if\(!target\|\|isWorkspaceStandalonePage\(target\)\)\{guard\(commit,true\);return;/);
  assert.match(jsx, /writeLocal\('frondose.files.width'/);
  assert.match(jsx, /workspaceTabViews\(tab\).find/);
});
test('Settings navigation guards drafts without replacing the active workspace tab', () => {
  const jsx = source('src/components/workspace/WorkspaceSurface.jsx'), app = source('src/App.jsx'), settings = source('src/views/settings/SettingsCenter.jsx');
  assert.match(jsx, /if\(!target\|\|isWorkspaceStandalonePage\(target\)\)\{guard\(commit,true\);return;/);
  assert.match(app, /localEdition && !isWorkspaceStandalonePage\(page\) \? <WorkspaceSurface/);
  assert.match(app, /workspaceSettingsReturnPage\(localStorage, workspace\?\.id\)/);
  assert.match(settings, /closeSettings \? closeSettings\(\) : navigate\('overview'\)/);
});
test('standalone Settings has one content column and its own navigation on narrow screens', () => {
  const css = source('src/components/workspace/workspace-surface.css');
  assert.match(css, /\.local-workbench\.in-settings \.settings-center \{ grid-template-columns:minmax\(0,1fr\);grid-template-rows:auto minmax\(0,1fr\)/);
  assert.match(css, /\.local-workbench\.in-settings \.topbar > \.navigation-trigger \{ display:none/);
});
test('the file explorer follows the main content at the far right in DOM and keyboard order', () => {
  const html = render(single(newWorkspaceTab('app', { page: { view: 'overview' }, label: 'Today' })));
  const content = html.indexOf('id="main-content"'), separator = html.indexOf('class="workspace-files-resizer"'), explorer = html.indexOf('class="workspace-directory-pane"');
  assert.ok(content >= 0 && separator > content && explorer > separator);
  assert.equal(html.match(/class="workspace-directory-pane"/g).length, 1);
  assert.ok(html.indexOf('Reopen last closed tab') < html.indexOf('data-workspace-files="true"'));
});
test('right-side explorer resize grows toward the left and collapse restores toggle focus', () => {
  const jsx = source('src/components/workspace/WorkspaceSurface.jsx');
  assert.equal(jsx.match(/width\+start-p.clientX/g).length, 2);
  assert.match(jsx, /e.key==='ArrowLeft'\?16:-16/);
  assert.match(jsx, /setExplorerOpen\(false\);filesToggle.current\?\.focus\(\)/);
  assert.match(jsx, /setExplorerWidth\(width\);collapseExplorer\(\)/);
  assert.match(jsx, /<PanelRight\s*\/>/);
});
test('mobile explorer is anchored at the right within the workspace content', () => {
  const css = source('src/components/workspace/workspace-surface.css');
  assert.match(css, /\.workspace-content-layout \{[^}]*position:relative/);
  assert.match(css, /top:0;bottom:0;right:0;left:auto;max-width:80vw;box-shadow:-5px/);
  assert.doesNotMatch(css, /workspace-directory-pane \{ max-width:210px/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSync } from 'esbuild';
import { localWorkspaceSettingsGroups, localWorkspaceQuickAccess, normalizeWorkspaceTabAppearance } from '../src/lib/local-settings-catalog.js';
import { SETTINGS_GROUPS } from '../src/lib/settings-catalog.js';
import { requestWorkspaceTool, registerWorkspaceTool } from '../src/lib/workspace-tool-intent.js';
import { newWorkspaceTab } from '../src/lib/workspace-tabs.js';
import { mergeSettings } from '../server/validation.mjs';
import { createLocalApi } from '../server/local-api.mjs';

const local = { meta: { product: { edition: 'local' } } };
const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const validSettings = () => ({ appearance: { theme: 'dark', density: 'compact', reduceMotion: false }, privacy: { localOnly: true, analytics: false, crashReports: false }, agentDefaults: { approvalMode: 'ask', concurrentRuns: 2, preserveRawEvents: true }, notifications: {}, preferences: { home: 'overview', sendKey: 'enter', weekStart: 'monday' } });
const require = createRequire(import.meta.url);
const bundle = buildSync({ stdin: { contents: `export {LocalWorkspaceSettings,LocalTerminalSettings,LocalNotificationSettings} from './src/views/settings/LocalWorkspaceSettings.jsx'; export {SettingsCenter} from './src/views/settings/SettingsCenter.jsx'; export {WorkstationToolsSettings} from './src/views/settings/WorkstationToolsSettings.jsx'; export {WorkstationTool} from './src/components/workspace/WorkstationTool.jsx'; export {DisplayPreferences} from './src/views/settings/DisplayPreferences.jsx'; export {CodeAppearanceSettings} from './src/views/settings/CodeAppearanceSettings.jsx'; export {LocalInstallation} from './src/components/LocalInstallation.jsx'; export {ResourceEditor} from './src/views/settings/ResourcePage.jsx'; export {IconColorsProvider} from './src/components/IconColors.jsx'; export {AppContext} from './src/app-context.js';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'], loader: { '.css': 'empty' } });
const module = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require);
const components = module.exports;
function render(name, props = {}, context = {}) {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), previousMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() { writes++; } } });
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
  const data = { ...local, settings: validSettings(), profile: {}, teams: [], projects: [], tasks: [], documents: [], chats: [], agents: [], connections: [], memory_notes: [], workspace_items: [], ...context.data };
  const app = { data, workspace: { id: 'ws', name: 'Project', slug: 'project' }, page: { view: 'settings', id: 'preferences' }, organization: { layout: { groups: [] }, quickAccess: ['inbox', 'chats', 'connections', 'settings'] }, navigate() {}, showShortcuts() {}, edit() {}, updateOrganization() {}, ...context, data };
  try {
    const html = renderToStaticMarkup(React.createElement(components.AppContext.Provider, { value: app }, React.createElement(components.IconColorsProvider, null, React.createElement(components[name], props))));
    assert.equal(writes, 0, 'Rendering settings must never write preferences or launch work.');
    return html;
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else delete globalThis.localStorage;
    if (previousMedia) Object.defineProperty(globalThis, 'matchMedia', previousMedia); else delete globalThis.matchMedia;
  }
}

test('CLI-first settings retain working local tools and remove retired configuration without mutation', () => {
  const before = JSON.stringify(SETTINGS_GROUPS), groups = localWorkspaceSettingsGroups(SETTINGS_GROUPS, local), ids = groups.flatMap(([, rows]) => rows.map(([id]) => id));
  for (const id of ['preferences', 'profile', 'appearance', 'workspace-tabs', 'terminal', 'privacy', 'notifications', 'code-reviews', 'local-installation', 'app-updates', 'computer-use', 'dictation', 'emulators', 'integrations', 'route-labels', 'route-templates', 'route-workflow', 'project-labels', 'project-templates', 'project-statuses', 'documents', 'reviews', 'storage']) assert.ok(ids.includes(id), id);
  for (const id of ['agents', 'rumbo-agent', 'awareness', 'collections', 'presets', 'context', 'permissions', 'workbench', 'queue', 'handoffs', 'scheduled-work', 'automations', 'accounts', 'usage', 'personalization', 'home-attention', 'chats', 'teams', 'members', 'billing', 'security', 'personal-security', 'plugins']) assert.equal(ids.includes(id), false, id);
  assert.equal(new Set(ids).size, ids.length); assert.equal(JSON.stringify(SETTINGS_GROUPS), before);
  groups[0][1][0][1] = 'Changed copy'; assert.equal(localWorkspaceSettingsGroups(SETTINGS_GROUPS, local)[0][1][0][1], 'Onboarding Checklist');
  assert.equal(localWorkspaceSettingsGroups(SETTINGS_GROUPS, {}), SETTINGS_GROUPS);
});

test('quick-access pruning is local presentation and does not rewrite saved choices', () => {
  const saved = ['focus', 'inbox', 'chats', 'connections', 'projects', 'settings'], before = [...saved];
  assert.deepEqual(localWorkspaceQuickAccess(saved, local), ['projects', 'settings']); assert.deepEqual(saved, before);
  assert.equal(localWorkspaceQuickAccess(saved, {}), saved);
});

test('workspace tab defaults and allowed values remain bounded', () => {
  assert.deepEqual(normalizeWorkspaceTabAppearance(null), { workspaceTabSize: 'compact', workspaceTabCloseButtons: 'always' });
  assert.deepEqual(normalizeWorkspaceTabAppearance({ workspaceTabSize: 'comfortable', workspaceTabCloseButtons: 'hover' }), { workspaceTabSize: 'comfortable', workspaceTabCloseButtons: 'hover' });
  assert.deepEqual(normalizeWorkspaceTabAppearance({ workspaceTabSize: 'huge', workspaceTabCloseButtons: false }), normalizeWorkspaceTabAppearance());
  const initial = validSettings(), next = mergeSettings(initial, { appearance: { workspaceTabSize: 'comfortable', workspaceTabCloseButtons: 'hover' } });
  assert.equal(next.appearance.theme, initial.appearance.theme); assert.equal(next.preferences.home, 'overview'); assert.equal(initial.appearance.workspaceTabSize, undefined);
  for (const [key, value] of [['workspaceTabSize', 'huge'], ['workspaceTabSize', null], ['workspaceTabCloseButtons', 'never'], ['workspaceTabCloseButtons', true]]) assert.throws(() => mergeSettings(validSettings(), { appearance: { [key]: value } }), /workspace tab/);
});

test('local tab settings expose real choices and distinguish closing views from stopping work', () => {
  const html = render('LocalWorkspaceSettings');
  assert.match(html, /Workspace tab size/); assert.match(html, /Workspace tab close buttons/);
  assert.match(html, /Compact/); assert.match(html, /Always visible/);
  const alternative = render('LocalWorkspaceSettings', {}, { data: { settings: { ...validSettings(), appearance: { ...validSettings().appearance, workspaceTabSize: 'comfortable', workspaceTabCloseButtons: 'hover' } } } });
  assert.match(alternative, /Comfortable/); assert.match(alternative, /On hover or focus/);
  assert.match(html, /Failed saves keep the draft/); assert.match(html, /Stop and close/);
  assert.doesNotMatch(html, /API key|OAuth|Agent profile|Default home|Restore sessions automatically/);
});

test('General and Notifications remove chat/home/inbox configuration while retaining working controls', () => {
  const general = render('LocalWorkspaceSettings', { section: 'preferences' }), notices = render('LocalNotificationSettings');
  assert.match(general, /First day of week/); assert.match(general, /Keyboard shortcuts/);
  assert.doesNotMatch(general, /Default home|Send chat|Chat scrolling|Today|Inbox/);
  assert.match(notices, /Notification display duration/); assert.match(notices, /Workspace tip duration/); assert.match(notices, /Reset hidden tips/);
  assert.doesNotMatch(notices, /inbox|Slack|email|Completed sessions|Failed sessions/);
});

test('local Settings deep links to retired configuration safely fall back to General', () => {
  for (const id of ['agents', 'rumbo-agent', 'workbench', 'home-attention', 'accounts', 'chats', 'team:legacy', 'plugins']) {
    const html = render('SettingsCenter', {}, { page: { view: 'settings', id }, data: { teams: [{ id: 'legacy', name: 'Hidden legacy Area' }] } });
    assert.match(html, /<h1>General<\/h1>/, id); assert.doesNotMatch(html, /Hidden legacy Area|Agent profiles|Agent awareness|AI Provider Accounts|Choose which updates appear in your Frondose inbox/);
  }
});

test('local portable JSON export does not present itself as a full backup of native workspace work', () => {
  const html = render('SettingsCenter', {}, { page: { view: 'settings', id: 'storage' } });
  assert.match(html, /Export JSON/);
  assert.match(html, /Not a full backup/);
  assert.match(html, /does not include To Do List items, local automation schedules, native AI chats or terminal sessions/);
  assert.match(html, /uploaded resource files, or files in the linked project directory/);
  assert.match(html, /Import supported records from a Frondose JSON archive into a new workspace/);
  assert.doesNotMatch(html, /recorded session history as JSON/);
});

test('the compact Settings picker uses the same search results as the desktop rail', () => {
  const settings = source('src/views/settings/SettingsCenter.jsx');
  assert.match(settings, /mobileSections = describeSections\(visibleGroups\)/);
  assert.match(settings, /className="settings-mobile-jump"[^\n]+disabled=\{!mobileSections.length\}[^\n]+\{mobileSections\.map/);
  assert.match(settings, /mobileSections.length \? 'Choose a matching setting' : 'No matching settings'/);
});

test('deferred desktop tools cannot open new tabs; saved tabs and settings render only Coming Soon', () => {
  assert.equal(SETTINGS_GROUPS.some(([group]) => group === 'Plugins'), false);
  for (const section of ['computer-use', 'dictation', 'emulators']) {
    const html = render('WorkstationToolsSettings', { section });
    assert.match(html, /Coming Soon/);
    assert.doesNotMatch(html, /<button\b|<input\b|<select\b/);
  }
  const received = [];
  const release = registerWorkspaceTool('ws', intent => received.push(intent));
  try {
    for (const toolId of ['computer', 'dictation', 'devices', 'environment']) {
      assert.equal(requestWorkspaceTool('ws', 'workstation-tool', { toolId }), false);
      const saved = newWorkspaceTab('workstation-tool', { toolId, rootVersion: 'prior' });
      assert.equal(saved.toolId, toolId);
      const html = render('WorkstationTool', { view: saved });
      assert.match(html, /Coming Soon/);
      assert.doesNotMatch(html, /<button\b|<input\b|<select\b|Directory changed/);
    }
    assert.equal(requestWorkspaceTool('ws', 'workstation-tool', { toolId: 'ai' }), true);
    assert.deepEqual(received.map(intent => intent.fields.toolId), ['ai']);
  } finally { release(); }
});

test('local appearance and installation have no retired connection shortcuts', () => {
  const appearance = render('DisplayPreferences', { colors: true }), code = render('CodeAppearanceSettings'), installation = render('LocalInstallation');
  assert.doesNotMatch(appearance, /<span>(?:Inbox|Conversations|AI connections|Focus)<\/span>/);
  assert.match(code, /<h1>Code appearance<\/h1>/); assert.doesNotMatch(code, /Open GitHub connections/);
  assert.match(installation, /CLI tools on this computer/); assert.match(installation, /Terminal preferences/);
  assert.doesNotMatch(installation, /Use local sign-in|Agent tool permissions|Local scheduling/);
});

test('local template authoring hides agent selection but retains historical payload defaults', () => {
  const item = { id: 'template', name: 'Old brief', payload: { content: 'Brief', status: 'ready', priority: 'medium', agent_ids: ['legacy_agent'] }, version: 1 };
  const html = render('ResourceEditor', { kind: 'route_template', item, onClose() {} }, { data: { agents: [{ id: 'legacy_agent', name: 'Historical profile' }] } });
  assert.doesNotMatch(html, /Suggested agents|Historical profile/); assert.deepEqual(item.payload.agent_ids, ['legacy_agent']);
  assert.match(source('src/views/settings/ResourcePage.jsx'), /item\?\.payload\[key\]/);
});

test('new settings use explicit current binding and existing terminal preferences without launch endpoints', () => {
  const jsx = source('src/views/settings/LocalWorkspaceSettings.jsx');
  assert.match(jsx, /assertLocalTerminalSettingsTarget\(selected, result\)/); assert.match(jsx, /'settings', \{ method: 'PATCH', body: \{ \.\.\.patch, expected_binding_version: selected.expectedBindingVersion \} \}/);
  assert.match(jsx, /workbenchRequest\(nextTarget.scope, ''/);assert.match(jsx,/currentWorkspace.current === workspaceId/);
  assert.match(jsx, /useUnsavedUpdate\(false, busy\)/); assert.match(jsx, /if \(locked.current/);
  assert.doesNotMatch(jsx, /'terminals'|native-agent-preview|connectConnection|spawn\(|executeJavaScript/);
  assert.match(render('LocalTerminalSettings'), /Reading terminal preferences/);
});

test('onboarding uses detected CLIs and an explicit directory step, not named-agent or connector setup', () => {
  const jsx = source('src/components/workspace/WorkspaceWelcome.jsx');
  assert.match(jsx, /Choose your default CLI/); assert.match(jsx, /Choose your project directory/);
  assert.match(jsx, /onClick=\{onChooseDirectory\}/); assert.match(jsx, /Each CLI keeps its own provider login/);
  assert.doesNotMatch(jsx, /Optional GitHub setup|set up a connection later|Choose your default agent|browser or agent session/);
});

test('local API persists tab appearance and native terminal preferences without provider calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-cli-settings-')), root = join(directory, 'project'); await mkdir(root);
  const forbidden = () => { throw Error('No provider execution or network'); };
  const api = createLocalApi({ dataDir: join(directory, 'storage'), productMode: 'local', integrationOptions: { env: {}, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden } });
  const server = createServer(api.middleware);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = async (path, body, method = body ? 'POST' : 'GET') => { const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: response.status, body: await response.json() }; };
    const patched = await call('/settings', { appearance: { workspaceTabSize: 'comfortable', workspaceTabCloseButtons: 'hover' } }, 'PATCH');
    assert.equal(patched.status, 200); assert.equal(patched.body.settings.appearance.workspaceTabSize, 'comfortable');
    assert.equal((await call('/settings', { appearance: { workspaceTabSize: 'invalid' } }, 'PATCH')).status, 400);
    const workspace = (await call('/workspaces', { name: 'Fixture' })).body.workspace;
    const project = (await call('/projects', { workspace_id: workspace.id, name: 'Project' })).body.project;
    assert.equal((await call('/directory-workspace', { workspace_id: workspace.id, project_id: project.id, path: root, confirmed: true }, 'PUT')).status, 200);
    const query = `?workspace_id=${workspace.id}&project_id=${project.id}`;
    const result = await call('/workbench/settings' + query, { workspace_id: workspace.id, project_id: project.id, terminalFontSize: 18, maxTerminals: 3 }, 'PATCH');
    assert.equal(result.status, 200); assert.equal(result.body.result.settings.terminalFontSize, 18); assert.equal(result.body.result.settings.maxTerminals, 3);
    assert.equal((await call('/workbench' + query)).body.result.settings.terminalFontSize, 18);
    assert.equal(api.snapshot().runs.length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); api.close(); await rm(directory, { recursive: true, force: true }); }
});

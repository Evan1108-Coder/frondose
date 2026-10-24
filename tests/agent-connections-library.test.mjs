import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXECUTION_PROVIDERS } from '../src/lib/ai-providers.js';
import { agentConnectionMethods } from '../src/lib/agent-connection-methods.js';
import { AGENT_CONNECTION_CATALOG, FEATURED_AGENT_CONNECTIONS, agentConnectionById, searchAgentConnections,
  workspaceAgentIdentities, identityConnectionReadiness, connectedAgentIdentities, providerAccountReady, methodBinding } from '../src/lib/agent-connections-catalog.js';

const scope = 'workspace-fixture';
const account = (extra = {}) => ({ id: 'openrouter-account', provider: 'openrouter', mode: 'live', state: 'connected', workspace_states: { [scope]: 'connected', other: 'not_connected' }, ...extra });
const agent = (extra = {}) => ({ id: 'agent-fixture', workspace_id: scope, provider: 'openrouter', provider_connection_id: 'openrouter-account', name: 'My research agent', status: 'available', ...extra });

test('connection library covers the execution catalog exactly and only advertises implemented routes', () => {
  assert.deepEqual(AGENT_CONNECTION_CATALOG.map(item => item.id), EXECUTION_PROVIDERS);
  assert.equal(new Set(AGENT_CONNECTION_CATALOG.map(item => item.id)).size, AGENT_CONNECTION_CATALOG.length);
  for (const item of AGENT_CONNECTION_CATALOG) {
    assert.equal(agentConnectionById(item.id), item);
    assert.ok(item.name && item.description, item.id);
    assert.ok(['code', 'models'].includes(item.group), item.id);
    assert.deepEqual(item.methods, agentConnectionMethods(item.id), item.id);
    assert.ok(item.methods.length > 0, item.id);
    for (const link of [item.website, item.docs].filter(Boolean)) assert.equal(new URL(link).protocol, 'https:', item.id);
  }
  assert.equal(agentConnectionById('not-a-provider'), undefined);
  assert.equal(FEATURED_AGENT_CONNECTIONS.length, 3);
  assert.equal(new Set(FEATURED_AGENT_CONNECTIONS.map(item => item.id)).size, 3);
  for (const featured of FEATURED_AGENT_CONNECTIONS) {
    assert.ok(agentConnectionById(featured.id));
    assert.match(featured.image, /^\/agent-connections\/[a-z-]+\.png$/);
    assert.ok(featured.headline);
  }
});

test('search matches every normalized query word, respects category, and never mutates catalog order', () => {
  const original = AGENT_CONNECTION_CATALOG.map(item => item.id);
  assert.deepEqual(searchAgentConnections('  CODEX  ').map(item => item.id), ['codex']);
  assert.ok(searchAgentConnections('browser authorization').some(item => item.id === 'openrouter'));
  assert.ok(searchAgentConnections('API key', 'models').every(item => item.group === 'models'));
  assert.ok(searchAgentConnections('', 'code').every(item => item.group === 'code'));
  assert.deepEqual(searchAgentConnections('not-a-real-connection-xyz'), []);
  assert.deepEqual(searchAgentConnections('', 'not-a-category'), []);
  assert.deepEqual(AGENT_CONNECTION_CATALOG.map(item => item.id), original);
});

test('identity listing excludes personal Frondose, archived and other-workspace profiles while retaining legacy unscoped data', () => {
  const data = { agents: [agent(), agent({ id: 'self', personal_agent: true }), agent({ id: 'old', archived_at: '2026-10-20' }),
    agent({ id: 'camel-old', archived_at: undefined, archivedAt: '2026-10-20' }), agent({ id: 'foreign', workspace_id: 'other' }), agent({ id: 'legacy', workspace_id: undefined })] };
  assert.deepEqual(workspaceAgentIdentities(data, scope).map(item => item.id), ['agent-fixture', 'legacy']);
  assert.deepEqual(workspaceAgentIdentities({}, scope), []);
});

test('connected identities require their exact binding, current workspace state and a usable non-demo identity', () => {
  const data = { connections: [account()], agents: [agent(), agent({ id: 'paused', status: 'paused' }),
    agent({ id: 'unbound', provider_connection_id: '' }), agent({ id: 'missing', provider_connection_id: 'gone' }),
    agent({ id: 'foreign', workspace_id: 'other' }), agent({ id: 'wrong-provider', provider: 'anthropic' })] };
  assert.deepEqual(connectedAgentIdentities(data, scope).map(item => item.id), ['agent-fixture']);
  assert.equal(identityConnectionReadiness(data.agents[2], data).canStartLive, false);
  assert.equal(providerAccountReady('openrouter', data, scope), true);
  assert.equal(providerAccountReady('openrouter', data, 'other'), false);
  assert.equal(providerAccountReady('anthropic', data, scope), false);
  assert.equal(providerAccountReady('openrouter', { connections: [account({ mode: 'demo', metadata: { simulated: true } })] }, scope), false);
  assert.equal(providerAccountReady('openrouter', { connections: [account({ workspace_states: { [scope]: 'connecting' } })] }, scope), false);
  const foreign = { agents: [agent()], connections: [account({ workspace_id: 'other', workspace_states: undefined })] };
  assert.equal(identityConnectionReadiness(foreign.agents[0], foreign).canStartLive, false);
  assert.deepEqual(connectedAgentIdentities(foreign, scope), []);
});

test('computer readiness remains profile-bound and never substitutes an unrelated live API account', () => {
  const make = runner_connection => agent({ provider: 'codex', provider_connection_id: '', runner_connection });
  const ready = { runtime_id: 'codex', enabled: true, state: 'online', can_use: true };
  assert.equal(identityConnectionReadiness(make(ready), {}).canStartLive, true);
  for (const update of [{ enabled: false }, { state: 'offline' }, { can_use: false }, { state: 'access_denied' }]) {
    assert.equal(identityConnectionReadiness(make({ ...ready, ...update }), { connections: [account()] }).canStartLive, false);
  }
});

test('shared/global profiles resolve readiness in the current workspace rather than an undefined scope', () => {
  const shared = agent({ workspace_id: null });
  const data = { agents: [shared], connections: [account()] };
  assert.equal(identityConnectionReadiness(shared, data, scope).canStartLive, true);
  assert.equal(identityConnectionReadiness(shared, data, 'other').canStartLive, false);
  assert.equal(identityConnectionReadiness(shared, data, 'missing').canStartLive, false);
  assert.deepEqual(connectedAgentIdentities(data, scope).map(item => item.id), [shared.id]);
  assert.deepEqual(connectedAgentIdentities(data, 'other'), []);
  assert.equal(shared.workspace_id, null, 'scope resolution never mutates a shared definition');
  assert.equal(identityConnectionReadiness(shared, { connections: [account({ workspace_id: 'other', workspace_states: undefined })] }, scope).canStartLive, false);
});

test('API and OAuth binding require matching authoritative credential method metadata', () => {
  const data = { connections: [account()] };
  assert.equal(methodBinding('openrouter', 'api', data, scope, { openrouter: { method: 'api_key' } }), 'openrouter-account');
  assert.equal(methodBinding('openrouter', 'oauth', data, scope, { openrouter: { method: 'oauth' } }), 'openrouter-account');
  assert.equal(methodBinding('openrouter', 'api', data, scope, { openrouter: { method: 'oauth' } }), '');
  assert.equal(methodBinding('openrouter', 'oauth', data, scope, { openrouter: { method: 'api_key' } }), '');
  for (const metadata of [undefined, null, {}, { openrouter: {} }, { openrouter: { method: 'unknown' } }]) {
    assert.equal(methodBinding('openrouter', 'api', data, scope, metadata), '', 'unknown API metadata must not prebind');
    assert.equal(methodBinding('openrouter', 'oauth', data, scope, metadata), '', 'unknown OAuth metadata must not prebind');
  }
});

test('method binding rejects unsupported routes and never binds a disconnected, demo or foreign-scoped account', () => {
  const data = { connections: [account()] }, metadata = { openrouter: { method: 'api_key' } };
  assert.equal(methodBinding('openrouter', 'invented', data, scope, metadata), '');
  assert.equal(methodBinding('openai', 'oauth', { connections: [account({ id: 'openai-account', provider: 'openai' })] }, scope, { openai: { method: 'oauth' } }), '');
  assert.equal(methodBinding('codex', 'api', { connections: [account({ id: 'codex-account', provider: 'codex' })] }, scope, { codex: { method: 'api_key' } }), '');
  for (const extra of [{ mode: 'demo' }, { workspace_states: { [scope]: 'not_connected' } }, { workspace_id: 'other', workspace_states: undefined }]) {
    assert.equal(methodBinding('openrouter', 'api', { connections: [account(extra)] }, scope, metadata), '');
  }
  assert.equal(providerAccountReady('openrouter', { connections: [account({ workspace_id: 'other', workspace_states: undefined })] }, scope), false);
});

test('generic computer routes stay unbound until explicit computer selection; Copilot OAuth is not a local account', () => {
  assert.equal(methodBinding('goose', 'computer', { connections: [account({ id: 'goose', provider: 'goose' })] }, scope, {}), '');
  const copilot = { connections: [account({ id: 'copilot', provider: 'copilot' })] };
  assert.equal(methodBinding('copilot', 'computer', copilot, scope, { copilot: { method: 'github_oauth' } }), '');
  assert.equal(methodBinding('copilot', 'computer', copilot, scope, {}), '');
  assert.equal(methodBinding('copilot', 'computer', copilot, scope, { copilot: { method: 'local_acp' } }), 'copilot');
});

const require = createRequire(import.meta.url);
let runtimePromise;
function runtime() {
  runtimePromise ??= build({ stdin: { contents: 'export { AgentConnectionsHome } from "./src/views/AgentConnectionsHome.jsx"; export { ProviderProductPreview } from "./src/components/ProviderProductPreview.jsx"; export { ConnectionActionMenu } from "./src/components/ConnectionActionMenu.jsx"; export { AgentEditor } from "./src/components/AgentEditor.jsx"; export { formFixture } from "./src/components/Form.jsx"; export { actionFixture } from "./src/data/useFrondose.js"; export { AppContext } from "./src/app-context.js";', resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', loader: { '.css': 'empty', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
    plugins: [{ name: 'isolated-editor-fixtures', setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)useFrondose\.js$/ }, () => ({ path: 'store-fixture', namespace: 'library-fixtures' }));
      builder.onResolve({ filter: /(?:^|\/)Form\.jsx$/ }, () => ({ path: 'form-fixture', namespace: 'library-fixtures' }));
      builder.onLoad({ filter: /.*/, namespace: 'library-fixtures' }, args => ({ loader: 'js', contents: args.path === 'store-fixture'
        ? 'export const actionFixture={calls:[],result:{id:"created-fixture"}}; export const frondoseActions=new Proxy({}, {get(_,name){return async(...args)=>{actionFixture.calls.push({name,args});if(name!=="createAgent"&&name!=="updateAgent")throw new Error("Unexpected fixture action: "+String(name));return actionFixture.result;}}}); export const refreshFrondose=()=>{throw new Error("Unexpected refresh");};'
        : 'import {createElement} from "react"; export const formFixture={submit:null}; export function Form({children,onSubmit,...props}){formFixture.submit=onSubmit;return createElement("form",props,children);}' }));
    } }, { name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path), external: true })); } }],
  }).then(result => {
    // Evaluate only this trusted repository bundle in memory, sharing React with
    // the renderer. No generated bundle files, servers or provider calls.
    const fixture = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, fixture, fixture.exports);
    return fixture.exports;
  });
  return runtimePromise;
}
async function renderHome({ id = null, data = {} } = {}) {
  const ui = await runtime();
  const context = { data: { agents: [], connections: [], chats: [], ...data }, workspace: { id: scope }, page: { view: 'agents', id }, navigate: () => {}, edit: () => {} };
  return renderToStaticMarkup(React.createElement(ui.AppContext.Provider, { value: context }, React.createElement(ui.AgentConnectionsHome)));
}
test('library SSR renders the actual connected identities, accessible search and three editorial gallery choices without provider calls', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error('Rendering must not contact providers'); };
  try {
    const html = await renderHome({ data: { agents: [agent(), agent({ id: 'unbound', name: 'Not connected fixture', provider_connection_id: '' })], connections: [account()] } });
    assert.match(html, /Your Agents/);
    assert.match(html, /aria-label="Search Agent Connections"/);
    assert.match(html, /My research agent/);
    assert.doesNotMatch(html, /Not connected fixture/);
    assert.match(html, /1 identity needs/);
    assert.match(html, /aria-label="Featured connections"/);
    for (const name of ['Codex', 'Claude Code', 'OpenRouter']) assert.ok(html.includes(name), name);
    assert.match(html, /Coding agents/); assert.match(html, /Models &amp; API providers/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previousFetch; }
});

async function renderEditor({ item = null, defaults = {} } = {}) {
  const ui = await runtime(), calls = { closed: 0, navigation: [], notifications: [] };
  ui.actionFixture.calls = [];
  ui.actionFixture.result = { id: 'created-fixture' };
  const context = { data: { connections: [], agents: [], projects: [], teams: [] }, workspace: { id: scope },
    notify: (...args) => calls.notifications.push(args), navigate: (...args) => calls.navigation.push(args) };
  const html = renderToStaticMarkup(React.createElement(ui.AppContext.Provider, { value: context }, React.createElement(ui.AgentEditor, { item, defaults, onClose: () => { calls.closed += 1; } })));
  return { ui, html, calls, submit: ui.formFixture.submit };
}
test('computer-bound editor fixes provider and connection method even when the saved helper is disabled', async () => {
  const item = agent({ provider: 'goose', provider_connection_id: '', runner_connection: { runtime_id: 'goose', enabled: false, state: 'offline' } });
  const { html } = await renderEditor({ item });
  assert.match(html, /agent-selected-provider/);
  assert.doesNotMatch(html, /Search agent providers|type="radio"|aria-label="Account connection"|aria-label="Local account"/);
  assert.match(html, /aria-label="Connection method"[^>]*disabled=""/);
  assert.match(html, /This identity uses its computer binding/);
  assert.match(html, /Change or remove that binding in Computer connection/);
  assert.match(html, /Connect \/ manage computer/);
});
test('explicit new computer-profile creation saves once and routes to that identity’s actual computer settings', async () => {
  const { ui, calls, submit } = await renderEditor({ defaults: { name: 'New computer fixture', provider: 'goose', connection_method: 'computer', lock_provider: true } });
  assert.equal(ui.actionFixture.calls.length, 0, 'rendering alone never creates a profile');
  await submit({ preventDefault() {} });
  assert.equal(ui.actionFixture.calls.length, 1);
  assert.equal(ui.actionFixture.calls[0].name, 'createAgent');
  assert.equal(ui.actionFixture.calls[0].args[0].provider, 'goose');
  assert.equal(ui.actionFixture.calls[0].args[0].provider_connection_id, null);
  assert.equal(ui.actionFixture.calls[0].args[0].workspace_id, scope);
  assert.deepEqual(calls.navigation, [['agents', 'created-fixture', { section: 'computer' }]]);
  assert.equal(calls.closed, 1);
  const roster = readFileSync(new URL('../src/views/AgentRoster.jsx', import.meta.url), 'utf8');
  assert.match(roster, /useState\(page\.section === 'computer'\)/);
  assert.match(roster, /page\.section === 'computer'[\s\S]*setTab\('overview'\); setComputerOpen\(true\)/);
  assert.match(roster, /<details open=\{computerOpen\}[\s\S]*<summary>Computer connection<\/summary>[\s\S]*<AgentRunnerSettings agentId=\{agent\.id\} workspaceId=\{workspace\.id\}/);
});
test('API-profile save does not accidentally route into computer settings', async () => {
  const { calls, submit } = await renderEditor({ defaults: { name: 'API fixture', provider: 'openrouter', connection_method: 'api', provider_connection_id: 'openrouter-account', model: 'fixture/text-model', lock_provider: true } });
  await submit({ preventDefault() {} });
  assert.deepEqual(calls.navigation, [['agents', 'created-fixture', undefined]]);
  assert.equal(calls.closed, 1);
});
test('provider detail SSR keeps direct and personalized choices separate, labels examples, and disclaims native chat sync', async () => {
  const html = await renderHome({ id: 'connection-openrouter' });
  assert.match(html, /Connect OpenRouter/); assert.match(html, /Create Agent Connection/);
  assert.match(html, /Illustrative preview · not a live session/);
  assert.match(html, /CLI chat-history import and synchronization are not part/);
  assert.match(html, /A conversation keeps one responding identity/);
  assert.match(html, /Setup required/);
  assert.doesNotMatch(html, /aria-label="Search Agent Connections"/);
  const unavailable = await renderHome({ id: 'connection-not-a-provider' });
  assert.match(unavailable, /Connection unavailable/);
  assert.doesNotMatch(unavailable, /Connect not-a-provider|Create Agent Connection/);
});
test('product previews are noninteractive, accessible illustrative content, and connection menus do not choose routes during SSR', async () => {
  const ui = await runtime();
  for (const kind of ['conversation', 'context']) {
    const html = renderToStaticMarkup(React.createElement(ui.ProviderProductPreview, { provider: agentConnectionById('codex'), kind }));
    assert.match(html, /Illustrative Codex/); assert.match(html, /not a live session/);
    assert.doesNotMatch(html, /<button|<input|<textarea/);
  }
  let choices = 0;
  const menu = renderToStaticMarkup(React.createElement(ui.ConnectionActionMenu, { label: 'Connect fixture', methods: agentConnectionMethods('openrouter'), onChoose: () => { choices += 1; } }));
  assert.match(menu, /aria-haspopup="menu"/); assert.match(menu, /aria-expanded="false"/);
  assert.doesNotMatch(menu, /role="menuitem"/);
  assert.equal(choices, 0);
  const empty = renderToStaticMarkup(React.createElement(ui.ConnectionActionMenu, { label: 'Unavailable fixture', methods: [], onChoose: () => { choices += 1; } }));
  assert.match(empty, /disabled=""/);
  assert.equal(choices, 0);
});

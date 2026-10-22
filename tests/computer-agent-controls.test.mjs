import test from 'node:test';
import assert from 'node:assert/strict';
import { agentForWorkspace, computerAgentControls, hasAgentAccountRoute, requestNativeTools } from '../src/lib/computer-agent-controls.js';
import { agentReadiness } from '../src/lib/agents.js';
import { RUNNER_PROVIDER_CATALOG } from '../src/lib/runner-provider-catalog.js';
import { readFileSync } from 'node:fs';

test('computer-only runtimes never enter the legacy account-management strip', () => {
  for (const provider of ['codex', 'claude', 'copilot', 'openai', 'gemini', 'huggingface']) assert.equal(hasAgentAccountRoute(provider), true);
  for (const provider of ['omp', 'pi', 'opencode', 'muse', 'antigravity', 'amp-acp']) assert.equal(hasAgentAccountRoute(provider), false);
  const roster = readFileSync(new URL('../src/views/AgentRoster.jsx', import.meta.url), 'utf8');
  assert.match(roster, /Object.entries\(AGENT_PROVIDERS\)\.filter\(\(\[id\]\) => hasAgentAccountRoute\(id\)\)/);
});

test('legacy shared profiles resolve computer availability in the selected workspace only', () => {
  const ready = { enabled: true, state: 'ready', can_use: true, runtime_id: 'codex' };
  const disabled = { enabled: false, state: 'agent_connection_disabled', can_use: false, connection_method: 'unselected' };
  const raw = { id: 'shared', provider: 'codex', provider_connection_id: null, workspace_id: null, runner_connection: null, runner_connections_by_workspace: { a: ready, b: disabled } };
  const inA = agentForWorkspace(raw, 'a'), inB = agentForWorkspace(raw, 'b'), inC = agentForWorkspace(raw, 'c');
  assert.equal(agentReadiness(inA).canStartLive, true);
  assert.equal(agentReadiness(inB).canStartLive, false);
  assert.equal(agentReadiness(inC).canStartLive, false);
  assert.equal(inA.runner_connection, ready);
  assert.equal(inB.runner_connection, disabled);
  assert.equal(inC.runner_connection, null);
  assert.equal(inA.runner_connections_by_workspace, undefined);
  assert.equal(inB.runner_connections_by_workspace, undefined);
  assert.equal(raw.runner_connections_by_workspace.b, disabled, 'presentation selection must not mutate raw bootstrap state');
  assert.equal(agentForWorkspace({ ...raw, runner_connection: ready, runner_connections_by_workspace: { b: disabled } }, 'b').runner_connection, disabled, 'explicit disabled/unselected summary cannot fall back to a ready legacy account');
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /\.map\(item => agentForWorkspace\(item, workspace\?\.id\)\)/);
});

test('Gemini CLI binding is not mistaken for Gemini API and native bridge is never sent', () => {
  const agent = { provider: 'gemini', runner_connection: { enabled: true, state: 'ready', native_tools_allowed: true, requires_project_access: true } };
  assert.equal(computerAgentControls(agent).api, false);
  assert.equal(computerAgentControls(agent, { projectId: 'p' }).canBuild, true);
  assert.equal(computerAgentControls(agent).requiresProject, true);
  assert.equal(requestNativeTools(agent, true), false);
  assert.equal(requestNativeTools({ provider: 'codex' }, true), true);
  assert.equal(computerAgentControls({ provider: 'gemini' }).api, true);
});

test('native Build controls preserve profile and global read-only intent', () => {
  const agent = { provider: 'claude', runner_connection: { native_tools_allowed: true } };
  assert.equal(computerAgentControls(agent).canBuild, true);
  assert.equal(computerAgentControls({ ...agent, permission_policy: 'read-only' }).canBuild, false);
  assert.equal(computerAgentControls(agent, { globalReadOnly: true }).canBuild, false);
  assert.equal(computerAgentControls({ ...agent, runner_connection: { native_tools_allowed: false } }).canBuild, false);
});

test('all 47 computer identities use explicit computer readiness before legacy account checks', () => {
  for (const provider of RUNNER_PROVIDER_CATALOG) {
    const agent = { id: 'a', provider: provider.id, provider_connection_id: null, runner_connection: { enabled: true, state: 'ready', can_use: true } };
    assert.equal(agentReadiness(agent).canStartLive, true, provider.id);
    assert.equal(agentReadiness({ ...agent, runner_connection: { ...agent.runner_connection, enabled: false } }).canStartLive, false);
    assert.equal(agentReadiness({ ...agent, runner_connection: { ...agent.runner_connection, can_use: false } }).canStartLive, false);
    assert.equal(agentReadiness({ ...agent, runner_connection: { ...agent.runner_connection, state: 'offline' } }).canStartLive, false);
  }
});

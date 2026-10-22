import test from 'node:test';
import assert from 'node:assert/strict';
import { computerAgentControls, requestNativeTools } from '../src/lib/computer-agent-controls.js';
import { agentReadiness } from '../src/lib/agents.js';
import { RUNNER_PROVIDER_CATALOG } from '../src/lib/runner-provider-catalog.js';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { workbenchScopeFields } from '../src/lib/workbench.js';
import { newWorkspaceTab, normalizeWorkspaceTabs, persistedWorkspaceTabs } from '../src/lib/workspace-tabs.js';
import { readWorkspaceTerminalViewStatus, stopWorkspaceTerminalView, terminalViewLayoutEvidence } from '../src/lib/workspace-terminal-close.js';

test('workspace-only terminal requests omit all project authority', () => {
  assert.deepEqual(workbenchScopeFields({ workspaceId: 'ws', projectId: null, host: 'workspace' }), { workspace_id: 'ws', host_scope: 'workspace' });
  for (const extra of [{ projectId: 'project' }, { environmentId: 'env' }]) assert.throws(() => workbenchScopeFields({ workspaceId: 'ws', host: 'workspace', ...extra }), /project authority/);
  assert.deepEqual(workbenchScopeFields({ workspaceId: 'ws', projectId: 'project' }), { workspace_id: 'ws', project_id: 'project', environment_id: null });
});

test('saved home-host tabs retain host identity and never adopt a later project', () => {
  const tab = newWorkspaceTab('terminal', { terminalHost: 'workspace', projectId: 'foreign', providerId: 'codex' }, 'home_tab');
  assert.equal(tab.terminalHost, 'workspace'); assert.equal(tab.projectId, undefined);
  const state = { version: 1, tabs: [tab], activeTabId: tab.id, orientation: 'horizontal', recentlyClosed: [] };
  const restored = normalizeWorkspaceTabs(persistedWorkspaceTabs(state), { view: 'workspace' });
  assert.equal(restored.tabs[0].terminalHost, 'workspace'); assert.equal(restored.tabs[0].projectId, undefined);
  assert.equal(newWorkspaceTab('editor', { terminalHost: 'workspace', projectId: 'project' }, 'editor').terminalHost, undefined);
});

test('home terminal close evidence uses a distinct host identity and rejects scope substitution', async () => {
  const scope = { workspaceId: 'ws', projectId: null, host: 'workspace' }, viewId = 'home_view';
  let key;
  const storage = { getItem(value) { key = value; return null; } };
  terminalViewLayoutEvidence(scope, viewId, storage);
  assert.equal(key, 'frondose:terminal-splits:v1:ws:workspace::home_view');
  const result = { workspace_id: 'ws', project_id: null, host_scope: 'workspace', view_id: viewId, state: 'running', verified: true, can_stop: true, sessions: [{ id: 'term_home', name: 'Terminal', status: 'running', owner_view_id: viewId }], stop_session_ids: ['term_home'], fingerprint: 'a'.repeat(64) };
  const status = await readWorkspaceTerminalViewStatus(scope, viewId, { storage, request: async () => result });
  assert.equal(status.verified, true);
  for (const change of [{ host_scope: undefined }, { project_id: 'project' }]) assert.equal((await readWorkspaceTerminalViewStatus(scope, viewId, { storage, request: async () => ({ ...result, ...change }) })).verified, false);
  await assert.rejects(stopWorkspaceTerminalView(scope, viewId, { confirmed: true, reviewedStatus: { ...status, scope: { workspaceId: 'ws', projectId: null } }, request: async () => { throw Error('Must not call'); } }), /host/);
  const stopped = await stopWorkspaceTerminalView(scope, viewId, { confirmed: true, reviewedStatus: status, request: async () => ({ workspace_id: 'ws', project_id: null, host_scope: 'workspace', view_id: viewId, state: 'idle', stopped: true, stopped_session_ids: ['term_home'] }) });
  assert.equal(stopped.stopped, true);
});

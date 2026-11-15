import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readWorkspaceTerminalViewStatus, stopWorkspaceTerminalView, terminalViewLayoutEvidence } from '../src/lib/workspace-terminal-close.js';

const scope = { workspaceId: 'ws', projectId: 'project' }, viewId = 'view_a';
const fingerprint = 'a'.repeat(64), storage = value => ({ getItem() { return value; } });
const layout = ids => JSON.stringify({ version: 1, root: ids.length === 2 ? { type: 'split', direction: 'vertical', first: { type: 'leaf', leafId: ids[0] }, second: { type: 'leaf', leafId: ids[1] } } : ids.length ? { type: 'leaf', leafId: ids[0] } : null });
const running = () => ({ workspace_id: 'ws', project_id: 'project', view_id: viewId, state: 'running', verified: true, can_stop: true, sessions: [{ id: 'term_a', name: 'Codex', status: 'running', owner_view_id: viewId }], stop_session_ids: ['term_a'], fingerprint, reason: null, pending_count: 0 });

test('inactive tab evidence uses exactly workspace/project/environment/view storage identity', () => {
  let key;
  const result = terminalViewLayoutEvidence({ ...scope, environmentId: 'env' }, viewId, { getItem(value) { key = value; return layout(['term_b', 'term_a']); } });
  assert.equal(key, 'frondose:terminal-splits:v1:ws:project:env:view_a');
  assert.deepEqual(result, { known: true, ids: ['term_a', 'term_b'] });
  assert.deepEqual(terminalViewLayoutEvidence(scope, viewId, storage(null)), { known: true, ids: [] });
});

test('malformed or unreadable saved pane evidence never becomes terminal authority', () => {
  for (const value of ['{', '[]', '{}', JSON.stringify({ version: 1, root: { type: 'launch', command: 'stop-all' } }), JSON.stringify({ version: 1, root: { type: 'leaf', leafId: '../elsewhere' } }), 'x'.repeat(20001)]) assert.equal(terminalViewLayoutEvidence(scope, viewId, storage(value)).known, false);
  assert.equal(terminalViewLayoutEvidence(scope, viewId, { getItem() { throw new Error('storage denied'); } }).known, false);
});

test('view read requests only scoped backend ownership and treats saved IDs as attachment evidence', async () => {
  const calls = [];
  const status = await readWorkspaceTerminalViewStatus(scope, viewId, { storage: storage(layout(['term_a'])), request: async (...args) => { calls.push(args); return running(); } });
  assert.equal(status.state, 'running'); assert.equal(status.canStop, true); assert.deepEqual(status.stopSessionIds, ['term_a']);
  assert.deepEqual(calls[0][0], scope); assert.equal(calls[0][1], 'terminal-views/view_a'); assert.equal(calls[0][2].body.visible_ids, '["term_a"]');
});

test('a new view with no saved IDs can be verified idle without adopting project sessions', async () => {
  const status = await readWorkspaceTerminalViewStatus(scope, viewId, { storage: storage(null), request: async () => ({ ...running(), state: 'idle', can_stop: false, sessions: [], stop_session_ids: [] }) });
  assert.equal(status.state, 'idle'); assert.equal(status.verified, true); assert.equal(status.canStop, false); assert.deepEqual(status.stopSessionIds, []);
});

test('scope mismatch, malformed responses and unowned attachments all fail closed', async () => {
  for (const change of [{ workspace_id: 'other' }, { project_id: 'other' }, { view_id: 'other' }, { sessions: [{ ...running().sessions[0], owner_view_id: 'other' }] }, { stop_session_ids: ['term_not_reported'] }, { fingerprint: 'wrong' }, { sessions: [...running().sessions, ...running().sessions] }, { state: 'idle' }, { verified: false }]) {
    const status = await readWorkspaceTerminalViewStatus(scope, viewId, { storage: storage(null), request: async () => ({ ...running(), ...change }) });
    assert.equal(status.state, 'unknown'); assert.equal(status.canStop, false);
  }
  const unknown = await readWorkspaceTerminalViewStatus(scope, viewId, { storage: storage(null), request: async () => ({ ...running(), state: 'unknown', verified: false, can_stop: false, reason: 'session_not_owned_by_view' }) });
  assert.equal(unknown.reason, 'session_not_owned_by_view'); assert.equal(unknown.canStop, false);
});

test('read errors, unavailable storage and missing directory IDs do not enable a stop fallback', async () => {
  let requests = 0;
  for (const options of [{ storage: undefined }, { storage: { getItem() { throw new Error('denied'); } } }]) {
    const status = await readWorkspaceTerminalViewStatus(scope, viewId, { ...options, request: async () => { requests++; return running(); } });
    assert.equal(status.state, 'unknown'); assert.equal(status.canStop, false);
  }
  assert.equal(requests, 0);
  const failure = await readWorkspaceTerminalViewStatus(scope, viewId, { storage: storage(null), request: async () => { throw new Error('network failure'); } });
  assert.equal(failure.state, 'unknown'); assert.equal(failure.reason, 'view_status_unavailable');
  assert.equal((await readWorkspaceTerminalViewStatus({ workspaceId: 'ws' }, viewId)).state, 'unknown');
});

test('explicit stop sends only the reviewed server-owned IDs and fingerprint once', async () => {
  const status = await readWorkspaceTerminalViewStatus(scope, viewId, { storage: storage(layout(['term_a'])), request: async () => running() });
  const calls = [];
  const result = await stopWorkspaceTerminalView(scope, viewId, { reviewedStatus: status, confirmed: true, request: async (...args) => { calls.push(args); return { workspace_id: 'ws', project_id: 'project', view_id: viewId, state: 'idle', stopped: true, stopped_session_ids: ['term_a'] }; } });
  assert.equal(result.stopped, true); assert.equal(calls.length, 1); assert.equal(calls[0][1], 'terminal-views/view_a/stop');
  assert.deepEqual(calls[0][2].body, { confirmed: true, expected_session_ids: ['term_a'], fingerprint, visible_ids: ['term_a'] });
});

test('stop never runs without explicit consent, current scope and verified target ownership', async () => {
  const status = await readWorkspaceTerminalViewStatus(scope, viewId, { storage: storage(null), request: async () => running() });
  let requests = 0; const request = async () => { requests++; };
  for (const change of [{ confirmed: false }, { reviewedStatus: { ...status, verified: false } }, { reviewedStatus: { ...status, viewId: 'other' } }, { reviewedStatus: { ...status, stopSessionIds: ['term_other'] } }, { reviewedStatus: { ...status, sessions: [{ ...status.sessions[0], owner_view_id: 'other' }] } }]) await assert.rejects(stopWorkspaceTerminalView(scope, viewId, { reviewedStatus: status, confirmed: true, request, ...change }));
  await assert.rejects(stopWorkspaceTerminalView({ ...scope, projectId: 'other' }, viewId, { reviewedStatus: status, confirmed: true, request }));
  assert.equal(requests, 0);
});

test('stop mismatch or uncertain exit rejects without a retry or success claim', async () => {
  const status = await readWorkspaceTerminalViewStatus(scope, viewId, { storage: storage(null), request: async () => running() });
  let requests = 0;
  await assert.rejects(stopWorkspaceTerminalView(scope, viewId, { reviewedStatus: status, confirmed: true, request: async () => { requests++; throw new Error('ownership changed'); } }), /ownership changed/);
  assert.equal(requests, 1);
  for (const result of [{ state: 'running', stopped: false }, { workspace_id: 'other', project_id: 'project', view_id: viewId, state: 'idle', stopped: true, stopped_session_ids: ['term_a'] }, { workspace_id: 'ws', project_id: 'project', view_id: viewId, state: 'idle', stopped: true, stopped_session_ids: ['term_other'] }]) await assert.rejects(stopWorkspaceTerminalView(scope, viewId, { reviewedStatus: status, confirmed: true, request: async () => result }), /not confirmed/);
});

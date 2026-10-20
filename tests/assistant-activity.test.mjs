import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantActivity, assistantRunStatus, STOPPABLE_ASSISTANT_RUNS } from '../src/lib/assistant-activity.js';
import { pageHash, parsePage } from '../src/lib/navigation.js';

const runs = [
  { id: 'run-b', workspace_id: 'w', title: 'Research report', status: 'completed', mode: 'live', agent_id: 'agent', chat_id: 'chat', updated_at: '2026-10-20T09:00:00Z' },
  { id: 'run-a', workspace_id: 'w', title: 'Working draft', status: 'running', mode: 'live', updated_at: '2026-10-20T10:00:00Z' },
  { id: 'failure', workspace_id: 'w', title: 'Failed request', status: 'failed', updated_at: '2026-10-20T08:00:00Z' },
  { id: 'paused', workspace_id: 'w', title: 'Paused', status: 'paused' },
  { id: 'foreign', workspace_id: 'other', status: 'running' },
  { id: 'archived', workspace_id: 'w', status: 'completed', archived_at: '2026-10-20' },
];
const data = { runs, chats: [{ id: 'chat', workspace_id: 'w', title: 'Release planning', kind: 'rumbo-agent' }], agents: [{ id: 'agent', name: 'Researcher', workspace_id: null }], outputs: [{ id: 'output', run_id: 'run-b', title: 'Report', workspace_id: 'w' }, { id: 'private-output', run_id: 'run-b', workspace_id: 'other' }, { id: 'archived-output', run_id: 'run-b', workspace_id: 'w', archived_at: 'yes' }] };
test('assistant activity uses only visible current-workspace unarchived records with stable newest order', () => {
  const rows = assistantActivity(data, 'w');
  assert.deepEqual(rows.map(row => row.run.id), ['run-a', 'run-b', 'failure', 'paused']);
  assert.equal(rows[1].agent.name, 'Researcher');
  assert.equal(rows[1].chat.kind, 'rumbo-agent');
  assert.deepEqual(rows[1].outputs.map(output => output.id), ['output']);
  assert.equal(rows[1].working, false);
});
test('working excludes paused and failures while needs-you includes them; completion is invocation only', () => {
  assert.deepEqual(assistantActivity(data, 'w', { filter: 'working' }).map(row => row.run.id), ['run-a']);
  assert.deepEqual(assistantActivity(data, 'w', { filter: 'needs-you' }).map(row => row.run.id), ['failure', 'paused']);
  assert.deepEqual(assistantActivity(data, 'w', { filter: 'completed' }).map(row => row.run.id), ['run-b']);
  assert.equal(assistantRunStatus(runs[0]), 'Run completed');
  assert.equal(assistantRunStatus({ status: 'unexpected' }), 'Status unavailable');
  assert.ok(!STOPPABLE_ASSISTANT_RUNS.has('completed'));
});
test('search covers actual agent and chat identity, never another workspace metadata', () => {
  for (const query of ['report', ' Researcher ', 'RELEASE PLANNING']) assert.deepEqual(assistantActivity(data, 'w', { query }).map(row => row.run.id), ['run-b']);
  const revoked = assistantActivity({ ...data, chats: [], agents: [], outputs: [] }, 'w', { query: 'Researcher' });
  assert.deepEqual(revoked, []);
});
test('canonical pending runtime approval gates need attention but obsolete terminal gates do not', () => {
  const gated = { ...data, approvals: [{ run_id: 'run-a', status: 'pending' }, { run_id: 'run-b', status: 'pending' }] };
  assert.deepEqual(assistantActivity(gated, 'w', { filter: 'working' }), []);
  const rows = assistantActivity(gated, 'w', { filter: 'needs-you' });
  assert.equal(rows[0].run.id, 'run-a');
  assert.equal(rows[0].approvalNeeded, true);
  assert.ok(!rows.some(row => row.run.id === 'run-b'));
});
test('assistant sections round-trip new and legacy links and reject ambiguous/invalid section requests', () => {
  for (const section of ['conversation', 'activity', 'scheduled']) for (const id of [null, 'chat']) {
    const hash = pageHash('rumbo-agent', id, { section });
    assert.deepEqual(parsePage(hash), { view: 'rumbo-agent', id, projectId: null, section });
    assert.deepEqual(parsePage(hash.replace('talvori-agent', 'rumbo-agent')), parsePage(hash));
  }
  assert.equal(parsePage('#/talvori-agent?section=activity&section=scheduled').view, 'overview');
  assert.equal(parsePage('#/talvori-agent?section=bad').view, 'overview');
  assert.throws(() => pageHash('rumbo-agent', null, { section: 'bad' }), /Invalid assistant section/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { hierarchyCandidates, hierarchyRetryRequest, hierarchySnapshotSignature, leafProgressLabel, moveSibling, routeScope } from '../src/lib/sub-route-ui.js';
test('hierarchy candidates exclude descendants, parents, archived and mismatched scope', () => {
  const tasks = [{ id: 'root', title: 'Root', project_id: 'p' }, { id: 'child', title: 'Child', project_id: 'p' }, { id: 'free', title: 'Free', project_id: 'p' }, { id: 'other', title: 'Other', project_id: 'q' }, { id: 'gone', title: 'Gone', project_id: 'p', archived_at: 'now' }];
  const tree = { route: tasks[0], descendants: [tasks[1]] };
  assert.deepEqual(hierarchyCandidates(tasks, [], tree, 'attach').map(item => item.id), ['free']);
  assert.deepEqual(hierarchyCandidates(tasks, [{ id: 'free', parent_task_id: 'other' }], tree, 'attach'), []);
  assert.deepEqual(hierarchyCandidates(tasks, [], { ...tree, integrity: { restricted: true } }, 'parent'), []);
  assert.deepEqual(hierarchyCandidates(tasks, [{ id: 'free', hierarchy_restricted: true }], tree, 'attach'), []);
  assert.deepEqual(hierarchyCandidates([{ id: 'outside', workspace_id: 'other', project_id: 'p', title: 'Other workspace' }], [], tree, 'attach'), []);
});
test('route scope matches server exact persisted project and team', () => { assert.deepEqual(routeScope({ project_id: 'p' }), { project: 'p', team: null }); assert.deepEqual(routeScope({ project_id: 'p', team_id: 't' }), { project: 'p', team: 't' }); });
test('sibling moves preserve all IDs including hidden archived slots', () => {
  const children = [{ id: 'a' }, { id: 'b', archived_at: 'now' }, { id: 'c' }];
  assert.deepEqual(moveSibling(children, 'c', -1), ['c', 'b', 'a']);
  assert.equal(moveSibling(children, 'a', -1), null);
  assert.deepEqual(children.map(item => item.id), ['a', 'b', 'c']);
});
test('leaf progress never reports complete while restricted or invalid', () => {
  const progress = { done: 3, unfinished: 1, ratio: .75 };
  assert.equal(leafProgressLabel(progress, {}), '3 of 4 active leaf routes done');
  assert.match(leafProgressLabel(progress, { restricted: true }), /unavailable/);
  assert.match(leafProgressLabel(progress, { valid: false }), /repaired/);
  assert.equal(leafProgressLabel({ ratio: null }, {}), 'No active leaf work to measure.');
  assert.match(leafProgressLabel({ ratio: null, complete: false }, {}), /unavailable/);
});
test('unchanged bootstrap objects do not interrupt an open hierarchy picker', () => {
  const tasks = [{ id: 'a', status: 'ready', title: 'Original' }], workflows = [{ id: 'a', parent_task_id: null, version: 1 }];
  const signal = hierarchySnapshotSignature(tasks, workflows);
  assert.equal(hierarchySnapshotSignature(structuredClone(tasks), structuredClone(workflows)), signal);
  assert.equal(hierarchySnapshotSignature([{ ...tasks[0], title: 'New title' }], workflows), signal);
  assert.notEqual(hierarchySnapshotSignature([{ ...tasks[0], status: 'done' }], workflows), signal);
  assert.notEqual(hierarchySnapshotSignature(tasks, [{ ...workflows[0], parent_task_id: 'parent', version: 2 }]), signal);
});
test('uncertain create preserves original key AND revision after a fresh hierarchy load', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const input = { workspace_id: 'one', revision: 7, title: 'PRIVATE child title' };
  const first = await hierarchyRetryRequest(input, 'create:parent', storage);
  const replay = await hierarchyRetryRequest({ ...input, revision: 11 }, 'create:parent', storage);
  assert.equal(replay.request_id, first.request_id);
  assert.equal(replay.revision, 7);
  assert.ok(!JSON.stringify([...values]).includes('PRIVATE'));
  assert.notEqual((await hierarchyRetryRequest({ ...input, title: 'Other' }, 'create:parent', storage)).request_id, first.request_id);
  replay.clear();
  const fresh = await hierarchyRetryRequest({ ...input, revision: 11 }, 'create:parent', storage);
  assert.equal(fresh.revision, 11);
  assert.notEqual(fresh.request_id, first.request_id);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePage, pageHash } from '../src/lib/navigation.js';
import { normalizeOrganization } from '../src/lib/organization.js';
import { resolveShortcut } from '../src/lib/shortcuts.js';
import { insertSavedUpdates, mergeUpdatePages, updateTargets, updateTargetLink } from '../src/lib/updates.js';

test('Updates deep links and project filters survive navigation', () => {
  assert.deepEqual(parsePage(pageHash('updates', 'entry one', { projectId: 'p1' })), { view: 'updates', id: 'entry one', projectId: 'p1' });
  assert.ok(normalizeOrganization(null).layout.root.includes('updates'));
  assert.ok(normalizeOrganization({ version: 1, layout: { root: ['overview'], groups: [] } }).layout.root.includes('updates'));
  assert.equal(resolveShortcut({ key: 'u' }, { prefix: { key: 'g', at: 100 }, now: 150 }).action, 'go:updates');
});

test('Update target selection isolates workspace, archived records, and request kinds', () => {
  const data = { workspace_items: [{ id: 'r1', workspace_id: 'w1', kind: 'request' }, { id: 'r2', workspace_id: 'w2', kind: 'request' }, { id: 'r3', workspace_id: 'w1', kind: 'request', archived_at: 'now' }, { id: 'not-request', workspace_id: 'w1', kind: 'update' }] };
  assert.deepEqual(updateTargets(data, 'request', 'w1').map(item => item.id), ['r1']);
  assert.deepEqual(updateTargets(data, 'invalid', 'w1'), []);
});

test('Feed pagination deduplicates by identity and uses the latest supplied row', () => {
  assert.deepEqual(mergeUpdatePages([{ id: 'a', version: 1 }], [{ id: 'a', version: 2 }, { id: 'b', version: 1 }]), [{ id: 'a', version: 2 }, { id: 'b', version: 1 }]);
  assert.equal(updateTargetLink({ target_type: 'route', target_id: 'r1' }, {}), '#/tasks/r1');
  assert.equal(updateTargetLink({ target_type: 'milestone', target_id: 'm1' }, { milestones: [{ id: 'm1', project_id: 'p1' }] }), '#/projects/p1');
  assert.equal(updateTargetLink({ target_type: 'milestone', target_id: 'missing' }, {}), null);
});

test('Saving another update retains keyed conversations and paginated rows without switching visibility', () => {
  const existing = [{ id: 'original', version: 2 }, { id: 'older-page', version: 1 }];
  const first = { id: 'first', workspace_id: 'ws', publication_state: 'published', target_type: 'project', content: 'First update' };
  const second = { ...first, id: 'second' };
  const filters = { publicationState: 'published', search: '' };
  const result = insertSavedUpdates(existing, [first, second], 'ws', filters);
  assert.deepEqual(result.map(row => row.id), ['second', 'first', 'original', 'older-page']);
  assert.equal(result[2], existing[0]); assert.equal(result[3], existing[1]);
  assert.deepEqual(filters, { publicationState: 'published', search: '' });
  assert.deepEqual(insertSavedUpdates(existing, [{ ...first, publication_state: 'draft' }], 'ws', filters), existing);
  assert.deepEqual(insertSavedUpdates(existing, [first], 'ws', { publicationState: 'draft' }), existing);
  assert.deepEqual(insertSavedUpdates(existing, [{ ...first, id: 'original', version: 1 }], 'ws', filters).find(row => row.id === 'original'), existing[0]);
});

test('Newly saved feed entries respect existing work, Area, project, health and search filters', () => {
  const entry = { id: 'new', workspace_id: 'ws', parent_id: null, publication_state: 'published', target_type: 'route', update_type: 'progress', health: 'on_track', title: 'Launch', content: 'Ready for review', target: { project_ids: ['p'], team_id: 't' } };
  const filters = { publicationState: 'published', targetType: 'route', updateType: 'progress', health: 'on_track', projectId: 'p', teamId: 't', search: 'REVIEW' };
  assert.deepEqual(insertSavedUpdates([], [entry], 'ws', filters), [entry]);
  for (const patch of [{ publicationState: 'draft' }, { targetType: 'project' }, { updateType: 'risk' }, { health: 'blocked' }, { projectId: 'other' }, { teamId: 'other' }, { search: 'unrelated' }]) assert.deepEqual(insertSavedUpdates([], [entry], 'ws', { ...filters, ...patch }), []);
  for (const patch of [{ workspace_id: 'other' }, { parent_id: 'parent' }, { archived_at: 'now' }, { target: undefined }]) assert.deepEqual(insertSavedUpdates([], [{ ...entry, ...patch }], 'ws', filters), []);
  assert.equal(insertSavedUpdates([], [{ ...entry, archived_at: 'now' }], 'ws', { ...filters, includeArchived: true }).length, 1);
});

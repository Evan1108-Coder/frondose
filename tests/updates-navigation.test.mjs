import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePage, pageHash } from '../src/lib/navigation.js';
import { normalizeOrganization } from '../src/lib/organization.js';
import { resolveShortcut } from '../src/lib/shortcuts.js';
import { mergeUpdatePages, updateTargets, updateTargetLink } from '../src/lib/updates.js';

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

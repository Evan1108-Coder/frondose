import test from 'node:test';
import assert from 'node:assert/strict';
import { activityAnchor, activityCapabilities, activityLink, activityRetryKey, activityThreads, evidenceMarkdown, filterActivity, filteredActivityThreads, UPDATE_HEALTH } from '../src/lib/activity.js';

test('update capabilities fail closed and only trust server booleans', () => {
  assert.deepEqual(activityCapabilities(), { edit: false, archive: false, restore: false, reply: false, react: false });
  assert.equal(activityCapabilities({ can_edit: 'true', can_reply: true }).edit, false);
  assert.equal(activityCapabilities({ can_reply: true }).reply, true);
});
test('update filters separate private drafts, published and archived without mutating data', () => {
  const entries = [{ id: 'p', content: 'Evidence', update_type: 'decision', health: 'at_risk' }, { id: 'd', publication_state: 'draft' }, { id: 'a', archived_at: 'now' }];
  assert.deepEqual(filterActivity(entries).map(item => item.id), ['p']);
  assert.deepEqual(filterActivity(entries, { state: 'draft' }).map(item => item.id), ['d']);
  assert.deepEqual(filterActivity(entries, { state: 'archived' }).map(item => item.id), ['a']);
  assert.equal(filterActivity(entries, { search: 'eVIDence', type: 'decision', health: 'at_risk' }).length, 1);
  assert.equal(entries.length, 3);
});
test('evidence links reject executable and credentialed URLs and escape labels', () => {
  assert.equal(evidenceMarkdown('proof', 'javascript:alert(1)'), null);
  assert.equal(evidenceMarkdown('proof', 'https://user:secret@example.com'), null);
  assert.equal(evidenceMarkdown('[proof]', 'https://example.com/review'), '[proof](https://example.com/review)');
  assert.equal(evidenceMarkdown('', 'https://example.com/a(b)'), null);
});
test('stable update links and anchors encode untrusted identifiers', () => {
  assert.equal(activityAnchor('a/b'), 'update-a%2Fb');
  assert.equal(activityLink({ id: 'a/b' }), '#/updates/a%2Fb');
});
test('thread builder prevents cycles and can include archived context', () => {
  assert.equal(activityThreads([{ id: 'a', parent_id: 'b' }, { id: 'b', parent_id: 'a' }]).length, 2);
  assert.equal(activityThreads([{ id: 'a', archived_at: 'now' }, { id: 'b', parent_id: 'a' }], { includeArchived: true })[0].replies.length, 1);
});
test('health options match the persisted contract', () => {
  assert.deepEqual(UPDATE_HEALTH.map(([id]) => id), ['none', 'on_track', 'at_risk', 'blocked']);
});
test('filtered threads retain parent context and never promote archived descendants', () => {
  const entries = [{ id: 'parent', content: 'Plan' }, { id: 'child', parent_id: 'parent', content: 'Evidence', update_type: 'comment' }];
  assert.equal(filteredActivityThreads(entries, { search: 'evidence' })[0].id, 'parent');
  assert.equal(filteredActivityThreads(entries, { search: 'evidence' })[0].replies[0].id, 'child');
  entries[0].archived_at = 'now';
  assert.equal(filteredActivityThreads(entries, { state: 'published' }).length, 0);
  assert.equal(filteredActivityThreads(entries, { state: 'archived' })[0].id, 'parent');
});
test('uncertain retry ledger reuses exact requests without storing private text', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const payload = { workspace_id: 'one', content: 'PRIVATE draft text' };
  const first = await activityRetryKey(payload, 'create', storage);
  assert.equal((await activityRetryKey(payload, 'create', storage)).key, first.key);
  assert.notEqual((await activityRetryKey({ ...payload, workspace_id: 'two' }, 'create', storage)).key, first.key);
  assert.ok(!JSON.stringify([...values]).includes('PRIVATE'));
  first.clear();
  assert.notEqual((await activityRetryKey(payload, 'create', storage)).key, first.key);
});

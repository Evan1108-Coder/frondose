import test from 'node:test';
import assert from 'node:assert/strict';
import { talvoriApi } from '../src/data/api.js';

test('Updates API client preserves exact filters, scope, cursor and archive version', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (path, options) => { calls.push({ path, options }); return Response.json({ result: { items: [], next_cursor: null } }); };
  try {
    await talvoriApi.listActivityFeed({ workspaceId: 'w&1', publicationState: 'draft', targetType: 'route', updateType: 'risk', health: 'blocked', projectId: 'p one', search: 'a & b', includeArchived: true, cursor: 'a+b/c=' });
    const query = new URL(calls[0].path, 'http://fixture.local').searchParams;
    assert.equal(query.get('workspace_id'), 'w&1'); assert.equal(query.get('publication_state'), 'draft');
    assert.equal(query.get('project_id'), 'p one'); assert.equal(query.get('search'), 'a & b');
    assert.equal(query.get('cursor'), 'a+b/c='); assert.equal(query.get('include_archived'), 'true');
    assert.equal(query.get('target_type'), 'route'); assert.equal(query.get('update_type'), 'risk'); assert.equal(query.get('health'), 'blocked');
    await talvoriApi.archiveActivity('a one', { workspace_id: 'w1', version: 4 });
    assert.equal(calls[1].path, '/api/activity/a%20one'); assert.equal(calls[1].options.method, 'DELETE');
    assert.deepEqual(JSON.parse(calls[1].options.body), { workspace_id: 'w1', version: 4 });
    await talvoriApi.activityHistory('a one', { workspaceId: 'w&1' });
    assert.equal(calls[2].path, '/api/activity/a%20one/history?workspace_id=w%261');
  } finally { globalThis.fetch = original; }
});

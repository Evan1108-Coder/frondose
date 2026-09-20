import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderAdapter } from '../server/connectors/adapters.mjs';
import { CONNECTOR_CATALOG } from '../server/connectors/catalog.mjs';

const code = expected => error => error.code === expected;
function adapter(provider, handler = () => ({})) {
  const calls = [];
  return { calls, api: createProviderAdapter(provider, async (url, options = {}) => {
    const call = { url: new URL(url), ...options };
    calls.push(call);
    return handler(call, calls.length);
  }) };
}

test('new workflows are cataloged with required read fields and consequential write approvals', () => {
  for (const [provider, kind, name] of [['github-actions', 'jobs', 'run_id'], ['github-packages', 'versions', 'package_name'], ['jira', 'transitions', 'issue_id'], ['figma', 'nodes', 'node_ids'], ['figjam', 'nodes', 'node_ids']]) {
    assert.ok(CONNECTOR_CATALOG[provider].sync_kinds.includes(kind));
    assert.ok(CONNECTOR_CATALOG[provider].read_fields.some(field => field.name === name && field.kind === kind && field.required));
  }
  for (const [provider, id] of [['github-actions', 'rerun_workflow'], ['google-sheets', 'update_range'], ['jira', 'transition_issue']]) {
    assert.equal(CONNECTOR_CATALOG[provider].actions.find(action => action.id === id).risk, 'consequential');
    assert.ok(CONNECTOR_CATALOG[provider].actions.find(action => action.id === id).fields.some(field => field.name === 'resource_id' && field.required));
    assert.ok(CONNECTOR_CATALOG[provider].features.some(feature => feature.id === id));
  }
});

test('Actions reads bounded latest-attempt jobs and reruns only the selected repository run', async () => {
  const { api, calls } = adapter('github-actions', () => ({ jobs: Array.from({ length: 100 }, (_, id) => ({ id, name: `Job ${id}`, html_url: 'https://github.com/acme/app/actions/runs/7', steps: [{ name: 'Test' }] })) }));
  const result = await api.sync({ resource_id: 'acme/app', kind: 'jobs', run_id: '7', cursor: '2' });
  assert.equal(result.items.length, 100); assert.equal(result.cursor, '3');
  assert.equal(result.items[0].kind, 'jobs');
  assert.equal(calls[0].url.pathname, '/repos/acme/app/actions/runs/7/jobs');
  assert.equal(calls[0].url.searchParams.get('filter'), 'latest');
  await api.execute('rerun_workflow', { resource_id: 'acme/app', run_id: '7' });
  assert.equal(calls[1].method, 'POST'); assert.equal(calls[1].url.pathname, '/repos/acme/app/actions/runs/7/rerun');
  assert.deepEqual(calls[1].body, {});
  await assert.rejects(api.sync({ resource_id: 'acme/app', kind: 'jobs', run_id: '../8' }), code('invalid_identifier'));
  await assert.rejects(api.execute('rerun_workflow', { resource_id: 'acme/app', run_id: '-1' }), code('invalid_identifier'));
  assert.equal(calls.length, 2);
});

test('Packages versions require a package linked to the selected repository, including scoped package names', async () => {
  const { api, calls } = adapter('github-packages', ({ url }) => url.pathname === '/repos/acme/app' ? { owner: { type: 'Organization' } }
    : url.pathname.endsWith('/versions') ? [{ id: 3, name: 'v1', html_url: 'https://github.com/orgs/acme/packages/npm/package/test', updated_at: 'today' }]
      : { repository: { full_name: 'acme/app' } });
  const result = await api.sync({ resource_id: 'acme/app', kind: 'versions', package_type: 'npm', package_name: '@acme/test' });
  assert.equal(result.items[0].content.package_type, 'npm');
  assert.equal(calls[1].url.pathname, '/orgs/acme/packages/npm/%40acme%2Ftest');
  assert.equal(calls[2].url.searchParams.get('state'), 'active');
  for (const args of [{ package_type: 'invalid', package_name: 'ok' }, { package_type: 'npm', package_name: '..' }]) {
    await assert.rejects(api.sync({ resource_id: 'acme/app', kind: 'versions', ...args }));
  }
  assert.equal(calls.length, 3);
  const rejected = adapter('github-packages', (_, count) => count === 1 ? { owner: { type: 'User' } } : { repository: { full_name: 'acme/private' } });
  await assert.rejects(rejected.api.sync({ resource_id: 'acme/app', kind: 'versions', package_name: 'pkg' }), code('resource_scope'));
  assert.equal(rejected.calls.length, 2, 'no version data fetched for a different repository');
  assert.equal(rejected.calls[1].url.pathname, '/users/acme/packages/container/pkg');
  const user = adapter('github-packages', ({ url }) => url.pathname === '/repos/acme/app' ? { owner: { type: 'User' } } : url.pathname.endsWith('/versions') ? Array.from({ length: 100 }, (_, id) => ({ id, name: String(id) })) : { repository: { full_name: 'ACME/APP' } });
  assert.equal((await user.api.sync({ resource_id: 'acme/app', kind: 'versions', package_name: 'pkg', cursor: '2' })).cursor, '3');
});

test('Drive child discovery checks a folder and preserves escaped parent scope and pagination', async () => {
  const { api, calls } = adapter('google-drive', ({ url }) => url.pathname.startsWith('/drive/v3/files/') ? { id: "folder'id", mimeType: 'application/vnd.google-apps.folder' }
    : { files: [{ id: 'child', name: 'Brief', webViewLink: 'https://drive.google.com/file/d/child', parents: ["folder'id"] }], nextPageToken: 'next' });
  const result = await api.sync({ resource_id: "folder'id", kind: 'children', cursor: 'page' });
  assert.equal(result.cursor, 'next'); assert.equal(result.items[0].kind, 'children');
  assert.equal(calls[1].url.searchParams.get('q'), "'folder\\'id' in parents and trashed=false");
  assert.equal(calls[1].url.searchParams.get('pageToken'), 'page');
  const bad = adapter('google-drive', () => ({ mimeType: 'text/plain' }));
  await assert.rejects(bad.api.sync({ resource_id: 'file', kind: 'children' }), code('not_a_folder'));
  assert.equal(bad.calls.length, 1);
});

test('Sheets update uses RAW values and an exact reviewed range without formula interpretation', async () => {
  const { api, calls } = adapter('google-sheets', () => ({ updatedCells: 4 }));
  await api.execute('update_range', { resource_id: 'sheet', range: "'Plan Q1'!$A$2:B3", values: [["=IMPORTXML(\"example\")", 42], [true, 'Ready']] });
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].url.searchParams.get('valueInputOption'), 'RAW');
  assert.equal(calls[0].body.majorDimension, 'ROWS');
  assert.equal(calls[0].body.values[0][0], '=IMPORTXML("example")');
  assert.equal(calls[0].body.range, "'Plan Q1'!$A$2:B3");
  await api.execute('update_range', { resource_id: 'sheet', range: 'A1', values: '[["Literal text"]]' });
  assert.deepEqual(calls[1].body.values, [['Literal text']]);
  for (const range of ['Sheet1!A:A', 'A1:B1001', 'A1:ZZ1', 'B2:A1', 'A0:B2', 'A1\n:B2']) {
    await assert.rejects(api.execute('update_range', { resource_id: 'sheet', range, values: [['x']] }));
  }
  for (const values of [[], [['a', 'b']], [null], [[null]], [[Infinity]], 'bad json', [['x'.repeat(200001)]]]) {
    await assert.rejects(api.execute('update_range', { resource_id: 'sheet', range: 'A1', values }));
  }
  assert.equal(calls.length, 2);
});

test('Slides text slide is one validated batch with linked generated placeholders', async () => {
  const { api, calls } = adapter('google-slides', () => ({ replies: [{ createSlide: { objectId: 'new-slide' } }] }));
  await api.execute('add_text_slide', { resource_id: 'deck', title: 'Progress', text: 'A reviewed summary' });
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url.pathname, '/v1/presentations/deck:batchUpdate');
  const [create, title, body] = calls[0].body.requests;
  assert.equal(create.createSlide.slideLayoutReference.predefinedLayout, 'TITLE_AND_BODY');
  assert.equal(title.insertText.objectId, create.createSlide.placeholderIdMappings[0].objectId);
  assert.equal(body.insertText.objectId, create.createSlide.placeholderIdMappings[1].objectId);
  assert.equal(body.insertText.text, 'A reviewed summary');
  await assert.rejects(api.execute('add_text_slide', { resource_id: 'deck', title: '', text: 'Body' }), code('invalid_field'));
  await assert.rejects(api.execute('add_text_slide', { resource_id: 'deck', title: 'T', text: 'x'.repeat(10001) }), code('invalid_field'));
  assert.equal(calls.length, 1);
});

test('Jira transition reads and execution validate project membership and current available transition', async () => {
  const { api, calls } = adapter('jira', ({ url, method }) => method === 'POST' ? { completed: true }
    : url.pathname.endsWith('/transitions') ? { transitions: [{ id: '21', name: 'In progress', fields: {} }] }
      : { fields: { project: { key: 'APP' } } });
  const result = await api.sync({ resource_id: 'site:APP', kind: 'transitions', issue_id: 'APP-12' });
  assert.equal(result.items[0].external_id, 'APP-12:21');
  await api.execute('transition_issue', { resource_id: 'site:APP', issue_id: 'APP-12', transition_id: '21' });
  assert.equal(calls.length, 5); assert.deepEqual(calls[4].body, { transition: { id: '21' } });
  assert.equal(calls[3].url.searchParams.get('expand'), 'transitions.fields');
  await assert.rejects(api.execute('transition_issue', { resource_id: 'site:APP', issue_id: 'APP-12', transition_id: '22' }), code('transition_unavailable'));
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('Jira never reads transitions outside the selected project or submits unsupported required fields', async () => {
  const outside = adapter('jira', () => ({ fields: { project: { key: 'PRIVATE' } } }));
  await assert.rejects(outside.api.sync({ resource_id: 'site:APP', kind: 'transitions', issue_id: 'PRIVATE-1' }), code('resource_scope'));
  await assert.rejects(outside.api.execute('transition_issue', { resource_id: 'site:APP', issue_id: 'PRIVATE-1', transition_id: '2' }), code('resource_scope'));
  assert.equal(outside.calls.length, 2);
  const required = adapter('jira', ({ url }) => url.pathname.endsWith('/transitions') ? { transitions: [{ id: '2', fields: { resolution: { required: true } } }] } : { fields: { project: { key: 'APP' } } });
  await assert.rejects(required.api.execute('transition_issue', { resource_id: 'site:APP', issue_id: 'APP-1', transition_id: '2' }), code('transition_fields_required'));
  assert.ok(required.calls.every(call => call.method !== 'POST'));
});

test('Figma and FigJam nodes stay in the selected file and retain explicit version identity', async () => {
  for (const provider of ['figma', 'figjam']) {
    const { api, calls } = adapter(provider, () => ({ version: 'v7', nodes: { '1:2': { document: { name: 'Frame' } }, '1:3': null } }));
    const result = await api.sync({ resource_id: 'fileKey', kind: 'nodes', node_ids: '1:2, 1:3,1:2', version_id: 'v7' });
    assert.equal(result.items.length, 1); assert.equal(result.items[0].external_id, '1:2@v7');
    assert.equal(calls[0].url.pathname, '/v1/files/fileKey/nodes');
    assert.equal(calls[0].url.searchParams.get('ids'), '1:2,1:3');
    assert.equal(calls[0].url.searchParams.get('version'), 'v7');
    assert.equal(calls[0].url.searchParams.get('depth'), '4');
    for (const node_ids of ['', '../file', Array.from({ length: 51 }, (_, index) => `1:${index}`).join(',')]) {
      await assert.rejects(api.sync({ resource_id: 'fileKey', kind: 'nodes', node_ids }), code('invalid_nodes'));
    }
    assert.equal(calls.length, 1);
    const version = await api.sync({ resource_id: 'fileKey', kind: 'file', version_id: 'v7' });
    assert.equal(version.items[0].external_id, 'fileKey@v7');
    assert.equal(calls[1].url.searchParams.get('version'), 'v7');
    const latest = await api.sync({ resource_id: 'fileKey', kind: 'nodes', node_ids: '1:2' });
    assert.equal(latest.items[0].external_id, '1:2');
    assert.equal(calls[2].url.searchParams.has('version'), false);
  }
});

test('Slack thread reads are selected-channel scoped, paginated, and bounded for commercial limits', async () => {
  const { api, calls } = adapter('slack', () => ({ ok: true, messages: [{ ts: '1234.000001', text: 'Parent' }, { ts: '1234.000002', thread_ts: '1234.000001', text: 'Reply' }], response_metadata: { next_cursor: 'next' } }));
  const result = await api.sync({ resource_id: 'C123', kind: 'thread', thread_ts: '1234.000001', cursor: 'previous' });
  assert.equal(result.items.length, 2); assert.equal(result.cursor, 'next');
  assert.equal(calls[0].url.pathname, '/api/conversations.replies');
  assert.equal(calls[0].url.searchParams.get('channel'), 'C123');
  assert.equal(calls[0].url.searchParams.get('ts'), '1234.000001');
  assert.equal(calls[0].url.searchParams.get('limit'), '15');
  assert.equal(calls[0].url.searchParams.get('cursor'), 'previous');
  for (const thread_ts of ['', '1234', '1234.1&channel=C456']) await assert.rejects(api.sync({ resource_id: 'C123', kind: 'thread', thread_ts }), code('invalid_thread'));
  assert.equal(calls.length, 1);
  await api.sync({ resource_id: 'C123', kind: 'messages' });
  assert.equal(calls[1].url.pathname, '/api/conversations.history');
  assert.equal(calls[1].url.searchParams.get('limit'), '15');
  const rejected = adapter('slack', () => ({ ok: false, error: 'missing_scope' }));
  await assert.rejects(rejected.api.sync({ resource_id: 'C123', kind: 'thread', thread_ts: '1234.000001' }), code('provider_rejected'));
});

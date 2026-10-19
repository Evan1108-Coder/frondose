import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectionPlatform } from '../server/connection-platform.mjs';
import { CONNECTOR_CATALOG } from '../server/connectors/catalog.mjs';
import { createProviderAdapter } from '../server/connectors/adapters.mjs';
import { createHmac } from 'node:crypto';

const actor = { id: 'owner' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function fixture(run, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'rumbo-connection-test-')), db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run('ws', 'Workspace', 'ws', 'now', 'now');
  db.prepare('INSERT INTO teams(id,workspace_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run('team', 'ws', 'Team', 'now', 'now');
  db.prepare('INSERT INTO projects(id,workspace_id,name,identifier,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('project', 'ws', 'Project', 'APP', 'now', 'now');
  const calls = [], permissions = [], env = { TALVORI_GITHUB_CLIENT_ID: 'test-client', TALVORI_GITHUB_CLIENT_SECRET: 'test-secret', TALVORI_SLACK_CLIENT_ID: 'slack-client', TALVORI_SLACK_CLIENT_SECRET: 'slack-secret', TALVORI_SLACK_CALLBACK_URL: 'https://example.test/api/connection-platform/oauth/callback', ...options.env };
  const platform = createConnectionPlatform({ db, dataDir, authorize: async request => { permissions.push(request); return request.actor?.id === 'owner'; }, ...options, env, fetchImpl: async (url, config) => { calls.push({ url: String(url), ...config }); if (options.fetchImpl) return options.fetchImpl(url, config); if (String(url).includes('/oauth/') || String(url).includes('/oauth.v2.access')) return json({ access_token: 'sensitive-access-token', refresh_token: 'sensitive-refresh-token', expires_in: 3600 }); if (String(url).includes('/user/repos')) return json([{ full_name: 'acme/app', html_url: 'https://github.com/acme/app' }]); if (String(url).includes('/issues') && config.method === 'POST') return json({ id: 7, title: 'Created issue' }); if (String(url).includes('/issues')) return json([{ id: 1, title: 'Example', html_url: 'https://github.com/acme/app/issues/1', updated_at: '2026-01-01' }]); return json({ ok: true, channels: [{ id: 'C1', name: 'general', is_member: true }] }); } });
  async function connect(provider = 'github') { const connection = await platform.create({ provider, workspace_id: 'ws' }, actor); const flow = await platform.beginAuthorization(connection.id, actor); const state = new URL(flow.authorization_url).searchParams.get('state'); await platform.completeAuthorization({ state, code: 'test-code' }, actor); return connection; }
  try { await run({ platform, db, dataDir, calls, permissions, connect }); } finally { platform.close(); db.close(); rmSync(dataDir, { recursive: true }); }
}

test('catalog honestly exposes server setup prerequisites and supported features', () => fixture(async ({ platform }) => {
  const catalog = await platform.catalog('ws', actor);
  assert.equal(catalog.length, 14); assert.equal(catalog.find(x => x.id === 'github').configured, true); assert.equal(catalog.find(x => x.id === 'linear').configured, false);
  for (const provider of catalog) for (const action of provider.actions) assert.ok(provider.features.find(x => x.id === action.id));
  await assert.rejects(platform.catalog('ws', { id: 'stranger' }), /access/);
}));

test('OAuth uses state, PKCE, actor binding, encrypted persisted credentials and one-use callback', () => fixture(async ({ platform, db, calls, dataDir }) => {
  const connection = await platform.create({ provider: 'github', workspace_id: 'ws' }, actor);
  const flow = await platform.beginAuthorization(connection.id, actor), url = new URL(flow.authorization_url), state = url.searchParams.get('state');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.ok(url.searchParams.get('code_challenge'));
  await platform.completeAuthorization({ state, code: 'test-code' }, actor);
  assert.ok(calls[0].body.includes('code_verifier='));
  const encrypted = db.prepare('SELECT ciphertext FROM platform_connection_secrets').get().ciphertext;
  assert.ok(!encrypted.includes('sensitive')); assert.equal(readFileSync(join(dataDir, 'connections.key')).length, 32);
  assert.ok(!JSON.stringify(await platform.list('ws', actor)).includes('sensitive'));
  await assert.rejects(platform.completeAuthorization({ state, code: 'test-code' }, actor), /expired/);
}));

test('unselected resources denied, repeated sync updates one normalized object with provenance', () => fixture(async ({ platform, connect, db }) => {
  const connection = await connect();
  await assert.rejects(platform.sync(connection.id, { resource_id: 'acme/app' }, actor), /Select this resource/);
  await platform.settings(connection.id, { selected_resources: ['acme/app'] }, actor);
  assert.equal((await platform.resources(connection.id, {}, actor)).items[0].id, 'acme/app');
  await platform.sync(connection.id, { resource_id: 'acme/app' }, actor); await platform.sync(connection.id, { resource_id: 'acme/app' }, actor);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_external_objects').get().n, 1);
  const [object] = await platform.objects(connection.id, actor); assert.equal(object.provenance.resource_id, 'acme/app'); assert.equal(object.content.title, 'Example');
  await platform.settings(connection.id, { selected_resources: [] }, actor); assert.deepEqual(await platform.objects(connection.id, actor), []);
}));

test('actions are permission gated and idempotent; conflicting request IDs rejected', () => fixture(async ({ platform, connect, calls, permissions }) => {
  const connection = await connect();
  const input = { action: 'create_issue', input: { resource_id: 'acme/app', title: 'Hello' }, idempotency_key: 'request-1' };
  await assert.rejects(platform.execute(connection.id, input, actor), /Enable this action/);
  await platform.settings(connection.id, { selected_resources: ['acme/app'], enabled_features: ['read', 'create_issue'] }, actor);
  const first = await platform.execute(connection.id, input, actor), second = await platform.execute(connection.id, input, actor);
  assert.deepEqual(first, second); assert.equal(calls.filter(x => x.method === 'POST' && x.url.includes('/issues')).length, 1);
  await assert.rejects(platform.execute(connection.id, { ...input, input: { ...input.input, title: 'changed' } }, actor), /another action/);
  assert.ok(permissions.some(x => x.permission === 'connections.github.create_issue'));
}));

test('external communication needs approved decision and cannot be approved by input body', () => fixture(async ({ platform, connect, calls }) => {
  const connection = await connect('slack'); await platform.settings(connection.id, { selected_resources: ['C1'], enabled_features: ['read', 'send_message'] }, actor);
  await assert.rejects(platform.execute(connection.id, { action: 'send_message', input: { resource_id: 'C1', text: 'Hello' }, approved: true, idempotency_key: 'send1' }, actor), /requires approval/);
  assert.equal(calls.filter(x => x.url.includes('chat.postMessage')).length, 0);
}));

test('disconnect removes usable credentials, preserves cache by default, and blocks network reads', () => fixture(async ({ platform, connect, db }) => {
  const connection = await connect(); await platform.settings(connection.id, { selected_resources: ['acme/app'] }, actor); await platform.sync(connection.id, { resource_id: 'acme/app' }, actor);
  await platform.disconnect(connection.id, {}, actor); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_connection_secrets').get().n, 0);
  assert.equal((await platform.objects(connection.id, actor)).length, 1); await assert.rejects(platform.resources(connection.id, {}, actor), /Connect this account/);
}));

test('provider errors never expose returned HTML, tokens or secret payloads', () => fixture(async ({ platform, connect }) => {
  const connection = await connect(); await assert.rejects(platform.resources(connection.id, {}, actor), error => error.code === 'reconnect_required' && !error.message.includes('secret-token'));
}, { fetchImpl: async url => String(url).includes('/oauth/') ? json({ access_token: 'secret-token' }) : new Response('<html>secret-token</html>', { status: 401 }) }));

test('all provider read adapters call authored official HTTPS endpoints and normalize objects', async () => {
  const fixtures = {
    github: [{ id: 1, title: 'Issue' }], 'github-actions': { workflow_runs: [{ id: 1, name: 'Build' }] }, 'github-packages': [{ id: 1, name: 'image', repository: { full_name: 'acme/app' } }],
    'google-drive': { id: 'file', name: 'File' }, 'google-docs': { documentId: 'file', title: 'Document' }, 'google-sheets': { spreadsheetId: 'file', properties: { title: 'Sheet' } }, 'google-slides': { presentationId: 'file', title: 'Slides' },
    linear: { data: { team: { issues: { nodes: [{ id: 'issue', title: 'Issue' }], pageInfo: { hasNextPage: false } } } } }, jira: { issues: [{ id: '1', fields: { summary: 'Issue' } }] }, slack: { ok: true, messages: [{ ts: '1.1', text: 'Message' }] }, figma: { name: 'Design' }, figjam: { name: 'Board' },
  };
  for (const provider of Object.keys(CONNECTOR_CATALOG)) {
    const calls = [], adapter = createProviderAdapter(provider, async (url, options) => { calls.push({ url, options }); return fixtures[provider]; });
    const resource_id = provider.startsWith('github') ? 'acme/app' : provider === 'jira' ? 'cloud:APP' : 'file';
    const result = await adapter.sync({ resource_id, kind: CONNECTOR_CATALOG[provider].sync_kinds[0] });
    assert.equal(result.items.length, 1, provider); assert.ok(result.items[0].external_id, provider); assert.ok(calls.every(x => x.url.startsWith('https://')));
  }
});

test('provider action adapters refuse path injection and constrain issue membership', async () => {
  const github = createProviderAdapter('github', async () => { throw new Error('must not fetch'); });
  await assert.rejects(github.execute('create_issue', { resource_id: 'evil/../../secret', title: 'bad' }), /owner\/name/);
  const linear = createProviderAdapter('linear', async () => ({ data: { issue: { team: { id: 'other-team' } } } }));
  await assert.rejects(linear.execute('comment', { resource_id: 'team', issue_id: 'issue', body: 'Comment' }), /outside/);
});

test('native imports deduplicate and surface local edits as exact-version conflicts', () => fixture(async ({ platform, connect, db }) => {
  const connection = await connect(); await platform.settings(connection.id, { selected_resources: ['acme/app'] }, actor); await platform.sync(connection.id, { resource_id: 'acme/app' }, actor);
  const [object] = await platform.objects(connection.id, actor);
  const input = { object_id: object.id, target_type: 'route', project_id: 'project' };
  const created = await platform.importObject(connection.id, input, actor); assert.equal(created.status, 'created');
  assert.equal((await platform.importObject(connection.id, input, actor)).status, 'unchanged');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 1);
  db.prepare('UPDATE tasks SET title=? WHERE id=?').run('Local edit', created.target_id);
  db.prepare('UPDATE platform_external_objects SET title=? WHERE id=?').run('External edit', object.id);
  const conflict = await platform.importObject(connection.id, input, actor); assert.equal(conflict.status, 'conflict'); assert.equal(conflict.conflict.local_value.title, 'Local edit');
  assert.equal(db.prepare('SELECT title FROM tasks WHERE id=?').get(created.target_id).title, 'Local edit');
  await assert.rejects(platform.resolve(connection.id, { conflict_id: conflict.conflict.id, resolution: 'use_external', expected_local_hash: 'wrong' }, actor), /Reload/);
  await platform.resolve(connection.id, { conflict_id: conflict.conflict.id, resolution: 'use_external', expected_local_hash: conflict.conflict.local_hash }, actor);
  assert.equal(db.prepare('SELECT title FROM tasks WHERE id=?').get(created.target_id).title, 'External edit');
  assert.equal((await platform.conflicts(connection.id, actor)).length, 0);
}));

test('imports create native projects and scoped documents without starting execution', () => fixture(async ({ platform, connect, db }) => {
  const connection = await connect(); await platform.settings(connection.id, { selected_resources: ['acme/app'] }, actor); await platform.sync(connection.id, { resource_id: 'acme/app' }, actor); const [object] = await platform.objects(connection.id, actor);
  const project = await platform.importObject(connection.id, { object_id: object.id, target_type: 'project' }, actor); assert.ok(db.prepare('SELECT id FROM projects WHERE id=?').get(project.target_id));
  await assert.rejects(platform.importObject(connection.id, { object_id: object.id, target_type: 'document' }, actor), /either a project or a team/);
  const document = await platform.importObject(connection.id, { object_id: object.id, target_type: 'document', team_id: 'team' }, actor); assert.equal(db.prepare('SELECT team_id FROM documents WHERE id=?').get(document.target_id).team_id, 'team');
}));

test('signed webhook delivery is deduplicated into persistent sync queue', () => fixture(async ({ platform, connect, db }) => {
  const connection = await connect(); await platform.settings(connection.id, { selected_resources: ['acme/app'] }, actor);
  await platform.jobs.policy(connection.id, actor, { webhooks_enabled: true, reconcile_minutes: 15 });
  const body = JSON.stringify({ repository: { full_name: 'acme/app' }, action: 'opened' });
  const headers = { 'x-github-delivery': 'delivery1', 'x-hub-signature-256': `sha256=${createHmac('sha256', 'webhook-secret').update(body).digest('hex')}` };
  await assert.rejects(platform.jobs.ingest(connection.id, body + ' ', headers), /signature/);
  const accepted = await platform.jobs.ingest(connection.id, body, headers); assert.equal(accepted.queued_resources, 1);
  assert.equal((await platform.jobs.ingest(connection.id, body, headers)).duplicate, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_sync_jobs').get().n, 3);
  await platform.jobs.tick(); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_sync_jobs WHERE state='completed'").get().n, 1);
}, { env: { TALVORI_GITHUB_WEBHOOK_SECRET: 'webhook-secret' }, workerIntervalMs: 0 }));

test('Slack signing enforces freshness and returns verified URL challenge', () => fixture(async ({ platform, connect }) => {
  const connection = await connect('slack'); await platform.jobs.policy(connection.id, actor, { webhooks_enabled: true });
  const timestamp = String(Math.floor(Date.now() / 1000)), raw = JSON.stringify({ type: 'url_verification', challenge: 'challenge123' });
  const signature = `v0=${createHmac('sha256', 'slack-signing-secret').update(`v0:${timestamp}:${raw}`).digest('hex')}`;
  assert.deepEqual(await platform.jobs.ingest(connection.id, raw, { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature }), { challenge: 'challenge123' });
  await assert.rejects(platform.jobs.ingest(connection.id, raw, { 'x-slack-request-timestamp': '1', 'x-slack-signature': signature }), /timestamp/);
}, { env: { TALVORI_SLACK_WEBHOOK_SECRET: 'slack-signing-secret' }, workerIntervalMs: 0 }));

test('GitHub code adapter decodes bounded text and never executes or follows download URLs', async () => {
  const urls = [], adapter = createProviderAdapter('github', async url => { urls.push(url); return { type: 'file', name: 'app.js', path: 'src/app.js', content: Buffer.from('export const version = 1;').toString('base64'), encoding: 'base64', size: 25, download_url: 'http://127.0.0.1/private', html_url: 'https://github.com/acme/app/blob/main/src/app.js' }; });
  const result = await adapter.readCode({ resource_id: 'acme/app', kind: 'file', path: 'src/app.js', ref: 'feature/new' });
  assert.equal(result.content, 'export const version = 1;'); assert.equal(urls.length, 1); assert.match(urls[0], /ref=feature%2Fnew/);
  await assert.rejects(adapter.readCode({ resource_id: 'acme/app', kind: 'file', path: '../secret' }), /valid repository path/);
});

test('agent connection delegation is explicit, scoped and checked at execution time', () => fixture(async ({ platform, connect, db }) => {
  db.prepare('INSERT INTO agents(id,workspace_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run('agent', 'ws', 'Codex', 'now', 'now');
  const connection = await connect();
  const command = { action: 'create_issue', input: { resource_id: 'acme/app', title: 'Agent issue' }, idempotency_key: 'agent-request' };
  assert.deepEqual(await platform.agentContext('ws', 'agent', actor), []);
  await assert.rejects(platform.executeForAgent(connection.id, command, { agent_id: 'agent', sponsor: actor }), /not authorized/);
  await assert.rejects(platform.settings(connection.id, { agent_access: true, allowed_agent_ids: ['missing-agent'] }, actor), /available agents/);
  await platform.settings(connection.id, { agent_access: true, allowed_agent_ids: ['agent'], selected_resources: ['acme/app'], enabled_features: ['read', 'create_issue'] }, actor);
  await platform.sync(connection.id, { resource_id: 'acme/app' }, actor);
  const [context] = await platform.agentContext('ws', 'agent', actor); assert.equal(context.cached_objects[0].title, 'Example'); assert.equal(context.actions[0].id, 'create_issue'); assert.ok(!JSON.stringify(context).includes('sensitive-access-token'));
  await platform.executeForAgent(connection.id, command, { agent_id: 'agent', sponsor: actor });
  const events = await platform.activity(connection.id, actor); assert.ok(events.some(x => x.type === 'action_started' && x.detail.agent_id === 'agent' && x.actor_id === 'owner'));
  db.prepare("UPDATE agents SET status='paused' WHERE id='agent'").run();
  await assert.rejects(platform.executeForAgent(connection.id, { ...command, idempotency_key: 'after-revoke' }, { agent_id: 'agent', sponsor: actor }), /not authorized/);
}));

test('cache purge requires approval, retains data while pending, and is idempotent', async () => {
  let approved = false, approvalCalls = 0;
  await fixture(async ({ platform, connect, db }) => {
    const connection = await connect(); await platform.settings(connection.id, { selected_resources: ['acme/app'] }, actor); await platform.sync(connection.id, { resource_id: 'acme/app' }, actor);
    const input = { delete_cache: true, idempotency_key: 'purge-request' };
    await assert.rejects(platform.disconnect(connection.id, { delete_cache: true }, actor), /request key/);
    assert.equal((await platform.disconnect(connection.id, input, actor)).approval_required, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_external_objects').get().n, 1); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_connection_secrets').get().n, 1);
    approved = true;
    assert.equal((await platform.disconnect(connection.id, input, actor)).state, 'not_connected');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_external_objects').get().n, 0); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_connection_secrets').get().n, 0);
    await platform.disconnect(connection.id, input, actor); assert.equal(approvalCalls, 2);
  }, { requireApproval: async request => { assert.equal(request.action, 'purge_cache'); assert.equal(request.input.delete_cache, true); assert.equal(request.input.connection_revision, request.connection.updated_at); approvalCalls++; return approved ? true : { id: 'approval', status: 'pending' }; } });
});

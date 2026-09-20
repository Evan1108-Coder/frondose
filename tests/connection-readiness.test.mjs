import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectionPlatform } from '../server/connection-platform.mjs';
import { CONNECTOR_CATALOG } from '../server/connectors/catalog.mjs';
import { connectionReadOptions } from '../server/connectors/read-options.mjs';
import { readProviderIdentity } from '../server/connectors/identity.mjs';

const actor = { id: 'fixture-owner' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
async function fixture(run, fetchImpl, overrides = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'rumbo-readiness-')), db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run('ws', 'Fixture', 'fixture', 'now', 'now');
  const env = { RUMBO_SLACK_CALLBACK_URL: 'https://callback.example.test/api/connection-platform/oauth/callback', ...Object.fromEntries(['GITHUB','GOOGLE','LINEAR','JIRA','SLACK','FIGMA'].flatMap(family => [[`RUMBO_${family}_CLIENT_ID`, 'fixture-client'], [`RUMBO_${family}_CLIENT_SECRET`, 'fixture-secret']])), ...overrides };
  const calls = [];
  const platform = createConnectionPlatform({ db, dataDir, env, workerIntervalMs: 0, authorize: () => true, fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return fetchImpl ? fetchImpl(String(url), options) : json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600 }); } });
  async function connect(provider) { const row = await platform.create({ provider, workspace_id: 'ws' }, actor); const authorization = await platform.beginAuthorization(row.id, actor); const state = new URL(authorization.authorization_url).searchParams.get('state'); return platform.completeAuthorization({ state, code: 'fixture-code' }, actor); }
  try { await run({ platform, db, calls, connect }); } finally { platform.close(); db.close(); rmSync(dataDir, { recursive: true }); }
}

for (const [provider, definition] of Object.entries(CONNECTOR_CATALOG)) test(`${provider}: consent construction, encrypted exchange and disconnect are fixture verified`, () => fixture(async ({ platform, db, calls }) => {
  const row = await platform.create({ provider, workspace_id: 'ws' }, actor), result = await platform.beginAuthorization(row.id, actor), url = new URL(result.authorization_url);
  assert.equal(url.protocol, 'https:'); assert.equal(url.searchParams.get('client_id'), 'fixture-client'); assert.ok(url.searchParams.get('state'));
  assert.ok(!url.href.includes('fixture-secret'));
  const state = url.searchParams.get('state'), connected = await platform.completeAuthorization({ state, code: 'fixture-code' }, actor);
  assert.equal(connected.state, 'connected'); assert.ok(connected.verification.authorized_at); assert.equal(connected.verification.identity_checked_at, undefined);
  const payload = definition.auth_family === 'jira' ? JSON.parse(calls[0].options.body) : Object.fromEntries(new URLSearchParams(calls[0].options.body));
  assert.equal(payload.code, 'fixture-code'); assert.equal(payload.redirect_uri, url.searchParams.get('redirect_uri'));
  assert.equal(Boolean(payload.code_verifier), ['github','google','linear','figma'].includes(definition.auth_family));
  assert.ok(!db.prepare('SELECT ciphertext FROM platform_connection_secrets').get().ciphertext.includes('fixture-access'));
  await assert.rejects(platform.completeAuthorization({ state, code: 'fixture-code' }, actor), /expired/);
  await platform.disconnect(row.id, {}, actor); assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_connection_secrets').get().n, 0);
}));

test('Slack rejects HTTP callback before external access; diagnostics never expose client secrets', () => fixture(async ({ platform, calls }) => {
  const catalog = await platform.catalog('ws', actor), slack = catalog.find(item => item.id === 'slack');
  assert.equal(slack.configured, false); assert.match(slack.setup_required.join(' '), /HTTPS/); assert.ok(!JSON.stringify(catalog).includes('fixture-secret'));
  const row = await platform.create({ provider: 'slack', workspace_id: 'ws' }, actor);
  await assert.rejects(platform.beginAuthorization(row.id, actor), /HTTPS/); assert.equal(calls.length, 0);
}, undefined, { RUMBO_SLACK_CALLBACK_URL: '' }));

test('declined consent consumes state and never saves a token', () => fixture(async ({ platform, calls, db }) => {
  const row = await platform.create({ provider: 'linear', workspace_id: 'ws' }, actor), flow = await platform.beginAuthorization(row.id, actor), state = new URL(flow.authorization_url).searchParams.get('state');
  await assert.rejects(platform.completeAuthorization({ state, error: 'access_denied' }, actor), error => error.code === 'authorization_denied');
  await assert.rejects(platform.completeAuthorization({ state, code: 'later' }, actor), /expired/);
  assert.equal(calls.length, 0); assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_connection_secrets').get().n, 0);
}));

test('identity probes verify each family response and reject token-only success', async () => {
  const responses = { github: { id: 1, login: 'fixture' }, google: { user: { permissionId: '1', displayName: 'Fixture' } }, linear: { data: { viewer: { id: '1', name: 'Fixture' } } }, slack: { ok: true, user_id: '1', user: 'Fixture', team: 'Test' }, figma: { id: '1', handle: 'Fixture' }, jira: [{ id: 'cloud-1', name: 'Fixture' }] };
  for (const family of Object.keys(responses)) {
    const identity = await readProviderIdentity(family, async url => url.endsWith('/myself') ? { accountId: '1', displayName: 'Fixture' } : responses[family]);
    assert.equal(identity.id, '1'); assert.ok(identity.label);
    await assert.rejects(readProviderIdentity(family, async () => ({})), /identity|site/);
  }
});

test('checking an account is explicit and does not imply resource verification', () => fixture(async ({ platform, calls, connect }) => {
  const row = await connect('github'); const count = calls.length;
  await platform.list('ws', actor); await platform.catalog('ws', actor); assert.equal(calls.length, count);
  const checked = await platform.verify(row.id, actor); assert.equal(checked.account_label, 'fixture'); assert.ok(checked.verification.identity_checked_at); assert.equal(checked.verification.resource_checked_at, undefined);
}, async url => url.endsWith('/user') ? json({ id: 1, login: 'fixture' }) : json({ access_token: 'fixture' })));

test('bounded sheet range and package ecosystem survive immutable queued-job settings', () => fixture(async ({ platform, db, connect }) => {
  const row = await connect('google-sheets');
  await platform.settings(row.id, { selected_resources: ['sheet'], read_options: { range: 'Sheet1!A1:B4' } }, actor);
  const first = await platform.jobs.enqueue(row.id, { resource_id: 'sheet' }, actor);
  await platform.settings(row.id, { read_options: { range: 'Sheet1!A1:C6' } }, actor);
  const second = await platform.jobs.enqueue(row.id, { resource_id: 'sheet' }, actor);
  assert.notEqual(first.id, second.id);
  assert.equal(JSON.parse(db.prepare('SELECT read_options FROM platform_sync_jobs WHERE id=?').get(first.id).read_options).range, 'Sheet1!A1:B4');
  assert.throws(() => connectionReadOptions('google-sheets', { range: 'A:Z' }), /bounded/);
  assert.throws(() => connectionReadOptions('google-sheets', { range: 'A1:ZZ9999' }), /20,000/);
  assert.deepEqual(connectionReadOptions('github-packages', { package_type: 'npm' }), { package_type: 'npm' });
  assert.throws(() => connectionReadOptions('github', { package_type: 'npm' }), /do not apply/);
}));

for (const [mode, expected] of [['invalid', 'action_not_sent'], ['rejected', 'action_rejected'], ['timeout', 'action_uncertain']]) test(`write failure ${mode} has safe durable retry semantics`, () => fixture(async ({ platform, connect, db }) => {
  const row = await connect('github'), resource = mode === 'invalid' ? 'bad/../../path' : 'owner/repo';
  await platform.settings(row.id, { selected_resources: [resource], enabled_features: ['read', 'create_issue'] }, actor);
  const input = { action: 'create_issue', input: { resource_id: resource, title: 'Fixture' }, idempotency_key: 'fixture-action' };
  await assert.rejects(platform.execute(row.id, input, actor), error => error.code === expected);
  assert.equal(db.prepare('SELECT state FROM platform_connection_actions').get().state, mode === 'timeout' ? 'uncertain' : 'rejected');
  await assert.rejects(platform.execute(row.id, input, actor), error => error.code === (mode === 'timeout' ? 'action_uncertain' : 'action_rejected'));
}, async url => { if (url.includes('/oauth/')) return json({ access_token: 'fixture' }); if (mode === 'timeout') throw new Error('network'); return json({ error: 'fixture' }, 422); }));

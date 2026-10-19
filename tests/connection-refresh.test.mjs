import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectionPlatform } from '../server/connection-platform.mjs';
import { OAUTH_PROVIDERS } from '../server/connectors/catalog.mjs';

const actor = { id: 'fixture-owner' }, json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const identities = {
  github: { id: 1, login: 'Fixture' }, google: { user: { permissionId: '1', displayName: 'Fixture' } },
  linear: { data: { viewer: { id: '1', name: 'Fixture' } } }, slack: { ok: true, user_id: '1', user: 'Fixture' },
  figma: { id: '9007199254740993123', handle: 'Fixture' }, jira: { accountId: '1', displayName: 'Fixture' },
};
async function fixture(run) {
  const dataDir = mkdtempSync(join(tmpdir(), 'rumbo-refresh-')), db = new DatabaseSync(':memory:'), key = randomBytes(32);
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  for (const id of ['ws', 'other']) db.prepare('INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, id, id, 'now', 'now');
  const env = { TALVORI_CONNECTION_ENCRYPTION_KEY: key.toString('base64'), TALVORI_SLACK_CALLBACK_URL: 'https://example.test/callback', ...Object.fromEntries(Object.keys(OAUTH_PROVIDERS).flatMap(family => [[`TALVORI_${family.toUpperCase()}_CLIENT_ID`, 'app'], [`TALVORI_${family.toUpperCase()}_CLIENT_SECRET`, 'secret']])) };
  const calls = [], control = { hook: null, allowed: true }; let serial = 0;
  const platform = createConnectionPlatform({ db, dataDir, env, workerIntervalMs: 0, authorize: () => control.authorizeHook?.() ?? control.allowed, fetchImpl: async (url, options) => {
    const family = Object.entries(OAUTH_PROVIDERS).find(([, definition]) => definition.token === url)?.[0] || (url === 'https://api.figma.com/v1/oauth/refresh' ? 'figma' : null);
    const fields = family ? options.headers['Content-Type'] === 'application/json' ? JSON.parse(options.body) : Object.fromEntries(new URLSearchParams(options.body)) : null;
    const call = { url, options, family, fields }; calls.push(call);
    const override = await control.hook?.(call); if (override) return override;
    if (family) return json({ access_token: `${family}-access-${++serial}`, ...(fields.grant_type === 'authorization_code' ? { refresh_token: `${family}-refresh-${serial}`, user_id_string: fields.code === 'other-account' ? '9007199254740993124' : '9007199254740993123' } : {}), expires_in: 3600 });
    if (url.includes('accessible-resources')) return json([{ id: 'site', name: 'Fixture' }]);
    const identityFamily = url.includes('github') ? 'github' : url.includes('googleapis') ? 'google' : url.includes('linear') ? 'linear' : url.includes('slack') ? 'slack' : url.includes('figma') ? 'figma' : 'jira';
    return json(identities[identityFamily]);
  } });
  const read = id => { const row = db.prepare('SELECT ciphertext FROM platform_connection_secrets WHERE connection_id=?').get(id); if (!row) return null; const [iv, tag, encrypted] = row.ciphertext.split('.').map(value => Buffer.from(value, 'base64')); const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(tag); return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()])); };
  const write = (id, token) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(id)); const encrypted = Buffer.concat([cipher.update(JSON.stringify(token)), cipher.final()]); db.prepare('UPDATE platform_connection_secrets SET ciphertext=? WHERE connection_id=?').run([iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64')).join('.'), id); };
  const expire = id => write(id, { ...read(id), expires_at: 1 });
  const begin = async id => new URL((await platform.beginAuthorization(id, actor)).authorization_url).searchParams.get('state');
  const connect = async (provider, workspace_id = 'ws', code = 'fixture') => { const row = await platform.create({ provider, workspace_id }, actor); return platform.completeAuthorization({ state: await begin(row.id), code }, actor); };
  try { await run({ platform, db, env, calls, control, read, write, expire, begin, connect }); }
  finally { platform.close(); db.close(); rmSync(dataDir, { recursive: true }); }
}

for (const [family, provider] of Object.entries({ github: 'github', google: 'google-drive', linear: 'linear', jira: 'jira', slack: 'slack', figma: 'figma' })) test(`${family}: refresh retains omitted refresh token, encrypts credentials and uses fresh bearer`, () => fixture(async ({ platform, connect, expire, read, calls }) => {
  const row = await connect(provider), initial = read(row.id); expire(row.id);
  await platform.verify(row.id, actor); const refreshed = read(row.id);
  assert.notEqual(refreshed.access_token, initial.access_token); assert.equal(refreshed.refresh_token, initial.refresh_token);
  const exchanges = calls.filter(call => call.family); assert.equal(exchanges.length, 2); assert.equal(exchanges[1].fields.refresh_token, initial.refresh_token);
  assert.equal(exchanges[1].fields.grant_type, 'refresh_token');
  if (family === 'figma') { assert.equal(exchanges[1].url, 'https://api.figma.com/v1/oauth/refresh'); assert.equal(exchanges[1].options.headers.Authorization, `Basic ${Buffer.from('app:secret').toString('base64')}`); assert.equal(exchanges[1].fields.client_secret, undefined); }
  const request = calls.find(call => !call.family); assert.equal(request.options.headers.Authorization, `Bearer ${refreshed.access_token}`);
  await platform.verify(row.id, actor); assert.equal(calls.filter(call => call.family).length, 2);
  assert.ok(!JSON.stringify(await platform.list('ws', actor)).includes(refreshed.access_token));
}));

test('concurrent refreshes for one connection make one exchange', () => fixture(async ({ platform, connect, expire, calls }) => {
  const row = await connect('github'); expire(row.id);
  await Promise.all([platform.verify(row.id, actor), platform.verify(row.id, actor)]);
  assert.equal(calls.filter(call => call.fields?.grant_type === 'refresh_token').length, 1);
}));

test('Figma and FigJam synchronize only pre-authorized same-account records, with permissions unchanged', () => fixture(async ({ platform, connect, read, expire, calls }) => {
  const figma = await connect('figma');
  await platform.settings(figma.id, { selected_resources: ['selected-file'], agent_access: false }, actor);
  const disconnected = await connect('figma'); await platform.disconnect(disconnected.id, {}, actor);
  const unapproved = await platform.create({ provider: 'figjam', workspace_id: 'other' }, actor);
  const unrelated = await connect('figma', 'other', 'other-account'), unrelatedToken = read(unrelated.id);
  const figjam = await connect('figjam', 'other');
  assert.equal(read(figma.id).access_token, read(figjam.id).access_token);
  assert.equal(read(figma.id).rumbo_oauth_binding.account, '9007199254740993123');
  assert.equal(read(disconnected.id), null); assert.equal(read(unapproved.id), null); assert.deepEqual(read(unrelated.id), unrelatedToken);
  expire(figma.id); expire(figjam.id);
  await Promise.all([platform.verify(figma.id, actor), platform.verify(figjam.id, actor)]);
  assert.equal(calls.filter(call => call.fields?.grant_type === 'refresh_token').length, 1);
  assert.equal(read(figma.id).access_token, read(figjam.id).access_token);
  assert.deepEqual((await platform.list('ws', actor)).find(row => row.id === figma.id).settings.selected_resources, ['selected-file']);
  assert.equal((await platform.list('ws', actor)).find(row => row.id === figma.id).settings.agent_access, false);
}));

test('disconnect during Figma refresh never resurrects source, but retains latest token for authorized peer', () => fixture(async ({ platform, connect, read, expire, control }) => {
  const first = await connect('figma'), second = await connect('figjam'), entered = deferred(), release = deferred(); expire(first.id);
  control.hook = async call => { if (call.fields?.grant_type === 'refresh_token') { entered.resolve(); await release.promise; return json({ access_token: 'latest', expires_in: 3600 }); } };
  const pending = assert.rejects(platform.verify(first.id, actor), error => ['not_connected', 'connection_changed'].includes(error.code));
  await entered.promise; await platform.disconnect(first.id, {}, actor); release.resolve(); await pending;
  assert.equal(read(first.id), null); assert.equal(read(second.id).access_token, 'latest');
  assert.equal((await platform.list('ws', actor)).find(row => row.id === first.id).state, 'not_connected');
  await platform.verify(second.id, actor);
}));

test('new Figma consent waits behind refresh and its newer token wins across existing grants', () => fixture(async ({ platform, connect, read, expire, control, begin }) => {
  const first = await connect('figma'), second = await connect('figjam'), entered = deferred(), release = deferred(); expire(first.id);
  control.hook = async call => { if (call.fields?.grant_type === 'refresh_token') { entered.resolve(); await release.promise; return json({ access_token: 'refreshed-first', expires_in: 3600 }); } };
  const refresh = platform.verify(first.id, actor); await entered.promise;
  const consent = platform.completeAuthorization({ state: await begin(second.id), code: 'reconnect' }, actor);
  release.resolve(); await Promise.all([refresh, consent]);
  assert.equal(read(first.id).access_token, read(second.id).access_token); assert.notEqual(read(first.id).access_token, 'refreshed-first');
}));

test('cancelled Figma token exchange cannot reconnect a removed grant and keeps existing peers current', () => fixture(async ({ platform, connect, read, control, begin }) => {
  const first = await connect('figma'), second = await connect('figjam'), entered = deferred(), release = deferred();
  control.hook = async call => { if (call.fields?.code === 'cancel') { entered.resolve(); await release.promise; return json({ access_token: 'latest-consent', refresh_token: 'new-refresh', user_id_string: '9007199254740993123', expires_in: 3600 }); } };
  const pending = assert.rejects(platform.completeAuthorization({ state: await begin(first.id), code: 'cancel' }, actor), error => error.code === 'authorization_cancelled');
  await entered.promise; await platform.disconnect(first.id, {}, actor); release.resolve(); await pending;
  assert.equal(read(first.id), null); assert.equal(read(second.id).access_token, 'latest-consent');
}));

test('starting then abandoning consent during refresh does not strand an existing Figma grant', () => fixture(async ({ platform, connect, read, expire, control, begin }) => {
  const first = await connect('figma'), second = await connect('figjam'), entered = deferred(), release = deferred(); expire(first.id);
  control.hook = async call => { if (call.fields?.grant_type === 'refresh_token') { entered.resolve(); await release.promise; return json({ access_token: 'still-current', expires_in: 3600 }); } };
  const pending = assert.rejects(platform.verify(first.id, actor), error => error.code === 'not_connected');
  await entered.promise; await begin(first.id); await begin(second.id); release.resolve(); await pending;
  assert.equal(read(first.id).access_token, 'still-current'); assert.equal(read(second.id).access_token, 'still-current');
  await platform.verify(first.id, actor); await platform.verify(second.id, actor);
}));

test('Figma app and scope provenance prevent credential sharing into different grants', () => fixture(async ({ platform, connect, read, write, env }) => {
  const first = await connect('figma'), prior = read(first.id);
  write(first.id, { ...prior, rumbo_oauth_binding: { ...prior.rumbo_oauth_binding, scopes: 'current_user:read' } });
  await connect('figjam'); assert.equal(read(first.id).access_token, prior.access_token);
  env.TALVORI_FIGMA_CLIENT_ID = 'different-app'; await connect('figjam'); assert.equal(read(first.id).access_token, prior.access_token);
  await assert.rejects(platform.verify(first.id, actor), error => error.code === 'reconnect_required');
}));

test('rejected refresh asks for reconnection and does not retry indefinitely', () => fixture(async ({ platform, connect, expire, control, calls }) => {
  const row = await connect('github'); expire(row.id);
  control.hook = call => call.fields?.grant_type === 'refresh_token' ? json({ error: 'invalid_grant' }, 400) : null;
  await assert.rejects(platform.verify(row.id, actor), error => error.code === 'oauth_rejected');
  assert.equal((await platform.list('ws', actor))[0].state, 'reconnect_required');
  await assert.rejects(platform.verify(row.id, actor), error => error.code === 'not_connected');
  assert.equal(calls.filter(call => call.fields?.grant_type === 'refresh_token').length, 1);
}));

test('rejected refresh arriving after disconnect cannot change disconnected state', () => fixture(async ({ platform, connect, expire, control, read }) => {
  const row = await connect('github'), entered = deferred(), release = deferred(); expire(row.id);
  control.hook = async call => { if (call.fields?.grant_type === 'refresh_token') { entered.resolve(); await release.promise; return json({ error: 'invalid_grant' }, 400); } };
  const pending = assert.rejects(platform.verify(row.id, actor), error => error.code === 'oauth_rejected');
  await entered.promise; await platform.disconnect(row.id, {}, actor); release.resolve(); await pending;
  assert.equal(read(row.id), null); assert.equal((await platform.list('ws', actor))[0].state, 'not_connected');
}));

test('callback rechecks operator permissions after exchange and rejects a different actor even on denial', () => fixture(async ({ platform, connect, begin, control, read }) => {
  const row = await connect('github'), prior = read(row.id);
  const state = await begin(row.id);
  await assert.rejects(platform.completeAuthorization({ state, error: 'denied' }, { id: 'other' }), error => error.code === 'oauth_actor_mismatch');
  const next = await begin(row.id);
  control.hook = call => { if (call.fields?.code === 'revoked') control.allowed = false; };
  await assert.rejects(platform.completeAuthorization({ state: next, code: 'revoked' }, actor), error => error.code === 'permission_denied');
  assert.deepEqual(read(row.id), prior);
}));

test('disconnect during the final async callback permission check cannot resurrect credentials', () => fixture(async ({ platform, connect, begin, control, read }) => {
  const row = await connect('figma'), entered = deferred(), release = deferred();
  control.hook = call => { if (call.fields?.code === 'race') control.authorizeHook = async () => { control.authorizeHook = null; entered.resolve(); await release.promise; return true; }; };
  const pending = assert.rejects(platform.completeAuthorization({ state: await begin(row.id), code: 'race' }, actor), error => error.code === 'authorization_cancelled');
  await entered.promise; await platform.disconnect(row.id, {}, actor); release.resolve(); await pending;
  assert.equal(read(row.id), null); assert.equal((await platform.list('ws', actor))[0].state, 'not_connected');
}));

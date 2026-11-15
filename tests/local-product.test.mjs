import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { TERMINAL_PROVIDER_CATALOG } from '../server/terminal-launch-plan.mjs';
import { createLocalProductPolicy } from '../server/local-product.mjs';
import { createIdentityService } from '../server/identity-service.mjs';
import { createLocalApi } from '../server/local-api.mjs';
import { localSettingsGroups } from '../src/lib/local-product.js';
import { SETTINGS_GROUPS } from '../src/lib/settings-catalog.js';
import { areaContactsVisible } from '../src/lib/areas.js';
import { browserCommand, localPort, launchLocal } from '../scripts/start-local.mjs';

const data = { meta: { product: { edition: 'local' } }, team_members: [{ team_id: 'a' }] };
test('local launcher validates ports and builds shell-free cross-platform browser commands', () => {
  for (const value of ['0', '65536', '4174;whoami', 'http://example.com', '-1', '1.5']) assert.throws(() => localPort(value));
  for (const platform of ['darwin', 'win32', 'linux']) {
    const [command, args] = browserCommand(platform, 4174);
    assert.ok(command); assert.equal(args.at(-1), 'http://127.0.0.1:4174');
  }
  assert.throws(() => browserCommand('unknown', 4174));
});
test('local launcher rejects an occupied port before opening application files or a database', async () => {
  const occupied = createServer();
  try {
    await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
    await assert.rejects(launchLocal({ port: occupied.address().port, env: {}, clientDirectory: '/not-a-real-frondose-build' }), /did not open its database/);
  } finally { await new Promise(resolve => occupied.close(resolve)); }
});
test('local edition rejects hosting, membership mutations, invitations and agent sharing', () => {
  assert.throws(() => createLocalProductPolicy({ mode: 'local', hosted: true }), /local-only/);
  const policy = createLocalProductPolicy({ mode: 'local' });
  for (const path of ['/identity/invite', '/identity/accept', '/team_members', '/team-members/person', '/governance']) assert.throws(() => policy.checkPath(path, 'POST'), { code: 'local_only_product' });
  policy.checkPath('/governance', 'GET');
  policy.checkOwner({ id: 'local-owner' });
  assert.throws(() => policy.checkOwner({ id: 'other' }), { code: 'local_only_product' });
  assert.throws(() => policy.checkRunnerSettings({ usage_scope: 'workspace' }));
  assert.throws(() => policy.checkRunnerSettings({ usage_scope: 'private', usage_member_ids: ['other'] }));
  policy.checkRunnerSettings({ usage_scope: 'private', usage_member_ids: [] });
});
test('local navigation removes member, role, billing and hosted administration without deleting data', () => {
  const before = JSON.stringify(data);
  const groups = localSettingsGroups(SETTINGS_GROUPS, data);
  const ids = groups.flatMap(([, items]) => items.map(([id]) => id));
  for (const id of ['members', 'security', 'access-approvals', 'applications', 'api', 'billing']) assert.equal(ids.includes(id), false);
  for (const id of ['local-installation', 'personal-security', 'workspace-tabs', 'terminal', 'privacy', 'storage']) assert.equal(ids.includes(id), true);
  for (const id of ['agents', 'rumbo-agent', 'accounts', 'workbench', 'home-attention', 'chats', 'permissions', 'usage', 'scheduled-work']) assert.equal(ids.includes(id), false);
  assert.equal(areaContactsVisible(data, 'a', { contacts_enabled: true }), false);
  assert.equal(JSON.stringify(data), before);
  assert.equal(localSettingsGroups(SETTINGS_GROUPS, {}), SETTINGS_GROUPS);
});
test('local owner lock is optional, never bypassed, and historical member passwords/sessions do not become access', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const identity = createIdentityService({ db, ownerOnly: true });
    assert.equal(identity.resolve({ headers: {} }).id, 'local-owner');
    const owner = await identity.setup({ name: 'Owner', email: 'owner@example.com', password: 'fixture-password-123' }, { id: 'local-owner' });
    assert.equal(identity.resolve({ headers: {} }), null);
    assert.equal(identity.resolve({ headers: { cookie: `frondose_session=${owner.token}` } }).id, 'local-owner');
    const hash = db.prepare("SELECT password_hash FROM identity_users WHERE id='local-owner'").get().password_hash;
    db.prepare('INSERT INTO identity_users VALUES(?,?,?,?,?)').run('member', 'Old member', 'member@example.com', hash, Date.now());
    const token = 'test-member-token';
    db.prepare('INSERT INTO identity_sessions VALUES(?,?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), 'member', Date.now(), Date.now() + 60000, Date.now());
    assert.equal(identity.resolve({ headers: { cookie: `frondose_session=${token}` } }), null);
    await assert.rejects(identity.login({ email: 'member@example.com', password: 'fixture-password-123' }), /incorrect/);
    await assert.rejects(identity.accept({ token: 'unused' }), /unavailable/);
    assert.throws(() => identity.invite({}, { id: 'local-owner' }), /unavailable/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM identity_users').get().n, 2);
  } finally { db.close(); }
});
test('local API publishes edition, redacts discovery paths, and never runs a provider during detection', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'frondose-local-edition-'));
  const forbidden = () => { throw Error('Provider execution/network is forbidden'); };
  let discoveries = 0;
  const api = createLocalApi({ dataDir, productMode: 'local', integrationOptions: { env: {}, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden },
    localDiscovery: async options => { discoveries++; assert.deepEqual(options, { platform: process.platform, env: {} }); return [{ providerId: 'codex', title: 'Untrusted title with secret', state: 'installed', installed: true, executables: [{ path: '/private/secret/bin/codex' }], authenticated: true }, { id: 'opencode2', installed: true, modelAccess: true }, { id: 'not-a-fixed-cli', installed: true }]; } });
  const server = createServer(api.middleware);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const bootstrap = await (await fetch(base + '/bootstrap')).json();
    assert.equal(bootstrap.meta.product.edition, 'local');
    assert.equal(discoveries, 0);
    const response = await fetch(base + '/local-runtime');
    const text = await response.text(), result = JSON.parse(text).result;
    assert.equal(result.runtimes[0].authenticated, null);
    assert.equal(result.runtimes[0].liveVerified, false);
    assert.deepEqual(result.runtimes.map(runtime => [runtime.id, runtime.title]), TERMINAL_PROVIDER_CATALOG.map(runtime => [runtime.id, runtime.title]));
    assert.equal(result.runtimes.find(runtime => runtime.id === 'codex').installed, true);
    assert.equal(result.runtimes.find(runtime => runtime.id === 'opencode2').title, 'OpenCode 2');
    assert.equal(result.runtimes.find(runtime => runtime.id === 'opencode2').modelAccess, null);
    assert.equal(result.runtimes.find(runtime => runtime.id === 'claude').state, 'not_found');
    assert.equal(result.runtimes.some(runtime => runtime.id === 'not-a-fixed-cli'), false);
    assert.deepEqual(result.host, { platform: process.platform, architecture: process.arch, node: process.versions.node, defaultShell: process.platform === 'win32' ? { id: 'cmd', title: 'Command Prompt' } : { id: 'bash', title: 'Bash' } });
    assert.doesNotMatch(text, /secret|executables/);
    assert.equal(discoveries, 1);
    for (const path of ['/identity/invite', '/identity/accept', '/governance', '/team_members']) {
      const denied = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(denied.status, 403);
    }
    const crossOrigin = await fetch(base + '/local-runtime', { headers: { Origin: 'https://attacker.example' } });
    assert.equal(crossOrigin.status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); api.close(); await rm(dataDir, { recursive: true, force: true }); }
});

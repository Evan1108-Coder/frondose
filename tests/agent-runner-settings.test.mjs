import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_AGENT_RUNNER_SETTINGS, normalizeAgentRunnerSettings, agentRunnerUsageDecision,
  installAgentRunnerSettings, createAgentRunnerSettingsService,
} from '../server/agent-runner-settings.mjs';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE workspaces(id TEXT PRIMARY KEY);
    CREATE TABLE agents(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,provider TEXT,archived_at TEXT,status TEXT);
    CREATE TABLE governance_members(workspace_id TEXT,id TEXT,status TEXT,rank TEXT,PRIMARY KEY(workspace_id,id));
    INSERT INTO workspaces VALUES('workspace'),('other-workspace');
    INSERT INTO agents VALUES('agent','workspace','First Codex','codex',NULL,'active'),('second-agent','workspace','Second Codex','codex',NULL,'active'),('foreign-agent','other-workspace','Other Codex','codex',NULL,'active');
    INSERT INTO governance_members VALUES('workspace','owner','active','Owner'),('workspace','manager','active','Manager'),('workspace','member','active','Member'),('workspace','other-member','active','Member'),('workspace','inactive','removed','Member'),('other-workspace','outsider','active','Owner');`);
  installAgentRunnerSettings(db);
  const denied = new Set();
  const runner = { owner: 'owner', workspaceId: 'workspace', revoked: false, shared: new Set(['owner']), runtimeId: 'codex' };
  let checks = 0;
  const authorize = (_ws, actor, permission) => ({ allowed: !denied.has(`${actor.id}:${permission}`) && (!['agents.write', 'agents.manage'].includes(permission) || ['owner', 'manager'].includes(actor.id)) });
  const checkRunnerBinding = ({ workspaceId, actor, runnerId, runtimeId, operation }) => {
    checks++;
    return runnerId === 'runner' && workspaceId === runner.workspaceId && runtimeId === runner.runtimeId && !runner.revoked && (operation === 'configure' ? actor.id === runner.owner : runner.shared.has(actor.id));
  };
  const service = createAgentRunnerSettingsService({ db, authorize, checkRunnerBinding, checkConnectionAccess: ({ actor }) => actor.id === 'owner', now: () => '2026-10-21T10:00:00.000Z' });
  const context = (actorId = 'owner', agentId = 'agent', workspaceId = 'workspace') => ({ workspaceId, agentId, actor: { id: actorId } });
  const save = (input, actorId, agentId) => service.update({ ...context(actorId, agentId), input });
  const computer = { version: 0, connection_method: 'computer', runner_id: 'runner', runtime_id: 'codex', enabled: true };
  return { db, service, context, save, computer, denied, runner, checks: () => checks, authorize };
}

test('normalization is explicit, bounded, private by default and does not mutate inputs', () => {
  const input = { usage_scope: 'members', usage_member_ids: ['b', 'a', 'b'] };
  const value = normalizeAgentRunnerSettings(input);
  assert.deepEqual(value.usage_member_ids, ['a', 'b']);
  assert.deepEqual(input.usage_member_ids, ['b', 'a', 'b']);
  assert.equal(value.enabled, false);
  assert.equal(value.connection_method, 'unselected');
  assert.equal(DEFAULT_AGENT_RUNNER_SETTINGS.usage_scope, 'private');
  assert.equal(Object.isFrozen(DEFAULT_AGENT_RUNNER_SETTINGS.usage_member_ids), true);
});

test('normalization rejects credentials, commands, scope escalation, malformed IDs and misleading states', () => {
  for (const input of [
    null, [], { token: 'secret' }, { env: { TOKEN: 'secret' } }, { command: 'codex --yolo' },
    { owner_actor_id: 'other' }, { workspace_id: 'other' }, { runner_id: '../runner' },
    { runtime_id: 'codex\0evil' }, { connection_method: 'computer' }, { enabled: true },
    { enabled: 1 }, { usage_scope: 'everyone' }, { usage_scope: 'members', usage_member_ids: [] },
    { usage_member_ids: ['member'] }, { usage_scope: 'members', usage_member_ids: [''] },
    { usage_scope: 'members', usage_member_ids: Array(201).fill('member') },
    { max_concurrent_sessions: 0 }, { max_concurrent_sessions: 9 }, { max_concurrent_sessions: 1.1 },
    { session_policy: 'reuse-any-session' }, { connection_method: 'api', runner_id: 'runner' },
  ]) assert.throws(() => normalizeAgentRunnerSettings(input), undefined, JSON.stringify(input));
});

test('changing sharing modes clears stale selected-member references', () => {
  const selected = normalizeAgentRunnerSettings({ usage_scope: 'members', usage_member_ids: ['member'] });
  assert.deepEqual(normalizeAgentRunnerSettings({ usage_scope: 'private' }, selected).usage_member_ids, []);
  assert.deepEqual(normalizeAgentRunnerSettings({ usage_scope: 'workspace' }, selected).usage_member_ids, []);
});

test('pure usage decisions require each independent execution and connection authority', () => {
  const settings = { owner_actor_id: 'owner', enabled: true, connection_method: 'computer', usage_scope: 'private', usage_member_ids: [] };
  const allowed = { actorId: 'owner', activeMember: true, ownerActive: true, canRead: true, canRun: true, canUse: true, connectionAuthorized: true };
  assert.equal(agentRunnerUsageDecision(settings, allowed).allowed, true);
  for (const field of ['activeMember', 'ownerActive', 'canRead', 'canRun', 'canUse', 'connectionAuthorized']) assert.equal(agentRunnerUsageDecision(settings, { ...allowed, [field]: false }).allowed, false, field);
  assert.equal(agentRunnerUsageDecision(settings, { ...allowed, actorId: 'member' }).reason, 'agent_not_shared');
  assert.equal(agentRunnerUsageDecision({ ...settings, usage_scope: 'members', usage_member_ids: ['member'] }, { ...allowed, actorId: 'member' }).allowed, true);
  assert.equal(agentRunnerUsageDecision({ ...settings, usage_scope: 'workspace' }, { ...allowed, actorId: 'member' }).allowed, true);
});

test('install is additive and read never creates a connection, ownership or audit record', t => {
  const { db, service, context, checks } = fixture(t);
  installAgentRunnerSettings(db);
  const value = service.read(context());
  assert.equal(value.enabled, false);
  assert.equal(value.version, 0);
  assert.equal(value.owner_actor_id, null);
  assert.equal(value.usage_scope, 'private');
  assert.equal(checks(), 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM agent_runner_settings').get().count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM agent_runner_settings_audit').get().count, 0);
  assert.equal(service.canUse(context()).allowed, false);
});

test('multiple named profiles can bind one runtime without copying credentials or collapsing profiles', t => {
  const { db, service, save, context, computer } = fixture(t);
  const first = save(computer);
  const second = save(computer, 'owner', 'second-agent');
  assert.equal(first.runner_id, second.runner_id);
  assert.notEqual(first.agent_id, second.agent_id);
  assert.equal(service.authorizeUse(context()).agent_id, 'agent');
  assert.equal(service.authorizeUse(context('owner', 'second-agent')).agent_id, 'second-agent');
  assert.deepEqual(db.prepare('SELECT name FROM agents ORDER BY id').all().map(row => row.name), ['First Codex', 'Other Codex', 'Second Codex']);
  const columns = db.prepare('PRAGMA table_info(agent_runner_settings)').all().map(row => row.name);
  assert.equal(columns.some(name => /secret|token|credential|command|environment/.test(name)), false);
});

test('settings use optimistic version checks and immutable owner IDs', t => {
  const { save, computer, db } = fixture(t);
  save(computer);
  for (const input of [{ enabled: false }, { version: -1 }, { version: '1' }]) assert.throws(() => save(input), /current.*version/);
  assert.throws(() => save({ version: 0, enabled: false }), error => error.statusCode === 409 && error.code === 'agent_runner_settings_stale');
  assert.throws(() => save({ version: 1, owner_actor_id: 'member' }), /Unsupported/);
  const second = save({ version: 1, max_concurrent_sessions: 3, session_policy: 'new-session' });
  assert.equal(second.version, 2);
  assert.equal(second.max_concurrent_sessions, 3);
  assert.equal(second.owner_actor_id, 'owner');
  assert.equal(db.prepare('SELECT count(*) AS count FROM agent_runner_settings_audit').get().count, 2);
});

test('profile read access does not permit using a private agent', t => {
  const { service, context, save, computer, checks } = fixture(t);
  save(computer);
  assert.equal(service.read(context('member')).agent_id, 'agent');
  const before = checks();
  assert.equal(service.canUse(context('member')).reason, 'agent_not_shared');
  assert.equal(checks(), before, 'private profile must not probe the underlying runner');
  assert.throws(() => service.authorizeUse(context('member')), error => error.statusCode === 403);
});

test('explicit selected-member sharing requires active membership AND runner authorization', t => {
  const { service, context, save, computer, runner, db } = fixture(t);
  save({ ...computer, usage_scope: 'members', usage_member_ids: ['member'] });
  assert.equal(service.canUse(context('member')).reason, 'connection_authorization_required');
  runner.shared.add('member');
  assert.equal(service.canUse(context('member')).allowed, true);
  runner.shared.add('other-member');
  assert.equal(service.canUse(context('other-member')).reason, 'agent_not_shared');
  db.prepare("UPDATE governance_members SET status='removed' WHERE id='member'").run();
  assert.equal(service.canUse(context('member')).allowed, false);
});

test('selected members cannot be foreign, inactive, or authored contact names', t => {
  const { save, computer, db } = fixture(t);
  for (const member of ['outsider', 'inactive', 'Contact Name']) assert.throws(() => save({ ...computer, usage_scope: 'members', usage_member_ids: [member] }));
  assert.equal(db.prepare('SELECT count(*) AS count FROM agent_runner_settings').get().count, 0);
});

test('workspace sharing does not authorize credentials or removed members', t => {
  const { service, context, save, computer, runner, db } = fixture(t);
  save({ ...computer, usage_scope: 'workspace' });
  assert.equal(service.canUse(context('member')).allowed, false);
  runner.shared.add('member');
  assert.equal(service.canUse(context('member')).allowed, true);
  db.prepare("UPDATE governance_members SET status='removed' WHERE id='owner'").run();
  assert.equal(service.canUse(context('member')).reason, 'connection_owner_unavailable');
});

test('governance read, run and use revocations independently deny use', t => {
  const { service, context, save, computer, denied } = fixture(t);
  save(computer);
  for (const permission of ['agents.read', 'agents.run', 'agents.use']) {
    denied.add(`owner:${permission}`);
    assert.equal(service.canUse(context()).allowed, false, permission);
    denied.clear();
  }
  assert.equal(service.canUse(context()).allowed, true);
});

test('a profile share cannot outlive the connection owner’s execution authority', t => {
  const { service, context, save, computer, runner, denied } = fixture(t);
  save({ ...computer, usage_scope: 'workspace' });
  runner.shared.add('member');
  assert.equal(service.canUse(context('member')).allowed, true);
  for (const permission of ['agents.read', 'agents.run', 'agents.use']) {
    denied.add(`owner:${permission}`);
    assert.equal(service.canUse(context('member')).reason, 'connection_owner_authority_revoked');
    denied.clear();
  }
});

test('managers can disable but never bind, share, enable or replace connection ownership', t => {
  const { service, context, save, computer, db } = fixture(t);
  save(computer);
  for (const patch of [{ enabled: true }, { enabled: false, usage_scope: 'workspace' }, { enabled: false, runner_id: 'other' }]) assert.throws(() => save({ version: 1, ...patch }, 'manager'), error => error.statusCode === 403);
  const disabled = save({ version: 1, enabled: false }, 'manager');
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.owner_actor_id, 'owner');
  assert.equal(service.canUse(context()).reason, 'agent_connection_disabled');
  const audit = db.prepare('SELECT * FROM agent_runner_settings_audit ORDER BY version DESC LIMIT 1').get();
  assert.equal(audit.action, 'agent.disabled');
  assert.equal(audit.actor_id, 'manager');
  assert.equal(save({ version: 2, enabled: true }).enabled, true);
});

test('write and management authority are required even for existing connection owners', t => {
  const { save, computer, denied } = fixture(t);
  save(computer);
  denied.add('owner:agents.write');
  assert.throws(() => save({ version: 1, enabled: false }), error => error.statusCode === 403);
  denied.add('manager:agents.manage');
  assert.throws(() => save({ version: 1, enabled: false }, 'manager'), error => error.statusCode === 403);
  assert.throws(() => save({ version: 1, enabled: false }, 'member'), error => error.statusCode === 403);
});

test('binding validation checks current ownership, runtime, workspace and revocation before persistence', t => {
  const { save, computer, runner, service, context } = fixture(t);
  for (const patch of [{ runner_id: 'foreign-runner' }, { runtime_id: 'claude' }]) assert.throws(() => save({ ...computer, ...patch }), error => error.code === 'runner_binding_denied');
  assert.throws(() => save(computer, 'manager'), error => error.code === 'runner_binding_denied');
  save(computer);
  runner.revoked = true;
  assert.equal(service.canUse(context()).allowed, false);
  assert.throws(() => save({ version: 1, max_concurrent_sessions: 2 }), error => error.code === 'runner_binding_denied');
  assert.equal(save({ version: 1, enabled: false }).enabled, false, 'disabling remains possible after underlying runner revocation');
});

test('missing or asynchronous connection callbacks fail closed and cannot authenticate from a request', t => {
  const { db, authorize, context, computer } = fixture(t);
  assert.throws(() => createAgentRunnerSettingsService({ db }), /authorization boundary/);
  const missing = createAgentRunnerSettingsService({ db, authorize });
  assert.throws(() => missing.update({ ...context(), input: computer }), error => error.code === 'runner_binding_denied');
  const asynchronous = createAgentRunnerSettingsService({ db, authorize, checkRunnerBinding: async () => true });
  assert.throws(() => asynchronous.update({ ...context(), input: computer }), /synchronous/);
  assert.throws(() => missing.read({ ...context(), actor: null }), error => error.statusCode === 401);
  assert.throws(() => missing.update({ ...context(), input: { version: 0, actor_id: 'owner' } }), /Unsupported/);
  const noDecision = createAgentRunnerSettingsService({ db, authorize: () => undefined });
  assert.throws(() => noDecision.read(context()), error => error.statusCode === 403);
  const pendingDecision = createAgentRunnerSettingsService({ db, authorize: async () => ({ allowed: true }) });
  assert.throws(() => pendingDecision.read(context()), error => error.statusCode === 403);
});

test('API and OAuth settings do not share the owner’s personal credential access', t => {
  const { service, save, context } = fixture(t);
  for (const method of ['api', 'oauth']) {
    const saved = save({ version: method === 'api' ? 0 : 1, connection_method: method, usage_scope: 'workspace', enabled: true });
    assert.equal(saved.runner_id, null);
    assert.equal(service.canUse(context()).allowed, true);
    assert.equal(service.canUse(context('member')).reason, 'connection_authorization_required');
  }
});

test('cross-workspace and archived agent access is rejected, and list filters unreadable profiles', t => {
  const { service, context, save, computer, denied, db } = fixture(t);
  save(computer);
  save(computer, 'owner', 'second-agent');
  assert.throws(() => service.read(context('owner', 'foreign-agent')), error => error.statusCode === 404);
  assert.throws(() => service.read(context('outsider')), error => error.statusCode === 403);
  denied.add('member:agents.read');
  assert.deepEqual(service.list({ workspaceId: 'workspace', actor: { id: 'member' } }), []);
  db.prepare("UPDATE agents SET archived_at='2026-10-21' WHERE id='agent'").run();
  assert.equal(service.canUse(context()).allowed, false);
  assert.deepEqual(service.list({ workspaceId: 'workspace', actor: { id: 'owner' } }).map(row => row.agent_id), ['second-agent']);
});

test('paused profiles and corrupt stored settings cannot be used', t => {
  const { service, context, save, computer, db } = fixture(t);
  save(computer);
  db.prepare("UPDATE agents SET status='paused' WHERE id='agent'").run();
  assert.equal(service.canUse(context()).reason, 'agent_paused');
  db.prepare("UPDATE agents SET status='active' WHERE id='agent'").run();
  db.prepare("UPDATE agent_runner_settings SET usage_member_ids_json='not-json' WHERE agent_id='agent'").run();
  assert.equal(service.canUse(context()).allowed, false);
  assert.throws(() => service.read(context()), error => error.code === 'agent_runner_settings_corrupt');
});

test('agent deletion cascades settings but leaves a non-secret attributable audit record', t => {
  const { save, computer, db } = fixture(t);
  save(computer);
  db.prepare("DELETE FROM agents WHERE id='agent'").run();
  assert.equal(db.prepare('SELECT count(*) AS count FROM agent_runner_settings').get().count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM agent_runner_settings_audit').get().count, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('owner can clear prepared settings without editing credentials and audit survives', t => {
  const { service, context, save, computer, db, runner } = fixture(t);
  const prepared = save({ ...computer, enabled: false });
  // Old/revoked runner availability must not prevent the owner rolling preparation back.
  runner.revoked = true;
  db.exec("CREATE TABLE existing_credentials(id TEXT PRIMARY KEY,secret TEXT); INSERT INTO existing_credentials VALUES('existing','untouched');");
  const cleared = service.clear({ ...context(), version: prepared.version });
  assert.equal(cleared.connection_method, 'unselected'); assert.equal(cleared.owner_actor_id, null);
  assert.equal(cleared.enabled, false); assert.equal(cleared.runner_id, null); assert.equal(cleared.runtime_id, null);
  assert.equal(cleared.version, 2);
  assert.equal(db.prepare('SELECT count(*) AS count FROM agent_runner_settings').get().count, 0);
  assert.deepEqual(service.list({ workspaceId: 'workspace', actor: { id: 'owner' } }), []);
  assert.equal(db.prepare("SELECT secret FROM existing_credentials WHERE id='existing'").get().secret, 'untouched');
  const audit = db.prepare('SELECT * FROM agent_runner_settings_audit ORDER BY version').all();
  assert.deepEqual(audit.map(row => row.action), ['settings.updated', 'settings.cleared']);
  assert.equal(audit[1].actor_id, 'owner'); assert.equal(audit[1].version, 2);
  assert.equal(JSON.parse(audit[1].detail_json).returns_to_existing_connection, true);
  assert.doesNotMatch(audit[1].detail_json, /untouched|secret|credential/);
});

test('clear tombstone revisions prevent ABA stale clients from recreating or clearing new settings', t => {
  const { service, context, save, computer, db } = fixture(t);
  save({ ...computer, enabled: false });
  service.clear({ ...context(), version: 1 });
  assert.equal(service.read(context()).version, 2);
  for (const version of [0, 1]) {
    assert.throws(() => save({ ...computer, version }), error => error.code === 'agent_runner_settings_stale');
    assert.throws(() => service.clear({ ...context(), version }), error => error.code === 'agent_runner_settings_stale');
  }
  assert.throws(() => service.clear({ ...context(), version: 2 }), error => error.code === 'agent_runner_settings_not_found');
  const recreated = save({ ...computer, version: 2, enabled: false });
  assert.equal(recreated.version, 3); assert.equal(recreated.owner_actor_id, 'owner');
  assert.throws(() => service.clear({ ...context(), version: 1 }), error => error.code === 'agent_runner_settings_stale');
  assert.equal(service.clear({ ...context(), version: 3 }).version, 4);
  assert.equal(service.read(context()).version, 4);
  assert.equal(save({ ...computer, version: 4, enabled: false }).version, 5);
  assert.deepEqual(db.prepare('SELECT version FROM agent_runner_settings_audit ORDER BY version').all().map(row => row.version), [1, 2, 3, 4, 5]);
});

test('managers cannot clear another owner preparation to reactivate the existing connection', t => {
  const { service, context, save, computer, db } = fixture(t);
  save(computer);
  save({ version: 1, enabled: false }, 'manager');
  assert.throws(() => service.clear({ ...context('manager'), version: 2 }), error => error.code === 'agent_connection_owner_required' && error.statusCode === 403);
  assert.throws(() => service.clear({ ...context('member'), version: 2 }), error => error.code === 'access_denied');
  assert.equal(service.read(context()).version, 2); assert.equal(service.read(context()).enabled, false);
  assert.equal(db.prepare('SELECT count(*) AS count FROM agent_runner_settings_audit').get().count, 2);
  assert.equal(service.clear({ ...context(), version: 2 }).version, 3);
});

test('clearing requires fresh read/write authority, active membership and exact workspace scope', t => {
  const { service, context, save, computer, denied, db } = fixture(t);
  save({ ...computer, enabled: false });
  for (const version of [undefined, -1, '1', 1.1]) assert.throws(() => service.clear({ ...context(), version }), /current.*version/);
  for (const permission of ['agents.read', 'agents.write']) {
    denied.add(`owner:${permission}`);
    assert.throws(() => service.clear({ ...context(), version: 1 }), error => error.code === 'access_denied');
    denied.clear();
  }
  assert.throws(() => service.clear({ ...context('owner', 'foreign-agent'), version: 1 }), error => error.code === 'agent_not_found');
  assert.throws(() => service.clear({ ...context('outsider'), version: 1 }), error => error.code === 'access_denied');
  db.prepare("UPDATE governance_members SET status='removed' WHERE workspace_id='workspace' AND id='owner'").run();
  assert.throws(() => service.clear({ ...context(), version: 1 }), error => error.code === 'access_denied');
  assert.equal(db.prepare('SELECT count(*) AS count FROM agent_runner_settings').get().count, 1);
  assert.equal(db.prepare('SELECT count(*) AS count FROM agent_runner_settings_audit').get().count, 1);
});

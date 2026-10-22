import { randomUUID } from 'node:crypto';

const METHODS = new Set(['unselected', 'api', 'oauth', 'computer']);
const SCOPES = new Set(['private', 'members', 'workspace']);
const SESSIONS = new Set(['conversation', 'new-session']);
const MUTABLE = new Set(['connection_method', 'runner_id', 'runtime_id', 'usage_scope', 'usage_member_ids', 'max_concurrent_sessions', 'session_policy', 'enabled', 'native_tools_allowed']);
const fail = (message, statusCode = 400, code = 'agent_runner_settings_invalid') => { throw Object.assign(new Error(message), { statusCode, code }); };
const stableId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const identity = actor => actor && stableId(actor.id) ? actor.id : fail('Sign in to manage agent connections.', 401, 'authentication_required');
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export const DEFAULT_AGENT_RUNNER_SETTINGS = Object.freeze({
  connection_method: 'unselected', runner_id: null, runtime_id: null,
  usage_scope: 'private', usage_member_ids: Object.freeze([]),
  max_concurrent_sessions: 1, session_policy: 'conversation', enabled: false, native_tools_allowed: false,
});

/** Settings contain references, not secrets, executable commands or authority. */
export function normalizeAgentRunnerSettings(input = {}, current = DEFAULT_AGENT_RUNNER_SETTINGS) {
  if (!plainObject(input)) fail('Agent connection settings must be an object.');
  for (const field of Object.keys(input)) if (!MUTABLE.has(field) && field !== 'version') fail(`Unsupported agent connection setting: ${field}.`);
  const result = Object.fromEntries([...MUTABLE].map(field => [field, Object.hasOwn(input, field) ? input[field] : Object.hasOwn(current, field) ? current[field] : DEFAULT_AGENT_RUNNER_SETTINGS[field]]));
  for (const [field, values] of [['connection_method', METHODS], ['usage_scope', SCOPES], ['session_policy', SESSIONS]]) if (!values.has(result[field])) fail(`Choose a supported ${field.replaceAll('_', ' ')}.`);
  for (const field of ['runner_id', 'runtime_id']) if (result[field] !== null && !stableId(result[field])) fail(`Choose a valid ${field.replaceAll('_', ' ')}.`);
  if (typeof result.enabled !== 'boolean') fail('Agent availability must be true or false.');
  if (typeof result.native_tools_allowed !== 'boolean') fail('Native runtime tools require explicit consent.');
  if (!Number.isSafeInteger(result.max_concurrent_sessions) || result.max_concurrent_sessions < 1 || result.max_concurrent_sessions > 8) fail('Allow between 1 and 8 simultaneous sessions for this agent.');
  if (Object.hasOwn(input, 'usage_scope') && input.usage_scope !== current.usage_scope && !Object.hasOwn(input, 'usage_member_ids')) result.usage_member_ids = [];
  if (!Array.isArray(result.usage_member_ids) || result.usage_member_ids.length > 200 || result.usage_member_ids.some(value => !stableId(value))) fail('Choose at most 200 workspace member IDs.');
  result.usage_member_ids = [...new Set(result.usage_member_ids)].sort();
  if (result.usage_scope === 'members' && !result.usage_member_ids.length) fail('Select at least one member for selected-member access.');
  if (result.usage_scope !== 'members' && result.usage_member_ids.length) fail('Selected member IDs require selected-member access.');
  if (result.connection_method === 'computer') {
    if (!result.runner_id || !result.runtime_id) fail('Select both a paired computer and an agent runtime.');
  } else if (result.runner_id !== null || result.runtime_id !== null) fail('Only computer-backed agents can keep a runner or runtime reference.');
  if (result.connection_method === 'unselected' && result.enabled) fail('Select a connection method before enabling this agent.');
  return result;
}

/** A profile read permission never grants invocation or provider-account access. */
export function agentRunnerUsageDecision(settings, { actorId, activeMember = false, ownerActive = false, canRead = false, canRun = false, canUse = false, connectionAuthorized = false } = {}) {
  if (!actorId || !activeMember) return { allowed: false, reason: 'active_membership_required' };
  if (!canRead) return { allowed: false, reason: 'agent_read_required' };
  if (!canRun || !canUse) return { allowed: false, reason: 'agent_execution_permission_required' };
  if (!settings?.owner_actor_id || !ownerActive) return { allowed: false, reason: 'connection_owner_unavailable' };
  if (!settings.enabled || settings.connection_method === 'unselected') return { allowed: false, reason: 'agent_connection_disabled' };
  const shared = actorId === settings.owner_actor_id || settings.usage_scope === 'workspace' || settings.usage_scope === 'members' && settings.usage_member_ids?.includes(actorId);
  if (!shared) return { allowed: false, reason: 'agent_not_shared' };
  if (!connectionAuthorized) return { allowed: false, reason: 'connection_authorization_required' };
  return { allowed: true, reason: actorId === settings.owner_actor_id ? 'connection_owner' : 'explicit_agent_share' };
}

export function installAgentRunnerSettings(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_runner_settings (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    owner_actor_id TEXT NOT NULL,
    connection_method TEXT NOT NULL DEFAULT 'unselected' CHECK(connection_method IN ('unselected','api','oauth','computer')),
    runner_id TEXT,
    runtime_id TEXT,
    usage_scope TEXT NOT NULL DEFAULT 'private' CHECK(usage_scope IN ('private','members','workspace')),
    usage_member_ids_json TEXT NOT NULL DEFAULT '[]',
    max_concurrent_sessions INTEGER NOT NULL DEFAULT 1 CHECK(max_concurrent_sessions BETWEEN 1 AND 8),
    session_policy TEXT NOT NULL DEFAULT 'conversation' CHECK(session_policy IN ('conversation','new-session')),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(agent_id,workspace_id)
  );
  CREATE INDEX IF NOT EXISTS agent_runner_settings_owner ON agent_runner_settings(workspace_id,owner_actor_id);
  CREATE TABLE IF NOT EXISTS agent_runner_settings_audit (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    actor_id TEXT NOT NULL, action TEXT NOT NULL, version INTEGER NOT NULL,
    detail_json TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
  if (!db.prepare('PRAGMA table_info(agent_runner_settings)').all().some(column => column.name === 'native_tools_allowed')) db.exec('ALTER TABLE agent_runner_settings ADD COLUMN native_tools_allowed INTEGER NOT NULL DEFAULT 0');
}

/**
 * authorize uses authenticated actors, not a body-supplied actor ID.
 * checkRunnerBinding(configure) MUST verify ownership, workspace, non-revocation
 * and runtime compatibility. checkRunnerBinding(use) MUST recheck current runner
 * access and provider sharing policy. No callback may launch a process.
 * API/OAuth access is actor-scoped and MUST be rechecked by checkConnectionAccess.
 */
export function createAgentRunnerSettingsService({ db, authorize, checkRunnerBinding, checkConnectionAccess, now = () => new Date().toISOString() }) {
  if (typeof authorize !== 'function') throw new TypeError('Agent runner settings require an authorization boundary.');
  const stamp = () => { const value = now(); return value instanceof Date ? value.toISOString() : value; };
  const membership = (workspaceId, actorId) => db.prepare("SELECT * FROM governance_members WHERE workspace_id=? AND id=? AND status='active'").get(workspaceId, actorId);
  const permitted = (workspaceId, actor, permission, at) => { try { const value = authorize(workspaceId, actor, permission, at); return value === true || value?.allowed === true; } catch { return false; } };
  const required = (workspaceId, actor, permission, at) => { if (!permitted(workspaceId, actor, permission, at)) fail(`Permission required: ${permission}.`, 403, 'access_denied'); };
  const scope = agentId => ({ scope_type: 'agent', scope_id: agentId });
  const agent = (workspaceId, agentId, actor) => {
    identity(actor);
    if (!stableId(workspaceId) || !stableId(agentId)) fail('Choose a valid workspace and agent.');
    if (!membership(workspaceId, actor.id)) fail('Active workspace membership required.', 403, 'access_denied');
    const value = db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
    if (!value || value.archived_at || value.workspace_id && value.workspace_id !== workspaceId || !value.workspace_id && actor.id !== 'local-owner') fail('Agent not found in this workspace.', 404, 'agent_not_found');
    required(workspaceId, actor, 'agents.read', scope(agentId));
    return value;
  };
  const stored = (workspaceId, agentId) => db.prepare('SELECT * FROM agent_runner_settings WHERE workspace_id=? AND agent_id=?').get(workspaceId, agentId);
  // Clearing preparation must not reset the optimistic revision to zero. The
  // append-only audit acts as a tombstone so stale clients cannot recreate a row.
  const auditRevision = (workspaceId, agentId) => {
    const version = db.prepare('SELECT MAX(version) AS version FROM agent_runner_settings_audit WHERE workspace_id=? AND agent_id=?').get(workspaceId, agentId)?.version ?? 0;
    if (!Number.isSafeInteger(version) || version < 0) fail('Saved agent connection revision is invalid.', 409, 'agent_runner_settings_corrupt');
    return version;
  };
  const nextRevision = version => {
    if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) fail('Saved agent connection revision is invalid.', 409, 'agent_runner_settings_corrupt');
    return version + 1;
  };
  const unpack = row => {
    if (!row) return null;
    let ids;
    try { ids = JSON.parse(row.usage_member_ids_json); } catch { fail('Saved agent connection settings are invalid.', 409, 'agent_runner_settings_corrupt'); }
    const config = normalizeAgentRunnerSettings(Object.fromEntries([...MUTABLE].map(field => [field, field === 'usage_member_ids' ? ids : ['enabled', 'native_tools_allowed'].includes(field) ? row[field] === 1 : row[field]])));
    return { agent_id: row.agent_id, workspace_id: row.workspace_id, owner_actor_id: row.owner_actor_id, ...config, version: row.version, created_at: row.created_at, updated_at: row.updated_at };
  };
  const read = ({ workspaceId, agentId, actor }) => {
    agent(workspaceId, agentId, actor);
    return unpack(stored(workspaceId, agentId)) || { agent_id: agentId, workspace_id: workspaceId, owner_actor_id: null, ...DEFAULT_AGENT_RUNNER_SETTINGS, usage_member_ids: [], version: auditRevision(workspaceId, agentId), created_at: null, updated_at: null };
  };
  const bindingCheck = (settings, context, operation) => {
    const check = settings.connection_method === 'computer' ? checkRunnerBinding : checkConnectionAccess;
    if (typeof check !== 'function') return false;
    const value = check({ ...context, settings, runnerId: settings.runner_id, runtimeId: settings.runtime_id, operation });
    if (value?.then) throw new TypeError('Agent runner authorization callbacks must be synchronous.');
    return value === true || value?.allowed === true;
  };
  const update = ({ workspaceId, agentId, actor, input }) => {
    agent(workspaceId, agentId, actor);
    if (!plainObject(input) || !Number.isSafeInteger(input.version) || input.version < 0) fail('Provide the current agent connection settings version.');
    const savepoint = `agent_runner_${randomUUID().replaceAll('-', '')}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const current = unpack(stored(workspaceId, agentId));
      const currentVersion = current?.version ?? auditRevision(workspaceId, agentId);
      if (currentVersion !== input.version) fail('Agent connection settings changed. Reload before saving.', 409, 'agent_runner_settings_stale');
      required(workspaceId, actor, 'agents.write', scope(agentId));
      const own = !current || current.owner_actor_id === actor.id;
      if (!own) {
        required(workspaceId, actor, 'agents.manage', scope(agentId));
        if (input.enabled !== false || Object.keys(input).some(field => !['version', 'enabled'].includes(field))) fail('Only the connection owner can bind, share or enable this agent. Managers may disable it.', 403, 'agent_connection_owner_required');
      }
      const config = normalizeAgentRunnerSettings(input, current || DEFAULT_AGENT_RUNNER_SETTINGS);
      for (const memberId of config.usage_member_ids) if (!membership(workspaceId, memberId)) fail('Every selected user must be an active member of this workspace.');
      // Persisting an API/OAuth choice never borrows the owner's credentials.
      // Computer references, even disabled ones, must belong to the configurer.
      const disablingOnly = Boolean(current && input.enabled === false && Object.keys(input).every(field => ['version', 'enabled'].includes(field)));
      if (own && !disablingOnly && config.connection_method === 'computer' && !bindingCheck(config, { workspaceId, agentId, actor }, 'configure')) fail('Select a paired computer you own with access to this runtime.', 403, 'runner_binding_denied');
      const version = nextRevision(currentVersion);
      const at = stamp();
      db.prepare(`INSERT INTO agent_runner_settings(agent_id,workspace_id,owner_actor_id,connection_method,runner_id,runtime_id,usage_scope,usage_member_ids_json,max_concurrent_sessions,session_policy,enabled,version,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(agent_id,workspace_id) DO UPDATE SET connection_method=excluded.connection_method,runner_id=excluded.runner_id,runtime_id=excluded.runtime_id,usage_scope=excluded.usage_scope,usage_member_ids_json=excluded.usage_member_ids_json,max_concurrent_sessions=excluded.max_concurrent_sessions,session_policy=excluded.session_policy,enabled=excluded.enabled,version=excluded.version,updated_at=excluded.updated_at`)
        .run(agentId, workspaceId, current?.owner_actor_id || actor.id, config.connection_method, config.runner_id, config.runtime_id, config.usage_scope, JSON.stringify(config.usage_member_ids), config.max_concurrent_sessions, config.session_policy, Number(config.enabled), version, current?.created_at || at, at);
      db.prepare('UPDATE agent_runner_settings SET native_tools_allowed=? WHERE workspace_id=? AND agent_id=?').run(Number(config.native_tools_allowed), workspaceId, agentId);
      db.prepare('INSERT INTO agent_runner_settings_audit(id,agent_id,workspace_id,actor_id,action,version,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(`ars_${randomUUID()}`, agentId, workspaceId, actor.id, own ? 'settings.updated' : 'agent.disabled', version, JSON.stringify({ connection_method: config.connection_method, usage_scope: config.usage_scope, enabled: config.enabled, changed_fields: Object.keys(input).filter(field => field !== 'version') }), at);
      const result = unpack(stored(workspaceId, agentId));
      db.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) { db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`); throw error; }
  };
  // This removes ONLY the prepared runner settings. It neither revokes a runner
  // nor disconnects API/OAuth/CLI credentials. The existing connection path can
  // become available again; the browser must ask the owner to confirm that.
  const clear = ({ workspaceId, agentId, actor, version }) => {
    agent(workspaceId, agentId, actor);
    if (!Number.isSafeInteger(version) || version < 0) fail('Provide the current agent connection settings version.');
    const savepoint = `agent_runner_clear_${randomUUID().replaceAll('-', '')}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const current = unpack(stored(workspaceId, agentId));
      const currentVersion = current?.version ?? auditRevision(workspaceId, agentId);
      if (currentVersion !== version) fail('Agent connection settings changed. Reload before removing preparation.', 409, 'agent_runner_settings_stale');
      if (!current) fail('There are no prepared agent connection settings to remove.', 404, 'agent_runner_settings_not_found');
      required(workspaceId, actor, 'agents.write', scope(agentId));
      if (current.owner_actor_id !== actor.id) fail('Only the connection owner can remove preparation and return to the existing connection.', 403, 'agent_connection_owner_required');
      const nextVersion = nextRevision(currentVersion), at = stamp();
      const removed = db.prepare('DELETE FROM agent_runner_settings WHERE workspace_id=? AND agent_id=? AND owner_actor_id=? AND version=?').run(workspaceId, agentId, actor.id, currentVersion);
      if (removed.changes !== 1) fail('Agent connection settings changed. Reload before removing preparation.', 409, 'agent_runner_settings_stale');
      db.prepare('INSERT INTO agent_runner_settings_audit(id,agent_id,workspace_id,actor_id,action,version,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(`ars_${randomUUID()}`, agentId, workspaceId, actor.id, 'settings.cleared', nextVersion, JSON.stringify({ previous_connection_method: current.connection_method, previous_enabled: current.enabled, returns_to_existing_connection: true }), at);
      const result = read({ workspaceId, agentId, actor });
      db.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) { db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`); throw error; }
  };
  const canUse = ({ workspaceId, agentId, actor }) => {
    try {
      const profile = agent(workspaceId, agentId, actor);
      const settings = unpack(stored(workspaceId, agentId));
      const base = { actorId: actor.id, activeMember: true, ownerActive: Boolean(settings && membership(workspaceId, settings.owner_actor_id)), canRead: true,
        canRun: permitted(workspaceId, actor, 'agents.run', scope(agentId)), canUse: permitted(workspaceId, actor, 'agents.use', scope(agentId)) };
      const pending = agentRunnerUsageDecision(settings, { ...base, connectionAuthorized: true });
      if (!pending.allowed) return pending;
      // A share cannot outlive its owner's underlying execution authority.
      const owner = { id: settings.owner_actor_id };
      if (!['agents.read', 'agents.run', 'agents.use'].every(permission => permitted(workspaceId, owner, permission, scope(agentId)))) return { allowed: false, reason: 'connection_owner_authority_revoked' };
      if (profile.status === 'paused') return { allowed: false, reason: 'agent_paused' };
      return agentRunnerUsageDecision(settings, { ...base, connectionAuthorized: bindingCheck(settings, { workspaceId, agentId, actor, ownerActorId: settings.owner_actor_id }, 'use') });
    } catch (error) { return { allowed: false, reason: error.code || 'agent_connection_unavailable' }; }
  };
  const authorizeUse = context => { const decision = canUse(context); if (!decision.allowed) fail('This agent is not available to run with your current access and connection.', 403, decision.reason); return read(context); };
  const list = ({ workspaceId, actor }) => {
    identity(actor);
    if (!membership(workspaceId, actor.id)) fail('Active workspace membership required.', 403, 'access_denied');
    return db.prepare('SELECT agent_id FROM agent_runner_settings WHERE workspace_id=? ORDER BY agent_id').all(workspaceId).flatMap(({ agent_id: agentId }) => { try { return [read({ workspaceId, agentId, actor })]; } catch { return []; } });
  };
  return { read, update, clear, list, canUse, authorizeUse };
}

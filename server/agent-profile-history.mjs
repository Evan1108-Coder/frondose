import { createHash, randomUUID } from 'node:crypto';
import { agentProfileReferenceReadable, snapshotAgentProfile, validateAgentProfile } from './agent-profiles.mjs';
import { recordChange } from './workspace-features.mjs';
import { isRecord, validationError } from './validation.mjs';

export const AGENT_CONTENT_HISTORY_FIELDS = Object.freeze(['role', 'description', 'instructions', 'output_behavior']);
const FIELD_SET = new Set(AGENT_CONTENT_HISTORY_FIELDS);
const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 50;

const now = () => new Date().toISOString();
const uid = prefix => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = (message, statusCode = 400, errorCode = 'validation_error') => Object.assign(new Error(message), { statusCode, errorCode });
const conflict = (message, errorCode = 'stale_profile') => fail(message, 409, errorCode);

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function strictObject(value, fields) {
  if (!isRecord(value)) throw validationError('Provide valid restoration fields.');
  for (const key of Object.keys(value)) if (!fields.includes(key)) throw validationError(`Unknown field: ${key}.`);
}

function parsePositive(value, label) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 1) throw validationError(`${label} must be a positive integer.`);
  return number;
}

function bodyVersion(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw validationError(`${label} must be a positive integer.`);
  return value;
}

function contentFromSnapshot(snapshot) {
  const content = {};
  for (const field of AGENT_CONTENT_HISTORY_FIELDS) {
    if (typeof snapshot[field] !== 'string') throw new Error('invalid_snapshot');
    content[field] = snapshot[field];
  }
  if (content.role.length > 200 || content.description.length > 100_000 || content.instructions.length > 100_000 || content.output_behavior.length > 10_000) throw new Error('invalid_snapshot');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(`${content.description}\n${content.instructions}\n${content.output_behavior}`) || /[\u0000-\u001f]/.test(content.role)) throw new Error('invalid_snapshot');
  return content;
}

function decodedSnapshot(row) {
  if (!row || sha256(row.snapshot_json) !== row.snapshot_hash) throw new Error('invalid_snapshot');
  let snapshot;
  try { snapshot = JSON.parse(row.snapshot_json); } catch { throw new Error('invalid_snapshot'); }
  if (!isRecord(snapshot)) throw new Error('invalid_snapshot');
  return { snapshot, content: contentFromSnapshot(snapshot) };
}

function authorize(agent, actor, allowed, write = false) {
  if (!agent) throw fail('Agent profile not found.', 404, 'not_found');
  if (agent.archived_at) throw conflict('Archived agent profiles cannot expose or restore instruction history.', 'agent_archived');
  if (!actor?.id) throw fail('Sign in to continue.', 401, 'sign_in_required');
  if (actor.mode === 'agent' || actor.type === 'agent') throw fail('Agents cannot read or restore human profile history.', 403, 'access_denied');
  if (!agent.workspace_id) {
    if (actor.id !== 'local-owner') throw fail('Shared agent profiles require installation owner authority.', 403, 'access_denied');
    return;
  }
  const scope = { scope_type: 'agent', scope_id: agent.id };
  if (typeof allowed !== 'function' || !allowed(agent.workspace_id, actor, 'agents.read', scope) || write && !allowed(agent.workspace_id, actor, 'agents.write', scope)) {
    throw fail('You no longer have access to this agent profile.', 403, 'access_denied');
  }
}

function refsReadable(db, agent, snapshot, actor, allowed, historical) {
  const workspaceId = agent.workspace_id || null;
  const sources = snapshot.context_source_ids;
  if (!workspaceId) return !snapshot.default_area_id && !snapshot.default_project_id && Array.isArray(sources) && sources.length === 0;
  if (!Array.isArray(sources) || sources.length > 200 || sources.some(id => typeof id !== 'string' || !id)) return false;
  if (snapshot.default_area_id && !agentProfileReferenceReadable(db, workspaceId, 'teams', snapshot.default_area_id, { actor, allowed, allowArchived: historical })) return false;
  if (snapshot.default_project_id && !agentProfileReferenceReadable(db, workspaceId, 'projects', snapshot.default_project_id, { actor, allowed, allowArchived: historical })) return false;
  return sources.every(id => agentProfileReferenceReadable(db, workspaceId, 'workspace_items', id, { actor, allowed, allowArchived: historical }));
}

function currentSnapshot(agent) {
  let sources;
  try { sources = JSON.parse(agent.context_source_ids_json || '[]'); } catch { return null; }
  return { default_area_id: agent.default_area_id, default_project_id: agent.default_project_id, context_source_ids: sources };
}

function assertCurrentReferences(db, agent, actor, allowed) {
  const snapshot = currentSnapshot(agent);
  if (!snapshot || !refsReadable(db, agent, snapshot, actor, allowed, false)) throw fail('The agent profile has references that are no longer accessible.', 403, 'source_access_unavailable');
}

function restorationForVersion(db, agentId, version) {
  return db.prepare('SELECT * FROM agent_profile_content_restores WHERE agent_id=? AND new_version=?').get(agentId, version);
}

function authorForVersion(db, agentId, version) {
  const restored = restorationForVersion(db, agentId, version);
  if (restored) return { author: { id: restored.restored_by, name: restored.restored_by_name, source: 'restore' }, provenance: 'recorded', restored };
  if (tableExists(db, 'change_log') && tableExists(db, 'change_attribution')) {
    const rows = db.prepare(`SELECT c.after_json,a.actor_id,a.actor_name FROM change_log c
      JOIN change_attribution a ON a.change_id=c.id
      WHERE c.entity_type='agents' AND c.entity_id=? AND c.after_json IS NOT NULL ORDER BY c.created_at DESC,c.rowid DESC`).all(agentId);
    for (const row of rows) {
      try {
        if (JSON.parse(row.after_json)?.version === version) return { author: { id: row.actor_id, name: row.actor_name, source: 'change' }, provenance: 'recorded', restored: null };
      } catch { /* legacy malformed audit is not attribution */ }
    }
  }
  return { author: null, provenance: 'legacy_unknown', restored: null };
}

function publicVersion(db, agent, row, actor, allowed) {
  try {
    const { snapshot, content } = decodedSnapshot(row);
    if (!refsReadable(db, agent, snapshot, actor, allowed, true)) return { version: row.version, created_at: row.created_at, restricted: true, reason: 'source_access_unavailable' };
    const attribution = authorForVersion(db, agent.id, row.version);
    return {
      version: row.version,
      created_at: row.created_at,
      source_sha256: sha256(JSON.stringify(content)),
      content,
      author: attribution.author,
      provenance: attribution.provenance,
      restored_from: attribution.restored ? {
        version: attribution.restored.source_version,
        source_sha256: attribution.restored.source_sha256,
        fields: JSON.parse(attribution.restored.fields_json),
      } : null,
    };
  } catch {
    return { version: row.version, created_at: row.created_at, restricted: true, reason: 'invalid_snapshot' };
  }
}

function safeAuditAgent(agent) {
  return Object.fromEntries(['id', 'workspace_id', 'name', 'version', ...AGENT_CONTENT_HISTORY_FIELDS].map(key => [key, agent[key] ?? null]));
}

function restorationResult(db, agent, restoration, actor, allowed) {
  const versionRow = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? AND version=?').get(agent.id, restoration.new_version);
  const restoredVersion = publicVersion(db, agent, versionRow, actor, allowed);
  if (restoredVersion.restricted) throw fail('The restored profile version is no longer readable.', 403, restoredVersion.reason);
  return {
    agent_id: agent.id,
    current_version: agent.version,
    restored_version: restoredVersion,
    restoration: {
      id: restoration.id,
      source_version: restoration.source_version,
      source_sha256: restoration.source_sha256,
      fields: JSON.parse(restoration.fields_json),
      restored_by: restoration.restored_by,
      restored_by_name: restoration.restored_by_name,
      created_at: restoration.created_at,
    },
  };
}

function replayResult(db, agent, receipt, fingerprint, actor, allowed) {
  if (receipt.fingerprint !== fingerprint) throw conflict('This request ID was already used for a different restoration.', 'idempotency_conflict');
  const restoration = db.prepare('SELECT * FROM agent_profile_content_restores WHERE id=?').get(receipt.restoration_id);
  if (!restoration) throw conflict('The recorded restoration receipt is incomplete.', 'invalid_snapshot');
  const source = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? AND version=?').get(agent.id, restoration.source_version);
  let decoded;
  try { decoded = decodedSnapshot(source); }
  catch { throw conflict('The selected source snapshot failed its integrity check.', 'invalid_snapshot'); }
  if (!refsReadable(db, agent, decoded.snapshot, actor, allowed, true)) throw fail('The source profile version is no longer accessible.', 403, 'source_access_unavailable');
  return { result: restorationResult(db, agent, restoration, actor, allowed), replayed: true };
}

export function installAgentProfileHistory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_profile_content_restores (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    new_version INTEGER NOT NULL,
    source_version INTEGER NOT NULL,
    source_sha256 TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    restored_by TEXT NOT NULL,
    restored_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(agent_id,new_version),
    FOREIGN KEY(agent_id,source_version) REFERENCES agent_profile_versions(agent_id,version) ON DELETE CASCADE,
    FOREIGN KEY(agent_id,new_version) REFERENCES agent_profile_versions(agent_id,version) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS agent_profile_history_requests (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    request_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    restoration_id TEXT NOT NULL REFERENCES agent_profile_content_restores(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(agent_id,actor_id,request_key)
  );
  CREATE INDEX IF NOT EXISTS agent_profile_restores_agent ON agent_profile_content_restores(agent_id,new_version DESC);
  CREATE TRIGGER IF NOT EXISTS agent_profile_versions_no_update
  BEFORE UPDATE ON agent_profile_versions BEGIN
    SELECT RAISE(ABORT,'agent profile snapshots are immutable');
  END;
  CREATE TRIGGER IF NOT EXISTS agent_profile_restores_no_update
  BEFORE UPDATE ON agent_profile_content_restores BEGIN
    SELECT RAISE(ABORT,'agent profile restoration records are immutable');
  END;`);
}

export function listAgentContentHistory({ db, agentId, url, actor, allowed }) {
  const agent = db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
  authorize(agent, actor, allowed, false);
  const current = currentSnapshot(agent);
  const currentReadable = Boolean(current && refsReadable(db, agent, current, actor, allowed, false));
  const keys = [...url.searchParams.keys()];
  if (keys.some(key => !['limit', 'before_version', 'version'].includes(key)) || keys.some(key => url.searchParams.getAll(key).length !== 1)) throw validationError('Choose one valid history query.');
  const exactRaw = url.searchParams.get('version');
  if (exactRaw !== null && (url.searchParams.has('limit') || url.searchParams.has('before_version'))) throw validationError('An exact version query cannot include pagination.');
  let rows;
  let next = null;
  if (exactRaw !== null) {
    const exact = parsePositive(exactRaw, 'Version');
    const row = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? AND version=?').get(agentId, exact);
    if (!row) throw fail('Agent profile version not found.', 404, 'not_found');
    rows = [row];
  } else {
    const limit = url.searchParams.has('limit') ? parsePositive(url.searchParams.get('limit'), 'Limit') : LIMIT_DEFAULT;
    if (limit > LIMIT_MAX) throw validationError(`Limit must be between 1 and ${LIMIT_MAX}.`);
    const before = url.searchParams.has('before_version') ? parsePositive(url.searchParams.get('before_version'), 'Before version') : Number.MAX_SAFE_INTEGER;
    rows = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? AND version<? ORDER BY version DESC LIMIT ?').all(agentId, before, limit + 1);
    if (rows.length > limit) { rows = rows.slice(0, limit); next = rows.at(-1).version; }
  }
  return {
    agent_id: agent.id,
    current_version: agent.version,
    versions: rows.map(row => currentReadable ? publicVersion(db, agent, row, actor, allowed) : {
      version: row.version, created_at: row.created_at, restricted: true, reason: 'source_access_unavailable',
    }),
    next_before_version: next,
  };
}

export function restoreAgentContent({ db, agentId, body, actor, allowed }) {
  strictObject(body, ['current_version', 'source_version', 'source_hash', 'fields', 'confirmed', 'request_id']);
  if (body.confirmed !== true) throw validationError('Confirm this restoration before saving it.');
  const currentVersion = bodyVersion(body.current_version, 'Current version');
  const sourceVersion = bodyVersion(body.source_version, 'Source version');
  if (typeof body.source_hash !== 'string' || !/^[a-f0-9]{64}$/.test(body.source_hash)) throw validationError('Choose an exact source snapshot hash.');
  if (!Array.isArray(body.fields) || !body.fields.length || body.fields.length > AGENT_CONTENT_HISTORY_FIELDS.length || new Set(body.fields).size !== body.fields.length || body.fields.some(field => !FIELD_SET.has(field))) throw validationError('Choose one or more restorable content fields.');
  if (typeof body.request_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(body.request_id)) throw validationError('Provide a stable restoration request ID.');
  const normalized = { current_version: currentVersion, source_version: sourceVersion, source_hash: body.source_hash, fields: [...body.fields].sort(), confirmed: true };
  const fingerprint = sha256(JSON.stringify(normalized));
  let agent = db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
  authorize(agent, actor, allowed, true);
  assertCurrentReferences(db, agent, actor, allowed);

  const replay = db.prepare('SELECT * FROM agent_profile_history_requests WHERE agent_id=? AND actor_id=? AND request_key=?').get(agentId, actor.id, body.request_id);
  if (replay) return replayResult(db, agent, replay, fingerprint, actor, allowed);

  db.exec('BEGIN IMMEDIATE');
  try {
    agent = db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
    authorize(agent, actor, allowed, true);
    assertCurrentReferences(db, agent, actor, allowed);
    const lockedReplay = db.prepare('SELECT * FROM agent_profile_history_requests WHERE agent_id=? AND actor_id=? AND request_key=?').get(agentId, actor.id, body.request_id);
    if (lockedReplay) {
      const response = replayResult(db, agent, lockedReplay, fingerprint, actor, allowed);
      db.exec('COMMIT');
      return response;
    }
    if (agent.version !== currentVersion) throw conflict('This agent profile changed. Reload its history before restoring.', 'stale_profile');
    const sourceRow = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? AND version=?').get(agentId, sourceVersion);
    if (!sourceRow) throw fail('Agent profile version not found.', 404, 'not_found');
    const decoded = decodedSnapshot(sourceRow);
    if (!refsReadable(db, agent, decoded.snapshot, actor, allowed, true)) throw fail('The source profile version is no longer accessible.', 403, 'source_access_unavailable');
    const sourceHash = sha256(JSON.stringify(decoded.content));
    if (sourceHash !== body.source_hash) throw conflict('The selected source snapshot changed. Reload its exact version.', 'stale_source');
    if (body.fields.every(field => agent[field] === decoded.content[field])) throw conflict('The selected fields already match this profile.', 'no_change');

    const candidate = { ...agent, context_source_ids_json: JSON.parse(agent.context_source_ids_json || '[]') };
    for (const field of body.fields) candidate[field] = decoded.content[field];
    validateAgentProfile(db, candidate, { actor, allowed });
    const stamp = now();
    const before = safeAuditAgent(agent);
    db.prepare(`UPDATE agents SET ${body.fields.map(field => `${field}=?`).join(',')},version=version+1,updated_at=? WHERE id=? AND version=?`)
      .run(...body.fields.map(field => decoded.content[field]), stamp, agentId, currentVersion);
    agent = db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
    const saved = snapshotAgentProfile(db, agentId, stamp);
    if (!saved || saved.version !== currentVersion + 1) throw new Error('Failed to record the restored profile snapshot.');
    const restoration = {
      id: uid('profile_restore'), agent_id: agentId, new_version: agent.version, source_version: sourceVersion,
      source_sha256: sourceHash, fields_json: JSON.stringify([...body.fields]), restored_by: actor.id,
      restored_by_name: actor.name || 'Installation owner', created_at: stamp,
    };
    db.prepare(`INSERT INTO agent_profile_content_restores
      (id,agent_id,new_version,source_version,source_sha256,fields_json,restored_by,restored_by_name,created_at)
      VALUES (@id,@agent_id,@new_version,@source_version,@source_sha256,@fields_json,@restored_by,@restored_by_name,@created_at)`).run(restoration);
    recordChange(db, 'agents', before, safeAuditAgent(agent), 'content_restored');
    db.prepare('INSERT INTO agent_profile_history_requests VALUES(?,?,?,?,?,?)').run(agentId, actor.id, body.request_id, fingerprint, restoration.id, stamp);
    db.exec('COMMIT');
    return { result: restorationResult(db, agent, restoration, actor, allowed) };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* no active transaction */ }
    if (error?.message === 'invalid_snapshot') throw conflict('The selected source snapshot failed its integrity check.', 'invalid_snapshot');
    throw error;
  }
}

export async function agentProfileHistoryRoute({ db, req, res, path, url, body, send, actor, allowed }) {
  const match = path.match(/^\/agents\/([^/]+)\/(content-history|restore-content)$/);
  if (!match) return false;
  let agentId;
  try { agentId = decodeURIComponent(match[1]); } catch { throw validationError('Choose a valid agent profile.'); }
  if (!agentId || agentId.includes('/')) throw validationError('Choose a valid agent profile.');
  if (match[2] === 'content-history' && req.method === 'GET') {
    send(res, 200, { result: listAgentContentHistory({ db, agentId, url, actor, allowed }) });
    return true;
  }
  if (match[2] === 'restore-content' && req.method === 'POST') {
    const response = restoreAgentContent({ db, agentId, body, actor, allowed });
    send(res, response.replayed ? 200 : 201, response);
    return true;
  }
  throw fail('Agent profile history action not found.', 404, 'not_found');
}

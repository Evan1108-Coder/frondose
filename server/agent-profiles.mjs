import { createHash } from 'node:crypto';
import { validationError, validateAvatar } from './validation.mjs';
import { EXECUTION_PROVIDERS, isBrowserAiProvider } from '../src/lib/ai-providers.js';
import { validApiModel } from '../src/lib/ai-provider-catalog.js';
import { getRunnerProvider } from '../src/lib/runner-provider-catalog.js';

export const AGENT_PROFILE_FIELDS = [
  'name', 'identity_kind', 'role', 'provider', 'provider_connection_id', 'description', 'instructions',
  'working_directory', 'model', 'reasoning_effort', 'memory_policy',
  'context_source_ids_json', 'default_area_id', 'default_project_id',
  'permission_policy', 'output_behavior', 'color', 'image_url',
];

const REASONING = new Set(['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const MEMORY = new Set(['reviewed', 'none']);
const PERMISSIONS = new Set(['review', 'read-only']);

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function addColumns(db, table, additions) {
  const existing = columns(db, table);
  for (const [name, definition] of Object.entries(additions)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function profileSnapshot(row) {
  return Object.fromEntries(AGENT_PROFILE_FIELDS.map((field) => {
    const value = row[field];
    if (field.endsWith('_json')) {
      try { return [field.slice(0, -5), JSON.parse(value || '[]')]; }
      catch { return [field.slice(0, -5), []]; }
    }
    return [field, value ?? null];
  }));
}

export function installAgentProfiles(db) {
  addColumns(db, 'agents', {
    identity_kind: "TEXT NOT NULL DEFAULT 'agent'",
    role: "TEXT NOT NULL DEFAULT ''",
    provider_connection_id: 'TEXT REFERENCES connections(id) ON DELETE SET NULL',
    reasoning_effort: "TEXT NOT NULL DEFAULT ''",
    memory_policy: "TEXT NOT NULL DEFAULT 'reviewed'",
    context_source_ids_json: "TEXT NOT NULL DEFAULT '[]'",
    default_area_id: 'TEXT REFERENCES teams(id) ON DELETE SET NULL',
    default_project_id: 'TEXT REFERENCES projects(id) ON DELETE SET NULL',
    permission_policy: "TEXT NOT NULL DEFAULT 'review'",
    output_behavior: "TEXT NOT NULL DEFAULT ''",
    version: 'INTEGER NOT NULL DEFAULT 1',
    image_url: 'TEXT',
  });
  addColumns(db, 'runs', { agent_profile_version: 'INTEGER' });
  db.exec(`CREATE TABLE IF NOT EXISTS agent_profile_versions (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(agent_id, version)
  );
  CREATE INDEX IF NOT EXISTS agent_profile_versions_agent ON agent_profile_versions(agent_id, version DESC);`);
  db.prepare(`UPDATE agents SET provider_connection_id=(
    SELECT id FROM connections WHERE connections.provider=agents.provider
  ) WHERE provider_connection_id IS NULL AND provider IN ('codex','claude')
    AND NOT EXISTS (SELECT 1 FROM agent_profile_versions WHERE agent_id=agents.id)`).run();
  for (const agent of db.prepare('SELECT * FROM agents').all()) snapshotAgentProfile(db, agent.id, agent.created_at || agent.updated_at);
}

// Shared by input validation and response redaction. Saved references never
// authorize access; nested Context Pack sources must be readable independently.
export function agentProfileReferenceReadable(db, workspaceId, table, id, { actor, allowed, allowArchived = false } = {}) {
  if (!['teams', 'projects', 'workspace_items', 'documents', 'memory_notes'].includes(table) || typeof id !== 'string' || !id) return false;
  const source = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!source || source.workspace_id !== workspaceId || !allowArchived && source.archived_at) return false;
  const at = table === 'teams' ? { scope_type: 'team', scope_id: id } : table === 'projects' ? { scope_type: 'project', scope_id: id } : source.project_id ? { scope_type: 'project', scope_id: source.project_id } : source.team_id ? { scope_type: 'team', scope_id: source.team_id } : {};
  const permission = table === 'projects' ? 'projects.read' : ['documents', 'memory_notes'].includes(table) ? 'documents.read' : 'workspace.read';
  if (actor && typeof allowed !== 'function' || allowed && !allowed(workspaceId, actor, permission, at)) return false;
  if (table !== 'workspace_items') return true;
  if (source.kind !== 'context_pack') return false;
  let payload;
  try { payload = JSON.parse(source.payload_json || '{}'); } catch { return false; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return [['document_ids', 'documents'], ['memory_ids', 'memory_notes']].every(([field, target]) => {
    const refs = payload[field] ?? [];
    return Array.isArray(refs) && refs.length <= 200 && refs.every(ref => agentProfileReferenceReadable(db, workspaceId, target, ref, { actor, allowed, allowArchived }));
  });
}

export function validateAgentProfile(db, record, { actor, allowed, importing = false } = {}) {
  record.identity_kind ??= 'agent';
  if (!['agent', 'provider'].includes(record.identity_kind)) throw validationError('Choose a personalized agent or an AI provider identity.');
  if (record.image_url && (typeof record.image_url !== 'string' || !record.image_url.startsWith('data:'))) throw validationError('Upload a PNG, JPEG or WebP agent picture. External image URLs are not supported.');
  validateAvatar(record.image_url ?? null);
  for (const [field, value] of Object.entries({ role: '', model: '', reasoning_effort: '', memory_policy: 'reviewed', context_source_ids_json: [], default_area_id: null, default_project_id: null, permission_policy: 'review', output_behavior: '' })) if (record[field] === undefined) record[field] = value;
  for (const [field, limit] of [['role', 200], ['model', 120], ['reasoning_effort', 20], ['output_behavior', 10_000]]) {
    const value = record[field] ?? '';
    const controls = field === 'output_behavior' ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/ : /[\u0000-\u001f]/;
    if (typeof value !== 'string' || value.length > limit || controls.test(value)) throw validationError(`Choose a valid ${field.replaceAll('_', ' ')}.`);
  }
  if (record.model && !validApiModel(record.model)) throw validationError('Use a valid provider model identifier, or leave model blank to use the connection default.');
  if (!REASONING.has(record.reasoning_effort || '')) throw validationError('Choose a supported reasoning effort, or use the provider default.');
  if (record.provider !== 'codex' && record.reasoning_effort) throw validationError('Reasoning effort is currently configurable only for Codex profiles.');
  if (!MEMORY.has(record.memory_policy || 'reviewed')) throw validationError('Choose reviewed memory or no saved memory.');
  if (!PERMISSIONS.has(record.permission_policy || 'review')) throw validationError('Choose review required or read-only as the profile permission policy.');
  if (!Array.isArray(record.context_source_ids_json) || record.context_source_ids_json.length > 200 || record.context_source_ids_json.some((value) => typeof value !== 'string' || !value || value.length > 200)) throw validationError('Context sources must be a list of stable IDs.');

  if (record.provider_connection_id) {
    const connection = db.prepare('SELECT id,provider FROM connections WHERE id=?').get(record.provider_connection_id);
    if (!connection) throw validationError('The selected provider connection no longer exists.');
    if (connection.provider !== record.provider) throw validationError('The provider connection must match the agent provider.');
  } else if (!importing && record.provider_connection_id === undefined && EXECUTION_PROVIDERS.includes(record.provider) && (!getRunnerProvider(record.provider) || isBrowserAiProvider(record.provider) || ['codex', 'claude', 'copilot'].includes(record.provider))) {
    const connection = db.prepare('SELECT id FROM connections WHERE provider=?').get(record.provider);
    if (!connection) throw validationError('Create the provider connection before saving this agent.');
    record.provider_connection_id = connection.id;
  }
  record.provider_connection_id ??= null;

  const workspaceId = record.workspace_id || null;
  if (!workspaceId && (record.default_area_id || record.default_project_id || record.context_source_ids_json.length)) throw validationError('Shared profiles cannot keep workspace-specific defaults. Create the profile inside a workspace first.');
  if (record.default_area_id) {
    if (!agentProfileReferenceReadable(db, workspaceId, 'teams', record.default_area_id, { actor, allowed, allowArchived: importing })) throw validationError('Choose an accessible Area from the agent workspace.');
  }
  if (record.default_project_id) {
    const project = db.prepare('SELECT workspace_id,team_id FROM projects WHERE id=?').get(record.default_project_id);
    if (!project || !agentProfileReferenceReadable(db, workspaceId, 'projects', record.default_project_id, { actor, allowed, allowArchived: importing })) throw validationError('Choose an accessible project from the agent workspace.');
    if (record.default_area_id && project.team_id !== record.default_area_id) throw validationError('The default project must belong to the selected Area.');
  }
  for (const sourceId of new Set(record.context_source_ids_json)) {
    if (!agentProfileReferenceReadable(db, workspaceId, 'workspace_items', sourceId, { actor, allowed, allowArchived: importing })) throw validationError('Every Context Pack and its sources must be accessible in the agent workspace.');
  }
  record.context_source_ids_json = [...new Set(record.context_source_ids_json)];
  return record;
}

export function snapshotAgentProfile(db, agentId, createdAt = new Date().toISOString()) {
  const row = db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
  if (!row) return null;
  const version = Number(row.version) || 1;
  const existing = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? AND version=?').get(agentId, version);
  // Never describe today's mutable row as an already-persisted historical
  // version. All profile mutations must explicitly bump their version first.
  if (existing) return { agent_id: agentId, version, snapshot: JSON.parse(existing.snapshot_json), snapshot_hash: existing.snapshot_hash, created_at: existing.created_at };
  const snapshot = profileSnapshot(row);
  const json = JSON.stringify(snapshot);
  const hash = createHash('sha256').update(json).digest('hex');
  db.prepare('INSERT OR IGNORE INTO agent_profile_versions(agent_id,version,snapshot_json,snapshot_hash,created_at) VALUES(?,?,?,?,?)')
    .run(row.id, version, json, hash, createdAt);
  return { agent_id: row.id, version, snapshot, snapshot_hash: hash, created_at: createdAt };
}

export function bumpAgentProfileVersion(db, agentId, changedFields, stamp) {
  if (!changedFields.some((field) => AGENT_PROFILE_FIELDS.includes(field))) return null;
  db.prepare('UPDATE agents SET version=version+1,updated_at=? WHERE id=?').run(stamp, agentId);
  return snapshotAgentProfile(db, agentId, stamp);
}

export function agentProfileSnapshot(db, workspaceId) {
  const rows = workspaceId
    ? db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id IN (SELECT id FROM agents WHERE workspace_id IS NULL OR workspace_id=?) ORDER BY agent_id,version DESC').all(workspaceId)
    : db.prepare('SELECT * FROM agent_profile_versions ORDER BY agent_id,version DESC').all();
  return rows.map((row) => ({ ...row, snapshot: JSON.parse(row.snapshot_json) }));
}

import { randomUUID } from 'node:crypto';

const TTL_MS = 10 * 60 * 1000;
const MANIFEST_BYTES = 1024 * 1024;
const INSPECTION_BYTES = 2 * 1024 * 1024;
const fail = (message, code = 'invalid_run_context', statusCode = 400) => {
  throw Object.assign(new Error(message), { code, errorCode: code, statusCode });
};
const identifier = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label} must be a stable ID.`);
  return value;
};
const object = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Inputs are normalized JSON, not arbitrary objects with getters/toJSON hooks.
// Sort object keys for deterministic equality while retaining array order.
function canonicalJSON(value, label, maxBytes) {
  let nodes = 0;
  const encode = (item, depth) => {
    if (++nodes > 100000 || depth > 64) fail(`${label} is too complex.`);
    if (item === null || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'string') {
      if (item.length > maxBytes) fail(`${label} exceeds its storage limit.`);
      return JSON.stringify(item);
    }
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (!object(item) && !Array.isArray(item)) fail(`${label} must contain only normalized JSON values.`);
    if (Object.getOwnPropertySymbols(item).length) fail(`${label} cannot contain symbol keys.`);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Object.values(descriptors).some(value => value.get || value.set)) fail(`${label} cannot contain accessors.`);
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length || Object.keys(item).some((key, index) => key !== String(index))) fail(`${label} cannot contain sparse or decorated arrays.`);
      return `[${item.map(child => encode(child, depth + 1)).join(',')}]`;
    }
    if (Object.values(descriptors).some(value => !value.enumerable)) fail(`${label} cannot contain hidden properties.`);
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode(item[key], depth + 1)}`).join(',')}}`;
  };
  const json = encode(value, 0);
  if (Buffer.byteLength(json, 'utf8') > maxBytes) fail(`${label} exceeds its storage limit.`);
  return json;
}

function inspectionJSON(inspection, workspaceId) {
  const json = canonicalJSON(inspection, 'Context inspection', INSPECTION_BYTES);
  inspection = JSON.parse(json);
  if (!object(inspection) || typeof inspection.finalPrompt !== 'string' || inspection.finalPrompt.length > 100000 || !object(inspection.manifest)) fail('Choose a context inspection with a prompt of at most 100,000 characters and a manifest.');
  const scope = identifier(inspection.manifest.resolved?.workspace_id, 'Manifest workspace');
  if (workspaceId && scope !== workspaceId) fail('The inspection belongs to a different workspace.');
  if (typeof inspection.manifest.fingerprint !== 'string' || !inspection.manifest.fingerprint || inspection.manifest.fingerprint.length > 200) fail('The inspection needs a stable manifest fingerprint.');
  for (const field of ['runtimeProtocol', 'actionNonce']) if (inspection[field] !== undefined && (typeof inspection[field] !== 'string' || inspection[field].length > 100000)) fail('Runtime context fields must be bounded text.');
  canonicalJSON(inspection.manifest, 'Context manifest', MANIFEST_BYTES);
  return json;
}

function transaction(db, operation) {
  const point = `context_${randomUUID().replaceAll('-', '')}`;
  db.exec(`SAVEPOINT ${point}`);
  try { const result = operation(); db.exec(`RELEASE ${point}`); return result; }
  catch (error) { db.exec(`ROLLBACK TO ${point}`); db.exec(`RELEASE ${point}`); throw error; }
}

function decodePreview(row) {
  return { id: row.id, actor_id: row.actor_id, workspace_id: row.workspace_id, input: JSON.parse(row.input_json), inspection: JSON.parse(row.inspection_json), created_at: new Date(row.created_at).toISOString(), expires_at: new Date(row.expires_at).toISOString(), consumed_run_id: row.consumed_run_id };
}
function decodeRun(row) {
  return row ? { run_id: row.run_id, workspace_id: row.workspace_id, inspection: JSON.parse(row.inspection_json), created_at: new Date(row.created_at).toISOString() } : null;
}

/** Internal persistence only. API callers must recheck context ACLs immediately
 * before launch and authorize access to run snapshots before reading them.
 * Runtime protocols/nonces are private internal data, not a public preview body.
 * No foreign keys to application tables: preview consumption/capture may be in
 * the same outer transaction that creates the run. The caller owns that lifecycle.
 */
export function installRunContextStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS run_context_inspections (
    id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    input_json TEXT NOT NULL, inspection_json TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    consumed_run_id TEXT,
    CHECK(expires_at > created_at AND expires_at-created_at <= ${TTL_MS})
  );
  CREATE INDEX IF NOT EXISTS run_context_inspections_owner ON run_context_inspections(actor_id,workspace_id,expires_at);
  CREATE UNIQUE INDEX IF NOT EXISTS run_context_inspections_run ON run_context_inspections(consumed_run_id) WHERE consumed_run_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS run_context_snapshots (
    run_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
    inspection_json TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS run_context_inspection_immutable BEFORE UPDATE OF id,actor_id,workspace_id,input_json,inspection_json,created_at,expires_at ON run_context_inspections
    BEGIN SELECT RAISE(ABORT,'Context inspections are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS run_context_inspection_once BEFORE UPDATE OF consumed_run_id ON run_context_inspections
    WHEN OLD.consumed_run_id IS NOT NULL AND NEW.consumed_run_id IS NOT OLD.consumed_run_id
    BEGIN SELECT RAISE(ABORT,'Context inspection was already consumed'); END;
  CREATE TRIGGER IF NOT EXISTS run_context_snapshot_immutable BEFORE UPDATE ON run_context_snapshots
    BEGIN SELECT RAISE(ABORT,'Run context snapshots are immutable'); END;`);
}

export function saveInspection(db, { actorId, workspaceId, input, inspection } = {}) {
  identifier(actorId, 'Actor'); identifier(workspaceId, 'Workspace');
  if (!object(input)) fail('Inspection input must be a normalized object.');
  const inputJSON = canonicalJSON(input, 'Inspection input', MANIFEST_BYTES);
  const normalizedInput = JSON.parse(inputJSON);
  for (const key of ['workspace_id', 'workspaceId']) if (normalizedInput[key] !== undefined && normalizedInput[key] !== workspaceId) fail('Inspection input belongs to a different workspace.');
  const savedJSON = inspectionJSON(inspection, workspaceId);
  const id = `inspection_${randomUUID()}`, created = Date.now();
  db.prepare('INSERT INTO run_context_inspections(id,actor_id,workspace_id,input_json,inspection_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(id, actorId, workspaceId, inputJSON, savedJSON, created, created + TTL_MS);
  return decodePreview(db.prepare('SELECT * FROM run_context_inspections WHERE id=?').get(id));
}

export function getInspection(db, id, { actorId, workspaceId } = {}) {
  identifier(id, 'Inspection'); identifier(actorId, 'Actor'); identifier(workspaceId, 'Workspace');
  const row = db.prepare('SELECT * FROM run_context_inspections WHERE id=? AND actor_id=? AND workspace_id=?').get(id, actorId, workspaceId);
  if (!row) fail('This context inspection is unavailable.', 'context_inspection_unavailable', 403);
  if (row.expires_at <= Date.now()) fail('This context inspection expired. Review the context again.', 'context_inspection_expired', 409);
  return decodePreview(row);
}

export function consumeInspection(db, id, runId) {
  identifier(id, 'Inspection'); identifier(runId, 'Run');
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM run_context_inspections WHERE id=?').get(id);
    if (!row) fail('This context inspection is unavailable.', 'context_inspection_unavailable', 403);
    if (row.consumed_run_id === runId) return decodePreview(row);
    if (row.consumed_run_id) fail('This context inspection was used by a different run.', 'context_inspection_consumed', 409);
    if (row.expires_at <= Date.now()) fail('This context inspection expired. Review the context again.', 'context_inspection_expired', 409);
    if (db.prepare('SELECT 1 FROM run_context_inspections WHERE consumed_run_id=?').get(runId)) fail('This run already consumed another inspection.', 'run_context_conflict', 409);
    const captured = db.prepare('SELECT workspace_id,inspection_json FROM run_context_snapshots WHERE run_id=?').get(runId);
    if (captured && (captured.workspace_id !== row.workspace_id || captured.inspection_json !== row.inspection_json)) fail('This run already captured a different context.', 'run_context_conflict', 409);
    db.prepare('UPDATE run_context_inspections SET consumed_run_id=? WHERE id=? AND consumed_run_id IS NULL').run(runId, id);
    return decodePreview(db.prepare('SELECT * FROM run_context_inspections WHERE id=?').get(id));
  });
}

export function captureRunContext(db, runId, inspection) {
  identifier(runId, 'Run');
  const savedJSON = inspectionJSON(inspection);
  const workspaceId = JSON.parse(savedJSON).manifest.resolved.workspace_id;
  return transaction(db, () => {
    const existing = db.prepare('SELECT * FROM run_context_snapshots WHERE run_id=?').get(runId);
    if (existing) {
      if (existing.inspection_json !== savedJSON) fail('This run already has a different immutable context snapshot.', 'run_context_conflict', 409);
      return decodeRun(existing);
    }
    const consumed = db.prepare('SELECT workspace_id,inspection_json FROM run_context_inspections WHERE consumed_run_id=?').get(runId);
    if (consumed && (consumed.workspace_id !== workspaceId || consumed.inspection_json !== savedJSON)) fail('The run context differs from its consumed inspection.', 'run_context_conflict', 409);
    db.prepare('INSERT INTO run_context_snapshots(run_id,workspace_id,inspection_json,created_at) VALUES(?,?,?,?)').run(runId, workspaceId, savedJSON, Date.now());
    return decodeRun(db.prepare('SELECT * FROM run_context_snapshots WHERE run_id=?').get(runId));
  });
}

export function readRunContext(db, runId) {
  identifier(runId, 'Run');
  return decodeRun(db.prepare('SELECT * FROM run_context_snapshots WHERE run_id=?').get(runId));
}

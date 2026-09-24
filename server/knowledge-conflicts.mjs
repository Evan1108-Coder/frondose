import { createHash, randomUUID } from 'node:crypto';
import { captureSourceAccess, assertSourceAccess } from './context-source-access.mjs';
import { recordChange } from './workspace-features.mjs';

const stamp = () => new Date().toISOString();
const id = prefix => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const fail = (message, errorCode = 'invalid_knowledge_conflict', statusCode = 400) => { throw Object.assign(new Error(message), { errorCode, code: errorCode, statusCode }); };
const identifier = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,240}$/.test(value)) fail('Choose a valid record or request ID.'); return value; };
const text = (value, label) => { if (typeof value !== 'string' || !value.trim() || value.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${label} must be nonempty text under 5,000 characters.`); return value.trim(); };
const fields = (body, names) => { if (!object(body) || Object.keys(body).some(key => !names.includes(key))) fail('Request contains unsupported fields.'); };
const human = actor => { if (!actor?.id || actor.mode === 'agent' || actor.type === 'agent') fail('A human reviewer is required.', 'access_denied', 403); };
const actorName = actor => actor.name || (actor.id === 'local-owner' ? 'Installation owner' : 'Unknown name');
const scope = row => row.project_id ? { scope_type: 'project', scope_id: row.project_id } : {};
const parse = json => { try { return JSON.parse(json); } catch { fail('Conflict provenance is unavailable.', 'conflict_unavailable', 403); } };
const version = value => { if (!Number.isSafeInteger(value) || value < 1) fail('Choose the exact saved knowledge version.'); return value; };

export function installKnowledgeConflicts(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS knowledge_conflicts (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    left_id TEXT NOT NULL, right_id TEXT NOT NULL,
    left_snapshot_json TEXT NOT NULL, right_snapshot_json TEXT NOT NULL,
    left_snapshot_hash TEXT NOT NULL, right_snapshot_hash TEXT NOT NULL,
    source_access_json TEXT NOT NULL, reason TEXT NOT NULL,
    reported_by TEXT NOT NULL, reported_by_name TEXT NOT NULL, created_at TEXT NOT NULL,
    CHECK(left_id<>right_id));
  CREATE INDEX IF NOT EXISTS knowledge_conflicts_workspace ON knowledge_conflicts(workspace_id,created_at DESC,id DESC);
  CREATE TABLE IF NOT EXISTS knowledge_conflict_decisions (
    id TEXT PRIMARY KEY, conflict_id TEXT NOT NULL UNIQUE REFERENCES knowledge_conflicts(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK(decision IN ('keep_both','supersede_left','supersede_right')),
    rationale TEXT NOT NULL, reviewed_by TEXT NOT NULL, reviewed_by_name TEXT NOT NULL,
    left_after_hash TEXT NOT NULL, right_after_hash TEXT NOT NULL,
    left_after_version INTEGER NOT NULL, right_after_version INTEGER NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS knowledge_conflict_requests (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL, request_key TEXT NOT NULL, operation TEXT NOT NULL,
    fingerprint TEXT NOT NULL, conflict_id TEXT NOT NULL REFERENCES knowledge_conflicts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,actor_id,request_key));
  CREATE TRIGGER IF NOT EXISTS knowledge_conflicts_immutable BEFORE UPDATE ON knowledge_conflicts
    BEGIN SELECT RAISE(ABORT,'Knowledge conflict reports are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS knowledge_conflict_decisions_immutable BEFORE UPDATE ON knowledge_conflict_decisions
    BEGIN SELECT RAISE(ABORT,'Knowledge conflict decisions are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS knowledge_conflict_requests_immutable BEFORE UPDATE ON knowledge_conflict_requests
    BEGIN SELECT RAISE(ABORT,'Knowledge conflict receipts are immutable'); END;`);
}

function transaction(db, action) {
  const point = `conflict_${randomUUID().replaceAll('-', '')}`;
  db.exec(`SAVEPOINT ${point}`);
  try { const result = action(); db.exec(`RELEASE ${point}`); return result; }
  catch (error) { db.exec(`ROLLBACK TO ${point}`); db.exec(`RELEASE ${point}`); throw error; }
}
function workspace(db, workspaceId, actor, allowed) {
  human(actor); identifier(workspaceId);
  const row = db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspaceId);
  if (typeof allowed !== 'function' || allowed(workspaceId, actor, 'workspace.read', {}) !== true || !row || row.archived_at) fail('Workspace unavailable.', 'access_denied', 403);
}
function authorize(row, workspaceId, actor, allowed, write = false) {
  if (!row || row.workspace_id !== workspaceId || row.archived_at || allowed(workspaceId, actor, 'documents.read', scope(row)) !== true || write && allowed(workspaceId, actor, 'documents.write', scope(row)) !== true) fail('Knowledge unavailable.', 'access_denied', 403);
}
function snapshot(row) {
  return { id: row.id, workspace_id: row.workspace_id, project_id: row.project_id || null, title: row.title, kind: row.kind, content: row.content, source: row.source, state: row.state, version: row.version, content_hash: hash(row.content) };
}
function brief(row) { return { id: row.id, title: row.title, version: row.version, kind: row.kind, project_id: row.project_id }; }
function capture(db, workspaceId, leftId, rightId) {
  const manifest = { resolved: { workspace_id: workspaceId }, included: [{ kind: 'knowledge_entries', id: leftId }, { kind: 'knowledge_entries', id: rightId }], excluded: [] };
  return { manifest, sourceAccess: captureSourceAccess(db, { manifest }) };
}
function permitPair(db, row, actor, allowed, write = false) {
  workspace(db, row.workspace_id, actor, allowed);
  const left = db.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(row.left_id), right = db.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(row.right_id);
  authorize(left, row.workspace_id, actor, allowed, write); authorize(right, row.workspace_id, actor, allowed, write);
  const inspection = { manifest: { resolved: { workspace_id: row.workspace_id } }, sourceAccess: parse(row.source_access_json) };
  assertSourceAccess(db, inspection, actor, allowed);
  if (write) for (const ref of inspection.sourceAccess.sources) if (ref.permission === 'documents.read' && allowed(row.workspace_id, actor, 'documents.write', ref.scope) !== true) fail('Historical knowledge scope no longer permits changes.', 'access_denied', 403);
  return { left, right };
}
function record(db, conflictId) {
  const row = db.prepare('SELECT * FROM knowledge_conflicts WHERE id=?').get(identifier(conflictId));
  if (!row) fail('Conflict not found.', 'not_found', 404);
  return row;
}
function detail(db, row, actor, allowed, write = false) {
  const current = permitPair(db, row, actor, allowed, write);
  const left = parse(row.left_snapshot_json), right = parse(row.right_snapshot_json);
  if (hash(left) !== row.left_snapshot_hash || hash(right) !== row.right_snapshot_hash || left.id !== row.left_id || right.id !== row.right_id) fail('Conflict snapshot is unavailable.', 'conflict_unavailable', 403);
  const decided = db.prepare('SELECT * FROM knowledge_conflict_decisions WHERE conflict_id=?').get(row.id);
  const freshness = hash(snapshot(current.left)) === (decided?.left_after_hash || row.left_snapshot_hash) && hash(snapshot(current.right)) === (decided?.right_after_hash || row.right_snapshot_hash) ? 'current' : 'stale';
  const decision = decided ? { id: decided.id, decision: decided.decision, rationale: decided.rationale, reviewed_by: { id: decided.reviewed_by, name: decided.reviewed_by_name }, created_at: decided.created_at, left_after_version: decided.left_after_version, right_after_version: decided.right_after_version } : null;
  return { conflict: { id: row.id, workspace_id: row.workspace_id, status: decided ? 'resolved' : 'open', freshness, reason: row.reason, version: 1, created_at: row.created_at, reported_by: { id: row.reported_by, name: row.reported_by_name }, left: brief(left), right: brief(right), resolved_at: decided?.created_at || null, decision: decided?.decision || null }, left, right, decision };
}
function receipt(db, workspaceId, actor, operation, body) {
  const key = identifier(body.request_id), fingerprint = hash({ ...body, request_id: undefined, operation });
  const old = db.prepare('SELECT * FROM knowledge_conflict_requests WHERE workspace_id=? AND actor_id=? AND request_key=?').get(workspaceId, actor.id, key);
  if (old && (old.operation !== operation || old.fingerprint !== fingerprint)) fail('Request ID already used for different input.', 'idempotency_conflict', 409);
  return { key, fingerprint, old };
}
function saveReceipt(db, workspaceId, actor, operation, request, conflictId) {
  db.prepare('INSERT INTO knowledge_conflict_requests VALUES(?,?,?,?,?,?,?)').run(workspaceId, actor.id, request.key, operation, request.fingerprint, conflictId, stamp());
}
function reportConflict(db, body, actor, allowed) {
  fields(body, ['workspace_id', 'left_id', 'left_version', 'right_id', 'right_version', 'reason', 'request_id']);
  workspace(db, body.workspace_id, actor, allowed);
  identifier(body.left_id); identifier(body.right_id); version(body.left_version); version(body.right_version);
  if (body.left_id === body.right_id) fail('Choose two different knowledge entries.');
  const reason = text(body.reason, 'Reason');
  return transaction(db, () => {
    const request = receipt(db, body.workspace_id, actor, 'report', body);
    if (request.old) return { result: detail(db, record(db, request.old.conflict_id), actor, allowed, true), replayed: true };
    const left = db.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(body.left_id), right = db.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(body.right_id);
    authorize(left, body.workspace_id, actor, allowed, true); authorize(right, body.workspace_id, actor, allowed, true);
    if (left.version !== body.left_version || right.version !== body.right_version || left.state !== 'approved' || right.state !== 'approved') fail('Knowledge changed. Choose current approved entries and review again.', 'stale_knowledge', 409);
    const inspection = capture(db, body.workspace_id, left.id, right.id); assertSourceAccess(db, inspection, actor, allowed);
    const leftSnapshot = snapshot(left), rightSnapshot = snapshot(right);
    const row = { id: id('kconflict'), workspace_id: body.workspace_id, left_id: left.id, right_id: right.id, left_snapshot_json: JSON.stringify(leftSnapshot), right_snapshot_json: JSON.stringify(rightSnapshot), left_snapshot_hash: hash(leftSnapshot), right_snapshot_hash: hash(rightSnapshot), source_access_json: JSON.stringify(inspection.sourceAccess), reason, reported_by: actor.id, reported_by_name: actorName(actor), created_at: stamp() };
    db.prepare('INSERT INTO knowledge_conflicts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row));
    saveReceipt(db, body.workspace_id, actor, 'report', request, row.id);
    return { result: detail(db, row, actor, allowed), replayed: false };
  });
}
function decideConflict(db, conflictId, body, actor, allowed) {
  fields(body, ['decision', 'rationale', 'confirmed', 'request_id']);
  if (body.confirmed !== true || !['keep_both', 'supersede_left', 'supersede_right'].includes(body.decision)) fail('Confirm a supported conflict decision.');
  const rationale = text(body.rationale, 'Rationale'); human(actor);
  return transaction(db, () => {
    const row = record(db, conflictId), before = detail(db, row, actor, allowed, true), request = receipt(db, row.workspace_id, actor, `decision:${row.id}`, body);
    if (request.old) return { result: before, replayed: true };
    if (before.conflict.status !== 'open') fail('This conflict already has a recorded decision.', 'already_resolved', 409);
    if (before.conflict.freshness !== 'current') fail('Knowledge changed. Report and review the current versions.', 'stale_knowledge', 409);
    if (body.decision !== 'keep_both') {
      const targetId = body.decision === 'supersede_left' ? row.left_id : row.right_id;
      const old = db.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(targetId);
      const changed = db.prepare("UPDATE knowledge_entries SET state='superseded',version=version+1,updated_at=? WHERE id=? AND version=? AND state='approved' AND archived_at IS NULL").run(stamp(), targetId, old.version);
      if (changed.changes !== 1) fail('Knowledge changed. Review again.', 'stale_knowledge', 409);
      recordChange(db, 'knowledge_entries', old, db.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(targetId), 'superseded after human conflict review');
    }
    const leftAfter = snapshot(db.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(row.left_id)), rightAfter = snapshot(db.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(row.right_id));
    db.prepare('INSERT INTO knowledge_conflict_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id('kdecision'), row.id, row.workspace_id, body.decision, rationale, actor.id, actorName(actor), hash(leftAfter), hash(rightAfter), leftAfter.version, rightAfter.version, stamp());
    saveReceipt(db, row.workspace_id, actor, `decision:${row.id}`, request, row.id);
    return { result: detail(db, row, actor, allowed), replayed: false };
  });
}

function readableRows(db, workspaceId, actor, allowed, { status = 'all', limit = 50, included = null } = {}) {
  workspace(db, workspaceId, actor, allowed);
  const result = []; let cursor = null;
  while (result.length <= limit) {
    const rows = db.prepare(`SELECT c.* FROM knowledge_conflicts c WHERE c.workspace_id=?
      AND (?='all' OR (?='resolved')=EXISTS(SELECT 1 FROM knowledge_conflict_decisions d WHERE d.conflict_id=c.id))
      AND (? IS NULL OR c.created_at<? OR (c.created_at=? AND c.id<?)) ORDER BY c.created_at DESC,c.id DESC LIMIT 100`).all(workspaceId, status, status, cursor?.created_at || null, cursor?.created_at || null, cursor?.created_at || null, cursor?.id || '');
    if (!rows.length) break;
    for (const row of rows) {
      if (included && (!included.has(row.left_id) || !included.has(row.right_id))) continue;
      try { result.push(detail(db, row, actor, allowed)); } catch (error) { if (error.statusCode !== 403) throw error; }
      if (result.length > limit) break;
    }
    cursor = rows.at(-1); if (rows.length < 100) break;
  }
  return { rows: result.slice(0, limit), has_more: result.length > limit };
}
const normalize = value => String(value).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
function candidates(db, workspaceId, actor, allowed, filter) {
  workspace(db, workspaceId, actor, allowed);
  const eligible = []; let cursor = null;
  while (eligible.length <= 500) {
    const rows = db.prepare(`SELECT * FROM knowledge_entries WHERE workspace_id=? AND archived_at IS NULL AND state='approved'
      AND (? IS NULL OR updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC,id DESC LIMIT 100`).all(workspaceId, cursor?.updated_at || null, cursor?.updated_at || null, cursor?.updated_at || null, cursor?.id || '');
    if (!rows.length) break;
    for (const row of rows) {
      try {
        authorize(row, workspaceId, actor, allowed);
        const manifest = { resolved: { workspace_id: workspaceId }, included: [{ kind: 'knowledge_entries', id: row.id }], excluded: [] };
        assertSourceAccess(db, { manifest, sourceAccess: captureSourceAccess(db, { manifest }) }, actor, allowed);
        if (typeof filter === 'function' && !(filter({ knowledge_entries: [row] })?.knowledge_entries || []).some(item => item.id === row.id)) continue;
        eligible.push(row);
      } catch (error) { if (error.statusCode !== 403) throw error; }
      if (eligible.length > 500) break;
    }
    cursor = rows.at(-1); if (rows.length < 100) break;
  }
  const scanTruncated = eligible.length > 500; eligible.length = Math.min(eligible.length, 500);
  const pairs = [], groups = new Map();
  for (const row of eligible) {
    const key = JSON.stringify([row.project_id || null, row.kind, normalize(row.title)]), prior = groups.get(key) || [];
    for (const other of prior) if (row.content !== other.content) {
      pairs.push({ left: brief(other), right: brief(row), label: 'Same title, different content — possible conflict, not verified contradiction' });
      if (pairs.length > 50) break;
    }
    if (pairs.length > 50) break;
    prior.push(row); groups.set(key, prior);
  }
  return { candidates: pairs.slice(0, 50), scanned_count: eligible.length, scan_limit: 500, pair_limit: 50, scan_truncated: scanTruncated, pairs_truncated: pairs.length > 50 };
}

export function getKnowledgeConflictWarnings(db, inspection, actor, allowed) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='knowledge_conflicts'").get()) return [];
  const workspaceId = inspection?.manifest?.resolved?.workspace_id;
  const included = new Set((inspection?.manifest?.included || []).filter(item => ['knowledge_entries', 'knowledge'].includes(item.kind)).map(item => item.id));
  if (!workspaceId || included.size < 2) return [];
  return readableRows(db, workspaceId, actor, allowed, { status: 'open', included }).rows.map(item => ({ id: item.conflict.id, code: 'possible_knowledge_conflict', left_id: item.left.id, right_id: item.right.id, freshness: item.conflict.freshness }));
}

export async function knowledgeConflictRoute({ db, req, res, path, url, body = {}, send, actor, allowed, filter }) {
  const match = path.match(/^\/knowledge-conflicts(?:\/([^/]+))?(?:\/(decision))?$/); if (!match) return false;
  const [, rawId, action] = match;
  if (req.method === 'GET' && !action) {
    for (const key of url.searchParams.keys()) if (!['workspace_id', 'status'].includes(key) || url.searchParams.getAll(key).length !== 1) fail('Choose supported conflict filters.');
    if (rawId === 'candidates') send(res, 200, { result: candidates(db, url.searchParams.get('workspace_id'), actor, allowed, filter) });
    else if (rawId) send(res, 200, { result: detail(db, record(db, rawId), actor, allowed) });
    else {
      const status = url.searchParams.get('status') || 'all'; if (!['all', 'open', 'resolved'].includes(status)) fail('Choose all, open or resolved conflicts.');
      const result = readableRows(db, url.searchParams.get('workspace_id'), actor, allowed, { status });
      send(res, 200, { result: { conflicts: result.rows.map(item => item.conflict), has_more: result.has_more } });
    }
    return true;
  }
  if (req.method === 'POST' && (!rawId || action === 'decision')) {
    const outcome = rawId ? decideConflict(db, rawId, body, actor, allowed) : reportConflict(db, body, actor, allowed);
    send(res, outcome.replayed ? 200 : 201, { result: outcome.result, ...(outcome.replayed ? { replayed: true } : {}) }); return true;
  }
  fail('Conflict action not found.', 'not_found', 404);
}

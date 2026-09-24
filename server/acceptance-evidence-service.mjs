import { createHash, randomUUID } from 'node:crypto';
import { captureSourceAccess, assertSourceAccess } from './context-source-access.mjs';
import { authorizeRouteNodes } from './route-hierarchy.mjs';

const stamp = () => new Date().toISOString();
const uid = kind => `${kind}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const parse = (value, fallback = null) => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; } };
const sorted = value => Array.isArray(value) ? value.map(sorted) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const canonical = value => JSON.stringify(sorted(value));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const fail = (message, code = 'invalid_acceptance_evidence', statusCode = 400) => { throw Object.assign(new Error(message), { code, errorCode: code, statusCode }); };
const text = (value, label, limit = 10000, required = false) => { if (typeof value !== 'string' || value.length > limit || required && !value.trim()) fail(`${label} must be ${required ? 'nonempty ' : ''}text under ${limit} characters.`); return value.trim(); };
const identifier = (value, label) => { if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,240}$/.test(value)) fail(`${label} is invalid.`); return value; };
const fields = (body, allowed) => { if (!object(body) || Object.keys(body).some(key => !allowed.includes(key))) fail('Request contains unsupported fields.'); };
const human = actor => { if (!actor?.id || actor.mode === 'agent' || actor.type === 'agent') fail('A human reviewer is required.', 'access_denied', 403); return actor.id; };
const target = row => row.project_id ? { scope_type: 'project', scope_id: row.project_id } : row.team_id ? { scope_type: 'team', scope_id: row.team_id } : {};

export function installAcceptanceEvidence(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS route_acceptance_policies (
    route_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    policy_version INTEGER NOT NULL DEFAULT 2, enabled_by TEXT, enabled_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, CHECK(policy_version=2));
  CREATE TABLE IF NOT EXISTS route_acceptance_assessments (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    route_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, agreement_version INTEGER NOT NULL,
    criterion_id TEXT NOT NULL, criterion_text TEXT NOT NULL, criterion_text_hash TEXT NOT NULL,
    output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
    output_version_id TEXT NOT NULL REFERENCES output_versions(id) ON DELETE RESTRICT,
    output_content_hash TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_id TEXT NOT NULL,
    artifact_content_hash TEXT NOT NULL, artifact_content TEXT NOT NULL,
    source_access_json TEXT NOT NULL, decision TEXT NOT NULL, rationale TEXT NOT NULL,
    reviewer_id TEXT NOT NULL, reviewer_name TEXT NOT NULL, created_at TEXT NOT NULL,
    CHECK(decision IN ('passed','failed')), CHECK(artifact_type IN ('output_version','run_event')));
  CREATE INDEX IF NOT EXISTS route_acceptance_current ON route_acceptance_assessments(output_id,output_version_id,agreement_version,criterion_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS output_acceptance_review_snapshots (
    review_id TEXT PRIMARY KEY REFERENCES output_reviews(id) ON DELETE CASCADE,
    output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    route_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    output_version_id TEXT NOT NULL REFERENCES output_versions(id) ON DELETE RESTRICT,
    agreement_version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS acceptance_evidence_requests (
    workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, request_key TEXT NOT NULL,
    operation TEXT NOT NULL, fingerprint TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id,actor_id,request_key));
  CREATE TRIGGER IF NOT EXISTS route_acceptance_assessments_immutable BEFORE UPDATE ON route_acceptance_assessments BEGIN SELECT RAISE(ABORT,'Acceptance assessments are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS output_acceptance_review_snapshots_immutable BEFORE UPDATE ON output_acceptance_review_snapshots BEGIN SELECT RAISE(ABORT,'Acceptance review snapshots are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS acceptance_evidence_workspace_cleanup BEFORE DELETE ON workspaces BEGIN
    DELETE FROM output_acceptance_review_snapshots WHERE workspace_id=OLD.id;
    DELETE FROM route_acceptance_assessments WHERE workspace_id=OLD.id;
    DELETE FROM acceptance_evidence_requests WHERE workspace_id=OLD.id;
    DELETE FROM route_acceptance_policies WHERE workspace_id=OLD.id;
  END;`);
}

function routeRecord(db, routeId) {
  const route = db.prepare('SELECT * FROM tasks WHERE id=?').get(identifier(routeId, 'Route ID'));
  if (!route || route.archived_at) fail('Route unavailable.', 'not_found', 404);
  const agreement = db.prepare('SELECT * FROM route_workflows WHERE id=?').get(route.id);
  return { route, agreement: agreement ? { ...agreement, acceptance: parse(agreement.acceptance_json, []), saved: true } : { id: route.id, workspace_id: route.workspace_id, version: 0, acceptance: [], saved: false } };
}
function outputRecord(db, outputId) {
  const output = db.prepare('SELECT * FROM outputs WHERE id=?').get(identifier(outputId, 'Output ID'));
  if (!output || output.archived_at || !output.task_id) fail('Choose an active Route-linked output.', 'not_found', 404);
  const linked = routeRecord(db, output.task_id);
  if (linked.route.workspace_id !== output.workspace_id || linked.route.project_id !== output.project_id) fail('Output and Route scope do not match.', 'invalid_scope', 409);
  const version = db.prepare('SELECT * FROM output_versions WHERE output_id=? AND number=?').get(output.id, output.current_version);
  if (!version) fail('Current output version unavailable.', 'not_found', 404);
  return { output, version, ...linked };
}
function authorizeRoute(route, actor, allowed, write = false) {
  human(actor); authorizeRouteNodes([route], { actor, allowed, write });
  const permission = write ? 'documents.write' : 'documents.read';
  if (typeof allowed === 'function' && allowed(route.workspace_id, actor, permission, target(route)) !== true) fail('Acceptance evidence access denied.', 'access_denied', 403);
}
function policyRow(db, route) {
  const installed = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='route_acceptance_policies'").get();
  return installed && db.prepare('SELECT * FROM route_acceptance_policies WHERE route_id=?').get(route.id) || { route_id: route.id, workspace_id: route.workspace_id, policy_version: 1, enabled_by: null, enabled_at: null, version: 0 };
}
function publicPolicy(row) { return { route_id: row.route_id, workspace_id: row.workspace_id, policy_version: row.policy_version, enabled_by: row.enabled_by, enabled_at: row.enabled_at, version: row.version }; }
function requestId(value) { return value === undefined ? null : identifier(value, 'Request ID'); }
function receipt(db, workspaceId, actorId, operation, body) {
  const key = requestId(body.request_id); if (!key) return null;
  const fingerprint = hash({ operation, body: { ...body, request_id: undefined } });
  const old = db.prepare('SELECT * FROM acceptance_evidence_requests WHERE workspace_id=? AND actor_id=? AND request_key=?').get(workspaceId, actorId, key);
  if (old && (old.operation !== operation || old.fingerprint !== fingerprint)) fail('Request ID already used for different input.', 'idempotency_conflict', 409);
  return { key, fingerprint, old };
}
function saveReceipt(db, workspaceId, actorId, item, operation, targetId) { if (item?.key) db.prepare('INSERT INTO acceptance_evidence_requests VALUES(?,?,?,?,?,?,?)').run(workspaceId, actorId, item.key, operation, item.fingerprint, targetId, stamp()); }
function sourceAccess(db, linked, artifact) {
  const included = [{ kind: 'output_version', id: linked.version.id }]; if (artifact.type === 'run_event') included.push({ kind: 'run', id: linked.output.run_id });
  return captureSourceAccess(db, { manifest: { resolved: { workspace_id: linked.output.workspace_id, project_id: linked.output.project_id, task_id: linked.output.task_id }, included, excluded: [] } });
}
function assertRunContext(db, runId, actor, allowed) {
  const saved = db.prepare('SELECT inspection_json FROM run_context_snapshots WHERE run_id=?').get(runId), inspection = parse(saved?.inspection_json);
  if (!inspection?.sourceAccess) fail('Canonical run context is unavailable.', 'context_access_revoked', 403);
  assertSourceAccess(db, inspection, actor, allowed); return inspection;
}
function artifactRecord(db, linked, artifact, actor, allowed) {
  fields(artifact, ['type', 'id']);
  if (artifact.type === 'output_version') {
    if (artifact.id !== linked.version.id) fail('Assessment must reference the exact current output version.', 'stale_output', 409);
    if (linked.output.run_id) assertRunContext(db, linked.output.run_id, actor, allowed);
    return { type: 'output_version', id: linked.version.id, content: linked.version.content, title: `Output version ${linked.version.number} (deliverable)` };
  }
  if (artifact.type !== 'run_event' || !linked.output.run_id) fail('Choose an exact current output version or its canonical terminal run event.');
  const run = db.prepare('SELECT * FROM runs WHERE id=?').get(linked.output.run_id);
  const event = db.prepare('SELECT * FROM run_events WHERE id=? AND run_id=?').get(identifier(artifact.id, 'Artifact ID'), run?.id || '');
  if (!run || run.mode !== 'live' || !['completed', 'failed', 'stopped'].includes(run.status) || run.workspace_id !== linked.output.workspace_id || run.task_id !== linked.route.id || !event || !['run.completed', 'run.failed', 'run.stopped'].includes(event.type)) fail('Choose a terminal event from the output’s canonical live Route run.', 'invalid_evidence', 409);
  if ({ completed: 'run.completed', failed: 'run.failed', stopped: 'run.stopped' }[run.status] !== event.type) fail('Terminal event does not match the canonical run state.', 'invalid_evidence', 409);
  assertRunContext(db, run.id, actor, allowed);
  const payload = parse(event.payload_json, {}), values = event.type === 'run.completed' ? [payload.summary, payload.text, payload.output] : [payload.error, payload.summary, payload.text, payload.output], content = values.find(value => typeof value === 'string' && value.trim());
  if (!content) fail('Terminal event has no exact result evidence.', 'invalid_evidence', 409);
  return { type: 'run_event', id: event.id, content, title: event.type };
}
function assertAssessmentAccess(db, row, actor, allowed) {
  const linked = outputRecord(db, row.output_id); authorizeRoute(linked.route, actor, allowed);
  const pinned = db.prepare('SELECT * FROM output_versions WHERE id=? AND output_id=?').get(row.output_version_id, row.output_id);
  if (!pinned || hash(pinned.content) !== row.output_content_hash) fail('Pinned output evidence changed or is unavailable.', 'context_access_revoked', 403);
  if (row.artifact_type === 'output_version') {
    if (row.artifact_id !== pinned.id || hash(pinned.content) !== row.artifact_content_hash) fail('Pinned output artifact changed.', 'context_access_revoked', 403);
  } else {
    const event = db.prepare('SELECT * FROM run_events WHERE id=? AND run_id=?').get(row.artifact_id, linked.output.run_id || '');
    const payload = parse(event?.payload_json, {}), values = event?.type === 'run.completed' ? [payload.summary, payload.text, payload.output] : [payload.error, payload.summary, payload.text, payload.output], content = values.find(value => typeof value === 'string' && value.trim());
    if (!event || !content || hash(content) !== row.artifact_content_hash) fail('Pinned run artifact changed.', 'context_access_revoked', 403);
  }
  const saved = parse(row.source_access_json); assertSourceAccess(db, { manifest: { resolved: { workspace_id: row.workspace_id } }, sourceAccess: saved }, actor, allowed);
  if (linked.output.run_id) assertRunContext(db, linked.output.run_id, actor, allowed);
  return linked;
}
function publicAssessment(row) { return { id: row.id, route_id: row.route_id, agreement_version: row.agreement_version, criterion_id: row.criterion_id, criterion_text: row.criterion_text, criterion_text_hash: row.criterion_text_hash, output_id: row.output_id, output_version_id: row.output_version_id, output_content_hash: row.output_content_hash, artifact: { type: row.artifact_type, id: row.artifact_id, hash: row.artifact_content_hash, content: row.artifact_content }, decision: row.decision, rationale: row.rationale, reviewer_id: row.reviewer_id, reviewer_name: row.reviewer_name, created_at: row.created_at };
}
function latestCoverage(db, linked, actor, allowed) {
  const rows = db.prepare('SELECT * FROM route_acceptance_assessments WHERE output_id=? AND output_version_id=? AND agreement_version=? ORDER BY created_at DESC,rowid DESC').all(linked.output.id, linked.version.id, linked.agreement.version);
  const latest = new Map(); for (const row of rows) if (!latest.has(row.criterion_id)) latest.set(row.criterion_id, row);
  const cases = linked.agreement.acceptance.map(criterion => {
    const textHash = hash(criterion.text), candidate = latest.get(criterion.id);
    let assessment = candidate?.criterion_text_hash === textHash ? candidate : null;
    if (assessment) { try { assertAssessmentAccess(db, assessment, actor, allowed); } catch { assessment = null; } }
    return { criterion_id: criterion.id, text: criterion.text, text_hash: textHash, status: assessment?.decision || 'missing', assessment_id: assessment?.id || null };
  });
  const passed = cases.filter(item => item.status === 'passed').length, failed = cases.filter(item => item.status === 'failed').length, missing = cases.length - passed - failed;
  return { agreement_version: linked.agreement.version, output_version_id: linked.version.id, total: cases.length, passed, failed, missing, complete: cases.length > 0 && passed === cases.length, cases };
}
function availableArtifacts(db, linked, actor, allowed) {
  try { const guard = sourceAccess(db, linked, { type: 'output_version' }); assertSourceAccess(db, { manifest: { resolved: { workspace_id: linked.output.workspace_id } }, sourceAccess: guard }, actor, allowed); } catch { return []; }
  if (linked.output.run_id) { try { assertRunContext(db, linked.output.run_id, actor, allowed); } catch { return []; } }
  const result = [{ type: 'output_version', id: linked.version.id, title: `Output version ${linked.version.number} (deliverable)`, content: linked.version.content, hash: hash(linked.version.content) }];
  if (!linked.output.run_id) return result;
  for (const event of db.prepare("SELECT * FROM run_events WHERE run_id=? AND type IN ('run.completed','run.failed','run.stopped') ORDER BY sequence DESC").all(linked.output.run_id)) {
    try { const artifact = artifactRecord(db, linked, { type: 'run_event', id: event.id }, actor, allowed); result.push({ ...artifact, hash: hash(artifact.content) }); } catch { /* Omit unavailable or contentless events. */ }
  }
  return result;
}
function acceptedReviewRows(db, linked, actor, allowed) {
  return db.prepare('SELECT * FROM output_acceptance_review_snapshots WHERE output_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(linked.output.id).flatMap(row => { try { return [acceptanceReviewSnapshot({ db, reviewId: row.review_id, actor, allowed })]; } catch { return []; } });
}
export function acceptanceEvidenceDetail({ db, outputId, actor, allowed }) {
  const linked = outputRecord(db, outputId); authorizeRoute(linked.route, actor, allowed);
  const policy = policyRow(db, linked.route);
  return { policy: publicPolicy(policy), route: { id: linked.route.id, agreement_version: linked.agreement.version }, output: { id: linked.output.id, version: linked.output.version, current_version: linked.output.current_version, output_version_id: linked.version.id }, coverage: latestCoverage(db, linked, actor, allowed), assessments: db.prepare('SELECT * FROM route_acceptance_assessments WHERE output_id=? ORDER BY created_at DESC,rowid DESC LIMIT 500').all(linked.output.id).flatMap(row => { try { assertAssessmentAccess(db, row, actor, allowed); return [publicAssessment(row)]; } catch { return []; } }), available_artifacts: availableArtifacts(db, linked, actor, allowed), accepted_reviews: acceptedReviewRows(db, linked, actor, allowed), limits: { assessments: 500, accepted_reviews: 100 } };
}

function enablePolicy(db, routeId, body, actor, allowed) {
  fields(body, ['route_version', 'confirmed', 'request_id']); if (body.confirmed !== true) fail('Confirm enabling immutable acceptance evidence v2.');
  const linked = routeRecord(db, routeId); authorizeRoute(linked.route, actor, allowed, true);
  const operation = `enable:${linked.route.id}`, replay = receipt(db, linked.route.workspace_id, actor.id, operation, body), existing = policyRow(db, linked.route);
  if (replay?.old) return publicPolicy(policyRow(db, linked.route));
  if (existing.policy_version === 2) fail('Acceptance evidence v2 is already enabled.', 'stale_version', 409);
  if (!linked.agreement.saved) fail('Save a Route agreement before enabling acceptance evidence v2.', 'agreement_required', 409);
  if (!Number.isSafeInteger(body.route_version) || body.route_version !== linked.agreement.version) fail('Route agreement changed. Reload before enabling evidence.', 'stale_version', 409);
  if (!linked.agreement.acceptance.length) fail('Add at least one acceptance criterion before enabling evidence v2.');
  const created = stamp(); db.prepare('INSERT INTO route_acceptance_policies VALUES(?,?,?,?,?,?)').run(linked.route.id, linked.route.workspace_id, 2, actor.id, created, 1);
  saveReceipt(db, linked.route.workspace_id, actor.id, replay, operation, linked.route.id); return publicPolicy(policyRow(db, linked.route));
}
function assess(db, outputId, body, actor, allowed) {
  fields(body, ['output_version', 'output_version_id', 'agreement_version', 'criterion_id', 'decision', 'rationale', 'artifact', 'request_id']);
  const linked = outputRecord(db, outputId); authorizeRoute(linked.route, actor, allowed, true); const policy = policyRow(db, linked.route);
  if (policy.policy_version !== 2) fail('Enable acceptance evidence v2 for this Route first.', 'policy_required', 409);
  const operation = `assess:${linked.output.id}`, replay = receipt(db, linked.output.workspace_id, actor.id, operation, body);
  if (replay?.old) { const row = db.prepare('SELECT * FROM route_acceptance_assessments WHERE id=?').get(replay.old.target_id); if (!row) fail('Assessment unavailable.', 'not_found', 404); assertAssessmentAccess(db, row, actor, allowed); return publicAssessment(row); }
  if (body.output_version !== linked.output.version || body.output_version_id !== linked.version.id) fail('Output changed. Review its current version again.', 'stale_output', 409);
  if (body.agreement_version !== linked.agreement.version) fail('Route criteria changed. Review the current agreement.', 'stale_agreement', 409);
  const criterion = linked.agreement.acceptance.find(item => item.id === body.criterion_id); if (!criterion) fail('Acceptance criterion unavailable.', 'stale_agreement', 409);
  if (!['passed', 'failed'].includes(body.decision)) fail('Choose passed or failed.'); const rationale = text(body.rationale, 'Assessment rationale', 20000, true);
  const artifact = artifactRecord(db, linked, body.artifact, actor, allowed), guard = sourceAccess(db, linked, artifact), created = stamp();
  assertSourceAccess(db, { manifest: { resolved: { workspace_id: linked.output.workspace_id } }, sourceAccess: guard }, actor, allowed);
  const row = { id: uid('accept'), workspace_id: linked.output.workspace_id, route_id: linked.route.id, agreement_version: linked.agreement.version, criterion_id: criterion.id, criterion_text: criterion.text, criterion_text_hash: hash(criterion.text), output_id: linked.output.id, output_version_id: linked.version.id, output_content_hash: hash(linked.version.content), artifact_type: artifact.type, artifact_id: artifact.id, artifact_content_hash: hash(artifact.content), artifact_content: artifact.content, source_access_json: canonical(guard), decision: body.decision, rationale, reviewer_id: actor.id, reviewer_name: actor.name || actor.id, created_at: created };
  db.prepare('INSERT INTO route_acceptance_assessments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row)); saveReceipt(db, linked.output.workspace_id, actor.id, replay, operation, row.id); return publicAssessment(row);
}

export function assertOutputAcceptanceForReview({ db, output, version, agreement, actor, allowed }) {
  const policy = output.task_id ? policyRow(db, { id: output.task_id, workspace_id: output.workspace_id }) : { policy_version: 1 };
  if (policy.policy_version !== 2) return null;
  human(actor); const linked = outputRecord(db, output.id); authorizeRoute(linked.route, actor, allowed, true);
  if (linked.output.version !== output.version || linked.version.id !== version.id || linked.agreement.version !== agreement?.version) fail('Output or Route agreement changed before approval.', 'stale_acceptance', 409);
  const coverage = latestCoverage(db, linked, actor, allowed); if (!coverage.complete) fail('Every current Route criterion needs a passed human assessment for this exact output version.', 'acceptance_evidence_required', 409);
  const assessments = new Map(db.prepare('SELECT * FROM route_acceptance_assessments WHERE output_id=? AND output_version_id=? AND agreement_version=? ORDER BY created_at DESC,rowid DESC').all(output.id, version.id, agreement.version).map(row => [row.id, row]));
  return { policy_version: 2, route_id: linked.route.id, agreement_version: agreement.version, output_id: output.id, output_version_id: version.id, output_content_hash: hash(version.content), criteria: coverage.cases.map(item => { const row = assessments.get(item.assessment_id); return { criterion_id: item.criterion_id, text: item.text, text_hash: item.text_hash, assessment_id: row.id, decision: row.decision, artifact: { type: row.artifact_type, id: row.artifact_id, hash: row.artifact_content_hash }, reviewer_id: row.reviewer_id, rationale: row.rationale }; }), captured_at: stamp() };
}
export function recordOutputAcceptanceReview({ db, review, acceptanceSnapshot }) {
  if (!acceptanceSnapshot) return null;
  const created = stamp(); db.prepare('INSERT INTO output_acceptance_review_snapshots VALUES(?,?,?,?,?,?,?,?)').run(review.id, review.output_id, review.workspace_id, acceptanceSnapshot.route_id, review.version_id, acceptanceSnapshot.agreement_version, canonical(acceptanceSnapshot), created);
  return { review_id: review.id, ...acceptanceSnapshot, created_at: created };
}
export function acceptanceReviewSnapshot({ db, reviewId, actor, allowed }) {
  const row = db.prepare('SELECT * FROM output_acceptance_review_snapshots WHERE review_id=?').get(identifier(reviewId, 'Review ID')); if (!row) fail('Acceptance review snapshot unavailable.', 'not_found', 404);
  const linked = outputRecord(db, row.output_id); authorizeRoute(linked.route, actor, allowed); const snapshot = parse(row.snapshot_json);
  if (!snapshot || !Array.isArray(snapshot.criteria)) fail('Acceptance review snapshot is invalid.', 'invalid_acceptance_evidence', 409);
  for (const item of snapshot.criteria) { const assessment = db.prepare('SELECT * FROM route_acceptance_assessments WHERE id=?').get(item.assessment_id); if (!assessment) fail('Acceptance evidence is unavailable.', 'context_access_revoked', 403); assertAssessmentAccess(db, assessment, actor, allowed); }
  return { review_id: row.review_id, ...snapshot, created_at: row.created_at };
}

export async function acceptanceEvidenceRoute({ db, req, res, path, body, send, actor, allowed }) {
  let match = path.match(/^\/workflow\/routes\/([^/]+)\/acceptance-policy$/);
  if (match) {
    const linked = routeRecord(db, decodeURIComponent(match[1])); authorizeRoute(linked.route, actor, allowed, req.method !== 'GET');
    if (req.method === 'GET') { send(res, 200, { result: { policy: publicPolicy(policyRow(db, linked.route)), route: { id: linked.route.id, agreement_version: linked.agreement.version, criteria: linked.agreement.acceptance } } }); return true; }
    if (req.method !== 'POST') fail('Unsupported acceptance policy operation.', 'method_not_allowed', 405);
    db.exec('BEGIN IMMEDIATE'); try { const policy = enablePolicy(db, linked.route.id, body, actor, allowed); db.exec('COMMIT'); send(res, 200, { result: { policy } }); return true; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  match = path.match(/^\/workflow\/outputs\/([^/]+)\/acceptance-evidence$/); if (!match) return false;
  const outputId = decodeURIComponent(match[1]);
  if (req.method === 'GET') { send(res, 200, { result: acceptanceEvidenceDetail({ db, outputId, actor, allowed }) }); return true; }
  if (req.method !== 'POST') fail('Unsupported acceptance evidence operation.', 'method_not_allowed', 405);
  db.exec('BEGIN IMMEDIATE'); try { const result = assess(db, outputId, body, actor, allowed); db.exec('COMMIT'); send(res, 200, { result }); return true; } catch (error) { db.exec('ROLLBACK'); throw error; }
}

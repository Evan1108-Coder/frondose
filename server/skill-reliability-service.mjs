import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureSourceAccess, assertSourceAccess } from './context-source-access.mjs';

const now = () => new Date().toISOString();
const uid = kind => `${kind}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const parse = (value, fallback = null) => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; } };
const canonical = value => JSON.stringify(sort(value));
const sort = value => Array.isArray(value) ? value.map(sort) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const fail = (message, code = 'invalid_skill_evaluation', statusCode = 400) => { throw Object.assign(new Error(message), { code, errorCode: code, statusCode }); };
const scope = skill => skill.project_id ? { scope_type: 'project', scope_id: skill.project_id } : skill.team_id ? { scope_type: 'team', scope_id: skill.team_id } : {};
const identifier = (value, label) => { if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,240}$/.test(value)) fail(`${label} is invalid.`); return value; };
const boundedText = (value, label, limit, required = false) => { if (typeof value !== 'string' || value.length > limit || required && !value.trim()) fail(`${label} must be ${required ? 'nonempty ' : ''}text under ${limit} characters.`); return value.trim(); };
const requestKey = value => value === undefined ? null : identifier(value, 'Request ID');
const assertFields = (body, allowed) => { if (!object(body) || Object.keys(body).some(key => !allowed.includes(key))) fail('Request contains unsupported fields.'); };
const assertBinding = (binding, launch = false) => { assertFields(binding, launch ? ['preparation_id', 'preparation_version', 'preparation_token'] : ['preparation_id', 'preparation_version']); };

export function installSkillReliability(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS skill_evaluation_preparations (
    id TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    version_id TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE, version_number INTEGER NOT NULL,
    test_case_id TEXT NOT NULL, test_case_name TEXT NOT NULL, inputs_json TEXT NOT NULL, input_hash TEXT NOT NULL,
    expected_output_hash TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE NO ACTION,
    team_id TEXT REFERENCES teams(id) ON DELETE NO ACTION, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE NO ACTION,
    profile_version INTEGER NOT NULL, prepared_by TEXT NOT NULL, work_mode TEXT NOT NULL, permission_mode TEXT NOT NULL,
    timeout_ms INTEGER NOT NULL, native_tools INTEGER NOT NULL DEFAULT 0, context_request_json TEXT NOT NULL,
    request_hash TEXT NOT NULL, source_access_json TEXT NOT NULL, token_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'prepared', version INTEGER NOT NULL DEFAULT 1,
    canonical_run_id TEXT REFERENCES runs(id) ON DELETE NO ACTION, expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    CHECK(status IN ('prepared','bound','evaluated','cancelled')), CHECK(work_mode IN ('conversation','project')),
    CHECK(permission_mode IN ('read-only','workspace-write')), CHECK(timeout_ms BETWEEN 1000 AND 1800000));
  CREATE UNIQUE INDEX IF NOT EXISTS skill_evaluation_run ON skill_evaluation_preparations(canonical_run_id) WHERE canonical_run_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS skill_evaluation_preparation_skill ON skill_evaluation_preparations(skill_id,version_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS skill_evaluations (
    id TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    version_id TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL, test_case_id TEXT NOT NULL, test_case_name TEXT NOT NULL,
    inputs_json TEXT NOT NULL, input_hash TEXT NOT NULL, expected_output_hash TEXT NOT NULL,
    preparation_id TEXT NOT NULL UNIQUE REFERENCES skill_evaluation_preparations(id) ON DELETE RESTRICT,
    run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE RESTRICT,
    artifact_type TEXT NOT NULL, artifact_id TEXT NOT NULL, artifact_hash TEXT NOT NULL,
    artifact_content TEXT NOT NULL, run_status TEXT NOT NULL, run_error_code TEXT,
    outcome TEXT NOT NULL, evidence TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'reviewed_live',
    evaluator_id TEXT NOT NULL, agent_id TEXT NOT NULL, profile_version INTEGER NOT NULL,
    profile_snapshot_hash TEXT NOT NULL, context_fingerprint TEXT NOT NULL, provenance_json TEXT NOT NULL,
    evidence_version INTEGER NOT NULL DEFAULT 2, created_at TEXT NOT NULL,
    CHECK(outcome IN ('passed','failed')), CHECK(mode='reviewed_live'), CHECK(evidence_version=2),
    CHECK(artifact_type IN ('run_event','output_version')));
  CREATE INDEX IF NOT EXISTS skill_evaluations_coverage ON skill_evaluations(skill_id,version_id,test_case_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS skill_evaluation_comparisons (
    id TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    test_case_id TEXT NOT NULL, input_hash TEXT NOT NULL,
    left_evaluation_id TEXT NOT NULL REFERENCES skill_evaluations(id) ON DELETE RESTRICT,
    right_evaluation_id TEXT NOT NULL REFERENCES skill_evaluations(id) ON DELETE RESTRICT,
    decision TEXT NOT NULL, rationale TEXT NOT NULL, evaluator_id TEXT NOT NULL, created_at TEXT NOT NULL,
    CHECK(decision IN ('left_better','right_better','equivalent','inconclusive')),
    CHECK(left_evaluation_id<>right_evaluation_id));
  CREATE TABLE IF NOT EXISTS skill_reliability_requests (
    workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, request_key TEXT NOT NULL,
    operation TEXT NOT NULL, fingerprint TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id,actor_id,request_key));
  CREATE TRIGGER IF NOT EXISTS skill_evaluations_immutable BEFORE UPDATE ON skill_evaluations BEGIN SELECT RAISE(ABORT,'Skill evaluations are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS skill_evaluation_comparisons_immutable BEFORE UPDATE ON skill_evaluation_comparisons BEGIN SELECT RAISE(ABORT,'Skill evaluation comparisons are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS skill_reliability_workspace_cleanup BEFORE DELETE ON workspaces BEGIN
    DELETE FROM skill_evaluation_comparisons WHERE workspace_id=OLD.id;
    DELETE FROM skill_evaluations WHERE workspace_id=OLD.id;
    DELETE FROM skill_reliability_requests WHERE workspace_id=OLD.id;
    DELETE FROM skill_evaluation_preparations WHERE workspace_id=OLD.id;
  END;`);
}

function skillRow(db, id) {
  const skill = db.prepare('SELECT * FROM skills WHERE id=?').get(identifier(id, 'Skill ID'));
  if (!skill || skill.archived_at) fail('Skill unavailable.', 'not_found', 404);
  return skill;
}
function authorize(db, skill, actor, allowed, write = false) {
  if (!actor?.id || actor.mode === 'agent') fail('A human account is required.', 'access_denied', 403);
  if (!allowed(skill.workspace_id, actor, write ? 'agents.write' : 'agents.read', scope(skill))) fail('Skill access denied.', 'access_denied', 403);
  if (skill.project_id) {
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(skill.project_id);
    if (!project || project.archived_at || project.workspace_id !== skill.workspace_id || !allowed(skill.workspace_id, actor, 'projects.read', { scope_type: 'project', scope_id: project.id })) fail('Skill project is unavailable.', 'access_denied', 403);
  }
}
function versionRow(db, skill, id, { requireV2 = true } = {}) {
  const row = db.prepare('SELECT * FROM skill_versions WHERE id=? AND skill_id=?').get(identifier(id, 'Skill version ID'), skill.id);
  if (!row) fail('Skill version unavailable.', 'not_found', 404);
  const definition = parse(row.definition_json);
  if (!object(definition)) fail('Skill version definition is invalid.', 'invalid_skill_evaluation', 409);
  if (requireV2 && definition.evidence_policy_version !== 2) fail('Create a new Skill version to use reliability evidence v2.', 'reliability_upgrade_required', 409);
  return { ...row, definition };
}
function caseRow(version, id) {
  const testCase = version.definition.test_cases?.find(item => item.id === id);
  if (!testCase) fail('Test case unavailable for this Skill version.', 'not_found', 404);
  return testCase;
}
function agentRow(db, skill, id, profileVersion, actor, allowed) {
  const agent = db.prepare('SELECT * FROM agents WHERE id=?').get(identifier(id, 'Agent ID'));
  if (!agent || agent.archived_at || agent.status === 'paused' || agent.workspace_id && agent.workspace_id !== skill.workspace_id) fail('Agent unavailable.', 'invalid_scope');
  if (!allowed(skill.workspace_id, actor, 'agents.read', agent.workspace_id ? { scope_type: 'agent', scope_id: agent.id } : {})) fail('Agent is outside your access.', 'access_denied', 403);
  if (!Number.isSafeInteger(profileVersion) || profileVersion !== agent.version) fail('The selected profile version changed. Prepare again.', 'stale_profile', 409);
  const snapshot = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? AND version=?').get(agent.id, profileVersion);
  if (!snapshot) fail('Agent profile snapshot unavailable.', 'stale_profile', 409);
  return { agent, snapshot };
}
function sourceInspection(skill, version, agent) {
  return { manifest: { resolved: { workspace_id: skill.workspace_id, project_id: skill.project_id || null, area_id: skill.team_id || null, agent_id: agent.id }, included: [{ kind: 'skill_version', id: version.id }], excluded: [] } };
}
function requiredContext(db, skill, version) {
  const tables = { document: 'documents', memory: 'memory_notes', knowledge: 'knowledge_entries' }, attachments = [], packs = [];
  for (const ref of version.definition.required_context || []) {
    if (ref.kind === 'pack') { packs.push(ref.id); continue; }
    const table = tables[ref.kind], row = table && db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(ref.id);
    if (!row || row.workspace_id !== skill.workspace_id || row.archived_at) fail('Required Skill context is unavailable.', 'context_access_revoked', 403);
    attachments.push({ name: `skill-${ref.kind}-${ref.id}.md`, type: 'text/plain', content: row.content });
  }
  return { attachments, packs: [...new Set(packs)].sort() };
}
function assertPreparedAccess(db, preparation, actor, allowed) {
  const skill = skillRow(db, preparation.skill_id); authorize(db, skill, actor, allowed);
  if (preparation.status === 'prepared') {
    const version = versionRow(db, skill, preparation.version_id), expected = requiredContext(db, skill, version), request = parse(preparation.context_request_json, {});
    if (hash(request.attachments || []) !== hash(expected.attachments) || hash(request.context_pack_ids || []) !== hash(expected.packs)) fail('Required Skill context changed. Prepare again.', 'stale_context', 409);
  }
  const sourceAccess = parse(preparation.source_access_json);
  assertSourceAccess(db, { ...sourceInspection(skill, { id: preparation.version_id }, { id: preparation.agent_id }), sourceAccess }, actor, allowed);
  return skill;
}
function assertRunContextAccess(db, runId, actor, allowed) {
  const captured = db.prepare('SELECT inspection_json FROM run_context_snapshots WHERE run_id=?').get(runId);
  const inspection = parse(captured?.inspection_json);
  if (!inspection?.manifest?.resolved || !inspection.sourceAccess) fail('Captured run context is unavailable.', 'context_access_revoked', 403);
  assertSourceAccess(db, inspection, actor, allowed); return inspection;
}
function decodePreparation(row) {
  if (!row) return row;
  return { id: row.id, skill_id: row.skill_id, workspace_id: row.workspace_id, version_id: row.version_id, version_number: row.version_number,
    test_case_id: row.test_case_id, test_case_name: row.test_case_name, inputs: parse(row.inputs_json, {}), input_hash: row.input_hash,
    expected_output_hash: row.expected_output_hash, project_id: row.project_id, team_id: row.team_id, agent_id: row.agent_id,
    profile_version: row.profile_version, prepared_by: row.prepared_by, work_mode: row.work_mode, permission_mode: row.permission_mode,
    timeout_ms: row.timeout_ms, native_tools: Boolean(row.native_tools), status: row.status,
    expired: row.status === 'prepared' && row.expires_at <= Date.now(), version: row.version,
    canonical_run_id: row.canonical_run_id, expires_at: row.expires_at, created_at: row.created_at, updated_at: row.updated_at };
}
function decodeEvaluation(row) {
  if (!row) return row;
  return { id: row.id, skill_id: row.skill_id, workspace_id: row.workspace_id, version_id: row.version_id, version_number: row.version_number,
    test_case_id: row.test_case_id, test_case_name: row.test_case_name, inputs: parse(row.inputs_json, {}), input_hash: row.input_hash,
    preparation_id: row.preparation_id, run_id: row.run_id, artifact: { type: row.artifact_type, id: row.artifact_id, hash: row.artifact_hash, content: row.artifact_content },
    run_status: row.run_status, run_error_code: row.run_error_code, outcome: row.outcome, evidence: row.evidence, notes: row.notes,
    mode: row.mode, evaluator_id: row.evaluator_id, agent_id: row.agent_id, profile_version: row.profile_version,
    profile_snapshot_hash: row.profile_snapshot_hash, context_fingerprint: row.context_fingerprint,
    provenance: parse(row.provenance_json, {}), profile: parse(row.provenance_json, {}).profile || null,
    work_mode: parse(row.provenance_json, {}).work_mode || null, permission_mode: parse(row.provenance_json, {}).permission_mode || null,
    evidence_version: row.evidence_version, created_at: row.created_at };
}
function decodeComparison(row) { return row && { ...row }; }
function preparedRequests(row, skill, version, testCase, agent, token = null) {
  const binding = { preparation_id: row.id, preparation_version: row.version };
  const request = parse(row.context_request_json, {});
  request.skill_evaluation = binding;
  const runBinding = token ? { ...binding, preparation_token: token } : binding;
  const runRequest = { ...request, mode: 'live', title: `Evaluate ${skill.name}: ${testCase.name}`, provider: agent.provider, skill_evaluation: runBinding };
  return { context_inspection_request: request, run_request: runRequest };
}
function selectedRequest(input) {
  const result = Object.fromEntries(['workspace_id', 'project_id', 'task_id', 'chat_id', 'agent_id', 'area_id', 'prompt', 'work_mode', 'permission_mode', 'include_memory', 'include_chat', 'attachments', 'source_message_id', 'timeout_ms', 'cwd', 'profile_version', 'provider_connection_id', 'skill_evaluation'].map(key => [key, input?.[key] ?? null]));
  if (object(result.skill_evaluation)) result.skill_evaluation = { preparation_id: result.skill_evaluation.preparation_id, preparation_version: result.skill_evaluation.preparation_version };
  result.context_pack_ids = [...new Set(input?.context_pack_ids || [])].sort(); result.native_tools = input?.native_tools === true;
  return result;
}
function fingerprint(operation, body) { return hash({ operation, body: { ...body, request_id: undefined } }); }
function idempotent(db, skill, actor, operation, body) {
  const key = requestKey(body.request_id); if (!key) return null;
  const row = db.prepare('SELECT * FROM skill_reliability_requests WHERE workspace_id=? AND actor_id=? AND request_key=?').get(skill.workspace_id, actor.id, key);
  const expected = fingerprint(operation, body);
  if (row && (row.operation !== operation || row.fingerprint !== expected)) fail('Request ID already used for different input.', 'idempotency_conflict', 409);
  return { key, expected, row };
}
function remember(db, skill, actor, key, operation, expected, target) {
  if (key) db.prepare('INSERT INTO skill_reliability_requests VALUES(?,?,?,?,?,?,?)').run(skill.workspace_id, actor.id, key, operation, expected, target, now());
}
function preparationById(db, skill, id) {
  const row = db.prepare('SELECT * FROM skill_evaluation_preparations WHERE id=? AND skill_id=?').get(identifier(id, 'Preparation ID'), skill.id);
  if (!row) fail('Evaluation preparation unavailable.', 'not_found', 404); return row;
}

function prepare(db, skill, body, actor, allowed) {
  authorize(db, skill, actor, allowed, true);
  const replay = idempotent(db, skill, actor, 'prepare', body);
  if (replay?.row) {
    const prior = preparationById(db, skill, replay.row.target_id); assertPreparedAccess(db, prior, actor, allowed);
    if (prior.prepared_by !== actor.id) fail('Preparation unavailable.', 'access_denied', 403);
    if (prior.canonical_run_id) assertRunContextAccess(db, prior.canonical_run_id, actor, allowed);
    if (prior.status !== 'prepared') return { preparation: decodePreparation(prior), replayed: true };
    if (prior.expires_at <= Date.now()) fail('Evaluation preparation expired. Prepare again.', 'preparation_expired', 409);
    const token = randomBytes(32).toString('base64url'), updated = now(), next = prior.version + 1, request = parse(prior.context_request_json, {});
    request.skill_evaluation = { preparation_id: prior.id, preparation_version: next };
    db.prepare('UPDATE skill_evaluation_preparations SET token_hash=?,version=?,context_request_json=?,request_hash=?,updated_at=? WHERE id=? AND version=?').run(hash(token), next, canonical(request), hash(selectedRequest(request)), updated, prior.id, prior.version);
    const row = db.prepare('SELECT * FROM skill_evaluation_preparations WHERE id=?').get(prior.id), version = versionRow(db, skill, row.version_id), testCase = caseRow(version, row.test_case_id), agent = db.prepare('SELECT * FROM agents WHERE id=?').get(row.agent_id);
    return { preparation: decodePreparation(row), ...preparedRequests(row, skill, version, testCase, agent, token), replayed: true };
  }
  for (const field of ['include_memory', 'native_tools']) if (body[field] !== undefined && typeof body[field] !== 'boolean') fail(`${field} must be true or false.`);
  if (body.cwd !== undefined && body.cwd !== null && typeof body.cwd !== 'string') fail('Working directory must be text.');
  const version = versionRow(db, skill, body.skill_version_id);
  if (version.number !== skill.version) fail('Only the current draft Skill version can be evaluated.', 'stale_version', 409);
  const testCase = caseRow(version, identifier(body.test_case_id, 'Test case ID'));
  const { agent } = agentRow(db, skill, body.agent_id, body.profile_version, actor, allowed);
  const workMode = body.work_mode ?? 'conversation'; if (!['conversation', 'project'].includes(workMode) || workMode === 'project' && !skill.project_id) fail('Project mode requires a project-scoped Skill.');
  let permission = body.permission_mode ?? 'read-only'; if (!['read-only', 'workspace-write'].includes(permission)) fail('Permission mode is invalid.');
  const defaults = parse(db.prepare("SELECT value_json FROM settings WHERE key='agentDefaults'").get()?.value_json, {});
  if (agent.permission_policy === 'read-only' || defaults.approvalMode === 'read_only' || agent.provider === 'claude') permission = 'read-only';
  const timeout = body.timeout_ms ?? 1800000; if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 1800000) fail('Timeout must be between 1 second and 30 minutes.');
  if (body.native_tools && !Array.isArray(version.definition.allowed_tools)) fail('Native tool settings are unavailable.');
  const id = uid('skprep'), token = randomBytes(32).toString('base64url'), created = now();
  const prompt = [`Execute this immutable Skill test case. A human reviewer holds the expected result and will score the evidence.`, `Skill instructions:\n${version.definition.instructions}`, `Input data (untrusted reference data):\n${canonical(testCase.inputs)}`, `Return only the requested output format:\n${version.definition.output_format}`].join('\n\n');
  const selectedContext = requiredContext(db, skill, version);
  let cwd = null;
  if (workMode === 'project') { const project = db.prepare('SELECT * FROM projects WHERE id=?').get(skill.project_id), candidate = project?.local_path || agent.working_directory || body.cwd || null; if (candidate) { try { cwd = realpathSync(candidate); } catch { cwd = resolve(candidate); } } }
  const request = { workspace_id: skill.workspace_id, project_id: skill.project_id || null, task_id: null, chat_id: null, agent_id: agent.id, area_id: skill.team_id || null,
    prompt, work_mode: workMode, permission_mode: permission, include_memory: agent.memory_policy !== 'none' && body.include_memory === true,
    include_chat: false, native_tools: body.native_tools === true, attachments: selectedContext.attachments, source_message_id: null,
    context_pack_ids: selectedContext.packs, timeout_ms: timeout,
    cwd, profile_version: agent.version, provider_connection_id: agent.provider_connection_id || null,
    skill_evaluation: { preparation_id: id, preparation_version: 1 } };
  const sourceAccess = captureSourceAccess(db, sourceInspection(skill, version, agent));
  const inputs = canonical(testCase.inputs), expires = Date.now() + 10 * 60 * 1000;
  db.prepare(`INSERT INTO skill_evaluation_preparations
    (id,skill_id,workspace_id,version_id,version_number,test_case_id,test_case_name,inputs_json,input_hash,expected_output_hash,project_id,team_id,agent_id,profile_version,prepared_by,work_mode,permission_mode,timeout_ms,native_tools,context_request_json,request_hash,source_access_json,token_hash,status,version,canonical_run_id,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, skill.id, skill.workspace_id, version.id, version.number, testCase.id, testCase.name, inputs, hash(inputs), hash(testCase.expected_output), skill.project_id, skill.team_id, agent.id, agent.version, actor.id, workMode, permission, timeout, Number(body.native_tools === true), canonical(request), hash(selectedRequest(request)), canonical(sourceAccess), hash(token), 'prepared', 1, null, expires, created, created);
  remember(db, skill, actor, replay?.key, 'prepare', replay?.expected, id);
  const row = db.prepare('SELECT * FROM skill_evaluation_preparations WHERE id=?').get(id);
  return { preparation: decodePreparation(row), ...preparedRequests(row, skill, version, testCase, agent, token) };
}

export function skillEvaluationPreparedSourceAccess({ db, skillEvaluation, actor, allowed }) {
  if (!object(skillEvaluation)) fail('Skill evaluation binding is required.');
  assertBinding(skillEvaluation);
  const row = db.prepare('SELECT * FROM skill_evaluation_preparations WHERE id=?').get(identifier(skillEvaluation.preparation_id, 'Preparation ID'));
  if (!row || row.prepared_by !== actor?.id || !Number.isSafeInteger(skillEvaluation.preparation_version) || row.version !== skillEvaluation.preparation_version) fail('Evaluation preparation changed. Review it again.', 'stale_preparation', 409);
  if (!['prepared', 'bound'].includes(row.status) || row.expires_at <= Date.now() && row.status === 'prepared') fail('Evaluation preparation is unavailable.', 'preparation_expired', 409);
  assertPreparedAccess(db, row, actor, allowed);
  if (row.canonical_run_id) {
    assertRunContextAccess(db, row.canonical_run_id, actor, allowed);
    const evaluation = db.prepare('SELECT * FROM skill_evaluations WHERE preparation_id=?').get(row.id);
    if (evaluation && !evaluationReadable(db, skillRow(db, row.skill_id), evaluation, actor, allowed)) fail('Evaluation evidence is outside your access.', 'access_denied', 403);
  }
  const saved = parse(row.source_access_json);
  return { ...saved, allowed_native_tools: row.native_tools ? parse(db.prepare('SELECT definition_json FROM skill_versions WHERE id=?').get(row.version_id)?.definition_json, {}).allowed_tools || [] : [] };
}

function equalToken(actual, expectedHash) {
  if (typeof actual !== 'string' || actual.length > 200) return false;
  const left = Buffer.from(hash(actual)), right = Buffer.from(expectedHash || ''); return left.length === right.length && timingSafeEqual(left, right);
}
export function bindSkillEvaluationRun({ db, runId, skillEvaluation, actor, allowed }) {
  if (!object(skillEvaluation)) fail('Skill evaluation binding is required.');
  assertBinding(skillEvaluation, true);
  const row = db.prepare('SELECT * FROM skill_evaluation_preparations WHERE id=?').get(identifier(skillEvaluation.preparation_id, 'Preparation ID'));
  if (!row || row.prepared_by !== actor?.id) fail('Evaluation preparation unavailable.', 'access_denied', 403);
  if (row.status === 'bound' && row.canonical_run_id === runId) return decodePreparation(row);
  if (row.status !== 'prepared' || row.expires_at <= Date.now()) fail('Evaluation preparation is no longer launchable.', 'preparation_expired', 409);
  if (row.version !== skillEvaluation.preparation_version || !equalToken(skillEvaluation.preparation_token, row.token_hash)) fail('Evaluation preparation token is invalid.', 'invalid_preparation_token', 409);
  const skill = assertPreparedAccess(db, row, actor, allowed); authorize(db, skill, actor, allowed, true);
  agentRow(db, skill, row.agent_id, row.profile_version, actor, allowed);
  const run = db.prepare('SELECT * FROM runs WHERE id=?').get(identifier(runId, 'Run ID'));
  const sponsor = db.prepare('SELECT actor_id FROM agent_run_sponsors WHERE run_id=?').get(runId);
  if (!run || run.mode !== 'live' || sponsor?.actor_id !== actor.id || run.workspace_id !== row.workspace_id || (run.project_id || null) !== (row.project_id || null) || run.task_id || run.chat_id || run.agent_id !== row.agent_id || run.agent_profile_version !== row.profile_version || run.timeout_ms !== row.timeout_ms) fail('Canonical run does not match the prepared evaluation.', 'invalid_scope', 409);
  const inspection = assertRunContextAccess(db, runId, actor, allowed), request = inspection?.request;
  if (!request || hash(selectedRequest(request)) !== row.request_hash) fail('Captured run context differs from the reviewed evaluation request.', 'context_mismatch', 409);
  const result = db.prepare("UPDATE skill_evaluation_preparations SET status='bound',canonical_run_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status='prepared'").run(runId, now(), row.id, row.version);
  if (result.changes !== 1) fail('Evaluation preparation was already consumed.', 'preparation_consumed', 409);
  return decodePreparation(db.prepare('SELECT * FROM skill_evaluation_preparations WHERE id=?').get(row.id));
}

export function replaySkillEvaluationRun({ db, skillEvaluation, actor, allowed, request, inspectionId }) {
  if (!object(skillEvaluation)) fail('Skill evaluation binding is required.');
  assertBinding(skillEvaluation, true);
  const row = db.prepare('SELECT * FROM skill_evaluation_preparations WHERE id=?').get(identifier(skillEvaluation.preparation_id, 'Preparation ID'));
  if (!row || row.prepared_by !== actor?.id) fail('Evaluation preparation unavailable.', 'access_denied', 403);
  assertPreparedAccess(db, row, actor, allowed);
  const expectedVersion = parse(row.context_request_json, {})?.skill_evaluation?.preparation_version;
  if (expectedVersion !== skillEvaluation.preparation_version || !equalToken(skillEvaluation.preparation_token, row.token_hash)) fail('Evaluation preparation token is invalid.', 'invalid_preparation_token', 409);
  if (!request || hash(selectedRequest(request)) !== row.request_hash) fail('Launch request differs from the prepared evaluation.', 'context_mismatch', 409);
  if (row.canonical_run_id && (!inspectionId || !db.prepare('SELECT 1 FROM run_context_inspections WHERE id=? AND consumed_run_id=?').get(inspectionId, row.canonical_run_id))) fail('Reviewed context does not belong to the bound evaluation run.', 'context_mismatch', 409);
  if (row.canonical_run_id) {
    assertRunContextAccess(db, row.canonical_run_id, actor, allowed);
    const evaluation = db.prepare('SELECT * FROM skill_evaluations WHERE preparation_id=?').get(row.id), skill = skillRow(db, row.skill_id);
    if (evaluation && !evaluationReadable(db, skill, evaluation, actor, allowed)) fail('Evaluation evidence is outside your access.', 'access_denied', 403);
  }
  return row.canonical_run_id ? { run_id: row.canonical_run_id, status: row.status } : null;
}

function runError(db, runId) {
  const event = db.prepare("SELECT payload_json FROM run_events WHERE run_id=? AND type='run.failed' ORDER BY sequence DESC LIMIT 1").get(runId);
  return parse(event?.payload_json, {})?.error_code || null;
}
function artifact(db, preparation, input, outcome, actor, allowed) {
  if (!object(input) || !['run_event', 'output_version'].includes(input.type)) fail('Choose an exact terminal run event or output version.');
  assertFields(input, ['type', 'id']);
  if (input.type === 'run_event') {
    const row = db.prepare('SELECT * FROM run_events WHERE id=? AND run_id=?').get(identifier(input.id, 'Artifact ID'), preparation.canonical_run_id);
    if (!row || !['run.completed', 'run.failed', 'run.stopped'].includes(row.type)) fail('Choose a terminal event from this canonical run.', 'invalid_evidence', 409);
    if (outcome === 'passed' && row.type !== 'run.completed') fail('Stopped or failed runs cannot pass.', 'invalid_evidence', 409);
    const payload = parse(row.payload_json, {}), candidates = row.type === 'run.completed' ? [payload.summary, payload.text, payload.output] : [payload.error, payload.summary, payload.text, payload.output], exact = candidates.find(value => typeof value === 'string' && value.trim());
    if (row.type === 'run.completed' && !exact) fail('Completed run has no exact result artifact to review.', 'invalid_evidence', 409);
    return { type: 'run_event', id: row.id, content: exact || row.summary };
  }
  const row = db.prepare(`SELECT v.*,o.run_id,o.archived_at FROM output_versions v JOIN outputs o ON o.id=v.output_id WHERE v.id=?`).get(identifier(input.id, 'Artifact ID'));
  if (!row || row.run_id !== preparation.canonical_run_id || row.archived_at) fail('Choose an output version from this canonical run.', 'invalid_evidence', 409);
  const output = db.prepare('SELECT * FROM outputs WHERE id=?').get(row.output_id), target = output?.project_id ? { scope_type: 'project', scope_id: output.project_id } : {};
  if (!output || allowed(preparation.workspace_id, actor, 'documents.read', target) !== true) fail('Output evidence is outside your access.', 'access_denied', 403);
  return { type: 'output_version', id: row.id, content: row.content };
}
function finalize(db, skill, body, actor, allowed) {
  authorize(db, skill, actor, allowed, true);
  const replay = idempotent(db, skill, actor, 'finalize', body);
  if (replay?.row) {
    const old = db.prepare('SELECT * FROM skill_evaluations WHERE id=? AND skill_id=?').get(replay.row.target_id, skill.id);
    if (!old) fail('Evaluation unavailable.', 'not_found', 404);
    if (!evaluationReadable(db, skill, old, actor, allowed)) fail('Evaluation evidence is outside your access.', 'access_denied', 403);
    return decodeEvaluation(old);
  }
  if (!['passed', 'failed'].includes(body.outcome)) fail('Choose passed or failed.');
  const preparation = preparationById(db, skill, body.preparation_id); assertPreparedAccess(db, preparation, actor, allowed);
  if (preparation.status !== 'bound' || !preparation.canonical_run_id) fail('Only a bound canonical run can be evaluated.', 'invalid_evidence', 409);
  const run = db.prepare('SELECT * FROM runs WHERE id=?').get(preparation.canonical_run_id);
  if (!run || run.mode !== 'live' || !['completed', 'failed', 'stopped'].includes(run.status)) fail('Wait for the canonical live run to finish.', 'run_not_terminal', 409);
  if (body.outcome === 'passed' && run.status !== 'completed') fail('Stopped or failed runs cannot pass.', 'invalid_evidence', 409);
  const capturedInspection = assertRunContextAccess(db, run.id, actor, allowed);
  const exact = artifact(db, preparation, body.artifact, body.outcome, actor, allowed);
  const profile = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? AND version=?').get(preparation.agent_id, preparation.profile_version);
  const inspection = capturedInspection;
  if (!profile || !inspection?.manifest?.fingerprint) fail('Pinned run provenance is unavailable.', 'invalid_evidence', 409);
  const id = uid('skeval'), created = now(), notes = boundedText(body.notes ?? '', 'Evaluation notes', 10000), evidence = exact.content.slice(0, 20000), errorCode = runError(db, run.id);
  const profileData = parse(profile.snapshot_json, {}), profilePublic = Object.fromEntries(['name', 'provider', 'model', 'reasoning_effort', 'role', 'output_behavior'].map(key => [key, profileData[key] ?? null]));
  db.prepare(`INSERT INTO skill_evaluations
    (id,skill_id,workspace_id,version_id,version_number,test_case_id,test_case_name,inputs_json,input_hash,expected_output_hash,preparation_id,run_id,artifact_type,artifact_id,artifact_hash,artifact_content,run_status,run_error_code,outcome,evidence,notes,mode,evaluator_id,agent_id,profile_version,profile_snapshot_hash,context_fingerprint,provenance_json,evidence_version,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, skill.id, skill.workspace_id, preparation.version_id, preparation.version_number, preparation.test_case_id, preparation.test_case_name, preparation.inputs_json, preparation.input_hash, preparation.expected_output_hash, preparation.id, run.id, exact.type, exact.id, hash(exact.content), exact.content, run.status, errorCode, body.outcome, evidence, notes, 'reviewed_live', actor.id, preparation.agent_id, preparation.profile_version, profile.snapshot_hash, inspection.manifest.fingerprint, canonical({ preparation_version: preparation.version, reviewed_artifact: { type: exact.type, id: exact.id, hash: hash(exact.content) }, profile: profilePublic, work_mode: preparation.work_mode, permission_mode: preparation.permission_mode, timeout_ms: preparation.timeout_ms }), 2, created);
  db.prepare("UPDATE skill_evaluation_preparations SET status='evaluated',version=version+1,updated_at=? WHERE id=? AND status='bound'").run(created, preparation.id);
  remember(db, skill, actor, replay?.key, 'finalize', replay?.expected, id);
  return decodeEvaluation(db.prepare('SELECT * FROM skill_evaluations WHERE id=?').get(id));
}
function compare(db, skill, body, actor, allowed) {
  authorize(db, skill, actor, allowed, true);
  const replay = idempotent(db, skill, actor, 'compare', body);
  if (replay?.row) {
    const saved = db.prepare('SELECT * FROM skill_evaluation_comparisons WHERE id=? AND skill_id=?').get(replay.row.target_id, skill.id);
    if (!saved) fail('Comparison unavailable.', 'not_found', 404);
    for (const id of [saved.left_evaluation_id, saved.right_evaluation_id]) { const evaluation = db.prepare('SELECT * FROM skill_evaluations WHERE id=?').get(id); if (!evaluation || !evaluationReadable(db, skill, evaluation, actor, allowed)) fail('Evaluation evidence is outside your access.', 'access_denied', 403); }
    return decodeComparison(saved);
  }
  if (!['left_better', 'right_better', 'equivalent', 'inconclusive'].includes(body.decision)) fail('Comparison decision is invalid.');
  const left = db.prepare('SELECT * FROM skill_evaluations WHERE id=? AND skill_id=?').get(identifier(body.left_evaluation_id, 'Left evaluation ID'), skill.id);
  const right = db.prepare('SELECT * FROM skill_evaluations WHERE id=? AND skill_id=?').get(identifier(body.right_evaluation_id, 'Right evaluation ID'), skill.id);
  if (!left || !right || left.id === right.id || left.test_case_id !== right.test_case_id || left.input_hash !== right.input_hash) fail('Comparisons require two different evaluations of the same exact case and inputs.', 'comparison_mismatch', 409);
  for (const row of [left, right]) if (!evaluationReadable(db, skill, row, actor, allowed)) fail('Evaluation evidence is outside your access.', 'access_denied', 403);
  const result = { id: uid('skcmp'), skill_id: skill.id, workspace_id: skill.workspace_id, test_case_id: left.test_case_id, input_hash: left.input_hash, left_evaluation_id: left.id, right_evaluation_id: right.id, decision: body.decision, rationale: boundedText(body.rationale ?? '', 'Comparison rationale', 10000, true), evaluator_id: actor.id, created_at: now() };
  db.prepare('INSERT INTO skill_evaluation_comparisons VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(result));
  remember(db, skill, actor, replay?.key, 'compare', replay?.expected, result.id); return result;
}
function evaluationReadable(db, skill, row, actor, allowed) {
  try {
    const preparation = preparationById(db, skill, row.preparation_id); assertPreparedAccess(db, preparation, actor, allowed); assertRunContextAccess(db, row.run_id, actor, allowed);
    if (row.artifact_type === 'output_version') {
      const output = db.prepare('SELECT o.* FROM output_versions v JOIN outputs o ON o.id=v.output_id WHERE v.id=?').get(row.artifact_id);
      if (!output || output.archived_at || allowed(skill.workspace_id, actor, 'documents.read', output.project_id ? { scope_type: 'project', scope_id: output.project_id } : {}) !== true) return false;
    }
    return true;
  } catch { return false; }
}
function coverage(db, skill, version, actor, allowed) {
  const evaluations = db.prepare('SELECT * FROM skill_evaluations WHERE skill_id=? AND version_id=? ORDER BY created_at DESC,rowid DESC').all(skill.id, version.id);
  const latest = new Map(); for (const row of evaluations) if (!latest.has(row.test_case_id)) latest.set(row.test_case_id, row);
  const cases = version.definition.test_cases.map(testCase => {
    let evaluation = testCase.id ? latest.get(testCase.id) : null;
    if (evaluation && actor && allowed && !evaluationReadable(db, skill, evaluation, actor, allowed)) evaluation = null;
    return { test_case_id: testCase.id || null, name: testCase.name, status: evaluation?.outcome || 'missing', evaluation_id: evaluation?.id || null };
  });
  const passed = cases.filter(item => item.status === 'passed').length, failed = cases.filter(item => item.status === 'failed').length, missing = cases.length - passed - failed;
  const legacy = version.definition.evidence_policy_version !== 2;
  return { version_id: version.id, total: cases.length, passed, failed, missing, complete: !legacy && missing === 0, publishable: !legacy && cases.length > 0 && passed === cases.length, cases, ...(legacy ? { legacy: true } : {}) };
}
function terminalArtifacts(db, preparation, actor, allowed) {
  if (!preparation.canonical_run_id) return [];
  const run = db.prepare('SELECT * FROM runs WHERE id=?').get(preparation.canonical_run_id);
  if (!run || run.mode !== 'live' || !['completed', 'failed', 'stopped'].includes(run.status)) return [];
  assertRunContextAccess(db, run.id, actor, allowed);
  const events = db.prepare("SELECT * FROM run_events WHERE run_id=? AND type IN ('run.completed','run.failed','run.stopped') ORDER BY sequence DESC").all(run.id).flatMap(row => {
    const payload = parse(row.payload_json, {}), content = [payload.summary, payload.text, payload.output, payload.error].find(value => typeof value === 'string' && value.trim()) || row.summary;
    return row.type === 'run.completed' && ![payload.summary, payload.text, payload.output].some(value => typeof value === 'string' && value.trim()) ? [] : [{ type: 'run_event', id: row.id, title: row.type, content, hash: hash(content) }];
  });
  const versions = db.prepare(`SELECT v.*,o.title,o.project_id,o.archived_at FROM output_versions v JOIN outputs o ON o.id=v.output_id WHERE o.run_id=? ORDER BY v.created_at DESC`).all(run.id).filter(row => !row.archived_at && allowed(preparation.workspace_id, actor, 'documents.read', row.project_id ? { scope_type: 'project', scope_id: row.project_id } : {}) === true).map(row => ({ type: 'output_version', id: row.id, title: row.title, content: row.content, hash: hash(row.content) }));
  return [...events, ...versions];
}
export function assertSkillReliabilityCoverage(db, skill, version, actor, allowed) {
  const result = coverage(db, skill, version, actor, allowed); if (!result.publishable) fail('Every test case in this exact Skill version needs a passed reviewed live evaluation.', 'evaluation_required', 409); return result;
}
export function skillReliabilityDetail({ db, skill, actor, allowed }) {
  authorize(db, skill, actor, allowed);
  const current = versionRow(db, skill, db.prepare('SELECT id FROM skill_versions WHERE skill_id=? AND number=?').get(skill.id, skill.version)?.id, { requireV2: false });
  const preparationRows = db.prepare('SELECT * FROM skill_evaluation_preparations WHERE skill_id=? ORDER BY created_at DESC LIMIT 100').all(skill.id).filter(row => { try { assertPreparedAccess(db, row, actor, allowed); if (row.canonical_run_id) assertRunContextAccess(db, row.canonical_run_id, actor, allowed); return true; } catch { return false; } });
  const preparations = preparationRows.map(row => ({ ...decodePreparation(row), artifacts: terminalArtifacts(db, row, actor, allowed) }));
  const visibleIds = new Set(preparations.map(row => row.id));
  const evaluations = db.prepare('SELECT * FROM skill_evaluations WHERE skill_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(skill.id).filter(row => visibleIds.has(row.preparation_id) && evaluationReadable(db, skill, row, actor, allowed)).map(decodeEvaluation);
  const evalIds = new Set(evaluations.map(row => row.id));
  const comparisons = db.prepare('SELECT * FROM skill_evaluation_comparisons WHERE skill_id=? ORDER BY created_at DESC LIMIT 100').all(skill.id).filter(row => evalIds.has(row.left_evaluation_id) && evalIds.has(row.right_evaluation_id)).map(decodeComparison);
  return { policy_version: current.definition.evidence_policy_version || 1, coverage: coverage(db, skill, current, actor, allowed), preparations, evaluations, comparisons };
}

export async function skillReliabilityRoute({ db, req, res, path, body, send, actor, allowed }) {
  let match = path.match(/^\/skills\/([^/]+)\/reliability$/);
  if (match) {
    if (req.method !== 'GET') fail('Unsupported reliability operation.', 'method_not_allowed', 405);
    const skill = skillRow(db, decodeURIComponent(match[1])); send(res, 200, { result: skillReliabilityDetail({ db, skill, actor, allowed }) }); return true;
  }
  match = path.match(/^\/skills\/([^/]+)\/evaluation-preparations\/([^/]+)\/cancel$/);
  if (match) {
    if (req.method !== 'POST') fail('Unsupported reliability operation.', 'method_not_allowed', 405);
    assertFields(body, ['version', 'request_id']);
    const skill = skillRow(db, decodeURIComponent(match[1])); authorize(db, skill, actor, allowed, true); const row = preparationById(db, skill, decodeURIComponent(match[2])); assertPreparedAccess(db, row, actor, allowed);
    const operation = `cancel:${row.id}`, replay = idempotent(db, skill, actor, operation, body);
    if (replay?.row) { const current = preparationById(db, skill, replay.row.target_id); assertPreparedAccess(db, current, actor, allowed); send(res, 200, { result: decodePreparation(current), replayed: true }); return true; }
    if (row.prepared_by !== actor.id || row.status !== 'prepared' || row.version !== body.version) fail('Preparation changed or cannot be cancelled.', 'stale_preparation', 409);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE skill_evaluation_preparations SET status='cancelled',version=version+1,updated_at=? WHERE id=? AND version=?").run(now(), row.id, row.version);
      remember(db, skill, actor, replay?.key, operation, replay?.expected, row.id); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    send(res, 200, { result: decodePreparation(db.prepare('SELECT * FROM skill_evaluation_preparations WHERE id=?').get(row.id)) }); return true;
  }
  match = path.match(/^\/skills\/([^/]+)\/(evaluations\/prepare|evaluations|comparisons)$/); if (!match) return false;
  if (req.method !== 'POST') fail('Unsupported reliability operation.', 'method_not_allowed', 405);
  const skill = skillRow(db, decodeURIComponent(match[1])), action = match[2];
  assertFields(body, action === 'evaluations/prepare'
    ? ['skill_version_id', 'test_case_id', 'agent_id', 'profile_version', 'work_mode', 'permission_mode', 'include_memory', 'native_tools', 'timeout_ms', 'cwd', 'request_id']
    : action === 'evaluations' ? ['preparation_id', 'outcome', 'notes', 'artifact', 'request_id']
      : ['left_evaluation_id', 'right_evaluation_id', 'decision', 'rationale', 'request_id']);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action === 'evaluations/prepare' ? prepare(db, skill, body, actor, allowed) : action === 'evaluations' ? finalize(db, skill, body, actor, allowed) : compare(db, skill, body, actor, allowed);
    db.exec('COMMIT'); send(res, action === 'evaluations/prepare' ? 201 : 200, { result }); return true;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

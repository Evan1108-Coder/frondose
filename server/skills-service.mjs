import { createHash, randomUUID } from 'node:crypto';
import { recordChange } from './workspace-features.mjs';
import { assertSkillReliabilityCoverage } from './skill-reliability-service.mjs';

const uid = kind => `${kind}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const stamp = () => new Date().toISOString();
const fail = (message, code = 'invalid_skill', statusCode = 400) => { throw Object.assign(new Error(message), { code, statusCode }); };
const text = (value, label, max = 20000, required = false) => { if (typeof value !== 'string' || value.length > max || required && !value.trim()) fail(`${label} must be ${required ? 'nonempty ' : ''}text under ${max} characters.`); return value.trim(); };
const list = (value, label, max = 50) => { if (!Array.isArray(value) || value.length > max) fail(`${label} must contain at most ${max} entries.`); return value; };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const decode = row => row && Object.fromEntries(Object.entries(row).map(([key, value]) => key.endsWith('_json') ? [key.slice(0, -5), JSON.parse(value)] : [key, value]));
const FIELDS = ['name', 'purpose', 'instructions', 'inputs', 'required_context', 'allowed_tools', 'preferred_agent_id', 'required_capabilities', 'output_format', 'examples', 'approval_policy', 'test_cases'];
const REFS = { document: 'documents', memory: 'memory_notes', knowledge: 'knowledge_entries', pack: 'workspace_items' };
export const SKILL_TOOLS = ['search_workspace', 'get_area_context', 'get_project_context', 'get_route', 'search_knowledge', 'read_document', 'create_draft_route', 'propose_project_update', 'save_memory_candidate', 'request_permission', 'submit_output', 'handoff_to_agent'];

export function installSkills(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE NO ACTION, team_id TEXT REFERENCES teams(id) ON DELETE NO ACTION,
    name TEXT NOT NULL, purpose TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1,
    published_version INTEGER, provenance_json TEXT NOT NULL DEFAULT '{}', archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS skill_versions (
    id TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, number INTEGER NOT NULL,
    definition_json TEXT NOT NULL, author_id TEXT, created_at TEXT NOT NULL, UNIQUE(skill_id,number));
    CREATE TABLE IF NOT EXISTS skill_test_runs (
    id TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, version_id TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
    inputs_json TEXT NOT NULL, outcome TEXT NOT NULL, evidence TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'manual', evaluator_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS skill_request_keys (
    workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
    skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE, result_json TEXT NOT NULL,
    PRIMARY KEY(workspace_id,actor_id,request_key));
    CREATE INDEX IF NOT EXISTS skills_workspace ON skills(workspace_id);
    CREATE INDEX IF NOT EXISTS skill_tests_version ON skill_test_runs(skill_id,version_id);`);
}
const at = skill => skill.project_id ? { scope_type: 'project', scope_id: skill.project_id } : skill.team_id ? { scope_type: 'team', scope_id: skill.team_id } : {};
function active(db, table, id, ws) { const row = typeof id === 'string' && id && db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id); if (!row || row.workspace_id !== ws || row.archived_at) fail('A referenced item is unavailable or outside this workspace.', 'invalid_scope'); return row; }
function agentInWorkspace(db, id, ws) { const row = typeof id === 'string' && id && db.prepare('SELECT * FROM agents WHERE id=?').get(id); if (!row || row.workspace_id && row.workspace_id !== ws || row.archived_at) fail('Preferred agent is unavailable or outside this workspace.', 'invalid_scope'); return row; }
function authorized(db, skill, actor, allowed, write = false) {
  if (typeof skill.workspace_id !== 'string' || !skill.workspace_id) fail('Choose a workspace.', 'invalid_scope');
  if (!db.prepare('SELECT id FROM workspaces WHERE id=? AND archived_at IS NULL').get(skill.workspace_id)) fail('Workspace unavailable.', 'not_found', 404);
  if (skill.project_id) { const project = active(db, 'projects', skill.project_id, skill.workspace_id); if (project.team_id) active(db, 'teams', project.team_id, skill.workspace_id); }
  if (skill.team_id) active(db, 'teams', skill.team_id, skill.workspace_id);
  if (!allowed(skill.workspace_id, actor, write ? 'agents.write' : 'agents.read', at(skill))) fail('Skill access denied.', 'access_denied', 403);
}
function contextReadable(db, ws, ref, actor, allowed) {
  const table = REFS[ref.kind]; if (!table) fail('Unknown required context kind.');
  const source = active(db, table, ref.id, ws);
  if (!allowed(ws, actor, table === 'workspace_items' ? 'workspace.read' : 'documents.read', at(source))) fail('Required context is outside your access.', 'access_denied', 403);
  if (table === 'workspace_items') {
    if (source.kind !== 'context_pack') fail('Choose a Context Pack.');
    const payload = JSON.parse(source.payload_json);
    for (const id of payload.document_ids || []) contextReadable(db, ws, { kind: 'document', id }, actor, allowed);
    for (const id of payload.memory_ids || []) contextReadable(db, ws, { kind: 'memory', id }, actor, allowed);
  }
}
export function validateSkillDefinition(db, ws, input, actor, allowed = () => true, options = {}) {
  if (!record(input)) fail('Provide a Skill definition.');
  const value = {
    name: text(input.name, 'Name', 200, true), purpose: text(input.purpose ?? '', 'Purpose', 2000, true),
    instructions: text(input.instructions ?? '', 'Instructions', 30000), output_format: text(input.output_format ?? '', 'Output format', 4000),
    preferred_agent_id: input.preferred_agent_id || null, approval_policy: input.approval_policy ?? 'always',
  };
  if (value.approval_policy !== 'always') fail('Skills cannot bypass review or grant execution permissions.');
  if (value.preferred_agent_id) { const agent = agentInWorkspace(db, value.preferred_agent_id, ws); if (!allowed(ws, actor, 'agents.read', agent.workspace_id ? { scope_type: 'agent', scope_id: agent.id } : {})) fail('Preferred agent is outside your access.', 'access_denied', 403); }
  const seen = new Set();
  value.inputs = list(input.inputs ?? [], 'Inputs', 30).map(item => {
    if (!record(item) || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item.name || '') || seen.has(item.name) || !['string', 'number', 'boolean', 'enum'].includes(item.type) || typeof (item.required ?? false) !== 'boolean') fail('Define unique typed inputs with valid names.');
    seen.add(item.name); const result = { name: item.name, type: item.type, required: item.required ?? false, description: text(item.description ?? '', 'Input description', 1000) };
    if (item.type === 'enum') { result.options = list(item.options, 'Enum options', 30).map(option => text(option, 'Enum option', 200, true)); if (!result.options.length || new Set(result.options).size !== result.options.length) fail('Enum inputs need unique options.'); }
    return result;
  });
  value.required_context = list(input.required_context ?? [], 'Required context', 30).map(ref => { if (!record(ref) || !REFS[ref.kind]) fail('Provide typed required context references.'); const result = { kind: ref.kind, id: text(ref.id, 'Context ID', 200, true) }; contextReadable(db, ws, result, actor, allowed); return result; });
  if (new Set(value.required_context.map(ref => `${ref.kind}:${ref.id}`)).size !== value.required_context.length) fail('Required context references must be unique.');
  value.allowed_tools = list(input.allowed_tools ?? [], 'Tools').map(tool => { if (!SKILL_TOOLS.includes(tool)) fail('Unknown Skill tool preference.'); return tool; });
  if (new Set(value.allowed_tools).size !== value.allowed_tools.length) fail('Tool preferences must be unique.');
  value.required_capabilities = list(input.required_capabilities ?? [], 'Capabilities', 20).map(item => text(item, 'Capability', 120, true));
  value.examples = list(input.examples ?? [], 'Examples', 20).map(item => { if (!record(item)) fail('Examples require input and output.'); validateSkillInputs(value, item.inputs); return { inputs: item.inputs, output: text(item.output, 'Example output', 10000, true) }; });
  value.evidence_policy_version = options.upgradeReliability ? 2 : input.evidence_policy_version === 2 ? 2 : 1;
  const caseIds = new Set();
  value.test_cases = list(input.test_cases ?? [], 'Test cases', 30).map(item => {
    if (!record(item)) fail('Test cases require a name, inputs and expected output.'); validateSkillInputs(value, item.inputs);
    const result = { name: text(item.name, 'Test name', 200, true), inputs: item.inputs, expected_output: text(item.expected_output, 'Expected output', 10000, true) };
    if (value.evidence_policy_version === 2) {
      result.id = item.id === undefined ? `case_${randomUUID().replaceAll('-', '').slice(0, 20)}` : text(item.id, 'Test case ID', 80, true);
      if (!/^[A-Za-z0-9_.:-]+$/.test(result.id) || caseIds.has(result.id)) fail('Test case IDs must be unique stable identifiers.');
      caseIds.add(result.id);
    }
    return result;
  });
  if (JSON.stringify(value).length > 150000) fail('Skill definition exceeds 150 KB.');
  return value;
}
export function validateSkillInputs(definition, inputs) {
  if (!record(inputs) || JSON.stringify(inputs).length > 30000) fail('Test inputs must be an object under 30 KB.');
  if (Object.keys(inputs).some(key => !definition.inputs.some(field => field.name === key))) fail('Unexpected Skill input.');
  for (const field of definition.inputs) {
    const value = inputs[field.name]; if (value === undefined) { if (field.required) fail(`Input ${field.name} is required.`); continue; }
    if (field.type === 'enum' ? !field.options.includes(value) : typeof value !== field.type || field.type === 'number' && !Number.isFinite(value)) fail(`Input ${field.name} has an invalid type or value.`);
  }
}
export function skillSnapshot(db) { return Object.fromEntries(['skills', 'skill_versions', 'skill_test_runs'].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all().map(decode)])); }
function definition(db, skill, version = skill.version) { const row = decode(db.prepare('SELECT * FROM skill_versions WHERE skill_id=? AND number=?').get(skill.id, version)); if (!row) fail('Skill version unavailable.', 'not_found', 404); return row; }
function summary(db, skill) { return { ...skill, ...definition(db, skill).definition }; }
export function skillVisible(db, item, table, actor, allowed) {
  try {
    const skill = table === 'skills' ? item : db.prepare('SELECT * FROM skills WHERE id=?').get(item.skill_id);
    if (!skill) return false; authorized(db, skill, actor, allowed);
    const versions = table === 'skill_versions' ? [item] : db.prepare('SELECT * FROM skill_versions WHERE skill_id=?').all(skill.id);
    for (const version of versions) {
      const value = version.definition || JSON.parse(version.definition_json);
      for (const ref of value.required_context || []) contextReadable(db, skill.workspace_id, ref, actor, allowed);
      if (value.preferred_agent_id) { const agent = agentInWorkspace(db, value.preferred_agent_id, skill.workspace_id); if (!allowed(skill.workspace_id, actor, 'agents.read', agent.workspace_id ? { scope_type: 'agent', scope_id: agent.id } : {})) return false; }
    }
    return true;
  } catch { return false; }
}
function insertVersion(db, skill, value, actor) { db.prepare('INSERT INTO skill_versions VALUES(?,?,?,?,?,?,?)').run(uid('skillv'), skill.id, skill.workspace_id, skill.version, JSON.stringify(value), actor?.id || null, stamp()); }

export async function skillsRoute({ db, req, res, path, url, body, send, actor, allowed }) {
  const match = path.match(/^\/skills(?:\/([^/]+))?(?:\/(test|publish))?$/); if (!match) return false;
  const identifier = match[1], action = match[2], converting = identifier === 'from-run' && !action;
  let skill = identifier && !converting ? decode(db.prepare('SELECT * FROM skills WHERE id=?').get(decodeURIComponent(identifier))) : null;
  if (identifier && !converting && !skill) fail('Skill unavailable.', 'not_found', 404);
  const ws = skill?.workspace_id || (req.method === 'GET' ? url.searchParams.get('workspace_id') : body.workspace_id);
  if (skill) { authorized(db, skill, actor, allowed, req.method !== 'GET'); if (!skillVisible(db, skill, 'skills', actor, allowed)) fail('Skill context is unavailable.', 'access_denied', 403); }
  else authorized(db, { workspace_id: ws }, actor, allowed, req.method !== 'GET');
  if (body.workspace_id && body.workspace_id !== ws) fail('Skill belongs to another workspace.', 'invalid_scope');
  if (req.method === 'GET') {
    if (!identifier) return send(res, 200, { result: db.prepare('SELECT * FROM skills WHERE workspace_id=? ORDER BY updated_at DESC').all(ws).map(decode).filter(row => skillVisible(db, row, 'skills', actor, allowed)).map(row => summary(db, row)) }), true;
    if (action) fail('Unknown Skill read operation.', 'not_found', 404);
    send(res, 200, { result: { skill: summary(db, skill), versions: db.prepare('SELECT * FROM skill_versions WHERE skill_id=? ORDER BY number DESC').all(skill.id).map(decode), test_runs: db.prepare('SELECT * FROM skill_test_runs WHERE skill_id=? ORDER BY created_at DESC').all(skill.id).map(decode) } }); return true;
  }
  const lifecycle = skill && req.method === 'PATCH' && Object.hasOwn(body, 'archived_at');
  if (lifecycle) {
    if (body.archived_at !== null && (typeof body.archived_at !== 'string' || !Number.isFinite(Date.parse(body.archived_at)) || body.confirmed !== true)) fail('Confirm archiving this Skill.');
    if (Object.keys(body).some(key => !['archived_at', 'confirmed', 'version', 'workspace_id', 'request_id'].includes(key))) fail('Archive and restore must be separate from content edits.');
    if (body.archived_at && !allowed(ws, actor, 'agents.delete', at(skill))) fail('Archive permission required.', 'access_denied', 403);
  }
  let source = null;
  if (converting) {
    source = active(db, 'runs', body.run_id, ws);
    if (source.status !== 'completed') fail('Only completed runs can become draft Skills.');
    if (source.task_id) {
      const route = active(db, 'tasks', source.task_id, ws);
      if (!allowed(ws, actor, 'routes.read', at(route))) fail('Source Route is outside your access.', 'access_denied', 403);
      source = { ...source, team_id: route.team_id || null };
    }
    authorized(db, source, actor, allowed);
  }
  const requestKey = body.request_id;
  if (requestKey !== undefined && (typeof requestKey !== 'string' || !/^[\w-]{1,120}$/.test(requestKey))) fail('Invalid request ID.');
  const fingerprint = createHash('sha256').update(JSON.stringify({ method: req.method, path, body: { ...body, request_id: undefined } })).digest('hex');
  if (requestKey) {
    const old = db.prepare('SELECT * FROM skill_request_keys WHERE workspace_id=? AND actor_id=? AND request_key=?').get(ws, actor.id, requestKey);
    if (old) { if (old.fingerprint !== fingerprint) fail('Request ID already used for different input.', 'idempotency_conflict', 409); const original = db.prepare('SELECT * FROM skills WHERE id=?').get(old.skill_id); if (!original || !skillVisible(db, original, 'skills', actor, allowed)) fail('Skill unavailable.', 'access_denied', 403); send(res, 200, { result: JSON.parse(old.result_json), replayed: true }); return true; }
  }
  if (skill?.archived_at && !(lifecycle && body.archived_at === null)) fail('Restore this Skill before changing it.');
  if (skill && (!Number.isInteger(body.version) || body.version !== skill.version)) fail('Skill changed. Reload the latest version.', 'stale_version', 409);
  db.exec('BEGIN IMMEDIATE');
  try {
    let result, before = skill;
    if ((!identifier || converting) && req.method === 'POST') {
      const value = validateSkillDefinition(db, ws, body, actor, allowed, { upgradeReliability: true }), now = stamp();
      const projectId = source?.project_id || body.project_id || null, teamId = source?.team_id || body.team_id || (projectId ? db.prepare('SELECT team_id FROM projects WHERE id=?').get(projectId)?.team_id : null) || null;
      skill = { id: uid('skill'), workspace_id: ws, project_id: projectId, team_id: teamId, name: value.name, purpose: value.purpose, state: 'draft', version: 1, published_version: null, provenance: source ? { run_id: source.id, conversion: 'sanitized_draft', context_copied: false } : {}, archived_at: null, created_at: now, updated_at: now };
      authorized(db, skill, actor, allowed, true);
      if (projectId && teamId && active(db, 'projects', projectId, ws).team_id !== teamId) fail('Skill project and Area must match.', 'invalid_scope');
      db.prepare('INSERT INTO skills VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(skill.id, ws, projectId, teamId, skill.name, skill.purpose, skill.state, 1, null, JSON.stringify(skill.provenance), null, now, now);
      insertVersion(db, skill, value, actor); result = summary(db, skill);
    } else if (lifecycle && !action) {
      const value = definition(db, skill).definition;
      skill = { ...skill, version: skill.version + 1, state: 'draft', published_version: null, archived_at: body.archived_at === null ? null : stamp(), updated_at: stamp() };
      db.prepare('UPDATE skills SET version=?,state=?,published_version=NULL,archived_at=?,updated_at=? WHERE id=?').run(skill.version, skill.state, skill.archived_at, skill.updated_at, skill.id);
      insertVersion(db, skill, value, actor); result = summary(db, skill);
    } else if (skill && req.method === 'PATCH' && !action) {
      if (Object.keys(body).some(key => ![...FIELDS, 'version', 'request_id', 'workspace_id'].includes(key))) fail('Unknown editable Skill field.');
      const value = validateSkillDefinition(db, ws, { ...definition(db, skill).definition, ...body }, actor, allowed, { upgradeReliability: true });
      skill = { ...skill, name: value.name, purpose: value.purpose, version: skill.version + 1, state: 'draft', updated_at: stamp() };
      db.prepare('UPDATE skills SET name=?,purpose=?,version=?,state=?,updated_at=? WHERE id=?').run(skill.name, skill.purpose, skill.version, skill.state, skill.updated_at, skill.id);
      insertVersion(db, skill, value, actor); result = summary(db, skill);
    } else if (skill && req.method === 'POST' && action === 'test') {
      if (actor?.mode === 'agent') fail('Agents cannot evaluate Skills.', 'access_denied', 403);
      const pinned = definition(db, skill); validateSkillInputs(pinned.definition, body.inputs);
      if (!['passed', 'failed'].includes(body.outcome)) fail('Choose a manual evaluation outcome.');
      const evidence = text(body.evidence, 'Observed evidence', 20000, true), notes = text(body.notes ?? '', 'Evaluation notes', 10000);
      result = { id: uid('skilltest'), skill_id: skill.id, workspace_id: ws, version_id: pinned.id, inputs: body.inputs, outcome: body.outcome, evidence, notes, mode: 'manual', evaluator_id: actor.id, created_at: stamp() };
      db.prepare('INSERT INTO skill_test_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(result.id, skill.id, ws, pinned.id, JSON.stringify(body.inputs), result.outcome, evidence, notes, 'manual', actor.id, result.created_at);
    } else if (skill && req.method === 'POST' && action === 'publish') {
      if (actor?.mode === 'agent') fail('Agents cannot publish Skills.', 'access_denied', 403);
      const pinned = definition(db, skill);
      if (!pinned.definition.instructions || !pinned.definition.output_format || !pinned.definition.test_cases.length) fail('Publishing needs instructions, expected output and at least one test case.');
      if (pinned.definition.evidence_policy_version === 2) assertSkillReliabilityCoverage(db, skill, pinned, actor, allowed);
      else if (!db.prepare("SELECT id FROM skill_test_runs WHERE version_id=? AND outcome='passed' AND mode='manual'").get(pinned.id)) fail('Record a passed manual evaluation of this exact version first.', 'evaluation_required', 409);
      skill = { ...skill, state: 'published', published_version: skill.version, updated_at: stamp() };
      db.prepare('UPDATE skills SET state=?,published_version=?,updated_at=? WHERE id=?').run(skill.state, skill.version, skill.updated_at, skill.id); result = summary(db, skill);
    } else fail('Unsupported Skill operation.', 'method_not_allowed', 405);
    recordChange(db, 'skills', before, skill, action || (before ? 'revised' : 'created'));
    if (requestKey) db.prepare('INSERT INTO skill_request_keys VALUES(?,?,?,?,?,?)').run(ws, actor.id, requestKey, fingerprint, skill.id, JSON.stringify(result));
    db.exec('COMMIT'); send(res, before ? 200 : 201, { result }); return true;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

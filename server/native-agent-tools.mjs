import { createHash, randomUUID } from 'node:crypto';
import { assertReviewedTarget, loadNativeToolAuthority, loadRunSponsor, nativeToolError } from './native-agent-tool-authority.mjs';

const READ = new Set(['search_workspace', 'get_area_context', 'get_project_context', 'get_route', 'search_knowledge', 'read_document']);
const APPLY = new Set(['create_draft_route', 'propose_project_update', 'save_memory_candidate', 'submit_output']);
const REVIEW_ONLY = new Set(['request_permission', 'handoff_to_agent']);
const WRITES = new Set([...APPLY, ...REVIEW_ONLY]);
const idPattern = '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$';
const identifier = { type: 'string', minLength: 1, maxLength: 200, pattern: idPattern };
const idempotency = { ...identifier, description: 'Stable caller-generated key scoped to this run and tool.' };
const text = (maxLength, minLength = 0) => ({ type: 'string', minLength, maxLength });
const deepFreeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; };
const objectSchema = (properties, required = []) => deepFreeze({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, properties, required });
const schema = {
  search_workspace: objectSchema({ query: text(500, 1), limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['query']),
  get_area_context: objectSchema({ area_id: identifier }, ['area_id']),
  get_project_context: objectSchema({ project_id: identifier }, ['project_id']),
  get_route: objectSchema({ route_id: identifier }, ['route_id']),
  search_knowledge: objectSchema({ query: text(500, 1), limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['query']),
  read_document: objectSchema({ document_id: identifier }, ['document_id']),
  create_draft_route: objectSchema({ idempotency_key: idempotency, project_id: identifier, title: text(200, 1), description: text(10000), priority: { type: 'string', enum: ['no_priority', 'low', 'medium', 'high', 'urgent'] } }, ['idempotency_key', 'project_id', 'title']),
  propose_project_update: objectSchema({ idempotency_key: idempotency, project_id: identifier, patch: objectSchema({ name: text(200, 1), description: text(10000), goal: text(10000), status: { type: 'string', enum: ['planned', 'active', 'paused', 'completed', 'cancelled', 'archived'] } }) }, ['idempotency_key', 'project_id', 'patch']),
  save_memory_candidate: objectSchema({ idempotency_key: idempotency, title: text(160, 1), content: text(10000, 1), project_id: identifier }, ['idempotency_key', 'title', 'content']),
  request_permission: objectSchema({ idempotency_key: idempotency, capability: text(120, 1), reason: text(2000, 1), scope_type: { type: 'string', enum: ['run', 'project', 'route'] }, scope_id: identifier }, ['idempotency_key', 'capability', 'reason']),
  submit_output: objectSchema({ idempotency_key: idempotency, title: text(200, 1), content: text(50000, 1), kind: { type: 'string', enum: ['document', 'report', 'code_change', 'design', 'test_result', 'research', 'other'] }, project_id: identifier, route_id: identifier }, ['idempotency_key', 'title', 'content']),
  handoff_to_agent: objectSchema({ idempotency_key: idempotency, target_agent_id: identifier, summary: text(10000, 1), project_id: identifier, route_id: identifier }, ['idempotency_key', 'target_agent_id', 'summary']),
};
const descriptions = {
  search_workspace: 'Search only text included in the reviewed run context.', get_area_context: 'Return exact reviewed Area context text.',
  get_project_context: 'Return exact reviewed Project context text.', get_route: 'Return exact reviewed Route context text.',
  search_knowledge: 'Search only reviewed approved-knowledge text included in this run.', read_document: 'Return exact reviewed document text included in this run.',
  create_draft_route: 'Propose a draft Route for human review; does not create it.', propose_project_update: 'Propose allowlisted Project changes for human review.',
  save_memory_candidate: 'Propose a bounded memory candidate for human review.', request_permission: 'Record a permission request; never grants access.',
  submit_output: 'Propose an output draft for human review.', handoff_to_agent: 'Record a handoff request; never launches another agent.',
};
const definitions = Object.keys(schema).map(name => Object.freeze({ id: `rumbo.${name}.v1`, name, version: 1, description: descriptions[name], classification: READ.has(name) ? 'read' : 'write', review_required: WRITES.has(name), effect: READ.has(name) ? 'read_reviewed_context' : 'pending_review_request', input_schema: schema[name] }));
export const NATIVE_AGENT_TOOL_REGISTRY = Object.freeze(Object.fromEntries(definitions.map(item => [item.name, item])));
export const listNativeAgentTools = () => structuredClone(definitions);

const fail = (code, message, statusCode = 400) => { throw Object.assign(new Error(message), { code, errorCode: code, statusCode }); };
const hash = value => createHash('sha256').update(value).digest('hex');
const defaultId = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function canonical(value, label = 'Tool input', maxBytes = 100000) {
  let nodes = 0;
  const encode = (item, depth) => {
    if (++nodes > 10000 || depth > 32) fail('invalid_input', `${label} is too complex.`);
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (Array.isArray(item)) { if (Object.keys(item).length !== item.length || Object.keys(item).some((key, index) => key !== String(index))) fail('invalid_input', `${label} contains an invalid array.`); return `[${item.map(child => encode(child, depth + 1)).join(',')}]`; }
    if (!plain(item) || Object.getOwnPropertySymbols(item).length) fail('invalid_input', `${label} must contain normalized JSON values.`);
    const descriptors = Object.getOwnPropertyDescriptors(item); if (Object.values(descriptors).some(item => item.get || item.set || !item.enumerable)) fail('invalid_input', `${label} cannot contain hidden or computed values.`);
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode(item[key], depth + 1)}`).join(',')}}`;
  };
  const result = encode(value, 0); if (Buffer.byteLength(result) > maxBytes) fail('invalid_input', `${label} exceeds ${maxBytes} bytes.`); return result;
}
function validate(node, value, path = 'arguments') {
  if (node.type === 'object') {
    if (!plain(value)) fail('invalid_input', `${path} must be an object.`);
    const keys = Object.keys(value), allowed = new Set(Object.keys(node.properties));
    if (node.additionalProperties === false && keys.some(key => !allowed.has(key))) fail('invalid_input', `${path} contains an unsupported field.`);
    for (const key of node.required || []) if (!Object.hasOwn(value, key)) fail('invalid_input', `${path}.${key} is required.`);
    for (const key of keys) validate(node.properties[key], value[key], `${path}.${key}`); return;
  }
  if (node.type === 'string') { if (typeof value !== 'string' || value.length < (node.minLength || 0) || value.length > (node.maxLength ?? Infinity) || node.pattern && !new RegExp(node.pattern).test(value) || node.enum && !node.enum.includes(value)) fail('invalid_input', `${path} has an invalid value.`); return; }
  if (node.type === 'integer' && (!Number.isSafeInteger(value) || value < node.minimum || value > node.maximum)) fail('invalid_input', `${path} has an invalid value.`);
}
function savepoint(db, operation) { const name = `native_tools_${randomUUID().replaceAll('-', '')}`; db.exec(`SAVEPOINT ${name}`); try { const result = operation(); db.exec(`RELEASE ${name}`); return result; } catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error; } }

export function installNativeAgentTools(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    contract_id TEXT NOT NULL, tool_name TEXT NOT NULL, classification TEXT NOT NULL, idempotency_key TEXT, input_hash TEXT NOT NULL, input_json TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT, error_json TEXT, request_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(run_id,tool_name,idempotency_key));
  CREATE TABLE IF NOT EXISTS agent_tool_requests (
    id TEXT PRIMARY KEY, call_id TEXT NOT NULL UNIQUE REFERENCES agent_tool_calls(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_review', version INTEGER NOT NULL DEFAULT 1, target_json TEXT NOT NULL, payload_json TEXT NOT NULL, before_json TEXT NOT NULL, stale_guard_json TEXT NOT NULL, result_json TEXT, reviewer_id TEXT, decision_note TEXT, created_at TEXT NOT NULL, reviewed_at TEXT,
    CHECK(status IN ('pending_review','rejected','reviewed','applied')));
  CREATE INDEX IF NOT EXISTS agent_tool_calls_run ON agent_tool_calls(run_id,created_at); CREATE INDEX IF NOT EXISTS agent_tool_requests_run ON agent_tool_requests(run_id,status,created_at);`);
}
function publicSection(section) { return { kind: section.kind, id: section.id, label: section.label, content: section.content, content_hash: section.content_hash, truncated: section.truncated }; }
function exact(authority, kind, id) { return publicSection(assertReviewedTarget(authority, kind, id)); }
function searchSections(authority, kinds, query, limit = 20) { const needle = query.toLocaleLowerCase(); return authority.sections.filter(section => kinds.has(section.kind) && `${section.label}\n${section.content}`.toLocaleLowerCase().includes(needle)).slice(0, limit).map(publicSection); }
function boundReadResult(result, maxBytes = 56000) {
  const field = Array.isArray(result.results) ? 'results' : Array.isArray(result.sections) ? 'sections' : null;
  if (!field) { if (Buffer.byteLength(canonical(result)) > maxBytes) fail('result_too_large', 'The reviewed source exceeds the native tool result limit.', 409); return result; }
  const kept = [], source = result[field];
  for (const item of source) {
    const candidate = { ...result, [field]: [...kept, item], omitted_result_count: source.length - kept.length - 1 };
    if (Buffer.byteLength(canonical(candidate)) > maxBytes) break;
    kept.push(item);
  }
  return { ...result, [field]: kept, omitted_result_count: source.length - kept.length };
}
function proposalReceipt(requestId, proposal) {
  const payload = proposal.payload, summary = proposal.kind === 'route_draft' ? { title: payload.title, priority: payload.priority, description_characters: payload.description.length }
    : proposal.kind === 'project_update' ? { project_id: payload.project_id, fields: Object.keys(payload.patch) }
      : proposal.kind === 'memory_candidate' ? { title: payload.title, content_characters: payload.content.length }
        : proposal.kind === 'permission_request' ? { capability: payload.capability, scope_type: payload.scope_type, scope_id: payload.scope_id, grants_access: false }
          : proposal.kind === 'output_draft' ? { title: payload.title, kind: payload.kind, content_characters: payload.content.length }
            : { target_agent_id: payload.target_agent_id, summary_characters: payload.summary.length, launches_agent: false };
  return { request_id: requestId, kind: proposal.kind, status: 'pending_review', version: 1, target: proposal.target, summary, approval_required: true, executed: false };
}
function readResult(name, args, authority) {
  if (name === 'search_workspace') return { results: searchSections(authority, new Set(authority.sections.map(section => section.kind).filter(kind => kind !== 'attachment')), args.query, args.limit) };
  if (name === 'get_area_context') { const sections = [exact(authority, 'area', args.area_id)], instructions = authority.sections.find(item => item.kind === 'area_instructions' && item.id === args.area_id); if (instructions) sections.push(publicSection(instructions)); if (authority.resolved.area_id === args.area_id) for (const [kind, field] of [['project', 'project_id'], ['route', 'task_id']]) for (const item of authority.sections.filter(section => section.kind === kind && section.id === authority.resolved[field])) sections.push(publicSection(item)); return { sections }; }
  if (name === 'get_project_context') { const sections = [exact(authority, 'project', args.project_id)]; if (authority.resolved.project_id === args.project_id) for (const item of authority.sections.filter(section => section.kind === 'route' && section.id === authority.resolved.task_id)) sections.push(publicSection(item)); return { sections }; }
  if (name === 'get_route') return { route: exact(authority, 'route', args.route_id) };
  if (name === 'search_knowledge') return { results: searchSections(authority, new Set(['knowledge_entries']), args.query, args.limit) };
  return { document: exact(authority, 'documents', args.document_id) };
}
function tableExists(db, table) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
function targetGuard(db, table, targetId, reviewed) {
  if (!table || !targetId) return { table: null, id: targetId || null };
  if (!['projects', 'tasks', 'agents'].includes(table) || !tableExists(db, table)) fail('target_unavailable', 'The proposal target is unavailable.', 404);
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(targetId); if (!row) fail('target_unavailable', 'The proposal target is unavailable.', 404);
  let captured;
  try { captured = JSON.parse(reviewed?.content); } catch { captured = null; }
  if (!plain(captured) || Object.entries(captured).some(([field, value]) => !Object.hasOwn(row, field) || canonical(row[field]) !== canonical(value))) fail('stale_target', 'The reviewed target changed before this proposal. Review fresh context first.', 409);
  return { table, id: targetId, workspace_id: row.workspace_id ?? null, updated_at: row.updated_at ?? null, version: row.version ?? null, archived_at: row.archived_at ?? null, reviewed_content_hash: reviewed.content_hash };
}
function authorizeTarget(authority, actor, allowed, permission, at) { if (!allowed(authority.run.workspace_id, actor, permission, at)) fail('tool_access_denied', `Current permission required: ${permission}.`, 403); }
function writeProposal(db, name, args, authority, actor, allowed) {
  const projectId = args.project_id || authority.resolved.project_id || null, routeId = args.route_id || authority.resolved.task_id || null;
  if (projectId) exact(authority, 'project', projectId); if (routeId) exact(authority, 'route', routeId);
  if (name === 'create_draft_route') { authorizeTarget(authority, actor, allowed, 'routes.write', { scope_type: 'project', scope_id: args.project_id }); const before = exact(authority, 'project', args.project_id); return { kind: 'route_draft', target: { kind: 'project', id: args.project_id }, payload: { project_id: args.project_id, title: args.title.trim(), description: (args.description || '').trim(), priority: args.priority || 'no_priority' }, before, guard: targetGuard(db, 'projects', args.project_id, before) }; }
  if (name === 'propose_project_update') { if (!Object.keys(args.patch).length) fail('invalid_input', 'At least one Project field is required.'); authorizeTarget(authority, actor, allowed, 'projects.write', { scope_type: 'project', scope_id: args.project_id }); const before = exact(authority, 'project', args.project_id); return { kind: 'project_update', target: { kind: 'project', id: args.project_id }, payload: { project_id: args.project_id, patch: args.patch }, before, guard: targetGuard(db, 'projects', args.project_id, before) }; }
  if (name === 'save_memory_candidate') { if (!projectId && authority.resolved.area_id) fail('tool_access_denied', 'Area-only memory persistence is not supported; choose a Project so the draft remains scoped.', 403); if (projectId) authorizeTarget(authority, actor, allowed, 'documents.write', { scope_type: 'project', scope_id: projectId }); else authorizeTarget(authority, actor, allowed, 'documents.write', {}); const before = projectId ? exact(authority, 'project', projectId) : null; return { kind: 'memory_candidate', target: projectId ? { kind: 'project', id: projectId } : { kind: 'run', id: authority.run.id }, payload: { project_id: projectId, title: args.title.trim(), content: args.content.trim() }, before, guard: projectId ? targetGuard(db, 'projects', projectId, before) : { table: 'runs', id: authority.run.id } }; }
  if (name === 'request_permission') { if (!/^[a-z][a-z0-9._:-]{1,119}$/.test(args.capability) || ['owner', 'admin', 'self_approve', 'permissions.write', 'access.widen'].includes(args.capability)) fail('permission_request_denied', 'This capability cannot be requested by an agent.', 403); const scopeType = args.scope_type || 'run', expected = scopeType === 'run' ? authority.run.id : scopeType === 'project' ? authority.resolved.project_id : authority.resolved.task_id; if (!expected || args.scope_id && args.scope_id !== expected) fail('target_not_in_reviewed_context', 'Permission requests cannot widen the reviewed run scope.', 403); return { kind: 'permission_request', target: { kind: scopeType, id: expected }, payload: { capability: args.capability, reason: args.reason.trim(), scope_type: scopeType, scope_id: expected, grants_access: false }, before: null, guard: { table: null, id: expected } }; }
  if (name === 'submit_output') { if (!projectId && authority.resolved.area_id) fail('tool_access_denied', 'Area-only output persistence is not supported; choose a Project so the draft remains scoped.', 403); if (routeId && authority.resolved.task_id !== routeId || projectId && authority.resolved.project_id !== projectId) fail('target_not_in_reviewed_context', 'The output is outside the reviewed run scope.', 403); authorizeTarget(authority, actor, allowed, 'documents.write', projectId ? { scope_type: 'project', scope_id: projectId } : {}); const before = routeId ? exact(authority, 'route', routeId) : projectId ? exact(authority, 'project', projectId) : null; return { kind: 'output_draft', target: routeId ? { kind: 'route', id: routeId } : projectId ? { kind: 'project', id: projectId } : { kind: 'run', id: authority.run.id }, payload: { project_id: projectId, route_id: routeId, run_id: authority.run.id, title: args.title.trim(), content: args.content.trim(), kind: args.kind || 'document' }, before, guard: routeId ? targetGuard(db, 'tasks', routeId, before) : projectId ? targetGuard(db, 'projects', projectId, before) : { table: 'runs', id: authority.run.id } }; }
  const target = exact(authority, 'agent', args.target_agent_id); if (args.target_agent_id === authority.run.agent_id) fail('invalid_input', 'An agent cannot hand work to itself.'); authorizeTarget(authority, actor, allowed, 'agents.read', { scope_type: 'agent', scope_id: args.target_agent_id }); return { kind: 'agent_handoff', target: { kind: 'agent', id: args.target_agent_id }, payload: { target_agent_id: args.target_agent_id, project_id: projectId, route_id: routeId, summary: args.summary.trim(), launches_agent: false }, before: target, guard: targetGuard(db, 'agents', args.target_agent_id, target) };
}
function decodeCall(row) { return { id: row.id, run_id: row.run_id, tool_name: row.tool_name, contract_id: row.contract_id, classification: row.classification, status: row.status, request_id: row.request_id || null, result: row.result_json ? JSON.parse(row.result_json) : null, error: row.error_json ? JSON.parse(row.error_json) : null, created_at: row.created_at, updated_at: row.updated_at }; }
function decodeRequest(row) { return { id: row.id, call_id: row.call_id, run_id: row.run_id, tool_name: row.tool_name, kind: row.kind, status: row.status, version: row.version, target: JSON.parse(row.target_json), payload: JSON.parse(row.payload_json), before: JSON.parse(row.before_json), result: row.result_json ? JSON.parse(row.result_json) : null, reviewer_id: row.reviewer_id || null, decision_note: row.decision_note || null, created_at: row.created_at, reviewed_at: row.reviewed_at || null }; }
function assertFresh(db, guard) { if (!guard.table || guard.table === 'runs') return; const current = db.prepare(`SELECT * FROM ${guard.table} WHERE id=?`).get(guard.id); if (!current || current.workspace_id !== guard.workspace_id || (current.updated_at ?? null) !== guard.updated_at || (current.version ?? null) !== guard.version || (current.archived_at ?? null) !== guard.archived_at) fail('stale_target', 'The proposal target changed after the tool request. Request a fresh proposal.', 409); }

export function createNativeAgentToolService({ db, allowed, filter = value => value, apply = {}, now = () => new Date().toISOString(), randomId = defaultId } = {}) {
  if (!db?.prepare || typeof allowed !== 'function' || typeof filter !== 'function') throw new TypeError('Native tools require db, allowed, and filter services.'); installNativeAgentTools(db);
  const authorityFor = (runId, actor, options) => loadNativeToolAuthority(db, runId, actor, allowed, options);
  const sponsorActor = runId => { const id = loadRunSponsor(db, runId); if (!id) fail('tool_access_denied', 'The run sponsor is unavailable.', 403); return { id }; };
  function listForRun(runId) { const actor = sponsorActor(runId), authority = authorityFor(runId, actor); return { tools: listNativeAgentTools().filter(tool => authority.enabled_tools.has(tool.name)), authority: { run_id: runId, context_fingerprint: authority.context_fingerprint } }; }
  function invoke(runId, name, args) {
    let callId;
    try {
      const actor = sponsorActor(runId), authority = authorityFor(runId, actor), contract = NATIVE_AGENT_TOOL_REGISTRY[name];
      if (!contract || !authority.enabled_tools.has(name)) fail('tool_not_available', 'This tool was not enabled in the reviewed run context.', 403);
      const inputJson = canonical(args), inputHash = hash(inputJson);
      if (WRITES.has(name) && plain(args) && typeof args.idempotency_key === 'string') {
        const old = db.prepare('SELECT * FROM agent_tool_calls WHERE run_id=? AND tool_name=? AND idempotency_key=?').get(runId, name, args.idempotency_key);
        if (old) {
          if (old.input_hash !== inputHash) fail('idempotency_conflict', 'This idempotency key was used for different tool input.', 409);
          validate(contract.input_schema, args);
          // A cached receipt is not durable authority. Re-run exact target,
          // stale-context and operation-capability checks before returning it.
          writeProposal(db, name, args, authority, actor, allowed);
          return { ok: old.status === 'succeeded', replayed: true, call_id: old.id, ...(old.status === 'succeeded' ? { result: JSON.parse(old.result_json) } : { error: JSON.parse(old.error_json) }) };
        }
      }
      if (db.prepare('SELECT COUNT(*) AS count FROM agent_tool_calls WHERE run_id=?').get(runId).count >= 100) fail('tool_call_limit', 'This run reached the native tool call limit.', 409);
      if (WRITES.has(name) && db.prepare("SELECT COUNT(*) AS count FROM agent_tool_requests WHERE run_id=? AND status='pending_review'").get(runId).count >= 20) fail('pending_request_limit', 'Review or reject pending tool requests before creating more.', 409);
      callId = randomId('toolcall'); const stamp = now();
      try { validate(contract.input_schema, args); }
      catch (error) {
        const structured = nativeToolError(error), redacted = canonical({ redacted_invalid_input: true });
        db.prepare('INSERT INTO agent_tool_calls(id,workspace_id,run_id,agent_id,contract_id,tool_name,classification,idempotency_key,input_hash,input_json,status,error_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(callId, authority.run.workspace_id, runId, authority.run.agent_id, contract.id, name, contract.classification, null, inputHash, redacted, 'failed', canonical(structured), stamp, stamp);
        return { ok: false, call_id: callId, replayed: false, error: structured };
      }
      db.prepare('INSERT INTO agent_tool_calls(id,workspace_id,run_id,agent_id,contract_id,tool_name,classification,idempotency_key,input_hash,input_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(callId, authority.run.workspace_id, runId, authority.run.agent_id, contract.id, name, contract.classification, WRITES.has(name) ? args.idempotency_key : null, inputHash, inputJson, 'started', stamp, stamp);
      try {
        let result;
        if (READ.has(name)) result = boundReadResult(readResult(name, args, authority));
        else { const proposal = writeProposal(db, name, args, authority, actor, allowed), requestId = randomId('toolrequest'); db.prepare('INSERT INTO agent_tool_requests(id,call_id,workspace_id,run_id,agent_id,tool_name,kind,target_json,payload_json,before_json,stale_guard_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(requestId, callId, authority.run.workspace_id, runId, authority.run.agent_id, name, proposal.kind, canonical(proposal.target), canonical(proposal.payload), canonical(proposal.before), canonical(proposal.guard), stamp); result = proposalReceipt(requestId, proposal); db.prepare('UPDATE agent_tool_calls SET request_id=? WHERE id=?').run(requestId, callId); }
        db.prepare("UPDATE agent_tool_calls SET status='succeeded',result_json=?,updated_at=? WHERE id=?").run(canonical(result, 'Tool result', 60000), now(), callId); return { ok: true, replayed: false, call_id: callId, result };
      } catch (error) { const structured = nativeToolError(error); db.prepare("UPDATE agent_tool_calls SET status='failed',error_json=?,updated_at=? WHERE id=?").run(canonical(structured), now(), callId); return { ok: false, call_id: callId, replayed: false, error: structured }; }
    } catch (error) { return { ok: false, ...(callId ? { call_id: callId } : {}), replayed: false, error: nativeToolError(error) }; }
  }
  function listRunHistory(runId, actor) { authorityFor(runId, actor, { requireActive: false }); const data = { agent_tool_calls: db.prepare('SELECT * FROM agent_tool_calls WHERE run_id=? ORDER BY created_at,id').all(runId).map(decodeCall), agent_tool_requests: db.prepare('SELECT * FROM agent_tool_requests WHERE run_id=? ORDER BY created_at,id').all(runId).map(decodeRequest) }, visible = filter(data, actor) || {}; return { calls: Array.isArray(visible.agent_tool_calls) ? visible.agent_tool_calls : [], requests: Array.isArray(visible.agent_tool_requests) ? visible.agent_tool_requests : [] }; }
  function decideRequest(requestId, { actor, decision, version, note = '' } = {}) {
    if (!actor?.id || !['approve', 'reject'].includes(decision) || !Number.isSafeInteger(version) || typeof note !== 'string' || note.length > 2000) fail('invalid_decision', 'Provide an authenticated approve or reject decision and current version.');
    const row = db.prepare('SELECT * FROM agent_tool_requests WHERE id=?').get(requestId); if (!row) fail('request_not_found', 'Native tool request not found.', 404); if (actor.id === row.agent_id) fail('self_approval_denied', 'An agent cannot review its own request.', 403);
    const sponsorId = loadRunSponsor(db, row.run_id); if (!sponsorId) fail('tool_access_denied', 'The original run sponsor is unavailable.', 403); const sponsorAuthority = authorityFor(row.run_id, { id: sponsorId }, { requireActive: false }); authorityFor(row.run_id, actor, { requireActive: false });
    if (row.status !== 'pending_review' || row.version !== version) fail('stale_request', 'This request was already reviewed or changed.', 409);
    const guard = JSON.parse(row.stale_guard_json), proposal = { type: row.tool_name, kind: row.kind, target: JSON.parse(row.target_json), payload: JSON.parse(row.payload_json), before: JSON.parse(row.before_json) };
    if (decision === 'approve') {
      assertFresh(db, guard);
      const permission = row.tool_name === 'create_draft_route' ? 'routes.write' : row.tool_name === 'propose_project_update' ? 'projects.write' : ['save_memory_candidate', 'submit_output'].includes(row.tool_name) ? 'documents.write' : row.tool_name === 'handoff_to_agent' ? 'agents.read' : 'agents.run';
      const at = proposal.target.kind === 'project' ? { scope_type: 'project', scope_id: proposal.target.id } : proposal.target.kind === 'route' ? { scope_type: 'project', scope_id: sponsorAuthority.resolved.project_id } : proposal.target.kind === 'agent' ? { scope_type: 'agent', scope_id: proposal.target.id } : sponsorAuthority.resolved.area_id ? { scope_type: 'team', scope_id: sponsorAuthority.resolved.area_id } : {};
      for (const reviewer of [{ id: sponsorId }, actor]) if (!allowed(row.workspace_id, reviewer, permission, at)) fail('tool_access_denied', `Current permission required: ${permission}.`, 403);
    }
    return savepoint(db, () => {
      const current = db.prepare('SELECT * FROM agent_tool_requests WHERE id=?').get(requestId); if (!current || current.status !== 'pending_review' || current.version !== version) fail('stale_request', 'This request changed before the decision.', 409);
      const reviewedAt = now(); let status = decision === 'reject' ? 'rejected' : 'reviewed', result = null;
      if (decision === 'approve' && APPLY.has(row.tool_name)) { const handler = apply[row.tool_name]; if (typeof handler !== 'function') fail('apply_handler_unavailable', 'This reviewed request cannot be applied yet.', 409); result = handler({ run: sponsorAuthority.run, proposal: proposal.payload, request: decodeRequest(row), actor }); canonical(result, 'Apply result', 200000); status = 'applied'; }
      else if (decision === 'approve') result = { reviewed: true, grants_access: false, launches_agent: false };
      const changed = db.prepare('UPDATE agent_tool_requests SET status=?,version=version+1,result_json=?,reviewer_id=?,decision_note=?,reviewed_at=? WHERE id=? AND version=? AND status=?').run(status, result === null ? null : canonical(result, 'Apply result', 200000), actor.id, note.trim() || null, reviewedAt, requestId, version, 'pending_review'); if (changed.changes !== 1) fail('stale_request', 'This request changed before the decision.', 409); return decodeRequest(db.prepare('SELECT * FROM agent_tool_requests WHERE id=?').get(requestId));
    });
  }
  return { listForRun, invoke, listRunHistory, decideRequest };
}

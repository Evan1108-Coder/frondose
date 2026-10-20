import { createHash, randomUUID } from 'node:crypto';
import { captureSourceAccess, assertSourceAccess } from './context-source-access.mjs';
import { readRunContext } from './run-context-store.mjs';

const stamp = () => new Date().toISOString();
const fail = (message, code = 'invalid_coordination', statusCode = 400) => { throw Object.assign(new Error(message), { code, errorCode: code, statusCode }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value, label) => { if (typeof value !== 'string' || !value || value.length > 240 || /[\u0000-\u001f]/.test(value)) fail(`${label} must be a stable ID.`); return value; };
const parse = value => JSON.parse(value);
const capabilities = Object.freeze({ native_steer: false, follow_up: 'reviewed_next_turn', auto_dispatch: false });
const publicRow = row => { const { source_access_json, target_scope_json, ...item } = row; return item; };

/** This is a coordination ledger, not a second execution engine. Records never
 * invoke providers, interrupt native turns, grant tools, or copy raw run context. */
export function installRunCoordination(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS run_coordination (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    source_chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
    source_agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
    target_chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    target_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    creator_id TEXT NOT NULL, author_type TEXT NOT NULL CHECK(author_type IN ('user','agent')),
    request_id TEXT NOT NULL, request_hash TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('steer','handoff')),
    content TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
    source_access_json TEXT NOT NULL, target_scope_json TEXT NOT NULL,
    prepared_snapshot_id TEXT, created_at TEXT NOT NULL,
    UNIQUE(workspace_id,creator_id,request_id));
    CREATE INDEX IF NOT EXISTS run_coordination_source ON run_coordination(source_run_id,created_at);
    CREATE INDEX IF NOT EXISTS run_coordination_target ON run_coordination(target_chat_id,created_at);
    CREATE TRIGGER IF NOT EXISTS run_coordination_immutable BEFORE UPDATE OF workspace_id,source_run_id,source_chat_id,source_agent_id,target_chat_id,target_agent_id,creator_id,author_type,request_id,request_hash,kind,content,source_access_json,target_scope_json,created_at ON run_coordination
    BEGIN SELECT RAISE(ABORT,'Coordination messages are immutable'); END;`);
}

function scopeChat(db, id, workspaceId) {
  const row = db.prepare('SELECT id,workspace_id,project_id,task_id,kind,participant_agent_ids_json FROM chats WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(id, workspaceId);
  if (!row) fail('Choose an accessible, active conversation in this workspace.', 'coordination_target_unavailable', 404);
  return { ...row };
}
export function coordinationTarget(db, { workspaceId, chatId, agentId }) {
  const chat = scopeChat(db, chatId, workspaceId);
  const agent = db.prepare('SELECT id,workspace_id,provider FROM agents WHERE id=? AND archived_at IS NULL').get(agentId);
  if (!agent || agent.workspace_id && agent.workspace_id !== workspaceId) fail('Choose a current agent identity in this workspace.');
  // A personal-agent conversation must not become a side door to another
  // identity. Ordinary conversations deliberately allow explicit recipients.
  if (chat.kind === 'rumbo-agent') {
    if (!parse(chat.participant_agent_ids_json || '[]').includes(agent.id)) fail('Use the agent bound to this Frondose conversation.');
  }
  return { chat, agent: { ...agent } };
}
export function coordinationReference(db, run, target) {
  const manifest = { resolved: { workspace_id: run.workspace_id }, included: [{ kind: 'run', id: run.id }, { kind: 'chat', id: target.chat.id }, { kind: 'agent', id: target.agent.id }] };
  return { manifest, sourceAccess: captureSourceAccess(db, { manifest }) };
}
export function coordinationTargetScope(reference, chatId) {
  const ref = reference?.sourceAccess?.sources?.find(item => item.table === 'chats' && item.id === chatId && item.permission === 'chats.read');
  if (!ref?.scope) fail('The destination conversation has no verifiable scope.');
  return ref.scope;
}
function sourceRun(db, runId, actor, allowed, write = false) {
  const run = db.prepare('SELECT * FROM runs WHERE id=? AND archived_at IS NULL').get(identifier(runId, 'Run'));
  if (!run || !actor?.id) fail('This run is unavailable.', 'coordination_unavailable', 404);
  const captured = readRunContext(db, run.id);
  if (!captured?.inspection?.sourceAccess) fail('This older run has no verifiable source history. Start a fresh reviewed turn.', 'coordination_legacy_run', 409);
  assertSourceAccess(db, captured.inspection, actor, allowed);
  const sourceManifest = {resolved:{workspace_id:run.workspace_id},included:[{kind:'run',id:run.id}]};
  const scope = captureSourceAccess(db,{manifest:sourceManifest}).sources.find(item=>item.table==='runs'&&item.id===run.id)?.scope;
  if (!allowed?.(run.workspace_id, actor, write ? 'agents.run' : 'agents.read', scope)) fail('You cannot coordinate this run.', 'access_denied', 403);
  return run;
}
function assertItem(db, row, actor, allowed, write = false) {
  if (!row) fail('This coordination record is unavailable.', 'coordination_unavailable', 404);
  const run = sourceRun(db, row.source_run_id, actor, allowed, write);
  assertSourceAccess(db, { manifest: { resolved: { workspace_id: row.workspace_id } }, sourceAccess: parse(row.source_access_json) }, actor, allowed);
  const target = coordinationTarget(db, { workspaceId: row.workspace_id, chatId: row.target_chat_id, agentId: row.target_agent_id });
  assertSourceAccess(db, coordinationReference(db, run, target), actor, allowed);
  if (write && row.creator_id !== actor.id) fail('Only the authenticated sponsor can prepare this follow-up.', 'access_denied', 403);
  return { run, target };
}

export function createRunCoordination(db, { runId, input, actor, allowed, authorType = 'user' }) {
  if (!object(input) || Object.keys(input).some(key => !['request_id', 'kind', 'content', 'target_chat_id', 'target_agent_id'].includes(key))) fail('Choose supported coordination fields only.');
  const run = sourceRun(db, runId, actor, allowed, true);
  if (!run.chat_id || !run.agent_id) fail('Choose a conversation run with a named agent.');
  if (!['steer', 'handoff'].includes(input.kind)) fail('Choose a steering message or a handoff.');
  if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 10000 || Buffer.byteLength(input.content, 'utf8') > 12000) fail('Write a message of 1–10,000 characters, within 12 KB.');
  if (!['user', 'agent'].includes(authorType)) fail('Unsupported coordination author.');
  const requestId = identifier(input.request_id, 'Request');
  const targetChatId = input.kind === 'steer' ? run.chat_id : identifier(input.target_chat_id, 'Target conversation');
  const targetAgentId = input.kind === 'steer' ? run.agent_id : identifier(input.target_agent_id, 'Target agent');
  if (input.kind === 'steer' && (input.target_chat_id && input.target_chat_id !== run.chat_id || input.target_agent_id && input.target_agent_id !== run.agent_id)) fail('Steering stays with the original conversation and agent.');
  if (input.kind === 'handoff' && targetChatId === run.chat_id && targetAgentId === run.agent_id) fail('Use a steering message for the same conversation and agent.');
  const target = coordinationTarget(db, { workspaceId: run.workspace_id, chatId: targetChatId, agentId: targetAgentId });
  const inspection = coordinationReference(db, run, target);
  assertSourceAccess(db, inspection, actor, allowed);
  const targetScope = coordinationTargetScope(inspection,targetChatId);
  if (!allowed(run.workspace_id, actor, 'chats.write', targetScope) || !allowed(run.workspace_id, actor, 'agents.run', targetScope)) fail('You cannot prepare work in the destination conversation.', 'access_denied', 403);
  const canonical = { run_id: run.id, kind: input.kind, content: input.content.trim(), target_chat_id: targetChatId, target_agent_id: targetAgentId, author_type: authorType };
  const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  const existing = db.prepare('SELECT * FROM run_coordination WHERE workspace_id=? AND creator_id=? AND request_id=?').get(run.workspace_id, actor.id, requestId);
  if (existing) {
    assertItem(db, existing, actor, allowed, true);
    if (existing.request_hash !== hash) fail('This request ID already recorded different instructions.', 'coordination_request_conflict', 409);
    return { ...publicRow(existing), replayed: true };
  }
  if (db.prepare('SELECT count(*) n FROM run_coordination WHERE source_run_id=?').get(run.id).n >= 50) fail('This run has reached its 50-message coordination limit.', 'coordination_limit', 409);
  const id = `coord_${randomUUID()}`;
  db.prepare('INSERT INTO run_coordination(id,workspace_id,source_run_id,source_chat_id,source_agent_id,target_chat_id,target_agent_id,creator_id,author_type,request_id,request_hash,kind,content,source_access_json,target_scope_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, run.workspace_id, run.id, run.chat_id, run.agent_id, targetChatId, targetAgentId, actor.id, authorType, requestId, hash, input.kind, canonical.content, JSON.stringify(inspection.sourceAccess), JSON.stringify(target), stamp());
  return publicRow(db.prepare('SELECT * FROM run_coordination WHERE id=?').get(id));
}

export function listRunCoordination(db, runId, actor, allowed) {
  sourceRun(db, runId, actor, allowed);
  const items = db.prepare('SELECT * FROM run_coordination WHERE source_run_id=? ORDER BY created_at,id').all(runId).flatMap(row => {
    try { assertItem(db, row, actor, allowed); return [{ ...publicRow(row), can_prepare: row.creator_id === actor.id }]; }
    catch { return []; }
  });
  return { items, capabilities };
}

/** The returned protected content stays in memory; clients persist the IDs
 * only. Normal fresh Context Inspector + explicit Send owns every paid turn. */
export function prepareRunCoordination(db, runId, itemId, actor, allowed) {
  const row = db.prepare('SELECT * FROM run_coordination WHERE id=? AND source_run_id=?').get(identifier(itemId, 'Coordination record'), runId);
  const { target } = assertItem(db, row, actor, allowed, true);
  if (JSON.stringify(target) !== row.target_scope_json) fail('The destination identity or scope changed. Record a fresh handoff.', 'coordination_target_changed', 409);
  const snapshotId = row.prepared_snapshot_id || `coord_context_${row.id}`;
  const sourceAccess = parse(row.source_access_json);
  // Explicitly retain the recipient chat as a source so standard chat-context
  // snapshot validation can keep current and historical recipient ACLs too.
  const content = `## ${row.kind === 'steer' ? 'Steering message' : 'Agent handoff'}\n\n${row.content}\n\nSource run: ${row.source_run_id}\nThis is a saved coordination message, not a running provider session. The source run's private prompt and tools are not copied. Review this draft before sending.`;
  const sources = [{ kind: 'run', id: row.source_run_id, title: 'Source run' }];
  db.prepare('INSERT OR IGNORE INTO chat_context_snapshots(id,workspace_id,chat_id,content,sources_json,created_at,source_access_json) VALUES(?,?,?,?,?,?,?)').run(snapshotId, row.workspace_id, row.target_chat_id, content, JSON.stringify(sources), row.created_at, JSON.stringify(sourceAccess));
  db.prepare("UPDATE run_coordination SET prepared_snapshot_id=?,state='prepared' WHERE id=?").run(snapshotId, row.id);
  return { id: row.id, source_run_id: row.source_run_id, chat_id: row.target_chat_id, agent_id: row.target_agent_id, content: row.kind === 'steer' ? 'Apply the attached steering message as the next task.' : 'Review and carry out the attached handoff within the currently selected access.', context_snapshot_id: snapshotId, context: { id: snapshotId, workspace_id: row.workspace_id, chat_id: row.target_chat_id, content, sources, created_at: row.created_at }, state: 'prepared', dispatched: false };
}

export async function runCoordinationRoute({ db, req, res, path, body, actor, allowed, send, addRunEvent }) {
  const match = path.match(/^\/runs\/([^/]+)\/coordination(?:\/([^/]+)\/prepare)?$/);
  if (!match) return false;
  const runId = decodeURIComponent(match[1]);
  if (req.method === 'GET' && !match[2]) { send(res, 200, { result: listRunCoordination(db, runId, actor, allowed) }); return true; }
  if (req.method === 'POST' && match[2]) {
    if (!object(body) || Object.keys(body).length) fail('Preparation accepts record IDs only.');
    send(res, 200, { result: prepareRunCoordination(db, runId, decodeURIComponent(match[2]), actor, allowed) }); return true;
  }
  if (req.method === 'POST' && !match[2]) {
    const result = createRunCoordination(db, { runId, input: body, actor, allowed });
    // Never place content or target identity in the broader run event stream:
    // coordination has the union of the source and destination boundaries.
    if (!result.replayed) addRunEvent?.(runId, 'coordination.recorded', result.kind === 'steer' ? 'A steering message was queued for a reviewed next turn' : 'A reviewed handoff draft was recorded', { coordination_id: result.id, kind: result.kind, dispatched: false });
    send(res, result.replayed ? 200 : 201, { result }); return true;
  }
  fail('Unsupported coordination method.', 'method_not_allowed', 405);
}

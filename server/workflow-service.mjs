import { createHash, randomUUID } from 'node:crypto';
import { isRecord, validationError } from './validation.mjs';
import { installWorkspaceFeatures, recordChange } from './workspace-features.mjs';
import { installRouteHierarchy, assertRouteLink, assertRouteDependencies, hierarchyTransaction, authorizeRouteNodes } from './route-hierarchy.mjs';

const now = () => new Date().toISOString();
const id = kind => `${kind}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const conflict = message => Object.assign(validationError(message), { statusCode: 409 });
const TYPES = ['document', 'report', 'code_change', 'design', 'test_result', 'research', 'other'];
function text(value, label, max = 500, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw validationError(`${label} must be ${required ? '1' : '0'}–${max} characters.`);
  return value.trim();
}
function oneOf(value, choices, label) { if (!choices.includes(value)) throw validationError(`Choose a valid ${label}.`); return value; }
const decode = row => row ? Object.fromEntries(Object.entries(row).map(([k, v]) => k.endsWith('_json') ? [k.slice(0, -5), JSON.parse(v)] : [k, v])) : null;
function active(db, table, entityId, workspaceId, required = false) {
  if (!entityId && !required) return null;
  if (typeof entityId !== 'string') throw validationError(`Choose a valid ${table.replaceAll('_', ' ')} item.`);
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(entityId);
  if (!row || row.archived_at || (workspaceId && row.workspace_id !== workspaceId)) throw validationError('Linked items must be active and belong to the same workspace.');
  return row;
}
function workspace(db, value) { return active(db, 'workspaces', value, null, true).id; }
function expectVersion(body, current) { if (body.version !== current.version) throw conflict('This item changed. Refresh and review the latest version before continuing.'); }
function transaction(db, fn) { return hierarchyTransaction(db, fn); }

export function installWorkflow(db) {
  installWorkspaceFeatures(db);
  db.exec(`CREATE TABLE IF NOT EXISTS route_workflows (
    id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    owner_name TEXT NOT NULL DEFAULT '', reviewer_name TEXT NOT NULL DEFAULT '',
    output_type TEXT NOT NULL DEFAULT 'document', parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    acceptance_json TEXT NOT NULL DEFAULT '[]', dependency_ids_json TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS outputs (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL, title TEXT NOT NULL, kind TEXT NOT NULL,
    reviewer_name TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'needs_review',
    current_version INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
    archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL, source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL);
  CREATE TABLE IF NOT EXISTS output_versions (
    id TEXT PRIMARY KEY, output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    number INTEGER NOT NULL, content TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
    author_name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(output_id,number));
  CREATE TABLE IF NOT EXISTS output_comments (
    id TEXT PRIMARY KEY, output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    version_id TEXT NOT NULL REFERENCES output_versions(id) ON DELETE CASCADE,
    anchor TEXT NOT NULL DEFAULT '', content TEXT NOT NULL, author_name TEXT NOT NULL,
    resolved_at TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS output_reviews (
    id TEXT PRIMARY KEY, output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    version_id TEXT NOT NULL REFERENCES output_versions(id) ON DELETE CASCADE,
    decision TEXT NOT NULL, reviewer_name TEXT NOT NULL, feedback TEXT NOT NULL DEFAULT '',
    revision_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS context_snapshots (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    name TEXT NOT NULL, content TEXT NOT NULL, sources_json TEXT NOT NULL DEFAULT '[]',
    content_hash TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS knowledge_entries (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'draft', review_date TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1, archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS outputs_scope ON outputs(workspace_id,task_id);
  CREATE INDEX IF NOT EXISTS output_comments_scope ON output_comments(output_id,version_id);
  CREATE INDEX IF NOT EXISTS knowledge_scope ON knowledge_entries(workspace_id,project_id);
  CREATE TABLE IF NOT EXISTS project_strategies (
    id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    audience TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '', success TEXT NOT NULL DEFAULT '', exclusions TEXT NOT NULL DEFAULT '',
    health TEXT NOT NULL DEFAULT 'on_track', health_reason TEXT NOT NULL DEFAULT '', retrospective TEXT NOT NULL DEFAULT '',
    concerns_json TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS milestone_contracts (
    id TEXT PRIMARY KEY REFERENCES milestones(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    acceptance_json TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);`);
  for (const [column, reference] of [['chat_id', 'chats'], ['source_message_id', 'messages']]) {
    if (!db.prepare('PRAGMA table_info(outputs)').all().some(row => row.name === column)) db.exec(`ALTER TABLE outputs ADD COLUMN ${column} TEXT REFERENCES ${reference}(id) ON DELETE SET NULL`);
  }
  installRouteHierarchy(db);
}

export function workflowSnapshot(db) {
  return Object.fromEntries(['route_workflows', 'outputs', 'output_versions', 'output_comments', 'output_reviews', 'context_snapshots', 'knowledge_entries', 'project_strategies', 'milestone_contracts'].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all().map(decode)]));
}

function routeFields(db, task, input, previous, options) {
  const next = { owner_name: text(input.owner_name ?? previous?.owner_name ?? '', 'Owner', 120), reviewer_name: text(input.reviewer_name ?? previous?.reviewer_name ?? '', 'Reviewer', 120), output_type: oneOf(input.output_type ?? previous?.output_type ?? 'document', TYPES, 'output type'), parent_task_id: input.parent_task_id === undefined ? previous?.parent_task_id ?? null : input.parent_task_id || null };
  active(db, 'tasks', next.parent_task_id, task.workspace_id);
  if (next.parent_task_id === task.id) throw validationError('A route cannot be its own parent.');
  assertRouteLink(db, task, next.parent_task_id, options);
  next.acceptance = input.acceptance ?? previous?.acceptance ?? [];
  if (!Array.isArray(next.acceptance) || next.acceptance.length > 100) throw validationError('Add up to 100 acceptance criteria.');
  next.acceptance = next.acceptance.map(item => { if (!isRecord(item) || typeof item.done !== 'boolean') throw validationError('Provide valid acceptance criteria.'); return { id: text(item.id, 'Criterion ID', 100, true), text: text(item.text, 'Acceptance criterion', 1000, true), done: item.done }; });
  if (new Set(next.acceptance.map(item => item.id)).size !== next.acceptance.length) throw validationError('Acceptance criteria must have unique IDs.');
  next.dependency_ids = input.dependency_ids ?? previous?.dependency_ids ?? [];
  if (!Array.isArray(next.dependency_ids) || next.dependency_ids.length > 100 || new Set(next.dependency_ids).size !== next.dependency_ids.length) throw validationError('Choose up to 100 unique dependencies.');
  for (const dep of next.dependency_ids) { active(db, 'tasks', dep, task.workspace_id, true); if (dep === task.id) throw validationError('A route cannot depend on itself.'); }
  assertRouteDependencies(db, task, next.dependency_ids, options);
  const workflows = db.prepare('SELECT * FROM route_workflows WHERE workspace_id=?').all(task.workspace_id).map(decode);
  const map = new Map(workflows.map(row => [row.id, row])); map.set(task.id, { id: task.id, ...next });
  // Parent hierarchy and blocking dependencies are separate directed graphs.
  for (const parents of [false, true]) {
    const visiting = new Set(), seen = new Set();
    const visit = key => { if (visiting.has(key)) throw validationError(parents ? 'Parent routes cannot form a cycle.' : 'Dependencies cannot form a cycle.'); if (seen.has(key)) return; visiting.add(key); const row = map.get(key); for (const link of parents ? row?.parent_task_id ? [row.parent_task_id] : [] : row?.dependency_ids ?? []) visit(link); visiting.delete(key); seen.add(key); };
    for (const key of map.keys()) visit(key);
  }
  return next;
}
function outputLinks(db, body, ws) {
  const message = body.source_message_id ? db.prepare('SELECT * FROM messages WHERE id=?').get(body.source_message_id) : null;
  if (body.source_message_id && !message) throw validationError('Source message not found.');
  const chat = active(db, 'chats', body.chat_id || message?.chat_id, ws);
  if (message && message.chat_id !== chat?.id) throw validationError('The source message must belong to the linked conversation.');
  const run = active(db, 'runs', body.run_id, ws);
  const task = active(db, 'tasks', body.task_id || run?.task_id || chat?.task_id, ws);
  const project = active(db, 'projects', body.project_id || task?.project_id || run?.project_id || chat?.project_id, ws);
  if (run?.task_id && task?.id !== run.task_id || run?.project_id && project?.id !== run.project_id || task?.project_id && project?.id !== task.project_id) throw validationError('The route, session, and project must refer to the same work.');
  if (chat?.project_id && project?.id !== chat.project_id || chat?.task_id && task?.id !== chat.task_id) throw validationError('The conversation and output must refer to the same work.');
  return { project_id: project?.id ?? null, task_id: task?.id ?? null, run_id: run?.id ?? null, chat_id: chat?.id ?? null, source_message_id: message?.id ?? null };
}
function insertVersion(db, output, body, number) {
  const version = { id: id('version'), output_id: output.id, workspace_id: output.workspace_id, number, content: text(body.content, 'Output content', 200000, true), summary: text(body.summary ?? '', 'Version summary', 2000), author_name: text(body.author_name ?? 'You', 'Author', 120, true), created_at: now() };
  db.prepare('INSERT INTO output_versions VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(version)); return version;
}
function currentOutput(db, outputId) {
  const output = active(db, 'outputs', outputId, null, true); workspace(db, output.workspace_id); return output;
}
function versionFor(db, output, versionId, requireCurrent = false) {
  const version = db.prepare('SELECT * FROM output_versions WHERE id=? AND output_id=?').get(versionId ?? '', output.id);
  if (!version) throw validationError('Choose a version of this output.');
  if (requireCurrent && version.number !== output.current_version) throw conflict('A newer version exists. Review the latest version before deciding.');
  return version;
}

export async function workflowRoute({ db, req, res, path, url, readBody, send, snapshot, actor, allowed }) {
  if (!path.startsWith('/workflow/')) return false;
  const match = path.match(/^\/workflow\/(routes|outputs|comments|context|knowledge|projects|milestones)(?:\/([^/]+))?(?:\/(versions|comments|review|attach-chat))?$/);
  if (!match) return false;
  const [, resource, entityId, action] = match;
  if (!['POST', 'PATCH'].includes(req.method)) return false;
  const body = await readBody(req);
  if (!isRecord(body)) throw validationError('Provide an object with valid fields.');
  const auditResource = ({ routes:'route_workflows', outputs:action === 'versions' ? 'output_versions' : action === 'comments' ? 'output_comments' : action === 'review' ? 'output_reviews' : 'outputs', comments:'output_comments', context:'context_snapshots', knowledge:'knowledge_entries', projects:'project_strategies', milestones:'milestone_contracts' })[resource];
  const before = entityId && !action ? decode(db.prepare(`SELECT * FROM ${auditResource} WHERE id=?`).get(entityId)) : null;
  let result, recorded = false, status = req.method === 'POST' && !entityId ? 201 : 200;
  if (resource === 'routes' && entityId && req.method === 'PATCH' && !action) {
    result = hierarchyTransaction(db, () => {
    const task = active(db, 'tasks', entityId, null, true); workspace(db, task.workspace_id);
    authorizeRouteNodes([task], { actor, allowed, write: true });
    const previous = decode(db.prepare('SELECT * FROM route_workflows WHERE id=?').get(entityId));
    if (body.version !== (previous?.version ?? 0)) throw conflict('Route details changed. Reopen them before saving.');
    const next = routeFields(db, task, body, previous, { actor, allowed });
    db.prepare(`INSERT INTO route_workflows(id,workspace_id,owner_name,reviewer_name,output_type,parent_task_id,acceptance_json,dependency_ids_json,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_name=excluded.owner_name,reviewer_name=excluded.reviewer_name,output_type=excluded.output_type,parent_task_id=excluded.parent_task_id,acceptance_json=excluded.acceptance_json,dependency_ids_json=excluded.dependency_ids_json,version=excluded.version,updated_at=excluded.updated_at`).run(task.id, task.workspace_id, next.owner_name, next.reviewer_name, next.output_type, next.parent_task_id, JSON.stringify(next.acceptance), JSON.stringify(next.dependency_ids), (previous?.version ?? 0) + 1, now());
    const after = decode(db.prepare('SELECT * FROM route_workflows WHERE id=?').get(entityId));
    recordChange(db, 'route_workflows', previous, after, previous ? 'updated' : 'created'); recorded = true;
    return after;
    });
  } else if (resource === 'outputs' && !entityId && req.method === 'POST') {
    const ws = workspace(db, body.workspace_id), links = outputLinks(db, body, ws);
    const route = links.task_id ? db.prepare('SELECT * FROM route_workflows WHERE id=?').get(links.task_id) : null;
    const output = { id: id('output'), workspace_id: ws, ...links, title: text(body.title, 'Title', 200, true), kind: oneOf(body.kind ?? route?.output_type ?? 'document', TYPES, 'output type'), reviewer_name: text(body.reviewer_name ?? route?.reviewer_name ?? '', 'Reviewer', 120), state: 'needs_review', current_version: 1, version: 1, archived_at: null, created_at: now(), updated_at: now() };
    transaction(db, () => { db.prepare('INSERT INTO outputs (id,workspace_id,project_id,task_id,run_id,chat_id,source_message_id,title,kind,reviewer_name,state,current_version,version,archived_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(output)); insertVersion(db, output, body, 1); }); result = output;
  } else if (resource === 'outputs' && entityId && !action && req.method === 'PATCH') {
    // Archived outputs can be restored, but cannot otherwise be acted upon.
    const output = db.prepare('SELECT * FROM outputs WHERE id=?').get(entityId); if (!output) throw validationError('Output not found.'); workspace(db, output.workspace_id); expectVersion(body, output);
    if (body.archived !== undefined && typeof body.archived !== 'boolean') throw validationError('Choose archive or restore.');
    const title = text(body.title ?? output.title, 'Title', 200, true), reviewer = text(body.reviewer_name ?? output.reviewer_name, 'Reviewer', 120);
    db.prepare('UPDATE outputs SET title=?,reviewer_name=?,archived_at=?,version=version+1,updated_at=? WHERE id=?').run(title, reviewer, body.archived === undefined ? output.archived_at : body.archived ? now() : null, now(), entityId);
    result = db.prepare('SELECT * FROM outputs WHERE id=?').get(entityId);
  } else if (resource === 'outputs' && entityId && action === 'versions' && req.method === 'POST') {
    const output = currentOutput(db, entityId); expectVersion(body, output);
    result = transaction(db, () => { const version = insertVersion(db, output, body, output.current_version + 1); db.prepare("UPDATE outputs SET current_version=current_version+1,version=version+1,state='needs_review',updated_at=? WHERE id=?").run(now(), entityId); return version; });
  } else if (resource === 'outputs' && entityId && action === 'comments' && req.method === 'POST') {
    const output = currentOutput(db, entityId), version = versionFor(db, output, body.version_id);
    const anchor = text(body.anchor ?? '', 'Selected quote', 2000);
    if (anchor && !version.content.includes(anchor)) throw validationError('The selected quote does not occur in this version.');
    result = { id: id('comment'), output_id: output.id, workspace_id: output.workspace_id, version_id: version.id, anchor, content: text(body.content, 'Comment', 10000, true), author_name: text(body.author_name ?? 'You', 'Author', 120, true), resolved_at: null, created_at: now() };
    db.prepare('INSERT INTO output_comments VALUES (?,?,?,?,?,?,?,?,?)').run(...Object.values(result));
  } else if (resource === 'comments' && entityId && req.method === 'PATCH') {
    const comment = db.prepare('SELECT * FROM output_comments WHERE id=?').get(entityId); if (!comment) throw validationError('Comment not found.'); currentOutput(db, comment.output_id);
    if (typeof body.resolved !== 'boolean') throw validationError('Choose resolved or unresolved.');
    db.prepare('UPDATE output_comments SET resolved_at=? WHERE id=?').run(body.resolved ? now() : null, entityId); result = db.prepare('SELECT * FROM output_comments WHERE id=?').get(entityId);
  } else if (resource === 'outputs' && entityId && action === 'review' && req.method === 'POST') {
    const output = currentOutput(db, entityId); expectVersion(body, output); const version = versionFor(db, output, body.version_id, true);
    const decision = oneOf(body.decision, ['approved', 'changes_requested'], 'review decision');
    const reviewer = text(body.reviewer_name, 'Reviewer', 120, true), feedback = text(body.feedback ?? '', 'Feedback', 20000, decision === 'changes_requested');
    if (output.reviewer_name && output.reviewer_name.toLowerCase() !== reviewer.toLowerCase()) throw validationError(`This output is assigned to ${output.reviewer_name}. Use that reviewer name or update the assignment first.`);
    const agreement = decode(db.prepare('SELECT * FROM route_workflows WHERE id=?').get(output.task_id ?? ''));
    if (decision === 'approved' && agreement?.acceptance.some(item => !item.done)) throw validationError('Complete the linked route’s acceptance checklist before approving this output.');
    result = transaction(db, () => {
      let revisionId = null;
      if (decision === 'changes_requested') {
        revisionId = id('task'); const number = db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM tasks WHERE workspace_id=?').get(output.workspace_id).n;
        const description = `Revise “${output.title}” (version ${version.number}).\n\nReview feedback\n${feedback}\n\nOutput: ${output.id}\nVersion: ${version.id}\n\nNo agent has been started. Inspect the output and prepare a revision.`;
        db.prepare('INSERT INTO tasks (id,workspace_id,project_id,number,title,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(revisionId, output.workspace_id, output.project_id, number, `Revise: ${output.title}`.slice(0, 200), description, 'ready', now(), now());
        const parentTask = output.task_id ? db.prepare('SELECT * FROM tasks WHERE id=?').get(output.task_id) : null;
        const projectTeam = db.prepare('PRAGMA table_info(tasks)').all().some(column => column.name === 'team_id') ? db.prepare('SELECT team_id FROM projects WHERE id=?').get(output.project_id)?.team_id : null;
        if (db.prepare('PRAGMA table_info(tasks)').all().some(column => column.name === 'team_id')) db.prepare('UPDATE tasks SET team_id=? WHERE id=?').run(parentTask?.team_id || projectTeam || null, revisionId);
        const revisionTask = db.prepare('SELECT * FROM tasks WHERE id=?').get(revisionId);
        authorizeRouteNodes([revisionTask], { actor, allowed, write: true });
        assertRouteLink(db, revisionTask, output.task_id, { actor, allowed });
        db.prepare('INSERT INTO route_workflows(id,workspace_id,owner_name,reviewer_name,output_type,parent_task_id,acceptance_json,dependency_ids_json,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(revisionId, output.workspace_id, agreement?.owner_name ?? '', reviewer, output.kind, output.task_id, '[]', '[]', 1, now());
        recordChange(db, 'tasks', null, revisionTask, 'created revision sub-route');
        recordChange(db, 'route_workflows', null, decode(db.prepare('SELECT * FROM route_workflows WHERE id=?').get(revisionId)), 'created');
      }
      const review = { id: id('review'), output_id: output.id, workspace_id: output.workspace_id, version_id: version.id, decision, reviewer_name: reviewer, feedback, revision_task_id: revisionId, created_at: now() };
      db.prepare('INSERT INTO output_reviews VALUES (?,?,?,?,?,?,?,?,?)').run(...Object.values(review));
      db.prepare('UPDATE outputs SET state=?,version=version+1,updated_at=? WHERE id=?').run(decision, now(), output.id); return review;
    });
  } else if (resource === 'context' && !entityId && req.method === 'POST') {
    const ws = workspace(db, body.workspace_id), project = active(db, 'projects', body.project_id, ws);
    const refs = body.sources ?? [];
    if (!Array.isArray(refs) || refs.length > 100 || new Set(refs.map(r => `${r?.type}:${r?.id}`)).size !== refs.length) throw validationError('Choose up to 100 unique context sources.');
    const sources = refs.map(ref => {
      if (!isRecord(ref)) throw validationError('Invalid context source.');
      const table = oneOf(ref.type, ['documents', 'memory_notes', 'knowledge_entries'], 'context source');
      const row = active(db, table, ref.id, ws, true);
      if (ref.expected_updated_at !== undefined && ref.expected_updated_at !== row.updated_at) throw conflict(`“${row.title}” changed after your preview. Review the context again.`);
      if (table === 'knowledge_entries' && row.state !== 'approved') throw validationError('Only approved knowledge can be included in context.');
      if (project && row.project_id && row.project_id !== project.id) throw validationError('A project context snapshot cannot include another project’s private context.');
      const content = row.content; return { type: table, id: row.id, title: row.title, content, updated_at: row.updated_at, hash: hash(content) };
    });
    const intro = text(body.content ?? '', 'Additional context', 50000);
    const content = [intro, ...sources.map(source => `## ${source.title}\n${source.content}`)].filter(Boolean).join('\n\n');
    if (!content || content.length > 200000) throw validationError('Context must contain 1–200,000 characters.');
    result = { id: id('context'), workspace_id: ws, project_id: project?.id ?? null, name: text(body.name, 'Snapshot name', 200, true), content, sources: sources.map(({ content, ...source }) => source), content_hash: hash(content), created_at: now() };
    db.prepare('INSERT INTO context_snapshots VALUES (?,?,?,?,?,?,?,?)').run(result.id, ws, result.project_id, result.name, content, JSON.stringify(result.sources), result.content_hash, result.created_at);
  } else if (resource === 'context' && entityId && action === 'attach-chat' && req.method === 'POST') {
    const context = active(db, 'context_snapshots', entityId, null, true); workspace(db, context.workspace_id);
    const chat = active(db, 'chats', body.chat_id, context.workspace_id, true);
    if (context.project_id && chat.project_id !== context.project_id) throw validationError('Attach project context to a chat in the same project.');
    if (context.content.length > 49000) throw validationError('This snapshot is too large for a chat note. Create a smaller focused snapshot.');
    // Idempotent attachment: retries do not flood a chat with identical notes.
    const old = db.prepare("SELECT id FROM messages WHERE chat_id=? AND json_extract(metadata_json,'$.library_context_snapshot_id')=?").get(chat.id, entityId);
    const messageId = old?.id ?? id('message');
    if (!old) db.prepare('INSERT INTO messages (id,chat_id,sender_type,sender_name,content,kind,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(messageId, chat.id, 'user', 'You', `Context snapshot: ${context.name}\n\n${context.content}`, 'note', JSON.stringify({ library_context_snapshot_id: entityId, content_hash: context.content_hash }), now(), now());
    result = { chat_id: chat.id, message_id: messageId, context_snapshot_id: entityId };
  } else if (resource === 'knowledge' && !action && ((!entityId && req.method === 'POST') || (entityId && req.method === 'PATCH'))) {
    const old = entityId ? db.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(entityId) : null;
    if (entityId && !old) throw validationError('Knowledge entry not found.'); if (old) expectVersion(body, old);
    const ws = workspace(db, old?.workspace_id ?? body.workspace_id);
    const projectId = body.project_id === undefined ? old?.project_id ?? null : body.project_id || null; active(db, 'projects', projectId, ws);
    const reviewDate = text(body.review_date ?? old?.review_date ?? '', 'Review date', 10);
    if (reviewDate && (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate) || !Number.isFinite(Date.parse(reviewDate)) || new Date(`${reviewDate}T00:00:00Z`).toISOString().slice(0, 10) !== reviewDate)) throw validationError('Choose a valid review date.');
    if (body.archived !== undefined && typeof body.archived !== 'boolean') throw validationError('Choose archive or restore.');
    result = { id: old?.id ?? id('knowledge'), workspace_id: ws, project_id: projectId, title: text(body.title ?? old?.title, 'Title', 200, true), kind: oneOf(body.kind ?? old?.kind ?? 'fact', ['fact', 'decision', 'preference', 'instruction'], 'knowledge type'), content: text(body.content ?? old?.content, 'Knowledge', 50000, true), source: text(body.source ?? old?.source ?? '', 'Source or rationale', 2000), state: oneOf(body.state ?? old?.state ?? 'draft', ['draft', 'approved', 'superseded'], 'knowledge state'), review_date: reviewDate, version: (old?.version ?? 0) + 1, archived_at: body.archived === undefined ? old?.archived_at ?? null : body.archived ? now() : null, created_at: old?.created_at ?? now(), updated_at: now() };
    if (old?.state === 'approved' && result.state === 'approved' && ['title', 'kind', 'content', 'source', 'project_id'].some(key => old[key] !== result[key])) result.state = 'draft';
    db.prepare(`INSERT INTO knowledge_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,title=excluded.title,kind=excluded.kind,content=excluded.content,source=excluded.source,state=excluded.state,review_date=excluded.review_date,version=excluded.version,archived_at=excluded.archived_at,updated_at=excluded.updated_at`).run(...Object.values(result));
  } else if (resource === 'projects' && entityId && req.method === 'PATCH' && !action) {
    const project = active(db, 'projects', entityId, null, true); workspace(db, project.workspace_id);
    const old = decode(db.prepare('SELECT * FROM project_strategies WHERE id=?').get(entityId));
    if (body.version !== (old?.version ?? 0)) throw conflict('Project strategy changed. Reopen it before saving.');
    const fields = Object.fromEntries(['audience', 'scope', 'success', 'exclusions', 'health_reason', 'retrospective'].map(key => [key, text(body[key] ?? old?.[key] ?? '', key.replaceAll('_', ' '), 20000)]));
    const health = oneOf(body.health ?? old?.health ?? 'on_track', ['on_track', 'at_risk', 'blocked', 'complete'], 'project health');
    if (['at_risk', 'blocked'].includes(health) && !fields.health_reason) throw validationError('Explain why the project is at risk or blocked.');
    const concerns = body.concerns ?? old?.concerns ?? [];
    if (!Array.isArray(concerns) || concerns.length > 100) throw validationError('Add up to 100 risks and questions.');
    const clean = concerns.map(item => {
      if (!isRecord(item)) throw validationError('Invalid project concern.');
      return { id: text(item.id, 'Concern ID', 100, true), kind: oneOf(item.kind, ['risk', 'question'], 'concern type'), content: text(item.content, 'Concern', 5000, true), owner: text(item.owner ?? '', 'Owner', 120), state: oneOf(item.state ?? 'open', ['open', 'resolved'], 'concern state'), resolution: text(item.resolution ?? '', 'Resolution', 5000) };
    });
    if (new Set(clean.map(item => item.id)).size !== clean.length) throw validationError('Project concerns must have unique IDs.');
    result = { id: entityId, workspace_id: project.workspace_id, ...fields, health, concerns: clean, version: (old?.version ?? 0) + 1, updated_at: now() };
    db.prepare(`INSERT INTO project_strategies (id,workspace_id,audience,scope,success,exclusions,health,health_reason,retrospective,concerns_json,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET audience=excluded.audience,scope=excluded.scope,success=excluded.success,exclusions=excluded.exclusions,health=excluded.health,health_reason=excluded.health_reason,retrospective=excluded.retrospective,concerns_json=excluded.concerns_json,version=excluded.version,updated_at=excluded.updated_at`).run(entityId, project.workspace_id, fields.audience, fields.scope, fields.success, fields.exclusions, health, fields.health_reason, fields.retrospective, JSON.stringify(clean), result.version, result.updated_at);
  } else if (resource === 'milestones' && entityId && req.method === 'PATCH' && !action) {
    const milestone = active(db, 'milestones', entityId, null, true); workspace(db, milestone.workspace_id);
    const old = decode(db.prepare('SELECT * FROM milestone_contracts WHERE id=?').get(entityId));
    if (body.version !== (old?.version ?? 0)) throw conflict('Milestone criteria changed. Reopen them before saving.');
    const list = body.acceptance;
    if (!Array.isArray(list) || list.length > 100) throw validationError('Add up to 100 milestone criteria.');
    const acceptance = list.map(item => { if (!isRecord(item) || typeof item.done !== 'boolean') throw validationError('Invalid criterion.'); return { id: text(item.id, 'Criterion ID', 100, true), text: text(item.text, 'Criterion', 1000, true), done: item.done }; });
    if (new Set(acceptance.map(item => item.id)).size !== acceptance.length) throw validationError('Criteria must have unique IDs.');
    result = { id: entityId, workspace_id: milestone.workspace_id, acceptance, version: (old?.version ?? 0) + 1, updated_at: now() };
    db.prepare('INSERT INTO milestone_contracts VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET acceptance_json=excluded.acceptance_json,version=excluded.version,updated_at=excluded.updated_at').run(entityId, milestone.workspace_id, JSON.stringify(acceptance), result.version, result.updated_at);
  } else return false;
  if (result?.workspace_id && !recorded) recordChange(db, auditResource, before, result, action || (before ? 'updated' : 'created'));
  send(res, status, { result, bootstrap: snapshot(db) }); return true;
}

import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { parsePatch, textPatch } from '../src/lib/change-review.js';
import { validationError } from './validation.mjs';

const targets = { project: 'projects', route: 'tasks', chat: 'chats', run: 'runs', document: 'documents' };
const areas = { project: 'projects', route: 'routes', chat: 'chats', run: 'agents', document: 'documents' };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp = () => new Date().toISOString();
export function createChangeReviewService({ db, workbench, platform, authorize }) {
  const checkpoints = new Map();
  db.exec(`CREATE TABLE IF NOT EXISTS change_reviews (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,target_id TEXT NOT NULL,project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,source_json TEXT NOT NULL,comparison_json TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,
    UNIQUE(workspace_id,target_type,target_id,fingerprint));
    CREATE TABLE IF NOT EXISTS change_review_comments (
    id TEXT PRIMARY KEY,review_id TEXT NOT NULL REFERENCES change_reviews(id) ON DELETE CASCADE,
    path TEXT NOT NULL,side TEXT NOT NULL,line INTEGER NOT NULL,body TEXT NOT NULL,author_id TEXT NOT NULL,author_name TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS change_review_files (
    review_id TEXT NOT NULL REFERENCES change_reviews(id) ON DELETE CASCADE,actor_id TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(review_id,actor_id,path));
    CREATE INDEX IF NOT EXISTS change_reviews_target ON change_reviews(workspace_id,target_type,target_id);`);
  function target(query, actor, write = false) {
    const table = targets[query.target_type];
    const row = table && db.prepare(`SELECT * FROM ${table} WHERE id=? AND workspace_id=?`).get(query.target_id || '', query.workspace_id || '');
    if (!row || row.archived_at) throw validationError('Choose an available review target in this workspace.');
    const projectId = query.target_type === 'project' ? row.id : row.project_id;
    if (projectId && !db.prepare('SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(projectId, row.workspace_id)) throw validationError('The review project is unavailable.');
    const scope = projectId ? { scope_type: 'project', scope_id: projectId } : row.team_id ? { scope_type: 'team', scope_id: row.team_id } : {};
    authorize(row.workspace_id, actor.id, 'workspace.read', scope);
    if (projectId) authorize(row.workspace_id, actor.id, 'projects.read', scope);
    authorize(row.workspace_id, actor.id, `${areas[query.target_type]}.${write ? 'write' : 'read'}`, scope);
    return { row, projectId, scope };
  }
  function scopeQuery(review) { return { workspace_id: review.workspace_id, target_type: review.target_type, target_id: review.target_id }; }
  function documentRevision(source, query, actor, info) {
    const history = query.target_type === 'document' && db.prepare("SELECT * FROM change_log WHERE id=? AND workspace_id=? AND entity_type='documents' AND entity_id=?").get(source.revision_id || '', query.workspace_id, query.target_id);
    if (!history) throw validationError('Choose a saved document revision.');
    // A readable current document does not grant access to text captured in its
    // former project/team. Recheck both sides on previews and saved snapshot reads.
    for (const json of [history.before_json, history.after_json]) {
      if (!json) continue;
      const state = JSON.parse(json);
      if (!state) continue;
      if (state.workspace_id && state.workspace_id !== query.workspace_id) throw validationError('This document revision is unavailable.');
      const projectId = Object.hasOwn(state, 'project_id') ? state.project_id : info.row.project_id;
      const teamId = Object.hasOwn(state, 'team_id') ? state.team_id : info.row.team_id;
      const scopes = [];
      if (projectId) {
        if (!db.prepare('SELECT 1 FROM projects WHERE id=? AND workspace_id=?').get(projectId, query.workspace_id)) throw validationError('This document revision is unavailable.');
        scopes.push({ scope_type: 'project', scope_id: projectId });
      }
      if (teamId) scopes.push({ scope_type: 'team', scope_id: teamId });
      for (const scope of scopes.length ? scopes : [{}]) {
        authorize(query.workspace_id, actor.id, 'workspace.read', scope);
        if (scope.scope_type === 'project') authorize(query.workspace_id, actor.id, 'projects.read', scope);
        authorize(query.workspace_id, actor.id, 'documents.read', scope);
      }
    }
    return history;
  }
  async function sourceAccess(source, query, actor, info) {
    if (source.kind === 'local' || source.kind === 'run') authorize(query.workspace_id, actor.id, 'workbench.read', info.scope);
    if (source.kind === 'document') documentRevision(source, query, actor, info);
    if (source.kind === 'github') {
      const connections = await platform.list(query.workspace_id, actor);
      const connection = connections.find(item => item.id === source.connection_id && item.provider === 'github');
      if (!connection || connection.state !== 'connected' || !connection.settings.selected_resources.includes(source.resource_id) || !connection.settings.enabled_features.includes('read')) throw validationError('This GitHub repository is no longer shared for reading with this workspace.');
      authorize(query.workspace_id, actor.id, 'connections.read', { scope_type: connection.scope_type, scope_id: connection.scope_id });
    }
  }
  async function compare(query, actor) {
    const info = target(query, actor), source = query.source || {};
    await sourceAccess(source, query, actor, info);
    let comparison;
    if (source.kind === 'local') {
      if (!info.projectId) throw validationError('Link this item to a project folder before comparing local code.');
      const url = new URL('http://localhost/workbench');
      for (const key of ['mode', 'base', 'head', 'environment_id']) if (source[key]) url.searchParams.set(key, source[key]);
      comparison = await workbench.dispatch(workbench.scope(query.workspace_id, info.projectId), 'comparison', 'GET', {}, url);
    } else if (source.kind === 'github') {
      const result = await platform.code(source.connection_id, { resource_id: source.resource_id, kind: 'pull', number: source.number }, actor);
      comparison = { ...result, source: 'github', fingerprint: hash({ connection: source.connection_id, repository: source.resource_id, base: result.base, head: result.head, files: result.files }) };
    } else if (source.kind === 'document' && query.target_type === 'document') {
      const history = documentRevision(source, query, actor, info);
      const before = JSON.parse(history.before_json || '{}'), after = JSON.parse(history.after_json || '{}');
      const patch = textPatch(`${before.title || ''}\n\n${before.content || ''}`, `${after.title || ''}\n\n${after.content || ''}`);
      comparison = { source: 'document', title: history.name, base: 'Before saved revision', head: history.created_at, files: [{ path: 'document.md', patch, status: history.action }], notice: 'This compares the text before and after this saved revision. It never restores or edits the document.', fingerprint: hash({ revision: history.id, patch }) };
    } else throw validationError('Choose a local repository, GitHub pull request, or document revision.');
    return { ...comparison, captured_at: stamp() };
  }
  function save(query, source, comparison, actor) {
    const info = target(query, actor, true);
    const prior = db.prepare('SELECT id FROM change_reviews WHERE workspace_id=? AND target_type=? AND target_id=? AND fingerprint=?').get(query.workspace_id, query.target_type, query.target_id, comparison.fingerprint);
    if (prior) return prior.id;
    const id = randomUUID();
    db.prepare('INSERT INTO change_reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, query.workspace_id, query.target_type, query.target_id, info.projectId || null, comparison.fingerprint, JSON.stringify(source), JSON.stringify(comparison), actor.id, stamp());
    return id;
  }
  async function get(id, actor, write = false) {
    const review = db.prepare('SELECT * FROM change_reviews WHERE id=?').get(id);
    if (!review) throw validationError('Review snapshot unavailable.');
    const info = target(scopeQuery(review), actor, write), source = JSON.parse(review.source_json);
    if ((review.project_id || null) !== (info.projectId || null)) throw validationError('The review target moved to another project. Previous project snapshots are not shared automatically.');
    await sourceAccess(source, scopeQuery(review), actor, info);
    return { ...review, source, comparison: JSON.parse(review.comparison_json), source_json: undefined, comparison_json: undefined, comments: db.prepare('SELECT * FROM change_review_comments WHERE review_id=? ORDER BY created_at').all(id), reviewed: db.prepare('SELECT path FROM change_review_files WHERE review_id=? AND actor_id=?').all(id, actor.id).map(row => row.path) };
  }
  async function handle({ path, method, query, body, actor }) {
    if (path !== '/change-reviews' && !path.startsWith('/change-reviews/')) return null;
    if (path === '/change-reviews/compare' && method === 'POST') return { result: await compare(body, actor) };
    if (path === '/change-reviews' && method === 'GET') {
      target(query, actor);
      const records = query.target_type === 'project' ? db.prepare('SELECT id FROM change_reviews WHERE workspace_id=? AND project_id=? ORDER BY created_at DESC LIMIT 100').all(query.workspace_id, query.target_id) : ['chat', 'route'].includes(query.target_type) ? db.prepare(`SELECT id FROM change_reviews WHERE workspace_id=? AND ((target_type=? AND target_id=?) OR (target_type='run' AND target_id IN (SELECT id FROM runs WHERE ${query.target_type === 'chat' ? 'chat_id' : 'task_id'}=?))) ORDER BY created_at DESC LIMIT 100`).all(query.workspace_id, query.target_type, query.target_id, query.target_id) : db.prepare('SELECT id FROM change_reviews WHERE workspace_id=? AND target_type=? AND target_id=? ORDER BY created_at DESC LIMIT 100').all(query.workspace_id, query.target_type, query.target_id);
      const result = [];
      for (const record of records) { try { const review = await get(record.id, actor); result.push({ id: review.id, title: review.comparison.title, created_at: review.created_at, source: review.source.kind, fingerprint: review.fingerprint, files: review.comparison.files.length }); } catch { /* Revoked source access hides snapshots too. */ } }
      return { result };
    }
    if (path === '/change-reviews' && method === 'POST') { target(body, actor, true); const comparison = await compare(body, actor); if (comparison.fingerprint !== body.fingerprint) throw Object.assign(validationError('The source changed. Refresh and review it before saving.'), { statusCode: 409 }); return { result: await get(save(body, body.source, comparison, actor), actor) }; }
    const match = path.match(/^\/change-reviews\/([^/]+)(?:\/(comments|reviewed|refresh))?$/);
    if (!match) throw validationError('Review action unavailable.');
    const review = await get(match[1], actor, method !== 'GET');
    if (!match[2] && method === 'GET') return { result: review };
    if (match[2] === 'refresh' && method === 'POST') { if (review.source.kind === 'run') return { result: { current: true, immutable: true, comparison: review.comparison } }; const comparison = await compare({ ...scopeQuery(review), source: review.source }, actor); return { result: { current: comparison.fingerprint === review.fingerprint, comparison } }; }
    if (match[2] === 'comments' && method === 'POST') {
      const file = review.comparison.files.find(file => file.path === body.path);
      const side = body.side === 'old' ? 'old' : body.side === 'new' ? 'new' : null;
      if (!file || !side || !Number.isInteger(body.line) || !parsePatch(file.patch).some(row => row[side === 'old' ? 'oldLine' : 'newLine'] === body.line)) throw validationError('Choose a line in this exact snapshot.');
      if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 10000) throw validationError('Write a comment of up to 10,000 characters.');
      db.prepare('INSERT INTO change_review_comments VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), review.id, body.path, side, body.line, body.body.trim(), actor.id, actor.name || 'Workspace member', stamp());
      return { result: await get(review.id, actor) };
    }
    if (match[2] === 'reviewed' && method === 'POST') {
      if (!review.comparison.files.some(file => file.path === body.path) || typeof body.reviewed !== 'boolean') throw validationError('Choose a file and its reviewed state.');
      if (body.reviewed) db.prepare('INSERT OR IGNORE INTO change_review_files VALUES(?,?,?)').run(review.id, actor.id, body.path);
      else db.prepare('DELETE FROM change_review_files WHERE review_id=? AND actor_id=? AND path=?').run(review.id, actor.id, body.path);
      return { result: await get(review.id, actor) };
    }
    throw validationError('Review action unavailable.');
  }
  async function beginRun(runId, actor, cwd) {
    const run = db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    if (!run?.project_id) return;
    const query = { workspace_id: run.workspace_id, target_type: 'run', target_id: runId };
    const info = target(query, actor); await sourceAccess({ kind: 'run' }, query, actor, info);
    const checkpoint = await workbench.dispatch(workbench.scope(run.workspace_id, run.project_id), 'checkpoint', 'GET', {}, new URL('http://localhost'));
    if (checkpoint.root !== await realpath(cwd)) return;
    checkpoints.set(runId, checkpoint);
  }
  async function finishRun(runId, actor) {
    const before = checkpoints.get(runId); checkpoints.delete(runId);
    if (!before) return null;
    const run = db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    if (!run) return null;
    const query = { workspace_id: run.workspace_id, target_type: 'run', target_id: runId };
    const info = target(query, actor, true); await sourceAccess({ kind: 'run' }, query, actor, info);
    const after = await workbench.dispatch(workbench.scope(run.workspace_id, run.project_id), 'checkpoint', 'GET', {}, new URL('http://localhost'));
    if (before.root !== after.root) return null;
    const files = [];
    for (const path of new Set([...Object.keys(before.files), ...Object.keys(after.files)])) {
      if (before.files[path] === after.files[path]) continue;
      // With incomplete checkpoints a missing file is unknown, not a deletion/addition.
      if (before.limited && before.files[path] === undefined || after.limited && after.files[path] === undefined) continue;
      const patch = textPatch(before.files[path] || '', after.files[path] || '');
      files.push({ path, patch: patch.length > 300000 ? '' : patch, unavailable: patch.length > 300000 ? 'Run diff exceeds 300 KB.' : null, status: before.files[path] === undefined ? 'added' : after.files[path] === undefined ? 'deleted' : 'modified' });
    }
    const comparison = { source: 'run', title: `${run.title} · observed changes`, base: 'Before session', head: 'After session', files, limited: before.limited || after.limited, notice: 'Observed folder changes during this run, not proof of authorship. Concurrent edits may be included. Private, large and binary files are excluded.', fingerprint: hash({ runId, files }), captured_at: stamp() };
    return save(query, { kind: 'run' }, comparison, actor);
  }
  return { handle, compare, save, get, beginRun, finishRun, discardRun: runId => checkpoints.delete(runId) };
}

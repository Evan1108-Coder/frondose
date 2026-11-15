import { randomUUID } from 'node:crypto';

const fail = (message, code = 'github_routes_invalid', statusCode = 400) => Object.assign(new Error(message), { code, errorCode: code, statusCode });
const owner = { id: 'local-owner' };
const stamp = time => new Date(time).toISOString();
const equalScope = (a, b) => a.repository === b.repository && a.bindingVersion === b.bindingVersion && a.rootIdentity === b.rootIdentity && a.boundProjectId === b.boundProjectId && a.connectionVersion === b.connectionVersion;
const states = ['backlog', 'todo', 'in_progress'];
export function normalizeGitHubRouteConfig(input = {}) {
  const interval = input.interval_minutes ?? 10, limit = input.limit ?? 50, query = input.query ?? '', labels = input.labels ?? [];
  if (typeof input.enabled !== 'boolean' || !Number.isInteger(interval) || interval < 5 || interval > 60 || ![25, 50, 100].includes(limit)) throw fail('Choose automatic import, a 5–60 minute interval, and a 25, 50 or 100 issue limit.');
  if (typeof query !== 'string' || query.length > 300 || /[\u0000-\u001f\u007f]/.test(query) || /(?:^|\s)-?(?:repo|org|user|owner|type|is):/i.test(query)) throw fail('Search within this repository using up to 300 characters; repository and issue-type overrides are unavailable.');
  if (!Array.isArray(labels) || labels.length > 10 || labels.some(label => typeof label !== 'string' || !label.trim() || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label))) throw fail('Choose up to 10 GitHub label names.');
  for (const key of ['assigned_to_me', 'include_body', 'copy_labels']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw fail('Choose valid issue import options.');
  for (const key of ['project_id', 'area_id']) if (input[key] != null && (typeof input[key] !== 'string' || input[key].length > 160)) throw fail('Choose an available destination.');
  if (!['open', 'closed', 'all'].includes(input.state ?? 'open') || !states.includes(input.initial_status ?? 'backlog') || !['no_priority', 'low', 'medium', 'high', 'urgent'].includes(input.priority ?? 'no_priority')) throw fail('Choose valid issue and initial Route states.');
  return { enabled: input.enabled, interval_minutes: interval, limit, query: query.trim(), labels: [...new Set(labels.map(label => label.trim()))],
    assigned_to_me: input.assigned_to_me ?? false, include_body: input.include_body ?? true, copy_labels: input.copy_labels ?? false,
    project_id: input.project_id || null, area_id: input.area_id || null, state: input.state ?? 'open', initial_status: input.initial_status ?? 'backlog', priority: input.priority ?? 'no_priority' };
}

/** Local-owner, read-only GitHub source. Config and provenance are separate from
 * credentials. Only explicit opt-in schedules gh reads; imports are create-only.
 * Source tombstones deliberately survive a deleted Route to prevent resurrection. */
export function createGitHubRouteSyncService({ db, roots, git, allowed = () => true, record = () => {}, now = Date.now, pollMilliseconds = 60000, start = true, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS github_route_configs (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    config_json TEXT NOT NULL, scope_json TEXT NOT NULL, revision TEXT NOT NULL,
    next_check_at TEXT, last_checked_at TEXT, last_success_at TEXT, last_result_json TEXT, last_error TEXT);
    CREATE TABLE IF NOT EXISTS github_route_sources (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository TEXT NOT NULL, issue_number INTEGER NOT NULL, issue_url TEXT NOT NULL,
    route_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, remote_updated_at TEXT, imported_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id,repository,issue_number));`);
  let closed = false, ticking = false;
  const running = new Set();
  const rowFor = id => db.prepare('SELECT * FROM github_route_configs WHERE workspace_id=?').get(id);
  const read = row => row ? { ...JSON.parse(row.config_json), revision: row.revision } : null;
  function authorize(workspaceId, actor, scope = {}) {
    if (actor?.id !== owner.id || !db.prepare('SELECT 1 FROM workspaces WHERE id=? AND archived_at IS NULL').get(workspaceId) || !allowed(workspaceId, actor, 'routes.write', scope)) throw fail('Only the local workspace owner with Route write access can manage issue imports.', 'access_denied', 403);
  }
  async function proof(workspaceId, actor) {
    authorize(workspaceId, actor);
    const state = await git.inspect(workspaceId, actor);
    if (!state.connected || !state.github || !state.connectionVersion) throw fail('Connect this workspace directory to GitHub before importing issues.', 'github_not_connected', 409);
    const context = await roots.rootFor(workspaceId, actor);
    return { state, scope: { repository: state.github.slug, bindingVersion: context.row.version, rootIdentity: context.row.root_identity, boundProjectId: context.row.project_id, connectionVersion: state.connectionVersion } };
  }
  function destination(workspaceId, actor, config) {
    let areaId = config.area_id;
    if (config.project_id) {
      const project = db.prepare('SELECT id,team_id FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(config.project_id, workspaceId);
      if (!project || !allowed(workspaceId, actor, 'routes.write', { scope_type: 'project', scope_id: project.id })) throw fail('The destination project is unavailable.', 'github_routes_destination', 409);
      if (areaId && areaId !== project.team_id) throw fail('A Route uses its project’s Area. Choose a matching destination.', 'github_routes_destination', 409);
      areaId = project.team_id || null;
    }
    if (areaId && (!db.prepare('SELECT 1 FROM teams WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(areaId, workspaceId) || !allowed(workspaceId, actor, 'routes.write', { scope_type: 'team', scope_id: areaId }))) throw fail('The destination Area is unavailable.', 'github_routes_destination', 409);
    return { ...config, area_id: areaId };
  }
  async function settings(workspaceId, actor) {
    authorize(workspaceId, actor); const state = await git.inspect(workspaceId, actor), row = rowFor(workspaceId), config = read(row);
    let current = false;
    if (state.connected && row) {
      const context = await roots.rootFor(workspaceId, actor);
      current = equalScope(JSON.parse(row.scope_json), { repository: state.github?.slug, bindingVersion: context.row.version, rootIdentity: context.row.root_identity, boundProjectId: context.row.project_id, connectionVersion: state.connectionVersion });
    }
    let suspended = config && !current ? 'connection_changed' : null;
    if (config && current) { try { destination(workspaceId, actor, config); } catch (error) { suspended = error.code || 'github_routes_destination'; } }
    return { connected: state.connected === true, repository: state.github || null, bindingVersion: state.bindingVersion, config,
      status: { state: running.has(workspaceId) ? 'syncing' : suspended ? 'suspended' : config?.enabled ? 'scheduled' : 'manual', reason: suspended || row?.last_error || null, lastCheckedAt: row?.last_checked_at || null, lastSuccessAt: row?.last_success_at || null, nextCheckAt: !suspended && config?.enabled ? row.next_check_at : null, result: row?.last_result_json ? JSON.parse(row.last_result_json) : null },
      importedCount: db.prepare('SELECT count(*) AS n FROM github_route_sources WHERE workspace_id=?').get(workspaceId).n };
  }
  async function save(workspaceId, actor, input) {
    if (input.confirmed !== true) throw fail('Confirm these local issue import settings.');
    const captured = await proof(workspaceId, actor), previous = rowFor(workspaceId);
    if ((input.expected_revision ?? null) !== (previous?.revision ?? null) || input.expected_binding_version !== captured.scope.bindingVersion || input.expected_repository !== captured.scope.repository) throw fail('The repository or settings changed. Refresh before saving.', 'github_routes_conflict', 409);
    const config = destination(workspaceId, actor, normalizeGitHubRouteConfig(input)), revision = randomUUID();
    // No remote read on Save. The next bounded check happens at the chosen time.
    db.prepare(`INSERT INTO github_route_configs(workspace_id,config_json,scope_json,revision,next_check_at) VALUES(?,?,?,?,?)
      ON CONFLICT(workspace_id) DO UPDATE SET config_json=excluded.config_json,scope_json=excluded.scope_json,revision=excluded.revision,next_check_at=excluded.next_check_at,last_error=NULL`).run(workspaceId, JSON.stringify(config), JSON.stringify(captured.scope), revision, config.enabled ? stamp(now() + config.interval_minutes * 60000) : null);
    return settings(workspaceId, actor);
  }
  async function sync(workspaceId, actor, input = {}, automatic = false) {
    if (closed) throw fail('Issue import is unavailable while Frondose is closing.', 'github_routes_closed', 409);
    if (running.has(workspaceId)) throw fail('An issue import is already running for this workspace.', 'github_routes_busy', 409);
    if (!automatic && input.confirmed !== true) throw fail('Choose Sync now to read GitHub and create local Routes.');
    if (!automatic) authorize(workspaceId, actor);
    const original = rowFor(workspaceId), config = read(original);
    if (!config || !automatic && input.expected_revision !== config.revision) throw fail('Save the issue import settings before syncing.', 'github_routes_conflict', 409);
    if (automatic && !config.enabled) return null;
    running.add(workspaceId);
    try {
      authorize(workspaceId, actor);
      const captured = await proof(workspaceId, actor), savedScope = JSON.parse(original.scope_json);
      if (closed) return null;
      if (!equalScope(savedScope, captured.scope)) throw fail('The repository or selected directory changed. Review and save these settings again.', 'connection_changed', 409);
      destination(workspaceId, actor, config);
      const response = await git.issues(workspaceId, actor, { confirmed: true, expected_version: captured.state.version, expected_binding_version: captured.state.bindingVersion, state: config.state, query: config.query, assigned_to_me: config.assigned_to_me, include_body: config.include_body, limit: config.limit });
      if (closed) return null;
      // Network await invalidates every proof: recheck consent, binding, ACL,
      // destination, current config revision and source before the atomic write.
      const fresh = await proof(workspaceId, actor), latest = rowFor(workspaceId);
      if (closed) return null;
      if (!latest || latest.revision !== original.revision || !equalScope(savedScope, fresh.scope) || response.repository?.slug !== savedScope.repository) throw fail('The import settings or source changed. Nothing was imported.', 'github_routes_conflict', 409);
      const target = destination(workspaceId, actor, read(latest));
      if (automatic && !target.enabled) return null;
      const issues = response.issues.filter(issue => config.labels.every(label => issue.labels.includes(label))), result = { created: 0, existing: 0, filtered: response.issues.length - issues.length, limited: Boolean(response.limited), checked: response.issues.length, routeIds: [] }, date = stamp(now());
      db.exec('BEGIN IMMEDIATE');
      try {
        authorize(workspaceId, actor); destination(workspaceId, actor, target);
        for (const issue of issues) {
          if (!Number.isSafeInteger(issue.number) || issue.number < 1 || typeof issue.title !== 'string' || !issue.title.trim()) continue;
          if (db.prepare('SELECT 1 FROM github_route_sources WHERE workspace_id=? AND repository=? AND issue_number=?').get(workspaceId, savedScope.repository, issue.number)) { ++result.existing; continue; }
          const routeId = `task_${randomUUID().replaceAll('-', '')}`, number = db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM tasks WHERE workspace_id=?').get(workspaceId).n;
          const sourceUrl = `https://github.com/${savedScope.repository}/issues/${issue.number}`, description = `${config.include_body ? String(issue.body || '').slice(0, 12000) + '\n\n' : ''}Source: ${sourceUrl}\nImported from ${savedScope.repository}#${issue.number}. Local edits and completion stay in Frondose.`;
          db.prepare('INSERT INTO tasks(id,workspace_id,project_id,team_id,number,title,description,status,priority,labels_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(routeId, workspaceId, target.project_id, target.area_id, number, issue.title.slice(0, 200), description, config.initial_status, config.priority, JSON.stringify(config.copy_labels ? issue.labels : []), date, date);
          db.prepare('INSERT INTO github_route_sources VALUES(?,?,?,?,?,?,?)').run(workspaceId, savedScope.repository, issue.number, sourceUrl, routeId, issue.updatedAt || null, date);
          record(db, 'tasks', null, db.prepare('SELECT * FROM tasks WHERE id=?').get(routeId), 'imported GitHub issue');
          ++result.created; result.routeIds.push(routeId);
        }
        db.prepare('UPDATE github_route_configs SET last_checked_at=?,last_success_at=?,last_result_json=?,last_error=NULL,next_check_at=? WHERE workspace_id=? AND revision=?').run(date, date, JSON.stringify(result), config.enabled ? stamp(now() + config.interval_minutes * 60000) : null, workspaceId, original.revision);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return result;
    } catch (error) {
      if (!closed) db.prepare('UPDATE github_route_configs SET last_checked_at=?,last_error=?,next_check_at=? WHERE workspace_id=? AND revision=?').run(stamp(now()), ['connection_changed', 'github_routes_destination', 'access_denied', 'github_not_connected', 'github_routes_conflict'].includes(error.code) ? error.code : 'github_read_failed', stamp(now() + config.interval_minutes * 60000), workspaceId, original.revision);
      throw error;
    } finally { running.delete(workspaceId); }
  }
  async function tick() {
    if (closed || ticking) return;
    ticking = true;
    try {
      // At most four sequential workspace checks per minute, each bounded by the
      // Git/gh service timeout and issue cap. Disabled configs never call gh.
      for (const row of db.prepare('SELECT workspace_id,config_json FROM github_route_configs WHERE next_check_at<=? ORDER BY next_check_at LIMIT 4').all(stamp(now()))) {
        if (closed) break;
        if (JSON.parse(row.config_json).enabled) { try { await sync(row.workspace_id, owner, {}, true); } catch { /* Persisted truthful status; never retry in a tight loop. */ } }
      }
    } finally { ticking = false; }
  }
  const timer = start ? setTimer(() => { void tick().catch(() => {}); }, Math.max(1000, pollMilliseconds)) : null;
  timer?.unref?.();
  async function dispatch({ workspaceId, actor, method = 'GET', action = '', input = {} }) {
    if (method === 'GET' && !action) return settings(workspaceId, actor);
    if (method === 'POST' && action === 'settings') return save(workspaceId, actor, input);
    if (method === 'POST' && action === 'sync') { const result = await sync(workspaceId, actor, input); return { ...await settings(workspaceId, actor), sync: result }; }
    throw fail('This GitHub Route action is unavailable.', 'not_found', 404);
  }
  return { settings, save, sync, tick, dispatch, close() { if (closed) return; closed = true; if (timer) clearTimer(timer); } };
}

import { createActivityPolicy } from './activity-policy.mjs';
const failure = message => { throw Object.assign(new Error(message), { statusCode: 403, code: 'access_denied' }); };
const TABLES = { workspaces: 'workspaces', projects: 'projects', tasks: 'tasks', chats: 'chats', messages: 'messages', agents: 'agents', 'memory-notes': 'memory_notes', teams: 'teams', 'team-members': 'team_members', documents: 'documents', milestones: 'milestones', runs: 'runs', 'workspace-items': 'workspace_items', 'team-resources': 'team_resources', activity: 'activity_entries', 'agent-actions': 'agent_action_requests', 'agent-memories': 'agent_memories' };
const AREA = { workspaces: 'workspace', projects: 'projects', tasks: 'routes', chats: 'chats', messages: 'chats', agents: 'agents', 'memory-notes': 'documents', teams: 'workspace', 'team-members': 'members', documents: 'documents', milestones: 'projects', runs: 'agents', 'workspace-items': 'workspace', 'team-resources': 'documents', activity: 'workspace', 'agent-actions': 'agents', 'agent-memories': 'agents' };

export function createAccessBoundary({ db, governance }) {
  const member = (ws, actor) => db.prepare("SELECT * FROM governance_members WHERE workspace_id=? AND id=? AND status='active'").get(ws, actor.id);
  const tableExists = table => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  const row = (table, id) => id && tableExists(table) ? db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) : null;
  function parent(item, table) {
    if (!item) return null;
    if (item.entity_type && item.entity_id) return { item: row(item.entity_type, item.entity_id), table: item.entity_type };
    if (item.target_type && item.target_id) { const targetTable = { project: 'projects', route: 'tasks', request: 'workspace_items', chat: 'chats', document: 'documents', output: 'outputs', milestone: 'milestones' }[item.target_type]; if (targetTable) return { item: row(targetTable, item.target_id), table: targetTable }; }
    if (table === 'workspace_items' && item.kind === 'request') { const payload = item.payload || JSON.parse(item.payload_json || '{}'); if (payload.route_id) return { item: row('tasks', payload.route_id), table: 'tasks' }; }
    if (['project_strategies', 'route_workflows', 'milestone_contracts'].includes(table)) { const targetTable = { project_strategies: 'projects', route_workflows: 'tasks', milestone_contracts: 'milestones' }[table]; return { item: row(targetTable, item.id), table: targetTable }; }
    for (const [key, targetTable] of [['project_id', 'projects'], ['task_id', 'tasks'], ['source_task_id', 'tasks'], ['chat_id', 'chats'], ['run_id', 'runs'], ['output_id', 'outputs'], ['source_message_id', 'messages']]) if (item[key]) return { item: row(targetTable, item[key]), table: targetTable };
    return null;
  }
  function scope(item, table, seen = new Set()) {
    if (!item || seen.has(`${table}:${item.id}`)) return {};
    seen.add(`${table}:${item.id}`);
    if (item.entity_type && item.entity_id) { const ancestor = parent(item, table); return scope(ancestor?.item, ancestor?.table, seen); }
    if (table === 'projects') return { scope_type: 'project', scope_id: item.id };
    if (table === 'teams') return { scope_type: 'team', scope_id: item.id };
    if (table === 'agents' && item.workspace_id) return { scope_type: 'agent', scope_id: item.id };
    if (item?.project_id) return { scope_type: 'project', scope_id: item.project_id };
    if (item?.team_id) return { scope_type: 'team', scope_id: item.team_id };
    const ancestor = parent(item, table); if (ancestor?.item) return scope(ancestor.item, ancestor.table, seen);
    return {};
  }
  function workspaceFor(item, table) {
    if (!item) return null;
    if (table === 'workspaces') return item.id;
    if (item.workspace_id) return item.workspace_id;
    if (item.chat_id) return row('chats', item.chat_id)?.workspace_id;
    if (item.run_id) return row('runs', item.run_id)?.workspace_id;
    return null;
  }
  function allowed(ws, actor, permission, at = {}) {
    if (!ws || !member(ws, actor)) return false;
    try {
      if (!governance.explain(ws, actor.id, 'workspace.read', at).allowed) return false;
      if (at.scope_type === 'project' && !governance.explain(ws, actor.id, 'projects.read', at).allowed) return false;
      return governance.explain(ws, actor.id, permission, at).allowed;
    } catch { return false; }
  }
  const activity = createActivityPolicy(db, allowed);
  function legacyAllowed(item, actor, permission = 'workspace.read') {
    if (!item || !['update', 'request'].includes(item.kind)) return true;
    const payload = item.payload || JSON.parse(item.payload_json || '{}');
    for (const id of payload.project_ids || []) { const project = row('projects', id); if (!project || project.workspace_id !== item.workspace_id || !allowed(item.workspace_id, actor, permission, { scope_type: 'project', scope_id: id })) return false; }
    if (payload.route_id) { const route = row('tasks', payload.route_id); if (!route || route.workspace_id !== item.workspace_id || !allowed(item.workspace_id, actor, permission, scope(route, 'tasks'))) return false; }
    return true;
  }
  function check({ actor, path, method, url, body = {} }) {
    if (!actor) failure('Sign in to continue.');
    if (path.startsWith('/governance') || path.startsWith('/connection-platform') || path.startsWith('/identity') || path === '/change-reviews' || path.startsWith('/change-reviews/')) return; // These services authenticate every target and source themselves.
    if (['/bootstrap', '/snapshot', '/health', '/events'].includes(path) && method === 'GET') return;
    // Existing global runner credentials and machine preferences belong to the installation owner.
    if (/^\/(?:auth|connections|settings|profile|account|reset|import)(?:\/|$)/.test(path)) {
      if (actor.id !== 'local-owner') failure('This installation setting is managed by its owner.');
      return;
    }
    if (path === '/workspaces' && method === 'POST') {
      if (actor.id !== 'local-owner') failure('Only the installation owner can create workspaces in this build.');
      return;
    }
    let parts = path.split('/').filter(Boolean).map(part => {
      let decoded;
      try { decoded = decodeURIComponent(part); } catch { failure('Invalid path encoding.'); }
      if (/[\x00-\x1f/\\]/.test(decoded)) failure('Invalid path segment.');
      return decoded;
    }), collection = parts[0], table = TABLES[collection], item = table ? row(table, parts[1]) : null;
    if (collection === 'workflow') {
      const mapping = { routes: 'tasks', projects: 'projects', milestones: 'milestones', outputs: 'outputs', comments: 'output_comments', context: 'context_snapshots', knowledge: 'knowledge_entries' };
      table = mapping[parts[1]]; item = table ? row(table, parts[2]) : null; collection = parts[1] === 'routes' ? 'tasks' : ['projects', 'milestones'].includes(parts[1]) ? 'projects' : 'documents';
    }
    if (collection === 'chat-collaboration') { table = 'chats'; item = row(table, parts[1]); collection = 'chats'; }
    if (collection === 'route-tools') { table = parts[1] === 'schedules' ? 'route_schedules' : 'tasks'; item = row(table, parts[1] === 'schedules' ? parts[2] : parts[1]); collection = 'tasks'; }
    if (collection === 'coordination') { table = 'work_plans'; item = row(table, parts[2]); collection = 'projects'; }
    if (collection === 'history') { const change = db.prepare('SELECT * FROM change_log WHERE entity_id=? LIMIT 1').get(parts[1]); table = change?.entity_type; item = change ? row(table, change.entity_id) || change : row('activity_entries', parts[1]); collection = table === 'activity_entries' || item?.target_type ? 'activity' : table === 'workspace_items' ? 'workspace-items' : 'documents'; }
    if (collection === 'activity') {
      if (item?.target_type && !activity.visible(item, actor)) failure('This update is unavailable.');
      const targetType = item?.target_type || body.target_type || url.searchParams.get('target_type');
      const targetId = item?.target_id || body.target_id || url.searchParams.get('target_id');
      const targetTable = { project: 'projects', route: 'tasks', request: 'workspace_items', document: 'documents', output: 'outputs', milestone: 'milestones', chat: 'chats' }[targetType];
      const target = targetTable ? row(targetTable, targetId) : null;
      if (target) { item = target; table = targetTable; }
      collection = { project: 'projects', route: 'tasks', request: 'workspace-items', document: 'documents', output: 'documents', milestone: 'projects', chat: 'chats' }[targetType] || 'activity';
    }
    const workspaceIds = new Set([workspaceFor(item, table), body.workspace_id, url.searchParams.get('workspace_id')].filter(Boolean));
    const scopes = [];
    for (const [key, refTable] of [['project_id', 'projects'], ['team_id', 'teams'], ['task_id', 'tasks'], ['chat_id', 'chats'], ['agent_id', 'agents'], ['run_id', 'runs']]) {
      const refId = body[key] || url.searchParams.get(key);
      const ref = row(refTable, refId);
      if (ref?.workspace_id) workspaceIds.add(ref.workspace_id);
      if (ref) scopes.push(scope(ref, refTable));
    }
    if (collection === 'workbench') {
      const project = row('projects', parts[1]);
      if (project) { workspaceIds.add(project.workspace_id); scopes.push({ scope_type: 'project', scope_id: project.id }); }
    }
    if (workspaceIds.size > 1) throw Object.assign(new Error('All targets must belong to the same workspace.'), { statusCode: 400, code: 'invalid_scope' });
    if (path === '/export' && workspaceIds.size === 0 && actor.id !== 'local-owner') failure('Choose an accessible workspace to export.');
    if (workspaceIds.size === 0) {
      if (method === 'GET' && (table || ['/runs', '/export'].includes(path))) return; // Response filtered below.
      if (actor.id === 'local-owner') return;
      failure('This action needs an explicit accessible workspace.');
    }
    const workspaceId = [...workspaceIds][0];
    const checkedSources = new Set();
    const checkSource = (sourceTable, sourceId) => {
      const key = `${sourceTable}:${sourceId}`;
      if (checkedSources.has(key)) return;
      if (checkedSources.size >= 150) failure('Too many nested context sources.');
      checkedSources.add(key);
      const source = row(sourceTable, sourceId);
      const sourceWorkspace = workspaceFor(source, sourceTable);
      const readPermission = sourceTable === 'messages' ? 'chats.read' : sourceTable === 'workspace_items' ? 'workspace.read' : 'documents.read';
      if (!source || sourceWorkspace !== workspaceId || !allowed(sourceWorkspace, actor, readPermission, scope(source, sourceTable))) failure('A context source is unavailable or outside your access.');
      if (sourceTable === 'workspace_items' && source.kind === 'context_pack') {
        const payload = JSON.parse(source.payload_json || '{}');
        for (const documentId of payload.document_ids || []) checkSource('documents', documentId);
        for (const memoryId of payload.memory_ids || []) checkSource('memory_notes', memoryId);
      }
    };
    if (body.source_message_id) checkSource('messages', body.source_message_id);
    if (Array.isArray(body.sources) && (parts[0] === 'workflow' && parts[1] === 'context' || parts[0] === 'chat-collaboration' && body.action === 'context')) {
      const sourceTables = { document: 'documents', memory: 'memory_notes', pack: 'workspace_items', documents: 'documents', memory_notes: 'memory_notes', knowledge_entries: 'knowledge_entries' };
      for (const source of body.sources) {
        const sourceTable = sourceTables[source?.kind || source?.type];
        if (!sourceTable) failure('Unsupported context source.');
        checkSource(sourceTable, source.id);
      }
    }
    if (collection === 'workspace-items' && parts[2] === 'action' && member(workspaceId, actor)?.rank !== 'Owner') failure('Bulk workspace rules require an Owner in this build.');
    const writing = !['GET', 'HEAD'].includes(method);
    const destructive = writing && (method === 'DELETE' || Boolean(body.archived_at) || parts[0] === 'activity' && Object.hasOwn(body, 'archived_at') || body.archived === true || collection === 'workspace-items' && parts[2] === 'action' && body.action === 'merge-label' || collection === 'agent-memories' && parts[2] === 'forget');
    let permission = `${AREA[collection] || 'workspace'}.${destructive ? 'delete' : writing ? 'write' : 'read'}`;
    if (collection === 'team-members') permission = writing ? 'members.manage' : 'members.read';
    if (collection === 'workbench') permission = writing ? 'workbench.execute' : 'workbench.read';
    if (collection === 'runs' || /\/(turns|runs)$/.test(path)) permission = writing ? 'agents.run' : 'agents.read';
    if (path === '/export') permission = 'data.export';
    if (collection === 'agent-awareness') permission = writing ? 'agents.write' : 'agents.read';
    const at = item ? scope(item, table) : scopes[0] || {};
    if (!allowed(workspaceId, actor, permission, at)) failure(`Permission required: ${permission}.`);
    if (table === 'workspace_items' && (!legacyAllowed(item, actor, permission) || body.payload && !legacyAllowed({ ...item, kind: body.kind || item?.kind, workspace_id: workspaceId, payload: body.payload }, actor, permission))) failure('An update references a project outside your access.');
    governance.authorize(workspaceId, actor.id, permission, at);
    for (const nextScope of scopes) if (!allowed(workspaceId, actor, permission, nextScope)) failure(`Permission required in the destination: ${permission}.`);
    // Archive changes use the same destructive permission as deletion.
    if (writing && body.archived_at) governance.authorize(workspaceId, actor.id, `${AREA[collection] || 'workspace'}.delete`, at);
    return { workspaceId, permission, scope: at, writing, destructive };
  }
  function filter(data, actor, options = {}) {
    if (!data || !actor) return data;
    if (data.format === 'rumbo.workspace') options = { ...options, exporting: true };
    if (Array.isArray(data)) return filter({ result: data }, actor, options).result;
    if (typeof data !== 'object') return data;
    const result = { ...data };
    if (data.bootstrap) result.bootstrap = filter(data.bootstrap, actor, options);
    if (data.data?.workspaces) result.data = filter(data.data, actor, options);
    const accessible = new Set(db.prepare("SELECT workspace_id FROM governance_members WHERE id=? AND status='active'").all(actor.id).filter(m => allowed(m.workspace_id, actor, 'workspace.read')).map(m => m.workspace_id));
    const inferTable = item => {
      if (item.entity_type) return item.entity_type;
      if (!item.id) return null;
      for (const candidate of [...new Set([...Object.values(TABLES), 'outputs', 'output_versions', 'output_comments', 'output_reviews', 'context_snapshots', 'knowledge_entries', 'work_plans', 'route_schedules'])]) if (row(candidate, item.id)) return candidate;
      return null;
    };
    const areas = { tasks: 'routes', messages: 'chats', memory_notes: 'documents', milestones: 'projects', team_members: 'members', runs: 'agents', outputs: 'documents', output_versions: 'documents', output_comments: 'documents', output_reviews: 'documents', context_snapshots: 'documents', knowledge_entries: 'documents', project_strategies: 'projects', milestone_contracts: 'projects', work_plans: 'projects', route_workflows: 'routes', route_schedules: 'routes', chat_collaboration: 'chats', activity_entries: 'workspace', audit_log: 'audit', events: 'agents', approvals: 'agents' };
    for (const [key, value] of Object.entries(result)) {
      if (!Array.isArray(value)) continue;
      result[key] = value.filter(item => {
        if (!item || typeof item !== 'object') return true;
        const ws = key === 'workspaces' ? item.id : workspaceFor(item, key);
        if (ws && !accessible.has(ws)) return false;
        const actualTable = key === 'result' ? inferTable(item) : key;
        if (item.entity_type === 'activity_entries') return (key !== 'audit_log' || allowed(ws, actor, 'audit.read', scope(item, 'change_log'))) && activity.historyVisible(item, actor, options);
        if (actualTable === 'activity_entries' || item.target_type && item.content !== undefined) return activity.visible(item, actor, options);
        if (actualTable === 'workspace_items' && !legacyAllowed(item, actor)) return false;
        if (item.entity_type === 'workspace_items') {
          const current = row('workspace_items', item.entity_id);
          if (!current || !legacyAllowed(current, actor)) return false;
          const historical = !Object.hasOwn(item, 'before') && !Object.hasOwn(item, 'before_json') ? row('change_log', item.id) || item : item;
          for (const value of [historical.before, historical.after, historical.before_json && JSON.parse(historical.before_json), historical.after_json && JSON.parse(historical.after_json)].filter(Boolean)) if (!legacyAllowed(value, actor)) return false;
        }
        const area = areas[actualTable] || AREA[actualTable];
        if (ws) return allowed(ws, actor, `${area || 'workspace'}.read`, scope(item, actualTable));
        if (!ws && ['agents', 'connections'].includes(key) && actor.id !== 'local-owner') return false;
        return true;
      }).map(item => key === 'activity_entries' ? activity.present(item, actor) : filter(item, actor, options));
    }
    if (data.profile && actor.mode === 'account') result.profile = { id: actor.id, name: actor.name, email: actor.email, avatar_url: null };
    if (actor.id !== 'local-owner' && result.settings) result.settings = {};
    return result;
  }
  return { check, filter, allowed };
}

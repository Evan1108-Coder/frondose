import { createActivityPolicy } from './activity-policy.mjs';
import { areaReferenceReadable } from './area-service.mjs';
import { skillVisible } from './skills-service.mjs';
import { agentProfileReferenceReadable } from './agent-profiles.mjs';
import { captureSourceAccess, assertSourceAccess, assertRumboSourceReferences } from './context-source-access.mjs';
import * as manualWorkflows from './manual-workflow-service.mjs';
import { routeGraph, routeScope, inspectRouteGraph, relatedRouteNodes } from './route-hierarchy.mjs';
const failure = message => { throw Object.assign(new Error(message), { statusCode: 403, code: 'access_denied' }); };
const TABLES = { workspaces: 'workspaces', projects: 'projects', tasks: 'tasks', chats: 'chats', messages: 'messages', agents: 'agents', 'memory-notes': 'memory_notes', teams: 'teams', 'team-members': 'team_members', documents: 'documents', milestones: 'milestones', runs: 'runs', 'workspace-items': 'workspace_items', 'team-resources': 'team_resources', activity: 'activity_entries', 'agent-actions': 'agent_action_requests', 'agent-memories': 'agent_memories' };
const AREA = { workspaces: 'workspace', projects: 'projects', tasks: 'routes', chats: 'chats', messages: 'chats', agents: 'agents', 'memory-notes': 'documents', teams: 'workspace', 'team-members': 'members', documents: 'documents', milestones: 'projects', runs: 'agents', 'workspace-items': 'workspace', 'team-resources': 'documents', activity: 'workspace', 'agent-actions': 'agents', 'agent-memories': 'agents' };
const WORKFLOW_TABLES = new Set(['work_plan_versions', 'work_plan_runs', 'work_plan_step_runs', 'work_plan_approvals', 'work_plan_audit']);
const WORKFLOW_COLLECTIONS = { manual_workflows: 'work_plans', manual_workflow_versions: 'work_plan_versions', manual_workflow_runs: 'work_plan_runs', manual_workflow_step_runs: 'work_plan_step_runs', manual_workflow_approvals: 'work_plan_approvals' };

export function createAccessBoundary({ db, governance }) {
  const member = (ws, actor) => db.prepare("SELECT * FROM governance_members WHERE workspace_id=? AND id=? AND status='active'").get(ws, actor.id);
  const tableExists = table => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  const row = (table, id) => id && tableExists(table) ? db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) : null;
  function parent(item, table) {
    if (!item) return null;
    if (WORKFLOW_TABLES.has(table)) {
      if (['work_plan_step_runs', 'work_plan_approvals'].includes(table) || table === 'work_plan_audit' && item.run_id) return { item: row('work_plan_runs', item.run_id), table: 'work_plan_runs' };
      return { item: row('work_plans', item.plan_id), table: 'work_plans' };
    }
    if (table === 'agent_profile_versions') return { item: row('agents', item.agent_id), table: 'agents' };
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
    if (table === 'teams' || table === 'area_settings') return { scope_type: 'team', scope_id: item.id };
    if (table === 'agents' && item.workspace_id) return { scope_type: 'agent', scope_id: item.id };
    if (item?.project_id) return { scope_type: 'project', scope_id: item.project_id };
    if (item?.team_id) return { scope_type: 'team', scope_id: item.team_id };
    const ancestor = parent(item, table); if (ancestor?.item) return scope(ancestor.item, ancestor.table, seen);
    return {};
  }
  function workspaceFor(item, table) {
    if (!item) return null;
    if (WORKFLOW_TABLES.has(table)) { const canonical = row(table, item.id); return canonical?.workspace_id || null; }
    if (table === 'workspaces') return item.id;
    if (item.workspace_id) return item.workspace_id;
    if (table === 'agent_profile_versions') return row('agents', item.agent_id)?.workspace_id;
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
  function contextSnapshotReadable(snapshot, actor) {
    try {
      if (!snapshot?.id || !snapshot.workspace_id) return false;
      const inspection = { manifest: { resolved: { workspace_id: snapshot.workspace_id }, included: [{ kind: 'context_snapshot', id: snapshot.id }], excluded: [] } };
      inspection.sourceAccess = captureSourceAccess(db, inspection);
      return assertSourceAccess(db, inspection, actor, allowed) === true;
    } catch { return false; }
  }
  function legacyAllowed(item, actor, permission = 'workspace.read') {
    if (!item || !['update', 'request'].includes(item.kind)) return true;
    const payload = item.payload || JSON.parse(item.payload_json || '{}');
    for (const id of payload.project_ids || []) { const project = row('projects', id); if (!project || project.workspace_id !== item.workspace_id || !allowed(item.workspace_id, actor, permission, { scope_type: 'project', scope_id: id })) return false; }
    if (payload.route_id) { const route = row('tasks', payload.route_id); if (!route || route.workspace_id !== item.workspace_id || !allowed(item.workspace_id, actor, permission, scope(route, 'tasks'))) return false; }
    return true;
  }
  function check({ actor, path, method, url, body = {} }) {
    if (!actor) failure('Sign in to continue.');
    if (path.startsWith('/governance') || path.startsWith('/connection-platform') || path.startsWith('/identity') || path.startsWith('/sub-routes/') || path === '/change-reviews' || path.startsWith('/change-reviews/')) return; // These services authenticate every target and source themselves.
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
    // Manual workflows authorize canonical parents, definitions and every source
    // in their dedicated service. Do not interpret run/approval IDs as plan IDs.
    if (collection === 'coordination' && ['workflows', 'workflow-runs', 'workflow-approvals'].includes(parts[1])) return;
    if (collection === 'workflow') {
      const mapping = { routes: 'tasks', projects: 'projects', milestones: 'milestones', outputs: 'outputs', comments: 'output_comments', context: 'context_snapshots', knowledge: 'knowledge_entries' };
      table = mapping[parts[1]]; item = table ? row(table, parts[2]) : null; collection = parts[1] === 'routes' ? 'tasks' : ['projects', 'milestones'].includes(parts[1]) ? 'projects' : 'documents';
    }
    if (table === 'context_snapshots' && item && !contextSnapshotReadable(item, actor)) failure('A saved context source is unavailable or outside your access.');
    if (collection === 'chat-collaboration') { table = 'chats'; item = row(table, parts[1]); collection = 'chats'; }
    if (collection === 'route-tools') { table = parts[1] === 'schedules' ? 'route_schedules' : 'tasks'; item = row(table, parts[1] === 'schedules' ? parts[2] : parts[1]); collection = 'tasks'; }
    if (collection === 'coordination') { table = 'work_plans'; item = row(table, parts[2]); collection = 'projects'; }
    if (collection === 'history') { const change = db.prepare('SELECT * FROM change_log WHERE entity_id=? LIMIT 1').get(parts[1]); table = change?.entity_type; item = change ? row(table, change.entity_id) || change : row('activity_entries', parts[1]); collection = table === 'activity_entries' || item?.target_type ? 'activity' : table === 'route_workflows' || table === 'tasks' ? 'tasks' : table === 'workspace_items' ? 'workspace-items' : 'documents'; }
    if (collection === 'activity') {
      if (item?.target_type && !activity.visible(item, actor)) failure('This update is unavailable.');
      const targetType = item?.target_type || body.target_type || url.searchParams.get('target_type');
      const targetId = item?.target_id || body.target_id || url.searchParams.get('target_id');
      const targetTable = { project: 'projects', route: 'tasks', request: 'workspace_items', document: 'documents', output: 'outputs', milestone: 'milestones', chat: 'chats' }[targetType];
      const target = targetTable ? row(targetTable, targetId) : null;
      if (target) { item = target; table = targetTable; }
      collection = { project: 'projects', route: 'tasks', request: 'workspace-items', document: 'documents', output: 'documents', milestone: 'projects', chat: 'chats' }[targetType] || 'activity';
    }
    assertRumboSourceReferences(db, item, table, actor, allowed);
    const workspaceIds = new Set([workspaceFor(item, table), body.workspace_id, url.searchParams.get('workspace_id')].filter(Boolean));
    const scopes = [];
    for (const [key, refTable] of [['project_id', 'projects'], ['team_id', 'teams'], ['task_id', 'tasks'], ['chat_id', 'chats'], ['agent_id', 'agents'], ['run_id', 'runs']]) {
      const refId = body[key] || url.searchParams.get(key);
      const ref = row(refTable, refId);
      if (ref) assertRumboSourceReferences(db, ref, refTable, actor, allowed);
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
    const redactAgentProfile = (item, workspaceId = item?.workspace_id) => {
      if (!item) return item;
      const next = { ...item };
      const readable = (table, id) => agentProfileReferenceReadable(db, workspaceId, table, id, { actor, allowed, allowArchived: true });
      for (const [field, table] of [['default_area_id', 'teams'], ['default_project_id', 'projects']]) if (item[field] && !readable(table, item[field])) next[field] = null;
      for (const field of ['context_source_ids', 'context_source_ids_json']) {
        if (!Object.hasOwn(item, field)) continue;
        let values = item[field];
        try { if (typeof values === 'string') values = JSON.parse(values); } catch { values = []; }
        const visible = Array.isArray(values) ? values.filter(id => readable('workspace_items', id)) : [];
        next[field] = typeof item[field] === 'string' ? JSON.stringify(visible) : visible;
      }
      return next;
    };
    if (data.agent) result.agent = filter({ agents: [data.agent] }, actor, options).agents[0] || null;
    const redactAreaSettings = item => {
      if (!item) return item;
      const next = { ...item };
      for (const [field, table] of [['default_agent_ids', 'agents'], ['context_pack_ids', 'workspace_items']]) {
        if (Array.isArray(item[field])) next[field] = item[field].filter(id => areaReferenceReadable(db, item.workspace_id, table, id, allowed, actor));
        if (typeof item[`${field}_json`] === 'string') next[`${field}_json`] = JSON.stringify(JSON.parse(item[`${field}_json`]).filter(id => areaReferenceReadable(db, item.workspace_id, table, id, allowed, actor)));
      }
      return next;
    };
    if (data.result?.default_agent_ids && data.result?.context_pack_ids && data.result?.permission_policy) {
      const filtered = filter({ area_settings: [data.result] }, actor, options).area_settings;
      result.result = filtered[0] || null;
    }
    if (data.bootstrap) result.bootstrap = filter(data.bootstrap, actor, options);
    if (data.data?.workspaces) result.data = filter(data.data, actor, options);
    const accessible = new Set(db.prepare("SELECT workspace_id FROM governance_members WHERE id=? AND status='active'").all(actor.id).filter(m => allowed(m.workspace_id, actor, 'workspace.read')).map(m => m.workspace_id));
    const inferTable = item => {
      if (item.entity_type) return item.entity_type;
      if (!item.id) return null;
      for (const candidate of [...new Set([...Object.values(TABLES), 'outputs', 'output_versions', 'output_comments', 'output_reviews', 'context_snapshots', 'knowledge_entries', 'work_plans', ...WORKFLOW_TABLES, 'route_schedules'])]) if (row(candidate, item.id)) return candidate;
      return null;
    };
    const collectionTable = (key, item) => WORKFLOW_COLLECTIONS[key] || (key === 'result' ? inferTable(item) : key === 'steps' && row('work_plan_step_runs', item?.id) ? 'work_plan_step_runs' : key === 'approvals' && row('work_plan_approvals', item?.id) ? 'work_plan_approvals' : key);
    if (data.result && !Array.isArray(data.result) && inferTable(data.result) === 'context_snapshots') {
      const canonical = row('context_snapshots', data.result.id);
      result.result = contextSnapshotReadable(canonical, actor) ? data.result : null;
    }
    const publicWorkflowAttempt = item => { const next = { ...item }; for (const field of ['preparation_token_hash', 'context_request', 'context_request_json', 'context_request_hash', 'prepared_source_access', 'prepared_source_access_json']) delete next[field]; return next; };
    const areas = { tasks: 'routes', messages: 'chats', memory_notes: 'documents', milestones: 'projects', team_members: 'members', runs: 'agents', outputs: 'documents', output_versions: 'documents', output_comments: 'documents', output_reviews: 'documents', context_snapshots: 'documents', knowledge_entries: 'documents', project_strategies: 'projects', milestone_contracts: 'projects', work_plans: 'projects', route_workflows: 'routes', route_schedules: 'routes', chat_collaboration: 'chats', activity_entries: 'workspace', audit_log: 'audit', events: 'agents', approvals: 'agents' };
    for (const [key, value] of Object.entries(result)) {
      if (!Array.isArray(value)) continue;
      result[key] = value.filter(item => {
        if (!item || typeof item !== 'object') return true;
        const actualTable = collectionTable(key, item);
        try { assertRumboSourceReferences(db, item, actualTable, actor, allowed); } catch { return false; }
        const ws = key === 'workspaces' ? item.id : workspaceFor(item, actualTable);
        if (ws && !accessible.has(ws)) return false;
        if (actualTable === 'context_snapshots' || item.entity_type === 'context_snapshots') {
          const canonical = row('context_snapshots', item.entity_id || item.id);
          if (!contextSnapshotReadable(canonical, actor)) return false;
          // Snapshot content is immutable, but historical container scopes must
          // still be checked before exposing recorded metadata through history.
          try {
            const historic = item.entity_type && !Object.hasOwn(item, 'before') && !Object.hasOwn(item, 'before_json') ? row('change_log', item.id) || item : item;
            for (const state of [historic.before, historic.after, historic.before_json && JSON.parse(historic.before_json), historic.after_json && JSON.parse(historic.after_json)].filter(Boolean)) {
              if (state.workspace_id && state.workspace_id !== canonical.workspace_id || !allowed(canonical.workspace_id, actor, 'documents.read', scope(state, 'context_snapshots'))) return false;
            }
          } catch { return false; }
        }
        if (actualTable === 'work_plan_requests' || item.entity_type === 'work_plan_requests') return false; // Internal idempotency payloads are never shared.
        const workflowTable = item.entity_type || actualTable;
        const canonicalWorkflow = workflowTable === 'work_plans' || WORKFLOW_TABLES.has(workflowTable) ? row(workflowTable, item.entity_id || item.id) : null;
        if (workflowTable === 'work_plans' && !canonicalWorkflow) return false;
        if (WORKFLOW_TABLES.has(workflowTable) || workflowTable === 'work_plans' && (canonicalWorkflow?.kind === 'manual_workflow' || item.kind === 'manual_workflow')) {
          if (!canonicalWorkflow || typeof manualWorkflows.manualWorkflowVisible !== 'function' || !manualWorkflows.manualWorkflowVisible(db, canonicalWorkflow, workflowTable, actor, allowed)) return false;
          if (item.entity_type) {
            const historic = Object.hasOwn(item, 'before') || Object.hasOwn(item, 'before_json') ? item : row('change_log', item.id) || item;
            try {
              for (const state of [historic.before, historic.after, historic.before_json && JSON.parse(historic.before_json), historic.after_json && JSON.parse(historic.after_json)].filter(Boolean)) {
                if (state.workspace_id && state.workspace_id !== canonicalWorkflow.workspace_id) return false;
                if (state.project_id && !allowed(canonicalWorkflow.workspace_id, actor, 'projects.read', { scope_type: 'project', scope_id: state.project_id })) return false;
                if (state.task_id) { const task = row('tasks', state.task_id); if (!task || task.workspace_id !== canonicalWorkflow.workspace_id || !allowed(task.workspace_id, actor, 'routes.read', routeScope(task))) return false; }
              }
            } catch { return false; }
          }
          if (key === 'audit_log' || workflowTable === 'work_plan_audit') return allowed(canonicalWorkflow.workspace_id, actor, 'audit.read', scope(canonicalWorkflow, workflowTable));
          return true;
        }
        if (actualTable === 'agent_profile_versions') {
          const agent = row('agents', item.agent_id);
          return Boolean(agent && (agent.workspace_id ? allowed(agent.workspace_id, actor, 'agents.read', scope(agent, 'agents')) : actor.id === 'local-owner'));
        }
        if (item.entity_type === 'agents') {
          const current = row('agents', item.entity_id);
          if (!current || (current.workspace_id ? !allowed(current.workspace_id, actor, 'agents.read', scope(current, 'agents')) : actor.id !== 'local-owner')) return false;
          if (key === 'audit_log' && current.workspace_id && !allowed(current.workspace_id, actor, 'audit.read', scope(current, 'agents'))) return false;
          return true;
        }
        if (!item.entity_type && ['skills', 'skill_versions', 'skill_test_runs'].includes(actualTable)) return skillVisible(db, item, actualTable, actor, allowed);
        if (item.entity_type === 'skills') {
          const current = row('skills', item.entity_id);
          if (!current || !skillVisible(db, current, 'skills', actor, allowed)) return false;
          if (key === 'audit_log' && !allowed(ws, actor, 'audit.read', scope(current, 'skills'))) return false;
        }
        if (item.entity_type === 'area_settings') {
          const current = row('teams', item.entity_id);
          // Deleted parents never become workspace-visible history.
          if (!current || current.workspace_id !== ws || !allowed(ws, actor, 'workspace.read', { scope_type: 'team', scope_id: current.id })) return false;
          if (key === 'audit_log' && !allowed(ws, actor, 'audit.read', { scope_type: 'team', scope_id: current.id })) return false;
          const historic = Object.hasOwn(item, 'before') || Object.hasOwn(item, 'before_json') ? item : row('change_log', item.id) || item;
          for (const state of [historic.before, historic.after, historic.before_json && JSON.parse(historic.before_json), historic.after_json && JSON.parse(historic.after_json)].filter(Boolean)) if (state.id !== current.id || state.workspace_id !== current.workspace_id) return false;
          return true;
        }
        if (item.entity_type === 'activity_entries') return (key !== 'audit_log' || allowed(ws, actor, 'audit.read', scope(item, 'change_log'))) && activity.historyVisible(item, actor, options);
        if (item.entity_type === 'tasks') {
          const current = row('tasks', item.entity_id);
          if (!current || !allowed(current.workspace_id, actor, 'routes.read', routeScope(current))) return false;
          const historic = Object.hasOwn(item, 'before') || Object.hasOwn(item, 'before_json') ? item : row('change_log', item.id) || item;
          for (const state of [historic.before, historic.after, historic.before_json && JSON.parse(historic.before_json), historic.after_json && JSON.parse(historic.after_json)].filter(Boolean)) if (!allowed(state.workspace_id || current.workspace_id, actor, 'routes.read', routeScope(state))) return false;
        }
        if (item.entity_type === 'route_workflows') {
          const current = row('tasks', item.entity_id);
          if (!current || !allowed(current.workspace_id, actor, 'routes.read', routeScope(current))) return false;
          const historic = Object.hasOwn(item, 'before') || Object.hasOwn(item, 'before_json') ? item : row('change_log', item.id) || item;
          for (const state of [historic.before, historic.after, historic.before_json && JSON.parse(historic.before_json), historic.after_json && JSON.parse(historic.after_json)].filter(Boolean)) {
            const ids = [state.parent_task_id, ...(state.dependency_ids || JSON.parse(state.dependency_ids_json || '[]'))].filter(Boolean);
            if (ids.some(id => { const task = row('tasks', id); return !task || !allowed(task.workspace_id, actor, 'routes.read', routeScope(task)); })) return false;
          }
        }
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
      }).map(item => {
        const canonicalTable = collectionTable(key, item);
        if (canonicalTable === 'work_plan_step_runs') {
          return filter(publicWorkflowAttempt(item), actor, options);
        }
        if (item.entity_type === 'work_plan_step_runs') {
          const next = { ...item };
          for (const field of ['before', 'after']) {
            if (item[field]) next[field] = publicWorkflowAttempt(item[field]);
            if (typeof item[`${field}_json`] === 'string') next[`${field}_json`] = JSON.stringify(publicWorkflowAttempt(JSON.parse(item[`${field}_json`])));
          }
          return next;
        }
        if (key === 'agents' || key === 'result' && inferTable(item) === 'agents') return redactAgentProfile(item);
        if (key === 'agent_profile_versions') {
          const agent = row('agents', item.agent_id), next = { ...item };
          for (const field of ['snapshot', 'snapshot_json']) if (item[field]) {
            const original = typeof item[field] === 'string' ? JSON.parse(item[field]) : item[field];
            const redacted = redactAgentProfile(original, agent.workspace_id);
            next[field] = typeof item[field] === 'string' ? JSON.stringify(redacted) : redacted;
            if (JSON.stringify(redacted) !== JSON.stringify(original)) { next.snapshot_redacted = true; delete next.snapshot_hash; }
          }
          return next;
        }
        if (item.entity_type === 'agents') {
          const current = row('agents', item.entity_id), next = { ...item };
          for (const field of ['before', 'after']) {
            if (item[field]) next[field] = redactAgentProfile(item[field], current.workspace_id);
            if (typeof item[`${field}_json`] === 'string') next[`${field}_json`] = JSON.stringify(redactAgentProfile(JSON.parse(item[`${field}_json`]), current.workspace_id));
          }
          return next;
        }
        if (item.entity_type === 'area_settings') {
          const next = { ...item };
          for (const field of ['before', 'after']) {
            if (item[field]) next[field] = redactAreaSettings(item[field]);
            if (typeof item[`${field}_json`] === 'string') next[`${field}_json`] = JSON.stringify(redactAreaSettings(JSON.parse(item[`${field}_json`])));
          }
          return next;
        }
        if (key === 'area_settings') {
          return redactAreaSettings(item);
        }
        return key === 'activity_entries' ? activity.present(item, actor) : filter(item, actor, options);
      });
    }
    if (data.profile && actor.mode === 'account') result.profile = { id: actor.id, name: actor.name, email: actor.email, avatar_url: null };
    if (Array.isArray(result.route_workflows)) {
      const graphs = new Map(), contexts = new Map();
      const graphFor = ws => { if (!graphs.has(ws)) graphs.set(ws, routeGraph(db, ws)); return graphs.get(ws); };
      const visibleTask = task => Boolean(task && allowed(task.workspace_id, actor, 'routes.read', routeScope(task)));
      // Parents can have children without their own workflow record. Emit a
      // read-only default so rollups can distinguish unknown from complete.
      const existing = new Set(result.route_workflows.map(item => item.id));
      for (const task of result.tasks || []) if (!existing.has(task.id) && [...graphFor(task.workspace_id).values()].some(item => item.parent_task_id === task.id)) result.route_workflows.push({ id: task.id, workspace_id: task.workspace_id, parent_task_id: null, owner_name: '', reviewer_name: '', output_type: 'document', acceptance: [], dependency_ids: [], version: 0, updated_at: task.updated_at, sibling_position: 0, synthetic: true });
      result.route_workflows = result.route_workflows.map(item => {
        const graph = graphFor(item.workspace_id), task = graph.get(item.id); let context = contexts.get(item.id);
        if (!context) {
          let nodes = task ? [task] : [], invalid = false;
          try { if (task) nodes = inspectRouteGraph(graph, task); } catch { invalid = true; try { nodes = relatedRouteNodes(graph, task); } catch { nodes = [...graph.values()]; } }
          context = { nodes, invalid }; for (const node of nodes) contexts.set(node.id, context);
        }
        const { nodes, invalid } = context;
        const directParent = item.parent_task_id ? row('tasks', item.parent_task_id) : null;
        const refs = [...nodes, ...(directParent ? [directParent] : []), ...nodes.flatMap(node => node.dependency_ids.map(id => row('tasks', id)))];
        const restricted = refs.some(node => !visibleTask(node));
        return { ...item, parent_task_id: directParent && visibleTask(directParent) ? item.parent_task_id : null, dependency_ids: (item.dependency_ids || []).filter(id => visibleTask(row('tasks', id))), hierarchy_restricted: restricted, hierarchy_invalid: invalid };
      });
    }
    if (actor.id !== 'local-owner' && result.settings) result.settings = {};
    return result;
  }
  return { check, filter, allowed };
}

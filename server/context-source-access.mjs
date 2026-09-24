export const CONTEXT_SOURCE_KINDS = Object.freeze({ workspace: 'workspaces', area: 'teams', area_instructions: 'area_settings', agent: 'agents', project: 'projects', route: 'tasks', context_pack: 'workspace_items', pack: 'workspace_items', document: 'documents', documents: 'documents', memory: 'memory_notes', memory_notes: 'memory_notes', agent_memories: 'agent_memories', knowledge: 'knowledge_entries', knowledge_entries: 'knowledge_entries', message: 'messages', output: 'outputs', output_version: 'output_versions', context_snapshot: 'context_snapshots', skill: 'skills', skill_version: 'skill_versions', run: 'runs' });
const KINDS = CONTEXT_SOURCE_KINDS;
const PERMISSIONS = { workspaces: 'workspace.read', teams: 'workspace.read', area_settings: 'workspace.read', agents: 'agents.read', projects: 'projects.read', tasks: 'routes.read', chats: 'chats.read', messages: 'chats.read', workspace_items: 'workspace.read', documents: 'documents.read', memory_notes: 'documents.read', agent_memories: 'agents.read', knowledge_entries: 'documents.read', outputs: 'documents.read', output_versions: 'documents.read', context_snapshots: 'documents.read', skills: 'agents.read', skill_versions: 'agents.read', runs: 'agents.read' };
const TABLES = new Set([...Object.keys(PERMISSIONS), 'route_workflows', 'platform_connections', 'platform_external_objects']);
const deny = () => { throw Object.assign(new Error('Some captured context is no longer available to you.'), { code: 'context_access_revoked', errorCode: 'context_access_revoked', statusCode: 403 }); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\u0000-\u001f]/.test(value);
function parse(value) { try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return record(parsed) ? parsed : null; } catch { return null; } }
function list(value) { if (!Array.isArray(value) || value.length > 1000 || value.some(item => !id(item))) deny(); return [...new Set(value)]; }
function referencesList(value) { try { const refs = typeof value === 'string' ? JSON.parse(value) : value; if (!Array.isArray(refs) || refs.length > 100 || refs.some(ref => !record(ref) || !id(ref.id))) deny(); return refs; } catch { deny(); } }

function reader(db) {
  const existing = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  const rows = new Map();
  const read = (table, key) => {
    const cacheKey = `${table}:${key}`; if (rows.has(cacheKey)) return rows.get(cacheKey);
    if (rows.size >= 5000) deny();
    const value = table === 'current_skill_version' && existing.has('skill_versions') && existing.has('skills') && id(key)
      ? db.prepare('SELECT v.* FROM skill_versions v JOIN skills s ON s.id=v.skill_id AND s.version=v.number WHERE s.id=?').get(key)
      : TABLES.has(table) && existing.has(table) && id(key) ? db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(key) : null;
    rows.set(cacheKey, value); return value;
  };
  read.references = new Map();
  return read;
}
function rowScope(table, row) {
  if (table === 'workspaces') return {};
  if (table === 'teams' || table === 'area_settings') return { scope_type: 'team', scope_id: row.id };
  if (table === 'projects') return { scope_type: 'project', scope_id: row.id };
  if (table === 'agents' && row.workspace_id) return { scope_type: 'agent', scope_id: row.id };
  if (row.project_id) return { scope_type: 'project', scope_id: row.project_id };
  if (row.team_id) return { scope_type: 'team', scope_id: row.team_id };
  return {};
}

// Keep identity and authorization provenance only, never copied source content.
// Ancestors preserve historical scopes even when a source later moves elsewhere.
function references(read, table, key, workspaceId, path = new Set(), inspectDefinition = true) {
  if (!PERMISSIONS[table] || path.size >= 64 || path.has(`${table}:${key}`)) deny();
  const cacheKey = `${table}:${key}:${workspaceId}:${inspectDefinition}`;
  if (read.references.has(cacheKey)) return read.references.get(cacheKey);
  const row = read(table, key);
  if (!row || row.archived_at) deny();
  const nextPath = new Set(path).add(`${table}:${key}`), parents = [], dependencies = [];
  const addParent = (target, parentId, definition = true) => { if (parentId) parents.push(...references(read, target, parentId, workspaceId, nextPath, definition)); };
  const addDependency = (target, sourceId) => { if (!sourceId) deny(); dependencies.push(...references(read, target, sourceId, workspaceId, nextPath)); };
  if (table === 'area_settings') addParent('teams', row.id);
  else if (table === 'messages') {
    if (!row.chat_id) deny();
    addParent('chats', row.chat_id);
  } else {
    if (row.project_id) addParent('projects', row.project_id);
    if (row.team_id) addParent('teams', row.team_id);
    if (table === 'chats' && row.task_id) addParent('tasks', row.task_id);
    if (table === 'output_versions') { if (!row.output_id) deny(); addParent('outputs', row.output_id); }
    if (table === 'outputs') {
      addParent('tasks', row.task_id); addParent('runs', row.run_id); addParent('chats', row.chat_id); addParent('messages', row.source_message_id);
    }
    if (table === 'runs') { addParent('tasks', row.task_id); addParent('chats', row.chat_id); addParent('agents', row.agent_id); }
    if (table === 'skill_versions') { if (!row.skill_id) deny(); addParent('skills', row.skill_id, false); }
    if (table === 'agent_memories') {
      if (!row.agent_id) deny();
      addParent('agents', row.agent_id);
    }
    if (table === 'tasks') {
      const workflow = read('route_workflows', key);
      if (workflow?.parent_task_id) addParent('tasks', workflow.parent_task_id);
    }
  }
  const shared = table === 'agents' && row.workspace_id == null;
  const scopeWorkspace = table === 'workspaces' ? row.id : table === 'messages' ? parents[0]?.workspace_id : shared ? workspaceId : row.workspace_id;
  if (scopeWorkspace !== workspaceId) deny();
  if (table === 'workspace_items' && row.kind !== 'context_pack') deny();
  if (table === 'workspace_items') {
    const payload = parse(row.payload_json); if (!payload) deny();
    for (const sourceId of list(payload.document_ids || [])) addDependency('documents', sourceId);
    for (const sourceId of list(payload.memory_ids || [])) addDependency('memory_notes', sourceId);
  }
  if (table === 'context_snapshots') {
    const sourceTables = { documents: 'documents', memory_notes: 'memory_notes', knowledge_entries: 'knowledge_entries', workspace_items: 'workspace_items', ...KINDS };
    for (const ref of referencesList(row.sources_json)) { const target = sourceTables[ref.type || ref.kind]; if (!target) deny(); addDependency(target, ref.id); }
  }
  if (table === 'skill_versions' || table === 'skills' && inspectDefinition) {
    const version = table === 'skills' ? read('current_skill_version', row.id) : row, definition = parse(version?.definition_json); if (!definition) deny();
    for (const ref of referencesList(definition.required_context || [])) {
      const target = { document: 'documents', memory: 'memory_notes', knowledge: 'knowledge_entries', pack: 'workspace_items' }[ref.kind]; if (!target) deny(); addDependency(target, ref.id);
    }
    if (definition.preferred_agent_id) addDependency('agents', definition.preferred_agent_id);
  }
  let inherited = rowScope(table, row);
  if (!inherited.scope_type && !['workspaces', 'agents'].includes(table)) inherited = parents.find(parent => parent.scope.scope_type)?.scope || {};
  const permission = PERMISSIONS[table];
  // Checking an old project ID alone is insufficient: governance resolves that
  // project's *current* Area. Pin the source permission at its historical Area
  // as well, without applying document/chat permissions to agent scopes.
  const guards = parents.filter(parent => ['project', 'team'].includes(parent.scope.scope_type)).map(parent => ({ ...parent, permission, permission_table: table }));
  const refs = [{ table, id: row.id, workspace_id: workspaceId, shared, permission, scope: inherited }, ...parents, ...guards, ...dependencies];
  const result = [...new Map(refs.map(ref => [`${ref.table}:${ref.id}:${ref.permission}:${ref.scope.scope_type || ''}:${ref.scope.scope_id || ''}`, ref])).values()];
  read.references.set(cacheKey, result);
  return result;
}

function connectionScope(row) {
  if (!['workspace', 'team'].includes(row.scope_type)) deny();
  if (row.scope_type === 'workspace' && row.scope_id && row.scope_id !== row.workspace_id) deny();
  if (row.scope_type === 'team' && !id(row.scope_id)) deny();
  return { scope_type: row.scope_type, scope_id: row.scope_id || row.workspace_id };
}

/** Called immediately after the synchronous inspector compilation. Internal-only
 * provenance: expose the manifest/prompt, not this authorization snapshot. */
export function captureSourceAccess(db, inspection) {
  const workspaceId = inspection?.manifest?.resolved?.workspace_id;
  if (!id(workspaceId)) deny();
  const read = reader(db), sources = new Map(), connections = [];
  const remember = (table, key) => {
    for (const ref of references(read, table, key, workspaceId)) sources.set(`${ref.table}:${ref.id}:${ref.permission}`, ref);
  };
  remember('workspaces', workspaceId);
  const resolved = inspection.manifest.resolved;
  for (const [field, table] of [['chat_id', 'chats'], ['project_id', 'projects'], ['task_id', 'tasks'], ['area_id', 'teams'], ['agent_id', 'agents']]) if (resolved[field]) remember(table, resolved[field]);
  const visible = [...(inspection.manifest.included || []), ...(inspection.manifest.excluded || []).filter(source => Object.hasOwn(source, 'label'))];
  for (const source of visible) {
    if (!record(source)) deny();
    if (KINDS[source.kind]) remember(KINDS[source.kind], source.id);
    if (source.kind === 'attachment') {
      const owner = typeof source.id === 'string' ? source.id.slice(0, source.id.lastIndexOf(':')) : '';
      if (!owner) deny();
      if (owner !== 'current') remember('messages', owner);
    }
    if (source.kind !== 'connection') continue;
    const row = read('platform_connections', source.id);
    if (!row || row.workspace_id !== workspaceId) deny();
    const scope = connectionScope(row);
    if (scope.scope_type === 'team') remember('teams', scope.scope_id);
    const content = parse(source.content);
    if (source.status === 'excluded' || source.status === 'truncated' || !content || !Array.isArray(content.cached_objects) || !Array.isArray(content.actions)) {
      connections.push({ id: row.id, workspace_id: workspaceId, scope, provider: row.provider, unverifiable: true });
      continue;
    }
    const selected = list(content.selected_resources), actions = list(content.actions.map(action => action?.id));
    const objects = content.cached_objects.map(object => {
      const cached = read('platform_external_objects', object?.id);
      if (!cached || cached.connection_id !== row.id || !selected.includes(cached.resource_id)) deny();
      return { id: cached.id, resource_id: cached.resource_id, external_id: cached.external_id, kind: cached.kind };
    });
    connections.push({ id: row.id, workspace_id: workspaceId, scope, provider: row.provider, selected_resources: selected, actions, objects, requires_read: objects.length > 0 });
  }
  return { version: 1, workspace_id: workspaceId, sources: [...sources.values()], connections };
}

/** Rechecks BOTH captured historical scopes and current source ancestry. Safe
 * text revisions do not revoke readable history, but moves never erase its ACL.
 * The caller separately authorizes the run and freshly recompiles its context. */
export function assertSourceAccess(db, inspection, actor, allowed) {
  const saved = inspection?.sourceAccess, workspaceId = inspection?.manifest?.resolved?.workspace_id;
  if (!actor?.id || typeof allowed !== 'function' || !record(saved) || saved.version !== 1 || saved.workspace_id !== workspaceId || !Array.isArray(saved.sources) || !Array.isArray(saved.connections)) deny();
  const read = reader(db);
  const permit = (permission, scope) => {
    try { if (allowed(workspaceId, actor, permission, scope) === true) return; } catch { /* Deny unavailable or malformed scope. */ }
    deny();
  };
  const checkRef = ref => {
    if (!record(ref) || ref.workspace_id !== workspaceId || !PERMISSIONS[ref.table] || ref.permission !== PERMISSIONS[ref.permission_table || ref.table] || !record(ref.scope)) deny();
    if (ref.shared && actor.id !== 'local-owner') deny();
    permit(ref.permission, ref.scope);
  };
  for (const ref of saved.sources) {
    checkRef(ref);
    for (const current of references(read, ref.table, ref.id, workspaceId)) checkRef(current);
  }
  for (const savedConnection of saved.connections) {
    if (!record(savedConnection) || savedConnection.unverifiable || savedConnection.workspace_id !== workspaceId) deny();
    const current = read('platform_connections', savedConnection.id), settings = parse(current?.settings);
    if (!current || current.workspace_id !== workspaceId || current.provider !== savedConnection.provider || current.state !== 'connected' || !settings) deny();
    const currentScope = connectionScope(current);
    if (currentScope.scope_type === 'team') for (const ref of references(read, 'teams', currentScope.scope_id, workspaceId)) checkRef(ref);
    for (const scope of [savedConnection.scope, currentScope]) {
      permit('connections.read', scope);
      for (const action of list(savedConnection.actions)) permit(`connections.${current.provider}.${action}`, scope);
    }
    const selected = list(settings.selected_resources), features = list(settings.enabled_features);
    if (list(savedConnection.selected_resources).some(resource => !selected.includes(resource)) || list(savedConnection.actions).some(action => !features.includes(action)) || savedConnection.requires_read && !features.includes('read')) deny();
    if (settings.agent_access !== true || !list(settings.allowed_agent_ids).includes(inspection.manifest.resolved.agent_id)) deny();
    if (!Array.isArray(savedConnection.objects)) deny();
    for (const savedObject of savedConnection.objects) {
      const object = read('platform_external_objects', savedObject?.id);
      if (!object || object.connection_id !== current.id || object.resource_id !== savedObject.resource_id || object.external_id !== savedObject.external_id || object.kind !== savedObject.kind || !selected.includes(object.resource_id)) deny();
    }
  }
  return true;
}

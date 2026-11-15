const deny = (message, code = 'native_agent_binding_required', statusCode = 409) => {
  throw Object.assign(new Error(message), { code, errorCode: code, statusCode });
};
const stableId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);

/** Synchronous recheck used at preview, intent reservation and immediately before
 * native spawn. Reading a profile, restoring a tab or selecting a folder is not
 * permission to use a different provider account. Never runs provider probes. */
export function authorizeNativeAgentBinding({ db, local, workspaceId, projectId, agentId, providerId, actor, allowed, providerState, assertAssistantBinding } = {}) {
  if (!local || actor?.id !== 'local-owner') deny('Personalized native sessions are available only to this local installation’s owner.', 'access_denied', 403);
  if (![workspaceId, projectId, agentId].every(stableId) || !['codex', 'claude'].includes(providerId)) deny('Choose an active local Codex or Claude agent and project.', 'native_agent_invalid', 400);
  if (typeof allowed !== 'function' || typeof providerState !== 'function') deny('Native agent authorization is unavailable.', 'access_denied', 403);
  const workspace = db.prepare('SELECT * FROM workspaces WHERE id=? AND archived_at IS NULL').get(workspaceId);
  const project = db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(projectId, workspaceId);
  const agent = db.prepare('SELECT * FROM agents WHERE id=? AND archived_at IS NULL').get(agentId);
  if (!workspace || !project || !agent || agent.workspace_id && agent.workspace_id !== workspaceId || agent.status !== 'available' || agent.provider !== providerId) deny('This agent or project is unavailable in this workspace.', 'native_agent_unavailable', 403);
  if (agent.permission_policy === 'read-only') deny('This profile is read-only. Native CLI task sessions require separately reviewed editing-capable behavior; no broader tools were granted.', 'native_agent_read_only');
  if (project.team_id) {
    const area = db.prepare('SELECT * FROM teams WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(project.team_id, workspaceId);
    if (!area) deny('Restore the project’s Area before starting work.', 'native_agent_unavailable', 403);
  }
  const projectScope = { scope_type: 'project', scope_id: projectId };
  // Legacy installation profiles have no workspace parent; only local-owner
  // reaches this path, and every invocation still requires workspace permission.
  const agentScope = agent.workspace_id ? { scope_type: 'agent', scope_id: agentId } : {};
  for (const [permission, scope] of [['workbench.execute', projectScope], ['projects.read', projectScope], ['agents.read', agentScope], ['agents.run', agentScope], ['agents.use', agentScope]]) {
    if (!allowed(workspaceId, actor, permission, scope)) deny(`Permission required: ${permission}.`, 'access_denied', 403);
  }
  assertAssistantBinding?.(agent);
  const settings = db.prepare('SELECT * FROM agent_runner_settings WHERE workspace_id=? AND agent_id=?').get(workspaceId, agentId);
  if (settings) {
    if (settings.enabled !== 1 || settings.connection_method === 'unselected') deny('This agent’s connection is disabled or unselected; no old account will be used.', 'agent_connection_disabled');
    // API/OAuth preparation and paired computers are separate transports. Never
    // silently substitute the installation's CLI for any prepared binding.
    deny('This agent has an API, authorization or paired-computer binding. Explicitly return it to its local CLI connection before launching a native session.', 'native_agent_transport_mismatch');
  }
  if (agent.provider_connection_id !== `conn_${providerId}`) deny('Choose this agent’s local provider connection before starting a native session.', 'profile_unbound');
  const connection = db.prepare('SELECT * FROM connections WHERE id=? AND provider=?').get(agent.provider_connection_id, providerId);
  if (!connection || connection.mode !== 'local' || connection.state !== 'connected') deny('The selected local provider connection is unavailable.', 'not_connected');
  const current = providerState(providerId, workspaceId, actor);
  if (current?.state !== 'connected' || current.method !== 'existing') deny('Activate and check this provider’s existing CLI sign-in in this workspace first.', 'not_connected');
  const revision = db.prepare('SELECT MAX(version) AS version FROM agent_runner_settings_audit WHERE workspace_id=? AND agent_id=?').get(workspaceId, agentId)?.version || 0;
  const native_binding_revision = JSON.stringify({ workspace_id: workspaceId, project_id: projectId, provider: providerId, connection_id: connection.id, mode: connection.mode,
    state: current.state, method: current.method, transport: current.transport || null, checked_at: current.checkedAt || null,
    connection_updated_at: connection.updated_at || null, preparation_revision: revision, native_context: 'owner-selected-local-cli' });
  if (native_binding_revision.length > 2000) deny('The local provider binding is invalid.', 'native_agent_binding_invalid');
  return { id: agent.id, workspace_id: agent.workspace_id, name: agent.name, provider: agent.provider, version: agent.version,
    instructions: agent.instructions || '', status: agent.status, archived_at: agent.archived_at, native_binding_revision };
}

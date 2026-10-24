import { EXECUTION_PROVIDERS, aiProviderName } from './ai-providers.js';
import { apiProviderDefinition } from './ai-provider-catalog.js';
import { getRunnerProvider } from './runner-provider-catalog.js';
import { agentConnectionMethods } from './agent-connection-methods.js';
import { AGENT_PROVIDERS, agentReadiness } from './agents.js';
import { val } from './model.js';

export const FEATURED_AGENT_CONNECTIONS = Object.freeze([
  { id: 'codex', headline: 'From a question to a reviewed change.', image: '/agent-connections/codex-feature.png' },
  { id: 'claude', headline: 'Get to know your code, together.', image: '/agent-connections/claude-feature.png' },
  { id: 'openrouter', headline: 'One conversation. Your choice of model.', image: '/agent-connections/openrouter-feature.png' },
]);

export const AGENT_CONNECTION_CATALOG = Object.freeze(EXECUTION_PROVIDERS.map(id => {
  const api = apiProviderDefinition(id), runtime = getRunnerProvider(id), profile = AGENT_PROVIDERS[id];
  return Object.freeze({ id, name: aiProviderName(id), methods: agentConnectionMethods(id),
    group: api ? 'models' : 'code',
    description: profile?.description?.replaceAll(' API API key', ' API key') || `Use ${aiProviderName(id)} through an authorized computer connection.`,
    website: api?.keyUrl || runtime?.installLink || null,
    docs: api?.docs || runtime?.installLink || null,
    company: profile?.company || api?.brand || null,
    runtime: runtime || null, api: api || null,
    featured: FEATURED_AGENT_CONNECTIONS.find(item => item.id === id) || null,
  });
}));

export function agentConnectionById(id) { return AGENT_CONNECTION_CATALOG.find(item => item.id === id); }
export function searchAgentConnections(query = '', group = 'all') {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return AGENT_CONNECTION_CATALOG.filter(item => (group === 'all' || item.group === group) && words.every(word =>
    `${item.name} ${item.id} ${item.description} ${item.methods.map(method => `${method.label} ${method.id}`).join(' ')}`.toLocaleLowerCase().includes(word)));
}
export function workspaceAgentIdentities(data, workspaceId) {
  return (data.agents || []).filter(agent => !agent.personal_agent && !val(agent, 'archived_at') && (!val(agent, 'workspace_id') || val(agent, 'workspace_id') === workspaceId));
}
export function identityConnectionReadiness(agent, data, workspaceId = val(agent, 'workspace_id')) {
  const scopedAgent = val(agent, 'workspace_id') ? agent : { ...agent, workspace_id: workspaceId };
  const connection = (data.connections || []).find(item => item.provider === agent.provider && item.id === val(agent, 'provider_connection_id') && (!val(item, 'workspace_id') || val(item, 'workspace_id') === workspaceId));
  return agentReadiness(scopedAgent, connection);
}
export function connectedAgentIdentities(data, workspaceId) {
  return workspaceAgentIdentities(data, workspaceId).filter(agent => identityConnectionReadiness(agent, data, workspaceId).canStartLive);
}
/** Connection state is permission-filtered saved state, never a provider probe. */
export function providerAccountReady(providerId, data, workspaceId) {
  return (data.connections || []).some(connection => connection.provider === providerId && (!val(connection, 'workspace_id') || val(connection, 'workspace_id') === workspaceId) && agentReadiness({
    id: `catalog-${providerId}`, workspace_id: workspaceId, provider: providerId, provider_connection_id: connection.id, status: 'available',
  }, connection).canStartLive);
}
export function methodBinding(providerId, methodId, data, workspaceId, metadata) {
  if (!agentConnectionMethods(providerId).some(route => route.id === methodId)) return '';
  const method = metadata?.[providerId]?.method;
  if ((methodId === 'api' && method !== 'api_key') || (methodId === 'oauth' && !['oauth', 'github_oauth'].includes(method))) return '';
  const connection = (data.connections || []).find(item => item.provider === providerId && item.mode !== 'demo' && (!val(item, 'workspace_id') || val(item, 'workspace_id') === workspaceId) &&
    (item.workspace_states ? item.workspace_states[workspaceId] : item.state) === 'connected');
  // A generic CLI profile requires an explicitly selected computer binding later.
  if (methodId === 'computer' && !['codex', 'claude', 'copilot'].includes(providerId)) return '';
  if (methodId === 'computer' && providerId === 'copilot' && method !== 'local_acp') return '';
  return connection?.id || '';
}

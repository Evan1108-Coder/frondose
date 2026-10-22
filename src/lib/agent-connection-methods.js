import { apiProviderDefinition } from './ai-provider-catalog.js';
import { getRunnerProvider } from './runner-provider-catalog.js';

/** Supported routes, never a claim that an account is ready. */
export function agentConnectionMethods(provider) {
  const api = apiProviderDefinition(provider);
  return [
    ...(api ? [{ id: 'api', label: 'API key' }] : []),
    ...(api?.auth || provider === 'copilot' ? [{ id: 'oauth', label: provider === 'copilot' ? 'GitHub authorization' : 'Browser authorization' }] : []),
    ...(getRunnerProvider(provider) ? [{ id: 'computer', label: 'Computer (CLI)' }] : []),
  ];
}

export function savedAgentConnectionMethod(provider, connection, metadata) {
  const method = connection?.method ?? metadata?.method;
  const methods = agentConnectionMethods(provider);
  const selected = method === 'api_key' ? 'api' : ['oauth', 'github_oauth'].includes(method) ? 'oauth' : ['existing', 'app_server', 'local_acp', 'computer'].includes(method) ? 'computer' : null;
  if (selected) return methods.some(route => route.id === selected) ? selected : null;
  return methods.length === 1 ? methods[0].id : null;
}

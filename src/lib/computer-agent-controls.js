import { isBrowserAiProvider } from './ai-providers.js';

/** Computer-native tools are not the server's optional Frondose MCP bridge. */
export function computerAgentControls(agent, { projectId = null, globalReadOnly = false } = {}) {
  const computer = agent?.runner_connection;
  const bound = Boolean(computer);
  return {
    bound,
    api: !bound && isBrowserAiProvider(agent?.provider),
    requiresProject: bound && computer.requires_project_access === true,
    projectSelected: bound && Boolean(projectId),
    canBuild: bound && computer.native_tools_allowed === true && agent?.permission_policy !== 'read-only' && !globalReadOnly,
    allowServerNativeBridge: !bound,
  };
}

export function requestNativeTools(agent, requested) {
  return !agent?.runner_connection && requested === true;
}

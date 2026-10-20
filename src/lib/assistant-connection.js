/** Catalog presence or a saved credential is not a ready AI connection. */
export function hasConnectedAssistantAI(state) {
  return Array.isArray(state?.providers) && state.providers.some(provider => provider?.connected === true);
}

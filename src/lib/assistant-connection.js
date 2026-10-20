/** No implicit fallback: the account must be explicitly selected for Frondose. */
export function selectedAssistantConnection(state) {
  if (state?.preferences?.provider_selected !== true || !state.preferences.provider || !Array.isArray(state.providers)) return null;
  return state.providers.find(provider => provider?.provider === state.preferences.provider) || null;
}

export function hasConnectedAssistantAI(state) {
  return selectedAssistantConnection(state)?.connected === true;
}

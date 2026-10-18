import { API_PROVIDER_IDS, apiProviderDefinition } from './ai-provider-catalog.js';
export const EXECUTION_PROVIDERS = Object.freeze(['codex', 'claude', ...API_PROVIDER_IDS]);
export const BROWSER_AI_PROVIDERS = API_PROVIDER_IDS;
export const isBrowserAiProvider = provider => BROWSER_AI_PROVIDERS.includes(provider);
export const aiProviderName = provider => ({ codex: 'Codex', claude: 'Claude Code' }[provider] || apiProviderDefinition(provider)?.name || provider);

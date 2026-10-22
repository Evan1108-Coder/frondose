import { API_PROVIDER_IDS, apiProviderDefinition } from './ai-provider-catalog.js';
import { RUNNER_PROVIDER_CATALOG, getRunnerProvider } from './runner-provider-catalog.js';
export const EXECUTION_PROVIDERS = Object.freeze([...new Set(['codex', 'claude', 'copilot', ...API_PROVIDER_IDS, ...RUNNER_PROVIDER_CATALOG.map(provider => provider.id)])]);
export const BROWSER_AI_PROVIDERS = API_PROVIDER_IDS;
export const isBrowserAiProvider = provider => BROWSER_AI_PROVIDERS.includes(provider);
export const isScopedAiProvider = provider => provider === 'copilot' || isBrowserAiProvider(provider);
export const aiProviderName = provider => ({ codex: 'Codex', claude: 'Claude Code', copilot: 'GitHub Copilot' }[provider] || apiProviderDefinition(provider)?.name || getRunnerProvider(provider)?.title || provider);

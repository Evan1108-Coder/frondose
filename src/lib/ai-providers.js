export const EXECUTION_PROVIDERS = Object.freeze(['codex', 'claude', 'openrouter', 'huggingface']);
export const BROWSER_AI_PROVIDERS = Object.freeze(['openrouter', 'huggingface']);
export const isBrowserAiProvider = provider => BROWSER_AI_PROVIDERS.includes(provider);
export const aiProviderName = provider => ({ codex: 'Codex', claude: 'Claude Code', openrouter: 'OpenRouter', huggingface: 'Hugging Face Inference' }[provider] || provider);

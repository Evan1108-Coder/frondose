// Public connection metadata only. Secrets and request construction stay on the server.
export const API_PROVIDERS = Object.freeze([
  { id: 'openrouter', name: 'OpenRouter', brand: 'OpenRouter', auth: true, docs: 'https://openrouter.ai/docs/guides/overview/auth/oauth', keyUrl: 'https://openrouter.ai/settings/keys', discovery: true },
  { id: 'huggingface', name: 'Hugging Face Inference', brand: 'Hugging Face', auth: true, docs: 'https://huggingface.co/docs/inference-providers/index', keyUrl: 'https://huggingface.co/settings/tokens', discovery: true },
  { id: 'openai', name: 'OpenAI API', brand: 'OpenAI', docs: 'https://developers.openai.com/api/docs/quickstart', keyUrl: 'https://platform.openai.com/api-keys', discovery: true },
  { id: 'anthropic', name: 'Anthropic API', brand: 'Anthropic', docs: 'https://platform.claude.com/docs/en/api/overview', keyUrl: 'https://platform.claude.com/settings/keys', discovery: true },
  { id: 'gemini', name: 'Google Gemini API', brand: 'Google Gemini', docs: 'https://ai.google.dev/api', keyUrl: 'https://aistudio.google.com/api-keys', discovery: true },
  { id: 'xai', name: 'Grok API', brand: 'Grok', docs: 'https://docs.x.ai/developers/rest-api-reference/inference', keyUrl: 'https://console.x.ai', discovery: true },
  { id: 'mistral', name: 'Mistral', brand: 'Mistral', docs: 'https://docs.mistral.ai/api', keyUrl: 'https://console.mistral.ai', discovery: true },
  { id: 'deepseek', name: 'DeepSeek', brand: 'DeepSeek', docs: 'https://api-docs.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys', discovery: true },
  { id: 'groq', name: 'Groq', brand: 'Groq', docs: 'https://console.groq.com/docs/openai', keyUrl: 'https://console.groq.com/keys', discovery: true },
  { id: 'together', name: 'Together AI', brand: 'Together AI', docs: 'https://docs.together.ai/docs/inference/openai-compatibility', keyUrl: 'https://api.together.ai/settings/api-keys', discovery: true },
  { id: 'fireworks', name: 'Fireworks AI', brand: 'Fireworks AI', docs: 'https://docs.fireworks.ai/guides/querying-text-models', keyUrl: 'https://app.fireworks.ai', modelHint: 'accounts/fireworks/models/your-model' },
  { id: 'cohere', name: 'Cohere', brand: 'Cohere', docs: 'https://docs.cohere.com/docs/chat-api', keyUrl: 'https://dashboard.cohere.com/api-keys', discovery: true },
  { id: 'perplexity', name: 'Perplexity', brand: 'Perplexity', docs: 'https://docs.perplexity.ai/docs/agent-api/quickstart', keyUrl: 'https://www.perplexity.ai/settings/api', modelHint: 'Provider model ID from the Agent API catalog' },
  { id: 'moonshot', name: 'Moonshot / Kimi', brand: 'Kimi', docs: 'https://platform.kimi.ai/docs/api/chat', keyUrl: 'https://platform.moonshot.ai/console/api-keys', discovery: true, regions: [{ id: 'global', name: 'Global' }, { id: 'china', name: 'China' }] },
  { id: 'qwen', name: 'Alibaba / Qwen', brand: 'Qwen', docs: 'https://help.aliyun.com/en/model-studio/qwen-api-reference/', keyUrl: 'https://bailian.console.aliyun.com', modelHint: 'Model ID from your Model Studio catalog', regions: [{ id: 'singapore', name: 'Singapore' }, { id: 'beijing', name: 'Beijing' }, { id: 'virginia', name: 'Virginia' }, { id: 'frankfurt', name: 'Frankfurt' }, { id: 'tokyo', name: 'Tokyo' }, { id: 'hongkong', name: 'Hong Kong' }], workspaceRequired: true },
  { id: 'zai', name: 'Z.AI / GLM', brand: 'Z.AI', docs: 'https://docs.z.ai/guides/overview/quick-start', keyUrl: 'https://z.ai/manage-apikey/apikey-list', modelHint: 'Model ID from your Z.AI API catalog', regions: [{ id: 'global', name: 'Global' }, { id: 'china', name: 'China / BigModel' }] },
]);
export const API_PROVIDER_IDS = Object.freeze(API_PROVIDERS.map(item => item.id));
export const apiProviderDefinition = id => API_PROVIDERS.find(item => item.id === id);
export const validApiModel = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/~+-]{0,119}$/.test(value);

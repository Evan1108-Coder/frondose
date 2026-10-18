import { apiProviderDefinition, validApiModel } from '../src/lib/ai-provider-catalog.js';

const failure = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const BASES = {
  openrouter: 'https://openrouter.ai/api/v1', huggingface: 'https://router.huggingface.co/v1',
  openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta', xai: 'https://api.x.ai/v1',
  mistral: 'https://api.mistral.ai/v1', deepseek: 'https://api.deepseek.com',
  groq: 'https://api.groq.com/openai/v1', together: 'https://api.together.ai/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1', cohere: 'https://api.cohere.com',
  perplexity: 'https://api.perplexity.ai/v1', moonshot: 'https://api.moonshot.ai/v1',
  zai: 'https://api.z.ai/api/paas/v4',
};
const QWEN_REGIONS = { singapore: 'ap-southeast-1', beijing: 'cn-beijing', virginia: 'us-east-1', frankfurt: 'eu-central-1', tokyo: 'ap-northeast-1', hongkong: 'cn-hongkong' };

export function apiKeyConfiguration(provider, input) {
  const definition = apiProviderDefinition(provider);
  if (!definition) throw failure('unsupported_provider', 'Choose a supported API provider.');
  const token = input.api_key;
  if (typeof token !== 'string' || token.length < 8 || token.length > 8192 || /[\s\u0000-\u001f\u007f]/.test(token)) throw failure('invalid_api_key', 'Enter a valid API key without spaces or line breaks.');
  const modelIds = input.model_ids ?? [];
  if (!Array.isArray(modelIds) || modelIds.length > 50 || modelIds.some(id => !validApiModel(id))) throw failure('invalid_model', 'Use up to 50 valid model IDs, one per line.');
  if (!definition.discovery && !modelIds.length) throw failure('model_required', 'Enter at least one model ID from this provider’s catalog.');
  const region = input.region || definition.regions?.[0]?.id || null;
  if (definition.regions && !definition.regions.some(item => item.id === region)) throw failure('invalid_region', 'Choose a supported provider region.');
  const providerWorkspace = input.provider_workspace || null;
  if (definition.workspaceRequired && (typeof providerWorkspace !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(providerWorkspace))) throw failure('invalid_provider_workspace', 'Enter the Model Studio workspace ID shown in your provider endpoint.');
  return { type: 'api_key', api_key: token, model_ids: [...new Set(modelIds)], region, provider_workspace: definition.workspaceRequired ? providerWorkspace : null };
}

function baseUrl(provider, config) {
  if (provider === 'qwen') return `https://${config.provider_workspace}.${QWEN_REGIONS[config.region]}.maas.aliyuncs.com/compatible-mode/v1`;
  if (provider === 'moonshot' && config.region === 'china') return 'https://api.moonshot.cn/v1';
  if (provider === 'zai' && config.region === 'china') return 'https://open.bigmodel.cn/api/paas/v4';
  return BASES[provider];
}

function headers(provider, config) {
  if (provider === 'anthropic') return { 'x-api-key': config.api_key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
  if (provider === 'gemini') return { 'x-goog-api-key': config.api_key, 'Content-Type': 'application/json' };
  return { Authorization: `Bearer ${config.api_key}`, 'Content-Type': 'application/json' };
}

// Catalog requests never perform inference. Configured IDs are labeled as such,
// and are not represented as proof of entitlement or model capability.
export async function discoverApiModels(provider, config, requestJson) {
  const definition = apiProviderDefinition(provider);
  if (config.model_ids.length) return config.model_ids.map(id => ({ id, name: id, input_modalities: [], output_modalities: [], source: 'configured' }));
  let discovered = [];
  if (definition.discovery) {
    let path = provider === 'openrouter' ? '/models/user' : '/models';
    if (provider === 'cohere') path = '/v1/models?endpoint=chat&page_size=1000';
    if (provider === 'gemini') path += '?pageSize=1000';
    const response = await requestJson(`${baseUrl(provider, config)}${path}`, { headers: headers(provider, config) });
    const rows = provider === 'gemini' || provider === 'cohere' ? response.models : provider === 'together' && Array.isArray(response) ? response : response.data;
    if (!Array.isArray(rows)) throw failure('provider_response', 'The provider did not return a model catalog.', 502);
    discovered = rows.filter(item => item && typeof item === 'object')
      .filter(item => provider !== 'gemini' || item.supportedGenerationMethods?.includes('generateContent'))
      .filter(item => provider !== 'cohere' || !item.is_deprecated && item.endpoints?.includes('chat'))
      .filter(item => provider !== 'together' || !item.type || item.type === 'chat')
      .filter(item => item.capabilities?.completion_chat !== false)
      .flatMap(item => {
      const id = provider === 'gemini' ? item.name?.replace(/^models\//, '') : item.id || item.name;
      if (!validApiModel(id)) return [];
      return [{ id, name: String(item.displayName || item.display_name || item.name || id).slice(0, 160), input_modalities: item.architecture?.input_modalities || [], output_modalities: item.architecture?.output_modalities || [], source: 'provider_catalog' }];
    }).slice(0, 1000);
  }
  const ids = new Set(discovered.map(item => item.id));
  return [...discovered, ...config.model_ids.filter(id => !ids.has(id)).map(id => ({ id, name: id, input_modalities: [], output_modalities: [], source: 'configured' }))];
}

export function apiCompletionRequest(provider, config, model, prompt, { test = false, signal } = {}) {
  if (!validApiModel(model)) throw failure('invalid_model', 'Choose a valid provider model.');
  const base = baseUrl(provider, config), maxTokens = test ? 1024 : 8192;
  let path = '/chat/completions';
  let body = { model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, stream: false };
  if (provider === 'moonshot') { delete body.max_tokens; body.max_completion_tokens = maxTokens; }
  if (provider === 'openai' || provider === 'perplexity') {
    path = provider === 'perplexity' ? '/agent' : '/responses';
    body = { model, input: prompt, max_output_tokens: maxTokens, stream: false, store: false };
  } else if (provider === 'anthropic') path = '/messages';
  else if (provider === 'gemini') {
    path = `/models/${encodeURIComponent(model)}:generateContent`;
    body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } };
  } else if (provider === 'cohere') path = '/v2/chat';
  return { url: `${base}${path}`, options: { method: 'POST', headers: headers(provider, config), body: JSON.stringify(body), ...(signal ? { signal } : {}) } };
}

export function parseApiCompletion(provider, response, token) {
  if (response?.error) throw failure('provider_error', 'The provider returned an execution error. This request was not retried.', 502);
  let text = '', complete = true, usage = response.usage || {}, source = 'chat_completion';
  if (provider === 'openai' || provider === 'perplexity') {
    source = 'responses';
    complete = response.status === 'completed' && !response.incomplete_details;
    text = (response.output || []).filter(item => item.type === 'message' && item.role === 'assistant').flatMap(item => item.content || []).filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('\n');
  } else if (provider === 'anthropic') {
    source = 'anthropic_messages'; complete = response.stop_reason === 'end_turn';
    text = (response.content || []).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('');
  } else if (provider === 'gemini') {
    source = 'gemini_generate_content';
    const candidate = response.candidates?.[0]; complete = candidate?.finishReason === 'STOP';
    text = (candidate?.content?.parts || []).filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
    usage = { input_tokens: response.usageMetadata?.promptTokenCount, output_tokens: response.usageMetadata?.candidatesTokenCount, total_tokens: response.usageMetadata?.totalTokenCount };
  } else if (provider === 'cohere') {
    source = 'cohere_chat'; complete = response.finish_reason === 'COMPLETE';
    text = (response.message?.content || []).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('');
    usage = response.usage?.tokens || {};
  } else {
    const choice = response.choices?.[0], content = choice?.message?.content;
    complete = !choice?.finish_reason || choice.finish_reason === 'stop';
    text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('') : '';
  }
  if (!complete) throw failure('model_response_incomplete', 'The provider did not return a complete final reply. No actions were extracted.', 502);
  if (!text.trim()) throw failure('model_response', 'The model request completed without a text response.', 502);
  if (text.length > 100_000) throw failure('model_response_too_large', 'The model response exceeded the supported text size.', 502);
  text = text.replaceAll(token, '[redacted authorization]');
  const counts = {};
  for (const name of ['prompt_tokens', 'completion_tokens', 'input_tokens', 'output_tokens', 'total_tokens']) if (Number.isSafeInteger(usage[name]) && usage[name] >= 0) counts[name] = usage[name];
  return { text, ...(Object.keys(counts).length ? { usage: { source, ...counts } } : {}) };
}

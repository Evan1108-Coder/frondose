// Original Frondose adapter, informed by Paseo's event contracts at
// c70a6cfb9ea29c87df52b6b6c574775b0d3b169c (Apache-2.0), ACP v1,
// and https://learn.chatgpt.com/docs/app-server#events. No runtime is executed here.
import { Buffer } from 'node:buffer';

export const RUNNER_EVENT_VERSION = 1;
export const RUNNER_EVENT_LIMITS = Object.freeze({ rawBytes: 48_000, textChars: 16_000, depth: 7, entries: 64, nodes: 1500, events: 20_000 });
const REDACTED = '[redacted]';
const OMITTED = '[omitted]';
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const sensitiveKey = /^(?:env|environment|environmentVariables|headers|authorization|proxyAuthorization|cookie|setCookie|password|passwd|secret|token|clientSecret|apiKey|accessToken|refreshToken|idToken|privateKey|credential|credentials|capability|capabilitiesToken|auth|bearer|signature)$/i;
const sensitiveSuffix = /(?:[_-](?:key|token|secret|password|passwd|credential|cookie)|(?:ApiKey|AccessToken|RefreshToken|ClientSecret|PrivateKey))$/i;

/** Plain text only. Consumers must still use escaped text/Markdown, never innerHTML. */
export function sanitizeRunnerText(value, limit = RUNNER_EVENT_LIMITS.textChars) {
  if (typeof value !== 'string') return '';
  return value.slice(0, Math.max(0, Math.min(limit, RUNNER_EVENT_LIMITS.textChars)) * 4)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?(?:-----END [^-]+-----|$)/g, REDACTED)
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|hf_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g, REDACTED)
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization|cookie)\s*(?:=|:)\s*)(?:"[^"]*"|'[^']*'|[^\s&,;]+)/gi, `$1${REDACTED}`)
    .replace(/([?&](?:key|token|secret|code|signature|auth|api_key|access_token|refresh_token)=)[^&#\s]*/gi, `$1${REDACTED}`)
    .slice(0, Math.max(0, Math.min(limit, RUNNER_EVENT_LIMITS.textChars)));
}

/** Full canonical replies have a larger bound than individual activity events.
 * Redact complete logical secret spans before chunking: a credential split across
 * provider deltas/chunk boundaries must not be reconstructed into the final text.
 */
export function sanitizeRunnerReply(value) {
  if (typeof value !== 'string' || value.length > 100_000) throw Object.assign(new Error('The provider reply exceeded the bounded capture limit.'), { code: 'runtime_output_limit', statusCode: 409 });
  const spans = /-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?(?:-----END [^-]+-----|$)|https?:\/\/[^\s/@:]+:[^\s/@]+@|\bBearer\s+[A-Za-z0-9._~+/=-]+|\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|hf_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})\b|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization|cookie)\s*(?:=|:)\s*(?:"[^"]*"|'[^']*'|[^\s&,;]+)|[?&](?:key|token|secret|code|signature|auth|api_key|access_token|refresh_token)=[^&#\s]*/gi;
  const redacted = value.replace(spans, span => sanitizeRunnerText(span));
  return redacted.match(/[\s\S]{1,12000}/g)?.map(part => sanitizeRunnerText(part)).join('') || '';
}

/** Bounded JSON-safe diagnostic data, not a lossless archive or authorization input. */
export function sanitizeRunnerPayload(value) {
  const seen = new WeakSet();
  let nodes = 0, truncated = false, redacted = false;
  const walk = (item, depth) => {
    if (++nodes > RUNNER_EVENT_LIMITS.nodes || depth > RUNNER_EVENT_LIMITS.depth) { truncated = true; return OMITTED; }
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'string') {
      const result = sanitizeRunnerText(item);
      if (result.includes(REDACTED) && result !== item) redacted = true;
      if (item.length > RUNNER_EVENT_LIMITS.textChars) truncated = true;
      return result;
    }
    if (typeof item === 'number') return Number.isFinite(item) ? item : null;
    if (typeof item !== 'object') { truncated = true; return OMITTED; }
    if (seen.has(item)) { truncated = true; return '[circular]'; }
    seen.add(item);
    const result = Array.isArray(item) ? [] : {};
    // Descriptor inspection avoids evaluating getters and toJSON hooks.
    const keys = Object.keys(item).slice(0, RUNNER_EVENT_LIMITS.entries);
    if (Object.keys(item).length > keys.length) truncated = true;
    for (const key of keys) {
      if (forbiddenKeys.has(key)) { truncated = true; continue; }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !('value' in descriptor)) { truncated = true; continue; }
      const cleanKey = sanitizeRunnerText(key, 120);
      if (!cleanKey || forbiddenKeys.has(cleanKey)) { truncated = true; continue; }
      if (sensitiveKey.test(key) || sensitiveSuffix.test(key)) { result[cleanKey] = REDACTED; redacted = true; }
      else result[cleanKey] = walk(descriptor.value, depth + 1);
    }
    seen.delete(item);
    return result;
  };
  let payload;
  try { payload = walk(value, 0); }
  catch { payload = { unavailable: true }; truncated = true; }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > RUNNER_EVENT_LIMITS.rawBytes) {
    // Do not return cut JSON, unsafe HTML, huge binary blobs or partial secrets.
    payload = { omitted: 'provider_payload_size_limit' };
    truncated = true;
  }
  return { payload, truncated, redacted };
}

const id = value => typeof value === 'string' || typeof value === 'number' ? sanitizeRunnerText(String(value), 200) : undefined;
const text = value => sanitizeRunnerText(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const status = value => ({ pending: 'pending', queued: 'queued', in_progress: 'running', inProgress: 'running', running: 'running', completed: 'completed', failed: 'failed', error: 'failed', cancelled: 'cancelled', canceled: 'cancelled', interrupted: 'cancelled', stopped: 'cancelled' }[value] || 'unknown');
const contentText = value => typeof value === 'string' ? text(value) : Array.isArray(value) ? value.slice(0, 64).map(contentText).filter(Boolean).join('\n').slice(0, 16_000) : value?.type === 'text' ? text(value.text) : value?.type === 'content' ? contentText(value.content) : '';
const message = (role, value, operation = 'snapshot', extra = {}) => ({ kind: 'message', channel: 'conversation', role, text: text(value), operation, format: 'markdown', ...extra });
const progress = (value, extra = {}) => ({ kind: 'progress', channel: 'activity', text: text(value), operation: 'snapshot', format: 'plain', ...extra });
const lifecycle = (value, extra = {}) => ({ kind: 'lifecycle', channel: 'activity', status: value, operation: 'status', ...extra });
const tool = (value, operation = 'snapshot') => ({ kind: 'tool', channel: 'activity', operation, toolCallId: id(value.toolCallId ?? value.id), ...(value.status !== undefined ? { status: status(value.status) } : {}), ...(value.title !== undefined || value.name !== undefined || value.tool !== undefined || value.command !== undefined ? { title: text(value.title ?? value.name ?? value.tool ?? value.command) } : {}), ...(value.content !== undefined || value.output !== undefined || value.aggregatedOutput !== undefined || value.aggregated_output !== undefined ? { text: contentText(value.content ?? value.output ?? value.aggregatedOutput ?? value.aggregated_output) } : {}) });

function acpEvents(raw) {
  const params = record(raw.params), update = record(params.update ?? raw.update ?? raw);
  const type = update.sessionUpdate;
  if (raw.method === 'session/request_permission') return [{ kind: 'approval', channel: 'activity', operation: 'requested', status: 'pending', requestId: id(raw.id), toolCallId: id(params.toolCall?.toolCallId), title: text(params.toolCall?.title ?? params.toolCall?.name ?? 'Permission requested') }];
  if (type === 'agent_message_chunk' || type === 'user_message_chunk') {
    if (update.content?.type !== 'text') return [{ kind: 'attachment', channel: 'conversation', operation: 'append', role: type === 'user_message_chunk' ? 'user' : 'assistant', contentType: id(update.content?.type), messageId: id(update.messageId) }];
    return [message(type === 'user_message_chunk' ? 'user' : 'assistant', update.content.text, 'append', { messageId: id(update.messageId) })];
  }
  if (type === 'agent_thought_chunk') return [progress(contentText(update.content), { operation: 'append', visibility: 'provider-exposed', sourceLabel: 'Provider reasoning', messageId: id(update.messageId) })];
  if (type === 'tool_call' || type === 'tool_call_update') return [tool(update, type === 'tool_call_update' ? 'patch' : 'snapshot')];
  if (type === 'tool_call_content_chunk') return [tool(update, 'append')];
  if (type === 'plan' || type === 'plan_update' || type === 'plan_removed') return [{ kind: 'plan', channel: 'activity', operation: type === 'plan_removed' ? 'removed' : type === 'plan_update' ? 'patch' : 'snapshot' }];
  if (type === 'usage_update') return [{ kind: 'usage', channel: 'activity', operation: 'snapshot' }];
  if (type === 'notice') return [progress(update.message ?? contentText(update.content), { level: ['info', 'warning', 'error'].includes(update.level) ? update.level : 'info' })];
  if (type === 'compaction_update' || type === 'compaction_summary_chunk') return [{ kind: 'compaction', channel: 'activity', operation: type === 'compaction_summary_chunk' ? 'append' : 'patch', status: status(update.status), text: contentText(update.content) }];
  if (['available_commands_update', 'current_mode_update', 'config_option_update', 'session_info_update'].includes(type)) return [{ kind: 'settings', channel: 'activity', operation: 'snapshot' }];
  return null;
}

function codexEvents(raw) {
  const p = record(raw.params), type = raw.method ?? raw.type, item = record(p.item ?? raw.item);
  if (type === 'item/agentMessage/delta') return [message('assistant', p.delta, 'append', { messageId: id(p.itemId), turnId: id(p.turnId) })];
  if (type === 'item/reasoning/summaryTextDelta' || type === 'item/reasoning/textDelta') return [progress(p.delta, { operation: 'append', visibility: 'provider-exposed', sourceLabel: type.includes('summary') ? 'Provider reasoning summary' : 'Provider reasoning', messageId: id(p.itemId) })];
  if (type === 'item/plan/delta') return [{ kind: 'plan', channel: 'activity', operation: 'append', text: text(p.delta), messageId: id(p.itemId) }];
  if (type === 'item/commandExecution/outputDelta') return [{ kind: 'tool', channel: 'activity', operation: 'append', toolCallId: id(p.itemId), text: text(p.delta) }];
  if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput'].includes(type)) return [{ kind: 'approval', channel: 'activity', operation: 'requested', status: 'pending', requestId: id(raw.id), toolCallId: id(p.itemId), title: text(p.command ?? p.reason ?? 'Provider approval requested') }];
  if (type === 'serverRequest/resolved') return [{ kind: 'approval', channel: 'activity', operation: 'observed-resolution', requestId: id(p.requestId), status: 'resolved' }];
  if (type === 'item/completed' || type === 'item/started' || type === 'item.completed' || type === 'item.started' || type === 'item.updated') {
    const done = type.endsWith('completed');
    if (item.type === 'agentMessage' || item.type === 'agent_message') return item.phase === 'commentary' ? [progress(item.text, { messageId: id(item.id) })] : [message('assistant', item.text, 'snapshot', { messageId: id(item.id), status: done ? 'completed' : 'running' })];
    if (item.type === 'userMessage') return [message('user', contentText(item.content), 'snapshot', { messageId: id(item.id) })];
    if (item.type === 'reasoning') return [progress(contentText(item.summary), { visibility: 'provider-exposed', sourceLabel: 'Provider reasoning summary', messageId: id(item.id) })];
    if (['commandExecution', 'command_execution', 'mcpToolCall', 'dynamicToolCall', 'functionCallOutput', 'webSearch'].includes(item.type)) return [tool({ ...item, status: item.status ?? (done ? 'completed' : 'in_progress') })];
    if (item.type === 'fileChange' || item.type === 'file_change') return [{ kind: 'artifact', channel: 'activity', operation: 'snapshot', artifactType: 'file-change', toolCallId: id(item.id), status: status(item.status ?? (done ? 'completed' : 'in_progress')) }];
    if (item.type === 'collabToolCall') return [{ kind: 'coordination', channel: 'activity', operation: 'snapshot', toolCallId: id(item.id), status: status(item.status) }];
    if (item.type === 'plan') return [{ kind: 'plan', channel: 'activity', operation: 'snapshot', text: text(item.text) }];
    if (item.type === 'contextCompaction') return [{ kind: 'compaction', channel: 'activity', operation: 'status', status: done ? 'completed' : 'running' }];
  }
  if (type === 'thread/tokenUsage/updated') return [{ kind: 'usage', channel: 'activity', operation: 'snapshot' }];
  if (type === 'turn/plan/updated') return [{ kind: 'plan', channel: 'activity', operation: 'snapshot', text: text(p.explanation) }];
  if (type === 'turn/diff/updated') return [{ kind: 'artifact', channel: 'activity', operation: 'snapshot', artifactType: 'diff' }];
  if (type === 'turn/completed') return [lifecycle(status(p.turn?.status), { turnId: id(p.turn?.id), text: text(p.turn?.error?.message) })];
  if (type === 'turn.completed') return [{ kind: 'usage', channel: 'activity', operation: 'snapshot' }, lifecycle('completed')];
  if (type === 'turn/started' || type === 'turn.started') return [lifecycle('running', { turnId: id(p.turn?.id ?? raw.turn_id) })];
  if (type === 'thread/started' || type === 'thread.started') return [lifecycle('ready')];
  if (['thread/closed', 'thread/archived', 'thread/unarchived', 'thread/status/changed'].includes(type)) return [lifecycle(type.split('/').at(-1), { text: text(p.status?.type) })];
  if (type === 'turn.failed' || type === 'error') return [{ kind: 'error', channel: 'activity', operation: 'snapshot', status: 'failed', text: text(raw.error?.message ?? raw.message ?? raw.error) }];
  if (type === 'warning' || type === 'configWarning') return [progress(p.message ?? p.summary, { level: 'warning' })];
  return null;
}

function claudeEvents(raw) {
  if (raw.type === 'stream_event') {
    const event = record(raw.event), delta = record(event.delta), block = record(event.content_block);
    if (event.type === 'content_block_delta' && delta.type === 'text_delta') return [message('assistant', delta.text, 'append', { blockIndex: event.index })];
    if (event.type === 'content_block_delta' && delta.type === 'thinking_delta') return [progress(delta.thinking, { operation: 'append', visibility: 'provider-exposed', sourceLabel: 'Provider reasoning', blockIndex: event.index })];
    if (event.type === 'content_block_delta' && delta.type === 'input_json_delta') return [{ kind: 'tool', channel: 'activity', operation: 'input-delta', blockIndex: event.index, text: text(delta.partial_json) }];
    if (event.type === 'content_block_start' && block.type === 'tool_use') return [tool({ id: block.id, name: block.name, status: 'in_progress' })];
    if (event.type === 'message_start') return [lifecycle('running')];
    if (event.type === 'message_delta') return [{ kind: 'usage', channel: 'activity', operation: 'snapshot' }];
    return null;
  }
  if (raw.type === 'assistant' || raw.type === 'user') {
    const role = raw.type === 'user' ? 'user' : 'assistant';
    return (Array.isArray(raw.message?.content) ? raw.message.content : []).flatMap((block, index) => {
      if (block.type === 'text') return [message(role, block.text, 'snapshot', { messageId: id(raw.message?.id ?? raw.uuid), blockIndex: index })];
      if (block.type === 'tool_use') return [tool({ id: block.id, name: block.name, status: 'in_progress' })];
      if (block.type === 'tool_result') return [{ kind: 'tool', channel: 'activity', operation: 'result', toolCallId: id(block.tool_use_id), status: block.is_error ? 'failed' : 'completed', text: contentText(block.content) }];
      if (block.type === 'thinking') return [progress(block.thinking, { sourceLabel: 'Provider reasoning', visibility: 'provider-exposed' })];
      return [{ kind: 'attachment', channel: 'conversation', operation: 'snapshot', role, contentType: id(block.type), blockIndex: index }];
    });
  }
  if (raw.type === 'system') return raw.subtype === 'init' ? [lifecycle('ready')] : [progress(raw.message ?? raw.subtype, { sourceLabel: 'Provider system event' })];
  if (raw.type === 'result') return [{ kind: 'usage', channel: 'activity', operation: 'snapshot' }, ...(raw.result && !raw.is_error ? [message('assistant', raw.result, 'snapshot', { final: true })] : []), lifecycle(raw.is_error ? 'failed' : 'completed', { text: raw.is_error ? text(raw.result ?? (raw.errors || []).join('\n')) : '' })];
  if (raw.type === 'tool_progress') return [progress(raw.tool_name, { toolCallId: id(raw.tool_use_id) })];
  if (raw.type === 'error') return [{ kind: 'error', channel: 'activity', operation: 'snapshot', status: 'failed', text: text(raw.error?.message ?? raw.message) }];
  return null;
}

function paseoEvents(raw) {
  const item = record(raw.item);
  if (raw.type === 'timeline' || raw.type === 'timeline.item') {
    if (item.type === 'user_message' || item.type === 'assistant_message') return [message(item.type === 'user_message' ? 'user' : 'assistant', item.text, 'snapshot', { messageId: id(item.messageId ?? item.id) })];
    if (item.type === 'reasoning') return [progress(item.text, { visibility: 'provider-exposed', sourceLabel: 'Provider reasoning' })];
    if (item.type === 'tool_call') return [tool(item)];
    if (item.type === 'todo') return [{ kind: 'plan', channel: 'activity', operation: 'snapshot' }];
    if (item.type === 'plugin') return [{ kind: 'plugin', channel: 'activity', operation: 'snapshot', pluginId: id(item.pluginId) }];
    if (item.type === 'compaction') return [{ kind: 'compaction', channel: 'activity', operation: 'snapshot', status: status(item.status) }];
    if (item.type === 'error') return [{ kind: 'error', channel: 'activity', operation: 'snapshot', status: 'failed', text: text(item.message) }];
    if (item.type === 'notification') return [progress(item.message, { level: item.level })];
  }
  if (raw.type === 'permission_requested' || raw.type === 'session.permission') return [{ kind: 'approval', channel: 'activity', operation: 'requested', status: 'pending', requestId: id(raw.request?.id), title: text(raw.request?.title ?? raw.request?.name) }];
  if (raw.type === 'permission_resolved') return [{ kind: 'approval', channel: 'activity', operation: 'observed-resolution', requestId: id(raw.requestId), status: 'resolved' }];
  if (raw.type === 'usage_updated' || raw.type === 'session.usage') return [{ kind: 'usage', channel: 'activity', operation: 'snapshot' }];
  if (raw.type === 'thread_started') return [lifecycle('ready')];
  if (raw.type === 'turn_started') return [lifecycle('running')];
  if (raw.type === 'turn_completed') return [lifecycle('completed')];
  if (raw.type === 'turn_failed') return [lifecycle('failed', { text: text(raw.error) })];
  if (raw.type === 'turn_canceled') return [lifecycle('cancelled', { text: text(raw.reason) })];
  if (['mode_changed', 'model_changed', 'thinking_option_changed', 'session.commands', 'session.config'].includes(raw.type)) return [{ kind: 'settings', channel: 'activity', operation: 'snapshot' }];
  return null;
}

function frondoseEvents(raw) {
  if (raw.type === 'agent.message') return [message('assistant', raw.payload?.text ?? raw.summary)];
  if (raw.type === 'agent.progress' || raw.type === 'provider.output') return [progress(raw.payload?.text ?? raw.summary)];
  if (raw.type === 'provider.ready') return [lifecycle('ready')];
  if (raw.type === 'run.started') return [lifecycle('running')];
  if (raw.type === 'run.completed') return [lifecycle('completed')];
  if (raw.type === 'run.cancelled') return [lifecycle('cancelled')];
  if (raw.type === 'run.failed') return [lifecycle('failed', { text: text(raw.summary) })];
  if (raw.type === 'provider.usage') return [{ kind: 'usage', channel: 'activity', operation: 'snapshot' }];
  if (raw.type === 'provider.error') return [{ kind: 'error', channel: 'activity', operation: 'snapshot', status: 'failed', text: text(raw.summary) }];
  if (raw.type === 'command.output') return [tool({ ...raw.payload, title: raw.payload?.command })];
  if (raw.type === 'files.changed') return [{ kind: 'artifact', channel: 'activity', operation: 'snapshot', artifactType: 'file-change' }];
  if (['message.queued', 'message.steered', 'message.dequeued'].includes(raw.type)) return [{ kind: 'coordination', channel: 'activity', operation: raw.type.split('.')[1], text: text(raw.text ?? raw.summary), sourceLabel: 'Observed message delivery' }];
  return null;
}

function piEvents(raw) {
  if (raw.type === 'message_update') {
    const delta = record(raw.assistantMessageEvent);
    if (delta.type === 'text_delta') return [message('assistant', delta.delta, 'append')];
    if (delta.type === 'thinking_delta') return [progress(delta.delta, { operation: 'append', visibility: 'provider-exposed', sourceLabel: 'Provider reasoning' })];
  }
  if (raw.type === 'message_start' || raw.type === 'message_end') {
    const item = record(raw.message);
    if (item.role === 'assistant' || item.role === 'user') return [message(item.role, contentText(item.content), 'snapshot', { messageId: id(item.id), status: raw.type === 'message_end' ? 'completed' : 'running' })];
    if (item.role === 'toolResult') return [tool({ ...item, id: item.toolCallId, name: item.toolName, content: item.content, status: item.isError ? 'failed' : 'completed' }, 'result')];
  }
  if (raw.type?.startsWith('tool_execution_')) return [tool({ ...raw, name: raw.toolName, content: raw.result?.content ?? raw.partialResult?.content, status: raw.type.endsWith('_end') ? raw.isError ? 'failed' : 'completed' : 'running' }, raw.type.endsWith('_update') ? 'patch' : 'snapshot')];
  if (raw.type === 'extension_ui_request') return [{ kind: 'approval', channel: 'activity', operation: 'requested', status: 'pending', requestId: id(raw.id), title: text(raw.title ?? raw.method ?? 'Provider interaction requested') }];
  if (raw.type === 'compaction_start' || raw.type === 'compaction_end') return [{ kind: 'compaction', channel: 'activity', operation: 'status', status: raw.type.endsWith('_start') ? 'running' : raw.errorMessage ? 'failed' : 'completed' }];
  if (raw.type === 'agent_start' || raw.type === 'turn_start') return [lifecycle('running')];
  if (raw.type === 'agent_end' || raw.type === 'agent_settled') return [lifecycle(raw.willRetry ? 'running' : 'completed')];
  if (raw.type === 'auto_retry_start' || raw.type === 'auto_retry_end') return [progress(raw.errorMessage ?? raw.finalError ?? 'Provider-owned retry status.', { sourceLabel: 'Provider retry' })];
  if (raw.type === 'ready') return [lifecycle('ready')];
  return null;
}

function antigravityEvents(raw) {
  if (raw.event === 'init') return [lifecycle('ready')];
  if (raw.event === 'result') return [...(raw.result?.response ? [message('assistant', raw.result.response, 'snapshot', { final: true })] : []), lifecycle(raw.result?.status === 'SUCCESS' ? 'completed' : 'failed', { text: text(raw.result?.error) })];
  if (raw.event !== 'step_update') return null;
  const step = record(raw.step_update), result = [];
  if (step.text_delta) result.push(['RESPONSE', 'agent_response'].includes(step.step_type) ? message('assistant', step.text_delta, 'append', { messageId: id(step.step_index) }) : progress(step.text_delta, { operation: 'append', sourceLabel: 'Provider step' }));
  if (step.tool_name || step.tool_info) result.push(tool({ id: step.step_index, name: step.tool_name ?? step.tool_info?.name, output: step.tool_info?.output, status: step.state === 'DONE' ? 'completed' : step.state === 'ERROR' ? 'failed' : 'running' }));
  if (step.subagent_info) result.push({ kind: 'coordination', channel: 'activity', operation: 'snapshot', sourceLabel: 'Provider child agents' });
  if (step.usage) result.push({ kind: 'usage', channel: 'activity', operation: 'snapshot' });
  return result.length ? result : [progress('', { sourceLabel: 'Provider step' })];
}

function museEvents(raw) {
  const p = record(raw.params), item = record(p.item);
  // MSP delta frames omit item kind; do not mislabel exposed reasoning/tool deltas
  // as assistant answers. The complete item frame supplies its precise kind.
  if (raw.method === 'item/delta') return [progress(p.delta, { operation: 'append', messageId: id(p.itemId), sourceLabel: 'Provider item update' })];
  if (['item/started', 'item/updated', 'item/completed'].includes(raw.method)) {
    if (item.kind === 'agentMessage' || item.kind === 'userMessage') return [message(item.kind === 'userMessage' ? 'user' : 'assistant', item.text, 'snapshot', { messageId: id(item.itemId), status: status(item.status) })];
    if (item.kind === 'reasoning') return [progress((item.summary || []).join('\n'), { visibility: 'provider-exposed', sourceLabel: 'Provider reasoning summary' })];
    if (item.kind === 'compaction') return [{ kind: 'compaction', channel: 'activity', operation: 'status', status: status(item.status) }];
    if (item.kind === 'subagent' || item.kind === 'workflow') return [{ kind: 'coordination', channel: 'activity', operation: 'snapshot', toolCallId: id(item.callId ?? item.itemId) }];
    return [tool({ id: item.callId ?? item.itemId, name: item.tool ?? item.kind, output: item.visibleOutput, status: item.status })];
  }
  if (['approval/request', 'approval/requested', 'approval/updated', 'userInput/request'].includes(raw.method)) return [{ kind: 'approval', channel: 'activity', operation: 'requested', status: 'pending', requestId: id(p.approvalId ?? raw.id), title: text(p.toolName ?? p.subject?.command ?? 'Provider approval requested') }];
  if (raw.method === 'approval/resolved') return [{ kind: 'approval', channel: 'activity', operation: 'observed-resolution', requestId: id(p.approvalId), status: 'resolved' }];
  if (raw.method === 'turn/started') return [lifecycle('running', { turnId: id(p.turnId) })];
  if (raw.method === 'turn/completed') return [lifecycle(p.error || p.terminal === 'failed' ? 'failed' : p.terminal === 'cancelled' ? 'cancelled' : 'completed', { turnId: id(p.turnId) })];
  if (raw.method === 'session/tokenUsage' || raw.method === 'session/contextUsage') return [{ kind: 'usage', channel: 'activity', operation: 'snapshot' }];
  return null;
}

function detectProtocol(raw, providerId) {
  if (raw.method?.startsWith('session/') || raw.sessionUpdate || raw.update?.sessionUpdate) return 'acp';
  if (raw.method?.startsWith('item/') || raw.method?.startsWith('turn/') || raw.type?.startsWith('item.') || raw.type === 'thread.started') return 'codex';
  if (['timeline', 'timeline.item', 'permission_requested', 'permission_resolved', 'thread_started', 'turn_started', 'turn_completed', 'turn_failed', 'turn_canceled', 'usage_updated'].includes(raw.type) || raw.type?.startsWith('session.')) return 'paseo';
  if (['agent.message', 'agent.progress', 'run.started', 'run.completed', 'run.cancelled', 'run.failed', 'provider.ready', 'provider.output', 'provider.usage', 'provider.error', 'files.changed', 'command.output', 'message.queued', 'message.steered', 'message.dequeued'].includes(raw.type)) return 'frondose';
  return /claude/i.test(providerId) ? 'claude' : /codex/i.test(providerId) ? 'codex' : 'unknown';
}

/** Session scope and ordering come only from the trusted caller, never provider data. */
export function createRunnerEventNormalizer({ providerId, sessionId, workspaceId, actorId, nativeSessionId, startSequence = 0, maxEvents = RUNNER_EVENT_LIMITS.events, now = () => new Date().toISOString() } = {}) {
  if (!id(providerId) || !id(sessionId) || providerId !== id(providerId) || sessionId !== id(sessionId)) throw new TypeError('A bounded providerId and sessionId are required.');
  if (!Number.isSafeInteger(startSequence) || startSequence < 0 || startSequence >= Number.MAX_SAFE_INTEGER) throw new TypeError('Invalid runner event sequence.');
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > RUNNER_EVENT_LIMITS.events) throw new TypeError('Invalid runner event limit.');
  let sequence = startSequence, count = 0;
  return Object.freeze({
    getSequence: () => sequence,
    normalize(input, { protocol } = {}) {
      const safe = sanitizeRunnerPayload(input), raw = record(safe.payload);
      const nativeId = id(raw.params?.sessionId ?? raw.params?.threadId ?? raw.session_id ?? raw.thread_id);
      if (nativeSessionId && nativeId && nativeId !== id(nativeSessionId)) {
        const error = new Error('Provider event belongs to a different native session.'); error.code = 'runner_event_session_mismatch'; throw error;
      }
      const selected = protocol ?? detectProtocol(raw, providerId);
      const mapper = { acp: acpEvents, codex: codexEvents, claude: claudeEvents, paseo: paseoEvents, frondose: frondoseEvents, pi: piEvents, omp: piEvents, antigravity: antigravityEvents, muse: museEvents }[selected];
      const events = mapper?.(raw) || [{ kind: 'unknown', channel: 'activity', operation: 'snapshot', text: 'Unsupported provider event retained.' }];
      if (count + events.length > maxEvents || sequence + events.length >= Number.MAX_SAFE_INTEGER) {
        const error = new Error('Runner event capture limit reached.'); error.code = 'runner_event_limit'; throw error;
      }
      const receivedAt = text(now()).slice(0, 80);
      return events.map(event => Object.freeze({
        schema: 'frondose.runner-event', version: RUNNER_EVENT_VERSION,
        ...event,
        id: `${sessionId}:${++sequence}`, sequence, providerId, sessionId,
        ...(workspaceId ? { workspaceId: id(workspaceId) } : {}), ...(actorId ? { actorId: id(actorId) } : {}),
        receivedAt, protocol: selected, providerType: id(raw.method ?? raw.type ?? raw.sessionUpdate ?? raw.update?.sessionUpdate) ?? 'unknown',
        authority: 'observed-only', renderer: 'escaped-text',
        providerEvent: safe.payload, payloadTruncated: safe.truncated, payloadRedacted: safe.redacted,
        // Count is local; provider sequence/timestamp/approval cannot confer authority.
        captureIndex: ++count,
      }));
    },
  });
}

export function normalizeRunnerEvent(raw, { sequence = 1, protocol, ...scope } = {}) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError('Invalid runner event sequence.');
  return createRunnerEventNormalizer({ ...scope, startSequence: sequence - 1 }).normalize(raw, { protocol });
}

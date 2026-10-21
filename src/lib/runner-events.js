// Presentation metadata only. Provider events never become executable controls.
export const RUNNER_EVENT_VERSION = 1;
const kinds = new Set(['message', 'progress', 'tool', 'approval', 'lifecycle', 'usage', 'settings', 'plan', 'artifact', 'coordination', 'compaction', 'attachment', 'plugin', 'error', 'unknown']);
const labels = Object.freeze({ message: 'Message', progress: 'Progress', tool: 'Tool activity', approval: 'Provider permission request', lifecycle: 'Session status', usage: 'Provider-reported usage', settings: 'Provider settings', plan: 'Plan', artifact: 'Result', coordination: 'Agent coordination', compaction: 'Context compaction', attachment: 'Attachment', plugin: 'Plugin activity', error: 'Provider error', unknown: 'Unsupported provider event' });
const clean = value => typeof value === 'string' ? value.slice(0, 16_000).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '') : '';

export function isRunnerEvent(event) {
  return Boolean(event && event.schema === 'frondose.runner-event' && event.version === RUNNER_EVENT_VERSION && event.authority === 'observed-only' && event.renderer === 'escaped-text' && kinds.has(event.kind) && Number.isSafeInteger(event.sequence) && event.sequence > 0 && typeof event.sessionId === 'string' && typeof event.providerId === 'string');
}

/** Render text through React text nodes or the existing safe Markdown renderer.
 * This intentionally supplies no HTML, external URLs or automatic action handler.
 */
export function runnerEventPresentation(event) {
  if (!isRunnerEvent(event)) return { title: 'Unsupported event version', text: '', channel: 'activity', format: 'plain', supported: false, executable: false };
  return {
    title: clean(event.sourceLabel || event.title || labels[event.kind]),
    text: clean(event.text),
    channel: event.kind === 'message' || event.kind === 'attachment' ? 'conversation' : 'activity',
    format: event.kind === 'message' ? 'markdown' : 'plain',
    role: event.role === 'user' ? 'user' : event.role === 'assistant' ? 'assistant' : undefined,
    operation: ['append', 'snapshot', 'patch', 'status', 'result', 'requested', 'observed-resolution', 'removed', 'input-delta', 'queued', 'steered', 'dequeued'].includes(event.operation) ? event.operation : 'snapshot',
    supported: event.kind !== 'unknown', executable: false,
    detailWarning: event.payloadTruncated ? 'Provider details were bounded for safe storage.' : '',
  };
}

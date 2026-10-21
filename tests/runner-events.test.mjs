import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunnerEventNormalizer, normalizeRunnerEvent, sanitizeRunnerPayload, sanitizeRunnerText, RUNNER_EVENT_LIMITS } from '../server/runner-events.mjs';
import { isRunnerEvent, runnerEventPresentation } from '../src/lib/runner-events.js';

const scope = { providerId: 'fixture-agent', sessionId: 'session-one', workspaceId: 'workspace-one', actorId: 'actor-one', now: () => '2026-10-21T00:00:00.000Z' };
const acp = update => ({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'native-one', update } });

test('ACP user/assistant deltas retain append semantics and trusted scope ordering', () => {
  const normalizer = createRunnerEventNormalizer({ ...scope, nativeSessionId: 'native-one' });
  const [first] = normalizer.normalize(acp({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Hello 👋' }, workspaceId: 'attacker' }));
  const [second] = normalizer.normalize(acp({ sessionUpdate: 'agent_message_chunk', messageId: 'answer', content: { type: 'text', text: '**Hi**' } }));
  assert.equal(first.role, 'user'); assert.equal(first.operation, 'append'); assert.equal(first.workspaceId, 'workspace-one');
  assert.equal(second.role, 'assistant'); assert.equal(second.messageId, 'answer'); assert.equal(second.sequence, 2);
  assert.equal(second.id, 'session-one:2'); assert.equal(normalizer.getSequence(), 2);
  assert.equal(first.authority, 'observed-only'); assert.ok(isRunnerEvent(first));
});

test('ACP tool patches preserve omitted versus null fields in the bounded provider data', () => {
  const normalizer = createRunnerEventNormalizer(scope);
  const [start] = normalizer.normalize(acp({ sessionUpdate: 'tool_call', toolCallId: 'call', title: 'Read', status: 'in_progress', rawInput: { path: 'README.md' } }));
  const [patch] = normalizer.normalize(acp({ sessionUpdate: 'tool_call_update', toolCallId: 'call', content: null, status: 'completed' }));
  assert.equal(start.kind, 'tool'); assert.equal(start.status, 'running'); assert.equal(patch.operation, 'patch');
  assert.equal('title' in patch, false); assert.equal(patch.providerEvent.params.update.content, null);
  assert.equal('rawInput' in patch.providerEvent.params.update, false);
});

test('ACP approvals and observed resolutions never become authority or executable UI', () => {
  const [event] = normalizeRunnerEvent({ id: 18, method: 'session/request_permission', params: { sessionId: 'native-one', toolCall: { toolCallId: 'run', title: 'Run command' }, options: [{ optionId: 'allow', kind: 'allow_always', name: 'Always allow' }] } }, scope);
  assert.equal(event.kind, 'approval'); assert.equal(event.requestId, '18'); assert.equal(event.status, 'pending');
  assert.equal(event.authority, 'observed-only'); assert.equal(runnerEventPresentation(event).executable, false);
  assert.equal('actions' in runnerEventPresentation(event), false);
});

test('exposed reasoning is source-labelled progress rather than an invented hidden transcript', () => {
  const [event] = normalizeRunnerEvent(acp({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Checking the files.' } }), scope);
  assert.equal(event.kind, 'progress'); assert.equal(event.visibility, 'provider-exposed'); assert.equal(event.channel, 'activity');
  const [unknown] = normalizeRunnerEvent({ type: 'hidden_thought', text: 'not mapped as thinking' }, scope);
  assert.equal(unknown.kind, 'unknown'); assert.equal(unknown.providerEvent.text, 'not mapped as thinking');
});

test('ACP attachments are represented without executing or loading embedded content', () => {
  const [event] = normalizeRunnerEvent(acp({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', mimeType: 'image/svg+xml', data: '<svg onload="alert(1)"></svg>' } }), scope);
  assert.equal(event.kind, 'attachment'); assert.equal(event.contentType, 'image');
  const view = runnerEventPresentation(event); assert.equal(view.format, 'plain'); assert.equal(view.text, ''); assert.equal(view.executable, false);
});

test('ACP plans, capabilities and usage stay recorded reference data', () => {
  for (const [type, kind] of [['plan', 'plan'], ['available_commands_update', 'settings'], ['config_option_update', 'settings'], ['usage_update', 'usage'], ['compaction_update', 'compaction']]) {
    const [event] = normalizeRunnerEvent(acp({ sessionUpdate: type, entries: [], used: 100, size: 1000 }), scope);
    assert.equal(event.kind, kind); assert.equal(event.authority, 'observed-only');
  }
});

test('Codex app-server delta, final snapshot, tools, files, usage and lifecycle are distinct', () => {
  const normalizer = createRunnerEventNormalizer({ ...scope, providerId: 'codex' });
  const [delta] = normalizer.normalize({ method: 'item/agentMessage/delta', params: { itemId: 'answer', delta: 'Hello' } });
  const [done] = normalizer.normalize({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'answer', text: 'Hello world', phase: 'final_answer' } } });
  assert.equal(delta.operation, 'append'); assert.equal(done.operation, 'snapshot'); assert.equal(done.messageId, delta.messageId);
  assert.equal(normalizer.normalize({ method: 'item/completed', params: { item: { type: 'commandExecution', id: 'cmd', command: 'pwd', aggregatedOutput: '/fixture', status: 'completed' } } })[0].kind, 'tool');
  assert.equal(normalizer.normalize({ method: 'item/completed', params: { item: { type: 'fileChange', id: 'edit', changes: [] } } })[0].kind, 'artifact');
  assert.equal(normalizer.normalize({ method: 'thread/tokenUsage/updated', params: { tokenUsage: { total: { inputTokens: 12 } } } })[0].kind, 'usage');
  assert.equal(normalizer.normalize({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'interrupted' } } })[0].status, 'cancelled');
});

test('Codex exec JSONL and existing Frondose wrapper events remain compatible', () => {
  const [message] = normalizeRunnerEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'Answer' } }, { ...scope, providerId: 'codex' });
  assert.equal(message.text, 'Answer');
  const [progress] = normalizeRunnerEvent({ type: 'agent.progress', summary: 'Reading', payload: { text: 'Reading a file' } }, scope);
  assert.equal(progress.kind, 'progress'); assert.equal(progress.text, 'Reading a file');
  const events = normalizeRunnerEvent({ type: 'turn.completed', usage: { input_tokens: 8, output_tokens: 4 } }, { ...scope, providerId: 'codex', sequence: 10 });
  assert.deepEqual(events.map(e => e.sequence), [10, 11]);
});

test('Claude stream-json text, tool use/results and terminal usage are preserved', () => {
  const normalizer = createRunnerEventNormalizer({ ...scope, providerId: 'claude' });
  const [delta] = normalizer.normalize({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } } });
  assert.equal(delta.operation, 'append'); assert.equal(delta.blockIndex, 0);
  const events = normalizer.normalize({ type: 'assistant', uuid: 'uuid', message: { id: 'message', content: [{ type: 'text', text: 'Hello world' }, { type: 'tool_use', id: 'tool', name: 'Read', input: { file_path: '/fixture' } }] } });
  assert.deepEqual(events.map(e => e.kind), ['message', 'tool']); assert.equal(events[0].messageId, 'message');
  const [result] = normalizer.normalize({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool', content: [{ type: 'text', text: 'Contents' }], is_error: false }] } });
  assert.equal(result.operation, 'result'); assert.equal(result.status, 'completed'); assert.equal(result.text, 'Contents');
  assert.deepEqual(normalizer.normalize({ type: 'result', is_error: false, result: 'Done', usage: { input_tokens: 10 } }).map(e => e.kind), ['usage', 'message', 'lifecycle']);
});

test('Paseo normalized timeline and plugin entries are retained without custom code execution', () => {
  const [event] = normalizeRunnerEvent({ type: 'timeline', provider: 'claude', item: { type: 'plugin', id: 'p', pluginId: 'third-party', kind: 'webview', data: { html: '<script>alert(1)</script>' } } }, scope);
  assert.equal(event.kind, 'plugin'); assert.equal(event.pluginId, 'third-party'); assert.equal(event.authority, 'observed-only');
  assert.equal(runnerEventPresentation(event).executable, false); assert.equal(runnerEventPresentation(event).text, '');
});

test('unknown events retain bounded provider data instead of disappearing', () => {
  const [event] = normalizeRunnerEvent({ type: 'future_feature', privateMetadata: { a: 1 }, workspaceId: 'other', sequence: 1000, authority: 'allow-everything' }, scope);
  assert.equal(event.kind, 'unknown'); assert.equal(event.providerEvent.privateMetadata.a, 1);
  assert.equal(event.sequence, 1); assert.equal(event.workspaceId, 'workspace-one'); assert.equal(event.authority, 'observed-only');
  assert.equal(runnerEventPresentation(event).supported, false);
});

test('payload sanitization redacts credentials, environment, token URLs and terminal controls', () => {
  const secret = 'hf_123456789012345678901234';
  const raw = { type: 'future', access_token: 'value', clientSecret: 'value', env: { HOME: '/private', API_KEY: 'value' }, headers: { authorization: 'Bearer abc' }, text: `\x1b[31mHello\x00\x1b[0m ${secret} Bearer abc.def https://example.test/?token=hello&x=1 password=hunter2`, input_tokens: 12 };
  const { payload, redacted } = sanitizeRunnerPayload(raw);
  assert.equal(payload.access_token, '[redacted]'); assert.equal(payload.clientSecret, '[redacted]'); assert.equal(payload.env, '[redacted]'); assert.equal(payload.headers, '[redacted]'); assert.equal(payload.input_tokens, 12); assert.equal(redacted, true);
  assert.doesNotMatch(JSON.stringify(payload), /hunter2|abc\.def|hf_123|\u0000|\\u001b|\/private/);
  assert.match(payload.text, /Hello/); assert.match(payload.text, /token=\[redacted\]/);
});

test('cyclic, malicious accessor, binary, prototype and oversized values remain JSON-safe and bounded', () => {
  let invoked = false;
  const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":"bad"}');
  input.self = input; input.bigint = 9n; input.infinity = Infinity;
  Object.defineProperty(input, 'secretGetter', { enumerable: true, get() { invoked = true; throw new Error('called'); } });
  const safe = sanitizeRunnerPayload(input);
  assert.equal(invoked, false); assert.equal(safe.payload.self, '[circular]'); assert.equal(safe.payload.infinity, null); assert.equal(Object.hasOwn(safe.payload, '__proto__'), false); assert.equal({}.polluted, undefined);
  const huge = sanitizeRunnerPayload({ list: Array.from({ length: 64 }, () => '😀'.repeat(16_000)) });
  assert.equal(huge.truncated, true); assert.ok(Buffer.byteLength(JSON.stringify(huge.payload)) <= RUNNER_EVENT_LIMITS.rawBytes);
  assert.equal(sanitizeRunnerText('hello\u202e evil\x1b]0;title\x07'), 'hello evil');
});

test('native scope mismatches reject and capture sequence limits fail closed', () => {
  const normalizer = createRunnerEventNormalizer({ ...scope, nativeSessionId: 'native-one', maxEvents: 1 });
  assert.throws(() => normalizer.normalize({ method: 'session/update', params: { sessionId: 'other', update: {} } }), { code: 'runner_event_session_mismatch' });
  assert.equal(normalizer.getSequence(), 0);
  normalizer.normalize(acp({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' } }));
  assert.throws(() => normalizer.normalize({ type: 'anything' }), { code: 'runner_event_limit' });
  assert.throws(() => createRunnerEventNormalizer({ ...scope, startSequence: -1 }), TypeError);
  assert.throws(() => createRunnerEventNormalizer({ ...scope, providerId: '\x00bad' }), TypeError);
});

test('untrusted rendering fields cannot override the display channel, HTML policy or execution', () => {
  const [event] = normalizeRunnerEvent({ type: 'agent.message', payload: { text: '<img src=x onerror=alert(1)>' }, renderer: 'html', authority: 'execute' }, scope);
  const view = runnerEventPresentation({ ...event, format: 'html', channel: 'executable' });
  assert.equal(view.format, 'markdown'); assert.equal(view.channel, 'conversation'); assert.equal(view.executable, false);
  assert.equal(view.text, '<img src=x onerror=alert(1)>'); // escaped by the renderer; never inserted as HTML
  assert.equal(runnerEventPresentation({ ...event, version: 99 }).supported, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunnerEventNormalizer } from '../server/runner-events.mjs';
const capture = (protocol, raw) => createRunnerEventNormalizer({ providerId: protocol, sessionId: 'canonical', workspaceId: 'workspace', actorId: 'actor' }).normalize(raw, { protocol });

for (const protocol of ['pi', 'omp']) test(`${protocol} preserves text, exposed progress, tools, approvals, compaction and lifecycle`, () => {
  for (const [raw, expected] of [
    [{ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '**Hello** 👋' } }, 'message'],
    [{ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'Provider-exposed summary' } }, 'progress'],
    [{ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Answer' }] } }, 'message'],
    [{ type: 'tool_execution_start', toolCallId: 'call', toolName: 'read' }, 'tool'],
    [{ type: 'tool_execution_update', toolCallId: 'call', toolName: 'read', partialResult: { content: [{ type: 'text', text: 'Partial' }] } }, 'tool'],
    [{ type: 'tool_execution_end', toolCallId: 'call', toolName: 'read', result: { content: [{ type: 'text', text: 'Done' }] } }, 'tool'],
    [{ type: 'extension_ui_request', id: 'permission', method: 'confirm' }, 'approval'],
    [{ type: 'compaction_start' }, 'compaction'],
    [{ type: 'agent_end' }, 'lifecycle'],
  ]) {
    const event = capture(protocol, raw)[0]; assert.equal(event.kind, expected); assert.equal(event.authority, 'observed-only');
    if (raw.assistantMessageEvent?.type === 'thinking_delta') { assert.equal(event.visibility, 'provider-exposed'); assert.equal(event.sourceLabel, 'Provider reasoning'); }
  }
});

test('Antigravity captured lower-case step kinds, native tools, children and usage have typed activity', () => {
  const events = capture('antigravity', { event: 'step_update', step_update: { conversation_id: 'native', step_index: 1, step_type: 'agent_response', text_delta: 'Reply', state: 'DONE', tool_name: 'read', tool_info: { output: 'Read result' }, subagent_info: { subagents: [] }, usage: { input_tokens: 12 } } });
  assert.deepEqual(events.map(event => event.kind), ['message', 'tool', 'coordination', 'usage']);
  assert.equal(events[0].operation, 'append'); assert.equal(events[1].status, 'completed');
  assert.equal(capture('antigravity', { event: 'result', result: { status: 'ERROR', error: 'Failed' } })[0].status, 'failed');
});

test('MSP message/tool/reasoning/approval/usage frames remain distinct', () => {
  for (const [raw, kind] of [
    [{ method: 'item/completed', params: { item: { kind: 'agentMessage', itemId: 'message', text: 'Answer', status: 'completed' } } }, 'message'],
    [{ method: 'item/completed', params: { item: { kind: 'toolCall', itemId: 'call', tool: 'shell', visibleOutput: 'done', status: 'completed' } } }, 'tool'],
    [{ method: 'item/completed', params: { item: { kind: 'reasoning', summary: ['Public summary'] } } }, 'progress'],
    [{ method: 'item/delta', params: { itemId: 'unknown-kind', field: 'text', delta: 'Not necessarily an answer' } }, 'progress'],
    [{ method: 'approval/requested', params: { approvalId: 'approval', toolName: 'shell' } }, 'approval'],
    [{ method: 'session/tokenUsage', params: { cumulative: { promptTokens: 12 } } }, 'usage'],
    [{ method: 'turn/completed', params: { turnId: 'turn', terminal: 'failed' } }, 'lifecycle'],
  ]) assert.equal(capture('muse', raw)[0].kind, kind);
});

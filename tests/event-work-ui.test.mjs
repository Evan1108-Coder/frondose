import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVENT_WORK_EVENTS, eventWorkCreateRequest, eventWorkInspectionRequest, eventWorkRecipients } from '../src/lib/event-work-ui.js';

const agent = { id: 'a', name: 'Assistant', workspace_id: 'w', provider: 'codex', provider_connection_id: 'conn_codex', version: 2 };
const chat = { id: 'c', title: 'Planning', workspace_id: 'w', participant_agent_ids: ['a'] };
const connection = { id: 'conn_codex', provider: 'codex', state: 'connected', mode: 'local', metadata: { liveAccountChecked: true } };
const data = () => ({ agents: [{ ...agent }], chats: [{ ...chat }], connections: [{ ...connection }] });
const recipient = () => eventWorkRecipients(data(), 'w')[0];
const inspection = () => ({ id: 'inspection-1', manifest: {}, finalPrompt: 'Captured exact prompt', expires_at: new Date(Date.now() + 600000).toISOString() });
const draft = () => ({ workspaceId: 'w', title: '  Review new work  ', event: 'route.created', targetType: 'workspace', targetId: 'w', recipient: recipient(), content: '  Review Routes.  ', cooldownMinutes: 30, inspection: inspection(), confirmed: true, requestId: 'stable-retry-key' });

test('event targets require a real bound, connected agent in an existing accessible-workspace conversation', () => {
  assert.equal(recipient().label, 'Planning · Assistant');
  const fixture = data();
  fixture.agents.push({ ...agent, id: 'foreign', workspace_id: 'other' }, { ...agent, id: 'unbound', provider_connection_id: null }, { ...agent, id: 'paused', status: 'paused' }, { ...agent, id: 'archived', archived_at: '2026-10-20' });
  fixture.chats[0].participant_agent_ids = ['a', 'foreign', 'unbound', 'paused', 'archived', 'missing'];
  fixture.chats.push({ ...chat, id: 'foreign-chat', workspace_id: 'other' }, { ...chat, id: 'archived-chat', archived_at: '2026-10-20' });
  assert.deepEqual(eventWorkRecipients(fixture, 'w').map(item => item.agent.id), ['a']);
});

test('configured, disconnected, mismatched or simulated connections cannot create event work', () => {
  for (const change of [{ state: 'configured' }, { state: 'not_connected' }, { id: 'other' }, { provider: 'claude' }, { mode: 'demo', metadata: { simulated: true } }, { metadata: { liveAccountChecked: false } }]) {
    const fixture = data(); fixture.connections[0] = { ...connection, ...change };
    assert.deepEqual(eventWorkRecipients(fixture, 'w'), [], JSON.stringify(change));
  }
});

test('scoped model accounts are checked against the exact workspace state', () => {
  const fixture = data();
  fixture.agents[0] = { ...agent, provider: 'openai', provider_connection_id: 'conn_openai' };
  fixture.connections[0] = { id: 'conn_openai', provider: 'openai', mode: 'api', state: 'connected', workspace_states: { w: 'not_connected' } };
  assert.equal(eventWorkRecipients(fixture, 'w').length, 0);
  fixture.connections[0].workspace_states.w = 'connected';
  assert.equal(eventWorkRecipients(fixture, 'w').length, 1);
});

test('event context capture is a bounded conversation with no native or file authority', () => {
  const selected = recipient();
  selected.chat.project_id = 'p'; selected.chat.task_id = 't';
  assert.deepEqual(eventWorkInspectionRequest('w', selected, '  Review this.  '), {
    workspace_id: 'w', chat_id: 'c', agent_id: 'a', project_id: 'p', task_id: 't', prompt: 'Review this.',
    work_mode: 'conversation', permission_mode: 'read-only', native_tools: false,
    include_chat: true, include_memory: true, include_workspace: true, attachments: [], source_message_id: null, context_pack_ids: [],
  });
  assert.equal(eventWorkInspectionRequest('other', selected, 'Review'), null);
  assert.equal(eventWorkInspectionRequest('w', selected, '  '), null);
});

test('event creation uses the reviewed inspection and stable retry identity without copying credentials or provider defaults', () => {
  const input = draft(); input.recipient.agent.secret = 'not-sent';
  const request = eventWorkCreateRequest(input);
  assert.deepEqual(request, {
    workspace_id: 'w', title: 'Review new work', request_id: 'stable-retry-key',
    trigger: { event: 'route.created', target_type: 'workspace', target_id: 'w' },
    payload: { chat_id: 'c', agent_id: 'a', content: 'Review Routes.', attachments: [] },
    cooldown_minutes: 30, context_inspection_id: 'inspection-1', confirmed_recurring: true,
  });
  assert.equal(JSON.stringify(request).includes('not-sent'), false);
  assert.deepEqual(eventWorkCreateRequest(input), request);
});

test('unsupported events, wrong workspace scopes and missing targets are rejected before submission', () => {
  assert.deepEqual(EVENT_WORK_EVENTS.map(item => item.id), ['route.created', 'route.updated', 'update.published']);
  for (const change of [{ event: 'inbox.opened' }, { event: 'plugin.message' }, { targetType: 'user' }, { targetId: '' }, { targetId: 'other' }]) assert.throws(() => eventWorkCreateRequest({ ...draft(), ...change }), /workspace event and scope/);
});

test('invalid cooldowns, missing consent and expired/missing context fail closed', () => {
  for (const cooldownMinutes of [0, 4, 1441, 5.5, NaN, '30']) assert.throws(() => eventWorkCreateRequest({ ...draft(), cooldownMinutes }), /cooldown/);
  for (const confirmed of [false, undefined, 'true']) assert.throws(() => eventWorkCreateRequest({ ...draft(), confirmed }), /provider usage/);
  for (const captured of [null, {}, { ...inspection(), expires_at: new Date(Date.now() - 1).toISOString() }]) assert.throws(() => eventWorkCreateRequest({ ...draft(), inspection: captured }), /fresh context/);
  assert.throws(() => eventWorkCreateRequest({ ...draft(), recipient: null }), /connected agent conversation/);
  assert.throws(() => eventWorkCreateRequest({ ...draft(), requestId: '' }), /retry identity/);
});

test('new UI keeps exact-context review, explicit paid consent and version-checked management', () => {
  const source = readFileSync(new URL('../src/components/EventWork.jsx', import.meta.url), 'utf8');
  assert.match(source, /<ContextInspector request=\{inspectionRequest\}/);
  assert.match(source, /Enable event trigger/);
  assert.match(source, /confirmed, requestId: retry\.current\?\.id/);
  assert.match(source, /body: \{ version: item\.version, state \}/);
  assert.match(source, /createScheduledWorkLoader/);
  assert.match(source, /Previously loaded prompts are hidden/);
  assert.match(source, /does not stop an already running agent/);
});

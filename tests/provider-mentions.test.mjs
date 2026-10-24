import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { providerMentionAtCaret, readyProviderMentions, providerMentionSelection, providerConversation } from '../src/lib/provider-mentions.js';

const provider = { id: 'direct-codex', name: 'Codex', provider: 'codex', workspace_id: 'w1', identity_kind: 'provider', provider_connection_id: 'c1' };
const connection = { id: 'c1', provider: 'codex', mode: 'live', state: 'connected' };
const draft = { text: 'Please @Code inspect this', files: [{ name: 'private.txt', content: 'private' }], context: { id: 'private-context' }, replyTo: 'message-private', retryKeys: {}, permission: 'workspace-write', nativeTools: true };

test('@ picker recognizes a caret token, not email addresses or pasted prose as execution', () => {
  assert.deepEqual(providerMentionAtCaret('@Code'), { start: 0, end: 5, query: 'Code' });
  assert.deepEqual(providerMentionAtCaret(draft.text, 12), { start: 7, end: 12, query: 'Code' });
  assert.equal(providerMentionAtCaret('mail@example.com'), null);
  assert.equal(providerMentionAtCaret('@Codex do this'), null);
  assert.equal(providerMentionAtCaret('ordinary text'), null);
});

test('only ready direct provider identities from the exact workspace appear', () => {
  const data = { connections: [connection], agents: [provider, { ...provider, id: 'personal', identity_kind: 'agent' }, { ...provider, id: 'foreign', workspace_id: 'w2' }, { ...provider, id: 'legacy-global', workspace_id: null }, { ...provider, id: 'paused', status: 'paused' }, { ...provider, id: 'unbound', provider_connection_id: '' }, { ...provider, id: 'archived', archived_at: 'today' }] };
  assert.deepEqual(readyProviderMentions(data, 'w1', 'cod').map(item => item.id), [provider.id]);
  assert.equal(readyProviderMentions({ agents: [provider], connections: [] }, 'w1').length, 0);
  assert.equal(readyProviderMentions(data, 'w1', 'unknown').length, 0);
  assert.equal(readyProviderMentions({ agents: [provider], connections: [{ ...connection, workspace_id: 'w2' }] }, 'w1').length, 0);
});

test('selection changes only unbound/same-provider draft and resets elevated mode without copying context', () => {
  const original = structuredClone(draft), token = providerMentionAtCaret(draft.text, 12);
  const decision = providerMentionSelection({ responding_agent_id: provider.id }, draft, provider, token);
  assert.equal(decision.kind, 'select');
  assert.equal(decision.changes.text, 'Please  inspect this');
  assert.equal(decision.changes.recipient, provider.id);
  assert.equal(decision.changes.permission, 'conversation');
  assert.equal(decision.changes.nativeTools, false);
  assert.equal(Object.hasOwn(decision.changes, 'files'), false);
  assert.equal(Object.hasOwn(decision.changes, 'context'), false);
  assert.deepEqual(draft, original);
  assert.equal(providerMentionSelection({}, draft, provider, token).kind, 'select');
});

test('different responders require a separate conversation, and uncertain drafts cannot change identity', () => {
  const token = providerMentionAtCaret(draft.text, 12);
  assert.equal(providerMentionSelection({ responding_agent_id: 'custom-agent' }, draft, provider, token).kind, 'open');
  assert.equal(providerMentionSelection({}, { ...draft, turn: 'uncertain' }, provider, token).kind, 'blocked');
  assert.equal(providerMentionSelection({}, { ...draft, sending: true }, provider, token).kind, 'blocked');
  assert.equal(providerMentionSelection({}, { ...draft, retryKeys: { message: 'uncertain' } }, provider, token).kind, 'blocked');
});

test('existing provider conversation lookup stays workspace/general-chat scoped', () => {
  const rows = [
    { id: 'old', workspace_id: 'w1', responding_agent_id: provider.id, updated_at: '2026-01-01' },
    { id: 'current', workspace_id: 'w1', responding_agent_id: provider.id, updated_at: '2026-10-24' },
    { id: 'foreign', workspace_id: 'w2', responding_agent_id: provider.id, updated_at: '2027-01-01' },
    { id: 'project', workspace_id: 'w1', project_id: 'p', responding_agent_id: provider.id, updated_at: '2027-01-01' },
    { id: 'archived', workspace_id: 'w1', archived_at: 'today', responding_agent_id: provider.id, updated_at: '2027-01-01' },
  ];
  assert.equal(providerConversation(rows, 'w1', provider.id).id, 'current');
  assert.equal(providerConversation(rows, 'w1', 'another'), null);
});

test('chat mention selection never sends and revalidates before explicit navigation', () => {
  const source = readFileSync(new URL('../src/views/Chats.jsx', import.meta.url), 'utf8');
  transformSync(source, { loader: 'jsx', format: 'esm' });
  const choose = source.slice(source.indexOf('function chooseProviderMention('), source.indexOf('async function openProviderConversation('));
  assert.doesNotMatch(choose, /sendChatTurn|createChat|requestSubmit|navigate\(/);
  assert.match(choose, /persistComposer\(chat.id, composer/);
  const open = source.slice(source.indexOf('async function openProviderConversation('), source.indexOf('async function collaborationAction('));
  assert.match(open, /await refreshFrondose\(\)/);
  assert.doesNotMatch(open, /files:|context:|text:|sendChatTurn|createMessage|\.text\s*=/);
  assert.match(open, /providerCreateUncertain.current/);
  assert.match(source, /if \(mention\) \{ setError\(new Error\('Choose a connected provider/);
  assert.match(source, /event.nativeEvent.isComposing/);
});

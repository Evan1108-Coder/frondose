import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareFrondoseAgentEntry, peekFrondoseAgentEntry, consumeFrondoseAgentEntry,
  clearFrondoseAgentEntry, defaultFrondoseAgentInstruction, frondoseAgentSourceLabel, frondoseAgentActivitySource,
} from '../src/lib/frondose-agent-entry.js';
import { getCommand, commandAvailability, parseSlashCommand } from '../src/lib/commands.js';

test('Frondose agent handoff retains stable source IDs, not copied content or authority', () => {
  const source = { type: 'document', id: 'document-one', content: 'Private source text', permission: 'workspace-write' };
  const entry = prepareFrondoseAgentEntry({ workspaceId: 'workspace-one', source, instruction: '  Explain the decision.  ', permission: 'workspace-write' });
  source.id = 'changed';
  assert.deepEqual(entry, { workspaceId: 'workspace-one', source: { type: 'document', id: 'document-one' }, instruction: 'Explain the decision.' });
  assert.ok(Object.isFrozen(entry));
  assert.ok(Object.isFrozen(entry.source));
  assert.equal(peekFrondoseAgentEntry('workspace-one'), entry);
  assert.equal(peekFrondoseAgentEntry('workspace-one'), entry, 'reading is repeatable for React initializers');
  assert.equal(consumeFrondoseAgentEntry('workspace-one'), entry);
  assert.equal(peekFrondoseAgentEntry('workspace-one'), null);
});

test('Frondose agent handoff cannot be read or consumed by another workspace', () => {
  const entry = prepareFrondoseAgentEntry({ workspaceId: 'workspace-a', source: { type: 'update', id: 'update-a' }, instruction: 'Help me respond.' });
  assert.equal(peekFrondoseAgentEntry('workspace-b'), null);
  assert.equal(consumeFrondoseAgentEntry('workspace-b'), null);
  clearFrondoseAgentEntry('workspace-b');
  assert.equal(peekFrondoseAgentEntry('workspace-a'), entry);
  clearFrondoseAgentEntry('workspace-a');
  assert.equal(peekFrondoseAgentEntry('workspace-a'), null);
});

test('supported source types and a source-free request do not require a provider', () => {
  for (const type of ['document', 'update', 'task', 'project']) {
    assert.deepEqual(prepareFrondoseAgentEntry({ workspaceId: 'workspace', source: { type, id: 'source' } }).source, { type, id: 'source' });
  }
  assert.deepEqual(prepareFrondoseAgentEntry({ workspaceId: 'workspace', instruction: 'Help me organize my work.' }), {
    workspaceId: 'workspace', source: null, instruction: 'Help me organize my work.',
  });
  clearFrondoseAgentEntry('workspace');
});

test('invalid scopes and unbounded instructions fail before replacing a valid handoff', () => {
  const original = prepareFrondoseAgentEntry({ workspaceId: 'workspace', instruction: 'Keep this request.' });
  for (const workspaceId of ['', '../private', 'a/b', 'a\\b', 'a\u0000b', 'x'.repeat(513)]) {
    assert.throws(() => prepareFrondoseAgentEntry({ workspaceId }), /active workspace/);
  }
  for (const source of [{ type: 'account', id: 'one' }, { type: 'task', id: '../one' }, { type: 'task', id: '' }, {}]) {
    assert.throws(() => prepareFrondoseAgentEntry({ workspaceId: 'workspace', source }), /supported workspace source/);
  }
  for (const instruction of [null, {}, 'x'.repeat(10001)]) {
    assert.throws(() => prepareFrondoseAgentEntry({ workspaceId: 'workspace', instruction }), /10,000 characters/);
  }
  assert.equal(peekFrondoseAgentEntry('workspace'), original);
  clearFrondoseAgentEntry('workspace');
});

test('source defaults request suggestions, not silent workspace mutations', () => {
  assert.equal(frondoseAgentSourceLabel('task'), 'Route');
  assert.match(defaultFrondoseAgentInstruction('document'), /Suggest changes for me to review/);
  assert.match(defaultFrondoseAgentInstruction('update'), /Suggest changes for me to review/);
  assert.match(defaultFrondoseAgentInstruction('task'), /before proposing actions/);
});

test('addressed agent handoffs retain only a validated stable profile ID and remain workspace isolated', () => {
  const entry = prepareFrondoseAgentEntry({ workspaceId: 'workspace-a', agentId: 'agent_profile-1', source: { type: 'update', id: 'update-1' }, instruction: 'Help me respond.', provider: 'codex', model: 'ignored', nativeTools: true });
  assert.deepEqual(entry, { workspaceId: 'workspace-a', agentId: 'agent_profile-1', source: { type: 'update', id: 'update-1' }, instruction: 'Help me respond.' });
  assert.ok(Object.isFrozen(entry));
  assert.equal(peekFrondoseAgentEntry('workspace-b'), null);
  assert.equal(consumeFrondoseAgentEntry('workspace-b'), null);
  assert.equal(peekFrondoseAgentEntry('workspace-a').agentId, 'agent_profile-1');
  for (const agentId of ['', 'agent/name', '../agent', 'a\\b', 'a b', 'a\u0000b', {}, 1, 'x'.repeat(513)]) {
    assert.throws(() => prepareFrondoseAgentEntry({ workspaceId: 'workspace-a', agentId }), /valid agent profile/);
    assert.equal(peekFrondoseAgentEntry('workspace-a'), entry);
  }
  clearFrondoseAgentEntry('workspace-a');
});

test('reply entrypoints retain the published parent; private drafts use saved work only', () => {
  const parent = { id: 'published-update', publication_state: 'published', content: 'Do not copy me' };
  const draft = { id: 'private-draft', publication_state: 'draft', content: 'Keep this private' };
  assert.deepEqual(frondoseAgentActivitySource({ replyTo: parent, targetType: 'route', targetId: 'route' }), { type: 'update', id: parent.id });
  assert.deepEqual(frondoseAgentActivitySource({ entry: draft, replyTo: parent, targetType: 'route', targetId: 'route' }), { type: 'update', id: parent.id });
  assert.deepEqual(frondoseAgentActivitySource({ entry: draft, targetType: 'route', targetId: 'route' }), { type: 'task', id: 'route' });
  assert.deepEqual(frondoseAgentActivitySource({ entry: parent, targetType: 'route', targetId: 'route' }), { type: 'update', id: parent.id });
  assert.equal(frondoseAgentActivitySource({ targetType: 'request', targetId: 'request' }), null);
});

test('/rumbo is an explicitly registered draft-only command, never a shell or provider launch', () => {
  const command = getCommand('rumbo');
  assert.equal(command.draft, true);
  assert.equal(command.write, false);
  assert.equal(command.startsAgent, false);
  assert.equal(command.paid, false);
  assert.equal(command.external, false);
  assert.equal(commandAvailability(command).available, false);
  for (const context of ['chat', 'reply', 'document', 'route', 'project', 'workbench']) {
    assert.equal(commandAvailability(command, { context, executableCommandIds: ['rumbo'] }).available, true);
  }
  assert.deepEqual(parseSlashCommand('/rumbo "Explain the blockers"').argv, ['Explain the blockers']);
  assert.equal(parseSlashCommand('/usr/bin/rumbo'), null, 'absolute terminal paths remain raw shell input');
});

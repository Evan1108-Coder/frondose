import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareTalvoriAgentEntry, peekTalvoriAgentEntry, consumeTalvoriAgentEntry,
  clearTalvoriAgentEntry, defaultTalvoriAgentInstruction, talvoriAgentSourceLabel, talvoriAgentActivitySource,
} from '../src/lib/talvori-agent-entry.js';
import { getCommand, commandAvailability, parseSlashCommand } from '../src/lib/commands.js';

test('Talvori agent handoff retains stable source IDs, not copied content or authority', () => {
  const source = { type: 'document', id: 'document-one', content: 'Private source text', permission: 'workspace-write' };
  const entry = prepareTalvoriAgentEntry({ workspaceId: 'workspace-one', source, instruction: '  Explain the decision.  ', permission: 'workspace-write' });
  source.id = 'changed';
  assert.deepEqual(entry, { workspaceId: 'workspace-one', source: { type: 'document', id: 'document-one' }, instruction: 'Explain the decision.' });
  assert.ok(Object.isFrozen(entry));
  assert.ok(Object.isFrozen(entry.source));
  assert.equal(peekTalvoriAgentEntry('workspace-one'), entry);
  assert.equal(peekTalvoriAgentEntry('workspace-one'), entry, 'reading is repeatable for React initializers');
  assert.equal(consumeTalvoriAgentEntry('workspace-one'), entry);
  assert.equal(peekTalvoriAgentEntry('workspace-one'), null);
});

test('Talvori agent handoff cannot be read or consumed by another workspace', () => {
  const entry = prepareTalvoriAgentEntry({ workspaceId: 'workspace-a', source: { type: 'update', id: 'update-a' }, instruction: 'Help me respond.' });
  assert.equal(peekTalvoriAgentEntry('workspace-b'), null);
  assert.equal(consumeTalvoriAgentEntry('workspace-b'), null);
  clearTalvoriAgentEntry('workspace-b');
  assert.equal(peekTalvoriAgentEntry('workspace-a'), entry);
  clearTalvoriAgentEntry('workspace-a');
  assert.equal(peekTalvoriAgentEntry('workspace-a'), null);
});

test('supported source types and a source-free request do not require a provider', () => {
  for (const type of ['document', 'update', 'task', 'project']) {
    assert.deepEqual(prepareTalvoriAgentEntry({ workspaceId: 'workspace', source: { type, id: 'source' } }).source, { type, id: 'source' });
  }
  assert.deepEqual(prepareTalvoriAgentEntry({ workspaceId: 'workspace', instruction: 'Help me organize my work.' }), {
    workspaceId: 'workspace', source: null, instruction: 'Help me organize my work.',
  });
  clearTalvoriAgentEntry('workspace');
});

test('invalid scopes and unbounded instructions fail before replacing a valid handoff', () => {
  const original = prepareTalvoriAgentEntry({ workspaceId: 'workspace', instruction: 'Keep this request.' });
  for (const workspaceId of ['', '../private', 'a/b', 'a\\b', 'a\u0000b', 'x'.repeat(513)]) {
    assert.throws(() => prepareTalvoriAgentEntry({ workspaceId }), /active workspace/);
  }
  for (const source of [{ type: 'account', id: 'one' }, { type: 'task', id: '../one' }, { type: 'task', id: '' }, {}]) {
    assert.throws(() => prepareTalvoriAgentEntry({ workspaceId: 'workspace', source }), /supported workspace source/);
  }
  for (const instruction of [null, {}, 'x'.repeat(10001)]) {
    assert.throws(() => prepareTalvoriAgentEntry({ workspaceId: 'workspace', instruction }), /10,000 characters/);
  }
  assert.equal(peekTalvoriAgentEntry('workspace'), original);
  clearTalvoriAgentEntry('workspace');
});

test('source defaults request suggestions, not silent workspace mutations', () => {
  assert.equal(talvoriAgentSourceLabel('task'), 'Route');
  assert.match(defaultTalvoriAgentInstruction('document'), /Suggest changes for me to review/);
  assert.match(defaultTalvoriAgentInstruction('update'), /Suggest changes for me to review/);
  assert.match(defaultTalvoriAgentInstruction('task'), /before proposing actions/);
});

test('addressed agent handoffs retain only a validated stable profile ID and remain workspace isolated', () => {
  const entry = prepareTalvoriAgentEntry({ workspaceId: 'workspace-a', agentId: 'agent_profile-1', source: { type: 'update', id: 'update-1' }, instruction: 'Help me respond.', provider: 'codex', model: 'ignored', nativeTools: true });
  assert.deepEqual(entry, { workspaceId: 'workspace-a', agentId: 'agent_profile-1', source: { type: 'update', id: 'update-1' }, instruction: 'Help me respond.' });
  assert.ok(Object.isFrozen(entry));
  assert.equal(peekTalvoriAgentEntry('workspace-b'), null);
  assert.equal(consumeTalvoriAgentEntry('workspace-b'), null);
  assert.equal(peekTalvoriAgentEntry('workspace-a').agentId, 'agent_profile-1');
  for (const agentId of ['', 'agent/name', '../agent', 'a\\b', 'a b', 'a\u0000b', {}, 1, 'x'.repeat(513)]) {
    assert.throws(() => prepareTalvoriAgentEntry({ workspaceId: 'workspace-a', agentId }), /valid agent profile/);
    assert.equal(peekTalvoriAgentEntry('workspace-a'), entry);
  }
  clearTalvoriAgentEntry('workspace-a');
});

test('reply entrypoints retain the published parent; private drafts use saved work only', () => {
  const parent = { id: 'published-update', publication_state: 'published', content: 'Do not copy me' };
  const draft = { id: 'private-draft', publication_state: 'draft', content: 'Keep this private' };
  assert.deepEqual(talvoriAgentActivitySource({ replyTo: parent, targetType: 'route', targetId: 'route' }), { type: 'update', id: parent.id });
  assert.deepEqual(talvoriAgentActivitySource({ entry: draft, replyTo: parent, targetType: 'route', targetId: 'route' }), { type: 'update', id: parent.id });
  assert.deepEqual(talvoriAgentActivitySource({ entry: draft, targetType: 'route', targetId: 'route' }), { type: 'task', id: 'route' });
  assert.deepEqual(talvoriAgentActivitySource({ entry: parent, targetType: 'route', targetId: 'route' }), { type: 'update', id: parent.id });
  assert.equal(talvoriAgentActivitySource({ targetType: 'request', targetId: 'request' }), null);
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

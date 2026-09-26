import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareRumboAgentEntry, peekRumboAgentEntry, consumeRumboAgentEntry,
  clearRumboAgentEntry, defaultRumboAgentInstruction, rumboAgentSourceLabel, rumboAgentActivitySource,
} from '../src/lib/rumbo-agent-entry.js';
import { getCommand, commandAvailability, parseSlashCommand } from '../src/lib/commands.js';

test('Rumbo agent handoff retains stable source IDs, not copied content or authority', () => {
  const source = { type: 'document', id: 'document-one', content: 'Private source text', permission: 'workspace-write' };
  const entry = prepareRumboAgentEntry({ workspaceId: 'workspace-one', source, instruction: '  Explain the decision.  ', permission: 'workspace-write' });
  source.id = 'changed';
  assert.deepEqual(entry, { workspaceId: 'workspace-one', source: { type: 'document', id: 'document-one' }, instruction: 'Explain the decision.' });
  assert.ok(Object.isFrozen(entry));
  assert.ok(Object.isFrozen(entry.source));
  assert.equal(peekRumboAgentEntry('workspace-one'), entry);
  assert.equal(peekRumboAgentEntry('workspace-one'), entry, 'reading is repeatable for React initializers');
  assert.equal(consumeRumboAgentEntry('workspace-one'), entry);
  assert.equal(peekRumboAgentEntry('workspace-one'), null);
});

test('Rumbo agent handoff cannot be read or consumed by another workspace', () => {
  const entry = prepareRumboAgentEntry({ workspaceId: 'workspace-a', source: { type: 'update', id: 'update-a' }, instruction: 'Help me respond.' });
  assert.equal(peekRumboAgentEntry('workspace-b'), null);
  assert.equal(consumeRumboAgentEntry('workspace-b'), null);
  clearRumboAgentEntry('workspace-b');
  assert.equal(peekRumboAgentEntry('workspace-a'), entry);
  clearRumboAgentEntry('workspace-a');
  assert.equal(peekRumboAgentEntry('workspace-a'), null);
});

test('supported source types and a source-free request do not require a provider', () => {
  for (const type of ['document', 'update', 'task', 'project']) {
    assert.deepEqual(prepareRumboAgentEntry({ workspaceId: 'workspace', source: { type, id: 'source' } }).source, { type, id: 'source' });
  }
  assert.deepEqual(prepareRumboAgentEntry({ workspaceId: 'workspace', instruction: 'Help me organize my work.' }), {
    workspaceId: 'workspace', source: null, instruction: 'Help me organize my work.',
  });
  clearRumboAgentEntry('workspace');
});

test('invalid scopes and unbounded instructions fail before replacing a valid handoff', () => {
  const original = prepareRumboAgentEntry({ workspaceId: 'workspace', instruction: 'Keep this request.' });
  for (const workspaceId of ['', '../private', 'a/b', 'a\\b', 'a\u0000b', 'x'.repeat(513)]) {
    assert.throws(() => prepareRumboAgentEntry({ workspaceId }), /active workspace/);
  }
  for (const source of [{ type: 'account', id: 'one' }, { type: 'task', id: '../one' }, { type: 'task', id: '' }, {}]) {
    assert.throws(() => prepareRumboAgentEntry({ workspaceId: 'workspace', source }), /supported workspace source/);
  }
  for (const instruction of [null, {}, 'x'.repeat(10001)]) {
    assert.throws(() => prepareRumboAgentEntry({ workspaceId: 'workspace', instruction }), /10,000 characters/);
  }
  assert.equal(peekRumboAgentEntry('workspace'), original);
  clearRumboAgentEntry('workspace');
});

test('source defaults request suggestions, not silent workspace mutations', () => {
  assert.equal(rumboAgentSourceLabel('task'), 'Route');
  assert.match(defaultRumboAgentInstruction('document'), /Suggest changes for me to review/);
  assert.match(defaultRumboAgentInstruction('update'), /Suggest changes for me to review/);
  assert.match(defaultRumboAgentInstruction('task'), /before proposing actions/);
});

test('reply entrypoints retain the published parent; private drafts use saved work only', () => {
  const parent = { id: 'published-update', publication_state: 'published', content: 'Do not copy me' };
  const draft = { id: 'private-draft', publication_state: 'draft', content: 'Keep this private' };
  assert.deepEqual(rumboAgentActivitySource({ replyTo: parent, targetType: 'route', targetId: 'route' }), { type: 'update', id: parent.id });
  assert.deepEqual(rumboAgentActivitySource({ entry: draft, replyTo: parent, targetType: 'route', targetId: 'route' }), { type: 'update', id: parent.id });
  assert.deepEqual(rumboAgentActivitySource({ entry: draft, targetType: 'route', targetId: 'route' }), { type: 'task', id: 'route' });
  assert.deepEqual(rumboAgentActivitySource({ entry: parent, targetType: 'route', targetId: 'route' }), { type: 'update', id: parent.id });
  assert.equal(rumboAgentActivitySource({ targetType: 'request', targetId: 'request' }), null);
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

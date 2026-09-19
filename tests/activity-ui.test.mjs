import test from 'node:test';
import assert from 'node:assert/strict';
import { activityThreads, mentionedAgents, UPDATE_TYPES } from '../src/lib/activity.js';

test('activity update catalog contains the seven persisted server types', () => {
  assert.deepEqual(UPDATE_TYPES.map(([value]) => value), ['progress', 'decision', 'blocker', 'risk', 'release', 'outcome', 'comment']);
});

test('agent mentions recognize names and provider aliases without partial-name matches', () => {
  const agents = [{ id: 'one', name: 'Codex Reviewer', provider: 'codex' }, { id: 'two', name: 'Claude', provider: 'claude' }, { id: 'three', name: 'Code', provider: 'custom' }];
  assert.deepEqual(mentionedAgents('@Codex please review this with @Claude.', agents).map(agent => agent.id), ['one', 'two']);
  assert.deepEqual(mentionedAgents('Email me@Codex.example and ignore @Coder.', agents), []);
  assert.deepEqual(mentionedAgents('@code can inspect this.', agents).map(agent => agent.id), ['three']);
});

test('activity threads nest same-feed replies and omit archived records', () => {
  const threads = activityThreads([
    { id: 'root', parent_id: null },
    { id: 'reply', parent_id: 'root' },
    { id: 'nested', parent_id: 'reply' },
    { id: 'gone', parent_id: null, archived_at: 'now' },
    { id: 'orphan', parent_id: 'gone' },
  ]);
  assert.deepEqual(threads.map(item => item.id), ['root', 'orphan']);
  assert.equal(threads[0].replies[0].id, 'reply');
  assert.equal(threads[0].replies[0].replies[0].id, 'nested');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionReadOptions, connectionQueryKey, matchingConnectionCursor, selectedConnectionResources, connectionScopes, PACKAGE_TYPES, canEditRejectedConnectionAction } from '../src/lib/connection-ui-policy.js';

test('connection reads expose provider-specific options without leaking irrelevant fields', () => {
  assert.deepEqual(connectionReadOptions('google-sheets'), { range: 'A1:Z200' });
  assert.deepEqual(connectionReadOptions('google-sheets', { range: "'Release plan'!A1:F50", package_type: 'npm' }), { range: "'Release plan'!A1:F50" });
  for (const package_type of PACKAGE_TYPES) assert.deepEqual(connectionReadOptions('github-packages', { package_type }), { package_type });
  assert.deepEqual(connectionReadOptions('github', { range: 'A1', package_type: 'npm' }), {});
  assert.deepEqual(connectionReadOptions('github-packages', { package_type: 'invalid' }), { package_type: 'container' });
  assert.deepEqual(connectionReadOptions('github-actions', { run_id: '123', extra: 'ignored' }, [{ name: 'run_id', kind: 'jobs' }]), { run_id: '123' });
});

test('connection pagination cannot reuse a cursor across query changes', () => {
  const input = { resource_id: 'owner/repo', kind: 'packages', package_type: 'npm' };
  const key = connectionQueryKey('connection-a', input);
  const page = { queryKey: key, cursor: 'next-page' };
  assert.equal(matchingConnectionCursor(page, key), 'next-page');
  for (const change of [{ resource_id: 'owner/other' }, { kind: 'issues' }, { package_type: 'container' }, { range: 'B1:C3' }]) {
    assert.equal(matchingConnectionCursor(page, connectionQueryKey('connection-a', { ...input, ...change })), null);
  }
  assert.equal(matchingConnectionCursor(page, connectionQueryKey('connection-b', input)), null);
  assert.equal(matchingConnectionCursor(null, key), null);
  assert.notEqual(connectionQueryKey('a', { kind: 'jobs', run_id: '1' }), connectionQueryKey('a', { kind: 'jobs', run_id: '2' }));
  assert.equal(connectionQueryKey('a', { kind: 'jobs', run_id: '1' }), connectionQueryKey('a', { run_id: '1', kind: 'jobs', cursor: 'ignored' }));
});

test('saved resource selection remains removable outside the current discovery page', () => {
  assert.deepEqual(selectedConnectionResources(['old', 'new', 'old'], [{ id: 'new', name: 'New repository' }]), [{ id: 'old', name: 'old', type: 'saved selection' }, { id: 'new', name: 'New repository' }]);
});

test('setup diagnostics normalize safe scope strings and arrays', () => {
  assert.deepEqual(connectionScopes('read,write read'), ['read', 'write']);
  assert.deepEqual(connectionScopes(['read', 'read', null]), ['read']);
  assert.deepEqual(connectionScopes(undefined), []);
});

test('editing rejected actions requires a certified safe outcome, not a status guess', () => {
  for (const code of ['action_not_sent', 'action_rejected', 'required_field', 'invalid_field', 'invalid_action', 'feature_disabled', 'resource_not_selected']) assert.equal(canEditRejectedConnectionAction({ code }), true);
  for (const code of ['action_uncertain', 'request_failed', 'timeout', 'approval_required', 'forbidden']) assert.equal(canEditRejectedConnectionAction({ code, status: 400 }), false);
  assert.equal(canEditRejectedConnectionAction(null), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { pageHash, parsePage } from '../src/lib/navigation.js';
import { workspaceTabStorageKey } from '../src/lib/workspace-tabs.js';
import { rememberWorkspaceReturnPage, workspaceSettingsReturnPage } from '../src/lib/workspace-settings.js';

const returnKey = id => `frondose.workspace-settings-return.v1:${id}`;
function storage(initial = []) {
  const values = new Map(initial), writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push([key, value]); values.set(key, value); } };
}
const savedTabs = (hash, tabs = []) => JSON.stringify({ version: 1, lastPageHash: hash, tabs });

test('settings return remembers a canonical scoped app page, not the whole object', () => {
  const saved = storage();
  const page = { view: 'tasks', id: 'route one', projectId: 'project & context', reviewId: 'review_1', command: 'never execute', draft: 'private draft', apiKey: 'secret', instructions: 'private personalization' };
  assert.equal(rememberWorkspaceReturnPage(saved, 'ws', page), true);
  assert.equal(saved.values.get(returnKey('ws')), '#/tasks/route%20one?review=review_1&project=project+%26+context');
  assert.deepEqual(workspaceSettingsReturnPage(saved, 'ws'), parsePage(pageHash(page.view, page.id, page)));
  for (const value of ['never execute', 'private draft', 'secret', 'private personalization', 'command', 'apiKey']) assert.equal(saved.values.get(returnKey('ws')).includes(value), false);
  assert.equal(saved.writes.length, 1);
});

test('canonical aliases and ordinary reader locations round trip', () => {
  const saved = storage();
  for (const page of [
    { view: 'today' }, { view: 'teams', id: 'area_1', section: 'people' },
    { view: 'rumbo-agent', section: 'activity' },
    { view: 'reader', id: 'document_1', returnTo: '#/projects/project_1' },
  ]) {
    assert.equal(rememberWorkspaceReturnPage(saved, 'ws', page), true);
    assert.deepEqual(workspaceSettingsReturnPage(saved, 'ws'), parsePage(pageHash(page.view, page.id, page)));
  }
});

test('settings and retired settings aliases never overwrite a prior return route', () => {
  const saved = storage();
  rememberWorkspaceReturnPage(saved, 'ws', { view: 'projects', id: 'project_1' });
  const before = saved.values.get(returnKey('ws'));
  for (const page of [{ view: 'settings' }, { view: 'settings', id: 'appearance' }, { view: 'docs', id: 'local-frondose' }, { view: 'playbooks', id: 'old_definition' }]) assert.equal(rememberWorkspaceReturnPage(saved, 'ws', page), false);
  assert.equal(saved.values.get(returnKey('ws')), before); assert.equal(saved.writes.length, 1);
});

test('malformed or overlong authored pages do not overwrite a remembered destination', () => {
  const saved = storage();
  rememberWorkspaceReturnPage(saved, 'ws', { view: 'agents' });
  const before = saved.values.get(returnKey('ws'));
  for (const page of [null, undefined, [], '#/projects', {}, { view: 'unknown' }, { view: 'tasks', id: '../escape' }, { view: 'tasks', id: 'x'.repeat(513) }, { view: 'tasks', projectId: 'x/y' }, { view: 'teams', id: 'a', section: 'invalid' }, { view: 'projects', id: '界'.repeat(512) }]) assert.equal(rememberWorkspaceReturnPage(saved, 'ws', page), false);
  assert.equal(saved.values.get(returnKey('ws')), before); assert.equal(saved.writes.length, 1);
});

test('remembered safe route takes precedence over the saved workspace app route', () => {
  const saved = storage([[returnKey('ws'), '#/agents'], [workspaceTabStorageKey('ws'), savedTabs('#/projects/project_1', [{ contentType: 'terminal', command: 'do not launch' }])]]);
  assert.deepEqual(workspaceSettingsReturnPage(saved, 'ws'), parsePage('#/agents'));
  assert.equal(saved.writes.length, 0);
});

test('missing remembered route falls back only to the saved workspace lastPageHash', () => {
  const saved = storage([[workspaceTabStorageKey('ws'), savedTabs('#/tasks?project=project_1', [{ id: 'terminal', contentType: 'terminal', command: 'ignored' }])]]);
  assert.deepEqual(workspaceSettingsReturnPage(saved, 'ws'), parsePage('#/tasks?project=project_1'));
  assert.equal(saved.writes.length, 0);
});

test('invalid remembered values cannot mask a valid last app route', () => {
  const saved = storage([[workspaceTabStorageKey('ws'), savedTabs('#/work/run_1')]]);
  for (const value of ['#/settings/profile', '#/docs/local-frondose', '#/playbooks/old', 'https://example.invalid/#/tasks', 'javascript:alert(1)', '#/unknown', '#/tasks?project=%ZZ', '#/tasks?project=a&project=b', '#/projects/a/b', '#/tasks/..', '#/tasks?command=launch', '#/overview\n', '#/' + 'a'.repeat(5000)]) {
    saved.values.set(returnKey('ws'), value);
    assert.deepEqual(workspaceSettingsReturnPage(saved, 'ws'), parsePage('#/work/run_1'), value);
  }
});

test('safe legacy remembered hashes resolve to canonical pages', () => {
  const saved = storage();
  for (const [before, canonical] of [['#/teams/area_1', '#/areas/area_1'], ['#/today', '#/overview'], ['#/runs/run_1', '#/work/run_1'], ['#/talvori-agent?section=activity', '#/frondose-agent?section=activity']]) {
    saved.values.set(returnKey('ws'), before);
    assert.deepEqual(workspaceSettingsReturnPage(saved, 'ws'), parsePage(canonical));
  }
});

test('corrupt, settings-only and overlarge saved layouts return Today without writes', () => {
  const saved = storage();
  for (const value of ['{', 'null', '[]', savedTabs('#/settings/profile'), savedTabs('#/playbooks'), savedTabs('#/unknown'), JSON.stringify({ version: 2, tabs: [], lastPageHash: '#/agents' }), JSON.stringify({ version: 1, lastPageHash: '#/agents' }), ' '.repeat(256_001)]) {
    saved.values.set(workspaceTabStorageKey('ws'), value);
    assert.deepEqual(workspaceSettingsReturnPage(saved, 'ws'), parsePage('#/overview'));
  }
  assert.equal(saved.writes.length, 0);
});

test('unavailable storage is graceful and one failed key does not hide a working layout key', () => {
  const unavailable = { getItem() { throw Error('Disabled'); }, setItem() { throw Error('Quota'); } };
  assert.equal(rememberWorkspaceReturnPage(unavailable, 'ws', { view: 'projects' }), false);
  assert.deepEqual(workspaceSettingsReturnPage(unavailable, 'ws'), parsePage('#/overview'));
  assert.deepEqual(workspaceSettingsReturnPage(null, 'ws'), parsePage('#/overview'));
  const partial = { getItem(key) { if (key === returnKey('ws')) throw Error('Unavailable preference'); return savedTabs('#/agents'); } };
  assert.deepEqual(workspaceSettingsReturnPage(partial, 'ws'), parsePage('#/agents'));
});

test('return preferences are isolated by bounded workspace identity', () => {
  const saved = storage();
  rememberWorkspaceReturnPage(saved, 'first', { view: 'projects', id: 'one' });
  rememberWorkspaceReturnPage(saved, 'second', { view: 'agents' });
  assert.deepEqual(workspaceSettingsReturnPage(saved, 'first'), parsePage('#/projects/one'));
  assert.deepEqual(workspaceSettingsReturnPage(saved, 'second'), parsePage('#/agents'));
  for (const id of [null, undefined, '', 'a/b', 'a\0b', 'a'.repeat(129)]) {
    assert.equal(rememberWorkspaceReturnPage(saved, id, { view: 'tasks' }), false);
    assert.deepEqual(workspaceSettingsReturnPage(saved, id), parsePage('#/overview'));
  }
  assert.equal(saved.writes.length, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrganization, placeSidebarItem, sortSidebarEntities } from '../src/lib/organization.js';
test('sidebar placement preserves membership and supports both directions', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(placeSidebarItem(ids, 'a', 'c'), ['b', 'c', 'a']);
  assert.deepEqual(placeSidebarItem(ids, 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(placeSidebarItem(ids, 'unknown', 'a'), ids);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});
test('personal layout validates persisted pins and entity order', () => {
  const prefs = normalizeOrganization({version: 1, pinnedLayout: ['teams', 'bogus'], entityOrder: {projects: ['p2', 'p2', '../bad', 'p1']}});
  assert.deepEqual(prefs.pinnedLayout, ['teams']);
  assert.deepEqual(prefs.entityOrder.projects, ['p2', 'p1']);
  assert.deepEqual(sortSidebarEntities([{id:'p1'}, {id:'p3'}, {id:'p2'}], prefs.entityOrder.projects).map(p=>p.id), ['p2','p1','p3']);
});

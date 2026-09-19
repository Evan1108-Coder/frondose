import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrganization } from '../src/lib/organization.js';
import { moveSidebarEntry, removeSidebarGroup } from '../src/lib/sidebar-layout.js';
test('tabs can cross built-in boundaries but only custom groups accept membership', () => {
  const layout = normalizeOrganization(null).layout;
  const next = moveSidebarEntry(layout, 'overview', 'root', 'chats', true);
  assert.equal(next.root.indexOf('overview'), next.root.indexOf('chats') + 1);
  assert.equal(moveSidebarEntry(next, 'overview', 'teams'), next);
  const custom = { root: [...next.root, 'custom:test'], groups: [{id:'custom:test',name:'Work',items:[]}] };
  const grouped = moveSidebarEntry(custom,'overview','custom:test');
  assert.deepEqual(grouped.groups[0].items,['overview']);
  assert.ok(!grouped.root.includes('overview'));
  assert.equal(moveSidebarEntry(grouped,'teams','custom:test'),grouped);
  const removed = removeSidebarGroup(grouped,'custom:test');
  assert.ok(removed.root.includes('overview'));
  assert.equal(removed.groups.length,0);
});
test('custom groups and freely placed entities survive preference normalization without duplicates', () => {
  let prefs = normalizeOrganization(null);
  prefs.layout.groups.push({id:'custom:one',name:'Focus',items:['workbench','entity:projects:p1']});
  prefs = normalizeOrganization(prefs);
  assert.ok(!prefs.layout.root.includes('workbench'));
  assert.ok(prefs.layout.root.includes('custom:one'));
  assert.deepEqual(normalizeOrganization(prefs).layout,prefs.layout);
  const moved = moveSidebarEntry(prefs.layout,'entity:projects:p1','root','overview');
  assert.equal(moved.root[0],'entity:projects:p1');
  assert.deepEqual(moved.groups[0].items,['workbench']);
});

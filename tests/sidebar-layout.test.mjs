import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrganization } from '../src/lib/organization.js';
import { moveSidebarEntry, removeSidebarGroup } from '../src/lib/sidebar-layout.js';
test('tabs can cross built-in boundaries but only custom groups accept membership', () => {
  const layout = normalizeOrganization(null).layout;
  const next = moveSidebarEntry(layout, 'focus', 'root', 'chats', true);
  assert.equal(next.root.indexOf('focus'), next.root.indexOf('chats') + 1);
  assert.equal(moveSidebarEntry(next, 'focus', 'teams'), next);
  const custom = { root: [...next.root, 'custom:test'], groups: [{id:'custom:test',name:'Work',items:[]}] };
  const grouped = moveSidebarEntry(custom,'focus','custom:test');
  assert.deepEqual(grouped.groups[0].items,['focus']);
  assert.ok(!grouped.root.includes('focus'));
  assert.equal(moveSidebarEntry(grouped,'teams','custom:test'),grouped);
  const removed = removeSidebarGroup(grouped,'custom:test');
  assert.ok(removed.root.includes('focus'));
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
  assert.deepEqual(moved.root.slice(0,3),['overview','rumbo-agent','entity:projects:p1']);
  assert.deepEqual(moved.groups[0].items,['workbench']);
});

test('saved layouts restore Frondose below Today without disturbing other rows or custom groups', () => {
  const preferences = normalizeOrganization({version:1, visibility:{'rumbo-agent':'hidden'}, layout:{
    root:['projects','custom:work','inbox','overview','rumbo-agent'],
    groups:[{id:'custom:work',name:'Work',collapsed:true,items:['workbench','rumbo-agent','overview','entity:projects:p1']}],
  }});
  assert.deepEqual(preferences.layout.root.slice(0,5),['overview','rumbo-agent','projects','custom:work','inbox']);
  assert.deepEqual(preferences.layout.groups[0],{id:'custom:work',name:'Work',collapsed:true,items:['workbench','entity:projects:p1']});
  assert.equal(preferences.visibility['rumbo-agent'],'always');
  assert.deepEqual(normalizeOrganization(JSON.parse(JSON.stringify(preferences))), preferences);
  for (const key of ['overview','rumbo-agent']) {
    assert.equal(moveSidebarEntry(preferences.layout,key,'root','inbox',true),preferences.layout);
    assert.equal(moveSidebarEntry(preferences.layout,key,'custom:work'),preferences.layout);
  }
  assert.deepEqual(moveSidebarEntry(preferences.layout,'inbox','root','overview').root.slice(0,3),['overview','rumbo-agent','inbox']);
});

test('legacy layouts missing Frondose place it at the top and leave unrelated visibility alone', () => {
  const preferences = normalizeOrganization({version:1,order:{primary:['inbox','focus','overview']},visibility:{overview:'hidden',inbox:'hidden','rumbo-agent':'activity'},layout:{root:['inbox','projects','overview'],groups:[]}});
  assert.deepEqual(preferences.layout.root.slice(0,4),['overview','rumbo-agent','inbox','projects']);
  assert.equal(preferences.visibility.overview,'hidden');
  assert.equal(preferences.visibility.inbox,'hidden');
  assert.equal(preferences.visibility['rumbo-agent'],'always');
});

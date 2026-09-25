import test from 'node:test';
import assert from 'node:assert/strict';
import { teamAppearance } from '../src/lib/team-appearance.js';
import { ICON_REACTIONS } from '../src/lib/reaction-catalog.js';
import { normalizeDisplayPreferences } from '../src/lib/display-preferences.js';
import { createChatFollower, nearChatBottom } from '../src/lib/chat-scroll.js';
import { groupColorDefaults, resolveNavColors, resolveTeamColor, normalizeTabColors, pageTeam } from '../src/lib/icon-colors.js';
import { resolveEmptyIconColor } from '../src/lib/icon-colors.js';

test('empty illustrations are neutral unless a global color or Area override is explicitly chosen', () => {
  const area = { color: '#00ffff', empty_icon_color: 'team' };
  assert.equal(resolveEmptyIconColor(normalizeDisplayPreferences(), area), 'var(--text)');
  assert.equal(resolveEmptyIconColor({ emptyIconColor: '#aabbcc' }, area), '#aabbcc');
  assert.equal(resolveEmptyIconColor({ emptyIconFollowArea: true }, area), '#00ffff');
  assert.equal(normalizeDisplayPreferences({ emptyIconFollowArea: 'true' }).emptyIconFollowArea, false);
});

test('team identity accepts every bundled line icon but never emoji or arbitrary markup', () => {
  for (const { id } of ICON_REACTIONS) assert.equal(teamAppearance({ icon: id }).icon, id);
  for (const icon of ['users', '😀', 'custom:test', 'emoji:smile', '<svg onload=alert(1)>', undefined]) assert.equal(teamAppearance({ icon }).icon, 'icon:users');
  assert.deepEqual(teamAppearance({ icon: 'icon:rocket', color: '#FF0000', icon_color: '#00FF00' }), { icon: 'icon:rocket', color: '#ff0000', icon_color: '#00ff00', tab_icon_color: 'team', empty_icon_color: 'team', tab_label_color: 'global' });
  assert.equal(teamAppearance({ color: 'url(x)', icon_color: 'red' }).icon_color, '');
});
test('display defaults enable smooth following and sanitize personal icon colors', () => {
  const defaults = { emptyIconFollowArea: false, emptyTextColor: '', emptyIconColor: '', tabIconColor: '', tabLabelColor: 'neutral', tabColors: {}, smoothChatScroll: true };
  assert.deepEqual(normalizeDisplayPreferences(), defaults);
  assert.deepEqual(normalizeDisplayPreferences({ emptyIconColor: '#AABBCC', smoothChatScroll: false }), { ...defaults, emptyIconColor: '#aabbcc', smoothChatScroll: false });
  assert.deepEqual(normalizeDisplayPreferences({ emptyIconColor: 'url(x)', smoothChatScroll: 'false' }), defaults);
});

test('empty-state copy stays neutral for legacy colors and supports independent explicit customization', () => {
  const legacy = normalizeDisplayPreferences({ emptyIconColor: '#00ffff' });
  assert.equal(legacy.emptyTextColor, '');
  assert.equal(normalizeDisplayPreferences({ ...legacy, emptyTextColor: '#AABBCC' }).emptyTextColor, '#aabbcc');
  for (const emptyTextColor of ['', 'team', 'url(x)', null]) {
    const settings = normalizeDisplayPreferences({ ...legacy, emptyTextColor });
    assert.equal(settings.emptyTextColor, '');
    assert.equal(settings.emptyIconColor, '#00ffff');
  }
});

test('tab color precedence is explicit, live and independent from label policy', () => {
  const global = { tabIconColor: '#112233', tabLabelColor: 'neutral' };
  const team = { color: '#aabbcc', tab_icon_color: 'team', tab_label_color: 'icon' };
  assert.deepEqual(resolveNavColors(global), { icon: '#112233', label: '' });
  assert.deepEqual(resolveNavColors(global, team), { icon: '#aabbcc', label: '#aabbcc' });
  assert.deepEqual(resolveNavColors(global, team, { icon: '#ff0000' }), { icon: '#ff0000', label: '#ff0000' });
  assert.deepEqual(resolveNavColors(global, team, { icon: 'global', label: '#00ff00' }), { icon: '#112233', label: '#00ff00' });
  assert.deepEqual(resolveNavColors({ ...global, tabIconColor: '#445566' }, team, { icon: 'global', label: 'global' }), { icon: '#445566', label: '' });
  assert.equal(resolveNavColors(global, { ...team, tab_label_color: 'neutral' }).label, '');
  assert.equal(resolveNavColors(global, { ...team, tab_icon_color: 'global' }).icon, '#112233');
  assert.equal(resolveNavColors(global, { color: '#8b95a5' }).icon, '#112233');
  assert.equal(resolveNavColors(global, { color: '#8b95a5', tab_icon_color: 'team' }).icon, '#8b95a5');
});
test('empty-state color and team page scope are independent from navigation', () => {
  const team = { id: 't', color: '#aabbcc', empty_icon_color: 'global' };
  assert.equal(resolveTeamColor(team, 'empty_icon_color', '#123456'), '#123456');
  assert.equal(resolveTeamColor({ ...team, empty_icon_color: 'team' }, 'empty_icon_color', '#123456'), '#aabbcc');
  const data = { settings: { theme: 'dark' }, teams: [team], projects: [{ id: 'p', team_id: 't' }], chats: [{ id: 'c', project_id: 'p' }] };
  for (const page of [{ view: 'teams', id: 't' }, { view: 'projects', id: 'p' }, { view: 'chats', id: 'c' }, { view: 'tasks', projectId: 'p' }, { view: 'settings', id: 'team:t' }]) assert.equal(pageTeam(page, data), team);
  assert.equal(pageTeam({ view: 'overview' }, data), undefined);
  assert.equal(pageTeam({ view: 'settings', id: 'appearance' }, data), undefined);
});
test('personal tab colors validate every value and keep workspace identities separate', () => {
  const input = JSON.parse('{"__proto__":{"icon":"#ffffff"},"w1/main:overview":{"icon":"#AABBCC","label":"icon"},"w2/main:overview":{"icon":"url(x)","label":"red"}}');
  const output = normalizeTabColors(input);
  assert.equal(Object.hasOwn(output, '__proto__'), false);
  assert.deepEqual(output['w1/main:overview'], { icon: '#aabbcc', label: 'icon' });
  assert.deepEqual(output['w2/main:overview'], { icon: 'inherit', label: 'inherit' });
});
test('custom-group defaults cascade, but explicit tab choices win', () => {
  const global = { tabIconColor: '#112233', tabLabelColor: 'neutral' };
  const group = groupColorDefaults({ icon: '#ff0000', label: 'icon' });
  assert.deepEqual(resolveNavColors(global, group), { icon: '#ff0000', label: '#ff0000' });
  assert.deepEqual(resolveNavColors(global, group, { icon: 'global', label: 'neutral' }), { icon: '#112233', label: '' });
  assert.deepEqual(resolveNavColors(global, groupColorDefaults()), resolveNavColors(global));
});

function harness(enabled = true) {
  let id = 0; const callbacks = new Map(), changes = [];
  const element = { scrollTop: 0, scrollHeight: 1200, clientHeight: 400 };
  const follower = createChatFollower(element, { smooth: () => enabled, onChange: value => changes.push(value), frame: fn => { callbacks.set(++id, fn); return id; }, cancelFrame: key => callbacks.delete(key) });
  const tick = time => { const queued = [...callbacks.values()]; callbacks.clear(); queued.forEach(fn => fn(time)); };
  return { element, follower, callbacks, changes, tick };
}
test('chat follows with easing, tracks growing content, and never queues competing animations', () => {
  const h = harness(); h.follower.toBottom(); h.follower.contentChanged(); assert.equal(h.callbacks.size, 1);
  h.tick(0); h.tick(160); assert.ok(h.element.scrollTop > 400 && h.element.scrollTop < 800);
  h.element.scrollHeight = 1600; h.follower.contentChanged(); assert.equal(h.callbacks.size, 1);
  h.tick(320); assert.equal(h.element.scrollTop, 1200); assert.equal(h.callbacks.size, 0);
});
test('scrolling up cancels follow; new content cannot pull readers away; Latest resumes', () => {
  const h = harness(); h.follower.toBottom(); h.tick(0); h.follower.pause(); assert.equal(h.callbacks.size, 0);
  h.element.scrollTop = 200; h.follower.onScroll(); h.follower.contentChanged(); assert.equal(h.callbacks.size, 0);
  assert.equal(h.changes.at(-1), false); h.follower.resume(); h.tick(0); h.tick(320); assert.equal(h.element.scrollTop, 800);
  h.follower.toBottom(); h.follower.dispose(); assert.equal(h.callbacks.size, 0); h.follower.contentChanged(); assert.equal(h.callbacks.size, 0);
});
test('disabled or reduced-motion following is immediate and near-bottom tolerance is bounded', () => {
  const h = harness(false); h.follower.toBottom(); assert.equal(h.element.scrollTop, h.element.scrollHeight); assert.equal(h.callbacks.size, 0);
  assert.equal(nearChatBottom({ scrollTop: 750, scrollHeight: 1200, clientHeight: 400 }), true);
  assert.equal(nearChatBottom({ scrollTop: 650, scrollHeight: 1200, clientHeight: 400 }), false);
});

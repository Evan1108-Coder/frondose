import test from 'node:test';
import assert from 'node:assert/strict';
import { teamAppearance } from '../src/lib/team-appearance.js';
import { ICON_REACTIONS } from '../src/lib/reaction-catalog.js';
import { normalizeDisplayPreferences } from '../src/lib/display-preferences.js';
import { createChatFollower, nearChatBottom } from '../src/lib/chat-scroll.js';

test('team identity accepts every bundled line icon but never emoji or arbitrary markup', () => {
  for (const { id } of ICON_REACTIONS) assert.equal(teamAppearance({ icon: id }).icon, id);
  for (const icon of ['users', '😀', 'custom:test', 'emoji:smile', '<svg onload=alert(1)>', undefined]) assert.equal(teamAppearance({ icon }).icon, 'icon:users');
  assert.deepEqual(teamAppearance({ icon: 'icon:rocket', color: '#FF0000', icon_color: '#00FF00' }), { icon: 'icon:rocket', color: '#ff0000', icon_color: '#00ff00' });
  assert.equal(teamAppearance({ color: 'url(x)', icon_color: 'red' }).icon_color, '');
});
test('display defaults enable smooth following and sanitize personal icon colors', () => {
  assert.deepEqual(normalizeDisplayPreferences(), { emptyIconColor: '', smoothChatScroll: true });
  assert.deepEqual(normalizeDisplayPreferences({ emptyIconColor: '#AABBCC', smoothChatScroll: false }), { emptyIconColor: '#aabbcc', smoothChatScroll: false });
  assert.deepEqual(normalizeDisplayPreferences({ emptyIconColor: 'url(x)', smoothChatScroll: 'false' }), { emptyIconColor: '', smoothChatScroll: true });
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

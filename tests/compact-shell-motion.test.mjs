import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { nextSlidingTab } from '../src/lib/sliding-tabs.js';
import { dialogRevealFrame, dialogMotionDuration, DIALOG_REVEALED_FRAME } from '../src/lib/dialog-motion.js';
import { motionPreference } from '../src/lib/motion.js';
import { SIDEBAR_DEFAULT_WIDTH, normalizeSidebarSize, clampSidebarWidth } from '../src/lib/sidebar-size.js';

test('compact default does not rewrite a saved explicit sidebar width or hidden state', () => {
  assert.equal(SIDEBAR_DEFAULT_WIDTH, 240);
  assert.deepEqual(normalizeSidebarSize(null), { width: null, hidden: false });
  assert.deepEqual(normalizeSidebarSize({ width: 350, hidden: true }), { width: 350, hidden: true });
  assert.equal(clampSidebarWidth('invalid', 1440), 240);
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const sidebar = readFileSync(new URL('../src/components/sidebar-v2.css', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/views/settings/settings-center.css', import.meta.url), 'utf8');
  assert.match(app, /sidebarSize\.width \?\? clampSidebarWidth\(SIDEBAR_DEFAULT_WIDTH/);
  assert.match(sidebar, /--sidebar-expanded: 240px/);
  assert.match(settings, /--sidebar: var\(--sidebar-expanded, 240px\)/);
  assert.doesNotMatch(sidebar, /--sidebar: (280|292|258)px/);
});

test('single choice filters have wrapped arrow selection, disabled skipping and RTL direction', () => {
  const options = [{ value: 'all' }, { value: 'api' }, { value: 'oauth', disabled: true }, { value: 'local' }];
  assert.equal(nextSlidingTab(options, 'all', 'ArrowRight'), 'api');
  assert.equal(nextSlidingTab(options, 'api', 'ArrowRight'), 'local');
  assert.equal(nextSlidingTab(options, 'local', 'ArrowRight'), 'all');
  assert.equal(nextSlidingTab(options, 'all', 'ArrowLeft'), 'local');
  assert.equal(nextSlidingTab(options, 'all', 'ArrowLeft', 'rtl'), 'api');
  assert.equal(nextSlidingTab(options, 'api', 'Home'), 'all');
  assert.equal(nextSlidingTab(options, 'api', 'End'), 'local');
  assert.equal(nextSlidingTab(options, 'api', 'Enter'), null);
  assert.equal(nextSlidingTab([{ value: 'none', disabled: true }], 'none', 'Home'), null);
});

test('dialog expansion clips actual-size content and bounds off-panel trigger travel', () => {
  const panel = { left: 300, top: 100, width: 800, height: 600 };
  const from = dialogRevealFrame(panel, { left: 10, top: 5, width: 32, height: 32 });
  assert.match(from.clipPath, /^inset\(/);
  assert.equal(from.transform, 'translate(-96px, -96px)');
  assert.doesNotMatch(JSON.stringify(from), /scale|width|height/);
  assert.equal(from.opacity, 0);
  assert.equal(DIALOG_REVEALED_FRAME.opacity, 1);
  assert.equal(dialogRevealFrame(panel, null).transform, 'translate(0px, 0px)');
  for (const small of [{ width: 0, height: 0 }, { width: 20, height: 16 }]) assert.doesNotMatch(JSON.stringify(dialogRevealFrame({ left: 0, top: 0, ...small }, null)), /NaN|Infinity|inset\(-/);
});

test('dialog movement has a faster exit, reduced motion fades only and keyboard is immediate', () => {
  assert.equal(dialogMotionDuration(motionPreference()), 240);
  assert.equal(dialogMotionDuration(motionPreference(), true), 160);
  assert.equal(dialogMotionDuration(motionPreference({ reduced: true })), 80);
  assert.equal(dialogMotionDuration(motionPreference({ keyboard: true })), 0);
  const ui = readFileSync(new URL('../src/ui.jsx', import.meta.url), 'utf8');
  assert.match(ui, /closingRef\.current \|\| closeDisabled/);
  assert.match(ui, /animationRef\.current\?\.cancel\(\)/);
  assert.match(ui, /setClosing\(false\)/);
  assert.match(ui, /registerDialog\(ref\.current\)/);
  assert.match(ui, /\[data-rumbo-popup\]/);
  assert.match(ui, /attributeFilter: \['data-motion', 'data-input-modality'\]/);
});

test('extension footer dismissals use the shared exit while retaining explicit continuations and guards', () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const ui = read('src/ui.jsx'), release = read('src/components/ReleaseReader.jsx'), editor = read('src/components/AgentEditor.jsx'), chats = read('src/views/Chats.jsx');
  assert.match(ui, /typeof children === 'function' \? children\(requestClose\)/);
  assert.match(ui, /pendingCloseRef\.current = finishClose/);
  assert.match(ui, /const finish = pendingCloseRef\.current;[\s\S]*?pendingCloseRef\.current = null;[\s\S]*?finish\?\.\(\)/);
  assert.match(release, /closeDialog\(\)\}>Back to work/);
  assert.match(release, /closeDialog\(onOpenDocs\)/);
  assert.match(editor, /closeDialog\(close\)\}>Discard changes/);
  assert.match(editor, /closeDialog\(\)\}>Cancel/);
  assert.match(chats, /closeDialog\(\)\}>Keep this conversation/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { motionPreference } from '../src/lib/motion.js';
import { popupMotionDuration, popupMotionFrames, popupCompletionIsCurrent, settlePopupMotion, popupTriggerNextOpen, POPUP_OPEN_FRAME, POPUP_HIDDEN_FRAME } from '../src/lib/popup-motion.js';
import { DIALOG_EXIT_LIMITS } from '../src/lib/dialog-exit.js';

test('popup movement is visible, exit is shorter and keyboard/reduced policies stay immediate/gentle', () => {
  assert.equal(popupMotionDuration(motionPreference()), 220);
  assert.equal(popupMotionDuration(motionPreference(), true), 140);
  assert.equal(popupMotionDuration(motionPreference({ reduced: true })), 80);
  assert.equal(popupMotionDuration(motionPreference({ keyboard: true })), 0);
  assert.deepEqual(popupMotionFrames(motionPreference(), true), [POPUP_HIDDEN_FRAME, POPUP_OPEN_FRAME]);
  assert.deepEqual(popupMotionFrames(motionPreference({ reduced: true }), false), [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'none' }]);
});

test('popup reversal starts from its interrupted frame and stale exits cannot remove a reopened panel', () => {
  const interrupted = { opacity: '.6', transform: 'matrix(.98, 0, 0, .98, 0, 2)' };
  assert.equal(popupMotionFrames(motionPreference(), true, interrupted)[0], interrupted);
  assert.equal(popupCompletionIsCurrent(2, 3, false), false);
  assert.equal(popupCompletionIsCurrent(3, 3, true), false);
  assert.equal(popupCompletionIsCurrent(3, 3, false), true);
});

test('closing keeps its invisible final frame when the filled animation is cancelled', () => {
  const node = { style: {} };
  for (const policy of [motionPreference(), motionPreference({ reduced: true }), motionPreference({ keyboard: true })]) {
    settlePopupMotion(node, policy, false);
    assert.equal(node.style.opacity, '0');
    assert.equal(node.style.transform, policy.movement ? POPUP_HIDDEN_FRAME.transform : 'none');
    settlePopupMotion(node, policy, true);
    assert.equal(node.style.opacity, '1');
  }
  const hook = readFileSync(new URL('../src/components/usePopupMotion.js', import.meta.url), 'utf8');
  const finish = hook.slice(hook.indexOf('const finish ='), hook.indexOf('if (!duration'));
  assert(finish.indexOf('settlePopupMotion(') < finish.indexOf('animation.current?.cancel()'), 'persist the final frame before cancelling the fill');
});

test('a second pointer activation closes Help even if focus moved before click', () => {
  assert.equal(popupTriggerNextOpen(true, true), false);
  assert.equal(popupTriggerNextOpen(false, true), false, 'blur already closed it; click must not reopen');
  assert.equal(popupTriggerNextOpen(false, false), true);
  assert.equal(popupTriggerNextOpen(true, null), false, 'keyboard activation toggles current state');
  assert.equal(popupTriggerNextOpen(false, null), true);
  const help = readFileSync(new URL('../src/components/HelpMenu.jsx', import.meta.url), 'utf8');
  assert.match(help, /onPointerDown=.*pointerDownOpen.current = open/);
  assert.match(help, /popupTriggerNextOpen\(open, pointerDownOpen.current\)/);
  assert.match(help, /onPointerCancel=.*pointerDownOpen.current = null/);
});

test('presence retains only inaccessible visuals and has bounded fallback/unmount/preference cleanup', () => {
  const source = readFileSync(new URL('../src/components/usePopupMotion.js', import.meta.url), 'utf8');
  assert.match(source, /const present = open \|\| retained/);
  assert.match(source, /'aria-hidden': !open/);
  assert.match(source, /inert: !open/);
  assert.match(source, /duration \+ 64/);
  assert.match(source, /effect\.finished\.then\(finish/);
  assert.match(source, /interruptedFrame\.current = \{ opacity: current\.opacity, transform: current\.transform \}/);
  assert.match(source, /attributeFilter: \['data-motion', 'data-input-modality'\]/);
  assert.match(source, /document\.removeEventListener\('visibilitychange', snap\)/);
});

test('shared panels retain exit presence without delaying selection or navigation callbacks', () => {
  for (const file of ['SelectField', 'DateField', 'Tooltip', 'EditorProperty', 'ProjectLeadPicker', 'HelpMenu']) {
    const source = readFileSync(new URL(`../src/components/${file}.jsx`, import.meta.url), 'utf8');
    assert.doesNotThrow(() => transformSync(source, { loader: 'jsx', format: 'esm' }));
    assert.match(source, /usePopupMotion\(/);
    assert.match(source, /popup\.present/);
    assert.match(source, /\.\.\.popup\.motionProps/);
  }
  const help = readFileSync(new URL('../src/components/HelpMenu.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(help, /setTimeout|closeTimer/);
});

test('dialog exit snapshots have hard resource bounds and exclude active/network/control identities', () => {
  assert.ok(DIALOG_EXIT_LIMITS.count <= 3);
  assert.ok(DIALOG_EXIT_LIMITS.nodes <= 800);
  assert.ok(DIALOG_EXIT_LIMITS.lifetimeMs <= 260);
  const source = readFileSync(new URL('../src/lib/dialog-exit.js', import.meta.url), 'utf8');
  for (const tag of ['IFRAME', 'WEBVIEW', 'SCRIPT', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'IMG', 'META', 'BASE']) assert.ok(source.includes(`'${tag}'`));
  assert.match(source, /srcdoc\|srcset\|href\|xlink:href/);
  assert.match(source, /\.xterm, \.monaco-editor, \.cm-editor/);
  assert.match(source, /backdrop\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(source, /backdrop\.setAttribute\('inert', ''\)/);
  assert.match(source, /panel\.isConnected \|\|/);
  assert.match(source, /while \(ghosts\.size >= DIALOG_EXIT_LIMITS\.count\)/);
  assert.match(source, /Math\.min\(DIALOG_EXIT_LIMITS\.lifetimeMs, duration \+ 64\)/);
});

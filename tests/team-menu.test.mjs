import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('tooltips escape masked scroll containers and keep trigger accessibility', () => {
  const tooltip = source('components/Tooltip.jsx');
  assert.match(tooltip, /popup.present \? createPortal\(<span \{\.\.\.popup.motionProps\} ref=\{panel\} role="tooltip"[\s\S]*document\.body\)/);
  assert.match(tooltip, /usePopupMotion\(visible, panel, \{ ready: Boolean\(position\) \}\)/);
  assert.match(tooltip, /portal: true/);
  assert.match(tooltip, /"aria-describedby"/);
  assert.match(tooltip, /visible \? id : null/);
  assert.match(tooltip, /!anchor\.current\.closest\('\[inert\]'\)/);
  assert.match(tooltip, /onClick:.*props\.onClick\?\.\(event\); hide\(\)/);
  const motion = source('components/usePopupMotion.js');
  assert.match(motion, /'aria-hidden': !open/);
  assert.match(motion, /inert: !open/);
});

test('body portal positioning skips transformed trigger ancestors but leaves inline popups unchanged', () => {
  const popup = source('components/usePopupPosition.js');
  assert.match(popup, /portal = false/);
  assert.match(popup, /parent = portal \? null : anchor\.current\.parentElement/);
  assert.match(popup, /\[open, anchor, width, height, portal\]/);
  assert.match(popup, /visualViewport/);
});

test('team options open that team settings and expose dialog state', () => {
  const shell = source('components/Shell.jsx');
  assert.match(shell, /aria-haspopup="dialog" aria-expanded=\{itemOptions\?\.view === view && itemOptions\.id === item\.id\}/);
  assert.match(shell, /itemOptions\.view === 'teams' \? <Button icon=\{Settings\}[\s\S]*go\('settings', `team:\$\{teamId\}`\); \}\}>Area settings/);
  assert.match(shell, /Hide from sidebar/);
  assert.match(shell, /Remove from favorites/);
});

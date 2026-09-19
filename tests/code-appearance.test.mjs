import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE_DEFAULTS, normalizeCodeAppearance, diffRows, splitDiffRows } from '../src/lib/code-appearance.js';

test('code preferences validate persisted input and constrain readable sizes', () => {
  assert.deepEqual(normalizeCodeAppearance(null), CODE_DEFAULTS);
  assert.deepEqual(normalizeCodeAppearance('bad'), CODE_DEFAULTS);
  const preferences = normalizeCodeAppearance({ theme: 'unsafe', font: 'url(x)', fontSize: 90, lineHeight: 0, tabSize: 30, wrap: 'true', syntax: false, diffLayout: 'split' });
  assert.equal(preferences.theme, 'app');
  assert.equal(preferences.font, 'system');
  assert.equal(preferences.fontSize, 24);
  assert.equal(preferences.lineHeight, 1.2);
  assert.equal(preferences.tabSize, 8);
  assert.equal(preferences.wrap, false);
  assert.equal(preferences.syntax, false);
  assert.equal(preferences.diffLayout, 'split');
});

test('diff line numbers track source and destination hunks separately', () => {
  const rows = diffRows('--- a/file\n+++ b/file\n@@ -10,2 +20,3 @@\n-old\n+new\n+extra\n stable');
  assert.equal(rows[0].type, 'meta');
  assert.equal(rows[3].oldLine, 10);
  assert.equal(rows[4].newLine, 20);
  assert.equal(rows[5].newLine, 21);
  assert.equal(rows[6].oldLine, 11);
  assert.equal(rows[6].newLine, 22);
  const split = splitDiffRows(rows);
  assert.equal(split[3].left.text, '-old');
  assert.equal(split[3].right.text, '+new');
  assert.equal(split[4].left, undefined);
  assert.equal(split[4].right.text, '+extra');
});

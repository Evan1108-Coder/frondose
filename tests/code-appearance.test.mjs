import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE_DEFAULTS, normalizeCodeAppearance, diffRows, splitDiffRows } from '../src/lib/code-appearance.js';
import { CODE_THEMES, codeThemeStyle, filterCodeChoices } from '../src/lib/code-themes.js';
import { CODE_FONTS, BUNDLED_CODE_FONTS, codeFontFamily } from '../src/lib/code-fonts.js';
import { readFileSync, existsSync } from 'node:fs';

test('all code palettes and bundled fonts are selectable without invalidating legacy settings', () => {
  assert.equal(CODE_THEMES.length, 68);
  assert.equal(BUNDLED_CODE_FONTS.length, 20);
  assert.equal(new Set(CODE_THEMES.map(t => t.id)).size, CODE_THEMES.length);
  for (const item of CODE_THEMES) assert.equal(normalizeCodeAppearance({ theme: item.id }).theme, item.id);
  for (const item of CODE_FONTS) { assert.equal(normalizeCodeAppearance({ font: item.id }).font, item.id); assert.match(codeFontFamily(item.id), /monospace/); }
  for (const theme of ['app', 'dark', 'light', 'contrast']) for (const font of ['system', 'Menlo', 'Monaco', 'Consolas']) assert.deepEqual(normalizeCodeAppearance({ theme, font }), { ...CODE_DEFAULTS, theme, font });
  assert.deepEqual(codeThemeStyle('untrusted'), {});
  assert.equal(codeFontFamily('untrusted'), codeFontFamily('system'));
});

test('theme colors have readable contrast and no unsafe CSS values', () => {
  const light = color => { const hex = color.slice(1); return (hex.length === 3 ? [...hex].map(c => c + c).join('') : hex).match(/../g).map(c => parseInt(c, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0); };
  for (const theme of CODE_THEMES.filter(t => t.colors)) {
    assert.equal(Object.keys(codeThemeStyle(theme.id)).length, 6);
    for (const color of Object.values(theme.colors)) assert.match(color, /^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i);
    const bg = light(theme.colors.bg);
    for (const key of ['fg', 'comment', 'keyword', 'string', 'number']) { const fg = light(theme.colors[key]); assert.ok((Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05) >= 4.5, `${theme.id} ${key}`); }
  }
});

test('catalog searches and appearance filters preserve deterministic options', () => {
  assert.equal(filterCodeChoices(CODE_THEMES, 'GITHUB', 'light').length, 3);
  assert.equal(filterCodeChoices(CODE_THEMES, 'dracula', 'light').length, 0);
  assert.equal(filterCodeChoices(CODE_FONTS, 'jetbrains')[0].id, 'jetbrains-mono');
  assert.equal(filterCodeChoices(CODE_THEMES, 'not-a-theme').length, 0);
});

test('every bundled font has local regular Latin files, CSS and license attribution', () => {
  const css = readFileSync(new URL('../src/components/code-fonts.css', import.meta.url), 'utf8');
  const notices = readFileSync(new URL('../public/licenses/code-fonts.txt', import.meta.url), 'utf8');
  for (const font of BUNDLED_CODE_FONTS) {
    assert.ok(css.includes(`@fontsource/${font.id}/latin-400.css`));
    assert.ok(existsSync(new URL(`../node_modules/@fontsource/${font.id}/files/${font.id}-latin-400-normal.woff2`, import.meta.url)));
    assert.ok(notices.includes(`https://fontsource.org/fonts/${font.id}`));
  }
  const licenses = readFileSync(new URL('../public/licenses/code-themes.txt', import.meta.url), 'utf8');
  for (const theme of CODE_THEMES.filter(t => t.colors)) assert.ok(licenses.includes(`${theme.id}.json`), theme.id);
});

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

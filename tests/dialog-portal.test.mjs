import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../src/ui.jsx', import.meta.url), 'utf8');
const dialog = source.slice(source.indexOf('export function Dialog('), source.indexOf('export function Toggle('));

test('shared dialogs portal their viewport overlay outside masked scrolling ancestors', () => {
  assert.doesNotThrow(() => transformSync(source, { loader: 'jsx', format: 'esm' }));
  assert.match(source, /import \{ createPortal \} from "react-dom"/);
  assert.match(dialog, /createPortal\(dialog, document.body\)/);
  assert.match(dialog, /<span hidden aria-hidden="true" ref=\{originRef\} data-dialog-origin="" \/>/);
  assert.match(dialog, /typeof document === 'undefined' \? dialog/);
  assert.match(dialog, /registerDialog\(ref.current\)/);
  assert.match(dialog, /document.addEventListener\("focusin", containFocus\)/);
  assert.match(dialog, /previous\?\.isConnected/);
});

test('dialog portals preserve scoped empty-state colors without copying scroll masks or theme tokens', () => {
  assert.match(dialog, /useLayoutEffect\(\(\) =>/);
  assert.match(dialog, /getComputedStyle\(origin\)/);
  assert.match(dialog, /\['--empty-icon-color', '--empty-copy-color'\]/);
  assert.match(dialog, /backdrop.style.setProperty\(property, value\)/);
  assert.match(dialog, /backdrop.style.removeProperty\(property\)/);
  assert.doesNotMatch(dialog, /--scroll-fade|maskImage|inherited\.cssText/);
});

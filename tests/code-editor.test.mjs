import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { codeLanguage, loadCodeLanguage, sourceReplacement } from '../src/lib/code-editor.js';
import { editorObservationKey, normalizeEditorChanges, observeEditorContent, observedContentDiff, recentEditorObservation } from '../src/lib/editor-changes.js';

test('source syntax detection supports common editable languages with honest plain-text fallback', async () => {
  for (const [path, id] of [['src/main.tsx', 'javascript'], ['a.JSON', 'json'], ['styles.css', 'css'], ['index.html', 'html'], ['README.md', 'markdown'], ['a.py', 'python'], ['q.sql', 'sql'], ['a.unknown', 'plain']]) {
    const descriptor = codeLanguage(path); assert.equal(descriptor.id, id); assert.ok(await loadCodeLanguage(descriptor));
  }
  assert.deepEqual(codeLanguage('C:\\work\\view.tsx'), { id: 'javascript', typescript: true, jsx: true });
});
test('external source transactions are minimal and preserve Unicode text exactly', () => {
  for (const [before, after] of [['abc', 'aBc'], ['a😀z', 'a😀中z'], ['', 'new'], ['same', 'same'], ['12345', '']]) {
    const change = sourceReplacement(before, after);
    assert.equal(before.slice(0, change.from) + change.insert + before.slice(change.to), after);
  }
  assert.deepEqual(sourceReplacement('prefix OLD tail', 'prefix NEW tail'), { from: 7, to: 10, insert: 'NEW' });
});
test('Recent preference defaults to ten minutes and rejects invalid/unbounded values', () => {
  assert.deepEqual(normalizeEditorChanges(), { recentMinutes: 10 });
  assert.equal(normalizeEditorChanges({ recentMinutes: -1 }).recentMinutes, 1);
  assert.equal(normalizeEditorChanges({ recentMinutes: 999999 }).recentMinutes, 1440);
  assert.equal(normalizeEditorChanges({ recentMinutes: '30' }).recentMinutes, 30);
});
test('Recent does not fabricate edits from before tracking and is scope isolated', () => {
  const key = editorObservationKey('fixture', 'root1', 'file1'), now = 9000000;
  assert.equal(recentEditorObservation(key, 'disk', 10, now), null);
  observeEditorContent(key, 'disk', now);
  const result = recentEditorObservation(key, 'disk', 10, now + 1000);
  assert.equal(result.partial, true); assert.equal(result.changed, false); assert.equal(result.began, now);
  assert.equal(recentEditorObservation(editorObservationKey('fixture', 'root2', 'file1'), 'disk', 10, now), null);
});
test('Recent coalesces rapid typing without losing the observed baseline', () => {
  const key = editorObservationKey('typing', 'root1', 'file1'), now = 10000000;
  observeEditorContent(key, 'baseline', now);
  for (let index = 1; index < 100; index++) observeEditorContent(key, `edit${index}`, now + index * 10);
  const result = recentEditorObservation(key, 'edit99', 10, now + 2000);
  assert.equal(result.before, 'baseline'); assert.equal(result.after, 'edit99'); assert.equal(result.changed, true);
});
test('Recent limits memory and observes an interval baseline rather than all-session changes', () => {
  const key = editorObservationKey('interval', 'root1', 'file1'), now = 12000000;
  observeEditorContent(key, 'original', now); observeEditorContent(key, 'past edit', now + 600000); observeEditorContent(key, 'current', now + 1200000);
  const result = recentEditorObservation(key, 'current', 10, now + 1200100);
  assert.equal(result.before, 'past edit'); assert.equal(result.partial, false);
  assert.equal(observeEditorContent('too-large', 'x'.repeat(2 * 1024 * 1024 + 1)), false);
  for (let index = 0; index < 13; index++) observeEditorContent(`bounded:${index}`, 'content', now);
  assert.equal(recentEditorObservation('bounded:0', 'content', 10, now), null);
});
test('single-hunk Recent diff keeps exact content and bounded preview with line metadata', () => {
  assert.equal(observedContentDiff('same', 'same').content, '');
  const result = observedContentDiff('one\nold\nlast', 'one\nnew\nlast');
  assert.match(result.content, /^@@ -1,3 \+1,3 @@/); assert.match(result.content, /-old\n\+new/); assert.equal(result.limited, false);
  const large = observedContentDiff('a\n'.repeat(4000), 'b\n'.repeat(4000), 20);
  assert.equal(large.limited, true); assert.equal(large.content.split('\n').length, 21);
});
test('editor uses one native CodeMirror view, shared appearance, read-only guards and no focus perimeter', () => {
  const source = readFileSync(new URL('../src/components/workspace/SourceCodeEditor.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/components/workspace/source-code-editor.css', import.meta.url), 'utf8');
  assert.equal((source.match(/new EditorView\(/g) || []).length, 1);
  for (const token of ['useCodeAppearance()', 'lineNumbers()', 'syntaxHighlighting(palette)', 'EditorState.readOnly.of(readOnly)', 'EditorView.editable.of(!readOnly)', 'sourceReplacement(previous, value)', 'current.destroy()']) assert.ok(source.includes(token), token);
  assert.match(source, /if \(update\.docChanged && !syncing\.current\)/);
  assert.match(source, /stopImmediatePropagation\(\)/); assert.doesNotMatch(source, /dragstart\(event\).*return true/);
  assert.match(css, /\.cm-content:focus-visible \{ outline:none!important/);
  assert.match(css, /\.cm-panel :is\(button,input\):focus-visible \{ outline:2px/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { clampSplitRatio, collectLayoutLeafIdsInOrder, equalizeLayout, firstLayoutLeafId, insertLeafBeside, layoutContainsLeafId, normalizeTerminalLayout, removeLayoutLeaf, updateLayoutRatio } from '../src/lib/terminal-splits.js';

const leaf = leafId => ({ type: 'leaf', leafId });

test('Orca-derived terminal tree preserves source attribution and pinned source hash', async () => {
  const source = await readFile(new URL('../src/lib/terminal-splits.js', import.meta.url), 'utf8');
  assert.match(source, /Copyright \(c\) 2026 Lovecast Inc., MIT/);
  assert.match(source, /51dcef8258230ffea85a907130450b0ad676e22b/);
  assert.match(source, /85af57a3f1b783822b146e586ded6c63a6d83b30f4db9ca8927ddd2cbd0e8eb1/);
});

test('insert terminal panes beside any selected leaf with the requested orientation', () => {
  for (const [side, direction, ids] of [['right', 'vertical', ['a', 'b']], ['left', 'vertical', ['b', 'a']], ['bottom', 'horizontal', ['a', 'b']], ['top', 'horizontal', ['b', 'a']]]) {
    const original = leaf('a'), result = insertLeafBeside(original, 'a', 'b', side);
    assert.equal(result.direction, direction); assert.deepEqual(collectLayoutLeafIdsInOrder(result), ids);
    assert.deepEqual(original, leaf('a'));
  }
  const nested = insertLeafBeside(insertLeafBeside(leaf('a'), 'a', 'b', 'right'), 'b', 'c', 'bottom');
  assert.deepEqual(collectLayoutLeafIdsInOrder(nested), ['a', 'b', 'c']);
  assert.equal(nested.second.direction, 'horizontal');
});

test('invalid split sides and identities fail, while duplicate/missing targets do not duplicate sessions', () => {
  const tree = insertLeafBeside(leaf('a'), 'a', 'b', 'right');
  assert.throws(() => insertLeafBeside(tree, 'a', 'c', 'elsewhere'), /valid split/);
  assert.throws(() => insertLeafBeside(tree, 'a', '', 'right'), /valid terminal/);
  assert.equal(insertLeafBeside(tree, 'a', 'b', 'right'), tree);
  assert.equal(insertLeafBeside(tree, 'missing', 'c', 'right'), tree);
  assert.deepEqual(insertLeafBeside(null, null, 'a', 'right'), leaf('a'));
});

test('pane removal collapses empty branches without changing surviving process identities', () => {
  const tree = insertLeafBeside(insertLeafBeside(leaf('a'), 'a', 'b', 'right'), 'b', 'c', 'bottom');
  assert.deepEqual(collectLayoutLeafIdsInOrder(removeLayoutLeaf(tree, 'b')), ['a', 'c']);
  assert.equal(removeLayoutLeaf(tree, 'not-here'), tree);
  assert.deepEqual(removeLayoutLeaf(removeLayoutLeaf(tree, 'b'), 'a'), leaf('c'));
  assert.equal(removeLayoutLeaf(leaf('a'), 'a'), null);
  assert.equal(firstLayoutLeafId(tree), 'a'); assert.equal(firstLayoutLeafId(null), null);
  assert.equal(layoutContainsLeafId(tree, 'c'), true); assert.equal(layoutContainsLeafId(tree, 'missing'), false);
});

test('equalizing same-axis panes gives thirds and preserves mixed-axis groups', () => {
  const tree = insertLeafBeside(insertLeafBeside(leaf('a'), 'a', 'b', 'right'), 'b', 'c', 'right');
  const result = equalizeLayout(tree);
  assert.equal(result.ratio, 0.333); assert.equal(result.second.ratio, undefined);
  const mixed = equalizeLayout(insertLeafBeside(insertLeafBeside(leaf('a'), 'a', 'b', 'right'), 'b', 'c', 'bottom'));
  assert.equal(mixed.ratio, undefined); assert.equal(mixed.second.ratio, undefined);
  assert.equal(equalizeLayout(null), null);
});

test('split resizing clamps invalid/extreme values and updates only its addressed split', () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity, '0.2']) assert.equal(clampSplitRatio(value), 0.5);
  assert.equal(clampSplitRatio(-1), 0.1); assert.equal(clampSplitRatio(2), 0.9);
  const tree = insertLeafBeside(insertLeafBeside(leaf('a'), 'a', 'b', 'right'), 'b', 'c', 'bottom');
  const updated = updateLayoutRatio(tree, [1], 0.3);
  assert.equal(updated.second.ratio, 0.3); assert.equal(updated.first, tree.first);
  assert.equal(tree.second.ratio, undefined); assert.equal(updateLayoutRatio(tree, [], 9).ratio, 0.9);
  for (const path of [[2], 'first', Array(9).fill(0)]) assert.throws(() => updateLayoutRatio(tree, path, 0.2), /Invalid split path/);
});

test('restored layouts accept only existing owned terminal identities and valid ratios', () => {
  const saved = { root: { type: 'split', direction: 'vertical', ratio: 100, first: leaf('a'), second: { type: 'split', direction: 'horizontal', first: leaf('b'), second: leaf('a') } }, activeLeafId: 'not-here', authority: 'ignored' };
  const result = normalizeTerminalLayout(saved, ['a', 'b']);
  assert.deepEqual(collectLayoutLeafIdsInOrder(result.root), ['a', 'b']); assert.equal(result.root.ratio, 0.9); assert.equal(result.activeLeafId, 'a');
  assert.equal(result.authority, undefined);
  assert.deepEqual(normalizeTerminalLayout({ root: leaf('not-owned') }, ['a'], 'a'), { version: 1, root: leaf('a'), activeLeafId: 'a' });
  assert.deepEqual(normalizeTerminalLayout({ root: leaf('not-owned') }, ['a']), { version: 1, root: null, activeLeafId: null });
});

test('fresh provider or named-agent views never adopt an existing project terminal implicitly', () => {
  const existingProjectSessions = ['existing-codex-terminal', 'existing-claude-terminal'];
  for (const freshView of [null, undefined, {}, { version: 1, root: null }]) {
    assert.deepEqual(normalizeTerminalLayout(freshView, existingProjectSessions), { version: 1, root: null, activeLeafId: null });
  }
  assert.deepEqual(normalizeTerminalLayout(null, existingProjectSessions, 'existing-claude-terminal'), { version: 1, root: leaf('existing-claude-terminal'), activeLeafId: 'existing-claude-terminal' });
});

test('saved terminal layout bounds reject malformed nodes, cycles/depth and excess panes', () => {
  const cyclic = { type: 'split', direction: 'vertical', first: leaf('a') }; cyclic.second = cyclic;
  const safe = normalizeTerminalLayout({ root: cyclic }, ['a']);
  assert.deepEqual(collectLayoutLeafIdsInOrder(safe.root), ['a']);
  for (const root of [{ type: 'launch', command: 'arbitrary' }, { type: 'split', direction: 'bad', first: leaf('a'), second: leaf('b') }]) assert.equal(normalizeTerminalLayout({ root }, ['a', 'b']).root, null);
  let tree = leaf('0');
  for (let i = 1; i < 8; i++) tree = insertLeafBeside(tree, String(i - 1), String(i), 'right');
  assert.throws(() => insertLeafBeside(tree, '0', '8', 'right'), /at most eight/);
  assert.equal(collectLayoutLeafIdsInOrder(normalizeTerminalLayout({ root: tree }, Array.from({ length: 9 }, (_, index) => String(index))).root).length, 8);
});

test('deterministic mixed split sequences round-trip, resize and remove every leaf without corrupting identities', () => {
  const sides = ['left', 'right', 'top', 'bottom'];
  for (let seed = 0; seed < 64; seed++) {
    let tree = leaf('0');
    for (let i = 1; i < 8; i++) {
      const ids = collectLayoutLeafIdsInOrder(tree);
      tree = insertLeafBeside(tree, ids[(seed + i) % ids.length], String(i), sides[(seed + i) % 4], (seed + i) / 70);
      assert.equal(new Set(collectLayoutLeafIdsInOrder(tree)).size, i + 1);
    }
    const ids = collectLayoutLeafIdsInOrder(tree);
    const restored = normalizeTerminalLayout(JSON.parse(JSON.stringify({ root: equalizeLayout(tree), activeLeafId: ids.at(-1) })), ids);
    assert.deepEqual(collectLayoutLeafIdsInOrder(restored.root), ids);
    assert.equal(restored.activeLeafId, ids.at(-1));
    for (const id of ids) { tree = removeLayoutLeaf(tree, id); assert.equal(layoutContainsLeafId(tree, id), false); }
    assert.equal(tree, null);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { scrollFadeEdges } from '../src/lib/scroll-fades.js';
const base = { height: 300, width: 200, scrollHeight: 900, scrollWidth: 600 };
test('fades only edges with hidden content, including horizontal panels', () => {
  assert.deepEqual(scrollFadeEdges(base), [0, 24, 24, 0]);
  assert.deepEqual(scrollFadeEdges({ ...base, top: 40, left: 50 }), [24, 24, 24, 24]);
  assert.deepEqual(scrollFadeEdges({ ...base, top: 600, left: 400 }), [24, 0, 0, 24]);
});
test('fades taper near boundaries and clamp overscroll and short controls', () => {
  assert.deepEqual(scrollFadeEdges({ ...base, top: -20, left: -10 }), [0, 24, 24, 0]);
  assert.deepEqual(scrollFadeEdges({ ...base, top: 599.5, left: 398 }), [24, 2, 0, 24]);
  assert.equal(scrollFadeEdges({ ...base, height: 40, top: 100 })[0], 10);
});
test('fitting content and disabled axes are not masked', () => {
  assert.deepEqual(scrollFadeEdges({ ...base, scrollHeight: 200, scrollWidth: 100 }), [0, 0, 0, 0]);
  assert.deepEqual(scrollFadeEdges({ ...base, vertical: false, horizontal: false }), [0, 0, 0, 0]);
});
test('RTL horizontal edges follow physical position', () => {
  assert.deepEqual(scrollFadeEdges({ ...base, rtl: true, vertical: false }), [0, 0, 0, 24]);
  assert.deepEqual(scrollFadeEdges({ ...base, rtl: true, left: -400, vertical: false }), [0, 24, 0, 0]);
});

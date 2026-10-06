import assert from 'node:assert/strict';
import test from 'node:test';
import { canShowSidebarPreview, clampPagePreview, clampSidebarWidth, normalizeSidebarSize, shouldEnterSidebarPreview, sidebarMaxWidth, sidebarWidthFromPointer } from '../src/lib/sidebar-size.js';

test('sidebar width is bounded so content remains usable', () => {
  assert.equal(sidebarMaxWidth(1280), 794);
  assert.equal(clampSidebarWidth(120, 1280), 200);
  assert.equal(clampSidebarWidth(2000, 1280), 794);
  assert.equal(normalizeSidebarSize({ width: 350, hidden: true }, 1280).hidden, true);
  assert.equal(normalizeSidebarSize({ width: 'invalid', hidden: 'true' }, 1280).hidden, false);
});

test('dragging near the left edge requests hidden mode', () => {
  assert.equal(sidebarWidthFromPointer(60, 1280), 0);
  assert.equal(sidebarWidthFromPointer(300, 1280), 288);
  assert.equal(sidebarWidthFromPointer(1400, 1280), 794);
});

test('extreme width enters preview only on a sufficiently large viewport', () => {
  assert.equal(canShowSidebarPreview(1280, 720), true);
  assert.equal(canShowSidebarPreview(900, 720), false);
  assert.equal(shouldEnterSidebarPreview(1040, 1280, 720), true);
  assert.equal(shouldEnterSidebarPreview(900, 1280, 720), false);
  assert.equal(shouldEnterSidebarPreview(880, 900, 720), false);
});

test('page preview stays within the viewport when moved or resized', () => {
  const preview = clampPagePreview({ x: 5000, y: 5000, width: 5000 }, 1280, 720);
  assert.ok(preview.width <= 600);
  assert.ok(preview.x + preview.width <= 1268);
  assert.ok(preview.y + preview.height <= 708);
  assert.equal(preview.scale, preview.width / 1256);
});

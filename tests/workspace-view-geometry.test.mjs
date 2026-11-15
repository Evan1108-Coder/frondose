import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { automaticViewLayout, insertViewLayout, normalizeViewLayout, resizeViewLayout } from '../src/lib/workspace-view-layout.js';
import { workspaceDividerRatio, workspaceViewGeometry, WORKSPACE_VIEW_DIVIDER_SIZE } from '../src/lib/workspace-view-geometry.js';

const close = (actual, expected) => assert(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
test('one real view uses the same flat canvas at full size without a splitter', () => {
  const layout = normalizeViewLayout(null, ['editor']);
  const geometry = workspaceViewGeometry(layout, 900, 640);
  assert.deepEqual(geometry.leaves, [{ id: 'editor', left: 0, top: 0, width: 900, height: 640 }]);
  assert.equal(geometry.dividers.length, 0); assert.equal(WORKSPACE_VIEW_DIVIDER_SIZE, 5);
});
test('side-by-side and stacked geometry reserve the actual separator size', () => {
  for (const axis of ['row', 'column']) {
    const layout = { type: 'split', id: 'divider', axis, ratio: .4, first: { type: 'view', id: 'a' }, second: { type: 'view', id: 'b' } };
    const geometry = workspaceViewGeometry(layout, 1000, 500), [first, second] = geometry.leaves, [divider] = geometry.dividers;
    assert.equal(divider.axis, axis); assert.deepEqual(divider.parent, { left: 0, top: 0, width: 1000, height: 500 });
    close(axis === 'row' ? first.width : first.height, ((axis === 'row' ? 1000 : 500) - 5) * .4);
    close(axis === 'row' ? second.left : second.top, (axis === 'row' ? first.width : first.height) + 5);
    close(first.width * first.height + second.width * second.height + divider.width * divider.height, 500_000);
  }
});
test('one through eight panes tile the measured area without overlaps or offscreen rectangles', () => {
  for (let count = 1; count <= 8; count++) for (const [width, height] of [[375, 600], [1280, 720]]) {
    const ids = Array.from({ length: count }, (_, index) => `view_${index}`), geometry = workspaceViewGeometry(automaticViewLayout(ids), width, height);
    assert.deepEqual(geometry.leaves.map(leaf => leaf.id), ids); assert.equal(geometry.dividers.length, count - 1);
    for (const rect of [...geometry.leaves, ...geometry.dividers]) {
      assert(rect.left >= 0 && rect.top >= 0 && rect.width >= 0 && rect.height >= 0);
      assert(rect.left + rect.width <= width + 0.000001 && rect.top + rect.height <= height + 0.000001);
    }
    close([...geometry.leaves, ...geometry.dividers].reduce((sum, rect) => sum + rect.width * rect.height, 0), width * height);
  }
});
test('drag preview, drop, resize and different edge docking change rectangles but not real leaf identities', () => {
  const views = [{ id: 'editor', entityId: 'file_entity' }, { id: 'cli', entityId: 'pty_entity' }];
  const base = automaticViewLayout(views.map(view => view.id));
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    const preview = insertViewLayout(base, 'editor', ['incoming'], edge);
    const resized = resizeViewLayout(preview, preview.id, .8);
    for (const layout of [base, preview, resized, base]) {
      const rectangles = new Map(workspaceViewGeometry(layout, 1100, 700).leaves.map(rect => [rect.id, rect]));
      assert.deepEqual(views.filter(view => rectangles.has(view.id)).map(view => view.entityId), ['file_entity', 'pty_entity']);
    }
  }
  assert.deepEqual(workspaceViewGeometry(base, 1100, 700).leaves.map(rect => rect.id), ['editor', 'cli']);
});
test('resizing nested separators uses their measured parent origin and does not jump on grab', () => {
  const layout = insertViewLayout(automaticViewLayout(['a', 'b']), 'b', ['c'], 'bottom');
  const geometry = workspaceViewGeometry(layout, 1000, 500);
  for (const divider of geometry.dividers) {
    const point = { x: divider.left + divider.width / 2, y: divider.top + divider.height / 2 };
    close(workspaceDividerRatio(divider, point), divider.ratio);
    assert.equal(workspaceDividerRatio(divider, { x: -10000, y: -10000 }), .12);
    assert.equal(workspaceDividerRatio(divider, { x: 10000, y: 10000 }), .88);
  }
});
test('zero, tiny and invalid dimensions stay finite and never create negative rectangles', () => {
  const layout = automaticViewLayout(['a', 'b']);
  for (const size of [0, 1, 3, NaN, Infinity, -10]) {
    const geometry = workspaceViewGeometry(layout, size, size);
    for (const rect of [...geometry.leaves, ...geometry.dividers]) for (const key of ['left', 'top', 'width', 'height']) assert(Number.isFinite(rect[key]) && rect[key] >= 0);
    assert(Number.isFinite(workspaceDividerRatio(geometry.dividers[0], { x: NaN, y: NaN })));
  }
});
test('render source keeps live bodies under one fixed flat entity-keyed layer during every layout phase', async () => {
  const source = await readFile(new URL('../src/components/workspace/WorkspaceViews.jsx', import.meta.url), 'utf8');
  assert.match(source, /className="workspace-view-leaves"[\s\S]*?views\.map\(view => <WorkspaceViewLeaf key=\{view\.entityId\}/);
  assert.match(source, /className="workspace-view-dividers"[\s\S]*?geometry\.dividers\.map/);
  assert.doesNotMatch(source, /function nodeView|nodeView\(node\.(first|second)\)/);
  assert.match(source, /data-workspace-entity-id=\{view\.entityId\}/);
  assert.match(source, /hidden=\{hideHeaders\}/);
  assert.match(source, /const placeholder = preview && !materialized\.current/);
  assert.match(source, /placeholder \? <div className="workspace-view-drop-placeholder">\{view\.label\}<\/div> : renderView\(view\)/);
  assert.match(source, /new ResizeObserver\(measure\)/);
  assert.match(source, /dispatchEvent\(new CustomEvent\('frondose:workspace-view-geometry'\)\)/);
  assert.match(source, /role="separator"/); assert.match(source, /'Home', 'End'/);
  assert.match(source, /pointerCleanup\.current\?\.\(\)/);
});
test('flat pane positioning never transforms native browser/terminal content', async () => {
  const css = await readFile(new URL('../src/components/workspace/workspace-views.css', import.meta.url), 'utf8');
  assert.match(css, /\.workspace-view \{ position:absolute/);
  assert.match(css, /\.workspace-view-heading\[hidden\] \{ display:none/);
  assert.match(css, /\.workspace-view-dividers \{[^}]*pointer-events:none/);
  assert.doesNotMatch(css, /\.workspace-view(?:\s|\{|\.focused)[^}]*\btransform\s*:/);
});

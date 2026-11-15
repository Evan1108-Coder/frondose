import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { automaticViewLayout, layoutViewIds, moveViewLayout, normalizeViewLayout, resizeViewLayout } from '../src/lib/workspace-view-layout.js';
import { newWorkspaceTab, persistedWorkspaceTabs, normalizeWorkspaceTabs, workspaceTabsReducer } from '../src/lib/workspace-tabs.js';
import { workspaceViewGeometry, workspaceViewDragTarget, workspaceViewDragStarted, workspaceIncomingDragTarget } from '../src/lib/workspace-view-geometry.js';

const edges = ['left', 'right', 'top', 'bottom'];
const leaves = node => !node ? [] : node.type === 'view' ? [node] : [...leaves(node.first), ...leaves(node.second)];
const splits = node => !node || node.type === 'view' ? [] : [node, ...splits(node.first), ...splits(node.second)];

test('existing pane docking keeps exactly the same membership for every source, target and edge up to eight views', () => {
  for (let count = 2; count <= 8; count++) {
    const ids = Array.from({ length: count }, (_, index) => `pane_${index}`), original = automaticViewLayout(ids), snapshot = structuredClone(original);
    for (const source of ids) for (const target of ids.filter(id => id !== source)) for (const edge of edges) {
      const moved = moveViewLayout(original, source, target, edge), actual = layoutViewIds(moved);
      assert.deepEqual(new Set(actual), new Set(ids)); assert.equal(actual.length, count); assert.equal(new Set(actual).size, count);
      const sibling = splits(moved).find(node => node.first.type === 'view' && node.second.type === 'view' && [node.first.id, node.second.id].includes(source) && [node.first.id, node.second.id].includes(target));
      assert(sibling, 'the moved source docks directly beside its target');
      assert.equal(sibling.axis, ['left', 'right'].includes(edge) ? 'row' : 'column');
      assert.equal(sibling[['left', 'top'].includes(edge) ? 'first' : 'second'].id, source);
      assert.deepEqual(original, snapshot, 'hover does not mutate the committed layout');
      const geometry = workspaceViewGeometry(moved, 1200, 800);
      assert.equal(geometry.leaves.length, count); assert.equal(geometry.dividers.length, count - 1);
      assert.equal(new Set(splits(normalizeViewLayout(moved, ids)).map(node => node.id)).size, count - 1);
    }
  }
});

test('invalid, outside-group, same-pane and non-edge dock requests are no-ops', () => {
  const layout = automaticViewLayout(['a', 'b']);
  for (const [source, target, edge] of [['a', 'a', 'left'], ['missing', 'b', 'right'], ['a', 'missing', 'top'], ['a', 'b', 'center'], ['a', 'b', ''], [null, 'b', 'left']]) assert.equal(moveViewLayout(layout, source, target, edge), layout);
  const single = automaticViewLayout(['a']); assert.equal(moveViewLayout(single, 'a', 'b', 'right'), single);
  assert.equal(moveViewLayout(null, 'a', 'b', 'right'), null);
  const duplicate = { type: 'split', id: 'dupe', axis: 'row', ratio: .5, first: { type: 'view', id: 'a' }, second: { type: 'view', id: 'a' } };
  assert.equal(moveViewLayout(duplicate, 'a', 'b', 'right'), duplicate);
});

test('final bottom drop overrides stale right hover using the same committed geometry after preview reflow', () => {
  const committed = automaticViewLayout(['cli', 'projects']), snapshot = { bounds: { left: 225, top: 80, width: 795, height: 633 }, leaves: [{ id: 'cli', left: 225, top: 80, width: 395, height: 633 }, { id: 'projects', left: 625, top: 80, width: 395, height: 633 }] };
  const original = structuredClone(snapshot), hover = workspaceViewDragTarget(snapshot, 'projects', { x: 610, y: 490 });
  assert.deepEqual(hover, { viewId: 'cli', edge: 'right' });
  const stalePreview = moveViewLayout(committed, 'projects', hover.viewId, hover.edge); assert.equal(stalePreview.axis, 'row');
  const final = workspaceViewDragTarget(snapshot, 'projects', { x: 430, y: 670 });
  assert.deepEqual(final, { viewId: 'cli', edge: 'bottom' });
  const dropped = moveViewLayout(committed, 'projects', final.viewId, final.edge); assert.equal(dropped.axis, 'column');
  const reflowed = workspaceViewGeometry(dropped, 795, 633), visibleSource = reflowed.leaves.find(rect => rect.id === 'projects');
  assert(670 >= 80 + visibleSource.top, 'the source now covers the pointer after preview reflow');
  assert.deepEqual(workspaceViewDragTarget(snapshot, 'projects', { x: 430, y: 670 }), final, 'preview positions cannot change the committed hit target');
  assert.deepEqual(snapshot, original);
  for (const point of [{ x: 980, y: 94 }, { x: 700, y: 600 }, { x: 224, y: 670 }, { x: 1020, y: 670 }, { x: 430, y: 714 }, { x: 622, y: 490 }, { x: NaN, y: 670 }]) assert.equal(workspaceViewDragTarget(snapshot, 'projects', point), null, 'source, divider and outside-canvas points cannot commit stale previews');
  assert.equal(workspaceViewDragTarget(snapshot, 'foreign-view', { x: 430, y: 670 }), null);
});

test('docking leaves unrelated resized branches and their live leaf objects intact', () => {
  const layout = automaticViewLayout(['a', 'b', 'c', 'd']);
  const resized = resizeViewLayout(layout, layout.second.id, .7), unrelated = resized.second;
  const moved = moveViewLayout(resized, 'a', 'b', 'top');
  assert.deepEqual(moved.second, unrelated); assert.equal(moved.second.ratio, .7);
  for (const id of ['b', 'c', 'd']) assert.equal(leaves(moved).find(view => view.id === id), leaves(resized).find(view => view.id === id));
});

test('set-layout commits docking without replacing views, clearing drafts or creating execution intent', () => {
  const editor = newWorkspaceTab('editor', { entityId: 'dirty_editor', path: 'notes.md', rootVersion: 'old_root', projectId: 'project_fixture' }, 'editor');
  const cli = newWorkspaceTab('terminal', { entityId: 'running_cli', providerId: 'codex', projectId: 'project_fixture' }, 'cli');
  const browser = newWorkspaceTab('browser', { entityId: 'browser_guest' }, 'browser');
  const group = newWorkspaceTab('group', { views: [editor, cli, browser], activeViewId: editor.id }, editor.id);
  const state = { version: 1, tabs: [group], activeTabId: group.id, recentlyClosed: [] }, originalViews = group.views;
  const draft = { loaded: true, text: 'unsaved changes remain here', pending: true }, drafts = new Map([[editor.entityId, draft]]);
  for (const edge of edges) {
    const next = workspaceTabsReducer(state, { type: 'set-layout', layout: moveViewLayout(group.layout, cli.id, editor.id, edge) });
    assert.equal(next.tabs.length, 1); assert.equal(next.activeTabId, group.id); assert.equal(next.tabs[0].views, originalViews);
    assert.equal(next.tabs[0].activeViewId, editor.id); assert.equal(drafts.get(editor.entityId), draft);
    for (const view of next.tabs[0].views) { assert.equal(view, originalViews.find(item => item.id === view.id)); assert.equal(view.launchRequestId, undefined); }
    const restored = normalizeWorkspaceTabs(persistedWorkspaceTabs(next));
    assert.deepEqual(restored.tabs[0].views.map(view => view.entityId), originalViews.map(view => view.entityId));
    assert.deepEqual(layoutViewIds(restored.tabs[0].layout), layoutViewIds(next.tabs[0].layout));
  }
});

test('pane headers use their own drag MIME and layout-only drop while incoming top-tab dragging stays separate', async () => {
  const surface = await readFile(new URL('../src/components/workspace/WorkspaceSurface.jsx', import.meta.url), 'utf8');
  const views = await readFile(new URL('../src/components/workspace/WorkspaceViews.jsx', import.meta.url), 'utf8');
  assert.match(surface, /dragViewSource=useRef\(null\)/);
  assert.match(surface, /finishDrag=useCallback\(\(\)=>\{dragSource\.current=null;dragTabSource\.current=null;dragViewSource\.current=null/);
  assert.match(surface, /source\.tabId===tab\.id&&source\.identity===identity\(tab\)&&tab\.views\.some\(v=>v\.id===source\.viewId&&v\.entityId===source\.entityId\)/);
  assert.match(surface, /setData\('application\/frondose-view',source\.viewId\)/);
  assert.match(surface, /getData\('application\/frondose-view'\)/);
  assert.match(surface, /setData\('application\/frondose-tab',tab\.id\)/);
  const drop = surface.slice(surface.indexOf('const onDropView='), surface.indexOf('const beginResize='));
  const paneDrop = drop.slice(0, drop.indexOf("getData('application/frondose-tab')"));
  assert.match(paneDrop, /id===drag\.source\.viewId/); assert.match(paneDrop, /update\(\{type:'set-layout',layout\}\)/);
  assert.match(paneDrop, /workspaceViewDragTarget\(drag\.source\.geometry,id,\{x:e\.clientX,y:e\.clientY\}\)/);
  assert.doesNotMatch(paneDrop, /preview\?\.layout|dragPreview\?\.kind/);
  assert.match(surface, /canvas\.getBoundingClientRect\(\)/); assert.match(surface, /identity:identity\(tab\),geometry\}:null/);
  assert.doesNotMatch(paneDrop, /guard\(|detach-view|group-tabs|splitTabs\(|launchRequests|showContent/);
  assert.match(surface, /layout=viewPreview\?dragPreview\.layout:previewSource\?insertViewLayout/);
  assert.match(surface, /previewIds=\{new Set\(previewSource\?/);
  assert.match(surface, /onDragStartView=\{onDragStartView\} onDragEndView=\{finishDrag\} onPointerDownView=\{onPointerDownView\} canDragViews=\{activeTab\.contentType==='group'\}/);
  assert.match(views, /hidden=\{hideHeaders\} draggable=\{false\}/);
  assert.match(views, /data-workspace-view-drag-handle=/);
  assert.match(views, /draggable=\{false\} data-workspace-view-action="detach"/);
  assert.match(views, /WorkspaceViewLeaf key=\{view\.entityId\}/);
});

test('incoming tab drag stays anchored to committed geometry through placeholder reflow', () => {
  const snapshot = { bounds: { left: 200, top: 80, width: 800, height: 600 }, leaves: [{ id: 'original', left: 200, top: 80, width: 800, height: 600 }] };
  const original = structuredClone(snapshot);
  for (let frame = 0; frame < 60; frame++) {
    assert.deepEqual(workspaceIncomingDragTarget(snapshot, { x: 950, y: 380 }), { viewId: 'original', edge: 'right' });
  }
  assert.deepEqual(workspaceIncomingDragTarget(snapshot, { x: 600, y: 380 }), { viewId: 'original', edge: 'center' });
  assert.deepEqual(workspaceIncomingDragTarget(snapshot, { x: 600, y: 650 }), { viewId: 'original', edge: 'bottom' });
  assert.deepEqual(snapshot, original);
  const two = { ...snapshot, leaves: [{ id: 'left', left: 200, top: 80, width: 397.5, height: 600 }, { id: 'right', left: 602.5, top: 80, width: 397.5, height: 600 }] };
  assert.deepEqual(workspaceIncomingDragTarget(two, { x: 600, y: 380 }), { viewId: 'left', edge: 'right' }, 'a divider cannot trigger enter/leave preview oscillation');
  for (const point of [{ x: 199, y: 380 }, { x: 1000, y: 380 }, { x: 600, y: 680 }, { x: NaN, y: 380 }]) assert.equal(workspaceIncomingDragTarget(snapshot, point), null);
  assert.equal(workspaceIncomingDragTarget({ ...snapshot, leaves: [] }, { x: 300, y: 200 }), null);
  assert.equal(workspaceIncomingDragTarget({ ...snapshot, leaves: [snapshot.leaves[0], snapshot.leaves[0]] }, { x: 300, y: 200 }), null);
});

test('incoming tab preview and final drop use the same frozen source, not resized preview DOM', async () => {
  const source = await readFile(new URL('../src/components/workspace/WorkspaceSurface.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/components/workspace/workspace-views.css', import.meta.url), 'utf8');
  assert.match(source, /dragTabSource.current=captureTabDrag\(tab.id\)/);
  assert.match(source, /incomingViews:sourceId===target.id\?\[newWorkspaceTab\(\)\]:workspaceTabViews\(source\)/);
  assert.match(source, /identity\(source\)===snapshot.sourceIdentity&&identity\(target\)===snapshot.targetIdentity/);
  const handlers = source.slice(source.indexOf('const onDragOverView='), source.indexOf('const beginResize='));
  assert.equal((handlers.match(/workspaceIncomingDragTarget\(drag.snapshot.geometry/g) || []).length, 2);
  assert.doesNotMatch(handlers, /getBoundingClientRect|dropEdge/);
  assert.match(css, /\.workspace-view\.drop-preview\s*\{\s*pointer-events:\s*none/);
});

test('pane pointer gesture keeps simple taps inert until six pixels and rejects invalid points', () => {
  const start = { x: 930, y: 82 };
  for (const point of [start, { x: 933, y: 86 }, { x: 935.9, y: 82 }, { x: NaN, y: 82 }, { x: 930, y: Infinity }]) assert.equal(workspaceViewDragStarted(start, point), false);
  for (const point of [{ x: 936, y: 82 }, { x: 930, y: 88 }, { x: 460, y: 830 }]) assert.equal(workspaceViewDragStarted(start, point), true);
  assert.equal(workspaceViewDragStarted(null, { x: 1, y: 1 }), false);
});

test('pane pointer handlers capture, preview and commit geometry only with bounded cancellation cleanup', async () => {
  const surface = await readFile(new URL('../src/components/workspace/WorkspaceSurface.jsx', import.meta.url), 'utf8'), views = await readFile(new URL('../src/components/workspace/WorkspaceViews.jsx', import.meta.url), 'utf8'), css = await readFile(new URL('../src/components/workspace/workspace-views.css', import.meta.url), 'utf8');
  const pointer = surface.slice(surface.indexOf('const onPointerDownView='), surface.indexOf('const onDragOverView='));
  assert.match(pointer, /event\.target\.closest\?\.\('\[data-workspace-view-action\]'\)/);
  assert.match(pointer, /workspaceViewDragStarted\(start,latest\)/); assert.match(pointer, /header\.setPointerCapture\(pointerId\)/);
  assert.match(pointer, /point\.pointerId!==pointerId/); assert.match(pointer, /workspaceViewDragTarget\(source\.geometry,source\.viewId,\{x:point\.clientX,y:point\.clientY\}\)/);
  assert.match(pointer, /if\(started\).*update\(\{type:'set-layout',layout\}\)/);
  for (const event of ['pointermove', 'pointerup', 'pointercancel', 'blur', 'lostpointercapture', 'keydown']) { assert(pointer.includes(`addEventListener('${event}'`), event); assert(pointer.includes(`removeEventListener('${event}'`), event); }
  assert.match(pointer, /cancelAnimationFrame\(frame\)/); assert.match(pointer, /releasePointerCapture\(pointerId\)/); assert.match(pointer, /key\.key==='Escape'/);
  assert.doesNotMatch(pointer, /launchRequests|historyLaunches|group-tabs|stopWorkspaceTerminal/);
  assert.match(surface, /useEffect\(\(\)=>\(\)=>\{viewPointerCleanup\.current\?\.\(\)/);
  assert.match(views, /onPointerDownView\?\.\(event, view\.id\)/); assert.match(css, /touch-action:none;user-select:none;cursor:grab/);
});

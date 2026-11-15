export const WORKSPACE_VIEW_DIVIDER_SIZE = 5;
const finiteSize = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const ratio = value => Number.isFinite(value) ? Math.max(.12, Math.min(.88, value)) : .5;

/** Project a validated binary layout into flat rectangles. These descriptors
 * contain geometry only: content ownership/lifetime never follows this tree. */
export function workspaceViewGeometry(layout, width, height, dividerSize = WORKSPACE_VIEW_DIVIDER_SIZE) {
  const leaves = [], dividers = [];
  const size = Math.max(0, Math.min(12, finiteSize(dividerSize)));
  const bounds = { left: 0, top: 0, width: finiteSize(width), height: finiteSize(height) };
  function visit(node, rect, depth = 0) {
    if (!node || depth > 16) return;
    if (node.type === 'view') { leaves.push({ id: node.id, ...rect }); return; }
    if (node.type !== 'split' || !['row', 'column'].includes(node.axis)) return;
    const row = node.axis === 'row', extent = row ? rect.width : rect.height;
    const gap = Math.min(size, extent), available = Math.max(0, extent - gap), fraction = ratio(node.ratio), firstSize = available * fraction;
    const first = { ...rect, [row ? 'width' : 'height']: firstSize };
    const second = { ...rect, [row ? 'left' : 'top']: (row ? rect.left : rect.top) + firstSize + gap, [row ? 'width' : 'height']: available - firstSize };
    const divider = row ? { left: rect.left + firstSize, top: rect.top, width: gap, height: rect.height } : { left: rect.left, top: rect.top + firstSize, width: rect.width, height: gap };
    dividers.push({ id: node.id, axis: node.axis, ratio: fraction, parent: { ...rect }, gap, ...divider });
    visit(node.first, first, depth + 1); visit(node.second, second, depth + 1);
  }
  visit(layout, bounds);
  return { bounds, leaves, dividers };
}

/** Pointer coordinates are relative to the fixed canvas, not a nested pane.
 * Subtract half the separator so grabbing its center does not jump the split. */
export function workspaceDividerRatio(divider, point) {
  const row = divider.axis === 'row', parent = divider.parent;
  const available = (row ? parent.width : parent.height) - divider.gap;
  const coordinate = row ? point.x : point.y;
  if (available <= 0 || !Number.isFinite(coordinate)) return ratio(divider.ratio);
  return ratio((coordinate - (row ? parent.left : parent.top) - divider.gap / 2) / available);
}

/** Resolve a drag against the committed client rectangles captured at start.
 * Preview geometry must not move its own hit targets, and the final drop is
 * resolved again even when the platform omits the final dragover event. */
export function workspaceViewDragTarget(snapshot, sourceId, point) {
  const valid = rect => rect && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;
  const contains = rect => point.x >= rect.left && point.x < rect.left + rect.width && point.y >= rect.top && point.y < rect.top + rect.height;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || !valid(snapshot?.bounds) || !contains(snapshot.bounds) || !Array.isArray(snapshot.leaves) || snapshot.leaves.length < 2 || snapshot.leaves.length > 8) return null;
  if (new Set(snapshot.leaves.map(rect => rect.id)).size !== snapshot.leaves.length || !snapshot.leaves.some(rect => rect.id === sourceId)) return null;
  const targets = snapshot.leaves.filter(rect => valid(rect) && contains(rect));
  if (targets.length !== 1 || targets[0].id === sourceId) return null;
  const target = targets[0], x = (point.x - target.left) / target.width, y = (point.y - target.top) / target.height;
  const edge = [['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y]].reduce((best, item) => item[1] < best[1] ? item : best)[0];
  return { viewId: target.id, edge };
}

export function workspaceViewDragStarted(start, point, threshold = 6) {
  return [start?.x, start?.y, point?.x, point?.y].every(Number.isFinite) && Math.hypot(point.x - start.x, point.y - start.y) >= Math.max(1, Number.isFinite(threshold) ? threshold : 6);
}

/** Incoming top-level tabs hit-test the original committed pane rectangles,
 * never the moving preview or its inert incoming placeholder. */
export function workspaceIncomingDragTarget(snapshot, point) {
  const valid = rect => rect && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;
  const contains = rect => point.x >= rect.left && point.x < rect.left + rect.width && point.y >= rect.top && point.y < rect.top + rect.height;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || !valid(snapshot?.bounds) || !contains(snapshot.bounds) || !Array.isArray(snapshot.leaves) || !snapshot.leaves.length || snapshot.leaves.length > 8 || new Set(snapshot.leaves.map(rect => rect.id)).size !== snapshot.leaves.length) return null;
  const leaves = snapshot.leaves.filter(valid);
  if (leaves.length !== snapshot.leaves.length) return null;
  const distance = rect => Math.hypot(Math.max(rect.left - point.x, 0, point.x - rect.left - rect.width), Math.max(rect.top - point.y, 0, point.y - rect.top - rect.height));
  const target = leaves.find(contains) || leaves.reduce((best, rect) => distance(rect) < distance(best) ? rect : best);
  const x = (point.x - target.left) / target.width, y = (point.y - target.top) / target.height;
  return { viewId: target.id, edge: x < .22 ? 'left' : x > .78 ? 'right' : y < .22 ? 'top' : y > .78 ? 'bottom' : 'center' };
}
export function workspaceNeedsFocusMode(leaves, width, height) {
  return leaves.length > 1 && width > 0 && height > 0 && leaves.some(rect => rect.width < 320 || rect.height < 200);
}

export const MAX_TAB_VIEWS = 8;
const leaf = id => ({ type: 'view', id });
const split = (first, second, axis = 'row', ratio = .5, id = `split_${crypto.randomUUID()}`) => ({ type: 'split', id, axis, ratio, first, second });
export function layoutViewIds(node) { return !node ? [] : node.type === 'view' ? [node.id] : [...layoutViewIds(node.first), ...layoutViewIds(node.second)]; }
export function automaticViewLayout(ids) {
  if (!ids.length || ids.length > MAX_TAB_VIEWS || new Set(ids).size !== ids.length) return null;
  let hash = 2166136261, serial = 0;
  for (const character of ids.join('|')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const automaticSplit = (first, second, axis = 'row', ratio = .5) => split(first, second, axis, ratio, `split_auto_${hash.toString(36)}_${++serial}`);
  const row = items => items.length === 1 ? leaf(items[0]) : automaticSplit(leaf(items[0]), row(items.slice(1)), 'row', 1 / items.length);
  if (ids.length <= 3) return row(ids);
  const middle = Math.ceil(ids.length / 2);
  return automaticSplit(row(ids.slice(0, middle)), row(ids.slice(middle)), 'column');
}
export function normalizeViewLayout(value, ids) {
  const allowed = new Set(ids), seen = new Set(), splitIds = new Set();
  let repairedId = 0;
  function uniqueSplitId(value) {
    let id = value;
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || splitIds.has(id)) {
      do { id = `split_normalized_${++repairedId}`; } while (splitIds.has(id));
    }
    splitIds.add(id); return id;
  }
  function visit(node, depth = 0) {
    if (!node || depth > MAX_TAB_VIEWS || typeof node !== 'object') return null;
    if (node.type === 'view') {
      if (!allowed.has(node.id) || seen.has(node.id)) return null;
      seen.add(node.id); return leaf(node.id);
    }
    if (node.type !== 'split' || !['row', 'column'].includes(node.axis)) return null;
    const id = uniqueSplitId(node.id);
    const first = visit(node.first, depth + 1), second = visit(node.second, depth + 1);
    if (!first || !second) return null;
    const ratio = typeof node.ratio === 'number' && Number.isFinite(node.ratio) ? Math.max(.12, Math.min(.88, node.ratio)) : .5;
    return split(first, second, node.axis, ratio, id);
  }
  const normalized = visit(value);
  return normalized && seen.size === allowed.size && layoutViewIds(normalized).length === ids.length ? normalized : automaticViewLayout(ids);
}
export function insertViewLayout(layout, targetId, incomingIds, edge) {
  if (!['left','right','top','bottom'].includes(edge)) return automaticViewLayout([...layoutViewIds(layout), ...incomingIds]);
  const incoming = automaticViewLayout(incomingIds);
  const visit = node => {
    if (node.type === 'view') return node.id !== targetId ? node : ['left','top'].includes(edge) ? split(incoming, node, ['left','right'].includes(edge) ? 'row' : 'column') : split(node, incoming, ['left','right'].includes(edge) ? 'row' : 'column');
    return { ...node, first: visit(node.first), second: visit(node.second) };
  };
  return visit(layout);
}
export function resizeViewLayout(layout, id, ratio) {
  if (!Number.isFinite(ratio)) return layout;
  let resized = false;
  const visit = node => {
    if (!node || node.type === 'view' || resized) return node;
    if (node.id === id) { resized = true; return { ...node, ratio: Math.max(.12, Math.min(.88, ratio)) }; }
    const first = visit(node.first), second = visit(node.second);
    return first === node.first && second === node.second ? node : { ...node, first, second };
  };
  return visit(layout);
}
export function removeViewLayout(layout, id) {
  if (!layout) return null;
  if (layout.type === 'view') return layout.id === id ? null : layout;
  const first = removeViewLayout(layout.first, id), second = removeViewLayout(layout.second, id);
  return first && second ? { ...layout, first, second } : first || second;
}

// Reposition an existing leaf, not an incoming tab: membership and backing
// runtime identities stay unchanged throughout hover and the final drop.
export function moveViewLayout(layout, sourceId, targetId, edge) {
  if (!['left', 'right', 'top', 'bottom'].includes(edge) || sourceId === targetId) return layout;
  const ids = layoutViewIds(layout);
  if (ids.length < 2 || ids.length > MAX_TAB_VIEWS || new Set(ids).size !== ids.length || !ids.includes(sourceId) || !ids.includes(targetId)) return layout;
  return insertViewLayout(removeViewLayout(layout, sourceId), targetId, [sourceId], edge);
}

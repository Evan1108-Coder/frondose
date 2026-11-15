// Portions adapted from Orca, Copyright (c) 2026 Lovecast Inc., MIT.
// Source: src/shared/workspace-layout/terminal-pane-tree.ts at
// 51dcef8258230ffea85a907130450b0ad676e22b
// SHA-256: 85af57a3f1b783822b146e586ded6c63a6d83b30f4db9ca8927ddd2cbd0e8eb1
// See third-party/orca/LICENSE. Frondose adds bounded validation, ratio editing
// and a persistent-view contract: removing a leaf never terminates its PTY.

export const SPLIT_RATIO_TOLERANCE = 0.005;
export const MAX_TERMINAL_PANES = 8;
export const MIN_SPLIT_RATIO = 0.1;
export const MAX_SPLIT_RATIO = 0.9;

export function clampSplitRatio(value) {
  return Number.isFinite(value) ? Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, value)) : 0.5;
}

export function collectLayoutLeafIdsInOrder(node) {
  if (!node) return [];
  if (node.type === 'leaf') return [node.leafId];
  return [...collectLayoutLeafIdsInOrder(node.first), ...collectLayoutLeafIdsInOrder(node.second)];
}

export function firstLayoutLeafId(node) {
  if (!node) return null;
  return node.type === 'leaf' ? node.leafId : firstLayoutLeafId(node.first);
}

export function layoutContainsLeafId(node, leafId) {
  if (!node) return false;
  return node.type === 'leaf' ? node.leafId === leafId : layoutContainsLeafId(node.first, leafId) || layoutContainsLeafId(node.second, leafId);
}

export function removeLayoutLeaf(node, leafId) {
  if (!node) return null;
  if (node.type === 'leaf') return node.leafId === leafId ? null : node;
  const first = removeLayoutLeaf(node.first, leafId), second = removeLayoutLeaf(node.second, leafId);
  if (!first || !second) return first ?? second;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function insertLeafBeside(node, targetLeafId, newLeafId, side, ratio) {
  if (!['left', 'right', 'top', 'bottom'].includes(side)) throw new TypeError('Choose a valid split side.');
  if (typeof newLeafId !== 'string' || !newLeafId || newLeafId.length > 200) throw new TypeError('Choose a valid terminal identity.');
  if (!node) return { type: 'leaf', leafId: newLeafId };
  if (layoutContainsLeafId(node, newLeafId) || !layoutContainsLeafId(node, targetLeafId)) return node;
  if (collectLayoutLeafIdsInOrder(node).length >= MAX_TERMINAL_PANES) throw new RangeError('A terminal workspace supports at most eight visible panes.');
  function insert(current) {
    if (current.type === 'leaf') {
      if (current.leafId !== targetLeafId) return current;
      const added = { type: 'leaf', leafId: newLeafId }, before = side === 'left' || side === 'top';
      return { type: 'split', direction: side === 'left' || side === 'right' ? 'vertical' : 'horizontal', first: before ? added : current, second: before ? current : added, ...(ratio !== undefined ? { ratio: clampSplitRatio(ratio) } : {}) };
    }
    return { ...current, first: insert(current.first), second: insert(current.second) };
  }
  return insert(node);
}

function equalizeWeight(node, direction) {
  return node.type === 'split' && node.direction === direction ? equalizeWeight(node.first, direction) + equalizeWeight(node.second, direction) : 1;
}

export function equalizeLayout(node) {
  if (!node || node.type === 'leaf') return node;
  const first = equalizeWeight(node.first, node.direction), second = equalizeWeight(node.second, node.direction);
  const { ratio: ignored, ...split } = node;
  const ratio = first / (first + second);
  return { ...split, ...(Math.abs(ratio - 0.5) > SPLIT_RATIO_TOLERANCE ? { ratio: Math.round(ratio * 1000) / 1000 } : {}), first: equalizeLayout(node.first), second: equalizeLayout(node.second) };
}

export function updateLayoutRatio(node, path, ratio) {
  if (!Array.isArray(path) || path.length > 8 || path.some(part => part !== 0 && part !== 1)) throw new TypeError('Invalid split path.');
  if (!node || node.type !== 'split') return node;
  if (!path.length) return { ...node, ratio: clampSplitRatio(ratio) };
  const [part, ...remaining] = path, key = part === 0 ? 'first' : 'second';
  return { ...node, [key]: updateLayoutRatio(node[key], remaining, ratio) };
}

/** Browser state can describe views, never process authority or launch requests. */
export function normalizeTerminalLayout(value, terminalIds, initialTerminalId = null) {
  const known = new Set(terminalIds), seen = new Set();
  function visit(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 8 || seen.size >= MAX_TERMINAL_PANES) return null;
    if (node.type === 'leaf') {
      if (typeof node.leafId !== 'string' || !known.has(node.leafId) || seen.has(node.leafId)) return null;
      seen.add(node.leafId); return { type: 'leaf', leafId: node.leafId };
    }
    if (node.type !== 'split' || !['horizontal', 'vertical'].includes(node.direction)) return null;
    const first = visit(node.first, depth + 1), second = visit(node.second, depth + 1);
    if (!first || !second) return first ?? second;
    return { type: 'split', direction: node.direction, ratio: clampSplitRatio(node.ratio), first, second };
  }
  let root = visit(value?.root);
  if (!root && known.has(initialTerminalId)) root = { type: 'leaf', leafId: initialTerminalId };
  const activeLeafId = layoutContainsLeafId(root, value?.activeLeafId) ? value.activeLeafId : firstLayoutLeafId(root);
  return { version: 1, root, activeLeafId };
}

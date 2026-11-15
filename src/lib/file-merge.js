import { diff3Merge } from 'node-diff3';
export const MAX_MERGE_BYTES = 512000, MAX_MERGE_LINES = 8000;
export function mergeLines(text) { return text.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) || []; }
export function planFileMerge(base, mine, disk) {
  for (const text of [base, mine, disk]) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_MERGE_BYTES) throw Error('This comparison is too large. Download your draft and review it in an external editor.');
  }
  if (mine === disk || disk === base) return [{ text: mine }];
  if (mine === base) return [{ text: disk }];
  const arrays = [mine, base, disk].map(mergeLines);
  if (arrays.some(lines => lines.length > MAX_MERGE_LINES)) throw Error('This comparison has too many lines. Use an external editor to merge it.');
  return diff3Merge(...arrays, { excludeFalseConflicts: true }).map((part, index) => part.ok ? { text: part.ok.join('') } : {
    id: String(index), base: part.conflict.o.join(''), mine: part.conflict.a.join(''), disk: part.conflict.b.join(''), line: part.conflict.oIndex + 1,
  });
}
export function renderFileMerge(plan, choices = {}) {
  let unresolved = 0;
  const content = plan.map(part => {
    if ('text' in part) return part.text;
    const choice = choices[part.id];
    if (choice === 'mine') return part.mine;
    if (choice === 'disk') return part.disk;
    if (choice === 'both') return part.mine + (part.mine && part.disk && !/[\r\n]$/.test(part.mine) ? '\n' : '') + part.disk;
    unresolved++; return part.mine;
  }).join('');
  return { content, unresolved };
}

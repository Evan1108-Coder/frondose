// Shared, bounded comparison model. No HTML from repositories is ever rendered.
export function fileKind(path = '') {
  const ext = path.split('.').pop().toLowerCase();
  const types = { js: ['JS', 'javascript'], mjs: ['JS', 'javascript'], cjs: ['JS', 'javascript'], jsx: ['JSX', 'javascript'], ts: ['TS', 'typescript'], tsx: ['TSX', 'typescript'], sql: ['DB', 'database'], prisma: ['DB', 'database'], py: ['PY', 'python'], json: ['{}', 'data'], yaml: ['YML', 'data'], yml: ['YML', 'data'], md: ['MD', 'document'], txt: ['TXT', 'document'], css: ['CSS', 'style'], scss: ['CSS', 'style'], html: ['<>', 'markup'], svg: ['SVG', 'image'], png: ['IMG', 'image'], jpg: ['IMG', 'image'], jpeg: ['IMG', 'image'], webp: ['IMG', 'image'], go: ['GO', 'code'], rs: ['RS', 'code'], sh: ['SH', 'shell'] };
  const [label, type] = types[ext] || ['FILE', 'file']; return { label, type };
}
export function parsePatch(patch = '') {
  let oldLine = 0, newLine = 0, active = false;
  const rows = [];
  for (const text of String(patch).split('\n')) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk) { oldLine = +hunk[1]; newLine = +hunk[3]; active = true; rows.push({ type: 'hunk', text }); continue; }
    if (!active) continue;
    if (text.startsWith('+')) rows.push({ type: 'addition', text: text.slice(1), newLine: newLine++ });
    else if (text.startsWith('-')) rows.push({ type: 'deletion', text: text.slice(1), oldLine: oldLine++ });
    else if (text.startsWith(' ')) rows.push({ type: 'context', text: text.slice(1), oldLine: oldLine++, newLine: newLine++ });
    else if (text.startsWith('\\')) rows.push({ type: 'meta', text });
    else active = false;
  }
  return rows;
}
export function patchFiles(patch = '') {
  const sections = String(patch).split(/(?=^diff --git )/m).filter(part => parsePatch(part).length);
  return sections.slice(0, 200).map((part, index) => {
    const path = /^\+\+\+ (?:b\/)?([^\n\t]+)/m.exec(part)?.[1];
    const oldPath = /^--- (?:a\/)?([^\n\t]+)/m.exec(part)?.[1];
    return { path: path && path !== '/dev/null' ? path : oldPath && oldPath !== '/dev/null' ? oldPath : `change-${index + 1}.patch`, oldPath: oldPath === '/dev/null' ? undefined : oldPath, patch: part, status: 'quoted patch' };
  });
}
export function textPatch(before = '', after = '') {
  if (before === after) return '';
  // Retain the terminator in each token so a final newline is a real change,
  // not a phantom empty line with an extra addition count.
  const a = before.match(/[^\n]*\n|[^\n]+$/g) || [], b = after.match(/[^\n]*\n|[^\n]+$/g) || [];
  const format = (prefix, line) => `${prefix}${line.replace(/\n$/, '')}${line.endsWith('\n') ? '' : '\n\\ No newline at end of file'}`;
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
  const left = a.slice(prefix, a.length - suffix), right = b.slice(prefix, b.length - suffix), body = a.slice(0, prefix).map(line => format(' ', line));
  // LCS is limited to 1M cells; large changes retain exact text using a replace block.
  if ((left.length + 1) * (right.length + 1) <= 1_000_000) {
    const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0, j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) { body.push(format(' ', left[i++])); j++; }
      else if (i < left.length && (j === right.length || table[i + 1][j] >= table[i][j + 1])) body.push(format('-', left[i++]));
      else body.push(format('+', right[j++]));
    }
  } else { for (const line of left) body.push(format('-', line)); for (const line of right) body.push(format('+', line)); }
  for (const line of a.slice(a.length - suffix)) body.push(format(' ', line));
  return `@@ -${a.length ? 1 : 0},${a.length} +${b.length ? 1 : 0},${b.length} @@\n${body.join('\n')}`;
}
export function foldRows(rows, context = 3) {
  const result = [];
  for (let i = 0; i < rows.length;) {
    if (rows[i].type !== 'context') { result.push(rows[i++]); continue; }
    let end = i; while (end < rows.length && rows[end].type === 'context') end++;
    const leading = i === 0 || rows[i - 1].type === 'hunk', trailing = end === rows.length;
    const keepStart = leading ? 0 : context, keepEnd = trailing ? 0 : context;
    if (end - i > keepStart + keepEnd + 2) {
      result.push(...rows.slice(i, i + keepStart), { type: 'fold', key: `${rows[i].oldLine}:${rows[i].newLine}`, rows: rows.slice(i + keepStart, end - keepEnd) }, ...rows.slice(end - keepEnd, end));
    } else result.push(...rows.slice(i, end));
    i = end;
  }
  return result;
}
export function hideWhitespaceChanges(rows) {
  const result = [];
  for (let i = 0; i < rows.length;) {
    if (!['addition', 'deletion'].includes(rows[i].type)) { result.push(rows[i++]); continue; }
    const removed = [], added = [], original = [];
    while (i < rows.length && ['addition', 'deletion', 'meta'].includes(rows[i].type)) { const row = rows[i++]; original.push(row); if (row.type !== 'meta') (row.type === 'addition' ? added : removed).push(row); }
    if (removed.length === added.length && removed.every((row, j) => row.text.replace(/\s/g, '') === added[j].text.replace(/\s/g, ''))) { for (let j = 0; j < added.length; j++) result.push({ ...added[j], oldLine: removed[j].oldLine, type: 'context' }); }
    else { for (const row of original) result.push(row); }
  }
  return result;
}

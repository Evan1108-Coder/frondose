/** Bounded source edits, not HTML commands. Every action remains an unsaved
 * directory draft and uses the existing explicit Save/version guard. */
export function formatMarkdown(content, start, end, action) {
  if (typeof content !== 'string' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > content.length) return null;
  const chosen = content.slice(start, end);
  const pairs = { bold: ['**', '**', 'bold text'], italic: ['_', '_', 'italic text'], code: ['`', '`', 'code'], link: ['[', '](https://)', 'link text'], fence: ['\n```\n', '\n```\n', 'code'] };
  if (pairs[action]) {
    const [before, after, fallback] = pairs[action], text = chosen || fallback;
    return { content: content.slice(0, start) + before + text + after + content.slice(end), start: start + before.length, end: start + before.length + text.length };
  }
  const prefixes = { heading: '## ', bullet: '- ', quote: '> ', numbered: '1. ' };
  if (!prefixes[action]) return null;
  const left = content.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = content.indexOf('\n', end > start ? end - 1 : end), right = lineEnd < 0 ? content.length : lineEnd;
  const lines = content.slice(left, right).split('\n');
  const replacement = lines.map((line, index) => `${action === 'numbered' ? `${index + 1}. ` : prefixes[action]}${line}`).join('\n');
  return { content: content.slice(0, left) + replacement + content.slice(right), start: left, end: left + replacement.length };
}
export function continueMarkdownList(content, start, end) {
  if (start !== end || !Number.isSafeInteger(start) || start < 0 || start > content.length) return null;
  const left = content.lastIndexOf('\n', start - 1) + 1, line = content.slice(left, start);
  const match = /^(\s*)([-+*]|\d+\.)(\s+)(.*)$/.exec(line);
  if (!match) return null;
  if (!match[4].trim()) return { content: content.slice(0, left) + content.slice(start), start: left, end: left };
  const marker = /^\d/.test(match[2]) ? `${Number.parseInt(match[2], 10) + 1}.` : match[2];
  const insert = `\n${match[1]}${marker} `, position = start + insert.length;
  return { content: content.slice(0, start) + insert + content.slice(end), start: position, end: position };
}

export function markdownOutline(content) {
  const result = []; let fenced = false;
  for (const [index, line] of String(content).split('\n').entries()) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    const heading = !fenced && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) result.push({ line: index + 1, level: heading[1].length, title: heading[2].slice(0, 200) });
    if (result.length >= 200) break;
  }
  return result;
}

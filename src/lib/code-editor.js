export function codeLanguage(path = '') {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() || '';
  if (/\.(?:[cm]?js|jsx|ts|tsx)$/.test(name)) return { id: 'javascript', typescript: /\.tsx?$/.test(name), jsx: /\.[jt]sx$/.test(name) };
  if (/\.(?:json|jsonc)$/.test(name)) return { id: 'json' };
  if (/\.(?:css|scss|less)$/.test(name)) return { id: 'css' };
  if (/\.(?:html?|svg|xml)$/.test(name)) return { id: 'html' };
  if (/\.(?:md|mdown|markdown)$/.test(name)) return { id: 'markdown' };
  if (/\.(?:py|pyi|pyw)$/.test(name)) return { id: 'python' };
  if (/\.sql$/.test(name)) return { id: 'sql' };
  return { id: 'plain' };
}
export async function loadCodeLanguage(descriptor) {
  switch (descriptor.id) {
    case 'javascript': return (await import('@codemirror/lang-javascript')).javascript({ typescript: descriptor.typescript, jsx: descriptor.jsx });
    case 'json': return (await import('@codemirror/lang-json')).json();
    case 'css': return (await import('@codemirror/lang-css')).css();
    case 'html': return (await import('@codemirror/lang-html')).html();
    case 'markdown': return (await import('@codemirror/lang-markdown')).markdown();
    case 'python': return (await import('@codemirror/lang-python')).python();
    case 'sql': return (await import('@codemirror/lang-sql')).sql();
    default: return [];
  }
}

// One small external transaction preserves CodeMirror's native history,
// selections and viewport instead of replacing its entire EditorState.
export function sourceReplacement(previous, next) {
  let from = 0, tail = 0;
  while (from < previous.length && from < next.length && previous[from] === next[from]) from++;
  while (tail < previous.length - from && tail < next.length - from && previous[previous.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  return { from, to: previous.length - tail, insert: next.slice(from, next.length - tail) };
}

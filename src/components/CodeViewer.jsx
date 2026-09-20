import { useMemo } from 'react';
import { diffRows, splitDiffRows, useCodeAppearance } from '../lib/code-appearance.js';
import { codeFontFamily } from '../lib/code-fonts.js';
import { codeThemeStyle } from '../lib/code-themes.js';
import './code-fonts.css';
import './code-viewer.css';

const TOKEN = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*$|#.*$|\b(?:const|let|var|function|return|class|import|from|export|async|await|if|else|for|while|new|throw|try|catch|def|in|True|False|None|true|false|null)\b|\b\d+(?:\.\d+)?\b)/g;
function highlight(text, enabled) {
  if (!enabled || text.length > 8000) return text;
  return text.split(TOKEN).map((part, index) => index % 2 ? <span key={index} className={/^['"`]/.test(part) ? 'cv-string' : /^(\/\/|#)/.test(part) ? 'cv-comment' : /^\d/.test(part) ? 'cv-number' : 'cv-keyword'}>{part}</span> : part);
}
export function CodeViewer({ content = '', diff = false, label = 'Code preview', settings: override }) {
  const [preferences] = useCodeAppearance(), settings = override ?? preferences;
  const limited = String(content).split('\n').length > 6000;
  const source = useMemo(() => String(content).split('\n').slice(0, 6000).join('\n'), [content]);
  const rows = useMemo(() => diff ? diffRows(source) : source.split('\n').map((text, index) => ({ text, newLine: index + 1, type: 'context' })), [source, diff]);
  const split = diff && settings.diffLayout === 'split';
  const displayRows = useMemo(() => split ? splitDiffRows(rows) : rows, [rows, split]);
  function line(row, side) {
    if (!row) return <span className="cv-line cv-empty"> </span>;
    const text = diff && ['addition', 'deletion', 'context'].includes(row.type) ? row.text.slice(/^[+\- ]/.test(row.text) ? 1 : 0) : row.text;
    return <span className={`cv-line ${row.type}`}>
      {settings.lineNumbers ? <span className="cv-number-gutter" aria-hidden="true">{side === 'left' ? row.oldLine : row.newLine ?? row.oldLine}</span> : null}
      {diff && settings.diffMarkers ? <span className="cv-diff-marker" aria-hidden="true">{row.type === 'addition' ? '+' : row.type === 'deletion' ? '−' : ' '}</span> : null}
      <code>{highlight(text, settings.syntax)}</code>
    </span>;
  }
  return <div className={`code-viewer ${settings.wrap ? 'cv-wrap' : ''} ${split ? 'cv-split' : ''}`} data-code-theme={settings.theme} data-code-font={settings.font} style={{ ...codeThemeStyle(settings.theme), '--code-size': `${settings.fontSize}px`, '--code-height': settings.lineHeight, '--code-tab': settings.tabSize, '--code-font': codeFontFamily(settings.font) }}>
    <div className="cv-scroll" role="region" aria-label={label} tabIndex={0}>{displayRows.map((row, index) => split ? <div className="cv-pair" key={index}>{line(row.left, 'left')}{line(row.right, 'right')}</div> : <div key={index}>{line(row)}</div>)}</div>
    {limited ? <p className="cv-limit">Preview limited to 6,000 lines. Open the original file for the complete source.</p> : null}
  </div>;
}

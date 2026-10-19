import { useId, useMemo, useState } from 'react';
import { Button, Field, SearchField, Select, useApp } from '../ui.jsx';
import { Database, Settings } from './icons.jsx';
import { highlight } from './CodeViewer.jsx';
import { codeFontFamily } from '../lib/code-fonts.js';
import { codeThemeStyle } from '../lib/code-themes.js';
import { useCodeAppearance, splitDiffRows } from '../lib/code-appearance.js';
import { fileKind, parsePatch, foldRows, hideWhitespaceChanges } from '../lib/change-review.js';
import { safeUrl } from '../lib/model.js';
import './change-review.css';

export function FileTypeIcon({ path }) { const kind = fileKind(path); return <span className={`file-type-icon file-type-${kind.type}`} title={kind.type} aria-label={`${kind.type} file`}>{kind.type === 'database' ? <Database /> : kind.label}</span>; }
export function ChangeReview({ comparison, review, onSave, onComment, onReviewed, onRefresh, onAsk, onGitHubComment, busy = false }) {
  const { navigate } = useApp(), prefix = useId();
  const [settings, saveSettings] = useCodeAppearance();
  const [query, setQuery] = useState(''), [fileQuery, setFileQuery] = useState(''), [selected, setSelected] = useState(null), [comment, setComment] = useState('');
  const [all, setAll] = useState(false), [expanded, setExpanded] = useState({});
  const [rowLimits, setRowLimits] = useState({});
  const files = useMemo(() => comparison.files.map(file => ({ ...file, rows: parsePatch(file.patch) })), [comparison]);
  const shown = files.filter(file => file.path.toLowerCase().includes(fileQuery.toLowerCase()));
  function line(row, file, side) {
    if (!row) return <span className="cv-line cv-empty" />;
    const number = side === 'old' ? row.oldLine : row.newLine ?? row.oldLine, actualSide = side || (row.newLine != null ? 'new' : 'old');
    return <span className={`cv-line ${row.type} ${query && row.text.toLowerCase().includes(query.toLowerCase()) ? 'cr-match' : ''}`}>
      {settings.lineNumbers ? <span className="cv-number-gutter">{number}</span> : null}
      {settings.diffMarkers ? <span className="cv-diff-marker" aria-hidden="true">{row.type === 'addition' ? '+' : row.type === 'deletion' ? '−' : ' '}</span> : null}
      <code>{highlight(row.text, settings.syntax && comparison.source !== 'document', file.path)}</code>
      {number != null && (onComment || onAsk || onGitHubComment) ? <button className="cr-line-action" aria-label={`Discuss ${file.path} ${actualSide} line ${number}`} onClick={() => { setSelected({ path: file.path, side: actualSide, line: number, text: row.text }); setComment(''); }}>+</button> : null}
    </span>;
  }
  function renderRows(file) {
    const rows = settings.hideWhitespace ? hideWhitespaceChanges(file.rows) : file.rows;
    const unfolded = (all || query ? rows : foldRows(rows)).flatMap(row => row.type === 'fold' && expanded[`${file.path}:${row.key}`] ? row.rows : [row]);
    const limit = rowLimits[file.path] || 1000, display = unfolded.slice(0, limit);
    const fold = row => <button className="cr-fold" onClick={() => setExpanded(value => ({ ...value, [`${file.path}:${row.key}`]: true }))}>{row.rows.length} unchanged lines · Expand</button>;
    return <>{settings.diffLayout === 'split' ? splitDiffRows(display).map((pair, i) => pair.left?.type === 'fold' ? <div key={i}>{fold(pair.left)}</div> : <div className="cv-pair" key={i}>{line(pair.left, file, 'old')}{line(pair.right, file, 'new')}</div>) : display.map((row, i) => <div key={i}>{row.type === 'fold' ? fold(row) : line(row, file)}</div>)}{unfolded.length > limit ? <button className="cr-fold" onClick={() => setRowLimits(value => ({ ...value, [file.path]: limit + 1000 }))}>{unfolded.length - limit} more rows · Show next 1,000</button> : null}</>;
  }
  return <section className="change-review" aria-label="Changes and review">
    <header className="cr-heading"><div><h3>{comparison.title}</h3><p><code>{comparison.base}</code> → <code>{comparison.head}</code></p></div><span>{files.length} changed {files.length === 1 ? 'file' : 'files'}</span></header>
    <div className="cr-toolbar"><SearchField label="Find in changes" placeholder="Find in changes…" value={query} onChange={setQuery} /><Select label="Diff layout" value={settings.diffLayout} onChange={diffLayout => saveSettings({ diffLayout })}><option value="unified">Unified</option><option value="split">Side by side</option></Select><Button onClick={() => saveSettings({ wrap: !settings.wrap })}>{settings.wrap ? 'Disable wrapping' : 'Wrap lines'}</Button><Button aria-pressed={settings.hideWhitespace} onClick={() => saveSettings({ hideWhitespace: !settings.hideWhitespace })}>Hide whitespace</Button><Button onClick={() => setAll(value => !value)}>{all ? 'Collapse context' : 'Expand context'}</Button><Button icon={Settings} onClick={() => navigate('settings', 'code-reviews')}>Code style</Button></div>
    <p className="cr-notice">{comparison.notice}{comparison.limited ? ' Preview is limited; this is not a complete review.' : ''}</p>
    {safeUrl(comparison.url) ? <p><a href={safeUrl(comparison.url)} target="_blank" rel="noopener noreferrer">Open pull request on GitHub ↗</a></p> : null}
    <div className="cr-actions">{!review && onSave ? <Button busy={busy} onClick={onSave}>Save review snapshot</Button> : null}{onRefresh ? <Button busy={busy} onClick={onRefresh}>{review ? 'Check for newer changes' : 'Refresh comparison'}</Button> : null}{review ? <span>Saved {new Date(review.created_at).toLocaleString()} · {review.reviewed.length}/{files.length} reviewed</span> : null}</div>
    {!files.length ? <p className="cr-empty">No changes in this comparison.</p> : <div className="cr-layout"><aside className="cr-file-list"><SearchField label="Filter changed files" placeholder="Filter files…" value={fileQuery} onChange={setFileQuery} />{shown.map(file => <button key={file.path} onClick={() => document.getElementById(`${prefix}-${file.path}`)?.scrollIntoView({ block: 'nearest' })}><FileTypeIcon path={file.path} /><span>{file.path}</span>{review?.reviewed.includes(file.path) ? <small>✓</small> : null}</button>)}</aside><div className="cr-files">{shown.map(file => <section className="cr-file" id={`${prefix}-${file.path}`} key={file.path}><header><FileTypeIcon path={file.path} /><strong>{file.path}</strong><small>{file.status}</small><b className="cr-added">+{file.additions ?? file.rows.filter(row => row.type === 'addition').length}</b><b className="cr-deleted">−{file.deletions ?? file.rows.filter(row => row.type === 'deletion').length}</b>{review && onReviewed ? <label><input type="checkbox" checked={review.reviewed.includes(file.path)} disabled={busy} onChange={e => onReviewed(file.path, e.target.checked)} />Reviewed</label> : null}</header>{file.oldPath && file.oldPath !== file.path ? <p>Renamed from {file.oldPath}</p> : null}{file.unavailable ? <p>{file.unavailable}</p> : <div className={`code-viewer ${settings.wrap ? 'cv-wrap' : ''}`} data-code-theme={settings.theme} style={{ ...codeThemeStyle(settings.theme), '--code-size': `${settings.fontSize}px`, '--code-height': settings.lineHeight, '--code-tab': settings.tabSize, '--code-font': codeFontFamily(settings.font) }}><div className="cv-scroll" tabIndex={0} role="region" aria-label={`Diff for ${file.path}`}>{renderRows(file)}</div></div>}</section>)}</div></div>}
    {selected ? <section className="cr-discussion"><h4>{selected.path} · {selected.side} line {selected.line}</h4><pre>{selected.text}</pre><Field label="Review comment or agent question"><textarea value={comment} maxLength={10000} onChange={e => setComment(e.target.value)} /></Field><div className="cr-actions">{review && onComment ? <Button busy={busy} disabled={!comment.trim()} onClick={async () => { try { await onComment({ ...selected, body: comment }); setComment(''); } catch { /* Parent displays the failure; preserve the draft. */ } }}>Save line comment in Talvori</Button> : <p>Save a snapshot to comment on an exact version.</p>}{onGitHubComment ? <Button disabled={!comment.trim()} onClick={() => onGitHubComment({ ...selected, body: comment })}>Review this line on GitHub…</Button> : null}{onAsk ? <Button disabled={!comment.trim()} onClick={() => onAsk({ ...selected, body: comment })}>Prepare agent follow-up</Button> : null}<Button onClick={() => setSelected(null)}>Close</Button></div></section> : null}
    {review?.comments.length ? <section className="cr-discussion"><h4>Talvori review comments</h4>{review.comments.map(item => <article key={item.id}><strong>{item.path} · {item.side} line {item.line}</strong><p>{item.body}</p><small>{item.author_name} · {new Date(item.created_at).toLocaleString()} · saved version</small></article>)}</section> : null}
    {comparison.source === 'github' ? <section className="cr-discussion"><h4>GitHub checks and reviews</h4>{comparison.checksUnavailable ? <p>Checks could not be retrieved with this connection.</p> : (comparison.checks || []).map(check => <p key={check.id}>{check.name} · {check.status}</p>)}{(comparison.reviews || []).map(item => <article key={item.id}><strong>{item.author} · {item.state}{item.commit !== comparison.head ? ' · earlier commit' : ''}</strong><p>{item.body}</p></article>)}{(comparison.comments || []).map(item => <article key={item.id}><strong>{item.author} · {item.path}:{item.line || 'previous line'}{item.outdated ? ' · outdated' : ''}</strong><p>{item.body}</p></article>)}</section> : null}
  </section>;
}

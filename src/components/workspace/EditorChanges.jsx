import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../data/api.js';
import { localGitApiPath } from '../../lib/local-git.js';
import { observedContentDiff, recentEditorObservation, useEditorChanges } from '../../lib/editor-changes.js';
import { CodeViewer, highlight } from '../CodeViewer.jsx';
import { useCodeAppearance } from '../../lib/code-appearance.js';
import { codeFontFamily } from '../../lib/code-fonts.js';
import { codeThemeStyle } from '../../lib/code-themes.js';
import { ChevronDown } from '../icons.jsx';

export function useEditorRepository(workspaceId, bindingVersion) {
  const [repository, setRepository] = useState(null), [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = event => { if (event.detail?.workspaceId === workspaceId) setRevision(value => value + 1); };
    window.addEventListener('frondose:repository-connected', refresh);
    return () => window.removeEventListener('frondose:repository-connected', refresh);
  }, [workspaceId]);
  useEffect(() => {
    const controller = new AbortController(); setRepository(null);
    apiRequest(localGitApiPath(workspaceId), { signal: controller.signal }).then(({ result }) => { if (!controller.signal.aborted && result.bindingVersion === bindingVersion) setRepository(result); }).catch(() => {});
    return () => controller.abort();
  }, [workspaceId, bindingVersion, revision]);
  return repository;
}

export function EditorViewSelector({ mode, onChange, blameEnabled }) {
  const [open, setOpen] = useState(false), root = useRef(null), trigger = useRef(null), openedByClick = useRef(false), menuId = useId();
  const close = () => { openedByClick.current = false; setOpen(false); };
  const items = () => [...(root.current?.querySelectorAll('[role="menuitemradio"]:not(:disabled)') || [])];
  const showAndFocus = () => { openedByClick.current = true; setOpen(true); requestAnimationFrame(() => items()[0]?.focus()); };
  return <div className="directory-content-modes" role="group" aria-label="File view">
    <button type="button" aria-pressed={mode === 'code'} onClick={() => onChange('code')}>Code</button>
    <div ref={root} className="directory-changes-picker" onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!openedByClick.current && !root.current?.contains(document.activeElement)) close(); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); trigger.current?.focus(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const enabled = items(); if (!open) return showAndFocus();
        const index = enabled.indexOf(document.activeElement), next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + enabled.length) % enabled.length; enabled[next]?.focus();
      }
    }}>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} aria-pressed={mode !== 'code'} onClick={() => { const next = !openedByClick.current; openedByClick.current = next; setOpen(next); }}>Changes{mode !== 'code' ? ` · ${mode === 'recent' ? 'Recent' : 'Blame'}` : ''}<ChevronDown/></button>
      {open ? <div id={menuId} className="directory-changes-menu" role="menu" aria-label="Changes source">
        <button type="button" role="menuitemradio" aria-checked={mode === 'recent'} onClick={() => { onChange('recent'); close(); trigger.current?.focus(); }}>Recent</button>
        <button type="button" role="menuitemradio" aria-checked={mode === 'blame'} disabled={!blameEnabled} title={!blameEnabled ? 'Connect this directory to GitHub to enable Blame' : 'Read committed HEAD history from local Git'} onClick={() => { onChange('blame'); close(); trigger.current?.focus(); }}>Blame{!blameEnabled ? <small>Connect GitHub first</small> : null}</button>
      </div> : null}
    </div>
  </div>;
}

export function RecentFileChanges({ observationKey, content, observationEpoch }) {
  const [settings] = useEditorChanges(), [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const observed = recentEditorObservation(observationKey, content, settings.recentMinutes, now);
  const diff = useMemo(() => observed?.changed ? observedContentDiff(observed.before, observed.after) : null, [observed?.before, observed?.after, observationEpoch]);
  return <section className="directory-changes-view" aria-label="Recent observed file changes"><div className="directory-changes-note"><strong>Recent · {settings.recentMinutes} {settings.recentMinutes === 1 ? 'minute' : 'minutes'}</strong><p>{observed ? <>Compared with the version observed at {new Date(observed.baselineAt).toLocaleTimeString()}. {observed.partial ? 'Tracking covers only the available app-memory history, not the full interval.' : 'Only changes observed in this app are included.'}</> : 'No observation is available yet. Opened-file tracking is local, bounded and begins when Frondose reads the file.'}</p><p>External disk edits are not watched in this view. Unsaved editor changes are included; no file or GitHub content is modified.</p></div>{diff?.content ? <><CodeViewer content={diff.content} diff label="Recent observed changes"/>{diff.limited ? <p className="directory-changes-note" role="status">Diff preview limited to 1,200 changed/context lines. The editor still holds the full draft.</p> : null}</> : <p className="directory-changes-empty" role="status">No different content observed in this interval.</p>}</section>;
}

export function FileBlame({ workspaceId, bindingVersion, path, repository }) {
  const [result, setResult] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [settings] = useCodeAppearance();
  useEffect(() => {
    setResult(null); setError(null);
    if (!repository?.connected || repository.bindingVersion !== bindingVersion) { setBusy(false); return; }
    const controller = new AbortController(); setBusy(true);
    apiRequest(localGitApiPath(workspaceId, 'file-blame'), { method: 'POST', signal: controller.signal, body: { workspace_id: workspaceId, path, expected_version: repository.version, expected_binding_version: bindingVersion, confirmed: true } }).then(({ result: next }) => { if (!controller.signal.aborted) setResult(next); }).catch(cause => { if (!controller.signal.aborted) setError(cause); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [workspaceId, bindingVersion, path, repository?.connected, repository?.version, revision]);
  return <section className="directory-changes-view directory-blame-view" aria-label="Committed file blame"><div className="directory-changes-note"><strong>Blame · committed HEAD</strong><p>Read-only local Git history. This is the committed file, not unsaved edits or the current working copy.</p>{result ? <p>Commit {result.head?.slice(0, 12)}{result.limited ? ' · Preview limited' : ''}</p> : null}</div>{!repository?.connected ? <p className="directory-changes-empty">Connect this directory to GitHub to use Blame.</p> : busy ? <p className="directory-changes-empty" role="status">Reading local Git history…</p> : error ? <div className="directory-changes-note" role="alert"><p>{error.message}</p><button type="button" onClick={() => setRevision(value => value + 1)}>Retry local blame</button></div> : result ? <div className={`code-viewer directory-blame-lines${settings.wrap ? ' directory-blame-wrap' : ''}`} data-code-theme={settings.theme} style={{ ...codeThemeStyle(settings.theme), '--code-size': `${settings.fontSize}px`, '--code-height': settings.lineHeight, '--code-font': codeFontFamily(settings.font) }} tabIndex={0} role="region" aria-label="Blame lines">{result.lines.map(line => <div className="directory-blame-line" key={line.line}><span className="directory-blame-author" title={`${line.commit}\n${line.author}\n${line.authoredAt}\n${line.summary}`}><b>{line.commit?.slice(0, 8)}</b><span>{line.author}</span><small>{line.summary}</small></span>{settings.lineNumbers ? <span className="directory-blame-number">{line.line}</span> : null}<code>{highlight(line.text, settings.syntax, path)}</code></div>)}</div> : null}</section>;
}

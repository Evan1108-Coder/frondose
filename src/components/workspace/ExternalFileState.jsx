import { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '../../ui.jsx';
import { useUnsavedUpdate } from '../UnsavedUpdates.jsx';
import { directoryDraftDirty } from '../../lib/directory-drafts.js';
import { generatedMergeReview, sameDraft } from '../../lib/external-file-policy.js';
import { listRecovery } from '../../lib/file-recovery.js';
import { mergeFileInWorker } from '../../lib/file-merge-worker.js';
import { renderFileMerge } from '../../lib/file-merge.js';
import { SourceCodeEditor } from './SourceCodeEditor.jsx';
import './external-files.css';

const LABELS = { current: 'Up to date', changed: 'Changed on disk', readonly: 'Read-only', unavailable: 'Unavailable', unsupported: 'Not editable' };
function download(content, path, suffix = 'draft') {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${path.split(/[\\/]/).at(-1)}.${suffix}.txt`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ExternalFileState({ draft, state, sync }) {
  if (!draft.loaded || draft.isNew) return null;
  const status = draft.diskState?.status, label = LABELS[status] || 'Checking disk';
  return <><button type="button" className={`external-file-badge external-file-${status || 'checking'}`} aria-label={`File state: ${label}`} title="Review disk state and local recovery copies" onClick={() => sync.setOpen(true)}><span aria-hidden="true" />{label}</button>
    {sync.open ? <FileStateReview draft={draft} state={state} sync={sync} onClose={() => sync.setOpen(false)} /> : null}</>;
}
function FileStateReview({ draft, state, sync, onClose }) {
  const [comparison, setComparison] = useState(null), [plan, setPlan] = useState(null), [choices, setChoices] = useState({});
  const [result, setResult] = useState(''), [manual, setManual] = useState(false), [view, setView] = useState('result');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copies, setCopies] = useState([]), [copyError, setCopyError] = useState('');
  const [confirm, setConfirm] = useState(null), request = useRef(null), mounted = useRef(true), locked = useRef(false);
  useUnsavedUpdate(manual, busy || sync.busy);
  const readCopies = () => listRecovery(sync.scope).then(items => { if (mounted.current) { setCopies(items); setCopyError(''); } }).catch(cause => { if (mounted.current) setCopyError(cause.message); });
  useEffect(() => { mounted.current = true; void readCopies(); return () => { mounted.current = false; request.current?.abort(); }; }, [sync.scope]);
  const rebuild = async () => {
    if (locked.current) return;
    locked.current = true; request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setPlan(null); setComparison(null); setManual(false); setChoices({});
    try {
      const disk = await sync.readDisk(controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      if (disk.unsupported || typeof disk.content !== 'string') throw Error('The disk file is not supported as text. Download your draft to keep working in another editor.');
      const captured = { ...state.current }; setComparison({ captured, disk });
      const planned = await mergeFileInWorker(captured.baseline, captured.content, disk.content, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setPlan(planned); setResult(renderFileMerge(planned).content);
    } catch (cause) { if (!controller.signal.aborted && mounted.current) setError(cause.message); }
    finally { locked.current = false; if (!controller.signal.aborted && mounted.current) setBusy(false); }
  };
  useEffect(() => { void rebuild(); }, []);
  const merged = plan ? renderFileMerge(plan, choices) : null;
  const stale = comparison && (!sameDraft(draft, comparison.captured) || (draft.diskState?.snapshot && draft.diskState.snapshot.version !== comparison.disk.version));
  const perform = async (content, reason) => {
    if (!comparison || locked.current || busy || sync.busy) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const applied = await sync.apply(comparison.captured, comparison.disk, content, reason);
      if (applied && mounted.current) { setManual(false); onClose(); }
    } catch (cause) { if (mounted.current) setError(cause.message); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const choose = (id, value) => { const next = { ...choices, [id]: value }; setChoices(next); setResult(renderFileMerge(plan, next).content); setManual(false); };
  const requestClose = () => manual ? setConfirm('close') : onClose();
  const rebuildClicked = () => manual ? setConfirm('rebuild') : void rebuild();
  const currentStatus = draft.diskState;
  const previews = comparison ? { base: comparison.captured.baseline, mine: comparison.captured.content, disk: comparison.disk.content, result } : {};
  return <Dialog title="File state" subtitle={draft.path} wide onClose={requestClose} closeDisabled={busy || sync.busy} className="external-file-dialog">
    <div className="external-file-review-body">
      <div className="external-file-review-heading"><span role="status">{LABELS[currentStatus?.status] || 'Checking disk'}{currentStatus?.checkedAt ? ` · Checked ${new Date(currentStatus.checkedAt).toLocaleTimeString()}` : ''}</span><Button disabled={busy || sync.busy} onClick={rebuildClicked}>Recheck & compare</Button></div>
      {currentStatus?.status === 'unavailable' ? <p>The file may have moved, been deleted, or become inaccessible. Your draft is still here. Recheck after restoring access.</p> : null}
      {currentStatus?.status === 'readonly' ? <p>The file has read-only permission bits. Your draft can still be edited or downloaded; saving requires writable disk permissions.</p> : null}
      {generatedMergeReview(draft.path) ? <p>Generated lockfile: always review changes. Regenerating it with its package manager may be safer than combining edits.</p> : null}
      <p>Merging changes only this draft. Nothing is written to disk until you press Save.</p>
      {error || sync.recoveryError ? <p className="directory-error" role="alert">{error || sync.recoveryError}</p> : null}
      {busy ? <p role="status">Checking and preparing comparison…</p> : null}
      {stale ? <p role="alert">The draft or disk changed since this comparison. Recheck before applying.</p> : null}
      {comparison ? <>
        <div className="external-file-preview-tabs" role="group" aria-label="File comparison version">{[['base', 'Original'], ['mine', 'Your draft'], ['disk', 'Disk'], ['result', 'Merge result']].map(([key, title]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}>{title}</button>)}</div>
        <div className="external-file-preview" key={view}><SourceCodeEditor path={`${view === 'result' ? 'Merge result' : view === 'base' ? 'Original' : view === 'mine' ? 'Your draft' : 'Disk'} — ${draft.path}`} value={previews[view] || ''} readOnly /></div>
        {plan?.filter(part => !('text' in part)).map((part, index) => <fieldset className="external-file-conflict" key={part.id}><legend>Conflict {index + 1} · original line {part.line}</legend><div className="external-file-conflict-versions"><div><strong>Your draft</strong><pre>{part.mine || '(removed)'}</pre></div><div><strong>Disk</strong><pre>{part.disk || '(removed)'}</pre></div></div><div className="external-file-actions">{[['mine', 'Use mine'], ['disk', 'Use disk'], ['both', 'Keep both']].map(([key, title]) => <button key={key} type="button" disabled={busy || manual} aria-pressed={choices[part.id] === key} onClick={() => choose(part.id, key)}>{title}</button>)}</div></fieldset>)}
        {merged?.unresolved ? <p role="status">{merged.unresolved} overlapping edit{merged.unresolved === 1 ? '' : 's'} to resolve. The result temporarily shows your side until you choose.</p> : <p>Apply the result as a draft to make any further edits in the main editor.</p>}
        <div className="external-file-actions"><Button disabled={!plan || Boolean(merged?.unresolved) || stale || busy || sync.busy} onClick={() => void perform(result, 'before reviewed merge')}>Use merged draft</Button><Button disabled={stale || busy || sync.busy} onClick={() => setConfirm('mine')}>Keep my draft</Button><Button disabled={stale || busy || sync.busy} onClick={() => directoryDraftDirty(comparison.captured) || manual ? setConfirm('reload') : void perform(comparison.disk.content, 'before reload')}>Reload disk</Button></div>
      </> : null}
      <div className="external-file-actions"><Button onClick={() => download(state.current.content, draft.path)}>Download my draft</Button>{manual ? <Button onClick={() => download(result, draft.path, 'merge')}>Download merge result</Button> : null}</div>
      <details className="external-file-recovery" onToggle={event => { if (event.currentTarget.open) void readCopies(); }}><summary>Local recovery copies ({copies.length})</summary><p>Text copies for this file and workspace directory only. Restoring creates an unsaved draft; it never restores filesystem permissions or overwrites disk.</p>{copyError ? <p role="alert">{copyError}</p> : null}{!copies.length && !copyError ? <p>No recovery copies yet.</p> : null}{copies.map(copy => <div className="external-file-copy" key={copy.id}><span>{new Date(copy.at).toLocaleString()} · {copy.reason}</span><div className="external-file-actions"><Button disabled={!comparison || stale || busy || sync.busy} onClick={() => setConfirm({ restore: copy })}>Restore as draft</Button><Button onClick={() => download(copy.content, draft.path, 'recovery')}>Download</Button></div></div>)}</details>
    </div>
    {confirm ? <Dialog title={confirm === 'close' || confirm === 'rebuild' ? 'Discard this merge result?' : confirm === 'mine' ? 'Keep your version?' : confirm?.restore ? 'Restore recovery copy?' : 'Reload from disk?'} onClose={() => setConfirm(null)}>
      <p>{confirm === 'mine' ? 'Your draft will remain unsaved. The next Save will replace the disk version with your draft.' : confirm?.restore ? 'This replaces the current draft with the selected local copy. Disk is not changed.' : confirm === 'reload' ? 'This replaces your current draft with the checked disk version.' : 'The edited merge result has not been applied. Your original file draft is kept.'}{sync.settings.recovery && !['close', 'rebuild'].includes(confirm) ? ' A recovery copy of your current draft will be kept first.' : ''}</p>
      <div className="external-file-actions"><Button onClick={() => setConfirm(null)}>Cancel</Button><Button onClick={() => { const action = confirm; setConfirm(null); if (action === 'close') onClose(); else if (action === 'rebuild') void rebuild(); else void perform(action === 'mine' ? comparison.captured.content : action?.restore ? action.restore.content : comparison.disk.content, action?.restore ? 'before recovery restore' : 'before replacing draft'); }}>Continue</Button></div>
    </Dialog> : null}
  </Dialog>;
}

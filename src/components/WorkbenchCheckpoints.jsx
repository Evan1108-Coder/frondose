import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, Dialog, ErrorMessage, Field, Select, useApp } from '../ui.jsx';
import { Form } from './Form.jsx';
import { ChangeReview, FileTypeIcon } from './ChangeReview.jsx';
import { CodeViewer } from './CodeViewer.jsx';
import { requestUpdateNavigation, useUnsavedUpdate } from './UnsavedUpdates.jsx';
import { checkpointCapturePaths, checkpointComparison, checkpointDeliveryUncertain, checkpointFileMode, checkpointPreviewInvalidated, checkpointRestoreBlock, checkpointRestoreOutcome, checkpointRestorePayload, checkpointRestoreRequest } from '../lib/workbench-checkpoints.js';
import './workbench-checkpoints.css';

const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Time not recorded';
const bytes = value => Number.isSafeInteger(value) && value >= 0 ? `${value.toLocaleString()} bytes` : 'Size unavailable';
const kind = value => ({ manual: 'Manual checkpoint', pre_restore: 'Pre-restore recovery', before_run: 'Before-run checkpoint', after_run: 'After-run checkpoint' })[value] || 'Recorded checkpoint';

function useCheckpointRead(path, revision = 0) {
  const [state, setState] = useState({ path: null, loading: false, result: null, error: null });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController(); setState({ path, loading: true, result: null, error: null });
    apiRequest(path, { signal: controller.signal }).then(({ result }) => { if (!controller.signal.aborted) setState({ path, loading: false, result, error: null }); }).catch(error => { if (!controller.signal.aborted) setState({ path, loading: false, result: null, error }); });
    return () => controller.abort();
  }, [path, revision]);
  return state.path === path ? state : { loading: Boolean(path), result: null, error: null };
}

export function WorkbenchCheckpoints({ scope, projectName, environments = [], captureReady, onClose, onRestored }) {
  const { notify } = useApp();
  const [view, setView] = useState({ type: 'list' }), [revision, setRevision] = useState(0);
  const bodyRef = useRef(null), headingRef = useRef(null), previousView = useRef('list');
  const query = new URLSearchParams({ workspace_id: scope.workspaceId, project_id: scope.projectId });
  const list = useCheckpointRead(view.type === 'list' ? `/api/workbench/checkpoints?${query}` : null, revision);
  const checkpoints = Array.isArray(list.result) ? list.result : [];
  const environmentName = id => id ? environments.find(environment => environment.id === id)?.name || `Saved environment ${id}` : 'Project folder';
  const viewKey = `${view.type}:${view.id || ''}`;
  useEffect(() => {
    if (previousView.current === viewKey) return;
    previousView.current = viewKey; headingRef.current?.focus({ preventScroll: true });
    if (bodyRef.current) { bodyRef.current.scrollTop = 0; bodyRef.current.scrollLeft = 0; }
  }, [viewKey]);
  const changeView = next => requestUpdateNavigation(() => setView(next));
  function captured(result) { setRevision(value => value + 1); setView({ type: 'detail', id: result.id }); notify('Checkpoint captured. Working files were not changed.'); }
  return <Dialog title={`${projectName} · checkpoints`} subtitle="Bounded working-file recovery. Never a full backup or automatic rollback." wide onClose={() => requestUpdateNavigation(onClose)}><div className="wb-checkpoints-dialog" ref={bodyRef}>
    <h3 ref={headingRef} tabIndex={-1}>{view.type === 'capture' ? 'Capture a manual checkpoint' : view.type === 'detail' ? 'Inspect a saved checkpoint' : 'Project checkpoints'}</h3>
    {view.type === 'list' ? <><CheckpointLimits /><div className="wb-checkpoint-actions"><Button disabled={list.loading} onClick={() => setRevision(value => value + 1)}>Refresh checkpoints</Button><Button variant="primary" disabled={!captureReady} onClick={() => changeView({ type: 'capture' })}>Capture checkpoint</Button></div>{!captureReady ? <p>Capture requires a linked, available Git repository in the selected Workbench environment. Link or select that folder before capturing files.</p> : null}<p>Capture environment: {environmentName(scope.environmentId)}. This list includes up to the 100 newest checkpoints across this project’s saved environments; older records are not listed here.</p><ErrorMessage error={list.error} />{list.loading ? <p role="status">Loading saved project checkpoints…</p> : list.result ? <div className="wb-checkpoint-list">{checkpoints.length ? checkpoints.map(checkpoint => <button type="button" className="wb-checkpoint-row" key={checkpoint.id} onClick={() => changeView({ type: 'detail', id: checkpoint.id })}><strong>{kind(checkpoint.kind)} · {stamp(checkpoint.created_at)}</strong><span>{environmentName(checkpoint.environment_id)} · {checkpoint.file_count} recorded paths · {bytes(checkpoint.byte_size)}</span><small>{checkpoint.limited || !checkpoint.complete ? 'Limited capture' : 'Bounded capture'} · {checkpoint.id}</small></button>) : <p>No saved checkpoints were returned for this project. Captures are manual; opening Workbench does not create one.</p>}</div> : null}<footer className="form-submit-row"><Button onClick={() => requestUpdateNavigation(onClose)}>Close</Button></footer></> : view.type === 'capture' ? <CaptureCheckpoint scope={scope} environmentName={environmentName(scope.environmentId)} onBack={() => changeView({ type: 'list' })} onCaptured={captured} /> : <CheckpointDetail key={view.id} id={view.id} scope={scope} environmentName={environmentName} bodyRef={bodyRef} onBack={() => changeView({ type: 'list' })} onOpen={id => changeView({ type: 'detail', id })} onRestored={result => { setRevision(value => value + 1); onRestored?.(result); }} />}
  </div></Dialog>;
}

function CheckpointLimits() {
  return <p>Captures store regular UTF-8 text files from a linked Git repository: up to 200 files, 512,000 bytes per file and 2,000,000 bytes total. The default scan considers tracked and unignored untracked files. Workbench-private paths, binaries, symlinks, ignored or otherwise omitted files are not a full recoverable backup. Capture is not a simultaneous filesystem snapshot. Restore handles at most 50 selected paths, requires existing parent folders, and never resets the Git index, commits or branches.</p>;
}

function CaptureCheckpoint({ scope, environmentName, onBack, onCaptured }) {
  const [mode, setMode] = useState('automatic'), [pathsText, setPathsText] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [saved, setSaved] = useState(null), [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false), delivered = useRef(false), parsed = checkpointCapturePaths(pathsText);
  useUnsavedUpdate(!saved && Boolean(pathsText || confirmed), busy);
  useEffect(() => { if (saved && !busy && !delivered.current) { delivered.current = true; onCaptured(saved); } }, [saved, busy, onCaptured]);
  async function capture() {
    if (inFlight.current || !confirmed || uncertain || saved || mode === 'selected' && parsed.error) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const { result } = await apiRequest('/api/workbench/checkpoints', { method: 'POST', body: { workspace_id: scope.workspaceId, project_id: scope.projectId, environment_id: scope.environmentId || null, ...(mode === 'selected' ? { paths: parsed.paths } : {}) } });
      if (!result?.id || result.workspace_id !== scope.workspaceId || result.project_id !== scope.projectId) throw Object.assign(new Error('The server returned an unexpected capture result. Refresh the checkpoint list before trying again.'), { code: 'invalid_response' });
      setSaved(result);
    } catch (problem) { setError(problem); setUncertain(checkpointDeliveryUncertain(problem)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Form className="wb-checkpoint-form" onSubmit={event => { event.preventDefault(); void capture(); }}><p>This saves eligible file contents in Talvori’s local checkpoint store for <strong>{environmentName}</strong>. It reads the linked folder and uses read-only Git inspection. It does not edit working files, create a commit, execute project scripts, start a terminal or contact a provider.</p><CheckpointLimits />
    <Select label="Files to capture" value={mode} disabled={busy || uncertain} onChange={value => { setMode(value); setConfirmed(false); }}><option value="automatic">Eligible files from the Git file list</option><option value="selected">Specific relative file paths</option></Select>
    {mode === 'selected' ? <><Field label="Relative paths, one per line" hint="A missing regular file path can record an absent state. Restoring that state later deletes a file at that exact path after confirmation."><textarea required rows={6} value={pathsText} maxLength={200000} disabled={busy || uncertain} onChange={event => { setPathsText(event.target.value); setConfirmed(false); }} /></Field><p>{parsed.paths.length} selected paths{parsed.error ? ` · ${parsed.error}` : ''}</p></> : <p>The bounded scan may omit unsupported or oversized files. The saved manifest reports the paths actually captured; no promise is made about omitted files.</p>}
    <label className="wb-checkpoint-check"><input type="checkbox" checked={confirmed} disabled={busy || uncertain} onChange={event => setConfirmed(event.target.checked)} /><span>I want to save these bounded local file contents. I understand this is not a complete repository backup.</span></label><ErrorMessage error={error} />{uncertain ? <p className="wb-checkpoint-warning" role="status">Capture delivery is uncertain and a checkpoint may already exist. Return to the list and refresh before creating another; capture is not automatically retried.</p> : null}<footer className="form-submit-row"><Button disabled={busy} onClick={onBack}>Back to checkpoints</Button><Button type="submit" variant="primary" busy={busy} disabled={!confirmed || uncertain || Boolean(saved) || mode === 'selected' && Boolean(parsed.error)}>Save checkpoint</Button></footer>
  </Form>;
}

function CheckpointDetail({ id, scope, environmentName, bodyRef, onBack, onOpen, onRestored }) {
  const [revision, setRevision] = useState(0), [selected, setSelected] = useState([]), [query, setQuery] = useState('');
  const [preview, setPreview] = useState(null), [previewBusy, setPreviewBusy] = useState(false), [error, setError] = useState(null), [confirmed, setConfirmed] = useState(false), [previewStale, setPreviewStale] = useState(false);
  const [busy, setBusy] = useState(false), [result, setResult] = useState(null), [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false), previewRequest = useRef(null), request = useRef(null), delivered = useRef(false), phaseHeading = useRef(null), previousPhase = useRef('selection');
  const state = useCheckpointRead(`/api/workbench/checkpoints/${encodeURIComponent(id)}`, revision);
  const checkpoint = state.result?.workspace_id === scope.workspaceId && state.result?.project_id === scope.projectId && state.result?.id === id ? state.result : null;
  const mismatch = state.result && !checkpoint ? new Error('The returned checkpoint does not match this project.') : null;
  const files = checkpoint?.files || [], eligible = files.filter(file => ['present', 'absent'].includes(file.state));
  const block = previewStale ? 'This preview is no longer current. Return to file selection and obtain a fresh preview before confirming another restore.' : checkpointRestoreBlock(preview, scope, id), locked = busy || previewBusy || uncertain;
  const phase = result ? 'result' : preview ? 'preview' : 'selection';
  const comparison = useMemo(() => preview ? checkpointComparison(preview) : null, [preview]);
  useUnsavedUpdate(!result && Boolean(selected.length || preview || confirmed), busy || previewBusy);
  useEffect(() => () => previewRequest.current?.abort(), []);
  useEffect(() => {
    if (previousPhase.current === phase) return;
    previousPhase.current = phase; phaseHeading.current?.focus({ preventScroll: true });
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [phase, bodyRef]);
  useEffect(() => { if (result && !busy && !delivered.current) { delivered.current = true; onRestored(result); } }, [result, busy, onRestored]);
  async function inspect() {
    if (!selected.length || selected.length > 50 || locked) return;
    const controller = new AbortController(); previewRequest.current?.abort(); previewRequest.current = controller;
    setPreviewBusy(true); setError(null); setConfirmed(false); setPreviewStale(false); request.current = null;
    try {
      const response = await apiRequest(`/api/workbench/checkpoints/${encodeURIComponent(id)}/preview`, { method: 'POST', body: { paths: [...selected].sort() }, signal: controller.signal });
      if (response.result?.checkpoint?.id !== id || response.result.checkpoint.workspace_id !== scope.workspaceId || response.result.checkpoint.project_id !== scope.projectId || !Array.isArray(response.result.files)) throw new Error('The preview does not match this project checkpoint. No restore is available.');
      if (JSON.stringify(response.result.files.map(file => file.path).sort()) !== JSON.stringify([...selected].sort())) throw new Error('The preview paths differ from your selection. Select the files and preview again.');
      if (!controller.signal.aborted) setPreview(response.result);
    } catch (problem) { if (!controller.signal.aborted) setError(problem); }
    finally { if (!controller.signal.aborted) setPreviewBusy(false); }
  }
  async function restore() {
    if (inFlight.current || result || !uncertain && (!confirmed || block)) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      if (!uncertain) request.current = checkpointRestoreRequest(checkpointRestorePayload(preview), request.current?.request, () => crypto.randomUUID());
      const response = await apiRequest(`/api/workbench/checkpoints/${encodeURIComponent(id)}/restore`, { method: 'POST', body: request.current.body });
      if (!response.result?.id || response.result.checkpoint_id !== id || response.result.workspace_id !== scope.workspaceId || response.result.project_id !== scope.projectId) throw Object.assign(new Error('The restore response is unavailable or does not match this checkpoint. Recover the same request result before another attempt.'), { code: 'invalid_response' });
      setResult(response.result); setUncertain(false);
    } catch (problem) {
      setError(problem); setUncertain(checkpointDeliveryUncertain(problem));
      if (checkpointPreviewInvalidated(problem)) { setConfirmed(false); setPreviewStale(true); }
    }
    finally { inFlight.current = false; setBusy(false); }
  }
  function backToSelection() { setPreview(null); setConfirmed(false); setPreviewStale(false); setError(null); request.current = null; }
  const recoveryId = result?.pre_restore_checkpoint_id || error?.details?.pre_restore_checkpoint_id;
  return <section><div className="wb-checkpoint-actions"><Button disabled={busy || previewBusy} onClick={onBack}>Back to checkpoints</Button>{!preview && !result ? <Button disabled={locked || state.loading} onClick={() => requestUpdateNavigation(() => { setSelected([]); setConfirmed(false); setRevision(value => value + 1); })}>Refresh manifest</Button> : null}</div><ErrorMessage error={state.error || mismatch} />{state.loading ? <p role="status">Loading checkpoint manifest…</p> : checkpoint ? <>
    <h3 ref={phaseHeading} tabIndex={-1}>{phase === 'result' ? checkpointRestoreOutcome(result).title : phase === 'preview' ? 'Review the exact file restore' : kind(checkpoint.kind)}</h3>
    <p>{environmentName(checkpoint.environment_id)} · {stamp(checkpoint.created_at)} · {checkpoint.file_count} recorded paths · {bytes(checkpoint.byte_size)}</p><small>Checkpoint {checkpoint.id} · immutable version {checkpoint.version} · recorded server actor {checkpoint.created_by || 'unknown'}.</small>
    {(checkpoint.environment_id || '') !== (scope.environmentId || '') ? <p className="wb-checkpoint-warning">This checkpoint belongs to {environmentName(checkpoint.environment_id)}, not the currently selected Workbench environment. Its preview and restore always use that saved environment.</p> : null}
    {checkpoint.limited || !checkpoint.complete ? <p className="wb-checkpoint-warning">This was a limited capture. Only recorded paths can be restored; missing paths are not treated as deleted files.</p> : null}
    {checkpoint.parent_checkpoint_id ? <p>This recovery checkpoint preserves the selected files immediately before an earlier restore. <Button disabled={locked} onClick={() => onOpen(checkpoint.parent_checkpoint_id)}>Inspect source checkpoint</Button></p> : null}
    {result ? <RestoreOutcome result={result} /> : !preview ? <><p>Select up to 50 recorded paths. Preview reads today’s file states without changing them. Files absent in a checkpoint are explicitly labeled; restoring an absent state deletes that selected file.</p><div className="wb-checkpoint-actions"><Field label="Filter recorded paths"><input value={query} disabled={locked} onChange={event => setQuery(event.target.value)} /></Field><Button disabled={locked || !eligible.length} onClick={() => setSelected(eligible.slice(0, 50).map(file => file.path))}>Select first {Math.min(eligible.length, 50)} eligible paths</Button><Button disabled={locked || !selected.length} onClick={() => setSelected([])}>Clear selection</Button></div><p>{selected.length} paths selected · {files.length} recorded. Preview and confirmation are still required.</p><fieldset className="wb-checkpoint-files" disabled={locked}><legend>Recorded paths</legend>{files.filter(file => file.path.toLowerCase().includes(query.toLowerCase())).map(file => <label key={file.path}><input type="checkbox" checked={selected.includes(file.path)} disabled={!['present', 'absent'].includes(file.state) || selected.length >= 50 && !selected.includes(file.path)} onChange={event => setSelected(paths => event.target.checked ? [...paths, file.path] : paths.filter(path => path !== file.path))} /><FileTypeIcon path={file.path} /><span><strong>{file.path}</strong><small>{file.state === 'absent' ? 'Recorded absent · restoring deletes this path' : file.state === 'present' ? `Captured text · ${bytes(file.byte_size)}` : `Unavailable · ${file.reason || 'No content recorded'}`}</small></span></label>)}{!files.length ? <p>No restorable paths were recorded.</p> : !files.some(file => file.path.toLowerCase().includes(query.toLowerCase())) ? <p>No recorded paths match this filter.</p> : null}</fieldset></> : <><p className="wb-checkpoint-warning">Restoring can overwrite or delete current files. Stop active agent sessions and Workbench terminals first. Changes after this preview invalidate it. The server creates a pre-restore recovery checkpoint for the selected paths; it does not perform an automatic rollback if some files fail.</p><ul className="wb-checkpoint-preview-list">{preview.files.map(file => <CheckpointPreviewFile key={file.path} file={file} />)}</ul><ChangeReview key={preview.preview_fingerprint} comparison={comparison} /><details className="wb-checkpoint-exact"><summary>Inspect exact captured and current text</summary>{preview.files.map(file => <section key={file.path}><h3>{file.path}</h3><div className="wb-checkpoint-text-pair"><ExactCheckpointText title="Current file" file={file.current} /><ExactCheckpointText title="Captured file" file={file.before} /></div></section>)}</details>{block ? <p className="wb-checkpoint-warning" role="status">{block}</p> : <label className="wb-checkpoint-check"><input type="checkbox" checked={confirmed} disabled={busy || uncertain} onChange={event => setConfirmed(event.target.checked)} /><span>I reviewed every selected file. I explicitly authorize replacing file contents or modes, or deleting only these working files as shown, and understand that this may discard current content.</span></label>}</>}
    <ErrorMessage error={error} />{uncertain ? <p className="wb-checkpoint-warning" role="status">Restore delivery is uncertain; files may already have changed. Retry sends the same pinned request and idempotency key, not a new restore. Do not start a different restore until you inspect its recorded result.</p> : null}{recoveryId ? <div className="wb-checkpoint-recovery"><h3>Pre-restore recovery checkpoint</h3><p>Inspect {recoveryId} to review the selected files as they were before this attempt. Opening it is read-only; recovering them requires a new preview and explicit restore confirmation.</p><Button disabled={busy || previewBusy} onClick={() => onOpen(recoveryId)}>Inspect pre-restore recovery</Button></div> : null}
    {!result ? <footer className="form-submit-row">{preview ? <><Button disabled={locked} onClick={backToSelection}>Back to file selection</Button><Button variant="danger" busy={busy} disabled={!uncertain && (!confirmed || Boolean(block))} onClick={restore}>{uncertain ? 'Recover same restore result' : 'Confirm selected-file restore'}</Button></> : <Button variant="primary" busy={previewBusy} disabled={busy || !selected.length || selected.length > 50} onClick={inspect}>Preview selected restore</Button>}</footer> : <p>Refresh Workbench’s Changes view to capture a new comparison. Earlier review snapshots remain unchanged.</p>}
  </> : null}</section>;
}

function ExactCheckpointText({ title, file }) {
  return <section><h4>{title}</h4>{file.state === 'present' && typeof file.content === 'string' ? <CodeViewer content={file.content} label={file.path} /> : <p>{file.state === 'absent' ? 'This path was absent. Absence is not an empty file.' : 'Text unavailable; it is not treated as empty or deleted.'}</p>}<small>SHA-256: {file.sha256 || (file.state === 'absent' ? 'Absent path — no hash' : 'Unavailable')}</small></section>;
}

function CheckpointPreviewFile({ file }) {
  return <li><strong>{file.path}</strong><span>{file.operation === 'delete' ? 'Delete current file' : file.operation === 'create' ? 'Create captured file' : file.operation === 'restore' ? 'Restore saved contents and mode' : 'No content or mode change'}</span>{!file.restorable ? <p>{file.reason || 'Unavailable'}</p> : null}<small>Current: {file.current.state}{file.current.state === 'present' ? ` · mode ${checkpointFileMode(file.current.mode)}` : ''} → checkpoint: {file.before.state}{file.before.state === 'present' ? ` · mode ${checkpointFileMode(file.before.mode)}` : ''}</small></li>;
}

function RestoreOutcome({ result }) {
  const outcome = checkpointRestoreOutcome(result);
  return <section className="wb-checkpoint-outcome"><p>{outcome.detail}</p>{result.replayed ? <p>Recovered the recorded result of the same request. Files were not applied again by this replay.</p> : null}<small>Restore {result.id} · {stamp(result.created_at)} · server actor {result.actor_id || 'unknown'}.</small><ul>{(result.outcomes || []).map(item => <li key={item.path}><strong>{item.path}</strong><span>{item.status === 'applied' ? 'Applied' : item.status === 'unchanged' ? 'Already matched; not rewritten' : item.status === 'failed' ? 'Failed' : 'Outcome not confirmed'}</span>{item.error ? <p>{item.error}</p> : null}</li>)}</ul>{!result.outcomes?.length ? <p>No per-file outcomes are recorded. Missing outcomes are not proof that the files stayed unchanged.</p> : null}</section>;
}

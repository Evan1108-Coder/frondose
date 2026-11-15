import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog, ErrorMessage, IconButton, useApp } from '../ui.jsx';
import { Download as ArrowDownToLine, Clock, Minus, RotateCw as RefreshCw, X } from './icons.jsx';
import { desktopUpdateCommand, desktopUpdateDraftBlockers, nativeUpdateCritical, useDesktopUpdates } from '../lib/desktop-updates.js';
import { unsavedUpdateBlockers } from './UnsavedUpdates.jsx';
import './desktop-updates.css';

const running = phase => ['checking', 'preparing', 'downloading', 'installing'].includes(phase);
const titleFor = phase => ({ preparing: 'Checking for unfinished work', downloading: 'Getting update ready', installing: 'Installing update', blocked: 'Update waiting for you', error: 'Update could not finish', scheduled: 'Update scheduled' })[phase] || 'Frondose update';
const timeLabel = value => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';

function ReleaseDetails({ state }) {
  const { navigate } = useApp();
  return <><p>{state.release?.name || `Frondose ${state.release?.version || ''}`}</p>{state.release?.notes ? <details className="native-update-notes"><summary>Release notes</summary><pre>{state.release.notes}</pre></details> : null}<Button variant="ghost" onClick={() => navigate('docs')}>Go to Docs</Button></>;
}

const blockerCopy = {
  terminal: ['Running terminal', 'Open this terminal and stop it or let it finish.'],
  'terminal-starting': ['Terminal starting', 'Wait for it to start, then finish or stop it.'],
  'terminal-stopping': ['Terminal stopping', 'Wait for this terminal to exit, then retry.'],
  'terminal-uncertain': ['Unconfirmed CLI launch', 'Check this workspace for a CLI session that may still be running. Finish it and review the launch before retrying.'],
  'agent-run': ['Unfinished agent run', 'Let this run finish or cancel it from its run controls.'],
  'agent-chat': ['AI chat responding', 'Wait for the response to finish or stop it in Chat.'],
  environment: ['Active environment', 'Stop the environment from its controls.'],
  'active-work': ['Additional active work', 'Check your other workspaces for unfinished sessions.'],
  'browser-page': ['Open Browser tab', 'Save any work on this page, then close the Browser tab.'],
  'other-window': ['Other Frondose window or browser tab', 'Save changes there, then close the other Frondose window or browser tab.'],
  'pending-write': ['Pending workspace operation', 'Wait for the operation to finish, then retry.'],
  'file-draft': ['Unsaved file', 'Open this file and save or discard its changes.'],
  'file-save': ['File saving', 'Wait for this file to finish saving.'],
  'form-draft': ['Unsaved form', 'Save or cancel the changes in this form.'],
  'update-draft': ['Unsaved workspace changes', 'Save or cancel the draft you were editing.'],
  'workspace-save': ['Workspace changes saving', 'Wait for the workspace to finish saving.'],
  dialog: ['Open dialog', 'Finish or cancel this dialog before updating.'],
  editor: ['Open editor', 'Save or cancel the open editor.'],
  'draft-check': ['Unconfirmed drafts', 'Finish open edits and dialogs, then retry.'],
  'window-loading': ['Frondose window loading', 'Wait for the workspace to open, then retry.'],
  'window-unresponsive': ['Frondose window did not respond', 'Return to the workspace and check that it responds before retrying.'],
  'separate-server': ['Separate local server', 'Finish your work, close the separately started server, then reopen the installed Frondose app.'],
};

function UpdateBlockerList({ blockers, review = false }) {
  if (!blockers?.length) return null;
  return <section className="native-update-blockers" aria-label={review ? 'Items to close' : 'What is blocking the update'}>
    {review ? null : <h3>Before you update</h3>}
    <ul>{blockers.map(({ kind, label, workspace, project, count }, index) => {
      const copy = blockerCopy[kind];
      if (!copy) return null;
      return <li key={`${kind}:${index}`}><strong>{review && kind === 'browser-page' ? 'Unused blank Browser page' : copy[0]}{count > 1 ? ` (${count})` : ''}{label ? <>: <bdi>{label}</bdi></> : null}</strong>
        {workspace || project ? <small>{workspace ? <bdi>{workspace}</bdi> : null}{project && project !== workspace ? <>{workspace ? ' / ' : ''}<bdi>{project}</bdi></> : null}</small> : null}
        {review ? null : <p>{copy[1]}</p>}</li>;
    })}</ul>
  </section>;
}

function UpdateProgress({ state, onMinimize }) {
  const downloading = state.phase === 'downloading', installing = state.phase === 'installing';
  const percent = downloading ? Math.floor(state.progress || 0) : null;
  const description = downloading ? `Preparing the update… ${percent}%` : installing ? 'Installing the verified update and restarting Frondose…' : 'Checking saved drafts, open windows and running work…';
  return <Dialog title={titleFor(state.phase)} className="native-update-dialog is-progress" closeDisabled hideCloseButton onClose={onMinimize}>
    <div className="native-update-body">
      <p className="native-update-version">Frondose {state.release?.version}</p>
      <progress aria-label="Update progress" max="100" value={downloading ? state.progress || 0 : installing ? 100 : undefined}/>
      <p role="status">{description}</p>
    </div>
    <div className="form-submit-row"><Button icon={Minus} onClick={onMinimize}>Minimize</Button></div>
  </Dialog>;
}

export function DesktopUpdates({ hasOpenEditor = false, pendingMutations = false }) {
  const state = useDesktopUpdates(), [open, setOpen] = useState(false), [localError, setLocalError] = useState(null), [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null), [cleanupResult, setCleanupResult] = useState(null);
  const readiness = useRef({ hasOpenEditor, pendingMutations });
  readiness.current = { hasOpenEditor, pendingMutations };
  const latest = useRef(state); latest.current = state;
  const compactButton = useRef(null);
  const prompt = Boolean(state.release && !state.dismissed && state.phase === 'available');
  const [retainedPrompt, setRetainedPrompt] = useState(null);
  useEffect(() => {
    if (prompt) { setRetainedPrompt(state); return; }
    const reduced = document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => setRetainedPrompt(null), reduced ? 0 : 160);
    return () => clearTimeout(timer);
  }, [prompt, state.release?.version]);
  useEffect(() => globalThis.frondoseDesktop?.updates?.onSafety(request => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]:not(.native-update-dialog)')].map(element => ({ kind: 'dialog', label: element.getAttribute('aria-label') }));
    const blockers = [...desktopUpdateDraftBlockers(), ...unsavedUpdateBlockers(), ...dialogs];
    if (readiness.current.hasOpenEditor && !dialogs.length) blockers.push({ kind: 'editor' });
    if (readiness.current.pendingMutations && !blockers.some(item => item.kind === 'workspace-save')) blockers.push({ kind: 'workspace-save' });
    void globalThis.frondoseDesktop.updates.respondSafety({ nonce: request.nonce, safe: !blockers.length, blockers }).catch(() => {});
  }), []);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('frondose:show-app-update', show);
    return () => window.removeEventListener('frondose:show-app-update', show);
  }, []);
  const action = async choice => {
    if (busy) return;
    setBusy(true); setLocalError(null); setCleanupResult(null);
    if (choice === 'now') setOpen(true);
    try { await desktopUpdateCommand({ operation: 'choose', choice, version: latest.current.release?.version }); }
    catch (error) { setLocalError(error); }
    finally { setBusy(false); }
  };
  const cancelReview = () => { setReview(null); void desktopUpdateCommand({ operation: 'cleanup-cancel' }).catch(() => {}); };
  const reviewCleanup = async () => {
    setBusy(true); setLocalError(null); setCleanupResult(null);
    const version = latest.current.release?.version;
    try {
      const plan = await desktopUpdateCommand({ operation: 'cleanup-preview', version });
      if (plan.token && plan.items?.length) setReview({ ...plan, version });
      else setLocalError(Error('No items can be closed here now. Try the update again to refresh the list.'));
    } catch (cause) { setLocalError(cause); }
    finally { setBusy(false); }
  };
  const confirmCleanup = async () => {
    if (busy || !review) return;
    setBusy(true); setLocalError(null);
    try {
      const { result } = await desktopUpdateCommand({ operation: 'cleanup-confirm', version: review.version, token: review.token });
      setCleanupResult(result);
    } catch (cause) { setLocalError(cause); }
    finally { setReview(null); setBusy(false); }
  };
  if (state.phase === 'unsupported' || state.phase === 'unconfigured') return null;
  const shownPrompt = prompt ? state : retainedPrompt;
  const progress = state.phase === 'downloading' || nativeUpdateCritical(state.phase);
  const compact = !open && state.release && !prompt && ['scheduled', 'blocked', 'error', 'downloading', 'preparing', 'installing'].includes(state.phase);
  const minimize = () => { setOpen(false); requestAnimationFrame(() => compactButton.current?.focus()); };
  return createPortal(<div className="native-update-ui" data-app-update-ui="true">
    {shownPrompt ? <aside className={`native-update-prompt ${prompt ? '' : 'is-leaving'}`} inert={!prompt || undefined} aria-hidden={!prompt || undefined} aria-label="App update available"><header><strong>Update available</strong><IconButton label="Not now" disabled={busy || !prompt} onClick={() => action('later')}><X/></IconButton></header><p>Frondose {shownPrompt.release.version} is ready.</p><button className="native-update-text-link" onClick={() => setOpen(true)}>Release notes</button><div className="native-update-actions"><Button variant="primary" disabled={busy || !prompt} onClick={() => action('now')}>Update</Button></div><ErrorMessage error={localError}/></aside> : null}
    {compact ? <button ref={compactButton} className="native-update-compact" onClick={() => setOpen(true)}><Clock aria-hidden="true"/><span>{titleFor(state.phase)}{state.phase === 'downloading' ? ` · ${Math.floor(state.progress || 0)}%` : ''}</span></button> : null}
    {open ? (progress ? <UpdateProgress state={state} onMinimize={minimize}/> : review ? <Dialog key="cleanup-review" title="Review items to close" className="native-update-dialog" onClose={cancelReview} closeDisabled={busy}>
      <div className="native-update-body"><p>Frondose will close only the items below. Stopping a terminal ends its running process and may interrupt unfinished work. Drafts, loaded Browser pages and other windows stay open.</p><UpdateBlockerList blockers={review.items} review/></div>
      <div className="form-submit-row"><Button onClick={cancelReview} disabled={busy}>Cancel</Button><Button variant="danger" onClick={confirmCleanup} disabled={busy}>{busy ? 'Closing items…' : 'Close all listed items'}</Button></div>
    </Dialog> : <Dialog key="update-details" title={titleFor(state.phase)} className="native-update-dialog" onClose={minimize} closeDisabled={busy}>
      <div className="native-update-body">{state.blockers?.length ? <><p className="native-update-version">Frondose {state.release?.version}</p><UpdateBlockerList blockers={state.blockers}/></> : <ReleaseDetails state={state}/>} {state.scheduledAt ? <p>Scheduled for {timeLabel(state.scheduledAt)} on this computer. If it is asleep or closed, Frondose will ask again.</p> : null}
        {cleanupResult ? <p role="status">{cleanupResult.unconfirmed ? 'Some items did not confirm that they closed. Review the remaining blockers before updating.' : state.blockers?.length ? 'The reviewed items are closed. Finish the remaining items before updating.' : 'The reviewed items are closed. Choose Install now when you’re ready.'}</p> : null}
        {state.canCleanup ? <Button disabled={busy} onClick={reviewCleanup}>Review items to close</Button> : null}
        <ErrorMessage error={localError || (!state.blockers?.length && state.error ? Error(state.error) : null)}/></div>
      <div className="form-submit-row"><Button icon={Minus} onClick={minimize}>Minimize</Button>{state.phase === 'scheduled' ? <Button disabled={busy} onClick={() => action('cancel')}>Cancel scheduled update</Button> : null}<Button disabled={busy} onClick={() => action('tonight')}>Install tonight</Button><Button variant="primary" disabled={busy} onClick={() => action('now')}>{state.blockers?.length ? 'Try again' : 'Install now'}</Button></div>
    </Dialog>) : null}
  </div>, document.body);
}

export function DesktopUpdateSettings() {
  const state = useDesktopUpdates(), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  async function command(operation) { setBusy(true); setError(null); try { await desktopUpdateCommand({ operation }); } catch (cause) { setError(cause); } finally { setBusy(false); } }
  return <><header className="settings-heading"><div><h1>App updates</h1><p>Update Frondose on this computer.</p></div></header><section className="settings-group"><div className="settings-panel native-update-settings"><h2>Frondose {state.currentVersion || 'desktop'}</h2><p>{state.phase === 'unsupported' ? state.reason : state.phase === 'unconfigured' ? state.reason : titleFor(state.phase)}</p>{state.reason && state.phase !== 'unconfigured' && state.phase !== 'unsupported' ? <p>{state.reason}</p> : null}{state.phase === 'unconfigured' ? <p>You can use this local Mac/Windows build without an Apple Developer account. Public automatic Mac installation requires a publisher-signed release; no update server is contacted by this build.</p> : null}{state.scheduledAt ? <p>Install at {timeLabel(state.scheduledAt)}</p> : null}{state.release ? <><strong>{state.release.name}</strong><p>{state.release.version}</p><Button onClick={() => window.dispatchEvent(new Event('frondose:show-app-update'))}>Review update</Button></> : null}<div className="native-update-actions"><Button icon={RefreshCw} disabled={busy || running(state.phase) || ['unsupported', 'unconfigured'].includes(state.phase)} onClick={() => command('check')}>Check for updates</Button>{state.downloadsAvailable ? <Button icon={ArrowDownToLine} onClick={() => command('downloads')}>Open installer downloads</Button> : null}</div><ErrorMessage error={error || (state.error ? Error(state.error) : null)}/></div></section></>;
}

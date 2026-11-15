import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, PanelLeft, Plus, RotateCw, Square, Terminal, X } from '../icons.jsx';
import { Button, Dialog, ErrorMessage } from '../../ui.jsx';
import {terminalAiProvider} from '../../lib/workspace-context-drop.js';
import { workbenchRequest } from '../../lib/workbench.js';
import { clampSplitRatio, collectLayoutLeafIdsInOrder, equalizeLayout, firstLayoutLeafId, insertLeafBeside, MAX_TERMINAL_PANES, normalizeTerminalLayout, removeLayoutLeaf, updateLayoutRatio } from '../../lib/terminal-splits.js';
import { composeNativeAgentPrompt, MAX_NATIVE_AGENT_TASK, NATIVE_AGENT_PROVIDERS } from '../../lib/native-agent-session.js';
import { TerminalQuickCommands } from './TerminalQuickCommands.jsx';
import { notifyWorkspaceEvent } from '../../lib/system-notifications.js';
import './terminal-workspace.css';

const TerminalCanvas = lazy(() => import('./TerminalPane.jsx').then(module => ({ default: module.TerminalPane })));
const emptyLayout = () => ({ version: 1, root: null, activeLeafId: null });
const profileReason = 'Reviewed personalized first tasks are currently supported only for Codex and Claude Code. Open another provider CLI directly; no personalization will be silently omitted.';

function readLayout(key) {
  try { const value = localStorage.getItem(key); return value && value.length < 20_000 ? JSON.parse(value) : null; } catch { return null; }
}

/** A view over server-owned terminals. Mount/restore/unmount never starts or stops a PTY. */
export function TerminalWorkspace({reviewRequest,onReviewConsumed,onActivateView, scope: incomingScope, sessionId = 'terminal', initialTerminalId = null, launchChoice = null, launchRequestId = null, onLaunchRequestConsumed, active: viewActive = true, onSessionCreated }) {
  const workspaceId = incomingScope?.workspaceId, projectId = incomingScope?.projectId || null, environmentId = incomingScope?.environmentId || '', host = incomingScope?.host === 'workspace' ? 'workspace' : null;
  const scope = useMemo(() => ({ workspaceId, projectId, environmentId, ...(host ? { host } : {}) }), [workspaceId, projectId, environmentId, host]);
  const layoutKey = `frondose:terminal-splits:v1:${workspaceId}:${host || projectId}:${environmentId}:${sessionId}`;
  const [summary, setSummary] = useState(null), [catalog, setCatalog] = useState(null), [layout, setLayout] = useState(emptyLayout);
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), [dialog, setDialog] = useState(null), [consent, setConsent] = useState(false);
  const [providerId, setProviderId] = useState(launchChoice?.providerId || '');
  const [agentPreview, setAgentPreview] = useState(null), [previewBusy, setPreviewBusy] = useState(false), [firstTask, setFirstTask] = useState(''), [paidConsent, setPaidConsent] = useState(false);
  const mounted = useRef(false), mutationBusy = useRef(false), hydrated = useRef(false), requestRevision = useRef(0);
  const consumedLaunches = useRef(new Set()),contextOwner=useRef(null);
  const newlyCreatedTerminal = useRef(null);
  const [paneReview,setPaneReview]=useState(null),reviewedRequests=useRef(new Set());
  const [quickCommands, setQuickCommands] = useState(false);
  const currentView = useRef(layoutKey);
  currentView.current = layoutKey;
  const choiceRef = useRef(launchChoice), createdRef = useRef(onSessionCreated);
  choiceRef.current = launchChoice; createdRef.current = onSessionCreated;

  const refresh = useCallback(async (signal) => {
    if (!workspaceId) return;
    const revision = ++requestRevision.current;
    const catalogPromise = workbenchRequest(scope, 'terminal-providers', { signal }).then(value => ({ value }), error => ({ error }));
    const nextSummary = await workbenchRequest(scope, '', { signal });
    if (!mounted.current || signal?.aborted || revision !== requestRevision.current) return;
    const ids = nextSummary.terminals.filter(item => (item.environment_id || '') === environmentId).map(item => item.id);
    const restoring = !hydrated.current, saved = restoring ? readLayout(layoutKey) : null;
    setSummary(nextSummary); setError(null);
    setLayout(current => normalizeTerminalLayout(restoring ? saved : current, ids, initialTerminalId));
    hydrated.current = true;
    const inventory = await catalogPromise;
    if (!mounted.current || signal?.aborted || revision !== requestRevision.current) return;
    setCatalog(inventory.value || { providers: [], shells: [{ id: 'default', title: 'Default shell' }] });
    if (inventory.error) setError(new Error(`CLI discovery is unavailable; existing terminal sessions remain accessible. ${inventory.error.message || ''}`));
  }, [scope, workspaceId, projectId, environmentId, layoutKey, initialTerminalId]);

  useEffect(() => {
    mounted.current = true; hydrated.current = false; mutationBusy.current = false; setSummary(null); setCatalog(null); setLayout(emptyLayout()); setBusy(false); setDialog(null); setConsent(false); setProviderId(choiceRef.current?.providerId || '');
    const controller = new AbortController();
    refresh(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => { mounted.current = false; controller.abort(); ++requestRevision.current; };
  }, [refresh]);
  useEffect(() => { if (hydrated.current) try { localStorage.setItem(layoutKey, JSON.stringify(layout)); } catch { /* Private browsing may not persist this view. */ } }, [layout, layoutKey]);

  const terminals = useMemo(() => (summary?.terminals || []).filter(item => (item.environment_id || '') === environmentId), [summary, environmentId]);
  const byId = useMemo(() => new Map(terminals.map(item => [item.id, item])), [terminals]);
  const leaves = collectLayoutLeafIdsInOrder(layout.root), active = byId.get(layout.activeLeafId);
  const namedAgent = Boolean(launchChoice?.agentId), unsupportedProfile = namedAgent && !NATIVE_AGENT_PROVIDERS.includes(launchChoice.providerId);
  useEffect(()=>{if(!reviewRequest||!summary||!hydrated.current||reviewedRequests.current.has(reviewRequest.requestId))return;reviewedRequests.current.add(reviewRequest.requestId);const candidate=terminals.find(row=>row.id===layout.activeLeafId&&reviewRequest.sessionIds.includes(row.id)&&terminalAiProvider(row)&&row.status==='running')||terminals.find(row=>reviewRequest.sessionIds.includes(row.id)&&terminalAiProvider(row)&&row.status==='running');if(!candidate)setError(Error('This view has no eligible running AI CLI. Nothing was inserted or launched.'));else{setLayout(current=>({...current,activeLeafId:candidate.id}));setPaneReview({terminalId:candidate.id,requestId:reviewRequest.requestId,source:reviewRequest.source});}onReviewConsumed?.();},[reviewRequest,summary,terminals,layout.activeLeafId,onReviewConsumed]);
  const canStart = Boolean((summary?.terminalRoot || summary?.root) && !busy && !unsupportedProfile);
  let exactFirstPrompt = '';
  if (agentPreview && firstTask.trim()) try { exactFirstPrompt = composeNativeAgentPrompt(agentPreview, firstTask); } catch { /* Server validation remains authoritative. */ }

  useEffect(() => {
    setAgentPreview(null); setPreviewBusy(false);
    if (dialog?.type !== 'launch' || !namedAgent || unsupportedProfile) return;
    const controller = new AbortController(), view = layoutKey;
    setPreviewBusy(true);
    workbenchRequest(scope, 'native-agent-preview', { signal: controller.signal, body: { agent_id: launchChoice.agentId, provider_id: launchChoice.providerId } })
      .then(preview => { if (!controller.signal.aborted && currentView.current === view) setAgentPreview(preview); })
      .catch(cause => { if (!controller.signal.aborted && currentView.current === view) setError(cause); })
      .finally(() => { if (!controller.signal.aborted && currentView.current === view) setPreviewBusy(false); });
    return () => controller.abort();
  }, [dialog?.type, dialog?.requestId, namedAgent, unsupportedProfile, launchChoice?.agentId, launchChoice?.providerId, scope, layoutKey]);

  function prepareLaunch(side = null, resume = false, targetId = layout.activeLeafId) {
    if (!canStart || leaves.length >= MAX_TERMINAL_PANES || side && !layout.activeLeafId) return;
    const pending = { type: 'launch', side: side || (layout.root ? 'right' : null), target: targetId, requestId: crypto.randomUUID(), resume };
    const provider = choiceRef.current?.providerId || '';
    setError(null); setConsent(false); setPaidConsent(false); setFirstTask(''); setProviderId(choiceRef.current?.providerId || '');
    // The explicit chooser/New/Split click is the ordinary local launch action.
    // No remembered consent or restored view metadata can manufacture this intent.
    if (!namedAgent) { void launchTerminal(pending, provider); return; }
    setDialog(pending);
  }
  useEffect(() => {
    if (!launchRequestId || consumedLaunches.current.has(launchRequestId) || !(summary?.terminalRoot || summary?.root) || !catalog || busy) return;
    consumedLaunches.current.add(launchRequestId);
    onLaunchRequestConsumed?.(launchRequestId);
    prepareLaunch(null, choiceRef.current?.resume === true);
  }, [launchRequestId, summary?.terminalRoot, summary?.root, catalog, busy]);
  async function submitLaunch(event) {
    event.preventDefault();
    if (!consent || mutationBusy.current || unsupportedProfile || namedAgent && (!agentPreview || !exactFirstPrompt || !paidConsent)) return;
    await launchTerminal(dialog, providerId);
  }
  async function launchTerminal(pending, selectedProvider) {
    if (mutationBusy.current) return;
    const token = Symbol('terminal-launch'), view = layoutKey;
    mutationBusy.current = token; setBusy(true); setError(null);
    try {
      const shellPlan = !selectedProvider && globalThis.frondoseDesktop?.terminalShell ? await globalThis.frondoseDesktop.terminalShell({ operation: 'plan' }) : null;
      if (!mounted.current || currentView.current !== view) return;
      const terminal = await workbenchRequest(scope, 'terminals', { method: 'POST', body: { view_id: sessionId, name: selectedProvider ? catalog.providers.find(item => item.id === selectedProvider)?.title || 'AI CLI' : 'Terminal', confirm_execution: true, ...(selectedProvider ? { provider_id: selectedProvider, resume: pending.resume === true, ...(pending.resume && choiceRef.current?.historyResultId ? { history_result_id: choiceRef.current.historyResultId } : {}) } : { shell_id: choiceRef.current?.shellId || 'default', ...(shellPlan?.command ? { command: shellPlan.command } : {}) }), ...(namedAgent ? { agent_id: launchChoice.agentId, agent_version: agentPreview.version, agent_snapshot_hash: agentPreview.snapshot_hash, task: firstTask, confirm_paid: paidConsent, request_id: pending.requestId } : {}) } });
      if (!mounted.current || currentView.current !== view) return; // The session remains accessible from the registry.
      newlyCreatedTerminal.current = terminal.id;
      setSummary(current => ({ ...current, terminals: [terminal, ...current.terminals.filter(item => item.id !== terminal.id)] }));
      setLayout(current => ({ version: 1, root: current.root && pending.side ? insertLeafBeside(current.root, pending.target, terminal.id, pending.side) : { type: 'leaf', leafId: terminal.id }, activeLeafId: terminal.id }));
      setDialog(null); createdRef.current?.(terminal);
    } catch (cause) { if (mounted.current && currentView.current === view) setError(cause); }
    finally { if (mutationBusy.current === token) mutationBusy.current = false; if (mounted.current && currentView.current === view) setBusy(false); }
  }
  async function stopTerminal() {
    if (mutationBusy.current || !dialog?.terminalId) return;
    const token = Symbol('terminal-stop'), view = layoutKey;
    mutationBusy.current = token; setBusy(true); setError(null);
    try { await workbenchRequest(scope, `terminals/${dialog.terminalId}/stop`, { method: 'POST' }); if (mounted.current && currentView.current === view) { setDialog(null); await refresh(); } }
    catch (cause) { if (mounted.current && currentView.current === view) setError(cause); }
    finally { if (mutationBusy.current === token) mutationBusy.current = false; if (mounted.current && currentView.current === view) setBusy(false); }
  }
  useEffect(()=>{const handler=event=>{const {terminalId,action}=event.detail||{};if(!terminals.some(item=>item.id===terminalId))return;event.stopPropagation();if(action?.startsWith('split-'))prepareLaunch(action.slice(6),false,terminalId);else if(action==='quick-commands'){setLayout(current=>({...current,activeLeafId:terminalId}));setQuickCommands(true);}else if(action==='hide')hidePane(terminalId);else if(action==='stop'){setError(null);setDialog({type:'stop',terminalId});}};const quick=event=>{if(event.detail?.workspaceId===workspaceId&&event.detail.tabId===sessionId)setQuickCommands(true);};const node=contextOwner.current;node?.addEventListener('frondose:terminal-action',handler);window.addEventListener('frondose:open-quick-commands',quick);return()=>{node?.removeEventListener('frondose:terminal-action',handler);window.removeEventListener('frondose:open-quick-commands',quick);};},[terminals,canStart,busy,layout,workspaceId,sessionId]);
  function hidePane(terminalId) {
    setLayout(current => {
      const root = removeLayoutLeaf(current.root, terminalId);
      return { ...current, root, activeLeafId: current.activeLeafId === terminalId ? firstLayoutLeafId(root) : current.activeLeafId };
    });
  }
  function attachTerminal(terminalId) {
    if (!byId.has(terminalId)) return;
    setLayout(current => ({ ...current, root: { type: 'leaf', leafId: terminalId }, activeLeafId: terminalId }));
  }
  function keyboard(event) {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'd' && leaves.length && canStart && leaves.length < MAX_TERMINAL_PANES) {
      event.preventDefault(); prepareLaunch(event.shiftKey ? 'bottom' : 'right');
    }
  }

  if (!workspaceId) return <div className="terminal-workspace-empty"><p>Choose a workspace to open a terminal.</p></div>;
  return <section ref={contextOwner} className="terminal-workspace" aria-label="Terminal workspace" onKeyDown={keyboard} data-field-defaults-exclude="true">
    <header className="terminal-workspace-toolbar">
      <div className="terminal-workspace-toolbar-actions">
        <Button disabled={!summary || busy} onClick={() => setQuickCommands(true)}>Quick Commands</Button>
        <Button icon={Plus} disabled={!canStart || leaves.length >= MAX_TERMINAL_PANES} onClick={() => prepareLaunch()}>New</Button>
        <Button icon={PanelLeft} disabled={!canStart || !leaves.length || leaves.length >= MAX_TERMINAL_PANES} onClick={() => prepareLaunch('right')}>Split right</Button>
        <Button icon={LayoutGrid} disabled={!canStart || !leaves.length || leaves.length >= MAX_TERMINAL_PANES} onClick={() => prepareLaunch('bottom')}>Split down</Button>
        <button type="button" className="text-button" disabled={leaves.length < 2} onClick={() => setLayout(current => ({ ...current, root: equalizeLayout(current.root) }))}>Equalize</button>
        <button type="button" className="terminal-workspace-icon" aria-label="Refresh existing terminal sessions" onClick={() => refresh().catch(setError)} disabled={busy}><RotateCw /></button>
        {leaves.length === 1 && active && ['running', 'stopping'].includes(active.status) ? <button type="button" className="terminal-workspace-icon" aria-label="Stop current terminal" onClick={() => { setError(null); setDialog({ type: 'stop', terminalId: active.id }); }}><Square /></button> : null}
      </div>
    </header>
    <ErrorMessage error={error || summary?.folderError} />
    {unsupportedProfile ? <p className="terminal-workspace-notice" role="status">{profileReason}</p> : null}
    {!summary ? <p role="status" className="terminal-workspace-loading">Opening terminal…</p> : null}
    {layout.root ? <div className="terminal-split-root"><SplitSurface reviewRequest={paneReview} onReviewConsumed={()=>setPaneReview(null)} onActivateView={onActivateView} node={layout.root} path={[]} scope={scope} byId={byId} activeLeafId={layout.activeLeafId} newlyCreatedTerminal={newlyCreatedTerminal.current} viewActive={viewActive} fontSize={summary?.settings?.terminalFontSize || 13}
      onFocus={leafId => setLayout(current => current.activeLeafId === leafId ? current : { ...current, activeLeafId: leafId })}
      onRatio={(path, ratio) => setLayout(current => ({ ...current, root: updateLayoutRatio(current.root, path, ratio) }))}
      onHide={hidePane} onStop={terminalId => { setError(null); setDialog({ type: 'stop', terminalId }); }} onEnded={terminal => { if (terminal && terminal.status !== 'stopped') void notifyWorkspaceEvent({ workspaceId, key: `terminal:${terminal.id}:${terminal.ended_at || terminal.status}`, title: terminal.exit_code ? 'Session needs attention' : 'Session finished', body: `${terminal.name} has ${terminal.exit_code ? 'ended with an error' : 'finished'}.` }); refresh().catch(setError); }} /></div> : summary ? <div className="terminal-workspace-empty">{busy || launchRequestId ? <p role="status">Opening {launchChoice?.label || 'terminal'}…</p> : <Button variant="primary" disabled={!canStart} onClick={() => prepareLaunch(null, choiceRef.current?.resume === true)}>{launchChoice?.providerId ? `Open ${launchChoice.label || 'CLI'}` : 'Open terminal'}</Button>}</div> : null}
    {quickCommands ? <TerminalQuickCommands scope={scope} terminal={active} commands={summary?.commands || []} onChanged={() => refresh()} onClose={() => setQuickCommands(false)} /> : null}
    {dialog?.type === 'launch' ? <Dialog title={namedAgent ? 'Review the first agent task' : dialog.side ? 'Add a terminal pane' : 'Open a local terminal'} onClose={() => { if (!busy) setDialog(null); }}><form onSubmit={submitLaunch} className="terminal-launch-form" data-field-defaults-exclude="true">
      <ErrorMessage error={error} />
      {namedAgent ? <>{previewBusy ? <p role="status">Reading the current agent Personalization…</p> : null}{agentPreview ? <details className="terminal-agent-preview" open><summary>{agentPreview.name} · Personalization · version {agentPreview.version}</summary><pre>{agentPreview.instructions || '(No additional personalization.)'}</pre></details> : null}<label>First task<textarea rows={4} value={firstTask} onChange={event => setFirstTask(event.target.value)} maxLength={MAX_NATIVE_AGENT_TASK} required disabled={busy} placeholder="What should this agent work on?" /></label>{exactFirstPrompt ? <details className="terminal-agent-preview"><summary>Exact first CLI message</summary><pre>{exactFirstPrompt}</pre></details> : null}<label className="terminal-launch-consent"><input type="checkbox" checked={paidConsent} onChange={event => setPaidConsent(event.target.checked)} disabled={busy} /><span>Send this reviewed task to the provider using my local CLI account. This starts AI work and may consume usage or incur charges.</span></label></> : null}
      <p className="terminal-launch-root"><code>{summary?.root}</code></p>
      <label className="terminal-launch-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} /><span>Allow this reviewed task to start a process using my OS permissions. It can edit files and use the network.</span></label>
      <div className="dialog-actions"><Button disabled={busy} onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" type="submit" busy={busy} disabled={!consent || namedAgent && (!agentPreview || !exactFirstPrompt || !paidConsent || previewBusy) || Boolean(providerId && !catalog?.providers.find(item => item.id === providerId)?.installed)}>{namedAgent ? 'Start agent task' : providerId ? 'Launch CLI' : 'Open terminal'}</Button></div>
    </form></Dialog> : null}
    {dialog?.type === 'stop' ? <Dialog title="Stop this session?" onClose={() => { if (!busy) setDialog(null); }}><div className="terminal-launch-form"><ErrorMessage error={error} /><p>This ends the selected process and may interrupt work. Saved output remains available. Files it changed are not undone.</p><div className="dialog-actions"><Button disabled={busy} onClick={() => setDialog(null)}>Keep running</Button><Button variant="danger" icon={Square} busy={busy} onClick={stopTerminal}>Stop session</Button></div></div></Dialog> : null}
  </section>;
}

function SplitSurface({ reviewRequest,onReviewConsumed,onActivateView, node, path, scope, byId, activeLeafId, newlyCreatedTerminal, viewActive, fontSize, onFocus, onRatio, onHide, onStop, onEnded }) {
  if (node.type === 'leaf') {
    const terminal = byId.get(node.leafId);
    if (!terminal) return null;
    return <section className={`terminal-split-leaf ${activeLeafId === node.leafId ? 'is-active' : ''}`} onPointerDownCapture={() => onFocus(node.leafId)} onFocusCapture={() => onFocus(node.leafId)} aria-label={`${terminal.name} pane`}>
      {path.length > 0 ? <header><span><small>{terminal.status}</small></span><div>{['running', 'stopping'].includes(terminal.status) ? <button type="button" aria-label={`Stop ${terminal.name}`} onClick={() => onStop(terminal.id)}><Square /></button> : null}<button type="button" aria-label={`Hide ${terminal.name} pane without stopping`} onClick={() => onHide(terminal.id)}><X /></button></div></header> : null}
      <div className="terminal-split-canvas"><Suspense fallback={<p role="status">Opening terminal display…</p>}><TerminalCanvas reviewRequest={reviewRequest?.terminalId===terminal.id?reviewRequest:null} onReviewConsumed={onReviewConsumed} key={terminal.id} scope={scope} terminal={terminal} active={viewActive} focusRequested={newlyCreatedTerminal === terminal.id} fontSize={fontSize} onEnded={onEnded} onReviewActivation={()=>{onActivateView?.();onFocus(node.leafId);}} /></Suspense></div>
    </section>;
  }
  const vertical = node.direction === 'vertical', ratio = clampSplitRatio(node.ratio);
  const child = { reviewRequest,onReviewConsumed,onActivateView, scope, byId, activeLeafId, newlyCreatedTerminal, viewActive, fontSize, onFocus, onRatio, onHide, onStop, onEnded };
  return <div className={`terminal-split-group ${vertical ? 'split-columns' : 'split-rows'}`} style={{ [vertical ? 'gridTemplateColumns' : 'gridTemplateRows']: `minmax(0, ${ratio}fr) 6px minmax(0, ${1 - ratio}fr)` }}>
    <SplitSurface {...child} node={node.first} path={[...path, 0]} />
    <SplitDivider vertical={vertical} ratio={ratio} onChange={next => onRatio(path, next)} />
    <SplitSurface {...child} node={node.second} path={[...path, 1]} />
  </div>;
}

function SplitDivider({ vertical, ratio, onChange }) {
  const divider = useRef(null), drag = useRef(null), change = useRef(onChange);
  change.current = onChange;
  useEffect(() => () => drag.current?.(), []);
  function start(event) {
    if (event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus();
    drag.current?.();
    const parent = divider.current.parentElement, rect = parent.getBoundingClientRect();
    let frame = null, pending = ratio;
    const move = next => {
      pending = clampSplitRatio(vertical ? (next.clientX - rect.left) / Math.max(1, rect.width) : (next.clientY - rect.top) / Math.max(1, rect.height));
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; change.current(pending); });
    };
    const finish = () => { if (frame !== null) cancelAnimationFrame(frame); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); change.current(pending); drag.current = null; };
    drag.current = finish; window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true }); window.addEventListener('pointercancel', finish, { once: true });
  }
  return <div ref={divider} className="terminal-split-divider" role="separator" tabIndex={0} aria-label={vertical ? 'Resize terminal columns' : 'Resize terminal rows'} aria-orientation={vertical ? 'vertical' : 'horizontal'} aria-valuemin={10} aria-valuemax={90} aria-valuenow={Math.round(ratio * 100)} onPointerDown={start} onDoubleClick={() => onChange(0.5)} onKeyDown={event => {
    const minus = vertical ? 'ArrowLeft' : 'ArrowUp', plus = vertical ? 'ArrowRight' : 'ArrowDown';
    if ([minus, plus, 'Home', 'End'].includes(event.key)) { event.preventDefault(); onChange(event.key === 'Home' ? 0.1 : event.key === 'End' ? 0.9 : clampSplitRatio(ratio + (event.key === minus ? -0.05 : 0.05))); }
  }} />;
}

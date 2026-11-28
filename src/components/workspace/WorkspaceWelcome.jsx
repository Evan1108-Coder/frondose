import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../data/api.js';
import { frondoseActions } from '../../data/useFrondose.js';
import { Button, Dialog, Select, useApp } from '../../ui.jsx';
import { ArrowLeft, ArrowRight, Bell, Check, Folder, Info, Moon, Settings, Sun, Terminal, X } from '../icons.jsx';
import { FrondoseSymbol } from '../Brand.jsx';
import { ServiceLogo } from '../ServiceLogo.jsx';
import { RUNNER_PROVIDER_CATALOG } from '../../lib/runner-provider-catalog.js';
import { createNotificationStepTrigger, notificationResultMessage, requestWorkspaceNotification } from '../../lib/system-notifications.js';
import { WorkspaceGitHubPrompt } from './GitRepositoryBar.jsx';
import { useTipPresence } from './useTipPresence.js';
import { notify } from '../../lib/notifications.js';
import { readWorkspaceOnboarding, saveWorkspaceOnboarding, readTipPreferences, saveTipPreferences, TIP_DURATIONS, remainingTipDuration, tourPosition, createRunNoticeTracker } from '../../lib/workspace-onboarding.js';
import './welcome.css';
import {updateChecklist} from '../../lib/onboarding-checklist.js';

const STEPS = ['Choose your default CLI', 'Make it feel like home', 'Choose your project directory', 'Set up notifications'];
const emit = (type, workspaceId) => window.dispatchEvent(new CustomEvent(type, { detail: { workspaceId } }));

export function WorkspaceWelcome({ workspaceId, rootReady, onChooseDirectory, onComplete, force = false }) {
  const app = useApp();
  const [progress, setProgress] = useState(() => ({ ...readWorkspaceOnboarding(workspaceId), scope: workspaceId }));
  const [replaying, setReplaying] = useState(force);
  const [inventory, setInventory] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false), [notificationStatus, setNotificationStatus] = useState('');
  const notificationStep = useRef(null), alive = useRef(true), currentWorkspace = useRef(workspaceId);
  currentWorkspace.current = workspaceId;
  notificationStep.current ||= createNotificationStepTrigger();
  const open = replaying || !progress.completed;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setProgress({ ...readWorkspaceOnboarding(workspaceId), scope: workspaceId }); setReplaying(force); setError(null); setNotificationStatus(''); setBusy(false); }, [workspaceId, force]);
  const patch = useCallback(value => { try { const next = saveWorkspaceOnboarding(workspaceId, value); setProgress({ ...next, scope: workspaceId }); if(value.defaultCli)updateChecklist(workspaceId,{observed:{cli:true}}); return next; } catch (cause) { setError(`Setup could not be saved in this browser: ${cause.message}`); return null; } }, [workspaceId]);
  useEffect(() => {
    const replay = event => { if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) { notificationStep.current.reset(workspaceId); setReplaying(true); patch({ step: 0 }); } };
    window.addEventListener('frondose-workspace-onboarding', replay);
    return () => window.removeEventListener('frondose-workspace-onboarding', replay);
  }, [workspaceId, patch]);
  useEffect(() => {
    if (!open || progress.step !== 0) return undefined;
    const controller = new AbortController();
    setInventory(null);
    apiRequest('/api/local-runtime', { signal: controller.signal }).then(response => { if (!controller.signal.aborted) setInventory(response.result); }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [open, progress.step]);
  useEffect(() => {
    // Reaching this explicit setup step requests its welcome notification once;
    // rerenders, Strict Mode, sound changes and status events never resend it.
    if (progress.scope === workspaceId) notificationStep.current.enter(workspaceId, open, progress.step, () => { void allowNotifications(); });
  }, [workspaceId, open, progress.step, progress.scope]);
  useEffect(() => {
    if (!open) return undefined;
    return globalThis.frondoseDesktop?.notifications?.onStatus?.(result => {
      if (!alive.current || result.delivery === 'idle') return;
      setNotificationStatus(notificationResultMessage(result));
      if (result.delivery === 'failed') setError(result.error || 'The system rejected the notification.');
    });
  }, [open]);
  function finish(skipped = false) {
    const next = patch({ completed: true, skipped });
    // Disabled/quota-limited browser storage must not lock the owner out of
    // existing work. Completion remains session-local if persistence fails.
    const completed = next || { ...progress, completed: true, skipped };
    if (!next) setProgress(completed);
    setReplaying(false); onComplete?.(completed);
    if (!skipped) emit('frondose-workspace-tour', workspaceId);
  }
  async function theme(value) {
    setBusy(true); setError(null);
    try { await frondoseActions.updateSettings({ appearance: { theme: value } }); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  async function allowNotifications() {
    setBusy(true); setError(null);
    try {
      const result = await requestWorkspaceNotification({ silent: progress.notificationSound === 'silent' });
      if (!alive.current || currentWorkspace.current !== workspaceId) return;
      patch({ notificationsEnabled: result.requested === true && result.supported === true && !['failed','unsupported','cancelled'].includes(result.delivery) });
      setNotificationStatus(notificationResultMessage(result));
      if (result.delivery === 'failed') setError(result.error || 'The system rejected the notification.');
    } catch (cause) { if (alive.current && currentWorkspace.current === workspaceId) setError(cause.message); }
    finally { if (alive.current && currentWorkspace.current === workspaceId) setBusy(false); }
  }
  if (!open) return null;
  const installed = (inventory?.runtimes || []).filter(runtime => runtime.installed);
  const appearance = app?.data?.settings?.appearance?.theme || 'dark';
  return <Dialog title="Welcome to Frondose" className="workspace-welcome-dialog" wide onClose={() => finish(true)} closeDisabled={busy}>
    <div className="workspace-welcome-body">
      <div className="workspace-welcome-brand"><FrondoseSymbol size={27} /><strong>Frondose</strong></div>
      <div className="workspace-welcome-progress" aria-label={`Step ${progress.step + 1} of 4`}>{STEPS.map((name, index) => <span key={name} className={index === progress.step ? 'active' : index < progress.step ? 'done' : ''} />)}<small>{progress.step + 1} of 4</small></div>
      <h2>{STEPS[progress.step]}</h2>
      {progress.step === 0 ? <><p>Choose the local CLI you reach for most. This preference never signs in or starts a process.</p><div className="workspace-welcome-agents">{!inventory ? <p role="status">Detecting installed CLIs…</p> : installed.length ? installed.map(runtime => { const provider = RUNNER_PROVIDER_CATALOG.find(item => item.id === runtime.id); return <button type="button" key={runtime.id} className={progress.defaultCli === runtime.id ? 'selected' : ''} aria-pressed={progress.defaultCli === runtime.id} onClick={() => patch({ defaultCli: runtime.id })}><ServiceLogo name={provider?.id || runtime.id} /><span><strong>{provider?.title || runtime.id}</strong><small>Installed · sign-in not checked</small></span>{progress.defaultCli === runtime.id ? <Check /> : null}</button>; }) : <p>No CLI was detected. Install a CLI and refresh detection in Local installation later; you can continue now.</p>}</div><p className="workspace-welcome-note"><Terminal />Each CLI keeps its own provider login and permissions.</p></> : null}
      {progress.step === 1 ? <><p>Choose your workspace appearance. You can change it later in Settings.</p><div className="workspace-welcome-themes">{[['system', Settings, 'Match your system'], ['dark', Moon, 'Dark surfaces'], ['light', Sun, 'Light surfaces']].map(([value, Icon, label]) => <button type="button" key={value} className={appearance === value ? 'selected' : ''} aria-pressed={appearance === value} disabled={busy} onClick={() => theme(value)}><span className={`theme-preview theme-${value}`}><i /><i /><i /></span><span><Icon />{value[0].toUpperCase() + value.slice(1)}{appearance === value ? <Check /> : null}</span><small>{label}</small></button>)}</div></> : null}
      {progress.step === 2 ? <><p>Link a project directory for files and new terminals. Without one, terminals open in your home folder. Choosing a directory never launches a CLI or moves existing files.</p><div className="workspace-welcome-notifications"><Folder/><div><strong>Project directory</strong><span>{rootReady ? 'Directory linked and readable' : 'Not selected yet'}</span></div>{onChooseDirectory ? <Button icon={Folder} onClick={onChooseDirectory}>{rootReady ? 'Change directory' : 'Choose directory'}</Button> : null}</div><p className="workspace-welcome-note">You can skip this step and choose the directory from the Files panel later. Native processes run as your OS user, not inside a sandbox.</p></> : null}
      {progress.step === 3 ? <><p>Frondose is requesting a welcome notification. Allow it in the system prompt to receive work alerts. You can continue without allowing notifications.</p><div className="workspace-welcome-notifications"><Bell /><div><strong>System notifications</strong><span role="status">{busy ? 'Requesting a welcome notification…' : notificationStatus || 'A welcome notification is requested automatically.'}</span></div>{!busy && !progress.notificationsEnabled ? <Button onClick={allowNotifications}>Allow notifications</Button> : null}{globalThis.frondoseDesktop?.notifications?.openSettings ? <Button onClick={async () => { try { const result = await globalThis.frondoseDesktop.notifications.openSettings(); if (!result.opened) setError(result.error); } catch (cause) { setError(cause.message); } }}>Open system settings</Button> : null}</div><label className="workspace-welcome-sound">Notification sound<Select aria-label="Notification sound" value={progress.notificationSound} onChange={notificationSound => patch({ notificationSound })}><option value="system">System default</option><option value="silent">Silent</option></Select></label><WorkspaceGitHubPrompt workspaceId={workspaceId} rootReady={rootReady}/>{!rootReady && onChooseDirectory ? <Button icon={Folder} disabled={busy} onClick={onChooseDirectory}>Choose project folder</Button> : null}</> : null}
      {error ? <p className="workspace-welcome-error" role="alert">{error}</p> : null}
    </div>
    <footer className="dialog-footer workspace-welcome-footer"><button type="button" className="text-button" disabled={busy} onClick={() => finish(true)}>Skip setup</button><span />{progress.step > 0 ? <Button icon={ArrowLeft} disabled={busy} onClick={() => patch({ step: progress.step - 1 })}>Back</Button> : null}<Button variant="primary" disabled={busy} onClick={() => progress.step < 3 ? patch({ step: progress.step + 1 }) : finish(false)}>{progress.step === 3 ? 'Open workspace' : 'Continue'}<ArrowRight /></Button></footer>
  </Dialog>;
}

const TOUR = [
  {selector:'[data-workspace-projects]',title:'Projects, with worktrees kept separate',text:'Expand a project for its actual branch and open CLI terminals. Worktrees are separate checkouts nested below it. Quick access controls sorting, grouping and card density.'},
  {selector:'[data-workspace-automations]',title:'Schedule a reviewed Route',text:'Automations opens a dedicated tab. Review the exact task, directory and schedule before allowing recurring CLI usage. Active work and missed occurrences are skipped.'},
  { selector: '[data-workspace-new-tab]', title: 'One tab or several views', text: 'Open a terminal, Markdown file or browser here. AI CLI chats stay open when you navigate elsewhere. Right-click tabs for names, vertical tabs and split views.' },
  { selector: '[data-workspace-files]', title: 'Keep project files beside the work', text: 'Browse your chosen directory. Unsaved edits stay protected when you select another file or page.' },
];

export function WorkspaceHelpTips({ workspaceId, rootReady = false, onChooseDirectory }) {
  const app = useApp();
  const appRef = useRef(app); appRef.current = app;
  const runNotices = useRef(null); runNotices.current ||= createRunNoticeTracker();
  const notificationFailures = useRef(new Set());
  const [prefs, setPrefs] = useState(readTipPreferences), [settingsOpen, setSettingsOpen] = useState(false), [dismissed, setDismissed] = useState(false), [tour, setTour] = useState(null), [position, setPosition] = useState(null);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [hidden, setHidden] = useState(typeof document !== 'undefined' && document.hidden);
  const [modalOpen, setModalOpen] = useState(false), [tipSaveError, setTipSaveError] = useState('');
  const tourRef = useRef(null), remaining = useRef(prefs.duration), lastFocus = useRef(null);
  const patch = useCallback(value => { try { const next = saveTipPreferences(value); setPrefs(next); setTipSaveError(''); return next; } catch { setTipSaveError('This browser could not save tip preferences. The current dismissal is temporary.'); return null; } }, []);
  const closeTour = useCallback(() => { setTour(null); setPosition(null); patch({ tourSeen: true }); if (lastFocus.current?.isConnected) lastFocus.current.focus({ preventScroll: true }); }, [patch]);
  useEffect(() => {
    const changes = runNotices.current.observe(app?.data?.runs || [], workspaceId);
    const preference = readWorkspaceOnboarding(workspaceId);
    if (!preference.notificationsEnabled) return;
    for (const notice of changes) {
      const silent = preference.notificationSound === 'silent';
      if (globalThis.frondoseDesktop?.notifications?.notify) {
        void globalThis.frondoseDesktop.notifications.notify({ ...notice, silent }).catch(() => {});
      } else if (window.Notification?.permission === 'granted') {
        try {
          const item = new window.Notification(notice.title, { body: notice.body, silent });
          item.onclick = () => { window.focus(); if (appRef.current?.data?.runs?.some(run => run.id === notice.runId && run.workspace_id === workspaceId)) appRef.current.navigate('work', notice.runId); item.close(); };
        } catch { /* Permission may have changed, or this browser requires a service worker. Never interrupt workspace rendering. */ }
      }
    }
  }, [app?.data?.runs, workspaceId]);
  useEffect(() => {
    const native = globalThis.frondoseDesktop?.notifications;
    if (!native?.onOpen) return undefined;
    return native.onOpen(action => {
      if (action?.workspaceId === workspaceId && appRef.current?.data?.runs?.some(run => run.id === action.runId && run.workspace_id === workspaceId)) appRef.current.navigate('work', action.runId);
    });
  }, [workspaceId]);
  useEffect(() => {
    const native = globalThis.frondoseDesktop?.notifications;
    return native?.onStatus?.(result => {
      if (result.delivery !== 'failed' || !result.error || notificationFailures.current.has(result.error)) return;
      notificationFailures.current.add(result.error);
      while (notificationFailures.current.size > 8) notificationFailures.current.delete(notificationFailures.current.values().next().value);
      notify(result.error, 'error', undefined, native.openSettings ? { actionLabel: 'Open settings', action: () => native.openSettings() } : undefined);
    });
  }, []);
  useEffect(() => { setDismissed(false); }, [workspaceId, rootReady]);
  useEffect(() => {
    const check = () => setModalOpen(Boolean(document.querySelector('[aria-modal="true"]')));
    check(); const observer = new MutationObserver(check); observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const preference = () => setPrefs(readTipPreferences());
    const visibility = () => setHidden(document.hidden);
    const startTour = event => { if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) { lastFocus.current = document.activeElement; setTour(0); } };
    const settings = event => { if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) setSettingsOpen(true); };
    window.addEventListener('storage', preference); window.addEventListener('frondose-workspace-tour', startTour); window.addEventListener('frondose-workspace-tip-settings', settings); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('storage', preference); window.removeEventListener('frondose-workspace-tour', startTour); window.removeEventListener('frondose-workspace-tip-settings', settings); document.removeEventListener('visibilitychange', visibility); };
  }, [workspaceId]);
  const visible = prefs.enabled && !prefs.dismissedCategories.includes('workspace-folder') && !dismissed && tour === null && !settingsOpen && !modalOpen;
  const tip = useTipPresence(visible, prefs.movement);
  useEffect(() => { remaining.current = prefs.duration; }, [prefs.duration, rootReady, workspaceId]);
  useEffect(() => {
    if (!visible || !prefs.duration || hovered || focused || hidden) return undefined;
    const started = performance.now();
    const timer = setTimeout(() => setDismissed(true), remaining.current);
    return () => { clearTimeout(timer); remaining.current = remainingTipDuration(remaining.current, started, performance.now()); };
  }, [visible, prefs.duration, hovered, focused, hidden, workspaceId, rootReady]);
  useEffect(() => {
    if (tour === null || modalOpen) return undefined;
    const measure = () => { const target = document.querySelector(TOUR[tour].selector); if (!target || !target.getClientRects().length) { setPosition(null); return; } const rect=target.getBoundingClientRect();setPosition({...tourPosition(rect,{width:innerWidth,height:innerHeight}),spotlight:{left:Math.max(0,rect.left-5),top:Math.max(0,rect.top-5),right:Math.min(innerWidth,rect.right+5),bottom:Math.min(innerHeight,rect.bottom+5)}}); };
    measure(); window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true);
    const observer = new MutationObserver(measure); observer.observe(document.body, { childList: true, subtree: true });
    const frame = requestAnimationFrame(() => tourRef.current?.querySelector('button')?.focus({ preventScroll: true }));
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [tour, modalOpen]);
  useEffect(() => {
    if (tour === null) return undefined;
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); closeTour(); } };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [tour, closeTour]);
  return <>
    {tip.present ? createPortal(<aside className="workspace-help-tip" ref={tip.ref} role="status" data-closing={tip.closing || undefined} aria-hidden={tip.closing || undefined} inert={tip.closing ? true : undefined} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}><Info /><div><strong>{rootReady ? 'Your project folder is connected' : 'Choose a project folder when you’re ready'}</strong><p>{rootReady ? 'The file explorer uses the folder you selected. Local terminals run as your OS user, not inside a sandbox.' : 'Link a directory to browse its files and open new terminals there. Without one, terminals use your home folder. Selecting a directory never launches an agent.'}</p><div className="workspace-tip-actions">{!rootReady && onChooseDirectory ? <button type="button" onClick={onChooseDirectory}>Choose folder</button> : <button type="button" onClick={() => { lastFocus.current = document.activeElement; setTour(0); }}>Show me around</button>}<button type="button" onClick={() => { patch({ dismissedCategories: [...prefs.dismissedCategories, 'workspace-folder'] }); setDismissed(true); }}>Don’t show again</button><button type="button" aria-label="Tip settings" onClick={() => setSettingsOpen(true)}><Settings /></button></div></div><button type="button" className="workspace-tip-close" aria-label="Dismiss tip" onClick={() => setDismissed(true)}><X /></button></aside>, document.body) : null}
    {tour!==null&&!modalOpen&&position?.spotlight?createPortal(<div className="workspace-tour-shade" aria-hidden="true">{[{top:0,left:0,right:0,height:position.spotlight.top},{top:position.spotlight.bottom,left:0,right:0,bottom:0},{top:position.spotlight.top,left:0,width:position.spotlight.left,height:position.spotlight.bottom-position.spotlight.top},{top:position.spotlight.top,left:position.spotlight.right,right:0,height:position.spotlight.bottom-position.spotlight.top}].map((style,index)=><div key={index} style={style}/>)}</div>,document.body):null}
    {tour !== null && !modalOpen ? createPortal(<aside className={`workspace-feature-tour ${position?.above ? 'above' : ''} ${prefs.movement ? '' : 'no-motion'}`} ref={tourRef} role="dialog" aria-modal="false" aria-label="Workspace feature introduction" style={position ? { left: position.left, top: position.top, width: position.width, '--tour-arrow': `${position.arrowLeft}px` } : { left: '50%', top: '40%', transform: 'translate(-50%,-50%)', width: 'min(320px,calc(100vw - 24px))' }}><button type="button" className="workspace-tip-close" aria-label="Close introduction" onClick={closeTour}><X /></button><strong>{TOUR[tour].title}</strong><p>{position ? TOUR[tour].text : 'This control is not visible in the current layout. You can skip this step or replay the introduction later.'}</p><footer><small>{tour + 1} of {TOUR.length}</small><button type="button" onClick={closeTour}>Skip</button>{tour > 0 ? <button type="button" onClick={() => setTour(tour - 1)}>Back</button> : null}<button type="button" onClick={() => tour + 1 === TOUR.length ? closeTour() : setTour(tour + 1)}>{tour + 1 === TOUR.length ? 'Done' : 'Next'}</button></footer></aside>, document.body) : null}
    {settingsOpen ? <Dialog title="Workspace tips" onClose={() => setSettingsOpen(false)}><div className="dialog-body workspace-tip-settings"><label><input type="checkbox" checked={prefs.enabled} onChange={event => patch({ enabled: event.target.checked })} />Show contextual tips</label><label>How long tips stay<Select aria-label="Tip duration" value={prefs.duration} onChange={duration => patch({ duration: Number(duration) })}>{TIP_DURATIONS.map(duration => <option value={duration} key={duration}>{duration ? `${duration / 1000} seconds` : 'Until dismissed'}</option>)}</Select></label><label><input type="checkbox" checked={prefs.movement} onChange={event => patch({ movement: event.target.checked })} />Spring motion (respects reduced motion)</label><Button onClick={() => { patch({ dismissedCategories: [] }); setDismissed(false); }}>Reset hidden tips</Button><Button onClick={() => { setSettingsOpen(false); emit('frondose-workspace-onboarding', workspaceId); }}>Replay workspace setup</Button><Button onClick={() => { setSettingsOpen(false); lastFocus.current = document.activeElement; setTour(0); }}>Replay feature introduction</Button>{tipSaveError ? <p role="alert">{tipSaveError}</p> : null}</div><Button variant="primary" onClick={() => setSettingsOpen(false)}>Done</Button></Dialog> : null}
  </>;
}

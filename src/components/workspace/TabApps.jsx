import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePopupPosition } from '../usePopupPosition.js';
import { usePopupMotion } from '../usePopupMotion.js';
import { Button, ErrorMessage, useApp } from '../../ui.jsx';
import { AppWindow, Code, FileText, GitBranch, Globe, RotateCw, GitFork, ListChecks } from '../icons.jsx';
import { useApplications } from '../DesktopApplications.jsx';
import { apiRequest } from '../../data/api.js';
import { tabAppUrl, tabWebApp, TAB_WEB_APPS } from '../../lib/tab-apps.js';
import { tabAppAddress, rememberTabAppAddress, forgetTabAppAddress } from '../../lib/tab-app-sessions.js';
import { BrowserWorkspace } from './BrowserWorkspace.jsx';
import './tab-apps.css';
import {ServiceLogo} from '../ServiceLogo.jsx';
import {requestUpdateNavigation} from '../UnsavedUpdates.jsx';
function ToolOption({title,description,brand,icon:Icon=AppWindow,disabled,onChoose,onDocs}){return <div className="workspace-tool-option" role="presentation"><button type="button" role="menuitem" disabled={disabled} onClick={onChoose}>{brand?<ServiceLogo name={brand}/>:<Icon interactive={false}/>}<span><strong>{title}</strong><small>{description}</small></span></button><button className="workspace-tool-docs" type="button" role="menuitem" aria-label={`Go to Docs: ${title}`} onClick={onDocs}>Go to Docs ↗</button></div>;}
const DirectoryExplorer = lazy(() => import('./DirectoryFiles.jsx').then(module => ({ default: module.DirectoryExplorer })));
export function WorkspaceAppMenu({ onChoose, rootReady }) {
  const {navigate}=useApp();
  const docs=id=>requestUpdateNavigation(()=>{setOpen(false);navigate('docs',id);});
  const { state, error, busy, command } = useApplications(), trigger = useRef(null), panel = useRef(null), closing = useRef(null), [open, setOpen] = useState(false);
  const installed = state?.installed || [], vscode = installed.some(item => item.id === 'vscode'), updatedHost = typeof globalThis.frondoseDesktop?.browser?.claim === 'function';
  const position = usePopupPosition(open, trigger, { width: 330, height: 460, portal: true }), popup = usePopupMotion(open, panel, { ready: Boolean(position) });
  const cancelClose = () => { clearTimeout(closing.current); };
  const scheduleClose = () => { cancelClose(); closing.current = setTimeout(() => { if (!panel.current?.contains(document.activeElement)) setOpen(false); }, 180); };
  const show = () => { cancelClose(); setOpen(true); if (globalThis.frondoseDesktop?.applications && !busy) void command({ operation: 'list' }); };
  const choose = (kind, fields) => { setOpen(false); onChoose(kind, fields); };
  useEffect(() => () => clearTimeout(closing.current), []);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const key = event => { if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return; event.preventDefault(); const items = [...(panel.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])], index = items.indexOf(document.activeElement); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus(); };
  return <div className="workspace-app-launcher"><button ref={trigger} type="button" className="workspace-app-trigger" aria-label="Open App" aria-haspopup="menu" aria-expanded={open} onPointerEnter={event => { if (event.pointerType === 'mouse') show(); }} onPointerLeave={scheduleClose} onClick={show} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); requestAnimationFrame(() => panel.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus()); } }}><AppWindow /><span><strong>Open App</strong><small>Editors, repository tools & remote desktops</small></span></button>
    {popup.present ? createPortal(<div {...popup.motionProps} ref={panel} className="desktop-app-menu workspace-app-popup" role="menu" aria-label="Open App options" style={position || { visibility: 'hidden' }} onPointerEnter={cancelClose} onPointerLeave={scheduleClose} onKeyDown={key}>
      <ToolOption title="Text editor" description="Frondose source editor, file search & Markdown" icon={Code} disabled={!rootReady} onChoose={()=>choose('editor-home',{label:'Text editor'})} onDocs={()=>docs('files-search')}/>
      {vscode?<ToolOption title="VS Code Web" brand="vscode" description={updatedHost?"Set up Microsoft’s installed local web runtime":"Update Frondose desktop to enable web setup"} disabled={!rootReady||!updatedHost} onChoose={()=>choose('web-app',{appId:'vscode',label:'VS Code Web'})} onDocs={()=>docs('open-app-tabs')}/>:null}
      <ToolOption title="GitHub Dashboard" brand="github" description="File states, branches, issues, PRs & checks" onChoose={()=>choose('repository',{label:'GitHub Dashboard'})} onDocs={()=>docs('open-app-tabs')}/>
      { [['source-control','Source control','Diffs, inline notes, staging, commits & PRs'],['worktrees','Worktrees','Separate local branches and task directories'],['repository-tasks','Repository tasks','Start from GitHub issues or reviewed Routes']].map(([kind,label,description])=><ToolOption key={kind} title={label} description={description} icon={kind==='worktrees'?GitFork:kind==='repository-tasks'?ListChecks:GitBranch} disabled={!rootReady} onChoose={()=>choose(kind,{label})} onDocs={()=>docs('repository-work')}/>) }
      <ToolOption title="Browser" description="Isolated Chromium tab" icon={Globe} onChoose={()=>choose('browser', { label: 'Browser' })} onDocs={()=>docs('open-app-tabs')}/>
      <strong className="workspace-app-category">Remote desktop & web apps</strong>{TAB_WEB_APPS.filter(item => item.id !== 'vscode').map(item => <ToolOption key={item.id} title={item.name} description={item.description} onChoose={()=>choose('web-app',{appId:item.id,label:item.name})} onDocs={()=>docs('open-app-tabs')}/>)}
      {installed.some(item => ['editor','desktop'].includes(item.kind) && item.id !== 'vscode') ? <><strong className="workspace-app-category">Desktop-only · not embeddable</strong>{installed.filter(item => ['editor','desktop'].includes(item.kind) && item.id !== 'vscode').map(item => <button key={item.id} role="menuitem" disabled title="This native application does not expose an embedded web editor"><strong>{item.name}</strong><small>Cannot run inside a tab</small></button>)}</> : null}
      {globalThis.frondoseDesktop?.applications ? <button type="button" role="menuitem" disabled={busy} onClick={() => void command({ operation: 'list' })}>Refresh installed apps</button> : <small>Native installation detection requires Frondose desktop.</small>}
      <ErrorMessage error={error} />
    </div>, document.body) : null}
  </div>;
}
export function EditorHome({ workspaceId, binding, onOpenFile, onDirectory, onMarkdown }) {
  return <section className="editor-home"><header><h1><Code aria-hidden="true" /> Text editor</h1><Button icon={FileText} disabled={!binding} onClick={onMarkdown}>New Markdown file</Button></header><Suspense fallback={<p>Opening files…</p>}><DirectoryExplorer workspaceId={workspaceId} binding={binding} onOpenFile={onOpenFile} onBind={onDirectory} /></Suspense></section>;
}
export function WebAppWorkspace({ workspaceId, view, binding, onFocus }) {
  const app = tabWebApp(view.appId), key = `${workspaceId}:${view.entityId}`, bridge = globalThis.frondoseDesktop?.browser;
  const [connectedUrl, setConnectedUrl] = useState(() => tabAppAddress(workspaceId, view.entityId)), [address, setAddress] = useState(''), [setup, setSetup] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const { notify } = useApp(), alive = useRef(true), lock = useRef(false), [checked, setChecked] = useState(false);
  const changedRoot = view.appId === 'vscode' && view.rootVersion && view.rootVersion !== binding?.version;
  useEffect(() => {
    alive.current = true;
    if (bridge?.available && !tabAppAddress(workspaceId, view.entityId)) void bridge.state({ workspaceId, tabId: view.entityId }).then(state => { if (alive.current && state.applicationId === view.appId && state.url && state.url !== 'about:blank') { rememberTabAppAddress(workspaceId, view.entityId, state.url); setConnectedUrl(state.url); } }).catch(() => {});
    const closed = event => { if (event.detail?.workspaceId === workspaceId && event.detail?.entityId === view.entityId) forgetTabAppAddress(workspaceId, view.entityId); };
    window.addEventListener('frondose:tab-app-closed', closed);
    return () => { alive.current = false; window.removeEventListener('frondose:tab-app-closed', closed); };
  }, [key, workspaceId, view.entityId, bridge]);
  const prepare = async () => {
    if (!globalThis.frondoseDesktop?.applications) throw Error('VS Code detection and setup require the updated Frondose desktop app.');
    const { result: directory } = await apiRequest(`/api/directory-workspace?workspace_id=${encodeURIComponent(workspaceId)}`);
    if (!directory.ready || directory.binding?.version !== view.rootVersion) throw Error('Choose this workspace’s current directory before preparing VS Code Web.');
    const result = await globalThis.frondoseDesktop.applications.command({ operation: 'web-setup', id: 'vscode', workspaceId, expectedBindingVersion: view.rootVersion });
    if (alive.current) setSetup(result.setup); return result.setup;
  };
  const perform = async task => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    try { await task(); } catch (cause) { if (alive.current) setError(cause); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const connect = async event => {
    event.preventDefault();
    await perform(async () => {
      if (!bridge?.available || typeof bridge.claim !== 'function') throw Error('Update Frondose desktop to enable embedded app tabs. Your current window cannot use the new app-session bridge yet.');
      if (!checked) throw Error('Confirm that you control this local runtime or remote gateway first.');
      if (view.appId === 'vscode') await prepare();
      const url = tabAppUrl(address.trim(), view.appId);
      if (new URL(url).origin === location.origin) throw Error('Choose the application endpoint, not Frondose itself.');
      // Check the host lease before mounting a second view. It never navigates,
      // starts a native process or copies a third-party application's account.
      await bridge.claim({ workspaceId, tabId: view.entityId, applicationId: view.appId });
      if (alive.current) { rememberTabAppAddress(workspaceId, view.entityId, url); setConnectedUrl(url); setAddress(''); }
    });
  };
  if (!app) return <p>Unsupported application.</p>;
  if (connectedUrl) return <div className="tab-app-live"><BrowserWorkspace workspaceId={workspaceId} tabId={view.entityId} applicationId={view.appId} initialUrl={connectedUrl} onFocus={onFocus} /></div>;
  return <section className="tab-app-setup-page" aria-label={`${app.name} setup`}><h1>{app.name}</h1><p>{app.description}</p><ErrorMessage error={error} />
    {changedRoot ? <p role="alert">This tab belongs to a previous project directory. Open a new app tab for the current directory.</p> : null}
    {view.appId === 'vscode' ? <div className="tab-app-setup"><h2>Set up VS Code Web</h2><p>This uses the installed VS Code CLI’s local web runtime—not the desktop window. Close any running desktop VS Code first. No runtime starts or license terms are accepted automatically.</p><Button icon={RotateCw} busy={busy} disabled={changedRoot} onClick={() => void perform(prepare)}>Prepare setup command</Button>{setup ? <><pre aria-label="VS Code Web setup command" data-field-defaults-exclude="true">{setup.command}</pre><Button onClick={() => void perform(async () => { await navigator.clipboard.writeText(setup.command); notify('Setup command copied. Run it in a terminal and review Microsoft’s prompts yourself.'); })}>Copy setup command</Button><p>Run it in your terminal. Microsoft may ask you to accept its server license and download runtime components. Keep token protection enabled. Copy the loopback web URL printed by the CLI below. Closing this Frondose tab does not stop that separately started server.</p></> : null}</div> : <div className="tab-app-setup"><h2>Use an existing web gateway</h2><p>{view.appId === 'parallels-ras' ? 'Enter your organization’s Parallels RAS HTML5 portal. Its launch policy must be Browser only; a Parallels Desktop installation alone is not sufficient.' : view.appId === 'guacamole' ? 'Enter an existing Apache Guacamole portal. Your gateway supplies RDP, VNC or SSH access; Frondose does not install or configure that server.' : 'Enter an existing HTTPS application or a loopback HTTP service. Native desktop windows cannot be embedded.'}</p><p>Sign in inside the isolated application tab. Do not paste credentials or tokens into the portal address.</p></div>}
    <form className="tab-app-setup" onSubmit={connect} data-field-defaults-exclude="true"><label>{view.appId === 'vscode' ? 'Local VS Code web URL' : 'Gateway address'}<input aria-label={view.appId === 'vscode' ? 'Local VS Code web URL' : 'Gateway address'} type="url" autoComplete="off" spellCheck={false} maxLength={4096} value={address} placeholder={view.appId === 'vscode' ? 'http://127.0.0.1:…/?tkn=…' : 'https://your-gateway.example/'} onChange={event => setAddress(event.target.value)} /></label><label className="tab-app-confirm"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />I control this endpoint and want to interact with it in an isolated Frondose tab.</label><Button type="submit" busy={busy} disabled={!checked || !address.trim() || changedRoot || !bridge?.available}>Connect in this tab</Button></form>
    <p>One managed tab per app. Popups, downloads, device access and advanced clipboard integration may be unavailable; some remote-client features may therefore need their own supported client. Existing remote sessions in other applications cannot be reliably detected from Frondose.</p>
  </section>;
}

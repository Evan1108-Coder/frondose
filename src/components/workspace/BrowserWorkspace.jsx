import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, ExternalLink, Globe, KeyRound, RotateCw } from '../icons.jsx';
import './browser-workspace.css';
import {updateChecklist} from '../../lib/onboarding-checklist.js';
import { browserAddressUrl as addressUrl, browserInputUrl } from '../../lib/browser-address.js';
import { BrowserImportDialog } from './BrowserImportDialog.jsx';

function safeStartingUrl(value) { try { return addressUrl(value); } catch { return 'about:blank'; } }

/** Native guests are above DOM stacking contexts. A mobile file drawer can
 * cover their DOM placeholder without covering the real Chromium view. Detect
 * its actual overlay layout, not a viewport guess or the desktop flex pane. */
export function directoryOverlayBlocksGuest(element, bounds, readStyle = node => globalThis.getComputedStyle(node)) {
  const layout = element?.closest('.workspace-content-layout');
  if (!layout) return false;
  const guest = bounds || element.getBoundingClientRect();
  for (const pane of layout.querySelectorAll('.workspace-directory-pane')) {
    const style = readStyle(pane);
    if (!['absolute', 'fixed'].includes(style.position) || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || !pane.getClientRects().length) continue;
    const rect = pane.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.left < guest.right && rect.right > guest.left && rect.top < guest.bottom && rect.bottom > guest.top) return true;
  }
  return false;
}

/** Chromium guests do not inherit DOM overflow clipping. Never attach a guest
 * whose placeholder is even partly outside its pane, scroller or viewport:
 * shrinking/repositioning the native page would change its layout, not clip it.
 * Round inward so the host's integer DIP bounds cannot cross a fractional edge. */
export function visibleGuestBounds(element, { readStyle = node => globalThis.getComputedStyle(node), viewport = globalThis } = {}) {
  if (!element?.getClientRects().length) return null;
  const rect = element.getBoundingClientRect();
  const bounds = { x: Math.ceil(rect.left), y: Math.ceil(rect.top), width: Math.floor(rect.right) - Math.ceil(rect.left), height: Math.floor(rect.bottom) - Math.ceil(rect.top) };
  if (Object.values(bounds).some(value => !Number.isFinite(value)) || bounds.width < 2 || bounds.height < 2) return null;
  const visual = viewport.visualViewport;
  const left = visual?.offsetLeft || 0, top = visual?.offsetTop || 0;
  const width = visual?.width ?? viewport.innerWidth, height = visual?.height ?? viewport.innerHeight;
  const inside = (clip, horizontal = true, vertical = true) => (!horizontal || bounds.x >= clip.left && bounds.x + bounds.width <= clip.right) && (!vertical || bounds.y >= clip.top && bounds.y + bounds.height <= clip.bottom);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !inside({ left, top, right: left + width, bottom: top + height })) return null;
  for (let node = element; node; node = node.parentElement) {
    const style = readStyle(node);
    if (node.hidden || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden' || style.opacity === '0') return null;
    if (node === element) continue;
    const pane = node.matches?.('.workspace-view-body, .workspace-tab-content, .workspace-content-layout, .workspace-view-grid');
    const horizontal = pane || /^(hidden|clip|auto|scroll)$/.test(style.overflowX || style.overflow);
    const vertical = pane || /^(hidden|clip|auto|scroll)$/.test(style.overflowY || style.overflow);
    if (!horizontal && !vertical) continue;
    const box = node.getBoundingClientRect();
    const clipLeft = box.left + (node.clientLeft || 0), clipTop = box.top + (node.clientTop || 0);
    const clip = { left: clipLeft, top: clipTop, right: clipLeft + node.clientWidth, bottom: clipTop + node.clientHeight };
    if (!inside(clip, horizontal, vertical)) return null;
  }
  return bounds;
}

/** Browser pages live in the native host, independently of this view's React
 * lifetime. Tab replacement/unmount hides the guest; it never closes it. */
export function BrowserWorkspace({ workspaceId, tabId, initialUrl = 'about:blank', applicationId, active = true, onTitleChange, onFocus }) {
  const bridge = globalThis.frondoseDesktop?.browser;
  const available = Boolean(bridge?.available);
  const host = useRef(null), addressInput=useRef(null);
  const titleCallback = useRef(onTitleChange);
  titleCallback.current = onTitleChange;
  const focusCallback = useRef(onFocus), activeRef = useRef(active);
  focusCallback.current = onFocus; activeRef.current = active;
  const startingUrl = safeStartingUrl(initialUrl);
  const [page, setPage] = useState({ title: 'Browser', url: startingUrl, canGoBack: false, canGoForward: false, loading: false, error: null });
  const [address, setAddress] = useState(startingUrl === 'about:blank' ? '' : startingUrl);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [importOpen,setImportOpen]=useState(false);
  const identity = useCallback(() => ({ workspaceId, tabId, ...(applicationId ? { applicationId } : {}) }), [workspaceId, tabId, applicationId]);
  const applyState = useCallback(state => {
    if (!state || state.closed) return;
    setPage(state);
    if(document.activeElement!==addressInput.current)setAddress(state.url === 'about:blank' ? '' : state.url);
    titleCallback.current?.(state.title || 'Browser');
  }, []);

  useEffect(() => {
    setPage({ title: 'Browser', url: startingUrl, canGoBack: false, canGoForward: false, loading: false, error: null });
    setAddress(startingUrl === 'about:blank' ? '' : startingUrl);
    setError(null);
  }, [workspaceId, tabId, startingUrl]);

  useEffect(() => {
    if (!available) return undefined;
    return bridge.onState(state => {
      if (state.workspaceId !== workspaceId || state.tabId !== tabId) return;
      if (state.event === 'focus' && activeRef.current) focusCallback.current?.();
      applyState(state);
    });
  }, [available, bridge, workspaceId, tabId, applyState]);

  useEffect(() => {
    if (!available || !active || !host.current) return undefined;
    let disposed = false, frame = null;
    let shown = false, previousBounds = '';
    const hide = () => { if (shown) { shown = false; previousBounds = ''; void bridge.hide(identity()).catch(() => {}); } };
    const measure = () => {
      if (disposed) return;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        if (disposed || !host.current) return;
        const overlay = document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"], [role="menu"]');
        const rect = host.current.getBoundingClientRect();
        const bounds = visibleGuestBounds(host.current);
        if (document.hidden || document.documentElement.dataset.workspaceDragging === 'true' || overlay || !bounds || directoryOverlayBlocksGuest(host.current, rect)) { hide(); return; }
        const serialized = JSON.stringify(bounds);
        if (shown && previousBounds === serialized) return;
        shown = true;
        previousBounds = serialized;
        void bridge.show({ ...identity(), bounds, url: startingUrl }).then(state => { if (!disposed) { applyState(state); try{updateChecklist(workspaceId,{observed:{browser:true}});}catch{/* Optional setup tracking cannot block browsing. */} } }).catch(cause => { if (!disposed) { shown = false; previousBounds = ''; setError(cause.message); } });
      });
    };
    const resize = new ResizeObserver(measure);
    for (let node = host.current; node; node = node.parentElement) resize.observe(node);
    // Native guests are not DOM-clipped. Hide them while an app dialog/menu or
    // mobile file drawer is open, otherwise they could intercept those controls.
    const overlays = new MutationObserver(measure);
    overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'aria-modal', 'role', 'class', 'style', 'hidden'] });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('frondose:workspace-view-geometry', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    document.addEventListener('visibilitychange', measure);
    measure();
    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      resize.disconnect(); overlays.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('frondose:workspace-view-geometry', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
      document.removeEventListener('visibilitychange', measure);
      void bridge.hide(identity()).catch(() => {});
    };
  }, [available, active, bridge, identity, startingUrl, applyState]);

  async function command(operation, payload = {}) {
    setBusy(true); setError(null);
    try { applyState(await bridge[operation]({ ...identity(), ...payload })); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault();
    try {
      const url = browserInputUrl(address);
      if (!available) { setPage(current => ({ ...current, url })); return; }
      setAddress(url==='about:blank'?'':url);addressInput.current?.blur();
      await command('navigate', { url });
    } catch (cause) { setError(cause.message || 'Enter a web address.'); }
  }

  return <section className="workspace-browser" aria-label="Browser tab">
    <div className="workspace-browser-toolbar">
      <button type="button" aria-label="Go back" title="Go back" disabled={!available || !page.canGoBack || busy} onClick={() => command('back')}><ArrowLeft /></button>
      <button type="button" aria-label="Go forward" title="Go forward" disabled={!available || !page.canGoForward || busy} onClick={() => command('forward')}><ArrowRight /></button>
      <button type="button" aria-label="Reload page" title="Reload page" disabled={!available || busy} onClick={() => command('reload')}><RotateCw className={page.loading ? 'spin' : ''} /></button>
      <form onSubmit={submit} data-field-defaults-exclude="true"><Globe /><input ref={addressInput} aria-label="Browser address" placeholder="Search or enter a web address" value={address} onChange={event => setAddress(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} /><button type="submit" disabled={busy}>Go</button></form>
      <span className="workspace-browser-engine" title="Frondose embeds Chromium. Firefox and your installed browser profiles cannot be embedded in this tab."><Globe interactive={false}/><span>Chromium</span></span>
      {bridge?.importData && !applicationId ? <button type="button" aria-label="Import browser data" title="Import browser data" onClick={()=>setImportOpen(true)}><Download/></button> : null}
      {bridge?.savedPasswords && !applicationId ? <button type="button" aria-label="Saved passwords for this site" title="Saved passwords for this site" disabled={busy||page.loading||!page.url.startsWith('https://')} onClick={async()=>{setBusy(true);setError(null);try{await bridge.savedPasswords(identity());}catch(cause){setError(cause.message);}finally{setBusy(false);}}}><KeyRound/></button> : null}
      {available ? <button type="button" aria-label="Open in default browser" title="Open in default browser" disabled={page.url === 'about:blank'} onClick={async () => { try { await bridge.openExternal({ url: page.url }); } catch (cause) { setError(cause.message); } }}><ExternalLink /></button> : null}
    </div>
    {error || page.error ? <p className="workspace-browser-error" role="alert">{error || page.error}</p> : null}
    {available ? <div className="workspace-browser-guest" ref={host} aria-label={page.title || 'Web page'} /> : <div className="workspace-browser-unavailable"><Globe /><h2>Open Browser tabs in Frondose desktop</h2><p>A real isolated Chromium page needs the local desktop host. The ordinary web version cannot embed arbitrary websites or access your Chrome profile.</p>{page.url !== 'about:blank' ? <a href={page.url} target="_blank" rel="noopener noreferrer">Open this page in your browser <ExternalLink /></a> : <p className="muted">Your workspace and other tabs remain available here.</p>}</div>}
    {importOpen ? <BrowserImportDialog workspaceId={workspaceId} onClose={()=>setImportOpen(false)}/> : null}
  </section>;
}

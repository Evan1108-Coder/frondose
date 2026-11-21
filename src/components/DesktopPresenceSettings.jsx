import { useEffect, useRef, useState } from 'react';
import { Button, ErrorMessage } from '../ui.jsx';

export function DesktopPresenceSettings() {
  const bridge = globalThis.frondoseDesktop?.presence;
  const [state, setState] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const writing = useRef(false);
  useEffect(() => {
    if (!bridge) return;
    let live = true, revision = 0;
    const unsubscribe = bridge.onState?.(result => { revision++; if (live) setState(result); });
    const refresh = () => {
      const current = ++revision;
      void bridge.status().then(result => {
        if (live && current === revision && !writing.current) setState(result);
      }).catch(cause => { if (live && current === revision) setError(cause); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { live = false; unsubscribe?.(); window.removeEventListener('focus', refresh); };
  }, [bridge]);
  if (!bridge) return null;
  const update = async operation => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true); setError(null);
    try { setState(await operation()); }
    catch (cause) { setError(cause); }
    finally { writing.current = false; setBusy(false); }
  };
  const set = (key, value) => void update(() => bridge.set(key, value));
  const p = state?.preferences;
  const mac = globalThis.frondoseDesktop.platform === 'darwin';
  return <section className="local-installation-facts desktop-presence-settings" aria-label="Desktop presence">
    <h2>Desktop presence</h2>
    <ErrorMessage error={error}/>
    {!state && !error ? <p role="status">Loading desktop preferences…</p> : null}
    {p ? <fieldset disabled={busy}>
      {state.supported.tray ? <div className="desktop-presence-row">
        <label><input type="checkbox" checked={p.showTray} onChange={e => set('showTray', e.target.checked)} /> {mac ? 'Show menu bar icon' : 'Show system tray icon'}</label>
        <p>Find workspace shortcuts, activity, power and startup controls in the frond menu. An amber dot marks new activity while you’re away.</p>
        <Button disabled={!p.showTray || busy} onClick={() => void update(bridge.previewAttention)}>{(state.preview ?? state.attention) ? 'End dot preview' : 'Preview attention dot'}</Button>
      </div> : null}
      <div className="desktop-presence-row"><label><input type="checkbox" checked={p.keepRunning} onChange={e => set('keepRunning', e.target.checked)} /> Keep running when the window closes</label>
        <p>Preserve open work and drafts. {mac ? 'Reopen from the Dock or menu bar.' : 'Reopen from the tray or taskbar.'} Quit still exits the app.</p></div>
      <div className="desktop-presence-row"><label>Keep awake <select value={p.keepAwake} onChange={e => set('keepAwake', e.target.value)}>
        <option value="off">Off</option><option value="working">While an agent is working</option><option value="on">While Frondose is open</option>
      </select></label><p>Requests that the computer stay awake, without keeping the display on. Lid, battery, and system policies still apply. Idle terminal tabs don’t count as working agents.</p></div>
      {state.supported.dock ? <div className="desktop-presence-row"><label>Dock icon <select value={p.dockIcon} onChange={e => set('dockIcon', e.target.value)}>
        <option value="classic">Classic</option><option value="indigo">Indigo</option><option value="paper">Paper</option>
      </select></label><p>Changes the running app’s Dock icon, not the icon on disk.</p></div> : null}
      {state.supported.login ? <div className="desktop-presence-row"><label><input type="checkbox" checked={p.openAtLogin} onChange={e => set('openAtLogin', e.target.checked)} /> Open Frondose at login</label>
        <p>Opens the desktop app when you sign into this computer. This does not start a new agent session.</p></div> : null}
    </fieldset> : null}
  </section>;
}

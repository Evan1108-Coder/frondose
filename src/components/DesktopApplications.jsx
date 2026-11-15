import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog, ErrorMessage, Select, useApp } from '../ui.jsx';
import { useUnsavedUpdate } from './UnsavedUpdates.jsx';
import { apiRequest } from '../data/api.js';
import { usePopupPosition } from './usePopupPosition.js';
import { usePopupMotion } from './usePopupMotion.js';
const bridge = () => globalThis.frondoseDesktop?.applications;
export function useApplications() {
  const [state, setState] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false), lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const command = async payload => { if (lock.current) return; lock.current = true; setBusy(true); setError(null); try { if (!bridge()) throw Error('Install the updated Frondose desktop app to use native applications.'); const result = await bridge().command(payload); if (alive.current && result.selected) setState(result); return result; } catch (cause) { if (alive.current) setError(cause); } finally { lock.current = false; if (alive.current) setBusy(false); } };
  useEffect(() => { if (bridge()) void command({ operation: 'list' }); }, []);
  return { state, error, busy, command };
}
export function OpenInAppsSettings() {
  const { state, error, busy, command } = useApplications(), [editing, setEditing] = useState(null), [name, setName] = useState('');
  useUnsavedUpdate(Boolean(editing && name !== editing.name), busy);
  return <><header className="settings-heading"><div><h1>Open in Apps</h1><p>Choose installed editors available from this workspace's Open in menu.</p></div></header><ErrorMessage error={error}/>{!bridge() ? <p>Available in the updated Frondose desktop app.</p> : <><div className="settings-panel"><div className="setting-row"><span><strong>Installed applications</strong><small>Up to eight saved editors. Custom entries are selected with the native file picker, never shell commands.</small></span><Button disabled={busy} onClick={() => command({ operation: 'list' })}>Refresh detection</Button></div>{(state?.selected || []).map(item => <div key={item.id} className="setting-row"><span><strong>{item.name}</strong><small>{item.available ? 'Available' : 'Not found — refresh after installation'}</small></span><div style={{ display: 'flex', gap: 8 }}><Button disabled={busy} onClick={() => { setEditing(item); setName(item.name); }}>Rename</Button><Button disabled={busy} onClick={() => command({ operation: 'remove', id: item.id })}>Remove</Button></div></div>)}<div className="setting-row"><span><strong>Add application</strong></span><Select aria-label="Add application" disabled={busy || (state?.selected?.length || 0) >= 8} value="" onChange={id => { if (id) void command({ operation: 'add', ...(id !== 'custom' ? { id } : {}) }); }}><option value="">Choose an app…</option>{(state?.installed || []).filter(item => item.kind === 'editor' && !state.selected.some(selected => selected.id === item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="custom">Choose another app…</option></Select></div></div><section className="settings-group"><h2>External terminals</h2><div className="settings-panel">{(state?.installed || []).filter(item => item.kind === 'terminal').map(item => <div key={item.id} className="setting-row"><span><strong>{item.name}</strong><small>Detected · opens outside Frondose</small></span></div>)}{state && !state.installed.some(item => item.kind === 'terminal') ? <p>No supported external terminals detected. Frondose's embedded shell is still available.</p> : null}</div></section></>}{editing ? <Dialog title="Rename application" onClose={() => { if (!busy) setEditing(null); }}><form style={{ padding: 24 }} onSubmit={async event => { event.preventDefault(); const result = await command({ operation: 'rename', id: editing.id, name }); if (result) setEditing(null); }}><label>Application name<input aria-label="Application name" maxLength={60} required value={name} onChange={event => setName(event.target.value)}/></label><div className="form-submit-row"><Button disabled={busy} onClick={() => setEditing(null)}>Cancel</Button><button className="button primary" type="submit" disabled={busy || !name.trim()}>Save name</button></div></form></Dialog> : null}</>;
}
export function WorkspaceOpenIn({ workspaceId, binding }) {
  const { state, error, busy, command } = useApplications(), menu = useRef(null), trigger = useRef(null), panel = useRef(null), { navigate } = useApp();
  const [open, setOpen] = useState(false), id = useId(), firstItem = useRef('first');
  const position = usePopupPosition(open, trigger, { width: 230, height: Math.min(360, ((state?.selected?.length || 0) + 1) * 38 + (error ? 80 : 12)), portal: true });
  const popup = usePopupMotion(open, panel, { ready: Boolean(position) });
  const close = (restore = false) => { setOpen(false); if (menu.current) menu.current.open = false; if (restore) trigger.current?.focus(); };
  useEffect(() => { close(); }, [workspaceId]);
  useEffect(() => {
    if (!open) return;
    const items = () => [...(panel.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])];
    const frame = requestAnimationFrame(() => { const enabled = items(); enabled[firstItem.current === 'last' ? enabled.length - 1 : 0]?.focus(); });
    const outside = event => { if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const openAt = edge => { firstItem.current = edge; if (menu.current) menu.current.open = true; if (open) { const items = [...(panel.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]; items[edge === 'last' ? items.length - 1 : 0]?.focus(); } setOpen(true); };
  const menuKey = event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const items = [...(panel.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])];
    const index = items.indexOf(document.activeElement), next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  if (!bridge()) return null;
  return <details className="desktop-open-in" ref={menu} onToggle={event => { const next = event.currentTarget.open; setOpen(next); if (next) void command({ operation: 'list' }); }}><summary ref={trigger} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openAt(event.key === 'ArrowUp' ? 'last' : 'first'); } }} onClick={() => { firstItem.current = 'first'; }}>Open in</summary>{popup.present ? createPortal(<div {...popup.motionProps} id={id} ref={panel} className="desktop-app-menu" role="menu" aria-label="Open in applications" data-rumbo-popup={open || undefined} style={position || { visibility: 'hidden' }} onKeyDown={menuKey}><ErrorMessage error={error}/>{(state?.selected || []).map(item => <button key={item.id} type="button" role="menuitem" disabled={busy || !item.available} onClick={async () => { const result = await command({ operation: 'open', id: item.id, workspaceId, expectedBindingVersion: binding?.version ?? null }); if (result?.opened) close(true); }}>{item.name}</button>)}<button type="button" role="menuitem" onClick={() => { close(true); navigate('settings', 'open-in-apps'); }}>Manage applications…</button></div>, document.body) : null}</details>;
}
export function ExternalTerminalChoices() {
  const { state, error, busy, command } = useApplications(), { workspace } = useApp(), [directoryError, setDirectoryError] = useState(null);
  if (!bridge()) return null;
  return <details className="workspace-launch-menu" onToggle={event => { if (event.currentTarget.open) void command({ operation: 'list' }); }}><summary>External terminal</summary><div><ErrorMessage error={directoryError || error}/>{(state?.installed || []).filter(item => item.kind === 'terminal').map(item => <button key={item.id} disabled={busy} onClick={async () => { setDirectoryError(null); try { const directory = await apiRequest(`/api/directory-workspace?workspace_id=${encodeURIComponent(workspace.id)}`); await command({ operation: 'open', id: item.id, workspaceId: workspace.id, expectedBindingVersion: directory.result.binding?.version ?? null }); } catch (cause) { setDirectoryError(cause); } }}>{item.name}<small> Opens outside Frondose</small></button>)}{state && !state.installed.some(item => item.kind === 'terminal') ? <p>No supported terminals detected.</p> : null}</div></details>;
}

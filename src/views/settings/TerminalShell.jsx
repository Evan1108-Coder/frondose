import { useEffect, useState } from 'react';
import { Button, ErrorMessage } from '../../ui.jsx';
import { useUnsavedUpdate } from '../../components/UnsavedUpdates.jsx';
export function TerminalShell() {
  const [state, setState] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  useUnsavedUpdate(false, busy);
  useEffect(() => { let alive = true; globalThis.frondoseDesktop?.terminalShell?.({ operation: 'status' }).then(value => { if (alive) setState(value); }).catch(cause => { if (alive) setError(cause); }); return () => { alive = false; }; }, []);
  const select = async operation => { if (busy) return; setBusy(true); setError(null); try { setState(await globalThis.frondoseDesktop.terminalShell({ operation })); } catch (cause) { setError(cause); } finally { setBusy(false); } };
  return <section className="settings-group"><h2>Terminal shell</h2><div className="settings-panel"><ErrorMessage error={error}/><div className="setting-row"><span><strong>{state?.name || 'System shell'}</strong><small>Applies only to new embedded shells. Existing sessions and AI CLI launch commands are unchanged.</small></span>{globalThis.frondoseDesktop?.terminalShell ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button disabled={busy} aria-pressed={state?.mode === 'system'} onClick={() => select('system')}>System shell</Button><Button disabled={busy} aria-pressed={state?.mode === 'custom'} onClick={() => select('choose')}>Choose custom shell…</Button></div> : <span>Custom selection requires the updated desktop app.</span>}</div></div></section>;
}

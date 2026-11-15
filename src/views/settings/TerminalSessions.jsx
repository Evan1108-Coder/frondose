import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, ErrorMessage } from '../../ui.jsx';
import { workbenchRequest } from '../../lib/workbench.js';
import { apiRequest } from '../../data/api.js';
import { assertLocalTerminalSettingsTarget } from '../../lib/local-terminal-settings.js';
import { readWorkspaceTerminalViewStatus, stopWorkspaceTerminalView } from '../../lib/workspace-terminal-close.js';
import { useUnsavedUpdate } from '../../components/UnsavedUpdates.jsx';
export function TerminalSessions({ target }) {
  const [sessions, setSessions] = useState([]), [error, setError] = useState(null), [review, setReview] = useState(null), [busy, setBusy] = useState(false), alive = useRef(true), lock = useRef(false), revision = useRef(0);
  useUnsavedUpdate(false, busy);
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++revision.current; }; }, []);
  const refresh = async () => { const generation = ++revision.current; try { const result = await workbenchRequest(target.scope, ''); if (alive.current && generation === revision.current) { setSessions(result.terminals || []); setError(null); } } catch (cause) { if (alive.current && generation === revision.current) setError(cause); } };
  useEffect(() => { setReview(null); setSessions([]); void refresh(); return () => { ++revision.current; }; }, [target.identity]);
  const prepare = async selected => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    try {
      const directory = await apiRequest(`/api/directory-workspace?workspace_id=${encodeURIComponent(target.scope.workspaceId)}`); assertLocalTerminalSettingsTarget(target, directory.result);
      const prefix = `frondose:terminal-splits:v1:${target.scope.workspaceId}:${target.scope.host === 'workspace' ? 'workspace' : target.scope.projectId}::`;
      const hints = []; for (let index = 0; index < Math.min(localStorage.length, 2000); index++) { const key = localStorage.key(index); if (key?.startsWith(prefix)) hints.push(key.slice(prefix.length)); }
      const ids = [...new Set([...selected.map(session => session.owner_view_id).filter(Boolean), ...hints])].slice(0, 100);
      if (!ids.length || ids.length > 200) throw Error('These sessions have no verified view ownership. Keep their original tabs open to manage them.');
      const candidates = await Promise.all(ids.map(id => readWorkspaceTerminalViewStatus(target.scope, id)));
      const statuses = candidates.filter(status => status.sessions.some(session => selected.some(item => item.id === session.id)));
      if (selected.some(item => !statuses.some(status => status.sessions.some(session => session.id === item.id)))) throw Error('Some selected sessions have no verified saved-tab ownership. Nothing was stopped.');
      if (statuses.some(status => !status.verified || status.state === 'unknown')) throw Error('Session ownership could not be verified. Nothing was stopped.');
      if (alive.current) setReview(statuses.filter(status => status.canStop));
    } catch (cause) { if (alive.current) setError(cause); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const stop = async () => {
    if (lock.current || !review?.length) return; lock.current = true; setBusy(true); setError(null);
    try { for (const status of review) { const directory = await apiRequest(`/api/directory-workspace?workspace_id=${encodeURIComponent(target.scope.workspaceId)}`); assertLocalTerminalSettingsTarget(target, directory.result); await stopWorkspaceTerminalView(target.scope, status.viewId, { reviewedStatus: status, confirmed: true }); } if (alive.current) setReview(null); }
    catch (cause) { if (alive.current) setError(new Error(`${cause.message} Earlier confirmed stops, if any, remain stopped. Refresh before trying again.`)); }
    finally { lock.current = false; if (alive.current) { setBusy(false); void refresh(); } }
  };
  const live = sessions.filter(session => ['running', 'stopping'].includes(session.status));
  return <section className="settings-group"><h2>Manage sessions</h2><div className="settings-panel"><div className="setting-row"><span><strong>{live.length} active sessions</strong><small>Only this workspace's current terminal host. Stopping ends work; it does not undo file changes. There is no separate restartable daemon.</small></span><div style={{ display: 'flex', gap: 8 }}><Button disabled={busy} onClick={refresh}>Refresh</Button><Button disabled={busy || !live.length} onClick={() => prepare(live)}>Review stop all</Button></div></div><ErrorMessage error={error}/>{sessions.slice(0, 200).map(session => <div className="setting-row" key={session.id}><span><strong>{session.name || 'Terminal'}</strong><small>{session.status} · {session.id}</small></span>{['running', 'stopping'].includes(session.status) ? <Button disabled={busy} onClick={() => prepare([session])}>Review stop</Button> : null}</div>)}</div>{review ? <Dialog title="Stop these sessions?" closeDisabled={busy} onClose={() => { if (!busy) setReview(null); }}><div style={{ padding: 24 }}><p>This stops every running pane in the selected tab{review.length > 1 ? 's' : ''}. Sessions will not automatically resume.</p><ul>{review.flatMap(status => status.sessions.filter(session => status.stopSessionIds.includes(session.id))).map(session => <li key={session.id}>{session.name}</li>)}</ul><ErrorMessage error={error}/></div><div className="form-submit-row"><Button disabled={busy} onClick={() => setReview(null)}>Cancel</Button><Button variant="danger" busy={busy} disabled={!review.length} onClick={stop}>Stop confirmed sessions</Button></div></Dialog> : null}</section>;
}

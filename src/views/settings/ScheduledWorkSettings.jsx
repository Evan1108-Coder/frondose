import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, ErrorMessage, useApp } from '../../ui.jsx';
import { Clock, RotateCw } from '../../components/icons.jsx';
import { apiRequest } from '../../data/api.js';
import { RescheduleWorkDialog } from '../../components/ScheduledWork.jsx';
import { localScheduleTime } from '../../lib/scheduled-time.js';

function ScheduleCard({ item, busy, onTime, onState, onCancel }) {
  const { data, navigate } = useApp();
  const chatView = data.chats.find(chat => chat.id === item.payload.chat_id)?.kind === 'rumbo-agent' ? 'rumbo-agent' : 'chats';
  const last = item.history[0], state = item.state === 'finished' ? last?.status || 'finished' : item.state;
  const kind = item.kind === 'message' ? item.payload.agent_id ? 'Message to agent' : 'Conversation note' : 'Approved action';
  return <article className="scheduled-work-item">
    <div className="scheduled-work-heading"><div><h2>{item.title}</h2><small>{kind}{item.next_due_at ? ` · ${localScheduleTime(item.next_due_at, item.timezone).replace('T', ' ')} · ${item.timezone}` : ''}{item.recurrence !== 'none' ? ` · ${item.recurrence}` : ''}</small></div><span className="scheduled-work-badge">{state}</span></div>
    {item.payload.content ? <p className="scheduled-work-message">{item.payload.content}</p> : null}
    {last?.error ? <p className="scheduled-work-error">Last occurrence: {last.error.message}</p> : null}
    <div className="scheduled-work-controls">
      {item.payload.chat_id ? <Button variant="ghost" onClick={() => navigate(chatView, item.payload.chat_id)}>Open conversation</Button> : null}
      {item.can_edit && ['active', 'paused'].includes(item.state) ? <><Button disabled={busy} onClick={() => onTime(item)}>Change time</Button><Button disabled={busy} onClick={() => item.state === 'active' ? onState(item, 'paused') : Date.parse(item.next_due_at) <= Date.now() ? onTime(item) : onState(item, 'active')}>{item.state === 'active' ? 'Pause' : 'Resume'}</Button><Button variant="ghost" disabled={busy} onClick={() => onCancel(item)}>Cancel schedule</Button></> : null}
    </div>
    <details className="scheduled-work-history"><summary>Activity · {item.history.length} {item.history.length === 1 ? 'occurrence' : 'occurrences'}</summary>
      {item.history.length ? <ol>{item.history.map(event => {
        const resultView = { tasks: 'tasks', projects: 'projects', documents: 'documents', chats: 'chats' }[event.result?.resource];
        return <li key={event.id}><strong>{event.status}</strong><time dateTime={event.due_at}>{new Date(event.due_at).toLocaleString()}</time>{event.error ? <span>{event.error.message}</span> : null}
          {event.result?.run_id ? <a href={`#/work/${encodeURIComponent(event.result.run_id)}`}>View agent run</a> : null}
          {event.result?.source_run_id ? <a href={`#/work/${encodeURIComponent(event.result.source_run_id)}`}>View source run</a> : null}
          {resultView && event.result?.id ? <a href={`#/${resultView}/${encodeURIComponent(event.result.id)}`}>View result</a> : null}
          {event.result?.message_id && item.payload.chat_id ? <a href={`#/${chatView}/${encodeURIComponent(item.payload.chat_id)}?message=${encodeURIComponent(event.result.message_id)}`}>View message</a> : null}
        </li>;
      })}</ol> : <p>No occurrences yet.</p>}
    </details>
  </article>;
}

export function ScheduledWorkSettings() {
  const { workspace, navigate, notify } = useApp();
  const [items, setItems] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(null), [reload, setReload] = useState(0), [selected, setSelected] = useState(null), [cancel, setCancel] = useState(null), [busy, setBusy] = useState(false);
  const pending = useRef(false);
  pending.current = items.some(item => item.state === 'active' || item.history.some(event => event.status === 'running'));
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    const fetchItems = () => apiRequest(`/api/scheduled-work?workspace_id=${encodeURIComponent(workspace.id)}`, { signal: controller.signal }).then(response => { setItems(response.result); setError(null); }).catch(cause => { if (!controller.signal.aborted) setError(current => current?.message === cause.message ? current : cause); });
    fetchItems().finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const timer = setInterval(() => { if (pending.current && !document.hidden) fetchItems(); }, 15000);
    const focus = () => { if (pending.current) fetchItems(); };
    window.addEventListener('focus', focus);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [workspace.id, reload]);
  const replace = value => setItems(current => current.map(item => item.id === value.id ? value : item));
  async function change(item, state) {
    setBusy(true); setError(null);
    try { const response = await apiRequest(`/api/scheduled-work/${item.id}`, { method: 'PATCH', body: { version: item.version, state } }); replace(response.result); setCancel(null); notify(state === 'cancelled' ? 'Schedule cancelled' : state === 'paused' ? 'Schedule paused' : 'Schedule resumed'); }
    catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  return <>
    <header className="scheduled-settings-header"><div><h1>Scheduled messages & actions</h1><p>Schedule from a conversation or an agent’s proposed action. Manage upcoming work and its activity here.</p></div><Button icon={RotateCw} onClick={() => setReload(value => value + 1)} disabled={loading}>Refresh</Button></header>
    <ErrorMessage error={error} />
    {loading ? <p role="status">Loading schedules…</p> : !items.length ? <div className="scheduled-settings-empty"><Clock /><h2>Nothing scheduled</h2><p>Write a message in a conversation, then choose Schedule. An agent’s proposed change can also be approved for a later time.</p><Button onClick={() => navigate('chats')}>Open conversations</Button></div> : <div className="scheduled-settings-list">{items.map(item => <ScheduleCard key={item.id} item={item} busy={busy} onTime={setSelected} onState={change} onCancel={setCancel} />)}</div>}
    {selected ? <RescheduleWorkDialog item={selected} onClose={() => setSelected(null)} onSaved={replace} /> : null}
    {cancel ? <Dialog title="Cancel this schedule?" subtitle={cancel.title} onClose={() => !busy && setCancel(null)}><div className="schedule-dialog-body"><p>Future occurrences will stop. Messages and actions that have already run stay in their history.</p><footer className="form-submit-row"><Button disabled={busy} onClick={() => setCancel(null)}>Keep schedule</Button><Button variant="danger" busy={busy} onClick={() => change(cancel, 'cancelled')}>Cancel schedule</Button></footer></div></Dialog> : null}
  </>;
}

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Dialog, ErrorMessage, useApp } from '../../ui.jsx';
import { Clock, RotateCw } from '../../components/icons.jsx';
import { apiRequest } from '../../data/api.js';
import { RescheduleWorkDialog } from '../../components/ScheduledWork.jsx';
import { localScheduleTime } from '../../lib/scheduled-time.js';
import { createScheduledWorkLoader } from '../../lib/scheduled-work-loader.js';

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

// The keyed boundary removes the previous workspace's prompts and dialogs on
// the workspace-changing render, before any effect or new request completes.
export function ScheduledWorkSettings({ embedded = false, header = true }) {
  const { workspace } = useApp();
  return <ScheduledWorkList key={workspace.id} workspaceId={workspace.id} embedded={embedded} header={header} />;
}

function ScheduledWorkList({ workspaceId, embedded, header }) {
  const { navigate, notify } = useApp();
  const [selected, setSelected] = useState(null), [cancel, setCancel] = useState(null);
  const loader = useMemo(() => createScheduledWorkLoader(signal => apiRequest(`/api/scheduled-work?workspace_id=${encodeURIComponent(workspaceId)}`, { signal }).then(response => response.result)), [workspaceId]);
  const { items, loading, error, busy } = useSyncExternalStore(loader.subscribe, loader.getSnapshot, loader.getSnapshot);
  useEffect(() => {
    void loader.start();
    const refreshVisible = () => { if (!document.hidden) void loader.load(); };
    const timer = setInterval(refreshVisible, 15000);
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('online', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { loader.dispose(); clearInterval(timer); window.removeEventListener('focus', refreshVisible); window.removeEventListener('online', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible); };
  }, [loader]);
  useEffect(() => { if (error) { setSelected(null); setCancel(null); } }, [error]);
  const visibleSelected = !error && selected && items.some(item => item.id === selected.id) ? selected : null;
  const visibleCancel = !error && cancel && items.some(item => item.id === cancel.id) ? cancel : null;
  const replace = value => { if (loader.accept(value)) void loader.load(); };
  async function change(item, state) {
    const result = await loader.mutate(() => apiRequest(`/api/scheduled-work/${item.id}`, { method: 'PATCH', body: { version: item.version, state } }).then(response => response.result));
    if (result) { setCancel(null); notify(state === 'cancelled' ? 'Schedule cancelled' : state === 'paused' ? 'Schedule paused' : 'Schedule resumed'); }
  }
  return <>
    {header ? <header className="scheduled-settings-header"><div>{embedded ? <h2>Scheduled messages & actions</h2> : <h1>Scheduled messages & actions</h1>}<p>Schedule from a conversation or an agent’s proposed action. Manage upcoming work and its activity here.</p></div><Button icon={RotateCw} onClick={() => loader.load()} disabled={loading || busy}>Refresh</Button></header> : null}
    <ErrorMessage error={error} />
    {loading ? <p role="status">Loading schedules…</p> : error ? <div className="scheduled-settings-empty"><Clock /><h2>Schedules unavailable</h2><p>Talvori could not refresh your schedules. Previously loaded prompts are hidden until access and data can be checked again.</p><Button onClick={() => loader.load()}>Retry schedules</Button></div> : !items.length ? <div className="scheduled-settings-empty"><Clock /><h2>Nothing scheduled</h2><p>Write a message in a conversation, then choose Schedule. An agent’s proposed change can also be approved for a later time.</p><Button onClick={() => navigate('chats')}>Open conversations</Button></div> : <div className="scheduled-settings-list">{items.map(item => <ScheduleCard key={item.id} item={item} busy={busy} onTime={setSelected} onState={change} onCancel={setCancel} />)}</div>}
    {visibleSelected ? <RescheduleWorkDialog item={visibleSelected} onClose={() => setSelected(null)} onSaved={replace} /> : null}
    {visibleCancel ? <Dialog title="Cancel this schedule?" subtitle={visibleCancel.title} onClose={() => !busy && setCancel(null)}><div className="schedule-dialog-body"><p>Future occurrences will stop. Messages and actions that have already run stay in their history.</p><footer className="form-submit-row"><Button disabled={busy} onClick={() => setCancel(null)}>Keep schedule</Button><Button variant="danger" busy={busy} onClick={() => change(visibleCancel, 'cancelled')}>Cancel schedule</Button></footer></div></Dialog> : null}
  </>;
}

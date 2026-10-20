import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, Dialog, ErrorMessage, Field, Select, useApp } from '../ui.jsx';
import { Activity, Plus, RotateCw } from './icons.jsx';
import { ContextInspector } from './ContextInspector.jsx';
import { createScheduledWorkLoader } from '../lib/scheduled-work-loader.js';
import { EVENT_WORK_EVENTS, eventWorkCreateRequest, eventWorkInspectionRequest, eventWorkRecipients } from '../lib/event-work-ui.js';
import { val, visible } from '../lib/model.js';
import './event-work.css';

const eventLabel = id => EVENT_WORK_EVENTS.find(item => item.id === id)?.label || id;

function EventWorkDialog({ workspaceId, onClose, onCreated }) {
  const { data, workspace } = useApp();
  const recipients = eventWorkRecipients(data, workspaceId);
  const [form, setForm] = useState({ title: '', recipient: recipients[0]?.id || '', event: 'route.created', targetType: 'workspace', targetId: workspaceId, content: '', cooldown: '30' });
  const [reviewing, setReviewing] = useState(false), [reviewed, setReviewed] = useState(null), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const mounted = useRef(true), retry = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const recipient = recipients.find(item => item.id === form.recipient);
  const scopeOptions = form.targetType === 'workspace' ? [{ id: workspaceId, name: workspace.name }] : visible(({ project: data.projects, route: data.tasks, area: data.teams })[form.targetType] || []).filter(item => val(item, 'workspace_id') === workspaceId).map(item => ({ id: item.id, name: item.name || item.title || item.id }));
  const selectedScope = scopeOptions.find(item => item.id === form.targetId);
  const inspectionRequest = eventWorkInspectionRequest(workspaceId, recipient, form.content);
  const fingerprint = JSON.stringify([form, recipient?.agent?.version || null]);
  const contextUsable = reviewing && reviewed?.fingerprint === fingerprint && Date.parse(reviewed.inspection.expires_at) > Date.now();
  function patch(key, value) { setForm(current => ({ ...current, [key]: value })); setReviewed(null); setConfirmed(false); }
  function review(event) {
    event.preventDefault(); setError(null);
    if (!recipient || !selectedScope || !inspectionRequest) { setError(new Error('Choose an available connected conversation and event scope.')); return; }
    if (!retry.current || retry.current.fingerprint !== fingerprint) retry.current = { fingerprint, id: crypto.randomUUID() };
    setReviewing(true);
  }
  async function enable(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try {
      if (!contextUsable || !selectedScope) throw new Error('Context or event scope changed. Go back and review the trigger again.');
      const body = eventWorkCreateRequest({ workspaceId, title: form.title, event: form.event, targetType: form.targetType, targetId: form.targetId, recipient, content: form.content, cooldownMinutes: Number(form.cooldown), inspection: reviewed.inspection, confirmed, requestId: retry.current?.id });
      const response = await apiRequest('/api/event-work', { method: 'POST', body });
      if (!mounted.current) return;
      onCreated(response.result); onClose();
    } catch (cause) { if (mounted.current) setError(cause); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <Dialog title={reviewing ? 'Review event-triggered work' : 'New event trigger'} subtitle="A recorded workspace event can start one reviewed agent request." wide closeDisabled={busy} onClose={() => !busy && onClose()}>
    {!reviewing ? <form className="event-work-editor" onSubmit={review}>
      <Field label="Name"><input autoFocus required maxLength={160} value={form.title} onChange={event => patch('title', event.target.value)} placeholder="e.g. Review new Routes" data-field-default-key="event-work.create.title" data-field-default-page="Event trigger" data-field-default-label="Name" data-field-default-mode="create" /></Field>
      <Field label="Agent conversation"><Select required value={form.recipient} onChange={value => patch('recipient', value)}><option value="">Choose a connected agent conversation</option>{recipients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></Field>
      <div className="event-work-fields"><Field label="When"><Select value={form.event} onChange={value => patch('event', value)}>{EVENT_WORK_EVENTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></Field><Field label="Scope"><Select value={form.targetType} onChange={value => { setForm(current => ({ ...current, targetType: value, targetId: value === 'workspace' ? workspaceId : '' })); setReviewed(null); }}><option value="workspace">This workspace</option><option value="project">One project</option><option value="route">One Route</option><option value="area">One Area</option></Select></Field></div>
      {form.targetType !== 'workspace' ? <Field label={{ project: 'Project', route: 'Route', area: 'Area' }[form.targetType]}><Select required value={form.targetId} onChange={value => patch('targetId', value)}><option value="">Choose {form.targetType === 'area' ? 'an Area' : form.targetType === 'route' ? 'a Route' : 'a project'}</option>{scopeOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field> : null}
      <Field label="Prompt"><textarea required rows={5} maxLength={10000} value={form.content} onChange={event => patch('content', event.target.value)} placeholder="What should this agent do when the event happens?" data-field-default-key="event-work.create.prompt" data-field-default-page="Event trigger" data-field-default-label="Prompt" data-field-default-mode="create" /></Field>
      <Field label="Minimum time between runs (minutes)" hint="Choose 5 to 1,440 minutes. Events during this cooldown are skipped, not queued."><input className="event-work-cooldown-input" required type="number" min={5} max={1440} step={1} value={form.cooldown} onChange={event => patch('cooldown', event.target.value)} /></Field>
      <p className="event-work-note">Each run uses your saved prompt and reviewed context, plus the triggering event’s type, source type, source ID and recorded time. Future event text, titles, status values, new messages and other workspace changes are not added. External Plugin events are not supported.</p>
      <ErrorMessage error={error} /><footer className="form-submit-row"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={!recipient || !selectedScope || !form.title.trim() || !form.content.trim()}>Review context</Button></footer>
    </form> : <form className="event-work-editor" onSubmit={enable}>
      <dl className="event-work-review"><div><dt>Trigger</dt><dd>{eventLabel(form.event)} · {selectedScope?.name || 'Scope unavailable'}</dd></div><div><dt>Conversation</dt><dd>{recipient?.label || 'Connection unavailable'}</dd></div><div><dt>Cooldown</dt><dd>{form.cooldown} minutes</dd></div><div><dt>Prompt</dt><dd className="event-work-prompt">{form.content}</dd></div></dl>
      <ContextInspector request={inspectionRequest} onReviewed={inspection => setReviewed({ fingerprint, inspection })} onInvalidated={() => { setReviewed(null); setConfirmed(false); }} />
      <label className="event-work-consent"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>I authorize recurring agent runs for events in this scope, using the reviewed snapshot plus each event’s type, source type, source ID and recorded time. Each run may use paid provider credits, with at most 12 dispatches in 24 hours for this trigger. Response actions keep their own permission and review checks.</span></label>
      <p className="event-work-note">Frondose’s server must stay running and connected. Missed events are not backfilled. One run can be active at a time; cooldown and daily-limit skips remain in activity.</p>
      <ErrorMessage error={error} /><footer className="form-submit-row"><Button disabled={busy} onClick={() => { setReviewing(false); setReviewed(null); setConfirmed(false); }}>Back</Button><Button type="submit" variant="primary" busy={busy} disabled={!contextUsable || !confirmed || !recipient || !selectedScope}>Enable event trigger</Button></footer>
    </form>}
  </Dialog>;
}

function EventWorkCard({ item, busy, onChange, onCancel }) {
  const { data, navigate } = useApp();
  const chatView = data.chats.find(chat => chat.id === item.payload?.chat_id)?.kind === 'rumbo-agent' ? 'rumbo-agent' : 'chats';
  const scope = item.trigger?.target_type === 'workspace' ? 'This workspace' : ({ project: data.projects, route: data.tasks, area: data.teams })[item.trigger?.target_type]?.find(row => row.id === item.trigger.target_id);
  const scopeLabel = typeof scope === 'string' ? scope : scope?.name || scope?.title || 'Selected scope';
  const history = Array.isArray(item.history) ? item.history : [];
  return <article className="scheduled-work-item event-work-item">
    <div className="scheduled-work-heading"><div><h3>{item.title}</h3><small>{eventLabel(item.trigger?.event)} · {scopeLabel} · {item.cooldown_minutes}-minute cooldown</small></div><span className="scheduled-work-badge">{item.state}</span></div>
    <p className="scheduled-work-message">{item.payload?.content}</p>
    <div className="scheduled-work-controls"><Button variant="ghost" onClick={() => navigate(chatView, item.payload.chat_id)}>Open conversation</Button>{item.can_edit && ['active', 'paused'].includes(item.state) ? <><Button disabled={busy} onClick={() => onChange(item, item.state === 'active' ? 'paused' : 'active')}>{item.state === 'active' ? 'Pause trigger' : 'Resume trigger'}</Button><Button variant="ghost" disabled={busy} onClick={() => onCancel(item)}>Cancel trigger</Button></> : null}</div>
    <details className="scheduled-work-history"><summary>Event activity · {history.length} recorded {history.length === 1 ? 'event' : 'events'}</summary>{history.length ? <ol>{history.map(receipt => <li key={receipt.id}><strong>{String(receipt.status).replaceAll('_', ' ')}</strong><time dateTime={receipt.occurred_at}>{new Date(receipt.occurred_at).toLocaleString()}</time><span>{eventLabel(receipt.event_type)}</span>{receipt.error?.message ? <span>{receipt.error.message}</span> : null}{receipt.result?.run_id ? <a href={`#/work/${encodeURIComponent(receipt.result.run_id)}`}>View agent run</a> : null}</li>)}</ol> : <p>No matching recorded events yet.</p>}</details>
  </article>;
}

export function EventWork({ workspaceId }) {
  const { data, notify, navigate } = useApp();
  const [creating, setCreating] = useState(false), [cancel, setCancel] = useState(null);
  const recipients = eventWorkRecipients(data, workspaceId);
  const loader = useMemo(() => createScheduledWorkLoader(signal => apiRequest(`/api/event-work?workspace_id=${encodeURIComponent(workspaceId)}`, { signal }).then(response => response.result?.items)), [workspaceId]);
  const { items, loading, error, busy } = useSyncExternalStore(loader.subscribe, loader.getSnapshot, loader.getSnapshot);
  useEffect(() => {
    void loader.start();
    const refresh = () => { if (!document.hidden) void loader.load(); };
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { loader.dispose(); clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [loader]);
  useEffect(() => { if (error) { setCreating(false); setCancel(null); } }, [error]);
  async function change(item, state) {
    const result = await loader.mutate(() => apiRequest(`/api/event-work/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { version: item.version, state } }).then(response => response.result));
    if (result) { setCancel(null); notify(state === 'cancelled' ? 'Event trigger cancelled' : state === 'paused' ? 'Event trigger paused' : 'Event trigger resumed'); }
  }
  const visibleCancel = !error && cancel && items.some(item => item.id === cancel.id) ? cancel : null;
  return <section className="event-work" aria-labelledby="event-work-title">
    <header className="event-work-header"><div><h2 id="event-work-title">Event-triggered work</h2><p>Run a reviewed agent request when a supported workspace event is recorded.</p></div><div><Button icon={RotateCw} onClick={() => loader.load()} disabled={loading || busy}>Refresh events</Button><Button icon={Plus} variant="primary" onClick={() => setCreating(true)} disabled={loading || busy || !!error || !recipients.length}>New event trigger</Button></div></header>
    <p className="event-work-note">Up to 5 active triggers per account in this workspace. Each trigger has a 12-dispatch daily limit and a cooldown of at least 5 minutes. Recorded events only; the server must remain online.</p>
    {!recipients.length ? <div className="event-work-connection"><p>Create a conversation with a connected AI agent before enabling event-triggered work.</p><Button onClick={() => navigate('connections')}>AI Connections</Button><Button variant="ghost" onClick={() => navigate('rumbo-agent')}>Open Frondose</Button></div> : null}
    <ErrorMessage error={error} />
    {loading ? <p role="status">Loading event triggers…</p> : error ? <div className="scheduled-settings-empty"><h3>Event triggers unavailable</h3><p>Previously loaded prompts are hidden until your access and current data can be checked.</p><Button onClick={() => loader.load()}>Retry event triggers</Button></div> : items.length ? <div className="scheduled-settings-list">{items.map(item => <EventWorkCard key={item.id} item={item} busy={busy} onChange={change} onCancel={setCancel} />)}</div> : <div className="event-work-empty"><Activity /><h3>No event triggers</h3><p>Choose an event, a connected agent conversation and an exact prompt. Review the captured context before enabling recurring work.</p></div>}
    {creating ? <EventWorkDialog workspaceId={workspaceId} onClose={() => setCreating(false)} onCreated={item => { if (loader.accept(item)) void loader.load(); notify('Event trigger enabled'); }} /> : null}
    {visibleCancel ? <Dialog title="Cancel this event trigger?" subtitle={visibleCancel.title} closeDisabled={busy} onClose={() => !busy && setCancel(null)}><div className="event-work-editor"><p>Future matching events will not launch this request. Existing runs and receipts stay in activity; cancelling does not stop an already running agent.</p><footer className="form-submit-row"><Button disabled={busy} onClick={() => setCancel(null)}>Keep trigger</Button><Button variant="danger" busy={busy} onClick={() => change(visibleCancel, 'cancelled')}>Cancel trigger</Button></footer></div></Dialog> : null}
  </section>;
}

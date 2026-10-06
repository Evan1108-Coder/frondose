import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { rumboActions } from '../data/useRumbo.js';
import { Button, Dialog, Empty, ErrorMessage, Field, PageHeader, Select, useApp } from '../ui.jsx';
import { Form } from '../components/Form.jsx';
import { ArrowDown, ArrowUp, Archive, Check, Clock, Pencil, Play, Plus, RotateCw, Workflow, X } from '../components/icons.jsx';
import { visible } from '../lib/model.js';
import './playbooks.css';

const ROOT = '/api/playbooks';
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const initialDefinition = () => ({ trigger: { type: 'manual' }, steps: [] });
const displayTime = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Never';
const triggerLabel = trigger => trigger?.type === 'event' ? 'When Inbox opens'
  : trigger?.type === 'schedule' ? `${trigger.days_of_week?.length === 7 || !trigger.days_of_week?.length ? 'Every day' : (trigger.days_of_week ?? []).map(day => weekdays[day]).join(', ')} at ${trigger.time ?? '12:00'} · ${trigger.timezone ?? 'local time'}`
    : 'Manual';

export function PlaybooksView() {
  const { workspace, data, notify, navigate } = useApp();
  const [catalog, setCatalog] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const [filter, setFilter] = useState('all');
  const selected = items.find(item => item.id === selectedId) ?? items[0] ?? null;

  const refresh = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true); setError(null);
    try {
      const [capabilities, list] = await Promise.all([
        apiRequest(`${ROOT}/catalog`),
        apiRequest(`${ROOT}?workspace_id=${encodeURIComponent(workspace.id)}`),
      ]);
      setCatalog(capabilities.result);
      setItems(Array.isArray(list.result) ? list.result : []);
    } catch (problem) { setError(problem); }
    finally { setLoading(false); }
  }, [workspace?.id]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!selected?.id) { setRuns([]); return; }
    const controller = new AbortController();
    apiRequest(`${ROOT}/${encodeURIComponent(selected.id)}/runs`, { signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setRuns(Array.isArray(response.result) ? response.result : []); })
      .catch(problem => { if (!controller.signal.aborted) setError(problem); });
    return () => controller.abort();
  }, [selected?.id]);

  const mutate = async (path, method, body, success) => {
    if (busy) return null;
    setBusy(true); setError(null);
    try {
      const response = await apiRequest(path, { method, body, timeoutMs: 30_000 });
      await refresh();
      await rumboActions.refresh().catch(() => {});
      if (success) notify(success);
      return response.result;
    } catch (problem) { setError(problem); return null; }
    finally { setBusy(false); }
  };
  const run = async item => {
    const result = await mutate(`${ROOT}/${encodeURIComponent(item.id)}/run`, 'POST', { idempotency_key: crypto.randomUUID() });
    if (result) {
      notify(result.status === 'completed' ? 'Playbook completed' : `Playbook stopped: ${result.error ?? 'Review the run history.'}`, result.status === 'completed' ? 'success' : 'error');
      setSelectedId(item.id);
      const response = await apiRequest(`${ROOT}/${encodeURIComponent(item.id)}/runs`).catch(() => null);
      if (response) setRuns(response.result ?? []);
    }
  };
  const save = async input => {
    const target = editing?.id ? `${ROOT}/${encodeURIComponent(editing.id)}` : ROOT;
    const result = await mutate(target, editing?.id ? 'PATCH' : 'POST', editing?.id ? { ...input, version: editing.version } : { ...input, workspace_id: workspace.id }, editing?.id ? 'Playbook updated' : 'Playbook created');
    if (result) { setEditing(null); setSelectedId(result.id); }
  };
  const toggle = item => mutate(`${ROOT}/${encodeURIComponent(item.id)}`, 'PATCH', { version: item.version, enabled: !item.enabled }, item.enabled ? 'Playbook paused' : 'Playbook enabled');
  const archive = async () => {
    const result = await mutate(`${ROOT}/${encodeURIComponent(archiving.id)}`, 'DELETE', { version: archiving.version }, 'Playbook archived');
    if (result) { setArchiving(null); if (selectedId === archiving.id) setSelectedId(null); }
  };
  const filtered = items.filter(item => filter === 'all' || Boolean(item.enabled) === (filter === 'enabled'));
  const actionById = useMemo(() => new Map((catalog?.actions ?? []).map(action => [action.id, action])), [catalog]);

  return <main className="page playbooks-page">
    <PageHeader title="Playbooks" description="Run repeatable actions manually, on a schedule, or when an event occurs.">
      <Button icon={RotateCw} onClick={refresh} disabled={loading}>Refresh</Button>
      <Button variant="primary" icon={Plus} onClick={() => setEditing({})} disabled={!catalog}>New playbook</Button>
    </PageHeader>
    <ErrorMessage error={error} />
    {catalog ? <details className="playbooks-action-catalog"><summary>Action library · {catalog.actions.length} working · {catalog.unavailable?.plugins?.length ?? 0} planned Plugin actions</summary><div><p>Only the working local actions can be added to a Playbook. Plugin actions remain disabled while Plugins are Coming soon; agent execution needs a separate reviewed run.</p><h2>Working local actions</h2><ul>{catalog.actions.map(action => <li key={action.id}><strong>{action.label}</strong><span>{action.description}</span></li>)}</ul><h2>Planned Plugin actions · unavailable</h2><ul>{(catalog.unavailable?.plugins ?? []).map(action => <li key={action.id}><strong>{action.label}</strong><span>{action.reason}</span></li>)}</ul><h2>Agent execution · unavailable</h2><p>{catalog.unavailable?.ai?.[0]?.reason}</p></div></details> : null}
    {loading ? <p role="status">Loading Playbooks…</p> : <div className="playbooks-layout">
      <section className="playbooks-list" aria-label="Saved Playbooks">
        <div className="playbooks-filters" role="group" aria-label="Filter Playbooks">
          {['all', 'enabled', 'disabled'].map(value => <button key={value} type="button" className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>
        {filtered.length ? filtered.map(item => <button key={item.id} type="button" className={`playbook-list-row ${selected?.id === item.id ? 'selected' : ''}`} aria-current={selected?.id === item.id ? 'true' : undefined} onClick={() => setSelectedId(item.id)}>
          <span className="playbook-list-icon"><Workflow /></span><span className="playbook-list-copy"><strong>{item.name}</strong><small>{triggerLabel(item.definition?.trigger)} · {item.definition?.steps?.length ?? 0} steps</small></span><span className={`playbook-list-state ${item.enabled ? 'enabled' : ''}`}>{item.enabled ? 'On' : 'Off'}</span>
        </button>) : <Empty compact kind="automation" title={filter === 'all' ? 'No Playbooks yet' : `No ${filter} Playbooks`} description={filter === 'all' ? 'Build a repeatable sequence from actions Rumbo can perform today.' : 'Change the filter to see other Playbooks.'} action={filter === 'all' ? 'New playbook' : 'Show all'} onAction={() => filter === 'all' ? setEditing({}) : setFilter('all')} />}
      </section>
      <section className="playbook-detail" aria-label="Selected Playbook">
        {selected ? <>
          <header className="playbook-detail-head"><div><h2>{selected.name}</h2><p>{triggerLabel(selected.definition?.trigger)} · {selected.definition?.steps?.length ?? 0} steps</p></div><div className="playbook-detail-actions"><Button icon={Play} variant="primary" onClick={() => run(selected)} disabled={busy || !selected.enabled}>Run</Button><Button icon={Pencil} onClick={() => setEditing(selected)}>Edit</Button><Button icon={Archive} onClick={() => setArchiving(selected)}>Archive</Button></div></header>
          {selected.description ? <p className="playbook-description">{selected.description}</p> : null}
          <label className="playbook-enabled"><input type="checkbox" checked={Boolean(selected.enabled)} disabled={busy} onChange={() => toggle(selected)} /><span>{selected.enabled ? 'Enabled' : 'Paused'}<small>{selected.definition?.trigger?.type === 'schedule' ? 'Scheduled actions run while the Rumbo server is running.' : selected.definition?.trigger?.type === 'event' ? 'Runs when the selected event is opened in this browser.' : 'Manual Playbooks run only when you press Run.'}</small></span></label>
          <div className="playbook-section-head"><h3>Steps</h3><Button icon={Pencil} onClick={() => setEditing(selected)}>Edit steps</Button></div>
          <ol className="playbook-steps">{(selected.definition?.steps ?? []).map((step, index) => <li key={`${step.action_id}-${index}`}><span className="playbook-step-number">{index + 1}</span><div><strong>{actionById.get(step.action_id)?.label ?? step.action_id}</strong><small>{Object.entries(step.config ?? {}).filter(([, value]) => value !== '').map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`).join(' · ') || 'No inputs'}</small></div></li>)}</ol>
          <div className="playbook-section-head"><h3>Recent runs</h3><span>{runs.length} recorded</span></div>
          {runs.length ? <div className="playbook-history">{runs.slice(0, 20).map(run => <details key={run.id}><summary><span className={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'failure' : ''}>{run.status === 'completed' ? <Check /> : run.status === 'failed' ? <X /> : <Clock />}{run.status}</span><time>{displayTime(run.created_at)}</time><small>{run.trigger_type ?? 'Manual'}</small></summary><ol>{(run.receipts ?? run.steps ?? []).map((receipt, index) => <li key={receipt.id ?? index}>{actionById.get(receipt.action_id)?.label ?? receipt.action_id} · {receipt.status}{receipt.result?.error ? ` · ${receipt.result.error}` : ''}</li>)}</ol></details>)}</div> : <p className="playbook-no-runs">No runs yet. Press Run to test this Playbook without starting an agent.</p>}
        </> : <Empty compact kind="automation" title="Choose a Playbook" description="Select one to review its trigger, steps, and run history." />}
      </section>
    </div>}
    {editing ? <PlaybookEditor key={editing.id ?? 'new'} item={editing.id ? editing : null} actions={catalog?.actions ?? []} projects={visible(data.projects)} routes={visible(data.tasks)} chats={visible(data.chats)} onClose={() => setEditing(null)} onSave={save} busy={busy} /> : null}
    {archiving ? <Dialog title={`Archive ${archiving.name}?`} onClose={() => !busy && setArchiving(null)}><div className="playbook-confirm"><p>This stops future scheduled and event runs. Existing run history is preserved.</p><div><Button onClick={() => setArchiving(null)} disabled={busy}>Cancel</Button><Button variant="danger" onClick={archive} busy={busy}>Archive Playbook</Button></div></div></Dialog> : null}
  </main>;
}

function PlaybookEditor({ item, actions, projects, routes, chats, onClose, onSave, busy }) {
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [definition, setDefinition] = useState(() => item?.definition ? structuredClone(item.definition) : initialDefinition());
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [error, setError] = useState(null);
  const defaultField = (key, label, page = 'New Playbook') => ({ 'data-field-default-key': key, 'data-field-default-page': page, 'data-field-default-label': label, 'data-field-default-mode': item ? 'edit' : 'create' });
  const updateTrigger = patch => setDefinition(current => ({ ...current, trigger: { ...current.trigger, ...patch } }));
  const updateStep = (index, patch) => setDefinition(current => ({ ...current, steps: current.steps.map((step, at) => at === index ? { ...step, ...patch } : step) }));
  const renderActionField = (field, action, step, index) => {
    const value = step.config?.[field.key] ?? '';
    const onChange = next => updateStep(index, { config: { ...step.config, [field.key]: next } });
    if (field.type === 'project' || field.type === 'choice' || field.type === 'id') {
      const references = field.type === 'project' ? projects : field.key === 'route_id' ? routes : chats;
      const options = field.type === 'choice' ? field.options.map(option => ({ value: option, label: option.replaceAll('_', ' ') })) : references.map(entry => ({ value: entry.id, label: entry.title ?? entry.name ?? entry.id }));
      return <Select key={field.key} label={field.label} required={field.required} value={value} onChange={onChange}><option value="">Choose {field.type === 'choice' ? 'a value' : field.type === 'project' ? 'a project' : field.key === 'route_id' ? 'a Route' : 'a conversation'}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>;
    }
    return <Field key={field.key} label={field.label}>{field.type === 'textarea' ? <textarea {...defaultField(`playbook.action.${step.action_id}.${field.key}`, field.label, `${action?.label ?? step.action_id} action`)} rows={3} required={field.required} value={value} onChange={event => onChange(event.target.value)} /> : <input {...defaultField(`playbook.action.${step.action_id}.${field.key}`, field.label, `${action?.label ?? step.action_id} action`)} type={field.type === 'date' ? 'date' : 'text'} required={field.required} value={value} onChange={event => onChange(event.target.value)} />}</Field>;
  };
  const submit = event => {
    event.preventDefault(); setError(null);
    if (!name.trim()) { setError(new Error('Give this Playbook a name.')); return; }
    if (!definition.steps.length) { setError(new Error('Add at least one action.')); return; }
    onSave({ name: name.trim(), description: description.trim(), definition, enabled });
  };
  return <Dialog wide title={item ? `Edit ${item.name}` : 'New Playbook'} subtitle="Choose a trigger, then arrange supported actions in order." onClose={() => !busy && onClose()}><Form className="playbook-editor" onSubmit={submit}>
    <Field label="Name"><input {...defaultField('playbook.new.name', 'Name')} required maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="Daily review" /></Field>
    <Field label="Description"><textarea {...defaultField('playbook.new.description', 'Description')} rows={2} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} placeholder="What this Playbook accomplishes" /></Field>
    <div className="playbook-editor-heading"><h3>Trigger</h3><p>Manual, scheduled, or when you open Inbox.</p></div>
    <Select label="Start this Playbook" value={definition.trigger.type} onChange={type => setDefinition(current => ({ ...current, trigger: type === 'schedule' ? { type, time: '12:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', days_of_week: [0, 1, 2, 3, 4, 5, 6] } : type === 'event' ? { type, event: 'inbox.opened' } : { type } }))}><option value="manual">Only when I press Run</option><option value="event">When Inbox opens</option><option value="schedule">On a schedule</option></Select>
    {definition.trigger.type === 'schedule' ? <><div className="playbook-trigger-fields"><Field label="Time"><input type="time" required value={definition.trigger.time ?? '12:00'} onChange={event => updateTrigger({ time: event.target.value })} /></Field><Field label="Time zone"><input required value={definition.trigger.timezone ?? 'UTC'} onChange={event => updateTrigger({ timezone: event.target.value })} placeholder="Asia/Hong_Kong" /></Field></div><fieldset className="playbook-weekdays"><legend>Days</legend>{weekdays.map((day, index) => <label key={day}><input type="checkbox" checked={(definition.trigger.days_of_week ?? []).includes(index)} onChange={event => updateTrigger({ days_of_week: event.target.checked ? [...(definition.trigger.days_of_week ?? []), index].sort() : (definition.trigger.days_of_week ?? []).filter(value => value !== index) })} />{day}</label>)}</fieldset><p className="playbook-form-note">Scheduled runs happen while the local Rumbo server is running. Missed times are not a guarantee of background cloud delivery.</p></> : null}
    <div className="playbook-editor-heading"><h3>Actions</h3><p>Only actions Rumbo can currently execute appear here.</p></div>
    <ol className="playbook-editor-steps">{definition.steps.map((step, index) => {
      const action = actions.find(entry => entry.id === step.action_id);
      return <li key={index}><div className="playbook-editor-step-head"><strong>{index + 1}. {action?.label ?? step.action_id}</strong><div><button type="button" aria-label={`Move action ${index + 1} up`} disabled={index === 0} onClick={() => setDefinition(current => { const steps = [...current.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; return { ...current, steps }; })}><ArrowUp /></button><button type="button" aria-label={`Move action ${index + 1} down`} disabled={index === definition.steps.length - 1} onClick={() => setDefinition(current => { const steps = [...current.steps]; [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]]; return { ...current, steps }; })}><ArrowDown /></button><button type="button" aria-label={`Remove action ${index + 1}`} onClick={() => setDefinition(current => ({ ...current, steps: current.steps.filter((_, at) => at !== index) }))}><X /></button></div></div><Select label="Action" value={step.action_id} onChange={action_id => updateStep(index, { action_id, config: {} })}>{actions.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</Select><p>{action?.description}</p>{(action?.config_fields ?? []).map(field => renderActionField(field, action, step, index))}</li>;
    })}</ol>
    <Select label="Add an action" value="" onChange={action_id => { if (action_id) setDefinition(current => ({ ...current, steps: [...current.steps, { action_id, config: {} }] })); }}><option value="">Choose an action…</option>{actions.map(action => <option key={action.id} value={action.id}>{action.label}</option>)}</Select>
    {!actions.length ? <p className="playbook-form-note">No actions are available. Check the Rumbo server connection.</p> : null}
    <label className="playbook-enabled"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span>Enabled<small>Turn this off to pause event and scheduled runs without deleting the Playbook.</small></span></label>
    <ErrorMessage error={error} /><footer className="form-submit-row"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save Playbook</Button></footer>
  </Form></Dialog>;
}

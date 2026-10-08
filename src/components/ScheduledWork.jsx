import { useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { refreshRumbo } from '../data/useRumbo.js';
import { Button, Dialog, ErrorMessage, Field, Select, useApp } from '../ui.jsx';
import { Clock } from './icons.jsx';
import { DateField } from './DateField.jsx';
import { localScheduleTime, validTimezone } from '../lib/scheduled-time.js';
import './scheduled-work.css';

const defaultZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC';
export function ScheduleTimeFields({ time, setTime, timezone, setTimezone, disabled = false }) {
  return <div className="schedule-time-fields"><Field label="Date"><DateField disabled={disabled} required value={time.split('T')[0] || ''} onChange={date => setTime(`${date}T${time.split('T')[1] || '12:00'}`)} /></Field><Field label="Time"><input disabled={disabled} required pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" value={time.split('T')[1] || ''} onChange={event => setTime(`${time.split('T')[0] || ''}T${event.target.value}`)} placeholder="HH:mm" maxLength={5} /></Field><Field label="Time zone"><input disabled={disabled} required value={timezone} onChange={event => setTimezone(event.target.value)} placeholder="Asia/Shanghai" /></Field></div>;
}

export function ScheduleWorkDialog({ workspaceId, kind, payload, contextInspectionId, title, onClose, onScheduled }) {
  const { notify } = useApp();
  const [timezone, setTimezone] = useState(defaultZone);
  const [time, setTime] = useState(() => localScheduleTime(Date.now() + 30 * 60000, defaultZone()));
  const [recurrence, setRecurrence] = useState('none'), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const request = useRef(crypto.randomUUID());
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (!validTimezone(timezone)) throw new Error('Choose a recognized time zone, such as Asia/Shanghai.');
      const response = await apiRequest('/api/scheduled-work', { method: 'POST', body: { workspace_id: workspaceId, kind, title, payload, local_time: time, timezone, recurrence, request_id: request.current, ...(contextInspectionId ? { context_inspection_id: contextInspectionId } : {}) } });
      await refreshRumbo(); notify(kind === 'message' ? 'Message scheduled' : 'Action scheduled');
      onScheduled?.(response.result); onClose();
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  return <Dialog title={kind === 'message' ? 'Schedule message' : 'Schedule approved action'} closeDisabled={busy} onClose={() => !busy && onClose()}><form className="schedule-dialog-body" onSubmit={save}>
    <div className="scheduled-content-preview">{kind === 'message' ? <><strong>{payload.agent_id && payload.agent_id !== 'note' ? 'Message to agent' : 'Conversation note'}</strong><p>{payload.content}</p></> : <><strong>{title || 'Reviewed agent action'}</strong><p>The proposed change will run once at the selected time.</p></>}</div>
    <ScheduleTimeFields disabled={busy} time={time} setTime={setTime} timezone={timezone} setTimezone={setTimezone} />
    {kind === 'message' ? <Field label="Repeat"><Select disabled={busy} value={recurrence} onChange={setRecurrence}><option value="none">Do not repeat</option><option value="daily">Every day at this time</option><option value="weekly">Every week on this day</option></Select></Field> : null}
    <p className="schedule-context-note">{contextInspectionId ? 'This message saves the context you reviewed. Later conversation or workspace changes will not be included.' : kind === 'action' ? 'Rumbo checks the target and your access again when the action runs. A changed target needs a fresh review.' : 'This saves a note in the selected conversation without contacting an AI.'} Rumbo’s server must be running at the scheduled time.</p>
    <ErrorMessage error={error} /><footer className="form-submit-row"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" icon={Clock} busy={busy}>{kind === 'action' ? 'Approve and schedule' : 'Schedule message'}</Button></footer>
  </form></Dialog>;
}

export function RescheduleWorkDialog({ item, onClose, onSaved }) {
  const [timezone, setTimezone] = useState(item.timezone), [time, setTime] = useState(() => localScheduleTime(Math.max(Date.parse(item.next_due_at || 0), Date.now() + 30 * 60000), item.timezone));
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try { const response = await apiRequest(`/api/scheduled-work/${item.id}`, { method: 'PATCH', body: { version: item.version, state: 'active', local_time: time, timezone } }); onSaved(response.result); onClose(); }
    catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  return <Dialog title="Change scheduled time" subtitle={item.title} closeDisabled={busy} onClose={() => !busy && onClose()}><form className="schedule-dialog-body" onSubmit={save}>
    <ScheduleTimeFields disabled={busy} time={time} setTime={setTime} timezone={timezone} setTimezone={setTimezone} />
    <ErrorMessage error={error} /><footer className="form-submit-row"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save time</Button></footer>
  </form></Dialog>;
}

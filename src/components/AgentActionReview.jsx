import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { refreshTalvori } from '../data/useTalvori.js';
import { Button, Dialog, ErrorMessage, useApp } from '../ui.jsx';
import { ServiceLogo } from './ServiceLogo.jsx';
import { ScheduleWorkDialog } from './ScheduledWork.jsx';
import { prepareScheduleProposal } from '../lib/schedule-proposal.js';

const resourceName = resource => ({ teams: 'Area', tasks: 'Route', projects: 'Project', documents: 'Document', milestones: 'Milestone', chats: 'Conversation' }[resource] || 'workspace item');
const actionTitle = proposal => ({ 'agent.self_link': `Link agent to ${resourceName(proposal.resource)}`, 'schedule.create': 'Schedule a message', 'schedule.update': proposal.state === 'cancelled' ? 'Cancel a schedule' : proposal.state === 'paused' ? 'Pause a schedule' : proposal.run_at ? 'Reschedule work' : 'Resume a schedule', 'memory.create': 'Save agent memory', 'settings.update': 'Update preferences', 'chat.note': 'Add a conversation note', 'record.create': `Create ${resourceName(proposal.resource)}`, 'record.update': `Update ${resourceName(proposal.resource)}`, 'record.archive': `Archive ${resourceName(proposal.resource)}`, 'connection.action': 'Run Plugin action' }[proposal.type] || 'Review action');
const statusText = status => ({ pending: 'Waiting for your review', scheduled: 'Scheduled for later', applied: 'Applied', rejected: 'Rejected', awaiting_approval: 'Waiting for Owner approval', executing: 'Action in progress', uncertain: 'Result unconfirmed · inspect activity before retrying' }[status] || status);
const canDecide = action => ['pending', 'awaiting_approval'].includes(action.status);
const label = key => ({ due_at: 'Due date', target_date: 'Target date', start_date: 'Start date', project_id: 'Project', team_id: 'Area', task_id: 'Route', parent_task_id: 'Parent Route', pinned: 'Pin conversation', reduceMotion: 'Reduce motion', textSize: 'Text size', sendKey: 'Send shortcut', weekStart: 'First day of week' }[key] || key.replaceAll('_', ' ').replace(/^./, value => value.toUpperCase()));
const display = value => value == null || value === '' ? 'None' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
function ActionFields({ action }) {
  const { data } = useApp();
  const show = (key, value) => {
    const collections = { project_id: ['projects', 'name'], team_id: ['teams', 'name'], task_id: ['tasks', 'title'], parent_task_id: ['tasks', 'title'] };
    if (value && collections[key]) { const [collection, title] = collections[key]; return data[collection]?.find(item => item.id === value)?.[title] || `Unavailable ${label(key)}`; }
    return display(value);
  };
  const proposal = action.proposal, fields = proposal.fields || proposal.patch || proposal.input || (proposal.type === 'schedule.create' ? { content: proposal.content, run_at: proposal.run_at, timezone: proposal.timezone, recurrence: proposal.recurrence || 'none', model: proposal.model, chat_id: proposal.chat_id } : proposal.type === 'chat.note' ? { content: proposal.content } : proposal.type === 'memory.create' ? { title: proposal.title, content: proposal.content } : {});
  if (proposal.type === 'schedule.update') {
    const previous = action.before?.schedule;
    return <><p className="agent-action-target">{previous?.title || 'Scheduled work'}</p><dl className="agent-action-fields agent-action-schedule-fields"><div><dt>State</dt><dd>{previous?.state} → {proposal.state}</dd></div><div><dt>Next occurrence</dt><dd>{proposal.run_at || previous?.next_due_at || 'None'}</dd></div><div><dt>Time zone</dt><dd>{proposal.timezone || previous?.timezone}</dd></div><div><dt>Repeat</dt><dd>{previous?.recurrence || 'none'}</dd></div></dl><p>{proposal.state === 'cancelled' ? 'Future occurrences will stop permanently. Existing messages, runs and receipts remain.' : proposal.state === 'paused' ? 'Future occurrences will pause. This does not stop an occurrence already running.' : 'Future occurrences will use this timing. The saved prompt, model, recipient and context do not change; normal permission and provider checks still apply.'}</p><p>Schedule ID: <code>{proposal.schedule_id}</code> · Version {proposal.version}</p></>;
  }
  if (proposal.type === 'agent.self_link') {
    const target = data[proposal.resource]?.find(item => item.id === proposal.id);
    const agentId = data.runs?.find(item => item.id === action.run_id)?.agent_id;
    const agent = data.agents?.find(item => item.id === agentId);
    return <><p className="agent-action-target">{target?.name || target?.title || action.before?.name || action.before?.title || resourceName(proposal.resource)}</p><p>Add {agent?.name || 'the agent from this run'} to this {resourceName(proposal.resource)}. This does not change its default project or grant new permissions.</p><p>Target ID: <code>{proposal.id}</code></p></>;
  }
  return <><p className="agent-action-target">{action.before?.title || action.before?.name || action.before?.chat?.title || proposal.fields?.title || proposal.fields?.name || resourceName(proposal.resource)}</p>{Object.keys(fields).length ? <dl className="agent-action-fields">{Object.entries(fields).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{proposal.type === 'record.update' && action.before ? <><span className="agent-action-previous">{show(key, action.before[key])}</span><span aria-hidden="true"> → </span></> : null}<span>{show(key, value)}</span></dd></div>)}</dl> : <p>Archive this item. You can restore it from the archive.</p>}</>;
}

export function AgentActionReview({ run }) {
  const { navigate } = useApp();
  const [actions, setActions] = useState([]), [selected, setSelected] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const [scheduled, setScheduled] = useState(null);
  const [messageSchedule, setMessageSchedule] = useState(null);
  const currentRun = useRef(run.id), mounted = useRef(true);
  currentRun.current = run.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const hasPending = useRef(false);
  hasPending.current = actions.some(action => ['pending', 'scheduled', 'awaiting_approval', 'executing'].includes(action.status));
  useEffect(() => {
    if (run.status !== 'completed') return;
    setActions([]);
    const controller = new AbortController();
    const refresh = () => apiRequest(`/api/agent-actions?run_id=${encodeURIComponent(run.id)}`, { signal: controller.signal }).then(result => { const rows = result.result.actions; setActions(rows); setSelected(current => current ? rows.find(action => action.id === current.id) || null : null); }).catch(cause => { if (!controller.signal.aborted) { setError(cause); if ([401, 403, 404].includes(cause.status)) { setActions([]); setSelected(null); } } });
    refresh();
    const timer = setInterval(() => { if (hasPending.current && !document.hidden) refresh(); }, 20000);
    const focus = () => { if (hasPending.current) refresh(); };
    window.addEventListener('focus', focus);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [run.id, run.status]);
  async function decide(decision) {
    setBusy(true); setError(null);
    try {
      const result = await apiRequest(`/api/agent-actions/${selected.id}/decision`, { method: 'POST', body: { decision }, timeoutMs: 60000 });
      setActions(items => items.map(item => item.id === selected.id ? { ...item, status: result.result.status || (result.result.approval_required ? 'awaiting_approval' : item.status), result: result.result.result } : item));
      setSelected(null); await refreshTalvori();
    } catch (cause) {
      setError(cause);
      try { const refreshed = await apiRequest(`/api/agent-actions?run_id=${encodeURIComponent(run.id)}`); setActions(refreshed.result.actions); setSelected(items => refreshed.result.actions.find(action => action.id === items?.id) || items); } catch { /* Keep the original failure visible when status refresh also fails. */ }
    } finally { setBusy(false); }
  }
  async function reviewSchedule() {
    if (busy || !selected || selected.proposal.type !== 'schedule.create') return;
    setBusy(true); setError(null);
    try {
      const review = await prepareScheduleProposal({ proposalId: selected.id, workspaceId: run.workspace_id, agentId: run.agent_id,
        prepare: async (id, workspaceId) => (await apiRequest(`/api/agent-actions/${encodeURIComponent(id)}/prepare-schedule`, { method: 'POST', body: { workspace_id: workspaceId } })).result,
        inspect: async request => (await apiRequest('/api/context/inspect', { method: 'POST', body: request })).result,
        isCurrent: () => mounted.current && currentRun.current === run.id,
      });
      setMessageSchedule(review); setSelected(null);
    } catch (cause) { if (mounted.current) setError(cause); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <>{!selected ? <ErrorMessage error={error} /> : null}{actions.map(action => <div className="rumbo-action-card" key={action.id}>{action.before?.provider ? <ServiceLogo name={action.before.provider} /> : null}<span><strong>{actionTitle(action.proposal)}</strong><small>{statusText(action.status)}</small></span><Button onClick={() => { if (action.status === 'scheduled') navigate('settings', 'scheduled-work'); else { setSelected(action); setError(null); } }}>{action.status === 'scheduled' ? 'View schedule' : canDecide(action) ? 'Review' : 'Details'}</Button></div>)}
    {selected ? <Dialog title={actionTitle(selected.proposal)} subtitle={statusText(selected.status)} onClose={() => !busy && setSelected(null)}><div className="chat-context-content"><ErrorMessage error={error} /><ActionFields action={selected} />{selected.proposal.type === 'schedule.create' ? <p>This is a proposed future message, not a saved schedule. Review its fresh context and confirm the schedule before anything can run.</p> : null}{selected.proposal.type === 'memory.create' ? <p>This memory is saved for this agent in the current workspace and linked project.</p> : selected.proposal.type === 'settings.update' ? <p>These preferences apply across your workspaces.</p> : null}{selected.result?.id ? <p>Saved result: <code>{selected.result.id}</code></p> : null}<details><summary>Action details</summary><pre className="agent-action-json">{JSON.stringify(selected.proposal, null, 2)}</pre></details></div><footer className="dialog-footer">{canDecide(selected) ? <><Button disabled={busy} onClick={() => decide('reject')}>Reject</Button>{selected.status === 'pending' && selected.proposal.type !== 'connection.action' && selected.proposal.type !== 'schedule.create' && selected.proposal.type !== 'schedule.update' ? <Button disabled={busy} onClick={() => { setScheduled(selected); setSelected(null); }}>Schedule</Button> : null}{selected.proposal.type === 'schedule.create' ? <Button variant="primary" busy={busy} onClick={reviewSchedule}>Review schedule</Button> : <Button variant="primary" busy={busy} onClick={() => decide('approve')}>{selected.status === 'awaiting_approval' ? 'Check approval and continue' : selected.proposal.type === 'schedule.update' ? 'Confirm schedule change' : 'Approve change'}</Button>}</> : <Button onClick={() => setSelected(null)}>Done</Button>}</footer></Dialog> : null}
    {messageSchedule ? <ScheduleWorkDialog workspaceId={run.workspace_id} kind="message" payload={messageSchedule.payload} contextInspectionId={messageSchedule.inspection.id} contextInspection={messageSchedule.inspection} initialRunAt={messageSchedule.proposed.run_at} initialTimezone={messageSchedule.proposed.timezone} initialRecurrence={messageSchedule.proposed.recurrence || 'none'} onClose={() => setMessageSchedule(null)} onScheduled={item => setActions(current => current.map(action => action.id === messageSchedule.proposed.action_request_id ? { ...action, status: 'scheduled', result: { schedule_id: item.id } } : action))} /> : null}
    {scheduled ? <ScheduleWorkDialog workspaceId={run.workspace_id} kind="action" title={actionTitle(scheduled.proposal)} payload={{ action_request_id: scheduled.id }} onClose={() => setScheduled(null)} onScheduled={item => setActions(current => current.map(action => action.id === scheduled.id ? { ...action, status: 'scheduled', result: { schedule_id: item.id } } : action))} /> : null}</>;
}

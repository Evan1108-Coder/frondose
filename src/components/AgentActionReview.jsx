import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { refreshRumbo } from '../data/useRumbo.js';
import { Button, Dialog, ErrorMessage, useApp } from '../ui.jsx';
import { ServiceLogo } from './ServiceLogo.jsx';
import { ScheduleWorkDialog } from './ScheduledWork.jsx';

const resourceName = resource => ({ tasks: 'Route', projects: 'Project', documents: 'Document', milestones: 'Milestone', chats: 'Conversation' }[resource] || 'workspace item');
const actionTitle = proposal => ({ 'memory.create': 'Save agent memory', 'settings.update': 'Update preferences', 'chat.note': 'Add a conversation note', 'record.create': `Create ${resourceName(proposal.resource)}`, 'record.update': `Update ${resourceName(proposal.resource)}`, 'record.archive': `Archive ${resourceName(proposal.resource)}`, 'connection.action': 'Run Plugin action' }[proposal.type] || 'Review action');
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
  const proposal = action.proposal, fields = proposal.fields || proposal.patch || proposal.input || (proposal.type === 'chat.note' ? { content: proposal.content } : proposal.type === 'memory.create' ? { title: proposal.title, content: proposal.content } : {});
  return <><p className="agent-action-target">{action.before?.title || action.before?.name || action.before?.chat?.title || proposal.fields?.title || proposal.fields?.name || resourceName(proposal.resource)}</p>{Object.keys(fields).length ? <dl className="agent-action-fields">{Object.entries(fields).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{proposal.type === 'record.update' && action.before ? <><span className="agent-action-previous">{show(key, action.before[key])}</span><span aria-hidden="true"> → </span></> : null}<span>{show(key, value)}</span></dd></div>)}</dl> : <p>Archive this item. You can restore it from the archive.</p>}</>;
}

export function AgentActionReview({ run }) {
  const { navigate } = useApp();
  const [actions, setActions] = useState([]), [selected, setSelected] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const [scheduled, setScheduled] = useState(null);
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
      setSelected(null); await refreshRumbo();
    } catch (cause) {
      setError(cause);
      try { const refreshed = await apiRequest(`/api/agent-actions?run_id=${encodeURIComponent(run.id)}`); setActions(refreshed.result.actions); setSelected(items => refreshed.result.actions.find(action => action.id === items?.id) || items); } catch { /* Keep the original failure visible when status refresh also fails. */ }
    } finally { setBusy(false); }
  }
  return <>{!selected ? <ErrorMessage error={error} /> : null}{actions.map(action => <div className="rumbo-action-card" key={action.id}>{action.before?.provider ? <ServiceLogo name={action.before.provider} /> : null}<span><strong>{actionTitle(action.proposal)}</strong><small>{statusText(action.status)}</small></span><Button onClick={() => { if (action.status === 'scheduled') navigate('settings', 'scheduled-work'); else { setSelected(action); setError(null); } }}>{action.status === 'scheduled' ? 'View schedule' : canDecide(action) ? 'Review' : 'Details'}</Button></div>)}
    {selected ? <Dialog title={actionTitle(selected.proposal)} subtitle={statusText(selected.status)} onClose={() => !busy && setSelected(null)}><div className="chat-context-content"><ErrorMessage error={error} /><ActionFields action={selected} />{selected.proposal.type === 'memory.create' ? <p>This memory is saved for this agent in the current workspace and linked project.</p> : selected.proposal.type === 'settings.update' ? <p>These preferences apply across your workspaces.</p> : null}{selected.result?.id ? <p>Saved result: <code>{selected.result.id}</code></p> : null}<details><summary>Action details</summary><pre className="agent-action-json">{JSON.stringify(selected.proposal, null, 2)}</pre></details></div><footer className="dialog-footer">{canDecide(selected) ? <><Button disabled={busy} onClick={() => decide('reject')}>Reject</Button>{selected.status === 'pending' && selected.proposal.type !== 'connection.action' ? <Button disabled={busy} onClick={() => { setScheduled(selected); setSelected(null); }}>Schedule</Button> : null}<Button variant="primary" busy={busy} onClick={() => decide('approve')}>{selected.status === 'awaiting_approval' ? 'Check approval and continue' : 'Approve change'}</Button></> : <Button onClick={() => setSelected(null)}>Done</Button>}</footer></Dialog> : null}
    {scheduled ? <ScheduleWorkDialog workspaceId={run.workspace_id} kind="action" title={actionTitle(scheduled.proposal)} payload={{ action_request_id: scheduled.id }} onClose={() => setScheduled(null)} onScheduled={item => setActions(current => current.map(action => action.id === scheduled.id ? { ...action, status: 'scheduled', result: { schedule_id: item.id } } : action))} /> : null}</>;
}

import { useMemo, useRef, useState } from 'react';
import { Button, ErrorMessage, SearchField, Select, useApp } from '../ui.jsx';
import { frondoseActions } from '../data/useFrondose.js';
import { assistantActivity, assistantRunStatus, STOPPABLE_ASSISTANT_RUNS } from '../lib/assistant-activity.js';
import { relative } from '../lib/model.js';
import { ServiceLogo } from './ServiceLogo.jsx';
import { RotateCw } from './icons.jsx';
import './assistant-activity.css';

export function AssistantActivity() {
  const { workspace, data, navigate, notify } = useApp();
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(null), [error, setError] = useState(null), [limit, setLimit] = useState(50);
  const currentWorkspace = useRef(workspace.id);
  currentWorkspace.current = workspace.id;
  const rows = useMemo(() => assistantActivity(data, workspace.id, { query, filter }), [data.runs, data.chats, data.agents, data.outputs, data.approvals, workspace.id, query, filter]);
  async function stop(run) {
    if (busy || !STOPPABLE_ASSISTANT_RUNS.has(run.status)) return;
    const workspaceId = workspace.id;
    setBusy(run.id); setError(null);
    try {
      await frondoseActions.stopRun(run.id);
      if (currentWorkspace.current === workspaceId) notify('Run stopped. Future schedules are unchanged.');
    } catch (cause) { if (currentWorkspace.current === workspaceId) setError(cause); }
    finally { if (currentWorkspace.current === workspaceId) setBusy(null); }
  }
  async function refresh() {
    if (busy) return;
    const workspaceId = workspace.id;
    setBusy('refresh'); setError(null);
    try { await frondoseActions.refresh(); }
    catch (cause) { if (currentWorkspace.current === workspaceId) setError(cause); }
    finally { if (currentWorkspace.current === workspaceId) setBusy(null); }
  }
  return <section className="assistant-activity" aria-label="Agent activity">
    <header className="assistant-activity-heading"><div><h1>Activity</h1><p>Recorded agent runs in this workspace. A completed run still needs its results reviewed.</p></div><Button icon={RotateCw} disabled={Boolean(busy)} onClick={refresh}>Refresh</Button></header>
    <div className="assistant-activity-filters"><SearchField label="Search agent activity" placeholder="Search runs, agents or conversations…" value={query} onChange={value => { setQuery(value); setLimit(50); }} /><Select label="Activity status" value={filter} onChange={value => { setFilter(value); setLimit(50); }}><option value="all">All activity</option><option value="working">Working</option><option value="needs-you">Needs you</option><option value="completed">Completed runs</option></Select></div>
    <ErrorMessage error={error} />
    {!rows.length ? <div className="assistant-activity-empty"><h2>{query || filter !== 'all' ? 'No matching runs' : 'No agent work yet'}</h2><p>{query || filter !== 'all' ? 'Change the search or status filter to see other activity.' : 'Send a request in a conversation to start work. Prepared drafts and saved schedules are not running tasks.'}</p><Button onClick={() => navigate('rumbo-agent')}>Open conversation</Button></div> : <ol className="assistant-activity-list">{rows.slice(0, limit).map(({ run, agent, chat, outputs, working, needsYou, approvalNeeded }) => <li key={run.id} className="assistant-activity-row">
      <ServiceLogo name={run.provider} />
      <div className="assistant-activity-content"><button type="button" className="assistant-activity-title" onClick={() => navigate('work', run.id)}>{run.title || 'Untitled run'}</button><p>{agent?.name || run.agent_name || 'Agent'}{run.mode !== 'live' ? ' · Simulation' : ''}{chat ? ` · ${chat.title}` : ''}</p><time dateTime={run.updated_at || run.created_at}>{relative(run.updated_at || run.created_at)}</time>{outputs.length ? <div className="assistant-activity-outputs">{outputs.map(output => <button type="button" key={output.id} onClick={() => navigate('library', output.id)}>Review {output.title}</button>)}</div> : null}</div>
      <div className="assistant-activity-state"><span className={working ? 'is-working' : needsYou ? 'needs-you' : ''}>{approvalNeeded ? 'Approval needed' : assistantRunStatus(run)}</span><div><Button variant="ghost" onClick={() => navigate('work', run.id)}>Open run</Button>{chat ? <Button variant="ghost" onClick={() => navigate(chat.kind === 'rumbo-agent' ? 'rumbo-agent' : 'chats', chat.id)}>{run.status === 'completed' ? 'Review conversation' : 'Conversation'}</Button> : null}{STOPPABLE_ASSISTANT_RUNS.has(run.status) ? <Button disabled={Boolean(busy)} onClick={() => stop(run)}>Stop run</Button> : null}</div></div>
    </li>)}</ol>}
    {rows.length > limit ? <Button onClick={() => setLimit(value => value + 50)}>Show more · {rows.length - limit} remaining</Button> : null}
    <p className="assistant-activity-boundary">Needs you shows blocked, failed or approval-gated runs. Review completed conversations for proposed actions. Stopping a run does not undo its changes or cancel future schedules.</p>
  </section>;
}

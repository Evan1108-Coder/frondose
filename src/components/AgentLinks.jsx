import { useEffect, useState } from 'react';
import { Button, Dialog, ErrorMessage, Select, useApp } from '../ui.jsx';
import { apiRequest } from '../data/api.js';
import { talvoriActions } from '../data/useTalvori.js';
import { AgentIdentity } from './AgentIdentity.jsx';
import { Plus } from './icons.jsx';
import './agent-links.css';

/** Membership is organization only, never a folder/context/permission grant. */
export function AgentLinks({ targetType, targetId, existingAgentIds = [] }) {
  const { workspace, data, navigate } = useApp();
  const [links, setLinks] = useState([]), [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(''), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLinks([]); setError(null);
    apiRequest(`/api/agent-links?workspace_id=${encodeURIComponent(workspace.id)}`, { signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setLinks((response.result?.links || response.links || []).filter(link => link.target_type === targetType && link.target_id === targetId)); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [workspace.id, targetType, targetId, data.meta?.lastEventAt]);
  const ids = new Set([...existingAgentIds, ...links.map(link => link.agent_id)]);
  const members = data.agents.filter(agent => ids.has(agent.id) && !agent.archived_at);
  const available = data.agents.filter(agent => agent.workspace_id === workspace.id && !agent.archived_at && !ids.has(agent.id));
  async function add() {
    if (!selected || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await apiRequest('/api/agent-links', { method: 'POST', body: { workspace_id: workspace.id, agent_id: selected, target_type: targetType, target_id: targetId } });
      const link = response.result;
      setLinks(current => [...current.filter(item => item.agent_id !== link.agent_id), link]);
      setAdding(false); setSelected('');
      await talvoriActions.refresh();
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  return <section className="agent-links" aria-label="Linked AI agents">
    <header><h3>AI agents</h3><Button icon={Plus} onClick={() => { setSelected(''); setAdding(true); }} disabled={!available.length}>Add agent</Button></header>
    <ErrorMessage error={!adding ? error : null} />
    {members.length ? <div className="agent-links-list">{members.map(agent => <button type="button" key={agent.id} onClick={() => navigate('agents', agent.id)}><AgentIdentity agent={agent} compact /><span>{agent.name}</span></button>)}</div> : <p>No agents linked yet.</p>}
    {!available.length ? <p className="agent-links-hint">{members.some(agent => agent.workspace_id === workspace.id) ? 'All available workspace profiles are linked. Create another profile in Agent Studio to add more.' : 'Create a workspace profile in Agent Studio to add an agent here. Shared provider profiles are not silently copied.'}</p> : null}
    {adding ? <Dialog title="Add an AI agent" onClose={() => !busy && setAdding(false)}><div className="dialog-body agent-links-dialog"><p>Link a workspace profile to this {targetType === 'route' ? 'Route' : targetType === 'area' ? 'Area' : 'project'}. This does not start a run or grant new access.</p><Select label="Agent profile" value={selected} onChange={setSelected}><option value="">Choose an agent</option>{available.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</Select><ErrorMessage error={error} /></div><footer className="dialog-footer"><Button disabled={busy} onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" busy={busy} disabled={!selected} onClick={add}>Add agent</Button></footer></Dialog> : null}
  </section>;
}

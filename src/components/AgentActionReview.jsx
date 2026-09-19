import { useEffect, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { refreshRumbo } from '../data/useRumbo.js';
import { Button, Dialog, ErrorMessage } from '../ui.jsx';

export function AgentActionReview({ run }) {
  const [actions, setActions] = useState([]), [selected, setSelected] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (run.status !== 'completed') return;
    const controller = new AbortController();
    apiRequest(`/api/agent-actions?run_id=${encodeURIComponent(run.id)}`, { signal: controller.signal }).then(result => setActions(result.result.actions)).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [run.id, run.status]);
  async function decide(decision) {
    setBusy(true); setError(null);
    try {
      const result = await apiRequest(`/api/agent-actions/${selected.id}/decision`, { method: 'POST', body: { decision } });
      setActions(items => items.map(item => item.id === selected.id ? { ...item, status: result.result.status } : item));
      setSelected(null); await refreshRumbo();
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  return <>{!selected ? <ErrorMessage error={error} /> : null}{actions.map(action => <div className="rumbo-action-card" key={action.id}><span><strong>{action.proposal.type === 'memory.create' ? 'Save agent memory' : action.proposal.type === 'settings.update' ? 'Update preferences' : action.proposal.type === 'record.archive' ? 'Archive workspace item' : 'Update workspace item'}</strong><small>{action.status === 'pending' ? 'Waiting for your approval · nothing changed' : action.status}</small></span><Button onClick={() => { setSelected(action); setError(null); }}>Review</Button></div>)}
    {selected ? <Dialog title="Review Rumbo action" subtitle="The agent cannot approve its own request." onClose={() => !busy && setSelected(null)}><div className="chat-context-content"><ErrorMessage error={error} /><p>{selected.proposal.type === 'memory.create' ? 'This memory will be available to this agent in this workspace and, if linked, this project. You can forget it in Chat context.' : selected.proposal.type === 'settings.update' ? 'These preferences affect your interface across all workspaces.' : selected.proposal.type === 'record.archive' ? 'This hides the exact workspace item shown below. It can be restored from the archive. Review its name and ID before approving.' : 'This replaces the specified fields on the exact workspace item shown below. Review the current values and proposed content before approving.'}</p><h3>Proposed change</h3><pre className="agent-action-json">{JSON.stringify(selected.proposal, null, 2)}</pre>{selected.before ? <><h3>Current values at proposal time</h3><pre className="agent-action-json">{JSON.stringify(selected.before, null, 2)}</pre></> : null}</div><footer className="dialog-footer">{selected.status === 'pending' ? <><Button disabled={busy} onClick={() => decide('reject')}>Reject</Button><Button variant="primary" busy={busy} onClick={() => decide('approve')}>Approve change</Button></> : <Button onClick={() => setSelected(null)}>Done</Button>}</footer></Dialog> : null}</>;
}

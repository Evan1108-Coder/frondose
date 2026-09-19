import { useEffect, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, Dialog, ErrorMessage } from '../ui.jsx';

export function AgentMemoryPanel({ workspaceId, agentId, projectId }) {
  const [memories, setMemories] = useState([]), [error, setError] = useState(null), [forget, setForget] = useState(null), [busy, setBusy] = useState(false), [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setMemories([]); setSnapshot(null); setError(null);
    if (agentId) apiRequest(`/api/agent-memories?${new URLSearchParams({ workspace_id: workspaceId, agent_id: agentId, project_id: projectId || '' })}`, { signal: controller.signal }).then(result => setMemories(result.result.memories)).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [workspaceId, agentId, projectId]);
  return <section><h3>Workspace awareness & agent memory</h3><p>Replies receive a fresh, bounded workspace overview: recent projects, routes, teams, document titles and interface preferences. Credentials and document contents are excluded. All proposed Rumbo changes require your review.</p><Button onClick={async () => { try { const result = await apiRequest(`/api/agent-awareness?workspace_id=${encodeURIComponent(workspaceId)}`); setSnapshot(result.result.context); } catch (cause) { setError(cause); } }}>Preview workspace overview</Button><ErrorMessage error={error} />
    {snapshot ? <details open><summary>Workspace overview</summary><pre className="agent-action-json">{JSON.stringify(snapshot, null, 2)}</pre></details> : null}
    <p>{agentId ? 'Approved memories below belong to this agent. “Include saved memory” controls whether they travel with your next message.' : 'Select an agent to inspect its memories.'}</p>
    {memories.map(memory => <div className="rumbo-action-card" key={memory.id}><span><strong>{memory.title}</strong><small>{memory.content}</small></span><Button onClick={() => setForget(memory)}>Forget</Button></div>)}
    {agentId && !memories.length ? <p>No approved memories for this agent yet.</p> : null}
    {forget ? <Dialog title="Forget agent memory?" subtitle={forget.title} onClose={() => !busy && setForget(null)}><div className="chat-context-content"><p>This memory will no longer be included in future replies. Existing conversations are unchanged.</p><ErrorMessage error={error} /></div><footer className="dialog-footer"><Button disabled={busy} onClick={() => setForget(null)}>Cancel</Button><Button busy={busy} onClick={async () => { setBusy(true); try { await apiRequest(`/api/agent-memories/${forget.id}/forget`, { method: 'POST', body: { workspace_id: workspaceId, confirmed: true } }); setMemories(items => items.filter(item => item.id !== forget.id)); setForget(null); setError(null); } catch (cause) { setError(cause); } finally { setBusy(false); } }}>Forget memory</Button></footer></Dialog> : null}
  </section>;
}

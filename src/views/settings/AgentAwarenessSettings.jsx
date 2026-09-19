import { useEffect, useState } from 'react';
import { Button, ErrorMessage, Select, Toggle, useApp } from '../../ui.jsx';
import { apiRequest } from '../../data/api.js';
import { AgentMemoryPanel } from '../../components/AgentMemoryPanel.jsx';

export function AgentAwarenessSettings() {
  const { workspace, data } = useApp();
  const [enabled, setEnabled] = useState(null), [agentId, setAgentId] = useState(''), [projectId, setProjectId] = useState(''), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    setEnabled(null); setAgentId(''); setProjectId('');
    const controller = new AbortController();
    apiRequest(`/api/agent-awareness?workspace_id=${encodeURIComponent(workspace.id)}`, { signal: controller.signal }).then(result => setEnabled(result.result.enabled)).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [workspace.id]);
  return <><h1>Agent awareness</h1><p>Control the workspace overview, inspect memories, and review what agents are allowed to change.</p><ErrorMessage error={error} /><Toggle label="Workspace awareness & action proposals" description="Provide a fresh workspace overview and allow reviewed action requests. Turning this off affects future replies; it does not erase context already sent." checked={enabled === true} disabled={busy || enabled === null} onChange={async value => { setBusy(true); try { await apiRequest('/api/agent-awareness', { method: 'POST', body: { workspace_id: workspace.id, enabled: value } }); setEnabled(value); setError(null); } catch (cause) { setError(cause); } finally { setBusy(false); } }} /><section className="chat-context-content"><h2>Permission boundaries</h2><p>All Rumbo actions require approval in the conversation. Agents can request preference changes, project/route/document edits, recoverable archives, and memory creation. They cannot approve requests, grant permissions, connect accounts, or delete records. Stale proposals are rejected. Project-file tools have their own separately selected access mode.</p><Select label="Inspect agent memory" value={agentId} onChange={setAgentId}><option value="">Choose an agent</option>{data.agents.filter(item => !item.archived_at).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Select label="Project memory scope" value={projectId} onChange={setProjectId}><option value="">Workspace-wide memories</option>{data.projects.filter(item => !item.archived_at).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><AgentMemoryPanel workspaceId={workspace.id} agentId={agentId} projectId={projectId} /></section></>;
}

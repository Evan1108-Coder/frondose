import { useEffect, useRef, useState } from 'react';
import { Button, ErrorMessage, Select, Toggle, useApp } from '../../ui.jsx';
import { apiRequest } from '../../data/api.js';
import { AgentMemoryPanel } from '../../components/AgentMemoryPanel.jsx';

export function AgentAwarenessSettings() {
  const { workspace, data } = useApp();
  const [enabled, setEnabled] = useState(null), [agentId, setAgentId] = useState(''), [projectId, setProjectId] = useState(''), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const [lowRisk, setLowRisk] = useState(null), [capabilityVersion, setCapabilityVersion] = useState(1);
  const activeScope = useRef(null);
  if (activeScope.current?.workspaceId !== workspace.id) activeScope.current = {workspaceId:workspace.id};
  useEffect(() => {
    setEnabled(null); setLowRisk(null); setCapabilityVersion(1); setAgentId(''); setProjectId(''); setBusy(false); setError(null);
    const controller = new AbortController();
    apiRequest(`/api/agent-awareness?workspace_id=${encodeURIComponent(workspace.id)}`, { signal: controller.signal }).then(response => { const result = response.result || response; setEnabled(result.enabled); setLowRisk(result.low_risk_actions?.enabled === true); setCapabilityVersion(result.low_risk_actions?.capability_version || 1); }).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [workspace.id]);
  const saveSetting = async (body, update) => {
    const scope = activeScope.current;
    setBusy(true); setError(null);
    try {
      const response = await apiRequest('/api/agent-awareness', {method:'POST',body:{workspace_id:scope.workspaceId,...body}});
      if (activeScope.current === scope) update(response.result || response);
    } catch (cause) { if (activeScope.current === scope) setError(cause); }
    finally { if (activeScope.current === scope) setBusy(false); }
  };
  const saveLowRisk = value => saveSetting({low_risk_actions:value,capability_version:2}, result => {
    setLowRisk(result.low_risk_actions.enabled); setCapabilityVersion(result.low_risk_actions.capability_version);
  });
  return <>
    <h1>Agent awareness</h1>
    <p>Control workspace context, memories, and the actions connected agents can take.</p>
    <ErrorMessage error={error} />
    <Toggle label="Workspace awareness & action proposals" description="Provide a fresh workspace overview and allow action requests. Turning this off affects future replies; it does not erase context already sent." checked={enabled === true} disabled={busy || enabled === null} onChange={value => saveSetting({enabled:value}, result => setEnabled(result.enabled))} />
    <Toggle label="Automatic low-risk actions" description={`For your account in this workspace: let agents create safe new Routes and link themselves to Areas, projects, and Routes.${capabilityVersion >= 2 || !lowRisk ? ' Agents may also record handoff drafts for a reviewed next turn, without launching another agent.' : ' Your existing opt-in does not include handoff drafts.'} No existing content is overwritten. Turning this off also invalidates already prepared automatic-action authority.`} checked={lowRisk === true} disabled={busy || lowRisk === null || enabled !== true} onChange={saveLowRisk} />
    {lowRisk && capabilityVersion < 2 ? <Button disabled={busy || enabled !== true} onClick={() => saveLowRisk(true)}>Include handoff drafts</Button> : null}
    <section className="chat-context-content">
      <h2>Permission boundaries</h2>
      <p>Direct actions still use your current permissions and exact captured context. Handoff drafts wait for a reviewed next turn; they do not interrupt a running AI or start paid work. Expanding an existing opt-in invalidates its older prepared turns. Deletion, archiving, overwriting content, permission changes, external actions and paid launches are not enabled by this switch. Supported higher-risk proposals stay pending for confirmation. A suggested schedule needs a fresh context capture and explicit confirmation before it can run. Project-file tools keep their separately chosen access mode.</p>
      <Select label="Inspect agent memory" value={agentId} onChange={setAgentId}><option value="">Choose an agent</option>{data.agents.filter(item => !item.archived_at).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      <Select label="Project memory scope" value={projectId} onChange={setProjectId}><option value="">Workspace-wide memories</option>{data.projects.filter(item => !item.archived_at).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      <AgentMemoryPanel workspaceId={workspace.id} agentId={agentId} projectId={projectId} />
    </section>
  </>;
}

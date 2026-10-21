import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, Dialog, ErrorMessage, Field, Select, useApp } from '../ui.jsx';
import { Form } from './Form.jsx';
import { useUnsavedUpdate } from './UnsavedUpdates.jsx';
import './agent-runner-settings.css';

function editableSettings(saved) {
  return {
    connection_method: saved.connection_method === 'computer' ? 'computer' : 'unselected',
    runner_id: saved.runner_id || '', runtime_id: saved.runtime_id || '',
    usage_scope: saved.usage_scope || 'private', usage_member_ids: saved.usage_member_ids || [],
    max_concurrent_sessions: saved.max_concurrent_sessions || 1,
    session_policy: saved.session_policy || 'conversation',
  };
}

function AgentRunnerSettingsContent({ agentId, workspaceId, members: suppliedMembers }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [runners, setRunners] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [members, setMembers] = useState(suppliedMembers || []);
  const [currentActorId, setCurrentActorId] = useState(null);
  const [memberWarning, setMemberWarning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [removePreparation, setRemovePreparation] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const active = useRef(true);
  const locked = useRef(false);

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    setLoading(true); setError(null); setNotice('');
    const query = `workspace_id=${encodeURIComponent(workspaceId)}`;
    const memberRequest = apiRequest(`/api/governance?${query}`, { signal: controller.signal }).then(response => response.result).catch(() => null);
    Promise.all([
      apiRequest(`/api/agent-runner-settings/${encodeURIComponent(agentId)}?${query}`, { signal: controller.signal }),
      apiRequest(`/api/runner-connections?${query}`, { signal: controller.signal }),
      memberRequest,
    ]).then(([settingsResponse, connectionsResponse, governance]) => {
      if (controller.signal.aborted || !active.current) return;
      const value = settingsResponse.result || settingsResponse;
      const connections = connectionsResponse.result || connectionsResponse;
      setSaved(value); setDraft(editableSettings(value));
      setRunners((connections.runners || []).filter(runner => !['approval_required', 'revoked'].includes(runner.state)));
      setCatalog(connections.catalog || []);
      setMembers((suppliedMembers || governance?.members || []).filter(member => member.status === 'active'));
      setCurrentActorId(governance?.current_user?.id || null);
      setMemberWarning(!suppliedMembers && !governance);
    }).catch(cause => { if (!controller.signal.aborted && active.current) setError(cause); })
      .finally(() => { if (!controller.signal.aborted && active.current) setLoading(false); });
    return () => { active.current = false; controller.abort(); };
  }, [workspaceId, agentId, refresh, suppliedMembers]);

  const update = (field, value) => { setNotice(''); setDraft(current => ({ ...current, [field]: value })); };
  const currentComputer = draft && runners.find(runner => runner.id === draft.runner_id);
  const currentRuntime = draft && catalog.find(provider => provider.id === draft.runtime_id);
  const canEdit = Boolean(saved && (!saved.owner_actor_id || saved.owner_actor_id === currentActorId));
  const changed = Boolean(saved && draft && JSON.stringify(editableSettings(saved)) !== JSON.stringify(draft));
  useUnsavedUpdate(changed, busy);
  const valid = draft && (draft.connection_method !== 'computer' || currentComputer && currentRuntime) && (draft.usage_scope !== 'members' || draft.usage_member_ids.length > 0);
  const disabled = busy || loading || !canEdit;
  const save = async event => {
    event.preventDefault();
    if (locked.current || !valid || !changed) return;
    locked.current = true; setBusy(true); setError(null); setNotice('');
    try {
      const computer = draft.connection_method === 'computer';
      const response = await apiRequest(`/api/agent-runner-settings/${encodeURIComponent(agentId)}`, { method: 'PUT', body: {
        workspace_id: workspaceId, version: saved.version, ...draft,
        runner_id: computer ? draft.runner_id : null, runtime_id: computer ? draft.runtime_id : null,
        usage_member_ids: draft.usage_scope === 'members' ? draft.usage_member_ids : [], enabled: false,
      } });
      if (!active.current) return;
      const value = response.result || response;
      setSaved(value); setDraft(editableSettings(value));
      setNotice('Disabled preparation saved. Live runs are blocked for this profile; account credentials are unchanged. No AI session or sharing was activated.');
    } catch (cause) { if (active.current) setError(cause); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  };
  const remove = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null); setNotice('');
    try {
      const response = await apiRequest(`/api/agent-runner-settings/${encodeURIComponent(agentId)}`, { method: 'DELETE', body: { workspace_id: workspaceId, version: saved.version } });
      if (!active.current) return;
      const value = response.result || response;
      setSaved(value); setDraft(editableSettings(value)); setRemovePreparation(false);
      setNotice('Computer preparation removed. The profile can use its previous AI connection only on an explicit request and after current account and permission checks. Nothing was started.');
    } catch (cause) { if (active.current) setError(cause); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  };

  return <section className="agent-computer-settings" aria-labelledby={`agent-computer-heading-${agentId}`}>
    <header><h3 id={`agent-computer-heading-${agentId}`}>Computer connection</h3><p>Prepare this named agent’s runtime and usage preferences. Remote execution and shared computer-backed sessions are not released yet.</p></header>
    <ErrorMessage error={error} />
    {notice ? <p role="status" className="agent-computer-notice">{notice}</p> : null}
    {loading ? <p role="status">Loading computer settings…</p> : !saved || !draft ? <Button onClick={() => setRefresh(value => value + 1)}>Retry loading settings</Button> : <Form onSubmit={save}>
      {!canEdit ? <p>Only the connection owner can change this binding or its sharing preferences. Workspace managers can disable a connection through management controls.</p> : null}
      <Field label="Connection route" hint="API keys and website authorization remain in AI connections. This section prepares an optional personal computer."><Select value={draft.connection_method} onChange={value => setDraft(current => ({ ...current, connection_method: value, runner_id: value === 'computer' ? current.runner_id : '', runtime_id: value === 'computer' ? current.runtime_id : '' }))} disabled={disabled}><option value="unselected">Disconnected · no live execution</option><option value="computer">Connect a computer</option></Select></Field>
      {draft.connection_method === 'computer' ? <>
        <Field label="Your paired computer" hint="Only confirmed computers owned by your account are available. The computer must stay awake and online."><Select value={draft.runner_id} onChange={value => update('runner_id', value)} disabled={disabled}><option value="">Choose a computer</option>{draft.runner_id && !currentComputer ? <option value={draft.runner_id}>Previously selected computer · unavailable</option> : null}{runners.map(runner => <option key={runner.id} value={runner.id}>{runner.name} · {runner.state === 'online' ? 'online' : 'offline'}</option>)}</Select></Field>
        {!runners.length ? <p>Pair and approve a computer in <a href="#/connections">AI connections</a>, then reload these settings.</p> : null}
        <Field label="Agent runtime" hint="A catalog entry does not prove that the runtime is installed, signed in or permitted by its provider."><Select value={draft.runtime_id} onChange={value => update('runtime_id', value)} disabled={disabled}><option value="">Choose a runtime</option>{draft.runtime_id && !currentRuntime ? <option value={draft.runtime_id}>Previously selected runtime · unavailable</option> : null}{catalog.map(provider => <option key={provider.id} value={provider.id}>{provider.title} · {provider.protocol}</option>)}</Select></Field>
        {currentRuntime ? <p>{currentRuntime.support?.adapterStatus === 'existing-local-adapter' ? 'An existing local adapter is available; remote execution is not released.' : 'This runtime is catalogued; its Frondose adapter is not released.'} Each agent profile keeps its own identity and session settings, even when profiles use the same runtime.</p> : null}
      </> : null}
      <Field label="Who could use this agent" hint="This saves intended access only. It never shares credentials, grants computer access or overrides provider account-sharing rules."><Select value={draft.usage_scope} onChange={value => setDraft(current => ({ ...current, usage_scope: value, usage_member_ids: [] }))} disabled={disabled}><option value="private">Only me</option><option value="members">Selected workspace members</option><option value="workspace">Workspace members with execution permission</option></Select></Field>
      {draft.usage_scope === 'members' ? <fieldset className="agent-computer-member-picker" disabled={disabled}><legend>Selected members</legend>{memberWarning ? <p>Member choices could not be loaded. Check your membership permissions and reload.</p> : members.length ? members.map(member => <label key={member.id}><input type="checkbox" checked={draft.usage_member_ids.includes(member.id)} onChange={event => update('usage_member_ids', event.target.checked ? [...draft.usage_member_ids, member.id] : draft.usage_member_ids.filter(id => id !== member.id))} /><span>{member.name}{member.id === currentActorId && member.name !== 'You' ? ' · You' : ''}</span></label>) : <p>No active members are available to select.</p>}</fieldset> : null}
      <div className="agent-computer-setting-pair">
        <Field label="Maximum simultaneous sessions" hint="Prepared limit; remote dispatch is still disabled."><Select value={String(draft.max_concurrent_sessions)} onChange={value => update('max_concurrent_sessions', Number(value))} disabled={disabled}>{[1, 2, 3, 4, 5, 6, 7, 8].map(value => <option key={value} value={String(value)}>{value}</option>)}</Select></Field>
        <Field label="Session preference" hint="Resuming history depends on each runtime’s supported capabilities."><Select value={draft.session_policy} onChange={value => update('session_policy', value)} disabled={disabled}><option value="conversation">Separate session per conversation</option><option value="new-session">New session for each request</option></Select></Field>
      </div>
      <p className="agent-computer-unavailable">Saving these disabled settings prevents live runs for this profile; existing account credentials remain unchanged. Saving never starts an agent, grants provider access or changes conversation history.</p>
      <div className="agent-computer-save"><Button type="submit" variant="primary" disabled={disabled || !changed || !valid} busy={busy}>Save prepared settings</Button><Button disabled={busy} onClick={() => { setDraft(editableSettings(saved)); setNotice(''); setRefresh(value => value + 1); }}>Reload saved settings</Button>{saved.version > 0 && saved.owner_actor_id === currentActorId ? <Button disabled={busy} onClick={() => setRemovePreparation(true)}>Remove computer preparation</Button> : null}</div>
    </Form>}
    {removePreparation ? <Dialog title="Remove computer preparation?" subtitle="Return this profile to its previous AI connection settings." closeDisabled={busy} onClose={() => { if (!busy) setRemovePreparation(false); }}><div className="agent-computer-remove"><p>This removes this profile’s prepared computer binding, sharing preferences and session limits. The paired computer, conversation history and account credentials are kept.</p><p>The profile may then run through its previous AI connection when you explicitly send a request, subject to current account and workspace permissions. This action does not start a session.</p><div><Button disabled={busy} onClick={() => setRemovePreparation(false)}>Keep preparation</Button><Button variant="primary" busy={busy} onClick={remove}>Remove preparation</Button></div></div></Dialog> : null}
  </section>;
}

export function AgentRunnerSettings({ agentId, workspaceId, members }) {
  const { workspace } = useApp();
  const currentId = workspaceId || workspace?.id;
  return agentId && currentId ? <AgentRunnerSettingsContent key={`${currentId}:${agentId}`} agentId={agentId} workspaceId={currentId} members={members} /> : null;
}

import { useEffect, useRef, useState } from 'react';
import { Form } from '../../components/Form.jsx';
import { apiRequest } from '../../data/api.js';
import { Button, ErrorMessage, Field, Select, Toggle, useApp } from '../../ui.jsx';
import { visible } from '../../lib/model.js';
import '../rumbo-agent.css';

const asList = value => Array.isArray(value) ? value : [];
const providerId = item => item?.provider || item?.id || '';
const modelId = item => typeof item === 'string' ? item : item?.id || item?.model || '';
const modelLabel = item => typeof item === 'string' ? item : item?.label || item?.name || item?.id || item?.model || '';

export function RumboAgentPreferences() {
  const { workspace, data, notify, navigate } = useApp();
  const [state, setState] = useState(null), [form, setForm] = useState(null), [saved, setSaved] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const workspaceRef = useRef(workspace.id);
  workspaceRef.current = workspace.id;
  useEffect(() => {
    const controller = new AbortController(); setState(null); setForm(null); setError(null);
    apiRequest(`/api/rumbo-agent?workspace_id=${encodeURIComponent(workspace.id)}`, { signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      const result = response.result || {}, preferences = result.preferences || {};
      const next = { provider: preferences.provider || '', model: preferences.model || '', reasoning_effort: preferences.reasoning_effort || '', include_memory: preferences.include_memory !== false, include_chat: preferences.include_chat !== false, include_workspace: preferences.include_workspace !== false, context_pack_ids: asList(preferences.context_pack_ids), native_tools: preferences.native_tools === true };
      setState({ ...result, providers: asList(result.providers) }); setForm(next); setSaved(next);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [workspace.id]);
  if (!state || !form) return <><h1>Rumbo Agent</h1><p>Loading model and context preferences…</p><ErrorMessage error={error} /></>;
  const selectedProvider = state.providers.find(item => providerId(item) === form.provider);
  const models = asList(selectedProvider?.models).filter(item => modelId(item));
  const customModel = Boolean(form.model && !models.some(item => modelId(item) === form.model));
  const reasoningEfforts = asList(selectedProvider?.reasoning_efforts).filter(Boolean);
  const packs = visible(data.workspace_items || []).filter(item => item.kind === 'context_pack' && item.workspace_id === workspace.id);
  const unavailablePacks = form.context_pack_ids.filter(id => !packs.some(pack => pack.id === id));
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const providerConnected = item => {
    const connection = asList(data.connections).find(row => row.provider === providerId(item));
    return connection ? connection.connected === true || connection.status === 'connected' || connection.state === 'connected' : item.connected === true;
  };
  function patch(changes) { setForm(current => ({ ...current, ...changes })); }
  async function save(event) {
    event.preventDefault(); if (busy) return; const requestWorkspace = workspace.id; setBusy(true); setError(null);
    try {
      const response = await apiRequest('/api/rumbo-agent/preferences', { method: 'PATCH', body: { workspace_id: workspace.id, preferences: form } });
      if (workspaceRef.current !== requestWorkspace) return;
      const preferences = response.result?.preferences || response.result || form, next = { ...form, ...preferences }; setForm(next); setSaved(next); notify('Rumbo Agent preferences saved. They do not grant access or start an agent.');
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  return <><h1>Rumbo Agent</h1><p>Choose defaults for new Rumbo Agent drafts. Every send still requires exact context review; these preferences never grant workspace or native-tool authority.</p><Form className="settings-group" onSubmit={save}><section className="settings-panel">
    <div className="setting-row"><span><strong>Model provider</strong><small>Only providers reported by the local Rumbo service are listed. Saving does not connect an account.</small></span><Select aria-label="Default Rumbo Agent provider" value={form.provider} onChange={provider => patch({ provider, model: '', reasoning_effort: '' })}>{state.providers.map(item => <option key={providerId(item)} value={providerId(item)}>{providerId(item)}{providerConnected(item) ? ' · connected' : ' · disconnected'}</option>)}</Select></div>
    <div className="setting-row"><span><strong>Model</strong><small>The list contains only the connection default and identifiers already configured in this workspace. It is not an availability catalog.</small></span><div className="rumbo-agent-setting-controls"><Select aria-label="Configured default Rumbo Agent model" value={form.model} disabled={!form.provider} onChange={model => patch({ model })}><option value="">{selectedProvider?.models?.find(item => !modelId(item))?.label || 'Connection default'}</option>{models.map(item => <option key={modelId(item)} value={modelId(item)} title={modelId(item)}>{modelLabel(item)} · unverified</option>)}{customModel ? <option value={form.model} title={form.model}>{form.model} · unverified</option> : null}</Select><Field label="Custom model ID"><input value={form.model} disabled={!form.provider} placeholder="Optional provider model ID" onChange={event => patch({ model: event.target.value })} /></Field></div></div>
    <div className="setting-row"><span><strong>Reasoning effort</strong><small>Only values reported for the selected provider are offered and the provider validates the choice again at launch.</small></span><Select aria-label="Default reasoning effort" value={form.reasoning_effort} disabled={!form.provider} onChange={reasoning_effort => patch({ reasoning_effort })}><option value="">Provider default</option>{reasoningEfforts.map(value => <option key={value} value={value}>{value}</option>)}</Select></div>
    <div className="setting-row"><Toggle label="Include saved memory by default" description="Eligible reviewed memory may be selected in the context preview. Profile policy and current access can still exclude it." checked={form.include_memory} onChange={include_memory => patch({ include_memory })} /></div>
    <div className="setting-row"><Toggle label="Include conversation history by default" description="The exact bounded history is shown before sending. Turning this off does not delete saved messages." checked={form.include_chat} onChange={include_chat => patch({ include_chat })} /></div>
    <div className="setting-row"><Toggle label="Include workspace overview by default" description="Propose bounded, permission-filtered summaries of visible workspace structure. Full documents are never automatically ingested." checked={form.include_workspace} onChange={include_workspace => patch({ include_workspace })} /></div>
    <div className="setting-row"><Toggle label="Suggest native tools in new drafts" description="This records a preference only. It never enables a tool, grants authority, or skips the per-run review." checked={form.native_tools} onChange={native_tools => patch({ native_tools })} /></div>
    <div className="setting-row rumbo-agent-pack-setting"><span><strong>Default Context Packs</strong><small>Select saved packs to propose during context review. Their documents and memories remain permission-checked and are never silently included.</small></span><fieldset className="rumbo-agent-pack-list"><legend>Context Packs</legend>{packs.map(pack => <label key={pack.id}><input type="checkbox" checked={form.context_pack_ids.includes(pack.id)} onChange={() => patch({ context_pack_ids: form.context_pack_ids.includes(pack.id) ? form.context_pack_ids.filter(id => id !== pack.id) : [...form.context_pack_ids, pack.id] })} /><span>{pack.name}</span></label>)}{unavailablePacks.map(id => <label key={id}><input type="checkbox" checked onChange={() => patch({ context_pack_ids: form.context_pack_ids.filter(value => value !== id) })} /><span>Unavailable Context Pack · uncheck to remove</span></label>)}{!packs.length && !unavailablePacks.length ? <p>No accessible Context Packs in this workspace.</p> : null}</fieldset></div>
    <div className="setting-row"><span><strong>Related controls</strong><small>Full documents are not automatically ingested. Agent awareness, Context Packs, and tools keep their own bounded workspace permissions.</small></span><div className="rumbo-agent-setting-links"><Button type="button" onClick={() => navigate('settings', 'awareness')}>Agent awareness</Button><Button type="button" onClick={() => navigate('settings', 'context')}>Context Packs</Button><Button type="button" onClick={() => navigate('settings', 'permissions')}>Tools &amp; permissions</Button></div></div>
  </section><ErrorMessage error={error} /><footer className="form-submit-row"><Button type="submit" variant="primary" busy={busy} disabled={!dirty}>Save Rumbo Agent preferences</Button></footer></Form></>;
}

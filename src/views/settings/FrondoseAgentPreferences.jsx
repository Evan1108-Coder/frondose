import { useEffect, useRef, useState } from 'react';
import { Form } from '../../components/Form.jsx';
import { ImageField } from '../../components/ImageField.jsx';
import { FrondoseAgentOrb, FrondoseAgentColorChoice } from '../../components/FrondoseAgentOrb.jsx';
import { apiRequest } from '../../data/api.js';
import { Button, ErrorMessage, Select, Toggle, useApp } from '../../ui.jsx';
import { visible } from '../../lib/model.js';
import { announceFrondoseAgentAppearance } from '../../lib/frondose-agent-appearance.js';
import { isBrowserAiProvider } from '../../lib/ai-providers.js';
import { RUNNER_PROVIDER_CATALOG } from '../../lib/runner-provider-catalog.js';
import { AgentRunnerSettings } from '../../components/AgentRunnerSettings.jsx';
import { refreshFrondose } from '../../data/useFrondose.js';
import '../frondose-agent.css';

const asList = value => Array.isArray(value) ? value : [];
const providerId = item => item?.provider || item?.id || '';
const providerName = item => providerId(item) === 'codex' ? 'Codex' : providerId(item) === 'claude' ? 'Claude Code' : item?.label || item?.name || providerId(item);
const modelId = item => typeof item === 'string' ? item : item?.id || item?.model || '';
const modelLabel = item => typeof item === 'string' ? item : item?.label || item?.name || item?.id || item?.model || '';

export function FrondoseAgentPreferences({ embedded = false, initialState = null, onSaved } = {}) {
  const { workspace, data, notify, navigate } = useApp();
  const [state, setState] = useState(null), [form, setForm] = useState(null), [saved, setSaved] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [computerProvider, setComputerProvider] = useState(''), [preparedAgent, setPreparedAgent] = useState(null), [preparing, setPreparing] = useState(false);
  const workspaceRef = useRef(workspace.id);
  workspaceRef.current = workspace.id;
  useEffect(() => {
    const controller = new AbortController(); setState(null); setForm(null); setError(null); setComputerProvider(''); setPreparedAgent(null);
    const load = initialState?.workspace_id === workspace.id ? Promise.resolve({ result: initialState }) : apiRequest(`/api/frondose-agent?workspace_id=${encodeURIComponent(workspace.id)}`, { signal: controller.signal });
    load.then(response => {
      if (controller.signal.aborted) return;
      const result = response.result || {}, preferences = result.preferences || {};
      const next = { provider: preferences.provider_selected === true ? preferences.provider || '' : '', provider_selected: preferences.provider_selected === true, model: preferences.provider_selected === true ? preferences.model || '' : '', reasoning_effort: preferences.provider_selected === true ? preferences.reasoning_effort || '' : '', include_memory: preferences.include_memory !== false, include_chat: preferences.include_chat !== false, include_workspace: preferences.include_workspace !== false, context_pack_ids: asList(preferences.context_pack_ids), native_tools: preferences.native_tools === true, display_name: preferences.display_name || 'Frondose', image_url: preferences.image_url || null, orb_color: preferences.orb_color || 'blue', purpose: preferences.purpose || '', guidelines: preferences.guidelines || '', onboarding_complete: preferences.onboarding_complete === true };
      setState({ ...result, providers: asList(result.providers) }); setForm(next); setSaved(next);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [workspace.id, initialState]);
  if (!state || !form) return <><h1>Frondose</h1><p>Loading model and context preferences…</p><ErrorMessage error={error} /></>;
  const selectedProvider = state.providers.find(item => providerId(item) === form.provider);
  const models = asList(selectedProvider?.models).filter(item => modelId(item));
  const customModel = Boolean(form.model && !models.some(item => modelId(item) === form.model));
  const reasoningEfforts = asList(selectedProvider?.reasoning_efforts).filter(Boolean);
  const packs = visible(data.workspace_items || []).filter(item => item.kind === 'context_pack' && item.workspace_id === workspace.id);
  const unavailablePacks = form.context_pack_ids.filter(id => !packs.some(pack => pack.id === id));
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const providerConnected = item => item?.connected === true;
  const computerAgent = preparedAgent || (computerProvider || form.provider ? state.providers.find(item => providerId(item) === (computerProvider || form.provider))?.agent : null);
  const apiModelRequired = selectedProvider?.model_required ?? isBrowserAiProvider(form.provider);
  function patch(changes) { setForm(current => ({ ...current, ...changes })); }
  async function reloadConnections() {
    const currentWorkspace = workspace.id;
    const response = await apiRequest(`/api/frondose-agent?workspace_id=${encodeURIComponent(currentWorkspace)}`);
    if (workspaceRef.current !== currentWorkspace) return;
    setState({ ...response.result, providers: asList(response.result?.providers) });
  }
  async function prepareComputer() {
    if (preparing || !computerProvider) return;
    const currentWorkspace = workspace.id; setPreparing(true); setError(null);
    try {
      const response = await apiRequest('/api/frondose-agent/profile', { method: 'POST', body: { workspace_id: currentWorkspace, provider: computerProvider, prepare_computer: true } });
      if (workspaceRef.current !== currentWorkspace) return;
      const agent = response.result?.agent || response.agent;
      setPreparedAgent(agent); patch({ provider: computerProvider, provider_selected: true, model: '', reasoning_effort: '' });
      await refreshFrondose(); await reloadConnections();
      notify('Frondose computer profile created. Bind and enable its computer below, then save your AI selection. No work was started.');
    } catch (cause) { if (workspaceRef.current === currentWorkspace) setError(cause); }
    finally { if (workspaceRef.current === currentWorkspace) setPreparing(false); }
  }
  async function save(event) {
    event.preventDefault(); if (busy) return; const requestWorkspace = workspace.id; setBusy(true); setError(null);
    try {
      const submitted = { ...form, onboarding_complete: form.onboarding_complete || Boolean(form.purpose.trim() && form.guidelines.trim()) };
      const response = await apiRequest('/api/frondose-agent/preferences', { method: 'PATCH', body: { workspace_id: workspace.id, preferences: submitted } });
      if (workspaceRef.current !== requestWorkspace) return;
      const preferences = response.result?.preferences || response.result || submitted, next = { ...submitted, ...preferences }; setForm(next); setSaved(next); announceFrondoseAgentAppearance(requestWorkspace, next); onSaved?.(next, state); notify('Frondose preferences saved. No AI work was started.');
    } catch (cause) { if (workspaceRef.current === requestWorkspace) setError(cause); }
    finally { if (workspaceRef.current === requestWorkspace) setBusy(false); }
  }
  return <>{!embedded ? <><h1>Frondose</h1><p>Choose your assistant’s identity, AI connection and context defaults. Saving never starts AI work or grants tools.</p></> : null}<Form className="settings-group frondose-setup-form" onSubmit={save}><section className="settings-panel">
    <div className="setting-row"><span><strong>AI connection</strong><small>Frondose never chooses an account automatically. Select a ready API/account or computer binding here; other agent profiles keep their own connections.</small></span><div className="rumbo-agent-setting-controls"><Select aria-label="Frondose AI connection" value={form.provider} onChange={provider => patch({ provider, provider_selected: Boolean(provider), model: '', reasoning_effort: '' })}><option value="">Not selected</option>{state.providers.filter(providerConnected).map(item => <option key={providerId(item)} value={providerId(item)}>{providerName(item)}{item.agent?.runner_connection ? ' · computer' : ''}</option>)}{form.provider && !providerConnected(selectedProvider) ? <option value={form.provider} disabled>{providerName(selectedProvider) || form.provider} · {computerAgent ? 'finish computer setup below' : 'reconnect required'}</option> : null}</Select><Button onClick={() => navigate('connections')}>Manage AI connections</Button></div></div>
    <div className="setting-row rumbo-agent-identity-setting"><span><strong>Agent identity</strong><small>Name and picture appear in Frondose. Purpose and guidelines are included in versioned instructions. The provider remains identifiable separately.</small></span><div className="rumbo-agent-identity-fields"><FrondoseAgentOrb color={form.orb_color} compact /><label>Agent name<input aria-label="Agent name" autoFocus={embedded && !form.onboarding_complete} required maxLength={60} value={form.display_name} onChange={event => patch({ display_name: event.target.value })} /></label><ImageField label="Agent picture" value={form.image_url} onChange={image_url => patch({ image_url })} disabled={busy} /><FrondoseAgentColorChoice value={form.orb_color} onChange={orb_color => patch({ orb_color })} /><label>Purpose<textarea aria-label="Purpose" required={!form.onboarding_complete} maxLength={500} rows={2} value={form.purpose} onChange={event => patch({ purpose: event.target.value })} /></label><label>Guidelines<textarea aria-label="Guidelines" required={!form.onboarding_complete} maxLength={4000} rows={4} value={form.guidelines} onChange={event => patch({ guidelines: event.target.value })} /></label></div></div>
    <div className="setting-row"><span><strong>Model</strong><small>{apiModelRequired ? 'Choose an explicit chat model from your connected account.' : 'Automatic lets the provider choose. Configured IDs are validated by the provider at launch.'}</small></span><div className="rumbo-agent-setting-controls"><Select aria-label="Default Frondose model" value={form.model} disabled={!form.provider || modelBusy} onChange={model => patch({ model })}><option value="">{apiModelRequired ? 'Choose a model' : 'Automatic'}</option>{models.map(item => <option key={modelId(item)} value={modelId(item)} title={modelId(item)}>{modelLabel(item)}</option>)}{customModel ? <option value={form.model} title={form.model}>{form.model} · configured</option> : null}</Select>{apiModelRequired ? <Button variant="ghost" busy={modelBusy} disabled={busy || modelBusy} onClick={async () => { setModelBusy(true); setError(null); try { const response = await apiRequest(`/api/ai-connections/${form.provider}/models?workspace_id=${encodeURIComponent(workspace.id)}`); setState(current => ({ ...current, providers: current.providers.map(provider => providerId(provider) === form.provider ? { ...provider, models: response.result.filter(model => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model.id) && (!model.output_modalities?.length || model.output_modalities.includes('text'))) } : provider) })); } catch (cause) { setError(cause); } finally { setModelBusy(false); } }}>Load models</Button> : null}</div></div>
    <div className="setting-row"><span><strong>Reasoning effort</strong><small>Only values reported for the selected provider are offered and the provider validates the choice again at launch.</small></span><Select aria-label="Default reasoning effort" value={form.reasoning_effort} disabled={!form.provider} onChange={reasoning_effort => patch({ reasoning_effort })}><option value="">Provider default</option>{reasoningEfforts.map(value => <option key={value} value={value}>{value}</option>)}</Select></div>
    <Toggle label="Include saved memory by default" description="Eligible reviewed memory may be selected in the context preview. Profile policy and current access can still exclude it." checked={form.include_memory} onChange={include_memory => patch({ include_memory })} />
    <Toggle label="Include conversation history by default" description="The exact bounded history is shown before sending. Turning this off does not delete saved messages." checked={form.include_chat} onChange={include_chat => patch({ include_chat })} />
    <Toggle label="Include workspace overview by default" description="Propose bounded, permission-filtered summaries of visible workspace structure. Full documents are never automatically ingested." checked={form.include_workspace} onChange={include_workspace => patch({ include_workspace })} />
    <Toggle label="Suggest native tools in new drafts" description="This records a preference only. It never enables a tool, grants authority, or skips the per-run review." checked={form.native_tools} onChange={native_tools => patch({ native_tools })} />
    <div className="setting-row rumbo-agent-pack-setting"><span><strong>Default Context Packs</strong><small>Select saved packs to propose during context review. Their documents and memories remain permission-checked and are never silently included.</small></span><fieldset className="rumbo-agent-pack-list"><legend>Context Packs</legend>{packs.map(pack => <label key={pack.id}><input type="checkbox" checked={form.context_pack_ids.includes(pack.id)} onChange={() => patch({ context_pack_ids: form.context_pack_ids.includes(pack.id) ? form.context_pack_ids.filter(id => id !== pack.id) : [...form.context_pack_ids, pack.id] })} /><span>{pack.name}</span></label>)}{unavailablePacks.map(id => <label key={id}><input type="checkbox" checked onChange={() => patch({ context_pack_ids: form.context_pack_ids.filter(value => value !== id) })} /><span>Unavailable Context Pack · uncheck to remove</span></label>)}{!packs.length && !unavailablePacks.length ? <p>No accessible Context Packs in this workspace.</p> : null}</fieldset></div>
    <div className="setting-row"><span><strong>Related controls</strong><small>Full documents are not automatically ingested. Agent awareness, Context Packs, and tools keep their own bounded workspace permissions.</small></span><div className="rumbo-agent-setting-links"><Button type="button" onClick={() => navigate('settings', 'awareness')}>Agent awareness</Button><Button type="button" onClick={() => navigate('settings', 'context')}>Context Packs</Button><Button type="button" onClick={() => navigate('settings', 'permissions')}>Tools &amp; permissions</Button></div></div>
  </section><ErrorMessage error={error} /><footer className="form-submit-row"><Button type="submit" variant="primary" busy={busy} disabled={!dirty || form.provider_selected && !providerConnected(selectedProvider)}>{form.onboarding_complete ? 'Save Frondose preferences' : 'Save setup'}</Button></footer></Form>
  <section className="frondose-computer-setup" aria-labelledby="frondose-computer-heading"><h2 id="frondose-computer-heading">Use your own computer</h2><p>Choose a runtime for Frondose’s own profile, then bind a paired computer and explicitly enable it. This does not borrow another agent’s account or start work. <a href="#/docs/computer-connections">Read the setup guide</a>.</p><div className="rumbo-agent-setting-controls"><Select aria-label="Frondose computer runtime" value={computerProvider} onChange={provider => { setComputerProvider(provider); setPreparedAgent(null); }} disabled={preparing || busy}><option value="">Choose a computer runtime</option>{RUNNER_PROVIDER_CATALOG.map(provider => <option key={provider.id} value={provider.id}>{provider.title}</option>)}</Select><Button type="button" disabled={!computerProvider || preparing || busy} busy={preparing} onClick={prepareComputer}>Set up computer connection</Button></div>{computerAgent?.id ? <AgentRunnerSettings key={computerAgent.id} agentId={computerAgent.id} workspaceId={workspace.id} onSaved={async () => { await reloadConnections(); }} /> : null}</section></>;
}

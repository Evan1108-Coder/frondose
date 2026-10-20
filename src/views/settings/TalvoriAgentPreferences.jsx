import { useEffect, useRef, useState } from 'react';
import { Form } from '../../components/Form.jsx';
import { ImageField } from '../../components/ImageField.jsx';
import { TalvoriAgentOrb, TalvoriAgentColorChoice } from '../../components/TalvoriAgentOrb.jsx';
import { apiRequest } from '../../data/api.js';
import { Button, ErrorMessage, Select, Toggle, useApp } from '../../ui.jsx';
import { visible } from '../../lib/model.js';
import { announceTalvoriAgentAppearance } from '../../lib/talvori-agent-appearance.js';
import { isBrowserAiProvider } from '../../lib/ai-providers.js';
import '../talvori-agent.css';

const asList = value => Array.isArray(value) ? value : [];
const providerId = item => item?.provider || item?.id || '';
const providerName = item => providerId(item) === 'codex' ? 'Codex' : providerId(item) === 'claude' ? 'Claude Code' : item?.label || item?.name || providerId(item);
const modelId = item => typeof item === 'string' ? item : item?.id || item?.model || '';
const modelLabel = item => typeof item === 'string' ? item : item?.label || item?.name || item?.id || item?.model || '';

export function TalvoriAgentPreferences({ embedded = false, initialState = null, onSaved } = {}) {
  const { workspace, data, notify, navigate } = useApp();
  const [state, setState] = useState(null), [form, setForm] = useState(null), [saved, setSaved] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [modelBusy, setModelBusy] = useState(false);
  const workspaceRef = useRef(workspace.id);
  workspaceRef.current = workspace.id;
  useEffect(() => {
    const controller = new AbortController(); setState(null); setForm(null); setError(null);
    const load = initialState?.workspace_id === workspace.id ? Promise.resolve({ result: initialState }) : apiRequest(`/api/talvori-agent?workspace_id=${encodeURIComponent(workspace.id)}`, { signal: controller.signal });
    load.then(response => {
      if (controller.signal.aborted) return;
      const result = response.result || {}, preferences = result.preferences || {};
      const next = { provider: preferences.provider_selected === true ? preferences.provider || '' : '', provider_selected: preferences.provider_selected === true, model: preferences.provider_selected === true ? preferences.model || '' : '', reasoning_effort: preferences.provider_selected === true ? preferences.reasoning_effort || '' : '', include_memory: preferences.include_memory !== false, include_chat: preferences.include_chat !== false, include_workspace: preferences.include_workspace !== false, context_pack_ids: asList(preferences.context_pack_ids), native_tools: preferences.native_tools === true, display_name: preferences.display_name || 'Talvori', image_url: preferences.image_url || null, orb_color: preferences.orb_color || 'blue', purpose: preferences.purpose || '', guidelines: preferences.guidelines || '', onboarding_complete: preferences.onboarding_complete === true };
      setState({ ...result, providers: asList(result.providers) }); setForm(next); setSaved(next);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [workspace.id, initialState]);
  if (!state || !form) return <><h1>Talvori</h1><p>Loading model and context preferences…</p><ErrorMessage error={error} /></>;
  const selectedProvider = state.providers.find(item => providerId(item) === form.provider);
  const models = asList(selectedProvider?.models).filter(item => modelId(item));
  const customModel = Boolean(form.model && !models.some(item => modelId(item) === form.model));
  const reasoningEfforts = asList(selectedProvider?.reasoning_efforts).filter(Boolean);
  const packs = visible(data.workspace_items || []).filter(item => item.kind === 'context_pack' && item.workspace_id === workspace.id);
  const unavailablePacks = form.context_pack_ids.filter(id => !packs.some(pack => pack.id === id));
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const providerConnected = item => item?.connected === true;
  function patch(changes) { setForm(current => ({ ...current, ...changes })); }
  async function save(event) {
    event.preventDefault(); if (busy) return; const requestWorkspace = workspace.id; setBusy(true); setError(null);
    try {
      const submitted = { ...form, onboarding_complete: form.onboarding_complete || Boolean(form.purpose.trim() && form.guidelines.trim()) };
      const response = await apiRequest('/api/talvori-agent/preferences', { method: 'PATCH', body: { workspace_id: workspace.id, preferences: submitted } });
      if (workspaceRef.current !== requestWorkspace) return;
      const preferences = response.result?.preferences || response.result || submitted, next = { ...submitted, ...preferences }; setForm(next); setSaved(next); announceTalvoriAgentAppearance(requestWorkspace, next); onSaved?.(next); notify('Talvori preferences saved. No AI work was started.');
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  return <>{!embedded ? <><h1>Talvori</h1><p>Choose your assistant’s identity, AI connection and context defaults. Saving never starts AI work or grants tools.</p></> : null}<Form className={`settings-group${embedded ? ' talvori-setup-form' : ''}`} onSubmit={save}><section className="settings-panel">
    <div className="setting-row"><span><strong>AI connection</strong><small>Talvori never chooses an account automatically. Select a verified connection here; other agent profiles keep their own connections.</small></span><div className="rumbo-agent-setting-controls"><Select aria-label="Talvori AI connection" value={form.provider} onChange={provider => patch({ provider, provider_selected: Boolean(provider), model: '', reasoning_effort: '' })}><option value="">Not selected</option>{state.providers.filter(providerConnected).map(item => <option key={providerId(item)} value={providerId(item)}>{providerName(item)}</option>)}{form.provider && !providerConnected(selectedProvider) ? <option value={form.provider} disabled>{providerName(selectedProvider) || form.provider} · reconnect required</option> : null}</Select><Button onClick={() => navigate('connections')}>Manage AI connections</Button></div></div>
    <div className="setting-row rumbo-agent-identity-setting"><span><strong>Agent identity</strong><small>Name and picture appear in Talvori. Purpose and guidelines are included in versioned instructions. The provider remains identifiable separately.</small></span><div className="rumbo-agent-identity-fields"><TalvoriAgentOrb color={form.orb_color} compact /><label>Agent name<input required maxLength={60} value={form.display_name} onChange={event => patch({ display_name: event.target.value })} /></label><ImageField label="Agent picture" value={form.image_url} onChange={image_url => patch({ image_url })} disabled={busy} /><TalvoriAgentColorChoice value={form.orb_color} onChange={orb_color => patch({ orb_color })} /><label>Purpose<textarea maxLength={500} rows={2} value={form.purpose} onChange={event => patch({ purpose: event.target.value })} /></label><label>Guidelines<textarea maxLength={4000} rows={4} value={form.guidelines} onChange={event => patch({ guidelines: event.target.value })} /></label></div></div>
    <div className="setting-row"><span><strong>Model</strong><small>{isBrowserAiProvider(form.provider) ? 'Choose an explicit chat model from your connected account.' : 'Automatic lets the provider choose. Configured IDs are validated by the provider at launch.'}</small></span><div className="rumbo-agent-setting-controls"><Select aria-label="Default Talvori model" value={form.model} disabled={!form.provider || modelBusy} onChange={model => patch({ model })}><option value="">{isBrowserAiProvider(form.provider) ? 'Choose a model' : 'Automatic'}</option>{models.map(item => <option key={modelId(item)} value={modelId(item)} title={modelId(item)}>{modelLabel(item)}</option>)}{customModel ? <option value={form.model} title={form.model}>{form.model} · configured</option> : null}</Select>{isBrowserAiProvider(form.provider) ? <Button variant="ghost" busy={modelBusy} disabled={busy || modelBusy} onClick={async () => { setModelBusy(true); setError(null); try { const response = await apiRequest(`/api/ai-connections/${form.provider}/models?workspace_id=${encodeURIComponent(workspace.id)}`); setState(current => ({ ...current, providers: current.providers.map(provider => providerId(provider) === form.provider ? { ...provider, models: response.result.filter(model => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model.id) && (!model.output_modalities?.length || model.output_modalities.includes('text'))) } : provider) })); } catch (cause) { setError(cause); } finally { setModelBusy(false); } }}>Load models</Button> : null}</div></div>
    <div className="setting-row"><span><strong>Reasoning effort</strong><small>Only values reported for the selected provider are offered and the provider validates the choice again at launch.</small></span><Select aria-label="Default reasoning effort" value={form.reasoning_effort} disabled={!form.provider} onChange={reasoning_effort => patch({ reasoning_effort })}><option value="">Provider default</option>{reasoningEfforts.map(value => <option key={value} value={value}>{value}</option>)}</Select></div>
    <div className="setting-row"><Toggle label="Include saved memory by default" description="Eligible reviewed memory may be selected in the context preview. Profile policy and current access can still exclude it." checked={form.include_memory} onChange={include_memory => patch({ include_memory })} /></div>
    <div className="setting-row"><Toggle label="Include conversation history by default" description="The exact bounded history is shown before sending. Turning this off does not delete saved messages." checked={form.include_chat} onChange={include_chat => patch({ include_chat })} /></div>
    <div className="setting-row"><Toggle label="Include workspace overview by default" description="Propose bounded, permission-filtered summaries of visible workspace structure. Full documents are never automatically ingested." checked={form.include_workspace} onChange={include_workspace => patch({ include_workspace })} /></div>
    <div className="setting-row"><Toggle label="Suggest native tools in new drafts" description="This records a preference only. It never enables a tool, grants authority, or skips the per-run review." checked={form.native_tools} onChange={native_tools => patch({ native_tools })} /></div>
    <div className="setting-row rumbo-agent-pack-setting"><span><strong>Default Context Packs</strong><small>Select saved packs to propose during context review. Their documents and memories remain permission-checked and are never silently included.</small></span><fieldset className="rumbo-agent-pack-list"><legend>Context Packs</legend>{packs.map(pack => <label key={pack.id}><input type="checkbox" checked={form.context_pack_ids.includes(pack.id)} onChange={() => patch({ context_pack_ids: form.context_pack_ids.includes(pack.id) ? form.context_pack_ids.filter(id => id !== pack.id) : [...form.context_pack_ids, pack.id] })} /><span>{pack.name}</span></label>)}{unavailablePacks.map(id => <label key={id}><input type="checkbox" checked onChange={() => patch({ context_pack_ids: form.context_pack_ids.filter(value => value !== id) })} /><span>Unavailable Context Pack · uncheck to remove</span></label>)}{!packs.length && !unavailablePacks.length ? <p>No accessible Context Packs in this workspace.</p> : null}</fieldset></div>
    <div className="setting-row"><span><strong>Related controls</strong><small>Full documents are not automatically ingested. Agent awareness, Context Packs, and tools keep their own bounded workspace permissions.</small></span><div className="rumbo-agent-setting-links"><Button type="button" onClick={() => navigate('settings', 'awareness')}>Agent awareness</Button><Button type="button" onClick={() => navigate('settings', 'context')}>Context Packs</Button><Button type="button" onClick={() => navigate('settings', 'permissions')}>Tools &amp; permissions</Button></div></div>
  </section><ErrorMessage error={error} /><footer className="form-submit-row"><Button type="submit" variant="primary" busy={busy} disabled={!dirty}>{form.onboarding_complete ? 'Save Talvori preferences' : 'Save setup'}</Button></footer></Form></>;
}

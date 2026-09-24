import { useEffect, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { rumboActions } from '../data/useRumbo.js';
import { Button, ErrorMessage, Field, useApp } from '../ui.jsx';
import { useUnsavedUpdate, requestUpdateNavigation } from './UnsavedUpdates.jsx';
import { AREA_READ_TOOLS, areaSettingsFields, areaSettingsPatch } from '../lib/areas.js';
import { agentReadiness } from '../lib/agents.js';
import './area-settings.css';

export function useAreaSettings(areaId) {
  const [state, setState] = useState({ value: null, loading: true, error: null });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ value: null, loading: true, error: null });
    apiRequest(`/api/areas/${encodeURIComponent(areaId)}/settings`, { signal: controller.signal })
      .then(({ result }) => setState({ value: result, loading: false, error: null }))
      .catch(error => { if (!controller.signal.aborted) setState({ value: null, loading: false, error }); });
    return () => controller.abort();
  }, [areaId, reload]);
  return { ...state, retry: () => setReload(value => value + 1), saved: value => setState({ value, loading: false, error: null }) };
}

export function AreaSettings({ area, state }) {
  if (state.loading) return <p role="status">Loading Area defaults…</p>;
  if (state.error) return <section><ErrorMessage error={state.error} /><Button onClick={state.retry}>Retry Area settings</Button></section>;
  if (!state.value) return null;
  return <AreaSettingsForm key={`${area.id}:${state.value.version}`} area={area} settings={state.value} onSaved={state.saved} onReload={state.retry} />;
}

function AreaSettingsForm({ area, settings, onSaved, onReload }) {
  const { data, navigate, notify } = useApp();
  const initial = areaSettingsFields(settings);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedUpdate(dirty, busy);
  const agents = (data.agents ?? []).filter(item => item.workspace_id === area.workspace_id && !item.archived_at);
  const packs = (data.workspace_items ?? []).filter(item => item.workspace_id === area.workspace_id && item.kind === 'context_pack' && !item.archived_at);
  const unavailableAgents = form.default_agent_ids.filter(id => !agents.some(agent => agent.id === id));
  const unavailablePacks = form.context_pack_ids.filter(id => !packs.some(pack => pack.id === id));
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const toggle = (key, id) => setForm(current => ({ ...current, [key]: current[key].includes(id) ? current[key].filter(value => value !== id) : [...current[key], id] }));
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const { result } = await apiRequest(`/api/areas/${encodeURIComponent(area.id)}/settings`, { method: 'PATCH', body: areaSettingsPatch(settings, form) });
      onSaved(result);
      await rumboActions.refresh();
      notify('Area defaults saved. No agent work was started.');
    } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  return <form className="area-settings" onSubmit={save}>
    <header><h2>Context and agent defaults</h2><p>Organize a domain of your work. These saved defaults do not grant access, start agents, or automatically include context in runs.</p></header>
    {settings.references_redacted ? <p role="note">Some defaults are outside your access. They are preserved; only an authorized user can change those lists.</p> : null}
    <Field label="Area instructions" hint="Guidance for reviewed context. Instructions are not authorization."><textarea rows={6} maxLength={20000} value={form.instructions} onChange={event => change('instructions', event.target.value)} placeholder="Purpose, constraints, and useful working conventions for this Area…" /></Field>
    <fieldset><legend>Default agent profiles</legend><p>Profiles share provider connections. This selection does not create accounts or launch work.</p>{agents.map(agent => {
      const readiness = agentReadiness(agent, data.connections?.find(connection => connection.provider === agent.provider));
      return <label className="area-choice" key={agent.id}><input type="checkbox" disabled={settings.references_redacted} checked={form.default_agent_ids.includes(agent.id)} onChange={() => toggle('default_agent_ids', agent.id)} /><span><strong>{agent.name}</strong><small>{agent.provider} · {readiness.label}</small></span></label>;
    })}{unavailableAgents.map(id => <label className="area-choice" key={id}><input type="checkbox" disabled={settings.references_redacted} checked onChange={() => toggle('default_agent_ids', id)} /><span>Unavailable profile · remove reference</span></label>)}{!agents.length ? <p>No accessible agent profiles in this workspace.</p> : null}<Button onClick={() => navigate('agents')}>Manage agents</Button></fieldset>
    <fieldset><legend>Reusable Context Packs</legend><p>Suggested references only. Contents must still be selected and approved for each run.</p>{packs.map(pack => <label className="area-choice" key={pack.id}><input type="checkbox" disabled={settings.references_redacted} checked={form.context_pack_ids.includes(pack.id)} onChange={() => toggle('context_pack_ids', pack.id)} /><span>{pack.name}</span></label>)}{unavailablePacks.map(id => <label className="area-choice" key={id}><input type="checkbox" disabled={settings.references_redacted} checked onChange={() => toggle('context_pack_ids', id)} /><span>Unavailable Context Pack · remove reference</span></label>)}{!packs.length ? <p>No accessible Context Packs in this workspace.</p> : null}<Button onClick={() => navigate('settings', 'context')}>Manage Context Packs</Button></fieldset>
    <fieldset><legend>Tool preferences</legend><p>Saved read-tool preferences for the future native tool surface, not executable grants. Every run still requires approved scope and server permission checks.</p>{AREA_READ_TOOLS.map(tool => <label className="area-choice" key={tool}><input type="checkbox" checked={form.allowed_tools.includes(tool)} onChange={() => toggle('allowed_tools', tool)} /><code>{tool}</code></label>)}<p>Permission policy: <strong>Review required</strong>. Area text cannot override this policy.</p></fieldset>
    <fieldset><legend>Optional Contacts</legend><label className="area-choice"><input type="checkbox" checked={form.contacts_enabled} onChange={event => change('contacts_enabled', event.target.checked)} /><span>Show Contacts in this Area</span></label><p>Rumbo works without a human team. Existing contacts remain accessible, including archived records. Contacts never grant account access.</p></fieldset>
    <ErrorMessage error={error} />{error?.status === 409 ? <Button onClick={() => requestUpdateNavigation(onReload)}>Load latest Area defaults</Button> : null}<footer><Button disabled={!dirty || busy} onClick={() => { setForm(initial); setError(null); }}>Reset changes</Button><Button type="submit" variant="primary" busy={busy} disabled={!dirty}>Save Area defaults</Button></footer>
  </form>;
}

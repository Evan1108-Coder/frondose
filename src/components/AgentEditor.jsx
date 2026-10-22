import { useEffect, useId, useRef, useState } from 'react';
import { Check } from './icons.jsx';
import { frondoseActions } from '../data/useFrondose.js';
import { apiRequest } from '../data/api.js';
import { isBrowserAiProvider } from '../lib/ai-providers.js';
import { API_PROVIDERS, validApiModel } from '../lib/ai-provider-catalog.js';
import { RUNNER_PROVIDER_CATALOG } from '../lib/runner-provider-catalog.js';
import { agentConnectionMethods, savedAgentConnectionMethod } from '../lib/agent-connection-methods.js';
import { Button, Dialog, ErrorMessage, Field, SearchField, Select, useApp, useAsync } from '../ui.jsx';
import { agentFormPayload, initialAgentForm, validateAgentForm } from '../lib/agent-editor.js';
import { val } from '../lib/model.js';
import { AgentIdentity } from './AgentIdentity.jsx';
import { Form } from './Form.jsx';
import { ImageField } from './ImageField.jsx';
import './agent-editor.css';

const ACCOUNT_PROVIDERS = [{ id: 'codex', label: 'Codex' }, { id: 'claude', label: 'Claude Code' }, { id: 'copilot', label: 'GitHub Copilot' }, ...API_PROVIDERS.map(item => ({ id: item.id, label: item.id === 'gemini' ? 'Google Gemini API / Gemini CLI' : item.name }))];
const PROVIDERS = [...ACCOUNT_PROVIDERS, ...RUNNER_PROVIDER_CATALOG.filter(item => !ACCOUNT_PROVIDERS.some(provider => provider.id === item.id)).map(item => ({ id: item.id, label: item.title }))];

export function AgentEditor({ item = null, defaults = {}, onClose }) {
  const { data, workspace, notify, navigate } = useApp();
  const [initial] = useState(() => initialAgentForm(item, defaults));
  const [form, setForm] = useState(initial);
  const [initialKind] = useState(() => val(item || defaults, 'identity_kind') === 'provider' ? 'provider' : 'agent');
  const [identityKind, setIdentityKind] = useState(initialKind);
  const [discarding, setDiscarding] = useState(false);
  const [validation, setValidation] = useState(null);
  const [providerQuery, setProviderQuery] = useState('');
  const [methodChoice, setMethodChoice] = useState(null);
  const [connectionMetadata, setConnectionMetadata] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [apiModels, setApiModels] = useState({}), [modelsLoading, setModelsLoading] = useState(false);
  const { busy, error, execute, setError } = useAsync();
  const providerGroup = useId();
  const formRef = useRef(null), keepEditingRef = useRef(null), beforeConfirmRef = useRef(null), destinationRef = useRef(null);
  const dirty = identityKind !== initialKind || JSON.stringify(initial) !== JSON.stringify(form);
  const scopedWorkspace = item ? val(item, 'workspace_id') : workspace?.id;
  const providerConnections = (data.connections ?? []).filter(connection => connection.provider === form.provider);
  const boundConnection = providerConnections.find(connection => connection.id === form.provider_connection_id);
  const methods = agentConnectionMethods(form.provider);
  const method = methodChoice?.provider === form.provider ? methodChoice.id : savedAgentConnectionMethod(form.provider, boundConnection, connectionMetadata?.[form.provider]) || methods[0]?.id;
  const connections = providerConnections.filter(connection => savedAgentConnectionMethod(form.provider, connection, connectionMetadata?.[form.provider]) === method);
  const providerLabel = PROVIDERS.find(provider => provider.id === form.provider)?.label || form.provider;
  const matchingProviders = PROVIDERS.filter(provider => `${provider.label} ${agentConnectionMethods(provider.id).map(route => route.label).join(' ')}`.toLowerCase().includes(providerQuery.trim().toLowerCase()));
  const defaultField = (name, label) => ({ 'data-field-default-key': `agent.new.${name}`, 'data-field-default-page': 'New agent', 'data-field-default-label': label, 'data-field-default-mode': item ? 'edit' : 'create' });

  useEffect(() => { if (discarding) keepEditingRef.current?.focus(); }, [discarding]);
  useEffect(() => {
    let active = true;
    setConnectionMetadata(null); setConnectionError(null);
    if (scopedWorkspace) apiRequest(`/api/ai-connections?workspace_id=${encodeURIComponent(scopedWorkspace)}`)
      .then(response => { if (active) setConnectionMetadata(response.result); })
      .catch(cause => { if (active) setConnectionError(cause); });
    return () => { active = false; };
  }, [scopedWorkspace]);

  function change(key, value) {
    setForm(current => ({ ...current, [key]: value, ...(key === 'provider' ? { provider_connection_id: '', reasoning_effort: '' } : {}) }));
    setValidation(null); setError(null);
  }
  function close() {
    const destination = destinationRef.current;
    onClose();
    if (destination) navigate('connections', destination);
  }
  function requestClose() {
    if (busy) return;
    if (discarding) { continueEditing(); return; }
    if (!dirty) { close(); return; }
    beforeConfirmRef.current = document.activeElement;
    setDiscarding(true);
  }
  function continueEditing() {
    destinationRef.current = null;
    setDiscarding(false);
    requestAnimationFrame(() => {
      const previous = beforeConfirmRef.current;
      if (previous?.isConnected) previous.focus();
      else formRef.current?.querySelector('[name="name"]')?.focus();
    });
  }
  async function loadModels() {
    const provider = form.provider;
    setModelsLoading(true); setError(null);
    try {
      const response = await apiRequest(`/api/ai-connections/${provider}/models?workspace_id=${encodeURIComponent(scopedWorkspace)}`);
      setApiModels(current => ({ ...current, [provider]: response.result.filter(model => validApiModel(model.id) && (!model.output_modalities?.length || model.output_modalities.includes('text'))) }));
    } catch (cause) { setError(cause); } finally { setModelsLoading(false); }
  }
  async function submit(event) {
    event.preventDefault();
    const submittedForm = identityKind === 'provider' ? { ...form, name: providerLabel, image_url: null, description: '', instructions: '', role: '' } : form;
    const invalid = validateAgentForm(submittedForm);
    if (invalid) {
      setValidation(invalid);
      formRef.current?.querySelector(`[name="${invalid.field === 'provider' ? providerGroup : invalid.field}"]`)?.focus();
      return;
    }
    await execute(async () => {
      const input = { ...agentFormPayload(submittedForm, item, workspace?.id), identity_kind: identityKind };
      const result = item ? await frondoseActions.updateAgent(item.id, input) : await frondoseActions.createAgent(input);
      notify(`${input.name} ${item ? 'saved' : 'created'}`);
      onClose(); navigate('agents', result?.id ?? item?.id);
    });
  }

  return <Dialog className="agent-editor" title={discarding ? 'Discard your changes?' : item ? identityKind === 'provider' ? 'Edit AI provider' : 'Edit agent' : identityKind === 'provider' ? 'Connect AI provider' : 'New agent'} subtitle={discarding ? 'Your changes have not been saved.' : undefined} onClose={requestClose}>
    {discarding ? <div className="agent-discard-confirmation"><p>You can keep editing or close this profile without saving.</p><div className="agent-confirm-actions"><Button onClick={close}>Discard changes</Button><Button ref={keepEditingRef} variant="primary" onClick={continueEditing}>Keep editing</Button></div></div> : <Form ref={formRef} onSubmit={submit} className="agent-editor-form">
      <div className="agent-editor-fields">
        {!item ? <div className="agent-confirm-actions" role="group" aria-label="Identity type"><Button aria-pressed={identityKind === 'agent'} disabled={busy} onClick={() => { setIdentityKind('agent'); setValidation(null); }}>Create agent</Button><Button aria-pressed={identityKind === 'provider'} disabled={busy} onClick={() => { setIdentityKind('provider'); setValidation(null); }}>Connect AI provider</Button></div> : null}
        {identityKind === 'agent' ? <>
          <Field label="Name"><input {...defaultField('name', 'Name')} autoFocus name="name" required maxLength={200} value={form.name} onChange={event => change('name', event.target.value)} placeholder="Agent name" disabled={busy} aria-invalid={validation?.field === 'name' || undefined} /></Field>
          <Field label="Description"><input {...defaultField('description', 'Description')} name="description" maxLength={1000} value={form.description} onChange={event => change('description', event.target.value)} placeholder="A short description" disabled={busy} /></Field>
        </> : null}
        <fieldset className="agent-provider-field" disabled={busy || Boolean(item && identityKind === 'provider')}>
          <legend>Provider</legend><SearchField label="Search agent providers" value={providerQuery} onChange={setProviderQuery} placeholder="Search providers…" />
          <div className="agent-provider-grid">{matchingProviders.map(provider => <label className={`agent-provider-option ${form.provider === provider.id ? 'is-selected' : ''}`} key={provider.id}>
            <input type="radio" name={providerGroup} value={provider.id} checked={form.provider === provider.id} onChange={() => { setMethodChoice(null); change('provider', provider.id); }} />
            <AgentIdentity provider={provider.id} compact /><span>{provider.label}</span><span className="agent-provider-indicator" aria-hidden="true">{form.provider === provider.id ? <Check /> : null}</span>
          </label>)}</div>{!matchingProviders.length ? <p>No providers match.</p> : null}
        </fieldset>
        <Select label="Connection method" name="connection_method" value={method || ''} disabled={busy || methods.length < 2} onChange={id => { setMethodChoice({ provider: form.provider, id }); change('provider_connection_id', ''); }}>{methods.map(route => <option key={route.id} value={route.id}>{route.label}</option>)}</Select>
        <Select label={method === 'computer' ? 'Local account' : 'Account connection'} name="provider_connection_id" value={form.provider_connection_id} disabled={busy} onChange={value => change('provider_connection_id', value)}>
          <option value="">Not connected</option>{form.provider_connection_id && !connections.some(connection => connection.id === form.provider_connection_id) ? <option value={form.provider_connection_id}>Saved connection — unavailable for this method</option> : null}
          {connections.map(connection => <option key={connection.id} value={connection.id}>{val(connection, 'account_label') || providerLabel} · {(connection.workspace_states?.[scopedWorkspace] || connection.state)?.replaceAll('_', ' ') || 'state unknown'}</option>)}
        </Select>
        <Button variant="ghost" disabled={busy} onClick={() => { destinationRef.current = form.provider; requestClose(); }}>Connect / manage {method === 'computer' ? 'computer' : 'account'}</Button>
        <ErrorMessage error={connectionError} />
        {isBrowserAiProvider(form.provider) && form.provider_connection_id ? <div className="agent-api-model"><Select label="Chat model" name="model" value={form.model} disabled={busy || modelsLoading} onChange={value => change('model', value)}><option value="">Choose a model</option>{(apiModels[form.provider] || []).map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}{form.model && !(apiModels[form.provider] || []).some(model => model.id === form.model) ? <option value={form.model}>{form.model} · configured</option> : null}</Select><Button variant="ghost" busy={modelsLoading} disabled={busy || modelsLoading || !scopedWorkspace} onClick={loadModels}>Load models</Button></div> : null}
        {identityKind === 'agent' ? <><ImageField label="Agent picture" value={form.image_url} onChange={value => change('image_url', value)} disabled={busy} /><Field label="Personalization"><textarea {...defaultField('instructions', 'Personalization')} name="instructions" rows={4} maxLength={100000} value={form.instructions} onChange={event => change('instructions', event.target.value)} placeholder="How should this agent work?" disabled={busy} /></Field></> : null}
        <ErrorMessage error={validation?.message ?? error} />
      </div>
      <footer className="agent-editor-footer"><div className="agent-editor-actions"><Button disabled={busy} onClick={requestClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>{item ? 'Save changes' : identityKind === 'provider' ? 'Add provider' : 'Create agent'}</Button></div></footer>
    </Form>}
  </Dialog>;
}

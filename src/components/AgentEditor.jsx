import { useEffect, useId, useRef, useState } from "react";
import { Check, FileText, Hammer, Info, Search } from "./icons.jsx";
import { talvoriActions } from "../data/useTalvori.js";
import { apiRequest } from '../data/api.js';
import { isBrowserAiProvider } from '../lib/ai-providers.js';
import { API_PROVIDERS, validApiModel } from '../lib/ai-provider-catalog.js';
import { Button, Dialog, ErrorMessage, Field, Select, useApp, useAsync } from "../ui.jsx";
import { AGENT_PRESETS, AGENT_REASONING_OPTIONS, agentDefaultChoices, agentFormPayload, applyAgentPreset, hasAgentText, initialAgentForm, validateAgentForm } from "../lib/agent-editor.js";
import { val } from "../lib/model.js";
import { AgentIdentity } from "./AgentIdentity.jsx";
import { Form } from "./Form.jsx";
import { ImageField } from './ImageField.jsx';
import "./agent-editor.css";

const PRESET_ICONS = { build: Hammer, review: FileText, research: Search };
const PROVIDERS = [{ id: "codex", label: "Codex" }, { id: "claude", label: "Claude Code" }, { id: 'copilot', label: 'GitHub Copilot' }, ...API_PROVIDERS.map(item => ({ id: item.id, label: item.name }))];

export function AgentEditor({ item = null, defaults = {}, onClose }) {
  const { data, workspace, notify, navigate } = useApp();
  const [initial] = useState(() => initialAgentForm(item, defaults));
  const [form, setForm] = useState(initial);
  const [pendingPreset, setPendingPreset] = useState(null);
  const [discarding, setDiscarding] = useState(false);
  const [validation, setValidation] = useState(null);
  const [apiModels, setApiModels] = useState({}), [modelsLoading, setModelsLoading] = useState(false);
  const { busy, error, execute, setError } = useAsync();
  const providerGroup = useId();
  const formRef = useRef(null);
  const keepEditingRef = useRef(null);
  const presetCancelRef = useRef(null);
  const beforeConfirmRef = useRef(null);
  const dirty = JSON.stringify(initial) !== JSON.stringify(form);
  const scopedWorkspace = item ? val(item, "workspace_id") : workspace?.id;
  const choices = agentDefaultChoices(data, scopedWorkspace, form.default_area_id);
  const connections = (data.connections ?? []).filter(connection => connection.provider === form.provider);
  const defaultField = (name, label) => ({ 'data-field-default-key': `agent.new.${name}`, 'data-field-default-page': 'New agent', 'data-field-default-label': label, 'data-field-default-mode': item ? 'edit' : 'create' });

  useEffect(() => {
    if (discarding) keepEditingRef.current?.focus();
    else if (pendingPreset) presetCancelRef.current?.focus();
  }, [discarding, pendingPreset]);

  function change(key, value) {
    setForm((current) => ({ ...current, [key]: value, ...(key === "provider" ? { provider_connection_id: "", reasoning_effort: "" } : {}), ...(key === "default_area_id" && current.default_project_id && !agentDefaultChoices(data, scopedWorkspace, value).projects.some(project => project.id === current.default_project_id) ? { default_project_id: "" } : {}) }));
    setValidation(null);
    setError(null);
  }

  function requestClose() {
    if (busy) return;
    if (discarding) { continueEditing(); return; }
    if (pendingPreset) { setPendingPreset(null); return; }
    if (!dirty) { onClose(); return; }
    beforeConfirmRef.current = document.activeElement;
    setPendingPreset(null);
    setDiscarding(true);
  }

  function continueEditing() {
    setDiscarding(false);
    requestAnimationFrame(() => {
      const previous = beforeConfirmRef.current;
      if (previous?.isConnected) previous.focus();
      else formRef.current?.querySelector('[name="name"]')?.focus();
    });
  }

  function choosePreset(preset) {
    if (hasAgentText(form)) { setPendingPreset(preset); return; }
    setForm((current) => applyAgentPreset(current, preset));
    setValidation(null);
    setError(null);
  }

  function applyPreset() {
    setForm((current) => applyAgentPreset(current, pendingPreset));
    setPendingPreset(null);
    setValidation(null);
    setError(null);
    requestAnimationFrame(() => formRef.current?.querySelector('[name="name"]')?.focus());
  }

  async function submit(event) {
    event.preventDefault();
    const invalid = validateAgentForm(form);
    if (invalid) {
      setValidation(invalid);
      formRef.current?.querySelector(`[name="${invalid.field === "provider" ? providerGroup : invalid.field}"]`)?.focus();
      return;
    }
    await execute(async () => {
      const input = agentFormPayload(form, item, workspace?.id);
      const result = item
        ? await talvoriActions.updateAgent(item.id, input)
        : await talvoriActions.createAgent(input);
      notify(`${input.name} ${item ? "saved" : "created"}`);
      onClose();
      navigate("agents", result?.id ?? item?.id);
    });
  }

  return (
    <Dialog
      className="agent-editor"
      title={discarding ? "Discard your changes?" : item ? "Edit agent" : "New agent"}
      subtitle={discarding ? "Your changes have not been saved." : "An agent is a profile, not another provider account. Multiple profiles can share one connection."}
      onClose={requestClose}
    >
      {discarding ? (
        <div className="agent-discard-confirmation">
          <p>You can keep editing or close this profile without saving.</p>
          <div className="agent-confirm-actions">
            <Button onClick={onClose}>Discard changes</Button>
            <Button ref={keepEditingRef} variant="primary" onClick={continueEditing}>Keep editing</Button>
          </div>
        </div>
      ) : (
        <Form ref={formRef} onSubmit={submit} className="agent-editor-form">
          <div className="agent-editor-fields">
            {!item ? (
              <section className="agent-presets" aria-labelledby={`${providerGroup}-purpose`}>
                <h3 id={`${providerGroup}-purpose`}>Start with a purpose <span>Optional</span></h3>
                <div className="agent-preset-grid">
                  {AGENT_PRESETS.map((preset) => {
                    const Icon = PRESET_ICONS[preset.id];
                    return <Button key={preset.id} icon={Icon} disabled={busy || !!pendingPreset} onClick={() => choosePreset(preset)}>{preset.label}</Button>;
                  })}
                </div>
                {pendingPreset ? (
                  <div className="agent-preset-confirmation" role="group" aria-label="Replace current text?">
                    <div><strong>Replace current text?</strong><p>The {pendingPreset.label.toLowerCase()} preset replaces the name, description, and instructions. Your provider and folder stay the same.</p></div>
                    <div className="agent-confirm-actions">
                      <Button ref={presetCancelRef} onClick={() => setPendingPreset(null)}>Cancel</Button>
                      <Button onClick={applyPreset}>Apply preset</Button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <fieldset className="agent-provider-field" disabled={busy}>
              <legend>Provider</legend>
              <div className="agent-provider-grid">
                {PROVIDERS.map((provider) => (
                  <label className={`agent-provider-option ${form.provider === provider.id ? "is-selected" : ""}`} key={provider.id}>
                    <input type="radio" name={providerGroup} value={provider.id} checked={form.provider === provider.id} onChange={() => change("provider", provider.id)} />
                    <AgentIdentity provider={provider.id} compact />
                    <span>{provider.label}</span>
                    <span className="agent-provider-indicator" aria-hidden="true">{form.provider === provider.id ? <Check /> : null}</span>
                  </label>
                ))}
              </div>
              <p className="agent-provider-help">{form.provider === "claude" ? "Claude Code can read and search in this release. Project editing is not supported yet." : form.provider === "codex" ? "Codex supports read-only or project-edit access. Choose permissions before each session." : form.provider === 'copilot' ? 'Copilot uses your private local ACP account. General chat and reviewed Talvori actions are supported; native/file tools are disabled.' : "Browser AI connections support conversations and reviewed Talvori actions. Select an explicit chat model; your connected account’s credits apply."}</p>
            </fieldset>

            <Select label="Shared provider connection" name="provider_connection_id" value={form.provider_connection_id} disabled={busy} onChange={value => change("provider_connection_id", value)}>
              <option value="">Not bound — choose a connection for live work</option>
              {form.provider_connection_id && !connections.some(connection => connection.id === form.provider_connection_id) ? <option value={form.provider_connection_id}>Unavailable connection — replace before running</option> : null}
              {connections.map(connection => <option key={connection.id} value={connection.id}>{val(connection, "account_label") || PROVIDERS.find(provider => provider.id === form.provider)?.label} · {(connection.workspace_states?.[scopedWorkspace] || connection.state)?.replaceAll("_", " ") || "state unknown"}</option>)}
            </Select>
            <p className="agent-editor-future-note">Profiles share their connected account’s credentials and usage limits. Talvori does not import ordinary ChatGPT or Claude chat history.</p>

            <Field label="Name">
              <input {...defaultField('name', 'Name')} autoFocus name="name" required maxLength={200} value={form.name} onChange={(event) => change("name", event.target.value)} placeholder="e.g. Code reviewer" disabled={busy} aria-invalid={validation?.field === "name" || undefined} />
            </Field>
            <ImageField label="Agent picture" value={form.image_url} onChange={value => change('image_url', value)} disabled={busy} />
            <Field label="Description">
              <input {...defaultField('description', 'Description')} name="description" maxLength={1000} value={form.description} onChange={(event) => change("description", event.target.value)} placeholder="A short description of what this agent does" disabled={busy} />
            </Field>
            <Field label="Role" hint="A short responsibility, separate from the profile name."><input {...defaultField('role', 'Role')} name="role" maxLength={200} value={form.role} onChange={event => change("role", event.target.value)} placeholder="For example: implementation reviewer" disabled={busy} /></Field>
            <Field label="Instructions" hint="Applied to this agent's sessions. Permissions are chosen before each run.">
              <textarea {...defaultField('instructions', 'Instructions')} name="instructions" rows={4} maxLength={100000} value={form.instructions} onChange={(event) => change("instructions", event.target.value)} placeholder="Describe how this agent should work, what to focus on, and how to report results." disabled={busy} />
            </Field>
            <Field label="Default working folder" hint="Optional. A linked project folder takes precedence. Talvori checks the folder when a session starts.">
              <input {...defaultField('folder', 'Default working folder')} name="working_directory" value={form.working_directory} maxLength={2000} spellCheck={false} onChange={(event) => change("working_directory", event.target.value)} placeholder="/Users/you/Projects/example" disabled={busy} aria-invalid={validation?.field === "working_directory" || undefined} />
            </Field>
            <section className="agent-editor-section" aria-label="Execution defaults"><h3>Execution defaults</h3>
              {isBrowserAiProvider(form.provider) ? <div className="agent-api-model"><Field label="Chat model"><Select aria-label="Chat model" value={form.model} disabled={busy || modelsLoading} onChange={value => change('model', value)}><option value="">Choose a model</option>{(apiModels[form.provider] || []).map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}{form.model && !(apiModels[form.provider] || []).some(model => model.id === form.model) ? <option value={form.model}>{form.model} · configured</option> : null}</Select></Field><Button variant="ghost" busy={modelsLoading} disabled={busy || modelsLoading} onClick={async () => { setModelsLoading(true); setError(null); try { const response = await apiRequest(`/api/ai-connections/${form.provider}/models?workspace_id=${encodeURIComponent(scopedWorkspace)}`); setApiModels(current => ({ ...current, [form.provider]: response.result.filter(model => validApiModel(model.id) && (!model.output_modalities?.length || model.output_modalities.includes('text'))) })); } catch (cause) { setError(cause); } finally { setModelsLoading(false); } }}>Load models from account</Button></div> : <Field label="Model identifier" hint="Optional provider identifier. Talvori does not verify model availability here; the connected provider can reject an unsupported model."><input {...defaultField('model', 'Model identifier')} name="model" maxLength={120} value={form.model} onChange={event => change("model", event.target.value)} placeholder="Provider default" disabled={busy} spellCheck={false} /></Field>}
              {form.provider === "codex" ? <Select label="Reasoning effort" name="reasoning_effort" value={form.reasoning_effort} disabled={busy} onChange={value => change("reasoning_effort", value)}><option value="">Provider default</option>{AGENT_REASONING_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}</Select> : <p>Reasoning-effort selection is only available for Codex in Talvori.</p>}
              <p>Model and reasoning support depend on your installed provider client and selected model. Saving does not test your account.</p>
              <Select label="Permission policy" name="permission_policy" value={form.permission_policy} disabled={busy} onChange={value => change("permission_policy", value)}><option value="review">Review required — no automatic write approval</option><option value="read-only">Read-only — do not request project edits</option></Select>
              <Field label="Expected output behavior" hint="Describe the format, evidence, stopping condition, and what must be reviewed. Instructions never grant permissions."><textarea {...defaultField('output-behavior', 'Expected output behavior')} name="output_behavior" rows={3} maxLength={10000} value={form.output_behavior} disabled={busy} onChange={event => change("output_behavior", event.target.value)} placeholder="Return findings with evidence, unresolved questions, and a reviewable output." /></Field>
            </section>
            <section className="agent-editor-section" aria-label="Context preferences"><h3>Context preferences</h3><p>Context Inspector resolves configured Context Packs and Area instructions from currently accessible sources at preview and launch. These defaults are not access grants. Review included, excluded, and truncated content before a run.</p>
              <Select label="Memory policy" name="memory_policy" value={form.memory_policy} disabled={busy} onChange={value => change("memory_policy", value)}><option value="reviewed">Eligible reviewed memory only</option><option value="none">Do not include saved agent memory</option></Select>
              {scopedWorkspace ? <>
                <Select label="Default Area" name="default_area_id" value={form.default_area_id} disabled={busy} onChange={value => change("default_area_id", value)}><option value="">No default Area</option>{form.default_area_id && !choices.areas.some(area => area.id === form.default_area_id) ? <option value={form.default_area_id}>Unavailable Area — remove or replace</option> : null}{choices.areas.map(area => <option value={area.id} key={area.id}>{area.name}</option>)}</Select>
                <Select label="Default project" name="default_project_id" value={form.default_project_id} disabled={busy} onChange={value => change("default_project_id", value)}><option value="">No default project</option>{form.default_project_id && !choices.projects.some(project => project.id === form.default_project_id) ? <option value={form.default_project_id}>Unavailable project — remove or replace</option> : null}{choices.projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</Select>
                <fieldset className="agent-pack-field" disabled={busy}><legend>Context Pack preferences</legend>{choices.packs.map(pack => <label key={pack.id}><input type="checkbox" checked={form.context_source_ids.includes(pack.id)} onChange={() => change("context_source_ids", form.context_source_ids.includes(pack.id) ? form.context_source_ids.filter(id => id !== pack.id) : [...form.context_source_ids, pack.id])} /><span>{pack.name}</span></label>)}{form.context_source_ids.filter(id => !choices.packs.some(pack => pack.id === id)).map(id => <label key={id}><input type="checkbox" checked onChange={() => change("context_source_ids", form.context_source_ids.filter(value => value !== id))} /><span>Unavailable Context Pack — uncheck to remove</span></label>)}{!choices.packs.length ? <p>No accessible Context Packs in this workspace.</p> : null}</fieldset>
              </> : <p>This shared profile cannot keep workspace-specific Area, project, or Context Pack references.</p>}
            </section>
            {item?.version ? <p className="agent-editor-future-note">Editing profile version {item.version}. Saving profile changes creates a new version; completed runs keep their recorded profile version.</p> : null}
            {item ? <p className="agent-editor-future-note">{!item.workspace_id && !item.workspaceId ? "This profile is shared across workspaces. " : ""}Changes apply to future sessions. Sessions already running keep their current configuration.</p> : null}
            <ErrorMessage error={validation?.message ?? error} />
          </div>
          <footer className="agent-editor-footer">
            <p><Info aria-hidden="true" /><span>Saving a profile does not connect an account or start a session.</span></p>
            <div className="agent-editor-actions">
              <Button disabled={busy} onClick={requestClose}>Cancel</Button>
              <Button type="submit" variant="primary" busy={busy} disabled={!!pendingPreset}>{item ? "Save changes" : "Create agent"}</Button>
            </div>
          </footer>
        </Form>
      )}
    </Dialog>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { Check, FileText, Hammer, Info, Search } from "./icons.jsx";
import { rumboActions } from "../data/useRumbo.js";
import { Button, Dialog, ErrorMessage, Field, useApp, useAsync } from "../ui.jsx";
import { AGENT_PRESETS, agentFormPayload, applyAgentPreset, hasAgentText, initialAgentForm, validateAgentForm } from "../lib/agent-editor.js";
import { AgentIdentity } from "./AgentIdentity.jsx";
import { Form } from "./Form.jsx";
import "./agent-editor.css";

const PRESET_ICONS = { build: Hammer, review: FileText, research: Search };
const PROVIDERS = [{ id: "codex", label: "Codex" }, { id: "claude", label: "Claude" }];

export function AgentEditor({ item = null, defaults = {}, onClose }) {
  const { workspace, notify, navigate } = useApp();
  const [initial] = useState(() => initialAgentForm(item, defaults));
  const [form, setForm] = useState(initial);
  const [pendingPreset, setPendingPreset] = useState(null);
  const [discarding, setDiscarding] = useState(false);
  const [validation, setValidation] = useState(null);
  const { busy, error, execute, setError } = useAsync();
  const providerGroup = useId();
  const formRef = useRef(null);
  const keepEditingRef = useRef(null);
  const presetCancelRef = useRef(null);
  const beforeConfirmRef = useRef(null);
  const dirty = Object.keys(initial).some((key) => initial[key] !== form[key]);

  useEffect(() => {
    if (discarding) keepEditingRef.current?.focus();
    else if (pendingPreset) presetCancelRef.current?.focus();
  }, [discarding, pendingPreset]);

  function change(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
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
        ? await rumboActions.updateAgent(item.id, input)
        : await rumboActions.createAgent(input);
      notify(`${input.name} ${item ? "saved" : "created"}`);
      onClose();
      navigate("agents", result?.id ?? item?.id);
    });
  }

  return (
    <Dialog
      className="agent-editor"
      title={discarding ? "Discard your changes?" : item ? "Edit agent" : "New agent"}
      subtitle={discarding ? "Your changes have not been saved." : "Give an agent a purpose. Connect its account when you're ready."}
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
              <p className="agent-provider-help">{form.provider === "claude" ? "Claude can read and search in this release. Project editing is not supported yet." : form.provider === "codex" ? "Codex supports read-only or project-edit access. Choose permissions before each session." : "Choose a supported provider to use this agent in Rumbo."}</p>
            </fieldset>

            <Field label="Name">
              <input autoFocus name="name" required maxLength={200} value={form.name} onChange={(event) => change("name", event.target.value)} placeholder="e.g. Code reviewer" disabled={busy} aria-invalid={validation?.field === "name" || undefined} />
            </Field>
            <Field label="Description">
              <input name="description" maxLength={1000} value={form.description} onChange={(event) => change("description", event.target.value)} placeholder="A short description of what this agent does" disabled={busy} />
            </Field>
            <Field label="Instructions" hint="Applied to this agent's sessions. Permissions are chosen before each run.">
              <textarea name="instructions" rows={4} maxLength={100000} value={form.instructions} onChange={(event) => change("instructions", event.target.value)} placeholder="Describe how this agent should work, what to focus on, and how to report results." disabled={busy} />
            </Field>
            <Field label="Default working folder" hint="Optional. A linked project folder takes precedence. Rumbo checks the folder when a session starts.">
              <input name="working_directory" value={form.working_directory} maxLength={2000} spellCheck={false} onChange={(event) => change("working_directory", event.target.value)} placeholder="/Users/you/Projects/example" disabled={busy} aria-invalid={validation?.field === "working_directory" || undefined} />
            </Field>
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

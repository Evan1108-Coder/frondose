import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "./icons.jsx";
import { frondoseActions } from "../data/useFrondose.js";
import { Button, Dialog, ErrorMessage, Field, Select, useApp, useAsync } from "../ui.jsx";
import { Form } from "./Form.jsx";
import { DateField } from "./DateField.jsx";
import { DocumentContent } from "./DocumentContent.jsx";
import { MILESTONE_STATUSES } from "../lib/workspace-spaces.js";
import "../views/workspace-spaces.css";
import { TeamAppearanceFields } from './TeamAppearance.jsx';
import { teamAppearance } from '../lib/team-appearance.js';

const ENTITY = {
  team: { label: "Area", action: "Team" },
  teamMember: { label: "contact", action: "TeamMember" },
  document: { label: "document", action: "Document" },
  milestone: { label: "milestone", action: "Milestone" },
};

export function WorkspaceEditor({ kind, item = null, defaults = {}, onClose, onSaved }) {
  const { workspace, notify, navigate } = useApp();
  const entity = ENTITY[kind];
  const [initial] = useState(() => {
    const base = item ?? defaults;
    return { title: base.title ?? base.name ?? "", description: base.description ?? "", content: base.content ?? "", email: base.email ?? "", role: base.role ?? "", status: base.status ?? "planned", target_date: base.target_date ?? "", ...teamAppearance(base) };
  });
  const [form, setForm] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const keepRef = useRef(null);
  const { busy, error, execute, setError } = useAsync();
  const dirty = Object.keys(initial).some((key) => form[key] !== initial[key]);
  const defaultPage = { team: 'New Area', document: 'New document', milestone: 'New milestone' }[kind];
  const defaultKey = { team: 'area', document: 'document', milestone: 'milestone' }[kind];
  const defaultField = (key, label) => defaultPage ? { 'data-field-default-key': `${defaultKey}.new.${key}`, 'data-field-default-page': defaultPage, 'data-field-default-label': label, 'data-field-default-mode': item ? 'edit' : 'create' } : {};
  useEffect(() => { if (discarding) keepRef.current?.focus(); }, [discarding]);
  function change(key, value) { setForm((current) => ({ ...current, [key]: value })); setError(null); }
  function close() { if (!busy) { if (discarding) setDiscarding(false); else if (dirty) setDiscarding(true); else onClose(); } }
  async function submit(event) {
    event.preventDefault();
    await execute(async () => {
      if (!form.title.trim()) throw new Error("Please enter a name or title.");
      let input = { workspace_id: workspace?.id };
      if (kind === "team") input = { ...input, name: form.title.trim(), description: form.description, ...teamAppearance(form) };
      if (kind === "teamMember") input = { ...input, team_id: item?.team_id ?? defaults.team_id, name: form.title.trim(), email: form.email.trim() || null, role: form.role.trim() };
      if (kind === "document") input = { ...input, team_id: item?.team_id ?? defaults.team_id ?? null, project_id: item?.project_id ?? defaults.project_id ?? null, title: form.title.trim(), content: form.content };
      if (kind === "milestone") input = { ...input, project_id: item?.project_id ?? defaults.project_id, title: form.title.trim(), description: form.description, status: form.status, target_date: form.target_date || null };
      const result = item ? await frondoseActions[`update${entity.action}`](item.id, input) : await frondoseActions[`create${entity.action}`](input);
      notify(`${entity.label[0].toUpperCase()}${entity.label.slice(1)} ${item ? "saved" : "created"}`);
      onClose();
      onSaved?.(result);
      if (kind === "team" && !item && result?.id) navigate("teams", result.id);
    });
  }
  return <Dialog className={`space-editor ${kind === "document" ? "document-editor" : ""}`} wide={kind === "document"} title={discarding ? "Discard your changes?" : `${item ? "Edit" : "New"} ${entity.label}`} subtitle={discarding ? "Your changes have not been saved." : kind === "teamMember" ? "Directory entry only. No invitation or account access is created." : kind === "document" ? "Keep decisions, plans, and working knowledge in this space." : workspace?.name} onClose={close}>
    {discarding ? <div className="space-discard"><p>Keep editing, or close without saving these changes.</p><div className="space-editor-actions"><Button onClick={onClose}>Discard changes</Button><Button variant="primary" ref={keepRef} onClick={() => setDiscarding(false)}>Keep editing</Button></div></div> : <Form onSubmit={submit} className="entity-form">
      <div className="form-fields">
        {kind === 'team' ? <TeamAppearanceFields value={form} onChange={patch => setForm(current => ({ ...current, ...patch }))} /> : null}
        <Field label={["team", "teamMember"].includes(kind) ? "Name" : "Title"}><input {...defaultField(kind === 'team' ? 'name' : 'title', kind === 'team' ? 'Name' : 'Title')} autoFocus required maxLength={200} value={form.title} onChange={(event) => change("title", event.target.value)} placeholder={{ team: "e.g. Product", teamMember: "Full name", document: "Name this document", milestone: "A meaningful checkpoint" }[kind]} /></Field>
        {["team", "milestone"].includes(kind) ? <Field label="Description"><textarea {...defaultField('description', 'Description')} rows={4} value={form.description} onChange={(event) => change("description", event.target.value)} placeholder={kind === "team" ? "What does this Area work on?" : "What should be true when this is complete?"} /></Field> : null}
        {kind === "teamMember" ? <><Field label="Role"><input value={form.role} maxLength={200} onChange={(event) => change("role", event.target.value)} placeholder="e.g. Product lead" /></Field><Field label="Email" hint="Optional contact information. Frondose will not send an email."><input type="email" value={form.email} onChange={(event) => change("email", event.target.value)} placeholder="name@example.com" /></Field></> : null}
        {kind === "milestone" ? <div className="form-grid"><Select label="Status" value={form.status} onChange={(value) => change("status", value)}>{Object.entries(MILESTONE_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><Field label="Target date"><DateField {...defaultField('target-date', 'Target date')} data-field-default-allow="true" value={form.target_date} onChange={(value) => change("target_date", value)} /></Field></div> : null}
        {kind === "document" ? <div className="document-writing"><div className="document-write-toolbar"><div className="segmented"><button type="button" className={!preview ? "active" : ""} aria-pressed={!preview} onClick={() => setPreview(false)}>Write</button><button type="button" className={preview ? "active" : ""} aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button></div><span>Markdown supported</span></div>{preview ? <div className="document-preview">{form.content.trim() ? <DocumentContent content={form.content} /> : <p className="muted">Your document preview will appear here.</p>}</div> : <Field label="Content"><textarea {...defaultField('content', 'Content')} className="document-input" rows={14} value={form.content} onChange={(event) => change("content", event.target.value)} placeholder={"# The plan\n\nWrite your decisions, guidelines, and next steps…"} /></Field>}<span className="document-word-count">{form.content.trim() ? form.content.trim().split(/\s+/).length : 0} words</span></div> : null}
        <ErrorMessage error={error} />
      </div><footer className="dialog-footer"><Button disabled={busy} onClick={close}>Cancel</Button><Button type="submit" variant="primary" icon={item ? Check : Plus} busy={busy} disabled={!form.title.trim()}>{item ? "Save changes" : `Create ${entity.label}`}</Button></footer>
    </Form>}
  </Dialog>;
}

export function SpaceArchiveDialog({ kind, item, onClose, onArchived }) {
  const { notify } = useApp();
  const { busy, error, execute } = useAsync();
  const entity = ENTITY[kind];
  async function archive() {
    await execute(async () => {
      await frondoseActions[`update${entity.action}`](item.id, { archived_at: new Date().toISOString() });
      notify(`${entity.label[0].toUpperCase()}${entity.label.slice(1)} archived`, "success", () => frondoseActions[`update${entity.action}`](item.id, { archived_at: null }));
      onClose(); onArchived?.();
    });
  }
  return <Dialog title={`Archive ${entity.label}?`} subtitle={item.title ?? item.name} onClose={() => { if (!busy) onClose(); }}><div className="space-discard"><p>{kind === "team" ? "The Area will leave your active list. Its projects, routes, documents, and people are kept. You can restore the Area from the archived Areas view." : "This item will leave the active list. Its content stays on this computer, and you can restore it from the archived view."}</p><ErrorMessage error={error} /><div className="space-editor-actions"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" busy={busy} onClick={archive}>Archive {entity.label}</Button></div></div></Dialog>;
}

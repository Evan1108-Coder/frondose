import { useEffect, useMemo, useState } from 'react';
import {
  FIELD_DEFAULTS_EVENT, normalizeFieldDefinition, readFieldDefaults,
  readFieldInventory, registerFieldDefinition, saveFieldDefaults, updateFieldEntry, validFieldDefaultValue,
} from '../../lib/field-defaults.js';
import './field-defaults-settings.css';

const blank = () => ({ enabled: true, primaryId: null, values: [] });

function nextSlot(values) {
  for (let slot = 1; slot <= 9; slot += 1) if (!values.some(value => value.slot === slot)) return slot;
  return null;
}

function FieldEditor({ workspaceId, definition, entry, onSaveResult }) {
  const values = entry?.values ?? [];
  const enabled = entry?.enabled !== false;
  const update = patch => { onSaveResult(Boolean(updateFieldEntry(workspaceId, definition.key, patch))); };
  const updateValue = (id, patch) => update({ values: values.map(value => value.id === id ? { ...value, ...patch } : value) });
  const add = () => {
    const slot = nextSlot(values);
    if (!slot) return;
    const id = globalThis.crypto?.randomUUID?.() || `value-${Date.now()}-${slot}`;
    update({ values: [...values, { id, name: `Value ${slot}`, value: '', slot, enabled: true }], primaryId: entry?.primaryId || id });
  };
  const remove = id => {
    const remaining = values.filter(value => value.id !== id);
    update({ values: remaining, primaryId: entry?.primaryId === id ? remaining[0]?.id ?? null : entry?.primaryId });
  };
  return <section className="field-default-card" aria-label={`${definition.label} defaults`}>
    <div className="field-default-card-heading"><div><h3>{definition.label}</h3><small>{definition.page} · {definition.key}</small></div><label className="field-default-toggle"><input type="checkbox" checked={enabled} onChange={event => update({ enabled: event.target.checked })} />Use defaults</label></div>
    {values.length ? <div className="field-default-values">{values.map(value => <div className="field-default-value" key={value.id}>
      <label>Label<input value={value.name} maxLength={80} onChange={event => updateValue(value.id, { name: event.target.value })} /></label>
      <label>Value{definition.type === 'textarea' ? <textarea value={value.value} maxLength={4000} rows={3} onChange={event => updateValue(value.id, { value: event.target.value })} /> : <input type="text" value={value.value} maxLength={4000} placeholder={definition.type === 'date' ? 'YYYY-MM-DD' : undefined} aria-invalid={Boolean(value.value && !validFieldDefaultValue(definition, value.value)) || undefined} onChange={event => updateValue(value.id, { value: event.target.value })} />}</label>
      {value.value && !validFieldDefaultValue(definition, value.value) ? <small className="field-default-invalid">{definition.type === 'date' ? 'Use a real date in YYYY-MM-DD format. This value will not be inserted until valid.' : 'Enter a valid value. This value will not be inserted until valid.'}</small> : null}
      <div className="field-default-value-actions"><label>Shortcut number<select aria-label={`Shortcut number for ${value.name}`} value={value.slot} onChange={event => { const slot = Number(event.target.value); if (!values.some(other => other.id !== value.id && other.slot === slot)) updateValue(value.id, { slot }); }}>
        {Array.from({ length: 9 }, (_, index) => index + 1).map(slot => <option value={slot} disabled={values.some(other => other.id !== value.id && other.slot === slot)} key={slot}>{slot}</option>)}
      </select></label><label className="field-default-toggle"><input type="checkbox" checked={value.enabled} onChange={event => updateValue(value.id, { enabled: event.target.checked })} />Show</label><label className="field-default-toggle"><input type="radio" name={`primary-${definition.key}`} checked={entry?.primaryId === value.id} onChange={() => update({ primaryId: value.id })} />Primary</label><button type="button" onClick={() => remove(value.id)} aria-label={`Remove ${value.name}`}>Remove</button></div>
    </div>)}</div> : <p className="field-default-empty">No saved value. This field stays empty when a new form opens.</p>}
    <button type="button" className="field-default-add" disabled={values.length >= 9} onClick={add}>Add value{values.length ? ` (${values.length}/9)` : ''}</button>
  </section>;
}

export function FieldDefaultsSettings({ workspaceId, definitions = [] }) {
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [saveError, setSaveError] = useState(false);
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    if (!workspaceId) return undefined;
    definitions.forEach(definition => registerFieldDefinition(workspaceId, definition));
    const listener = event => { if (event.detail?.workspaceId === workspaceId) refresh(); };
    window.addEventListener(FIELD_DEFAULTS_EVENT, listener);
    return () => window.removeEventListener(FIELD_DEFAULTS_EVENT, listener);
  }, [workspaceId, definitions]);
  const settings = useMemo(() => readFieldDefaults(workspaceId), [workspaceId, revision]);
  const definitionsList = useMemo(() => {
    const activeTemplateKeys = new Set(definitions.filter(definition => definition.key?.startsWith('template.')).map(definition => definition.key));
    const known = new Map([...readFieldInventory(workspaceId), ...definitions].map(definition => {
      const normalized = normalizeFieldDefinition(definition);
      return normalized?.eligible && (!normalized.key.startsWith('template.') || activeTemplateKeys.has(normalized.key)) ? [normalized.key, normalized] : [null, null];
    }).filter(([key]) => key));
    for (const key of Object.keys(settings.fields)) if (!known.has(key) && (!key.startsWith('template.') || activeTemplateKeys.has(key))) {
      const normalized = normalizeFieldDefinition({ key });
      if (normalized?.eligible) known.set(key, normalized);
    }
    return [...known.values()].sort((a, b) => a.page.localeCompare(b.page) || a.label.localeCompare(b.label));
  }, [workspaceId, definitions, settings]);
  const term = query.trim().toLowerCase();
  const filtered = definitionsList.filter(definition => `${definition.page} ${definition.label} ${definition.key}`.toLowerCase().includes(term));
  const groups = Object.groupBy ? Object.groupBy(filtered, definition => definition.page) : filtered.reduce((acc, definition) => { (acc[definition.page] ||= []).push(definition); return acc; }, {});
  const saveGlobal = patch => { if (!saveFieldDefaults(workspaceId, { ...settings, ...patch })) setSaveError(true); else setSaveError(false); };
  return <div className="field-default-settings" data-field-defaults-exclude>
    <header><h1>Field defaults</h1><p>Personal to this browser and workspace. Only explicitly registered new-form fields are auto-filled; existing records, search, passwords, tokens and payment fields are not.</p></header>
    <div className="field-default-global"><label className="field-default-toggle"><input type="checkbox" checked={settings.enabled} onChange={event => saveGlobal({ enabled: event.target.checked })} />Enable field defaults</label><label className="field-default-toggle"><input type="checkbox" checked={settings.shortcutsEnabled} onChange={event => saveGlobal({ shortcutsEnabled: event.target.checked })} />Enable value shortcuts</label></div>
    {saveError ? <p className="field-default-invalid" role="alert">This browser could not save field defaults. Check available storage before leaving this page.</p> : null}
    <p className="field-default-shortcut-help">While an eligible field is focused, use ⌘/Ctrl + 1–9. If your browser reserves that shortcut for tabs, use Alt + Shift + 1–9. A chosen value replaces the entire field; ⌘/Ctrl + Z restores the previous text immediately afterward.</p>
    <label className="field-default-search">Find a page, dialog or input<input type="search" value={query} placeholder="Search fields…" onChange={event => setQuery(event.target.value)} /></label>
    {Object.entries(groups).map(([page, fields]) => <section className="field-default-page" key={page}><h2>{page}</h2>{fields.map(definition => <FieldEditor key={definition.key} workspaceId={workspaceId} definition={definition} entry={settings.fields[definition.key] ?? blank()} onSaveResult={saved => setSaveError(!saved)} />)}</section>)}
    {!filtered.length ? <p className="field-default-empty">{term ? 'No fields match your search.' : 'No fields have been registered yet. Open a new form to discover its supported inputs.'}</p> : null}
  </div>;
}

import { useEffect, useMemo, useState } from 'react';
import {
  FIELD_DEFAULTS_EVENT, fieldDefaultsStorageKey, normalizeFieldDefinition, readFieldDefaults,
  readFieldInventory, registerFieldDefinitions, resetFieldEntry, saveFieldDefaults, updateFieldEntry, validFieldDefaultValue,
} from '../../lib/field-defaults.js';
import './field-defaults-settings.css';

const blank = () => ({ enabled: true, primaryId: null, values: [] });

function nextSlot(values) {
  for (let slot = 1; slot <= 9; slot += 1) if (!values.some(value => value.slot === slot)) return slot;
  return null;
}

function FieldEditor({ workspaceId, definition, entry, configured, onSaveResult }) {
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
    </div>)}</div> : <p className="field-default-empty">No saved value for this entry. An unconfigured field may use its shared-component default.</p>}
    <div className="field-default-card-actions"><button type="button" className="field-default-add" disabled={values.length >= 9} onClick={add}>Add value{values.length ? ` (${values.length}/9)` : ''}</button>{configured ? <button type="button" onClick={() => onSaveResult(Boolean(resetFieldEntry(workspaceId, definition.key)))}>{definition.sourceKey ? 'Use shared default' : 'Reset this field'}</button> : null}</div>
  </section>;
}

export function FieldDefaultsSettings({ workspaceId, definitions = [] }) {
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [saveError, setSaveError] = useState(false);
  const [configuredOnly, setConfiguredOnly] = useState(false);
  const [limit, setLimit] = useState(40);
  const [confirmReset, setConfirmReset] = useState(false);
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    if (!workspaceId) return undefined;
    registerFieldDefinitions(workspaceId, definitions);
    const listener = event => { if (event.detail?.workspaceId === workspaceId) refresh(); };
    const storageListener = event => { if (event.key === null || event.key === fieldDefaultsStorageKey(workspaceId) || event.key === `rumbo:field-inventory:v1:${workspaceId}`) refresh(); };
    window.addEventListener(FIELD_DEFAULTS_EVENT, listener);
    window.addEventListener('storage', storageListener);
    return () => { window.removeEventListener(FIELD_DEFAULTS_EVENT, listener); window.removeEventListener('storage', storageListener); };
  }, [workspaceId, definitions]);
  const settings = useMemo(() => readFieldDefaults(workspaceId), [workspaceId, revision]);
  const definitionsList = useMemo(() => {
    const activeTemplateKeys = new Set(definitions.filter(definition => definition.key?.startsWith('template.')).map(definition => definition.key));
    const activeSourceKeys = new Set(definitions.filter(definition => definition.key?.startsWith('source.')).map(definition => definition.key));
    const currentKey = key => !key.startsWith('playbook.') && (!key.startsWith('source.') || activeSourceKeys.has(key)) && (!key.startsWith('template.') || activeTemplateKeys.has(key));
    const known = new Map([...readFieldInventory(workspaceId), ...definitions].map(definition => {
      const normalized = normalizeFieldDefinition(definition);
      return normalized?.eligible && currentKey(normalized.key) ? [normalized.key, normalized] : [null, null];
    }).filter(([key]) => key));
    for (const key of Object.keys(settings.fields)) if (currentKey(key) && !known.has(key)) {
      const normalized = normalizeFieldDefinition({ key });
      if (normalized?.eligible) known.set(key, normalized);
    }
    return [...known.values()].sort((a, b) => a.page.localeCompare(b.page) || a.label.localeCompare(b.label));
  }, [workspaceId, definitions, settings]);
  const term = query.trim().toLowerCase();
  const filtered = definitionsList.filter(definition => (!configuredOnly || Boolean(settings.fields[definition.key])) && `${definition.page} ${definition.label} ${definition.key}`.toLowerCase().includes(term));
  const shown = filtered.slice(0, limit);
  const groups = Object.groupBy ? Object.groupBy(shown, definition => definition.page) : shown.reduce((acc, definition) => { (acc[definition.page] ||= []).push(definition); return acc; }, {});
  const saveGlobal = patch => { if (!saveFieldDefaults(workspaceId, { ...settings, ...patch })) setSaveError(true); else setSaveError(false); };
  return <div className="field-default-settings" data-field-defaults-exclude>
    <header><h1>Field defaults</h1><p>Personal to this browser and workspace. Search safe inputs across pages and dialogs, including existing-item fields. Empty new-form fields and searches can use a primary value; existing records and auto-saving settings change only when you explicitly choose a shortcut.</p></header>
    <div className="field-default-global"><label className="field-default-toggle"><input type="checkbox" checked={settings.enabled} onChange={event => saveGlobal({ enabled: event.target.checked })} />Enable field defaults</label><label className="field-default-toggle"><input type="checkbox" checked={settings.shortcutsEnabled} onChange={event => saveGlobal({ shortcutsEnabled: event.target.checked })} />Enable value shortcuts</label></div>
    {saveError ? <p className="field-default-invalid" role="alert">This browser could not save field defaults. Check available storage before leaving this page.</p> : null}
    <p className="field-default-shortcut-help">Focus a configured input and choose Saved values, or use ⌘/Ctrl + 1–9. If your browser reserves those shortcuts for tabs, use Alt + Shift + 1–9. Alt + ↓ opens the picker. A chosen value replaces the entire field; Undo insertion or ⌘/Ctrl + Z restores the previous text immediately afterward. Passwords, credentials, pairing codes, security/payment forms, read-only controls and connection/access selectors are excluded. Defaults never send a message or start work.</p>
    <label className="field-default-search">Find a page, dialog or input<input type="search" value={query} placeholder="Search fields…" onChange={event => { setQuery(event.target.value); setLimit(40); }} /></label>
    <div className="field-default-filter"><label className="field-default-toggle"><input type="checkbox" checked={configuredOnly} onChange={event => { setConfiguredOnly(event.target.checked); setLimit(40); }} />Configured fields only</label><span role="status">{filtered.length} fields{filtered.length > shown.length ? ` · showing ${shown.length}` : ''}</span><button type="button" disabled={!Object.keys(settings.fields).length} onClick={() => setConfirmReset(true)}>Clear saved values</button></div>
    {confirmReset ? <div className="field-default-reset" role="group" aria-label="Confirm clearing field defaults"><p>Clear every saved field value in this browser and workspace? Existing records and drafts are unchanged.</p><div><button type="button" onClick={() => setConfirmReset(false)}>Cancel</button><button type="button" onClick={() => { const saved = saveFieldDefaults(workspaceId, { ...settings, fields: {} }); setSaveError(!saved); if (saved) setConfirmReset(false); }}>Clear all saved values</button></div></div> : null}
    {Object.entries(groups).map(([page, fields]) => <section className="field-default-page" key={page}><h2>{page}</h2>{fields.map(definition => <FieldEditor key={definition.key} workspaceId={workspaceId} definition={definition} entry={settings.fields[definition.key] ?? blank()} configured={Boolean(settings.fields[definition.key])} onSaveResult={saved => setSaveError(!saved)} />)}</section>)}
    {shown.length < filtered.length ? <button type="button" className="field-default-add" onClick={() => setLimit(current => current + 40)}>Show more fields ({filtered.length - shown.length} remaining)</button> : null}
    {!filtered.length ? <p className="field-default-empty">{term ? 'No fields match your search.' : 'No eligible fields are available.'}</p> : null}
  </div>;
}

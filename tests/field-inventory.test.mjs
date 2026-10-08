import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { STATIC_FIELD_DEFINITIONS, fieldDefinitionsForWorkspace } from '../src/lib/field-inventory.js';
import { normalizeFieldDefinition } from '../src/lib/field-defaults.js';
import { RESOURCE_TYPES } from '../src/lib/settings-catalog.js';
import { SOURCE_FIELD_DEFINITIONS } from '../src/lib/field-source-inventory.js';
import { analyzeFieldSource, discoverSourceFields, instrumentFieldSource } from '../scripts/field-defaults-transform.mjs';

const root = new URL('../', import.meta.url).pathname;

test('committed Node catalog matches the current development/production analyzer', () => {
  assert.deepEqual(SOURCE_FIELD_DEFINITIONS, discoverSourceFields(root), 'Run node scripts/generate-field-inventory.mjs after JSX input changes.');
});

test('all catalog names are unique, eligible and safely named; no retired Playbooks', () => {
  assert.equal(new Set(STATIC_FIELD_DEFINITIONS.map(field => field.key)).size, STATIC_FIELD_DEFINITIONS.length);
  for (const field of STATIC_FIELD_DEFINITIONS) {
    assert.equal(normalizeFieldDefinition(field)?.eligible, true, field.key);
    assert.ok(field.page && field.label, field.key);
    assert.equal(/playbook/i.test(field.key), false, field.key);
  }
});

test('catalog pre-discovers searches, existing records, settings, dynamic rows and typed controls', () => {
  const fields = discoverSourceFields(root);
  // Assert representative capabilities, not an arbitrary coverage count.
  for (const label of ['Search updates', 'Find in changes', 'Area instructions', 'New criterion']) assert.ok(fields.some(field => field.label === label), label);
  assert.ok(fields.some(field => field.page.includes('Custom template questions') && field.label === 'Template question label'));
  assert.ok(fields.some(field => field.type === 'email'));
  assert.ok(fields.some(field => field.type === 'number'));
  assert.equal(analyzeFieldSource('export function NewEvent(){return <input type="datetime-local" value={date}/>}', 'src/components/Event.jsx')[0].eligible, true);
});

test('pre-discovered catalog searches product page/popup names and readable repeated-field labels', () => {
  const fields = discoverSourceFields(root);
  const search = term => fields.filter(field => `${field.page} ${field.label}`.toLowerCase().includes(term.toLowerCase()));
  assert.ok(search('Appearance').some(field => field.label === 'Custom hex color'));
  assert.ok(search('Workbench commands').some(field => /Command/.test(field.label)));
  assert.ok(search('Scheduled message').some(field => ['date', 'datetime-local'].includes(field.type)));
  assert.ok(search('Scheduled message').some(field => field.label === 'Time' && field.type === 'time'));
  assert.ok(search('Test case').some(field => field.label === 'Test case inputs (JSON object)'));
  assert.ok(search('Template question label').length);
  for (const field of fields) assert.doesNotMatch(field.label, /\[|\]|\?\?|\|\||Event Target Value/, field.label);
  // Product display metadata must not invalidate previously configured keys.
  assert.ok(fields.some(field => field.key === 'source.components-scheduled-work.schedule-time-fields.time-zone.2bcba4ec3ae8' && field.page.includes('Scheduled messages')));
  assert.ok(fields.some(field => field.key === 'source.views-skills.skill-editor.inputs-text.d1b581e4d959' && field.label === 'Test case inputs (JSON object)'));
});

test('page/popup headings, nested labels and dynamic template labels are inferred independently of identity', () => {
  const source = 'export function Editor(){return <><Heading title="Actual preferences"/><label><span>Destination name</span><input value={form.name}/></label><Field label={`Test ${index + 1} inputs (JSON object)`}><textarea value={item.inputs_text}/></Field></>}';
  const fields = analyzeFieldSource(source, 'src/components/Editor.jsx');
  assert.equal(fields[0].page, 'Actual preferences');
  assert.equal(fields[0].label, 'Destination name');
  assert.equal(fields[1].label, 'Test case inputs (JSON object)');
  const changedHeading = analyzeFieldSource(source.replace('Actual preferences','Renamed preferences'), 'src/components/Editor.jsx');
  assert.equal(changedHeading[0].key, fields[0].key);
  assert.equal(changedHeading[0].page, 'Renamed preferences');
});

test('every native/shared input site is instrumented or explicitly excluded across the entire source tree', () => {
  function check(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) check(path);
      else if (path.endsWith('.jsx')) {
        const source = readFileSync(path, 'utf8');
        const fields = analyzeFieldSource(source, path);
        const instrumented = instrumentFieldSource(source, path);
        for (const field of fields) {
          if (field.excluded) assert.match(instrumented, /data-field-defaults-exclude="true"/, path);
          else assert.ok(instrumented.includes(`data-field-default-source=${JSON.stringify(field.key)}`), `${path}: ${field.label}`);
        }
      }
    }
  }
  check(resolve(root, 'src'));
});

test('semantic identities survive insertion/reordering and distinguish identical labels in different forms', () => {
  const source = 'export function Editor(){ return <><form aria-label="Brief"><Field label="Name"><input value={brief.name}/></Field></form><form aria-label="Contact"><Field label="Name"><input value={contact.name}/></Field></form></> }';
  const original = analyzeFieldSource(source, 'src/components/Editor.jsx');
  assert.notEqual(original[0].key, original[1].key);
  const inserted = analyzeFieldSource(source.replace('<><form', '<><input value={query} placeholder="Search"/><form'), 'src/components/Editor.jsx');
  assert.equal(inserted[1].key, original[0].key);
  assert.equal(inserted[2].key, original[1].key);
  assert.equal(analyzeFieldSource('\n\n'+source, 'src/components/Editor.jsx')[0].key, original[0].key);
});

test('credential/security/payment forms fail closed, including innocently labeled neighboring fields', () => {
  for (const metadata of ['type="password"', 'name="api_key"', 'autoComplete="one-time-code"', 'autoComplete="cc-number"']) {
    const fields = analyzeFieldSource(`export function Editor(){return <form><Field label="Name"><input value={name}/></Field><input ${metadata}/></form>}`, 'src/components/Editor.jsx');
    assert.ok(fields.every(field => field.excluded), metadata);
  }
  assert.equal(analyzeFieldSource('export function Editor(){return <input name="safe" readOnly/>}', 'src/components/Editor.jsx')[0].excluded, true);
  assert.equal(analyzeFieldSource('export function Editor(){return <input name="safe"/>}', 'src/views/settings/SecuritySettings.jsx')[0].excluded, true);
});

test('existing edits and auto-saving settings are never opted into automatic writes', () => {
  const fields = analyzeFieldSource('export function Editor(){return <><input value={record.name} onChange={save}/><input value={setting} onChange={updateSettings}/></>}', 'src/views/settings/Preferences.jsx');
  assert.ok(fields.every(field => !field.auto));
  const query = analyzeFieldSource('export function Work(){return <SearchField value={query} onChange={setQuery} placeholder="Search work"/>}', 'src/views/Work.jsx')[0];
  assert.equal(query.auto, true);
});

test('custom template text fields use template/field IDs; choices and archived templates stay excluded', () => {
  const fields = fieldDefinitionsForWorkspace({ workspace_items: [
    { id: 'tpl-1', kind: 'route_template', name: 'Bug report', payload: { fields: [{ id: 'steps', label: 'Steps to reproduce', type: 'textarea' }, { id: 'severity', label: 'Severity', type: 'select' }] } },
    { id: 'tpl-2', kind: 'route_template', name: 'Archived report', archived_at: '2026-01-01', payload: { fields: [{ id: 'old', label: 'Old field', type: 'text' }] } },
  ] });
  assert.ok(fields.some(field => field.key === 'template.tpl-1.steps' && field.page === 'Bug report template'));
  assert.equal(fields.some(field => field.key === 'template.tpl-1.severity' || field.key === 'template.tpl-2.old'), false);
});

test('Settings resources expose all safe text fields, including query and contact attribution', () => {
  const expected = Object.entries(RESOURCE_TYPES).flatMap(([kind, spec]) => [
    `resource.${kind}.new.name`,
    ...Object.entries(spec.fields).filter(([, field]) => ['text', 'textarea'].includes(field.type)).map(([key]) => `resource.${kind}.new.${key}`),
  ]);
  assert.deepEqual(STATIC_FIELD_DEFINITIONS.filter(field => field.key.startsWith('resource.')).map(field => field.key), expected);
  const source = readFileSync(resolve(root, 'src/views/settings/ResourcePage.jsx'), 'utf8');
  assert.match(source, /data-field-default-mode': item \? 'edit' : 'create'/);
  assert.doesNotMatch(source, /\['query', 'requester', 'owner'\]\.includes/);
});

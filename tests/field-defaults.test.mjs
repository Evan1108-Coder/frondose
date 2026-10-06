import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldDefaultsStorageKey, fieldDefaultShortcutSlot, normalizeFieldDefaults,
  normalizeFieldDefinition, readFieldDefaults, readFieldInventory,
  registerFieldDefinition, resolveFieldValue, saveFieldDefaults, updateFieldEntry,
  definitionForElement, validFieldDefaultValue,
} from '../src/lib/field-defaults.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('preferences are browser-personal and isolated by workspace', () => {
  const storage = memoryStorage();
  assert.notEqual(fieldDefaultsStorageKey('one'), fieldDefaultsStorageKey('two'));
  saveFieldDefaults('one', { enabled: false }, storage);
  assert.equal(readFieldDefaults('one', storage).enabled, false);
  assert.equal(readFieldDefaults('two', storage).enabled, true);
});

test('failed browser storage writes are reported instead of claiming a save', () => {
  const unavailable = { getItem: () => null, setItem: () => { throw new Error('quota exceeded'); } };
  assert.equal(saveFieldDefaults('one', { enabled: false }, unavailable), false);
  assert.equal(readFieldDefaults('one', unavailable).enabled, true);
});

test('nine unique numbered values maximum and a valid primary', () => {
  const values = Array.from({ length: 12 }, (_, index) => ({ id: String(index), slot: index + 1, name: `Option ${index}`, value: `Value ${index}` }));
  const normalized = normalizeFieldDefaults({ fields: { 'route.problem': { primaryId: '2', values } } });
  assert.equal(normalized.fields['route.problem'].values.length, 9);
  assert.equal(normalized.fields['route.problem'].primaryId, '2');
  assert.equal(normalizeFieldDefaults({ fields: { 'route.problem': { primaryId: 'missing', values } } }).fields['route.problem'].primaryId, '0');
  assert.equal(normalizeFieldDefaults({ fields: { 'route.problem': { values: [{ id: 'x', slot: 1, value: 'a' }, { id: 'y', slot: 1, value: 'b' }] } } }).fields['route.problem'].values.length, 1);
});

test('empty newly added values remain editable but do not auto-fill', () => {
  const settings = normalizeFieldDefaults({ fields: { 'route.problem': { primaryId: 'draft', values: [{ id: 'draft', slot: 1, value: '' }] } } });
  assert.equal(settings.fields['route.problem'].values.length, 1);
  assert.equal(resolveFieldValue(settings, { key: 'route.problem', label: 'Problem' }), null);
});

test('sensitive, search and unsupported fields are excluded even if configured', () => {
  const settings = normalizeFieldDefaults({ fields: { 'auth.token': { primaryId: 'x', values: [{ id: 'x', slot: 1, value: 'SECRET' }] } } });
  assert.equal(normalizeFieldDefinition({ key: 'auth.token', label: 'API token' }).eligible, false);
  assert.equal(normalizeFieldDefinition({ key: 'search.work', label: 'Search work' }).eligible, false);
  assert.equal(normalizeFieldDefinition({ key: 'file.upload', type: 'file' }).eligible, false);
  assert.equal(resolveFieldValue(settings, { key: 'auth.token', label: 'API token' }), null);
  assert.equal(updateFieldEntry('one', 'auth.token', { values: [{ id: 'x', slot: 1, value: 'SECRET' }] }, memoryStorage()), false);
  assert.equal(normalizeFieldDefaults({ fields: { 'auth.token': { values: [{ id: 'x', slot: 1, value: 'SECRET' }] } } }).fields['auth.token'], undefined);
});

test('discovered date picker keeps semantic date type and rejects invalid calendar values', () => {
  const element = {
    matches: () => true, closest: () => null, getAttribute: () => null,
    tagName: 'INPUT', type: 'text', autocomplete: 'off', placeholder: 'YYYY-MM-DD',
    dataset: { fieldDefaultKey: 'route.new.due-date', fieldDefaultPage: 'New Route', fieldDefaultLabel: 'Due date', fieldDefaultAllow: 'true' },
  };
  const definition = definitionForElement(element);
  assert.equal(definition?.type, 'date');
  assert.equal(validFieldDefaultValue(definition, '2028-02-29'), true);
  assert.equal(validFieldDefaultValue(definition, '2027-02-29'), false);
  assert.equal(validFieldDefaultValue(definition, '2028-13-01'), false);
  assert.equal(validFieldDefaultValue(definition, 'next week'), false);
  const settings = normalizeFieldDefaults({ fields: { 'route.new.due-date': { primaryId: 'invalid', values: [{ id: 'invalid', slot: 1, value: 'next week' }] } } });
  assert.equal(resolveFieldValue(settings, definition), null);
});

test('sensitive control metadata blocks defaults even when its registered label is generic', () => {
  const element = {
    matches: () => true, closest: () => null, getAttribute: () => null,
    tagName: 'INPUT', type: 'text', autocomplete: 'one-time-code', name: 'verification_token',
    dataset: { fieldDefaultKey: 'new.reference', fieldDefaultLabel: 'Reference', fieldDefaultMode: 'create' },
  };
  assert.equal(definitionForElement(element), null);
});

test('numeric defaults are finite numbers, not arbitrary text', () => {
  const definition = { key: 'route.repeat.interval', label: 'Repeat every', type: 'number' };
  assert.equal(validFieldDefaultValue(definition, '30'), true);
  assert.equal(validFieldDefaultValue(definition, 'not-a-number'), false);
  assert.equal(validFieldDefaultValue(definition, 'Infinity'), false);
});

test('inventory is grouped metadata and configurable entries remain separate', () => {
  const storage = memoryStorage();
  registerFieldDefinition('one', { key: 'route.problem', page: 'New Route', label: 'Problem', type: 'textarea' }, storage);
  registerFieldDefinition('one', { key: 'route.problem', page: 'New Route', label: 'Problem', type: 'textarea' }, storage);
  assert.equal(readFieldInventory('one', storage).length, 1);
  assert.equal(readFieldInventory('two', storage).length, 0);
  updateFieldEntry('one', 'route.problem', { values: [{ id: 'one', slot: 1, value: 'Investigate' }], primaryId: 'one' }, storage);
  const settings = readFieldDefaults('one', storage);
  assert.equal(resolveFieldValue(settings, { key: 'route.problem', label: 'Problem', type: 'textarea' }).value, 'Investigate');
  updateFieldEntry('one', 'route.problem', { enabled: false }, storage);
  assert.equal(resolveFieldValue(readFieldDefaults('one', storage), { key: 'route.problem', label: 'Problem', type: 'textarea' }), null);
});

test('global, per-field and per-value switches gate selection independently', () => {
  const definition = { key: 'route.problem', label: 'Problem' };
  const config = { fields: { 'route.problem': { primaryId: 'first', values: [
    { id: 'first', slot: 1, value: 'One', enabled: false },
    { id: 'second', slot: 2, value: 'Two', enabled: true },
  ] } } };
  const settings = normalizeFieldDefaults(config);
  assert.equal(resolveFieldValue(settings, definition), null);
  assert.equal(resolveFieldValue(settings, definition, 2)?.value, 'Two');
  assert.equal(resolveFieldValue(normalizeFieldDefaults({ ...config, enabled: false }), definition, 2), null);
  assert.equal(resolveFieldValue(normalizeFieldDefaults({ fields: { 'route.problem': { ...config.fields['route.problem'], enabled: false } } }), definition, 2), null);
});

test('shortcut 1 selects the sole available value even if assigned elsewhere', () => {
  const settings = normalizeFieldDefaults({ fields: { 'route.problem': { primaryId: 'only', values: [{ id: 'only', slot: 7, value: 'Only value' }] } } });
  assert.equal(resolveFieldValue(settings, { key: 'route.problem' }, 1)?.value, 'Only value');
  assert.equal(resolveFieldValue(settings, { key: 'route.problem' }, 7)?.value, 'Only value');
});

test('shortcut parser ignores IME and unrelated keys', () => {
  assert.equal(fieldDefaultShortcutSlot({ code: 'Digit3', key: '3', metaKey: true }), 3);
  assert.equal(fieldDefaultShortcutSlot({ code: 'Digit9', key: '9', altKey: true, shiftKey: true }), 9);
  assert.equal(fieldDefaultShortcutSlot({ code: 'Digit1', key: '1', ctrlKey: true, isComposing: true }), null);
  assert.equal(fieldDefaultShortcutSlot({ code: 'Digit1', key: '1', ctrlKey: true, shiftKey: true }), null);
});

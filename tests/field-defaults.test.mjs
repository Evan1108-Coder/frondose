import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldDefaultsStorageKey, fieldDefaultShortcutSlot, normalizeFieldDefaults,
  normalizeFieldDefinition, readFieldDefaults, readFieldInventory,
  registerFieldDefinition, resolveFieldValue, saveFieldDefaults, updateFieldEntry,
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

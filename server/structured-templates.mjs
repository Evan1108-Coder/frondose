import { randomUUID } from 'node:crypto';
import { isRecord, validationError } from './validation.mjs';

// Template definitions live in workspace_items.payload_json. Instance values are
// kept separately from the item's ordinary description, goal, or chat messages.
const MAX_FIELDS = 24;
const MAX_TOTAL_CHARS = 100_000;
const TYPES = new Set(['text', 'textarea', 'select']);
const FIELD_ID = /^[a-z][a-z0-9_-]{0,63}$/;

function boundedText(value, name, max, { empty = true } = {}) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) {
    throw validationError(`${name} must be ${empty ? 'at most' : '1–'}${max} characters.`);
  }
  return value;
}

function validateValue(field, value) {
  boundedText(value, field.label, field.type === 'textarea' ? 20_000 : 500);
  if (field.type === 'select' && value && !field.options.includes(value)) {
    throw validationError(`Choose an option for ${field.label}.`);
  }
  if (field.required && !value.trim()) throw validationError(`${field.label} is required.`);
  return value;
}

export function normalizeTemplateFields(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_FIELDS) throw validationError(`A template supports up to ${MAX_FIELDS} fields.`);
  const ids = new Set();
  const labels = new Set();
  const fields = input.map((raw) => {
    if (!isRecord(raw)) throw validationError('Each template field must be an object.');
    for (const key of Object.keys(raw)) {
      if (!['id', 'label', 'type', 'required', 'default_value', 'placeholder', 'options'].includes(key)) throw validationError(`Unknown template field setting: ${key}.`);
    }
    const id = boundedText(raw.id, 'Field ID', 64, { empty: false });
    if (!FIELD_ID.test(id) || ids.has(id)) throw validationError('Template field IDs must be unique and use lowercase letters, numbers, hyphens, or underscores.');
    ids.add(id);
    const label = boundedText(raw.label, 'Field label', 100, { empty: false }).trim();
    if (labels.has(label.toLocaleLowerCase())) throw validationError('Template field labels must be unique within a template.');
    labels.add(label.toLocaleLowerCase());
    const type = raw.type ?? 'text';
    if (!TYPES.has(type)) throw validationError('Choose text, long text, or select for a template field.');
    if (raw.required !== undefined && typeof raw.required !== 'boolean') throw validationError('Required must be on or off.');
    const required = raw.required ?? false;
    const placeholder = boundedText(raw.placeholder ?? '', 'Field placeholder', 250);
    if (type !== 'select' && raw.options !== undefined) throw validationError('Only select fields can have options.');
    const options = type === 'select' && Array.isArray(raw.options) ? raw.options.map(option => typeof option === 'string' ? option.trim() : option) : type === 'select' ? raw.options : [];
    if (type === 'select' && (!Array.isArray(options) || options.length < 2 || options.length > 20 || options.some(option => typeof option !== 'string' || !option.trim() || option.length > 100) || new Set(options).size !== options.length)) {
      throw validationError('Select fields need 2–20 distinct nonempty options.');
    }
    const defaultValue = boundedText(raw.default_value ?? '', 'Default value', type === 'textarea' ? 20_000 : 500);
    if (type === 'select' && defaultValue && !options.includes(defaultValue)) throw validationError('A select default must be one of its options.');
    return { id, label, type, required, default_value: defaultValue, placeholder, ...(type === 'select' ? { options } : {}) };
  });
  if (JSON.stringify(fields).length > MAX_TOTAL_CHARS) throw validationError('Template fields are too large.');
  return fields;
}

export function resolveTemplateValues(fields, input = {}) {
  if (!isRecord(input)) throw validationError('Template answers must be an object.');
  const normalized = normalizeTemplateFields(fields);
  const ids = new Set(normalized.map(field => field.id));
  for (const id of Object.keys(input)) if (!ids.has(id)) throw validationError(`Unknown template field: ${id}.`);
  const values = Object.fromEntries(normalized.map(field => [field.id, validateValue(field, Object.hasOwn(input, field.id) ? input[field.id] : field.default_value)]));
  if (JSON.stringify(values).length > MAX_TOTAL_CHARS) throw validationError('Template answers are too large.');
  return values;
}

export function saveTemplateInstance(db, { workspaceId, templateId, templateVersion, entityType, entityId, fields, values, createdAt }) {
  if (!['tasks', 'projects', 'chats'].includes(entityType)) throw validationError('Unsupported template destination.');
  const normalized = normalizeTemplateFields(fields);
  if (!normalized.length) return null;
  const resolved = resolveTemplateValues(normalized, values);
  const id = `template_instance_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
  db.prepare('INSERT INTO workspace_template_instances (id,workspace_id,template_id,template_version,entity_type,entity_id,fields_json,values_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, workspaceId, templateId, templateVersion, entityType, entityId, JSON.stringify(normalized), JSON.stringify(resolved), createdAt);
  return { id, workspace_id: workspaceId, template_id: templateId, template_version: templateVersion, entity_type: entityType, entity_id: entityId, fields: normalized, values: resolved, created_at: createdAt };
}

export function templateInstanceSnapshot(db) {
  return db.prepare('SELECT * FROM workspace_template_instances ORDER BY created_at,id').all().map(row => ({
    id: row.id, workspace_id: row.workspace_id, template_id: row.template_id,
    template_version: row.template_version, entity_type: row.entity_type, entity_id: row.entity_id,
    fields: JSON.parse(row.fields_json), values: JSON.parse(row.values_json), created_at: row.created_at,
  }));
}

// Deliberately not included in the global bootstrap snapshot: a workspace can
// contain Route/Project/Chat records that this actor is not allowed to read.
// The API must pass the same canonical-entity read check it uses for the item.
export function templateInstanceFor(db, { workspaceId, entityType, entityId, canRead }) {
  if (!['tasks', 'projects', 'chats'].includes(entityType) || typeof workspaceId !== 'string' || typeof entityId !== 'string' || typeof canRead !== 'function') {
    throw validationError('Choose a readable Route, Project, or conversation.');
  }
  const entity = db.prepare(`SELECT * FROM ${entityType} WHERE id=? AND workspace_id=?`).get(entityId, workspaceId);
  if (!entity || !canRead(entityType, entity)) return null;
  const row = db.prepare('SELECT * FROM workspace_template_instances WHERE workspace_id=? AND entity_type=? AND entity_id=?').get(workspaceId, entityType, entityId);
  if (!row) return null;
  return { id: row.id, workspace_id: row.workspace_id, template_id: row.template_id, template_version: row.template_version, entity_type: row.entity_type, entity_id: row.entity_id, fields: JSON.parse(row.fields_json), values: JSON.parse(row.values_json), created_at: row.created_at };
}

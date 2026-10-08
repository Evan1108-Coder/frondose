// Personal, browser-local form preferences. These are deliberately not workspace
// data: exports, collaborators and imported workspaces must not inherit them.
export const FIELD_DEFAULTS_EVENT = 'rumbo:field-defaults-changed';
const VERSION = 1;
const MAX_VALUE_LENGTH = 4000;
const MAX_VALUES = 9;
const SAFE_KEY = /^[a-z0-9][a-z0-9:._-]{0,159}$/i;
const SENSITIVE = /password|passcode|secret|(?:access|refresh|auth|verification|bearer)[._ -]?token|\btoken\b|api.?key|credential|payment|credit.?card|card.?number|cvc|cvv|bank.?account|account.?number|private.?key|authorization|one.?time.?code|social.?security|passport/i;

export function fieldDefaultsStorageKey(workspaceId) {
  return `rumbo:field-defaults:v${VERSION}:${String(workspaceId || 'unknown')}`;
}

function inventoryStorageKey(workspaceId) {
  return `rumbo:field-inventory:v${VERSION}:${String(workspaceId || 'unknown')}`;
}

function getStorage(storage) {
  try { return storage ?? globalThis.localStorage; } catch { return null; }
}

function readJson(key, storage) {
  try { return JSON.parse(getStorage(storage)?.getItem(key) || 'null'); } catch { return null; }
}

function writeJson(key, value, storage) {
  try { const target = getStorage(storage); if (!target?.setItem) return false; target.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

function notify(workspaceId) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FIELD_DEFAULTS_EVENT, { detail: { workspaceId } }));
}

export function normalizeFieldDefinition(input) {
  const key = String(input?.key ?? '').trim();
  if (!SAFE_KEY.test(key)) return null;
  const page = String(input?.page ?? 'Other').trim().slice(0, 100) || 'Other';
  const label = String(input?.label ?? key).trim().slice(0, 120) || key;
  const type = String(input?.type ?? 'text').toLowerCase();
  const sensitive = input?.sensitive === true || SENSITIVE.test(`${key} ${label} ${type}`);
  const supported = ['text', 'search', 'textarea', 'email', 'url', 'tel', 'number', 'date', 'time', 'datetime-local', 'select'].includes(type);
  const eligible = supported && !sensitive && input?.eligible !== false;
  return { key, page, label, type, eligible, reason: eligible ? null : sensitive ? 'Sensitive field' : 'Unsupported field', ...(SAFE_KEY.test(input?.sourceKey ?? '') && input.sourceKey !== key ? { sourceKey: input.sourceKey } : {}) };
}

export function validFieldDefaultValue(definition, value) {
  const field = normalizeFieldDefinition(definition);
  if (!field?.eligible || typeof value !== 'string' || !value || value.length > MAX_VALUE_LENGTH) return false;
  if (field.type === 'date') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!parts) return false;
    const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
  }
  if (field.type === 'number') return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
  if (field.type === 'time') return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(value);
  if (field.type === 'datetime-local') {
    const parts = value.split('T');
    return parts.length === 2 && validFieldDefaultValue({ ...field, type: 'date' }, parts[0]) && validFieldDefaultValue({ ...field, type: 'time' }, parts[1]);
  }
  if (field.type === 'email') return /^[^\s@]+@[^\s@]+$/.test(value); // native typeMismatch checks the destination's exact HTML grammar
  if (field.type === 'url') { try { return Boolean(new URL(value).protocol); } catch { return false; } }
  return true;
}

export function readFieldInventory(workspaceId, storage) {
  const value = readJson(inventoryStorageKey(workspaceId), storage);
  return Array.isArray(value) ? value.map(normalizeFieldDefinition).filter(Boolean) : [];
}

export function registerFieldDefinition(workspaceId, definition, storage) {
  const next = normalizeFieldDefinition(definition);
  if (!next) return null;
  const entries = readFieldInventory(workspaceId, storage);
  const previous = entries.find(entry => entry.key === next.key);
  if (previous && JSON.stringify(previous) === JSON.stringify(next)) return next;
  const revised = [...entries.filter(entry => entry.key !== next.key), next].sort((a, b) => a.page.localeCompare(b.page) || a.label.localeCompare(b.label));
  if (writeJson(inventoryStorageKey(workspaceId), revised, storage)) notify(workspaceId);
  return next;
}

// Batch discovery performs one storage read/write, not one per input.
export function registerFieldDefinitions(workspaceId, definitions, storage) {
  const entries = new Map(readFieldInventory(workspaceId, storage).map(entry => [entry.key, entry]));
  let changed = false;
  for (const definition of definitions) {
    const next = normalizeFieldDefinition(definition);
    if (!next?.eligible) continue;
    if (JSON.stringify(entries.get(next.key)) !== JSON.stringify(next)) { entries.set(next.key, next); changed = true; }
  }
  if (!changed) return true;
  const revised = [...entries.values()].sort((a, b) => a.page.localeCompare(b.page) || a.label.localeCompare(b.label));
  if (!writeJson(inventoryStorageKey(workspaceId), revised, storage)) return false;
  notify(workspaceId);
  return true;
}

function normalizeValue(value, index) {
  if (!value || typeof value !== 'object') return null;
  const text = typeof value.value === 'string' ? value.value.slice(0, MAX_VALUE_LENGTH) : '';
  const slot = Number(value.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_VALUES) return null;
  return { id: String(value.id || `value-${index}`).slice(0, 80), name: String(value.name || `Value ${slot}`).slice(0, 80), value: text, slot, enabled: value.enabled !== false };
}

export function normalizeFieldDefaults(input) {
  const fields = Object.create(null);
  if (input?.fields && typeof input.fields === 'object' && !Array.isArray(input.fields)) {
    for (const [key, entry] of Object.entries(input.fields)) {
      if (!SAFE_KEY.test(key) || !normalizeFieldDefinition({ key })?.eligible || !entry || typeof entry !== 'object') continue;
      const usedSlots = new Set(), usedIds = new Set();
      const values = (Array.isArray(entry.values) ? entry.values : []).map(normalizeValue).filter(value => {
        if (!value || usedSlots.has(value.slot) || usedIds.has(value.id)) return false;
        usedSlots.add(value.slot);
        usedIds.add(value.id);
        return true;
      }).slice(0, MAX_VALUES);
      fields[key] = { enabled: entry.enabled !== false, primaryId: values.some(value => value.id === entry.primaryId) ? entry.primaryId : values[0]?.id ?? null, values };
    }
  }
  return { version: VERSION, enabled: input?.enabled !== false, shortcutsEnabled: input?.shortcutsEnabled !== false, fields };
}

export function readFieldDefaults(workspaceId, storage) {
  return normalizeFieldDefaults(readJson(fieldDefaultsStorageKey(workspaceId), storage));
}

export function saveFieldDefaults(workspaceId, settings, storage) {
  const normalized = normalizeFieldDefaults(settings);
  if (!writeJson(fieldDefaultsStorageKey(workspaceId), normalized, storage)) return false;
  notify(workspaceId);
  return normalized;
}

export function updateFieldDefaults(workspaceId, updater, storage) {
  const current = readFieldDefaults(workspaceId, storage);
  return saveFieldDefaults(workspaceId, typeof updater === 'function' ? updater(current) : { ...current, ...updater }, storage);
}

export function updateFieldEntry(workspaceId, key, patch, storage) {
  if (!normalizeFieldDefinition({ key })?.eligible) return false;
  return updateFieldDefaults(workspaceId, current => ({ ...current, fields: { ...current.fields, [key]: { ...(current.fields[key] || { enabled: true, primaryId: null, values: [] }), ...patch } } }), storage);
}

export function resolveFieldValue(settings, definition, slot = null) {
  const normalized = normalizeFieldDefinition(definition);
  if (!normalized?.eligible || !settings?.enabled) return null;
  // A shared-component source default covers dynamic variants when no more
  // specific field entry exists. An explicitly disabled/empty field entry
  // remains authoritative and never falls through to a generic value.
  const entry = settings.fields?.[normalized.key] ?? settings.fields?.[normalized.sourceKey];
  if (!entry?.enabled) return null;
  const available = entry.values?.filter(value => value.enabled && validFieldDefaultValue(normalized, value.value)) ?? [];
  // Keep Command 1 intuitive even if a single saved option was moved to a
  // different numbered slot. Its configured slot remains a second alias.
  if (slot === 1 && available.length === 1) return available[0];
  return entry.values?.find(value => value.enabled && validFieldDefaultValue(normalized, value.value) && (slot == null ? value.id === entry.primaryId : value.slot === slot)) ?? null;
}

function fieldElementType(element) {
  if (element.type === 'text' && /^hh:mm$/i.test(element.placeholder || '')) return 'time';
  // DateField uses a text input with a calendar, but its tagged semantic value
  // is an ISO calendar date. Keep that type when the live field is discovered.
  if (element.placeholder === 'YYYY-MM-DD' && element.closest?.('.date-field')) return 'date';
  if (element.dataset.fieldDefaultAllow === 'true' && element.placeholder === 'YYYY-MM-DD') return 'date';
  return element.tagName === 'TEXTAREA' ? 'textarea' : element.tagName === 'SELECT' ? 'select' : (element.type || 'text').toLowerCase();
}

function stableSlug(text) { return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'field'; }
function textForSelector(element, selector) { return element?.querySelector?.(selector)?.textContent?.trim() || ''; }

function fieldElementDefinition(element) {
  const type = fieldElementType(element);
  const dialog = element.closest?.('[role="dialog"], form');
  const pageRoot = element.closest?.('[data-field-default-page], #main-content');
  const page = element.dataset.fieldDefaultPage || element.dataset.fieldDefaultSourcePage || textForSelector(dialog, 'h1,h2,[data-dialog-title]') || textForSelector(pageRoot, 'h1') || 'Workspace';
  const label = element.dataset.fieldDefaultLabel || element.dataset.fieldDefaultSourceLabel || element.getAttribute('aria-label') || element.labels?.[0]?.textContent?.trim() || element.name || element.placeholder || type;
  const section = element.closest?.('fieldset, section, [role="group"]');
  const sectionName = section?.getAttribute?.('aria-label') || textForSelector(section, 'legend,h2,h3,h4');
  // Fallback is semantic. Never depend on React useId(), DOM position, or a
  // list index. Source-instrumented controls normally do not need this path.
  const key = element.dataset.fieldDefaultKey || element.dataset.fieldDefaultSource || `discovered.${stableSlug(page)}.${stableSlug(sectionName)}.${stableSlug(element.name || label)}.${type}`;
  const metadata = [element.name, element.id, element.placeholder, element.autocomplete, element.getAttribute('aria-label')].filter(Boolean).join(' ');
  const scopeLabel = dialog?.getAttribute?.('aria-label') || textForSelector(dialog, 'h1,h2,[data-dialog-title]');
  const sensitiveForm = /authentication|sign.?in|sign.?up|security|payment|billing|credential/i.test(scopeLabel) || Boolean(dialog?.querySelector?.('[data-field-default-sensitive]')) || [...(dialog?.querySelectorAll?.('input, textarea') ?? [])].some(control => SENSITIVE.test([control.type, control.name, control.id, control.placeholder, control.autocomplete, control.getAttribute('aria-label')].filter(Boolean).join(' ')));
  return normalizeFieldDefinition({ key, sourceKey: element.dataset.fieldDefaultSource, page, label, type, sensitive: Boolean(sensitiveForm) || SENSITIVE.test(metadata) });
}

export function isEligibleFieldElement(element) {
  if (!element?.matches?.('input, textarea, select')) return false;
  const type = fieldElementType(element);
  // Native choices are only supported when deliberately registered. This
  // avoids treating custom template choice questions as free-text inputs.
  if (type === 'select' && !element.dataset.fieldDefaultKey) return false;
  if (element.disabled || element.readOnly) return false;
  if (element.closest('[data-field-defaults-exclude]')) return false;
  const definition = fieldElementDefinition(element);
  return Boolean(definition?.eligible);
}

export function definitionForElement(element) {
  if (!isEligibleFieldElement(element)) return null;
  return fieldElementDefinition(element);
}

export function fieldDefaultShortcutSlot(event) {
  if (event.isComposing || event.key === 'Process' || event.repeat) return null;
  const number = Number(event.code?.match(/^Digit([1-9])$/)?.[1] || event.key?.match(/^[1-9]$/)?.[0]);
  if (!number) return null;
  // Cmd/Ctrl+1…9 is attempted, but browsers may reserve it for tabs.
  // Alt+Shift+1…9 is the dependable alternative on desktop browsers.
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) return number;
  if (event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey) return number;
  return null;
}

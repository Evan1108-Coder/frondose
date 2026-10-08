import { useEffect } from 'react';
import {
  FIELD_DEFAULTS_EVENT, definitionForElement, fieldDefaultShortcutSlot,
  readFieldDefaults, registerFieldDefinitions, resolveFieldValue, validFieldDefaultValue,
} from '../lib/field-defaults.js';

// Using the native setter and an input/change event keeps controlled React
// forms' onChange handlers in the loop; changing element.value alone does not.
export function replaceFieldValue(element, value, { restore = false } = {}) {
  const text = String(value);
  const definition = definitionForElement(element);
  if (!definition || !restore && (!validFieldDefaultValue(definition, text) || element.maxLength >= 0 && text.length > element.maxLength)) return false;
  if (element.tagName === 'SELECT') {
    if (![...element.options].some(option => option.value === text)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(element, text);
    if (element.value !== text) return false;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) return false;
  const previous = element.value;
  setter.call(element, text);
  const validity = element.validity;
  if (element.value !== text || !restore && (validity?.typeMismatch || validity?.patternMismatch || validity?.rangeOverflow || validity?.rangeUnderflow || validity?.stepMismatch || validity?.badInput)) {
    setter.call(element, previous);
    return false;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

export function FieldDefaultsProvider({ workspaceId, definitions = [], children }) {
  useEffect(() => {
    if (!workspaceId) return;
    registerFieldDefinitions(workspaceId, definitions);
  }, [workspaceId, definitions]);
  useEffect(() => {
    if (!workspaceId || typeof document === 'undefined') return undefined;
    let settings = readFieldDefaults(workspaceId);
    const visited = new WeakMap();
    const undo = new WeakMap();
    let programmatic = false;
    const pendingDefinitions = new Map();
    let registrationPending = false;
    const register = definition => {
      pendingDefinitions.set(definition.key, definition);
      if (registrationPending) return;
      registrationPending = true;
      queueMicrotask(() => {
        registrationPending = false;
        registerFieldDefinitions(workspaceId, [...pendingDefinitions.values()]);
        pendingDefinitions.clear();
      });
    };
    const visible = element => !element.closest('[hidden], [inert], [aria-hidden="true"]');
    const inNewDialog = element => {
      const dialog = element.closest('[role="dialog"]');
      const title = dialog?.querySelector('h1,h2,[data-dialog-title]')?.textContent?.trim() || '';
      return /^(?:new|create|add|start|capture|compose)\b/i.test(title);
    };
    const formMode = element => {
      const scope = element.closest('form, [role="dialog"]');
      if (scope?.querySelector('[data-field-default-mode="edit"]')) return 'edit';
      if (scope?.querySelector('[data-field-default-mode="create"]')) return 'create';
      return null;
    };
    const write = (element, value) => {
      const previous = element.value;
      if (previous === value) return false;
      programmatic = true;
      try {
        if (!replaceFieldValue(element, value)) return false;
        undo.set(element, { previous, applied: element.value });
        return true;
      } finally { programmatic = false; }
    };
    const inspect = element => {
      const definition = definitionForElement(element);
      if (!definition) return;
      register(definition);
      const mode = element.dataset.fieldDefaultMode || formMode(element);
      const visitKey = `${definition.key}:${mode || ''}`;
      if (visited.get(element) === visitKey || !visible(element)) return;
      visited.set(element, visitKey);
      // Registration and shortcuts cover existing records too. Automatic
      // insertion is narrower: never mutate an existing record/settings page
      // whose onChange may persist immediately. Explicit user shortcuts are
      // intentional edits and follow the control's normal onChange path.
      if (mode === 'edit' || element.value || !(mode === 'create' || element.dataset.fieldDefaultAuto === 'true' || inNewDialog(element))) return;
      const primary = resolveFieldValue(settings, definition);
      if (primary) write(element, primary.value);
    };
    const scan = root => {
      if (root?.matches?.('input, textarea, select')) inspect(root);
      root?.querySelectorAll?.('input, textarea, select').forEach(inspect);
    };
    const onFocus = event => inspect(event.target);
    const onInput = event => { if (!programmatic) undo.delete(event.target); };
    const onKeyDown = event => {
      const element = event.target;
      const definition = definitionForElement(element);
      if (!definition || !visible(element) || event.isComposing) return;
      const isUndo = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z';
      const previous = undo.get(element);
      if (isUndo && previous && element.value === previous.applied) {
        event.preventDefault();
        undo.delete(element);
        programmatic = true;
        try { replaceFieldValue(element, previous.previous, { restore: true }); } finally { programmatic = false; }
        return;
      }
      if (!settings.shortcutsEnabled) return;
      const slot = fieldDefaultShortcutSlot(event);
      if (!slot) return;
      const selected = resolveFieldValue(settings, definition, slot);
      if (!selected) return; // preserve browser behavior if the slot is empty
      // Invalid native min/max/step/pattern constraints leave both text and
      // the browser shortcut untouched.
      if (element.value === selected.value || write(element, selected.value)) event.preventDefault();
    };
    const onSettings = event => { if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) settings = readFieldDefaults(workspaceId); };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') scan(record.target);
        else for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
      }
    });
    scan(document.body);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'disabled', 'readonly', 'data-field-default-key', 'data-field-default-mode', 'data-field-default-source'] });
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener(FIELD_DEFAULTS_EVENT, onSettings);
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener(FIELD_DEFAULTS_EVENT, onSettings);
    };
  }, [workspaceId]);
  return children;
}

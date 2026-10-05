import { useEffect } from 'react';
import {
  FIELD_DEFAULTS_EVENT, definitionForElement, fieldDefaultShortcutSlot,
  readFieldDefaults, registerFieldDefinition, resolveFieldValue,
} from '../lib/field-defaults.js';

// Using the native setter and an input/change event keeps controlled React
// forms' onChange handlers in the loop; changing element.value alone does not.
export function replaceFieldValue(element, value) {
  const text = String(value);
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
  setter.call(element, text);
  if (element.value !== text) return false;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

export function FieldDefaultsProvider({ workspaceId, definitions = [], children }) {
  useEffect(() => {
    if (!workspaceId) return;
    for (const definition of definitions) registerFieldDefinition(workspaceId, definition);
  }, [workspaceId, definitions]);
  useEffect(() => {
    if (!workspaceId || typeof document === 'undefined') return undefined;
    let settings = readFieldDefaults(workspaceId);
    const visited = new WeakSet();
    const undo = new WeakMap();
    let programmatic = false;
    const visible = element => !element.closest('[hidden], [inert], [aria-hidden="true"]');
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
      registerFieldDefinition(workspaceId, definition);
      if (visited.has(element) || !visible(element)) return;
      visited.add(element);
      // Explicitly opt in only new forms. Existing records, search boxes and
      // unrelated controls are never changed as a side effect of discovery.
      if (element.dataset.fieldDefaultMode !== 'create' || element.value) return;
      const primary = resolveFieldValue(settings, definition);
      if (primary) write(element, primary.value);
    };
    const scan = root => {
      if (root?.matches?.('input, textarea, select')) inspect(root);
      root?.querySelectorAll?.('[data-field-default-key]').forEach(inspect);
    };
    const onFocus = event => inspect(event.target);
    const onInput = event => { if (!programmatic) undo.delete(event.target); };
    const onKeyDown = event => {
      const element = event.target;
      const definition = definitionForElement(element);
      if (!definition || !visible(element) || element.dataset.fieldDefaultMode === 'edit' || event.isComposing) return;
      const isUndo = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z';
      const previous = undo.get(element);
      if (isUndo && previous && element.value === previous.applied) {
        event.preventDefault();
        undo.delete(element);
        programmatic = true;
        try { replaceFieldValue(element, previous.previous); } finally { programmatic = false; }
        return;
      }
      if (!settings.shortcutsEnabled) return;
      const slot = fieldDefaultShortcutSlot(event);
      if (!slot) return;
      const selected = resolveFieldValue(settings, definition, slot);
      if (!selected) return; // preserve browser behavior if the slot is empty
      event.preventDefault();
      write(element, selected.value);
    };
    const onSettings = event => { if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) settings = readFieldDefaults(workspaceId); };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') scan(record.target);
        else for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
      }
    });
    scan(document.body);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'data-field-default-key', 'data-field-default-mode'] });
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

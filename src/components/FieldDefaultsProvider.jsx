import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from './icons.jsx';
import {
  FIELD_DEFAULTS_EVENT, definitionForElement, fieldDefaultShortcutSlot,
  availableFieldValues, fieldDefaultsStorageKey, readFieldDefaults, registerFieldDefinitions, resolveFieldValue, validFieldDefaultValue,
} from '../lib/field-defaults.js';
import './field-default-picker.css';

// Using the native setter and an input/change event keeps controlled React
// forms' onChange handlers in the loop; changing element.value alone does not.
export function replaceFieldValue(element, value, { restore = false } = {}) {
  const text = String(value);
  const definition = definitionForElement(element);
  if (!definition || !restore && (!validFieldDefaultValue(definition, text) || element.maxLength >= 0 && text.length > element.maxLength)) return false;
  if (element.tagName === 'SELECT') {
    if (![...element.options].some(option => option.value === text && (restore || !option.disabled && !option.parentElement?.disabled))) return false;
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
  const [picker, setPicker] = useState(null);
  const pickerRoot = useRef(null);
  const pickerActions = useRef(null);
  useEffect(() => {
    if (!workspaceId) return;
    registerFieldDefinitions(workspaceId, definitions);
  }, [workspaceId, definitions]);
  useEffect(() => {
    if (!workspaceId || typeof document === 'undefined') return undefined;
    let settings = readFieldDefaults(workspaceId);
    let focused = null;
    let expanded = false;
    let pickerError = '';
    let alive = true;
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
        if (!alive) return;
        registrationPending = false;
        registerFieldDefinitions(workspaceId, [...pendingDefinitions.values()]);
        pendingDefinitions.clear();
      });
    };
    const visible = element => !element.closest('[hidden], [inert], [aria-hidden="true"]');
    const refreshPicker = () => {
      const definition = focused?.isConnected && visible(focused) ? definitionForElement(focused) : null;
      const values = definition ? availableFieldValues(settings, definition) : [];
      const previous = focused && undo.get(focused);
      const canUndo = Boolean(previous && focused.value === previous.applied);
      if (!definition || !values.length && !canUndo) { setPicker(null); return; }
      const rect = focused.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewLeft = viewport?.offsetLeft || 0, viewTop = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
      if (rect.bottom < viewTop || rect.top > viewTop + height || !rect.width || !rect.height) { setPicker(null); return; }
      const panelWidth = Math.min(expanded ? 280 : 148, width - 16);
      const panelHeight = expanded ? Math.min(320, 52 + values.length * 56 + (canUndo ? 42 : 0)) : 34;
      const below = rect.bottom + 4;
      const top = below + panelHeight <= viewTop + height - 8 ? below : Math.max(viewTop + 8, rect.top - panelHeight - 4);
      setPicker({ element: focused, definition, values, canUndo, expanded, error: pickerError,
        style: { left: Math.max(viewLeft + 8, Math.min(rect.right - panelWidth, viewLeft + width - panelWidth - 8)), top, width: panelWidth },
        target: focused.closest('[role="dialog"]') || document.body });
    };
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
    const restorePrevious = element => {
      const previous = undo.get(element);
      if (!previous || element.value !== previous.applied) return false;
      programmatic = true;
      try {
        if (!replaceFieldValue(element, previous.previous, { restore: true })) return false;
        undo.delete(element);
        return true;
      } finally { programmatic = false; }
    };
    pickerActions.current = {
      toggle: () => { expanded = !expanded; pickerError = ''; refreshPicker(); },
      choose: id => {
        if (!focused?.isConnected) return;
        // Re-resolve current settings and eligibility at activation. A stale
        // popup cannot insert a value disabled in a different browser tab.
        const definition = definitionForElement(focused);
        const selected = availableFieldValues(readFieldDefaults(workspaceId), definition).find(value => value.id === id);
        if (!selected) { pickerError = 'This saved value is no longer available.'; refreshPicker(); return; }
        const applied = focused.value === selected.value || write(focused, selected.value);
        pickerError = applied ? '' : 'This value does not fit this field’s format or limits.';
        if (applied) { expanded = false; focused.focus(); }
        refreshPicker();
      },
      undo: () => { if (focused?.isConnected) { restorePrevious(focused); focused.focus(); refreshPicker(); } },
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
    const onFocus = event => {
      if (event.target.closest?.('[data-field-default-picker]')) return;
      inspect(event.target);
      focused = definitionForElement(event.target) ? event.target : null;
      expanded = false; pickerError = ''; refreshPicker();
    };
    const onBlur = () => queueMicrotask(() => {
      if (alive && document.activeElement !== focused && !pickerRoot.current?.contains(document.activeElement)) { focused = null; expanded = false; setPicker(null); }
    });
    const onInput = event => {
      if (!programmatic) undo.delete(event.target);
      if (event.target === focused) { expanded = false; pickerError = ''; refreshPicker(); }
    };
    const onKeyDown = event => {
      if (event.key === 'Escape' && (expanded || event.target.closest?.('[data-field-default-picker]'))) {
        event.preventDefault(); event.stopPropagation(); expanded = false; pickerError = ''; focused?.focus(); refreshPicker(); return;
      }
      const element = event.target;
      const definition = definitionForElement(element);
      if (!definition || !visible(element) || event.isComposing) return;
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'ArrowDown' && availableFieldValues(settings, definition).length) {
        event.preventDefault(); expanded = true; focused = element; refreshPicker();
        requestAnimationFrame(() => pickerRoot.current?.querySelector('[data-field-default-option]')?.focus());
        return;
      }
      const isUndo = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z';
      const previous = undo.get(element);
      if (isUndo && previous && element.value === previous.applied) {
        event.preventDefault();
        restorePrevious(element); refreshPicker();
        return;
      }
      if (!settings.shortcutsEnabled) return;
      const slot = fieldDefaultShortcutSlot(event);
      if (!slot) return;
      const selected = resolveFieldValue(settings, definition, slot);
      if (!selected) return; // preserve browser behavior if the slot is empty
      // Invalid native min/max/step/pattern constraints leave both text and
      // the browser shortcut untouched.
      if (element.value === selected.value || write(element, selected.value)) { event.preventDefault(); refreshPicker(); }
    };
    const onSettings = event => { if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) { settings = readFieldDefaults(workspaceId); refreshPicker(); } };
    const onStorage = event => { if (event.key === null || event.key === fieldDefaultsStorageKey(workspaceId)) onSettings({}); };
    const observer = new MutationObserver(records => {
      let attributesChanged = false;
      for (const record of records) {
        if (record.type === 'attributes') { scan(record.target); attributesChanged = true; }
        else for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
      }
      if (focused && !focused.isConnected) { focused = null; setPicker(null); }
      else if (focused && attributesChanged) refreshPicker();
    });
    scan(document.body);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'disabled', 'readonly', 'type', 'autocomplete', 'name', 'aria-label', 'data-field-defaults-exclude', 'data-field-default-key', 'data-field-default-mode', 'data-field-default-source'] });
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onBlur, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener(FIELD_DEFAULTS_EVENT, onSettings);
    window.addEventListener('storage', onStorage);
    window.addEventListener('resize', refreshPicker);
    window.addEventListener('scroll', refreshPicker, true);
    window.visualViewport?.addEventListener('resize', refreshPicker);
    window.visualViewport?.addEventListener('scroll', refreshPicker);
    return () => {
      alive = false;
      pickerActions.current = null;
      setPicker(null);
      observer.disconnect();
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', onBlur, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener(FIELD_DEFAULTS_EVENT, onSettings);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('resize', refreshPicker);
      window.removeEventListener('scroll', refreshPicker, true);
      window.visualViewport?.removeEventListener('resize', refreshPicker);
      window.visualViewport?.removeEventListener('scroll', refreshPicker);
    };
  }, [workspaceId]);
  return <>{children}{picker && createPortal(<div ref={pickerRoot} data-field-default-picker data-field-defaults-exclude data-rumbo-popup={picker.expanded ? 'field-defaults' : undefined} className="field-default-picker" style={picker.style}>
    <button type="button" className="field-default-picker-trigger" aria-label={`Saved values for ${picker.definition.label}`} aria-expanded={picker.expanded} onMouseDown={event => event.preventDefault()} onClick={() => pickerActions.current?.toggle()}>Saved values <ChevronDown aria-hidden="true" interactive={false} /></button>
    {picker.expanded ? <div className="field-default-picker-options" role="group" aria-label={`${picker.definition.label} saved values`}>
      {picker.values.map(value => <button type="button" data-field-default-option key={value.id} onMouseDown={event => event.preventDefault()} onClick={() => pickerActions.current?.choose(value.id)}><span>{value.name || `Value ${value.slot}`}</span><small>{value.value}</small></button>)}
      {picker.error ? <p role="status">{picker.error}</p> : null}
    </div> : null}
    {picker.canUndo ? <button type="button" className="field-default-picker-undo" onMouseDown={event => event.preventDefault()} onClick={() => pickerActions.current?.undo()}>Undo insertion</button> : null}
  </div>, picker.target)}</>;
}

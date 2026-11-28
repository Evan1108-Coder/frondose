import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Check } from "./icons.jsx";
import { usePopupPosition } from "./usePopupPosition.js";
import { usePopupMotion } from './usePopupMotion.js';
import { InterfaceElement, useInterfaceLanguage } from './InterfaceLanguage.jsx';
import { interfaceText } from '../lib/interface-language.js';
import "./select-field.css";

function textContent(children) {
  return Children.toArray(children).map((child) => isValidElement(child) ? textContent(child.props.children) : String(child ?? "")).join("");
}

export function readSelectOptions(children, group = null, groupDisabled = false, language = 'en') {
  const options = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const type = child.type === InterfaceElement ? child.props.interfaceElementType : child.type;
    if (type === Fragment) options.push(...readSelectOptions(child.props.children, group, groupDisabled, language));
    if (type === "optgroup") options.push(...readSelectOptions(child.props.children, child.props.label, groupDisabled || child.props.disabled, language));
    if (type === "option") {
      const source = child.props.label ?? textContent(child.props.children);
      const label = child.type === InterfaceElement && child.props.label == null && child.props.interfaceOptionText !== undefined
        ? interfaceText(child.props.interfaceOptionText, language) : source;
      options.push({ value: String(child.props.value ?? source), label, group, disabled: Boolean(groupDisabled || child.props.disabled) });
    }
  });
  return options;
}

export function SelectField({ label, value, defaultValue = "", onChange, children, disabled, required, name, id: providedId, className = "", placeholder = "Choose an option", onBlur, onFocus, onKeyDown, ...props }) {
  const generatedId = useId();
  const id = providedId ?? `select-${generatedId}`;
  const listId = `${id}-list`;
  const root = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  const typeahead = useRef({ value: "", time: 0 });
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const language = useInterfaceLanguage();
  const options = readSelectOptions(children, null, false, language);
  const selectedValue = String(value ?? uncontrolled ?? "");
  const selected = options.findIndex((option) => option.value === selectedValue);
  const enabled = options.map((option, index) => !option.disabled ? index : -1).filter((index) => index >= 0);
  const minWidth = options.reduce((width, option) => Math.max(width, Math.min(440, 60 + Math.max(String(option.label).length, String(option.group ?? '').length) * 8)), 216);
  const position = usePopupPosition(open, trigger, { minWidth, height: Math.min(320, options.length * 38 + new Set(options.map((option) => option.group).filter(Boolean)).size * 28 + 12) });
  const popup = usePopupMotion(open, list, { ready: Boolean(position) });

  function close(restore = false) {
    setOpen(false);
    typeahead.current = { value: "", time: 0 };
    if (restore) trigger.current?.focus();
  }
  function show(edge) {
    if (disabled || !enabled.length) return;
    setActive(edge === "last" ? enabled.at(-1) : selected >= 0 && !options[selected].disabled ? selected : enabled[0]);
    setOpen(true);
  }
  function choose(index) {
    const option = options[index];
    if (!option || option.disabled) return;
    setUncontrolled(option.value);
    onChange?.(option.value);
    trigger.current?.dispatchEvent(new Event("input", { bubbles: true }));
    close(true);
  }
  useEffect(() => {
    if (!open) return;
    function outside(event) {
      if (!root.current?.contains(event.target)) close();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function keyDown(event) {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!open) show(event.key === "End" || event.key === "ArrowUp" ? "last" : "first");
      else if (event.key === "Home") setActive(enabled[0]);
      else if (event.key === "End") setActive(enabled.at(-1));
      else {
        const cursor = enabled.indexOf(active);
        setActive(enabled[(cursor + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length]);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (open) choose(active);
      else show();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      let query = now - typeahead.current.time < 650 ? typeahead.current.value + event.key.toLowerCase() : event.key.toLowerCase();
      typeahead.current = { value: query, time: now };
      if ([...query].every((character) => character === query[0])) query = query[0];
      const cursor = open ? active : selected;
      const ordered = [...enabled.filter((index) => index > cursor), ...enabled.filter((index) => index <= cursor)];
      const match = ordered.find((index) => options[index].label.toLowerCase().startsWith(query));
      if (match !== undefined) {
        setActive(match);
        setOpen(true);
      }
    }
  }
  return (
    <div ref={root} className={`select-wrap rumbo-select ${className}`} data-open={open || undefined}>
      {label ? <label htmlFor={id}>{label}</label> : null}
      <button {...props} ref={trigger} id={id} type="button" className="rumbo-select-trigger" role="combobox" aria-label={props["aria-label"] ?? label} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} aria-required={required || undefined} data-empty={!selectedValue || undefined} disabled={disabled} onClick={() => open ? close() : show()} onKeyDown={keyDown} onBlur={onBlur} onFocus={onFocus}>
        <span className={selected < 0 ? "rumbo-select-placeholder" : undefined}>{options[selected]?.label ?? placeholder}</span>
        <ChevronDown morphTo={open ? ChevronUp : ChevronDown} interactive={false} aria-hidden="true" />
      </button>
      {name ? <input type="hidden" name={name} value={selectedValue} disabled={disabled} /> : null}
      {popup.present ? <div {...popup.motionProps} ref={list} id={listId} className="rumbo-select-panel" role="listbox" aria-label={props["aria-label"] ?? label ?? "Options"} style={position ?? { visibility: "hidden" }} data-rumbo-popup={open ? 'select' : undefined}>
        {options.map((option, index) => <Fragment key={`${option.value}-${index}`}>
          {option.group && options[index - 1]?.group !== option.group ? <div className="rumbo-select-group" role="presentation">{option.group}</div> : null}
          <div id={`${listId}-${index}`} role="option" aria-selected={selected === index} aria-disabled={option.disabled || undefined} className={`rumbo-select-option ${active === index ? "is-active" : ""}`} data-option-index={index} onMouseDown={(event) => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={event => { event.preventDefault(); event.stopPropagation(); choose(index); }}>
            <span>{option.label}</span>{selected === index ? <Check aria-hidden="true" /> : null}
          </div>
        </Fragment>)}
      </div> : null}
    </div>
  );
}

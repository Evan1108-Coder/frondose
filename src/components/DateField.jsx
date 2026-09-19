import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "./icons.jsx";
import { formatLocalDate, monthCells, parseCalendarDate, shiftCalendarMonth } from "../lib/calendar.js";
import { usePopupPosition } from "./usePopupPosition.js";
import "./date-field.css";
import { useApp } from '../app-context.js';

const weekdays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const dayName = new Intl.DateTimeFormat(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
const monthName = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long" });

export function DateField({ id: providedId, value = "", onChange, disabled, required, name, onBlur, "aria-describedby": describedBy, ...props }) {
  const app = useApp();
  const firstDay = app?.data?.settings?.preferences?.weekStart === 'sunday' ? 0 : 1;
  const weekLabels = firstDay === 0 ? ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] : weekdays;
  const generatedId = useId();
  const id = providedId ?? `date-${generatedId}`;
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [month, setMonth] = useState(() => parseCalendarDate(value) ?? new Date());
  const [active, setActive] = useState(() => formatLocalDate(parseCalendarDate(value) ?? new Date()));
  const root = useRef(null);
  const input = useRef(null);
  const anchor = useRef(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  const position = usePopupPosition(open, anchor, { width: 304, height: 380 });
  const invalid = Boolean(value && !parseCalendarDate(value));
  const errorVisible = invalid && (touched || value.length >= 10);

  useEffect(() => {
    input.current?.setCustomValidity(invalid ? "Enter a real date in YYYY-MM-DD format." : "");
  }, [invalid]);
  useEffect(() => {
    if (!open) return;
    function outside(event) {
      if (!root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    panel.current?.querySelector(`[data-date="${active}"]`)?.focus();
  }, [active, month, open, Boolean(position)]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  function close(restore = true) {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }
  function show() {
    const date = parseCalendarDate(value) ?? new Date();
    setMonth(date);
    setActive(formatLocalDate(date));
    setOpen(true);
  }
  function select(date) {
    onChange?.(date ? formatLocalDate(date) : "");
    setTouched(false);
    close();
  }
  function move(date) {
    if (date.getFullYear() < 1000 || date.getFullYear() > 9999) return;
    setActive(formatLocalDate(date));
    setMonth(date);
  }
  function calendarKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!event.target.hasAttribute("data-date")) return;
    const date = parseCalendarDate(active) ?? new Date();
    const dayOffset = (date.getDay() - firstDay + 7) % 7;
    const changes = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -dayOffset, End: 6 - dayOffset };
    if (event.key in changes) {
      event.preventDefault();
      event.stopPropagation();
      date.setDate(date.getDate() + changes[event.key]);
      move(date);
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      event.stopPropagation();
      move(shiftCalendarMonth(date, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1)));
    }
  }
  const today = formatLocalDate(new Date());
  const cells = monthCells(month, firstDay);
  return <div className="rumbo-date" ref={root} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <div className="rumbo-date-input" ref={anchor}>
      <input {...props} ref={input} id={id} name={name} type="text" value={value} required={required} disabled={disabled} placeholder="YYYY-MM-DD" autoComplete="off" maxLength={10} aria-invalid={errorVisible || undefined} aria-describedby={[describedBy, errorVisible ? `${id}-error` : null].filter(Boolean).join(" ") || undefined} onChange={(event) => onChange?.(event.target.value)} onBlur={(event) => { setTouched(true); onBlur?.(event); }} onKeyDown={(event) => {
        if (event.key === "ArrowDown" && event.altKey) { event.preventDefault(); show(); }
      }} />
      <button ref={trigger} type="button" disabled={disabled} aria-label="Choose date" aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-calendar`} onClick={() => open ? close() : show()}><Calendar aria-hidden="true" /></button>
    </div>
    {errorVisible ? <small className="rumbo-date-error" id={`${id}-error`} role="alert">Use a real date in YYYY-MM-DD format.</small> : null}
    {open ? <div ref={panel} role="dialog" aria-label="Choose date" id={`${id}-calendar`} className="rumbo-date-panel" style={position ?? { visibility: "hidden" }} data-rumbo-popup="calendar" onKeyDown={calendarKey}>
      <header className="rumbo-date-heading">
        <button type="button" aria-label="Previous month" onClick={() => move(shiftCalendarMonth(parseCalendarDate(active) ?? month, -1))}><ChevronLeft aria-hidden="true" /></button>
        <strong aria-live="polite">{monthName.format(month)}</strong>
        <button type="button" aria-label="Next month" onClick={() => move(shiftCalendarMonth(parseCalendarDate(active) ?? month, 1))}><ChevronRight aria-hidden="true" /></button>
      </header>
      <table className="rumbo-date-grid" role="grid" aria-label={monthName.format(month)}>
        <thead><tr>{weekLabels.map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
        <tbody>{Array.from({ length: 6 }, (_, week) => <tr key={week}>{cells.slice(week * 7, week * 7 + 7).map((date) => {
          const key = formatLocalDate(date);
          return <td key={key} aria-selected={key === value}><button type="button" data-date={key} tabIndex={key === active ? 0 : -1} className={`${date.getMonth() !== month.getMonth() ? "is-outside" : ""} ${key === value ? "is-selected" : ""}`} aria-label={dayName.format(date)} aria-current={key === today ? "date" : undefined} onClick={() => select(date)}>{date.getDate()}</button></td>;
        })}</tr>)}</tbody>
      </table>
      <footer className="rumbo-date-footer"><button type="button" onClick={() => select(new Date())}>Today</button><button type="button" onClick={() => select(null)}>Clear date</button></footer>
    </div> : null}
  </div>;
}

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from './icons.jsx';

/** Hover is a preview; only explicit activation selects a connection route. */
export function ConnectionActionMenu({ label, methods, onChoose, primary = false }) {
  const [open, setOpen] = useState(false), root = useRef(null), trigger = useRef(null), closeTimer = useRef(null), id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  return <div ref={root} className="connection-action-menu" onMouseEnter={() => { clearTimeout(closeTimer.current); setOpen(true); }} onMouseLeave={() => { closeTimer.current = setTimeout(() => { if (!root.current?.contains(document.activeElement)) setOpen(false); }, 120); }}>
    <button type="button" ref={trigger} className={`button ${primary ? 'primary' : ''}`} aria-haspopup="menu" aria-controls={open ? id : undefined} aria-expanded={open} disabled={!methods.length} onClick={() => { setOpen(true); requestAnimationFrame(() => root.current?.querySelector('[role=menuitem]')?.focus()); }} onKeyDown={event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); requestAnimationFrame(() => root.current?.querySelector('[role=menuitem]')?.focus()); }
    }}>{label}<ChevronDown aria-hidden="true" /></button>
    {open ? <div id={id} className="connection-action-options" role="menu" aria-label={`${label} methods`} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const items = [...event.currentTarget.querySelectorAll('[role=menuitem]')], index = items.indexOf(document.activeElement);
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>{methods.map(method => <button type="button" role="menuitem" key={method.id} onClick={() => { setOpen(false); onChoose(method.id); }}>{method.label}</button>)}</div> : null}
  </div>;
}

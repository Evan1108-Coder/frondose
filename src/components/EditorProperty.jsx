import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Tag } from './icons.jsx';
import { usePopupPosition } from './usePopupPosition.js';

export function EditorProperty({ label, children }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null), trigger = useRef(null);
  const position = usePopupPosition(open, trigger, { height: 280, width: 300 });
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);
  return <div ref={root} className="editor-property" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="editor-property-trigger" aria-expanded={open} onClick={() => setOpen(value => !value)}><Tag aria-hidden="true" />{label}<ChevronDown aria-hidden="true" /></button>
    {open ? <div className="editor-property-panel" data-rumbo-popup="editor-property" style={position ?? { visibility: 'hidden' }}>{children}</div> : null}
  </div>;
}

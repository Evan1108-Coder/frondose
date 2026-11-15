import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Tag } from './icons.jsx';
import { usePopupPosition } from './usePopupPosition.js';
import { usePopupMotion } from './usePopupMotion.js';

export function EditorProperty({ label, children }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null), trigger = useRef(null), panel = useRef(null);
  const position = usePopupPosition(open, trigger, { height: 280, width: 300 });
  const popup = usePopupMotion(open, panel, { ready: Boolean(position) });
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
    {popup.present ? <div {...popup.motionProps} ref={panel} className="editor-property-panel" data-rumbo-popup={open ? 'editor-property' : undefined} style={position ?? { visibility: 'hidden' }}>{children}</div> : null}
  </div>;
}

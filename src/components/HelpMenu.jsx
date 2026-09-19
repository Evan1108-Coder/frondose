import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Download, Keyboard, MessageCircle, PanelLeft, Settings } from './icons.jsx';
import { Button, Dialog, useApp } from '../ui.jsx';
import './help-menu.css';

export function HelpMenu({ onNavigate, onAction, overlayOpen }) {
  const { navigate, customizeSidebar, showShortcuts, showFeedback } = useApp();
  const [open, setOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, bottom: 64 });
  const trigger = useRef(null), menu = useRef(null);
  const initialItem = useRef('first');
  const id = useId();
  useEffect(() => { if (overlayOpen) setOpen(false); }, [overlayOpen]);
  useEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(8, Math.min(rect.right - 252, window.innerWidth - 260)), bottom: Math.max(8, window.innerHeight - rect.top + 8) });
    };
    positionMenu();
    const frame = requestAnimationFrame(() => {
      const buttons = menu.current?.querySelectorAll('[role="menuitem"]');
      buttons?.[initialItem.current === 'last' ? buttons.length - 1 : 0]?.focus();
    });
    const outside = event => {
      if (!menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false); trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', positionMenu);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', positionMenu);
    };
  }, [open]);
  const run = action => {
    setOpen(false);
    trigger.current?.focus();
    onAction?.();
    action();
  };
  const go = onNavigate ?? navigate;
  const items = [
    ['Docs', BookOpen, () => go('docs')],
    ['Feedback', MessageCircle, showFeedback],
    ['Sidebar customization', PanelLeft, customizeSidebar],
    ['Keyboard shortcuts', Keyboard, showShortcuts],
    ['Download app', Download, () => setDownloadOpen(true)],
    ['Settings', Settings, () => go('settings')],
  ];
  return <>
    <button type="button" ref={trigger} className="rumbo-help-trigger" aria-label="Help and resources" aria-haspopup="menu" aria-controls={open ? id : undefined} aria-expanded={open} onClick={() => { initialItem.current = 'first'; setOpen(current => !current); }} onKeyDown={event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault(); initialItem.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true);
    }}><span aria-hidden="true">?</span></button>
    {open ? createPortal(<div id={id} ref={menu} className="rumbo-help-menu" role="menu" aria-label="Help and resources" data-rumbo-popup style={position} onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) setOpen(false);
    }} onKeyDown={event => {
      const buttons = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
      const index = buttons.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
      if (event.key === 'Tab') { setOpen(false); trigger.current?.focus(); }
      if (event.key.length === 1 && /[a-z]/i.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const ordered = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)];
        const match = ordered.find(button => button.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
        if (match) { event.preventDefault(); match.focus(); }
      }
    }}>
      <div className="rumbo-help-menu-label">Rumbo resources</div>
      {items.map(([label, Icon, action]) => <button type="button" role="menuitem" key={label} onClick={() => run(action)}><Icon /><span>{label}</span>{label === 'Download app' ? <small>Coming soon</small> : null}</button>)}
    </div>, document.body) : null}
    {downloadOpen ? <Dialog title="Download Rumbo" subtitle="The desktop app is not available yet." onClose={() => setDownloadOpen(false)}><div className="rumbo-download-placeholder"><Download /><p>Keep using Rumbo in your browser. This is a preview of the download entry—there is no installer or download available today.</p><Button onClick={() => setDownloadOpen(false)}>Got it</Button></div></Dialog> : null}
  </>;
}

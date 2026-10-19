import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Keyboard, PanelLeft, Settings } from './icons.jsx';
import { Dialog, useApp } from '../ui.jsx';
import { currentMotionPreference } from '../lib/motion.js';
import './help-menu.css';
import { recentProductUpdates } from '../lib/product-updates.js';

export function HelpMenu({ onNavigate, onAction, overlayOpen }) {
  const { navigate, customizeSidebar, showShortcuts } = useApp();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, bottom: 64 });
  const trigger = useRef(null), menu = useRef(null), closeTimer = useRef(null);
  const initialItem = useRef('first');
  const id = useId();
  useEffect(() => { if (overlayOpen) { window.clearTimeout(closeTimer.current); setOpen(false); setClosing(false); } }, [overlayOpen]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const close = callback => {
    if (!open || closing) return;
    const { fadeMs } = currentMotionPreference();
    if (!fadeMs) { setOpen(false); callback?.(); return; }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => { setOpen(false); setClosing(false); callback?.(); }, Math.min(fadeMs, 160));
  };
  useEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(8, Math.min(rect.right - 252, window.innerWidth - 260)), bottom: Math.max(8, window.innerHeight - rect.top + 8) });
    };
    positionMenu();
    const frame = requestAnimationFrame(() => {
      if (closing) return;
      const buttons = menu.current?.querySelectorAll('[role="menuitem"]');
      buttons?.[initialItem.current === 'last' ? buttons.length - 1 : 0]?.focus();
    });
    const outside = event => {
      if (!menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      close(); trigger.current?.focus();
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
  }, [open, closing]);
  const run = action => {
    trigger.current?.focus();
    close(() => { onAction?.(); action(); });
  };
  const go = onNavigate ?? navigate;
  const items = [
    ['Docs', BookOpen, () => go('docs')],
    ['What the tools mean', BookOpen, () => setTermsOpen(true)],
    ['Sidebar customization', PanelLeft, customizeSidebar],
    ['Keyboard shortcuts', Keyboard, showShortcuts],
  ];
  return <>
    <button type="button" ref={trigger} className="rumbo-help-trigger" aria-label="Help and resources" aria-haspopup="menu" aria-controls={open ? id : undefined} aria-expanded={open} onClick={() => { initialItem.current = 'first'; if (open) close(); else { window.clearTimeout(closeTimer.current); setClosing(false); setOpen(true); } }} onKeyDown={event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault(); initialItem.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true);
    }}><span aria-hidden="true">?</span></button>
    {open ? createPortal(<div id={id} ref={menu} className="rumbo-help-menu" role="menu" aria-label="Help and resources" data-rumbo-popup data-closing={closing ? 'true' : undefined} style={position} onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) close();
    }} onKeyDown={event => {
      const buttons = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
      const index = buttons.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
      if (event.key === 'Tab') close();
      if (event.key.length === 1 && /[a-z]/i.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const ordered = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)];
        const match = ordered.find(button => button.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
        if (match) { event.preventDefault(); match.focus(); }
      }
    }}>
      <div className="rumbo-help-menu-label">Talvori Resources</div>
      {items.map(([label, Icon, action]) => <button type="button" role="menuitem" key={label} onClick={() => run(action)}><Icon /><span>{label}</span></button>)}
      <div className="rumbo-help-menu-label">Updates</div>
      {recentProductUpdates().map(update => <button type="button" role="menuitem" key={update.id} onClick={() => run(() => go('docs', update.articleId))}><BookOpen /><span>{update.title}</span></button>)}
      <div role="separator" className="menu-divider" />
      <button type="button" role="menuitem" onClick={() => run(() => go('settings'))}><Settings /><span>Settings</span></button>
    </div>, document.body) : null}
    {termsOpen ? <Dialog title="What the tools mean" subtitle="A short map of Talvori’s work surfaces." onClose={() => setTermsOpen(false)}><dl className="rumbo-terms">
      <div><dt>Talvori</dt><dd>Your general assistant conversation. It uses a connected AI provider only after you review and send a request.</dd></div>
      <div><dt>Agent profiles</dt><dd>Reusable specialist roles with their own instructions and defaults. Several can share one provider connection.</dd></div>
      <div><dt>Workflows</dt><dd>Bounded sequences of agent, skill, tool, and human-decision steps. A prepared workflow is not a running one.</dd></div>
      <div><dt>Coordination</dt><dd>Plans, handoffs, requests, and queues for deciding who or what should act next.</dd></div>
      <div><dt>Knowledge and Memory</dt><dd>Knowledge holds reviewed sources and outputs; Memory keeps explicit notes for future context. Neither grants an agent new access by itself.</dd></div>
    </dl></Dialog> : null}
  </>;
}

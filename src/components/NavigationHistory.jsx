import { useEffect, useRef, useState } from 'react';
import { IconButton, useApp } from '../ui.jsx';
import { ArrowLeft, ArrowRight } from './icons.jsx';
import { parsePage, pageHash } from '../lib/navigation.js';
import { stepHistory, visitPage } from '../lib/navigation-history.js';

export function NavigationHistory() {
  const { page, navigate } = useApp();
  const hash = pageHash(page.view, page.id, page);
  const [history, setHistory] = useState(() => visitPage(null, hash));
  const current = useRef(history);
  useEffect(() => { const next = visitPage(current.current, hash); current.current = next; setHistory(next); }, [hash]);
  function travel(direction) {
    const next = stepHistory(current.current, direction);
    if (next === current.current) return;
    current.current = next; setHistory(next);
    const target = parsePage(next.entries[next.index]);
    navigate(target.view, target.id, target);
  }
  useEffect(() => {
    const key = event => {
      if (!(event.metaKey || event.ctrlKey) || !['[', ']'].includes(event.key) || event.shiftKey || event.altKey || event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="menu"], .xterm') || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault(); travel(event.key === '[' ? -1 : 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [navigate]);
  return <div className="navigation-history" aria-label="Workspace history"><IconButton label="Go back in Frondose · ⌘ / Ctrl [" disabled={history.index === 0} onClick={() => travel(-1)}><ArrowLeft /></IconButton><IconButton label="Go forward in Frondose · ⌘ / Ctrl ]" disabled={history.index === history.entries.length - 1} onClick={() => travel(1)}><ArrowRight /></IconButton></div>;
}

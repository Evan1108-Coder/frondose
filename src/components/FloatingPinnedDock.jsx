import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis, Focus } from './icons.jsx';
import { useApp } from '../ui.jsx';
import { NAV } from './Shell.jsx';
import { favoriteKey, resolveFavorite } from '../lib/organization.js';
import { useTalvoriAgentAppearance } from '../lib/talvori-agent-appearance.js';
import './floating-pinned-dock.css';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const snap = position => ({ x: position.x < 0.08 ? 0.035 : position.x > 0.92 ? 0.965 : position.x, y: clamp(position.y, 0.055, 0.94) });

export function FloatingPinnedDock() {
  const { data, navigate, organization, updateOrganization, workspace } = useApp();
  const agentAppearance = useTalvoriAgentAppearance(workspace?.id);
  const positionFromPreferences = organization.dockPosition ?? { x: 0.5, y: 0.9 };
  const [position, setPosition] = useState(positionFromPreferences);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const dock = useRef(null);
  useEffect(() => setPosition(positionFromPreferences), [positionFromPreferences.x, positionFromPreferences.y]);
  const entries = useMemo(() => [
    ...(organization.pinnedLayout ?? []).map(id => {
      const item = NAV.find(tab => tab.id === id);
      return item ? { key: `tab:${id}`, label: id === 'rumbo-agent' ? agentAppearance.display_name : item.label, icon: item.icon || Focus, view: id, id: null } : null;
    }).filter(Boolean),
    ...(organization.favorites ?? []).map(reference => {
      const item = resolveFavorite(data, reference);
      if (!item) return null;
      return { key: favoriteKey(item), label: item.title, icon: NAV.find(tab => tab.id === item.view)?.icon || Focus, view: item.view, id: item.id };
    }).filter(Boolean),
  ], [organization.pinnedLayout, organization.favorites, data, agentAppearance.display_name]);
  if (organization.showPinnedInHeader !== false || !entries.length) return null;
  const vertical = position.x < 0.08 || position.x > 0.92;
  const onPointerDown = event => {
    if (event.button !== 0) return;
    drag.current = { id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = event => {
    if (drag.current?.id !== event.pointerId) return;
    setPosition({ x: clamp(event.clientX / window.innerWidth, 0.03, 0.97), y: clamp(event.clientY / window.innerHeight, 0.05, 0.95) });
  };
  const finishDrag = event => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    const next = snap({ x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight });
    setPosition(next);
    updateOrganization({ ...organization, dockPosition: next });
  };
  const cancelDrag = event => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    setPosition(positionFromPreferences);
  };
  const onDockMove = event => {
    if (drag.current) return;
    const buttons = [...dock.current.querySelectorAll('.floating-dock-item')];
    const index = buttons.reduce((nearest, button, at) => {
      const rect = button.getBoundingClientRect();
      const center = vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
      const distance = Math.abs((vertical ? event.clientY : event.clientX) - center);
      return distance < nearest.distance ? { index: at, distance } : nearest;
    }, { index: -1, distance: Infinity });
    setHoverIndex(index.distance < 85 ? index.index : -1);
  };
  return createPortal(<nav ref={dock} className={`floating-pinned-dock ${vertical ? 'is-vertical' : ''} ${position.x < 0.08 ? 'is-left' : ''} ${position.x > 0.92 ? 'is-right' : ''} ${dragging ? 'is-dragging' : ''}`} aria-label="Pinned tabs" style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }} onPointerMove={onDockMove} onPointerLeave={() => setHoverIndex(-1)}>
    <div className="floating-dock-items">{entries.map((entry, index) => { const Icon = entry.icon; const proximity = hoverIndex < 0 ? 0 : Math.max(0, 1 - Math.abs(hoverIndex - index) / 2.5); return <button key={entry.key} type="button" className="floating-dock-item" title={entry.label} aria-label={`Open pinned ${entry.label}`} style={{ '--dock-magnify': proximity }} onClick={() => navigate(entry.view, entry.id)}><Icon aria-hidden="true" /></button>; })}</div>
    <button type="button" className="floating-dock-grip" aria-label="Drag pinned dock" title="Drag pinned dock. Arrow keys move it; Home returns it to the bottom." onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onKeyDown={event => {
      const amount = event.shiftKey ? 0.1 : 0.02;
      const next = { ...position };
      if (event.key === 'Home') { next.x = 0.5; next.y = 0.9; }
      else if (event.key === 'ArrowLeft') next.x -= amount;
      else if (event.key === 'ArrowRight') next.x += amount;
      else if (event.key === 'ArrowUp') next.y -= amount;
      else if (event.key === 'ArrowDown') next.y += amount;
      else return;
      event.preventDefault();
      const snapped = snap(next);
      setPosition(snapped);
      updateOrganization({ ...organization, dockPosition: snapped });
    }}><Ellipsis aria-hidden="true" /></button>
  </nav>, document.body);
}

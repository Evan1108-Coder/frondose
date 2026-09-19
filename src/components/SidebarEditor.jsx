import { useRef, useState } from "react";
import { Button, Dialog, ErrorMessage, Select, useApp } from "../ui.jsx";
import { ArrowDown, ArrowUp, RotateCcw } from "./icons.jsx";
import { sortSidebarEntities } from '../lib/organization.js';
import { visible } from '../lib/model.js';
import { NAV_ITEMS, SECTION_LABELS, moveItem, placeSidebarItem, normalizeOrganization, resolveFavorite, favoriteKey } from "../lib/organization.js";

export function SidebarEditor({ onClose }) {
  const { organization, updateOrganization, workspace, data } = useApp();
  const [draft, setDraft] = useState(organization), [error, setError] = useState(null);
  const drag = useRef(null);
  const label = id => SECTION_LABELS[id] || NAV_ITEMS.find(item => item.id === id)?.label || id;
  const patch = value => setDraft(current => ({ ...current, ...value }));
  return <Dialog title="Customize sidebar" subtitle={`Your layout for ${workspace.name}. Saved in this browser only.`} onClose={onClose} className="sidebar-editor">
    <div className="sidebar-editor-body">
      <div className="sidebar-editor-preferences">
        <label><span>Badge style<small>Show counts, subtle dots, or no badges.</small></span><Select aria-label="Sidebar badge style" value={draft.badges} onChange={badges => patch({ badges })}><option value="count">Count</option><option value="dot">Dot</option><option value="none">None</option></Select></label>
        <label><span>Row spacing<small>Only changes the sidebar.</small></span><Select aria-label="Sidebar spacing" value={draft.density} onChange={density => patch({ density })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></Select></label>
      </div>
      {[["primary", "Quick navigation"], ["sections", "Workspace sections"], ["tools", "Workspace tools"]].map(([group, heading]) => <section key={group}>
        <h3>{heading}</h3><div className="sidebar-editor-list">{draft.order[group].map((id, index) => <div className="sidebar-editor-row" key={id} draggable onDragStart={event => { drag.current = { group, id }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', label(id)); }} onDragOver={event => { if (drag.current?.group === group) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (drag.current?.group === group) patch({ order: { ...draft.order, [group]: placeSidebarItem(draft.order[group], drag.current.id, id) } }); drag.current = null; }} onDragEnd={() => { drag.current = null; }}>
          <span>{label(id)}</span>
          <button aria-label={`${draft.pinnedLayout.includes(id) ? 'Unpin' : 'Pin'} ${label(id)}`} aria-pressed={draft.pinnedLayout.includes(id)} onClick={() => patch({ pinnedLayout: draft.pinnedLayout.includes(id) ? draft.pinnedLayout.filter(item => item !== id) : [...draft.pinnedLayout, id] })}>{draft.pinnedLayout.includes(id) ? 'Unpin' : 'Pin'}</button>
          <div className="sidebar-reorder"><button aria-label={`Move ${label(id)} up`} disabled={index === 0} onClick={() => patch({ order: { ...draft.order, [group]: moveItem(draft.order[group], id, -1) } })}><ArrowUp /></button><button aria-label={`Move ${label(id)} down`} disabled={index === draft.order[group].length - 1} onClick={() => patch({ order: { ...draft.order, [group]: moveItem(draft.order[group], id, 1) } })}><ArrowDown /></button></div>
          <Select aria-label={`${label(id)} visibility`} value={draft.visibility[id]} onChange={visibility => patch({ visibility: { ...draft.visibility, [id]: visibility } })}><option value="always">Always show</option><option value="activity">With activity</option><option value="hidden">Hide</option></Select>
        </div>)}</div>
      </section>)}
      <section><h3>Hidden items</h3><p className="organization-note">Hiding only changes this sidebar. Items remain in search and their full collection; favorites are independent.</p><div className="sidebar-editor-list">{draft.hiddenItems.length ? draft.hiddenItems.map(ref => <div className="sidebar-editor-row" key={favoriteKey(ref)}><span>{resolveFavorite(data, ref)?.title || 'Unavailable item'}<small> · {label(ref.view)}</small></span><Button onClick={() => patch({ hiddenItems: draft.hiddenItems.filter(item => favoriteKey(item) !== favoriteKey(ref)) })}>Restore</Button></div>) : <p className="organization-note">Nothing hidden. Use the options button beside a sidebar item to hide it.</p>}</div></section>
      {['projects', 'teams', 'agents', 'chats'].map(view => {
        const items = sortSidebarEntities(visible(data[view] ?? []), draft.entityOrder[view]);
        if (!items.length) return null;
        const ids = items.map(item => item.id);
        const reorder = next => patch({ entityOrder: { ...draft.entityOrder, [view]: next } });
        return <section key={view}><h3>{label(view)} order</h3><div className="sidebar-editor-list">{items.map((item, index) => <div className="sidebar-editor-row" key={item.id} draggable onDragStart={event => { drag.current = { group: 'entity-' + view, id: item.id }; event.dataTransfer.setData('text/plain', item.name || item.title); }} onDragOver={event => { if (drag.current?.group === 'entity-' + view) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (drag.current?.group === 'entity-' + view) reorder(placeSidebarItem(ids, drag.current.id, item.id)); drag.current = null; }} onDragEnd={() => { drag.current = null; }}><span>{item.name || item.title}</span><div className="sidebar-reorder"><button aria-label={`Move ${item.name || item.title} up`} disabled={!index} onClick={() => reorder(moveItem(ids, item.id, -1))}><ArrowUp /></button><button aria-label={`Move ${item.name || item.title} down`} disabled={index === items.length - 1} onClick={() => reorder(moveItem(ids, item.id, 1))}><ArrowDown /></button></div></div>)}</div></section>;
      })}
      <p className="organization-note">Drag rows within a list, or use the move buttons. Pinned tabs and groups stay above unpinned entries in their list. “Activity” means items in a collection or work needing attention. Hidden pages remain available in search. Settings and this editor are always accessible.</p>
      <ErrorMessage error={error} />
    </div>
    <footer className="dialog-footer"><Button icon={RotateCcw} onClick={() => { const defaults = normalizeOrganization(null); setDraft({ ...draft, order: defaults.order, visibility: defaults.visibility, badges: defaults.badges, density: defaults.density, hiddenItems: [], pinnedLayout: [], entityOrder: defaults.entityOrder }); }}>Reset layout</Button><span className="dialog-footer-spacer" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { try { updateOrganization({ ...organization, order: draft.order, visibility: draft.visibility, badges: draft.badges, density: draft.density, hiddenItems: draft.hiddenItems, pinnedLayout: draft.pinnedLayout, entityOrder: draft.entityOrder }); onClose(); } catch (cause) { setError(cause); } }}>Save layout</Button></footer>
  </Dialog>;
}

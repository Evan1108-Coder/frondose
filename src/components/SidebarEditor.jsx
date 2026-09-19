import { useState } from "react";
import { Button, Dialog, ErrorMessage, Select, useApp } from "../ui.jsx";
import { ArrowDown, ArrowUp, RotateCcw } from "./icons.jsx";
import { NAV_ITEMS, SECTION_LABELS, moveItem, normalizeOrganization, resolveFavorite, favoriteKey } from "../lib/organization.js";

export function SidebarEditor({ onClose }) {
  const { organization, updateOrganization, workspace, data } = useApp();
  const [draft, setDraft] = useState(organization), [error, setError] = useState(null);
  const label = id => SECTION_LABELS[id] || NAV_ITEMS.find(item => item.id === id)?.label || id;
  const patch = value => setDraft(current => ({ ...current, ...value }));
  return <Dialog title="Customize sidebar" subtitle={`Your layout for ${workspace.name}. Saved in this browser only.`} onClose={onClose} className="sidebar-editor">
    <div className="sidebar-editor-body">
      <div className="sidebar-editor-preferences">
        <label><span>Badge style<small>Show counts, subtle dots, or no badges.</small></span><Select aria-label="Sidebar badge style" value={draft.badges} onChange={badges => patch({ badges })}><option value="count">Count</option><option value="dot">Dot</option><option value="none">None</option></Select></label>
        <label><span>Row spacing<small>Only changes the sidebar.</small></span><Select aria-label="Sidebar spacing" value={draft.density} onChange={density => patch({ density })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></Select></label>
      </div>
      {[["primary", "Quick navigation"], ["sections", "Workspace sections"], ["tools", "Workspace tools"]].map(([group, heading]) => <section key={group}>
        <h3>{heading}</h3><div className="sidebar-editor-list">{draft.order[group].map((id, index) => <div className="sidebar-editor-row" key={id}>
          <span>{label(id)}</span>
          <div className="sidebar-reorder"><button aria-label={`Move ${label(id)} up`} disabled={index === 0} onClick={() => patch({ order: { ...draft.order, [group]: moveItem(draft.order[group], id, -1) } })}><ArrowUp /></button><button aria-label={`Move ${label(id)} down`} disabled={index === draft.order[group].length - 1} onClick={() => patch({ order: { ...draft.order, [group]: moveItem(draft.order[group], id, 1) } })}><ArrowDown /></button></div>
          <Select aria-label={`${label(id)} visibility`} value={draft.visibility[id]} onChange={visibility => patch({ visibility: { ...draft.visibility, [id]: visibility } })}><option value="always">Always show</option><option value="activity">With activity</option><option value="hidden">Hide</option></Select>
        </div>)}</div>
      </section>)}
      <section><h3>Hidden items</h3><p className="organization-note">Hiding only changes this sidebar. Items remain in search and their full collection; favorites are independent.</p><div className="sidebar-editor-list">{draft.hiddenItems.length ? draft.hiddenItems.map(ref => <div className="sidebar-editor-row" key={favoriteKey(ref)}><span>{resolveFavorite(data, ref)?.title || 'Unavailable item'}<small> · {label(ref.view)}</small></span><Button onClick={() => patch({ hiddenItems: draft.hiddenItems.filter(item => favoriteKey(item) !== favoriteKey(ref)) })}>Restore</Button></div>) : <p className="organization-note">Nothing hidden. Use the options button beside a sidebar item to hide it.</p>}</div></section>
      <p className="organization-note">“Activity” means items in a collection, active sessions in Live work, or work needing attention in Focus, Inbox, and Routes. Hidden pages remain available in search. Settings and this editor are always accessible.</p>
      <ErrorMessage error={error} />
    </div>
    <footer className="dialog-footer"><Button icon={RotateCcw} onClick={() => { const defaults = normalizeOrganization(null); setDraft({ ...draft, order: defaults.order, visibility: defaults.visibility, badges: defaults.badges, density: defaults.density, hiddenItems: [] }); }}>Reset layout</Button><span className="dialog-footer-spacer" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { try { updateOrganization({ ...organization, order: draft.order, visibility: draft.visibility, badges: draft.badges, density: draft.density, hiddenItems: draft.hiddenItems }); onClose(); } catch (cause) { setError(cause); } }}>Save layout</Button></footer>
  </Dialog>;
}

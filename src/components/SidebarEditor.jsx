import { useRef, useState } from 'react';
import { Button, Dialog, ErrorMessage, Select, useApp } from '../ui.jsx';
import { ArrowDown, ArrowUp, RotateCcw } from './icons.jsx';
import { NAV_ITEMS, SECTION_LABELS, normalizeOrganization, resolveFavorite, favoriteKey } from '../lib/organization.js';
import { BUILTIN_GROUPS, moveSidebarEntry, removeSidebarGroup, entityKey, parseEntityKey, isFixedSidebarEntry } from '../lib/sidebar-layout.js';
import { visible } from '../lib/model.js';

export function SidebarEditor({ onClose }) {
  const { organization, updateOrganization, workspace, data } = useApp();
  const [draft, setDraft] = useState(organization), [error, setError] = useState(null), [name, setName] = useState('');
  const drag = useRef(null);
  const label = key => {
    const ref = parseEntityKey(key);
    return ref ? resolveFavorite(data, ref)?.title ?? 'Unavailable item' : draft.layout.groups.find(g => g.id === key)?.name ?? SECTION_LABELS[key] ?? NAV_ITEMS.find(n => n.id === key)?.label ?? key;
  };
  const patch = value => setDraft(current => ({ ...current, ...value }));
  const move = (key, container, target, after) => setDraft(current => ({ ...current, layout: moveSidebarEntry(current.layout, key, container, target, after) }));
  const dragProps = (key, container) => ({
    draggable: !isFixedSidebarEntry(key),
    onDragStart: event => { if (isFixedSidebarEntry(key)) { event.preventDefault(); return; } drag.current = key; event.dataTransfer.setData('text/plain', label(key)); },
    onDragOver: event => { if (drag.current && !isFixedSidebarEntry(key)) event.preventDefault(); },
    onDrop: event => { event.preventDefault(); if (drag.current && !isFixedSidebarEntry(key)) { const box = event.currentTarget.getBoundingClientRect(); move(drag.current, container, key, event.clientY > box.top + box.height / 2); } drag.current = null; },
    onDragEnd: () => { drag.current = null; },
  });
  const row = (key, container, items) => {
    const ref = parseEntityKey(key), group = draft.layout.groups.find(g => g.id === key);
    const index = items.indexOf(key), fixed = isFixedSidebarEntry(key);
    return <div className="sidebar-layout-editor-row" key={key} {...dragProps(key, container)}>
      <span>{label(key)}</span>
      <div className="sidebar-reorder">{[-1,1].map(offset => <button key={offset} aria-label={'Move ' + label(key) + (offset < 0 ? ' up' : ' down')} disabled={fixed || !items[index + offset] || isFixedSidebarEntry(items[index + offset])} onClick={() => move(key, container, items[index + offset], offset > 0)}>{offset < 0 ? <ArrowUp /> : <ArrowDown />}</button>)}</div>
      {!fixed && !group && !BUILTIN_GROUPS.includes(key) ? <Select aria-label={'Group for ' + label(key)} value={container} onChange={value => move(key, value)}><option value="root">Top level</option>{draft.layout.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</Select> : null}
      {!ref ? <Select aria-label={label(key) + ' visibility'} disabled={key === 'rumbo-agent'} value={draft.visibility[key] ?? 'always'} onChange={value => patch({ visibility: { ...draft.visibility, [key]: value } })}><option value="always">Show</option><option value="hidden">Hide</option><option value="activity">With activity</option></Select> : null}
      {fixed ? <span className="organization-note">Fixed at top</span> : !ref ? <Button onClick={() => patch({ pinnedLayout: draft.pinnedLayout.includes(key) ? draft.pinnedLayout.filter(id => id !== key) : [...draft.pinnedLayout, key], layout: draft.pinnedLayout.includes(key) ? draft.layout : moveSidebarEntry(draft.layout, key, 'root', draft.layout.root[0]) })}>{draft.pinnedLayout.includes(key) ? 'Unpin' : 'Pin'}</Button> : null}
    </div>;
  };
  return <Dialog title="Customize sidebar" subtitle={'Your layout for ' + workspace.name} onClose={onClose} className="sidebar-editor">
    <div className="sidebar-editor-body">
      <div className="sidebar-editor-preferences">
        <label><span>Navigation <small>Focused keeps Today, Rumbo Agent, Inbox, and Projects in the sidebar. Other pages remain in More and search.</small></span><Select aria-label="Sidebar navigation mode" value={draft.navigationMode} onChange={navigationMode => patch({ navigationMode })}><option value="focused">Focused</option><option value="full">All tools</option></Select></label>
        <label><span>Badge style</span><Select aria-label="Sidebar badge style" value={draft.badges} onChange={badges => patch({ badges })}><option value="count">Count</option><option value="dot">Dot</option><option value="none">None</option></Select></label>
        <label><span>Row spacing</span><Select aria-label="Sidebar spacing" value={draft.density} onChange={density => patch({ density })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></Select></label>
      </div>
      <section><h3>Custom groups</h3><p className="organization-note">Only your custom groups accept dropped tabs. Built-in groups can be moved, but cannot accept new items.</p>
        <div className="sidebar-custom-editor"><input aria-label="New group name" placeholder="Group name" maxLength={60} value={name} onChange={event => setName(event.target.value)} /><Button disabled={!name.trim() || draft.layout.groups.length >= 30} onClick={() => { const id = 'custom:' + crypto.randomUUID(); patch({ layout: { root: [...draft.layout.root, id], groups: [...draft.layout.groups, { id, name: name.trim(), items: [], collapsed: false }] } }); setName(''); }}>Create group</Button></div>
        {draft.layout.groups.map(group => <div key={group.id}><div className="sidebar-custom-editor"><input aria-label={'Rename ' + group.name} value={group.name} maxLength={60} onChange={event => patch({ layout: { ...draft.layout, groups: draft.layout.groups.map(g => g.id === group.id ? { ...g, name: event.target.value } : g) } })} /><Button onClick={() => patch({ layout: removeSidebarGroup(draft.layout, group.id) })}>Remove group</Button></div>{group.items.map(key => row(key, group.id, group.items))}<p className="organization-note">Removing a group moves its tabs back to the sidebar.</p></div>)}
      </section>
      <section><h3>Sidebar order</h3><p className="organization-note">Today and Rumbo Agent stay at the top. Rumbo Agent is always visible. Reorder the other rows with drag or arrows, or use “Group for” to move them into custom groups.</p>{draft.layout.root.map(key => row(key, 'root', draft.layout.root))}</section>
      <section><h3>Project, team, agent, and chat shortcuts</h3>{['projects','teams','agents','chats'].flatMap(view => visible(data[view] ?? []).map(item => {
        const key = entityKey(view, item.id);
        const placed = draft.layout.root.includes(key) || draft.layout.groups.some(g => g.items.includes(key));
        if (placed) return null;
        return <div className="sidebar-layout-editor-row" key={key}><span>{item.name || item.title}</span><Button onClick={() => move(key, 'root')}>Move to top level</Button><Select aria-label={'Group for ' + (item.name || item.title)} value="" onChange={value => { if (value) move(key, value); }}><option value="">Move to group…</option>{draft.layout.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></div>;
      }))}</section>
      <section><h3>Hidden items</h3>{draft.hiddenItems.map(ref => <div className="sidebar-layout-editor-row" key={favoriteKey(ref)}><span>{resolveFavorite(data, ref)?.title || 'Unavailable item'}</span><Button onClick={() => patch({ hiddenItems: draft.hiddenItems.filter(item => favoriteKey(item) !== favoriteKey(ref)) })}>Restore</Button></div>)}</section>
      <ErrorMessage error={error} />
    </div>
    <footer className="dialog-footer"><Button icon={RotateCcw} onClick={() => { const defaults = normalizeOrganization(null); setDraft({ ...draft, layout: defaults.layout, order: defaults.order, visibility: defaults.visibility, navigationMode: defaults.navigationMode, pinnedLayout: [], hiddenItems: [], entityOrder: defaults.entityOrder }); }}>Reset layout</Button><span className="dialog-footer-spacer" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { try { updateOrganization(draft); onClose(); } catch (cause) { setError(cause); } }}>Save layout</Button></footer>
  </Dialog>;
}

import { useRef, useState } from 'react';
import { Button, Dialog, Select } from '../ui.jsx';
import { entityKey, moveSidebarEntry, BUILTIN_GROUPS, isFixedSidebarEntry } from '../lib/sidebar-layout.js';

export function useSidebarArrange({ organization, updateOrganization, notify, create, toggleFavorite }) {
  const source = useRef(null);
  const [over, setOver] = useState(null), [options, setOptions] = useState(null), [dragging, setDragging] = useState(false);
  const keyOf = item => item.entity ? entityKey(item.group, item.id) : item.id;
  const save = patch => { try { updateOrganization({ ...organization, ...patch }); } catch (error) { notify(error.message, 'error'); } };
  const move = (key, container, target, after) => save({ layout: moveSidebarEntry(organization.layout, key, container, target, after) });
  const destinationOf = key => organization.layout.groups.find(g => g.items.includes(key))?.id ?? 'root';
  const stop = () => { source.current = null; setOver(null); setDragging(false); };
  const drop = (container, target = null) => ({
    'data-drop-target': over?.container === container && over?.target === target ? over.after ? 'after' : 'before' : undefined,
    onDragOver: event => {
      if (!source.current || isFixedSidebarEntry(target)) return;
      if (container !== 'root' && (BUILTIN_GROUPS.includes(source.current) || source.current.startsWith('custom:'))) return;
      event.preventDefault(); event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const after = target !== null && event.clientY > rect.top + rect.height / 2;
      setOver({ container, target, after }); event.dataTransfer.dropEffect = 'move';
      const scroll = event.currentTarget.closest('nav');
      if (scroll) { const bounds = scroll.getBoundingClientRect(); if (event.clientY < bounds.top + 45) scroll.scrollTop -= 14; if (event.clientY > bounds.bottom - 45) scroll.scrollTop += 14; }
    },
    onDrop: event => { if (!source.current || isFixedSidebarEntry(target)) return; event.preventDefault(); event.stopPropagation(); const key = source.current; const rect = event.currentTarget.getBoundingClientRect(); move(key, container, target, target !== null && event.clientY > rect.top + rect.height / 2); stop(); },
  });
  const bind = item => ({
    draggable: !isFixedSidebarEntry(keyOf(item)), 'data-sidebar-arrange': keyOf(item),
    onDragStart: event => { if (isFixedSidebarEntry(keyOf(item))) { event.preventDefault(); return; } event.stopPropagation(); source.current = keyOf(item); setDragging(true); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.title); },
    onDragEnd: stop,
    onContextMenu: event => { event.preventDefault(); event.stopPropagation(); setOptions(item); },
    onKeyDown: event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); setOptions(item); } },
  });
  const act = fn => { fn(); setOptions(null); };
  const key = options && keyOf(options);
  const fixed = isFixedSidebarEntry(key);
  const pinned = options && (options.entity ? organization.favorites.some(f => f.view === options.group && f.id === options.id) : organization.pinnedLayout.includes(options.id));
  const container = options ? destinationOf(key) : 'root';
  const items = container === 'root' ? organization.layout.root : organization.layout.groups.find(g => g.id === container).items;
  const dialog = options ? <Dialog title={options.title} subtitle="Organize your sidebar without changing workspace content." onClose={() => setOptions(null)}><div className="sidebar-item-dialog">
    {fixed ? <p className="organization-note">Today and Rumbo Agent stay at the top. Rumbo Agent is always visible.</p> : <Button onClick={() => act(() => { if (options.entity) toggleFavorite({ view: options.group, id: options.id }); else save({ pinnedLayout: pinned ? organization.pinnedLayout.filter(id => id !== key) : [...organization.pinnedLayout, key], layout: pinned ? organization.layout : moveSidebarEntry(organization.layout, key, 'root', organization.layout.root[0]) }); })}>{pinned ? 'Unpin' : 'Pin'}</Button>}
    {key !== 'rumbo-agent' ? <Button onClick={() => act(() => save(options.entity ? { hiddenItems: [...organization.hiddenItems, { view: options.group, id: options.id }] } : { visibility: { ...organization.visibility, [key]: 'hidden' } }))}>Hide from sidebar</Button> : null}
    {!fixed ? [-1, 1].map(offset => <Button key={offset} disabled={!items.includes(key) || !items[items.indexOf(key) + offset] || isFixedSidebarEntry(items[items.indexOf(key) + offset])} onClick={() => act(() => move(key, container, items[items.indexOf(key) + offset], offset > 0))}>Move {offset < 0 ? 'up' : 'down'}</Button>) : null}
    {!fixed && !BUILTIN_GROUPS.includes(key) && !key.startsWith('custom:') ? <label>Move to<Select aria-label="Move sidebar item to" value={container} onChange={value => act(() => move(key, value))}><option value="root">Sidebar (top level)</option>{organization.layout.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></label> : null}
    {options.kind ? <Button onClick={() => act(() => create(options.kind, options.defaults ?? {}))}>Create new {options.kind === 'team' ? 'Area' : options.kind === 'task' ? 'Route' : options.kind}</Button> : null}
  </div></Dialog> : null;
  return { bind, drop, dialog, dragging, stop };
}

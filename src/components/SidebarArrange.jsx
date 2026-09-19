import { useRef, useState } from 'react';
import { Button, Dialog } from '../ui.jsx';
import { placeSidebarItem, moveItem } from '../lib/organization.js';

// Drag metadata never comes from an external drop. Only a drag started here can reorder.
export function useSidebarArrange({ organization, updateOrganization, notify, create, toggleFavorite }) {
  const source = useRef(null);
  const [over, setOver] = useState(null), [options, setOptions] = useState(null);
  const save = patch => { try { updateOrganization({ ...organization, ...patch }); } catch (error) { notify(error.message, 'error'); } };
  const list = item => item.entity ? item.items : organization.order[item.group];
  const reorder = (item, next) => save(item.entity
    ? { entityOrder: { ...organization.entityOrder, [item.group]: next } }
    : { order: { ...organization.order, [item.group]: next } });
  const bind = item => ({
    draggable: true,
    'data-sidebar-arrange': item.id,
    'data-drop-target': over === item.group + ':' + item.id ? 'true' : undefined,
    onDragStart: event => { event.stopPropagation(); source.current = item; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.title); },
    onDragOver: event => { if (source.current?.group !== item.group || Boolean(source.current?.entity) !== Boolean(item.entity)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setOver(item.group + ':' + item.id); },
    onDrop: event => { event.preventDefault(); event.stopPropagation(); const from = source.current; source.current = null; setOver(null); if (from?.group === item.group && Boolean(from.entity) === Boolean(item.entity)) reorder(item, placeSidebarItem(list(item), from.id, item.id)); },
    onDragEnd: () => { source.current = null; setOver(null); },
    onContextMenu: event => { event.preventDefault(); event.stopPropagation(); setOptions(item); },
    onKeyDown: event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); setOptions(item); } },
  });
  const act = fn => { fn(); setOptions(null); };
  const pinned = options && (options.entity
    ? organization.favorites.some(f => f.view === options.group && f.id === options.id)
    : organization.pinnedLayout.includes(options.id));
  const dialog = options ? <Dialog title={options.title} subtitle="Organize your sidebar. These changes do not change workspace content." onClose={() => setOptions(null)}>
    <div className="sidebar-item-dialog">
      <Button onClick={() => act(() => {
        if (options.entity) toggleFavorite({ view: options.group, id: options.id });
        else save({ pinnedLayout: pinned ? organization.pinnedLayout.filter(id => id !== options.id) : [...organization.pinnedLayout, options.id] });
      })}>{pinned ? 'Unpin' : 'Pin'}</Button>
      <Button onClick={() => act(() => save(options.entity
        ? { hiddenItems: [...organization.hiddenItems, { view: options.group, id: options.id }] }
        : { visibility: { ...organization.visibility, [options.id]: 'hidden' } }))}>Hide from sidebar</Button>
      {[-1, 1].map(offset => <Button key={offset} disabled={offset < 0 ? list(options).indexOf(options.id) === 0 : list(options).indexOf(options.id) === list(options).length - 1} onClick={() => act(() => reorder(options, moveItem(list(options), options.id, offset)))}>Move {offset < 0 ? 'up' : 'down'}</Button>)}
      {options.kind ? <Button onClick={() => act(() => create(options.kind, options.defaults ?? {}))}>Create new {options.kind === 'task' ? 'Route' : options.kind}</Button> : null}
    </div>
  </Dialog> : null;
  return { bind, dialog };
}

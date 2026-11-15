import { useRef, useState } from 'react';
import { Button, Dialog, ErrorMessage, Select, useApp } from '../ui.jsx';
import { ArrowDown, ArrowUp, RotateCcw } from './icons.jsx';
import { NAV_ITEMS, SECTION_LABELS, normalizeOrganization, resolveFavorite, favoriteKey } from '../lib/organization.js';
import { BUILTIN_GROUPS, moveSidebarEntry, removeSidebarGroup, entityKey, parseEntityKey, isFixedSidebarEntry } from '../lib/sidebar-layout.js';
import { visible } from '../lib/model.js';
import { isLocalProduct } from '../lib/local-product.js';
import { LOCAL_PRIMARY_NAV, LOCAL_SIDEBAR_PAGES, isLocalNavigationItemAllowed, isLocalSidebarItemAllowed } from '../lib/local-navigation.js';
import { localSidebarEditorDraft, savedLocalSidebarDraft } from '../lib/local-sidebar-customization.js';

export function SidebarEditor({ onClose }) {
  const { organization, updateOrganization, workspace, data } = useApp();
  const local = isLocalProduct(data);
  const [draft, setDraft] = useState(() => local ? localSidebarEditorDraft(organization) : normalizeOrganization(organization)), [error, setError] = useState(null), [name, setName] = useState('');
  const drag = useRef(null);
  const label = key => {
    const ref = parseEntityKey(key);
    return ref ? resolveFavorite(data, ref)?.title ?? 'Unavailable item' : draft.layout.groups.find(g => g.id === key)?.name ?? (local ? LOCAL_SIDEBAR_PAGES.find(page => page.id === key)?.label : undefined) ?? SECTION_LABELS[key] ?? NAV_ITEMS.find(n => n.id === key)?.label ?? key;
  };
  const fixedEntry = key => isFixedSidebarEntry(key) || local && LOCAL_PRIMARY_NAV.some(item => item.id === key);
  const visibleEntry = key => !local || isLocalSidebarItemAllowed(key);
  const CustomGroupsWrapper = local ? 'details' : 'section';
  const patch = value => setDraft(current => ({ ...current, ...value }));
  const move = (key, container, target, after) => setDraft(current => ({ ...current, layout: moveSidebarEntry(current.layout, key, container, target, after) }));
  const dragProps = (key, container) => ({
    draggable: !fixedEntry(key),
    onDragStart: event => { if (fixedEntry(key)) { event.preventDefault(); return; } drag.current = key; event.dataTransfer.setData('text/plain', label(key)); },
    onDragOver: event => { if (drag.current && !fixedEntry(key)) event.preventDefault(); },
    onDrop: event => { event.preventDefault(); if (drag.current && !fixedEntry(key)) { const box = event.currentTarget.getBoundingClientRect(); move(drag.current, container, key, event.clientY > box.top + box.height / 2); } drag.current = null; },
    onDragEnd: () => { drag.current = null; },
  });
  const row = (key, container, items) => {
    if (!visibleEntry(key)) return null;
    const ref = parseEntityKey(key), group = draft.layout.groups.find(g => g.id === key);
    const index = items.indexOf(key), fixed = fixedEntry(key);
    if (local && fixed) return <div className="sidebar-layout-editor-row sidebar-fixed-page" key={key} data-sidebar-page={key}><span>{label(key)}</span><small>Always available</small></div>;
    return <div className="sidebar-layout-editor-row" key={key} data-sidebar-page={key} {...dragProps(key, container)}>
      <span>{label(key)}</span>
      <div className="sidebar-reorder">{[-1,1].map(offset => <button key={offset} aria-label={'Move ' + label(key) + (offset < 0 ? ' up' : ' down')} disabled={fixed || !items[index + offset] || fixedEntry(items[index + offset])} onClick={() => move(key, container, items[index + offset], offset > 0)}>{offset < 0 ? <ArrowUp /> : <ArrowDown />}</button>)}</div>
      {!fixed && !group && !BUILTIN_GROUPS.includes(key) ? <Select aria-label={'Group for ' + label(key)} value={container} onChange={value => move(key, value)}><option value="root">Top level</option>{draft.layout.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</Select> : null}
      {!ref ? <Select aria-label={label(key) + ' visibility'} disabled={key === 'rumbo-agent' || fixed} value={fixed && local ? 'always' : draft.visibility[key] ?? 'always'} onChange={value => patch({ visibility: { ...draft.visibility, [key]: value } })}><option value="always">Show</option><option value="hidden">Hide</option>{!group && (!local || key !== 'updates') ? <option value="activity">With activity</option> : null}</Select> : null}
      {fixed ? <span className="organization-note">Fixed at top</span> : !ref && NAV_ITEMS.some(item => item.id === key) ? <Button onClick={() => patch({ pinnedLayout: draft.pinnedLayout.includes(key) ? draft.pinnedLayout.filter(id => id !== key) : [...draft.pinnedLayout, key] })}>{draft.pinnedLayout.includes(key) ? 'Unpin tab' : 'Pin tab'}</Button> : null}
    </div>;
  };
  return <Dialog title="Customize sidebar" subtitle={'Your layout for ' + workspace.name} onClose={onClose} className="sidebar-editor">
    <div className="sidebar-editor-body">
      <div className="sidebar-editor-preferences">
        {!local ? <label><span>Navigation <small>Focused shows the core work pages. Other pages remain in More and search.</small></span><Select aria-label="Sidebar navigation mode" value={draft.navigationMode} onChange={navigationMode => patch({ navigationMode })}><option value="focused">Focused</option><option value="full">All tools</option></Select></label> : <p className="organization-note">Choose your sidebar pages. Docs and Settings open separately.</p>}
        <label><span>Badge style</span><Select aria-label="Sidebar badge style" value={draft.badges} onChange={badges => patch({ badges })}><option value="count">Count</option><option value="dot">Dot</option><option value="none">None</option></Select></label>
        <label><span>Row spacing</span><Select aria-label="Sidebar spacing" value={draft.density} onChange={density => patch({ density })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></Select></label>
      </div>
      <CustomGroupsWrapper className={local ? 'sidebar-custom-groups-disclosure' : undefined}>{local ? <summary>Custom groups <span>{draft.layout.groups.length}</span></summary> : <h3>Custom groups</h3>}<p className="organization-note">{local ? 'Organize pages in your own groups.' : 'Only your custom groups accept dropped tabs. Built-in groups can be moved, but cannot accept new items.'}</p>
        <div className="sidebar-custom-editor"><input aria-label="New group name" placeholder="Group name" maxLength={60} value={name} onChange={event => setName(event.target.value)} /><Button disabled={!name.trim() || draft.layout.groups.length >= 30} onClick={() => { const id = 'custom:' + crypto.randomUUID(); patch({ layout: { root: [...draft.layout.root, id], groups: [...draft.layout.groups, { id, name: name.trim(), items: [], collapsed: false }] } }); setName(''); }}>Create group</Button></div>
        {draft.layout.groups.map(group => <div key={group.id}><div className="sidebar-custom-editor"><input aria-label={'Rename ' + group.name} value={group.name} maxLength={60} onChange={event => patch({ layout: { ...draft.layout, groups: draft.layout.groups.map(g => g.id === group.id ? { ...g, name: event.target.value } : g) } })} /><Button onClick={() => patch({ layout: removeSidebarGroup(draft.layout, group.id) })}>Remove group</Button></div>{group.items.filter(visibleEntry).map(key => row(key, group.id, group.items.filter(visibleEntry)))}<p className="organization-note">Removing a group moves its tabs back to the sidebar.</p></div>)}
      </CustomGroupsWrapper>
      <section><h3>{local ? 'Pages & sidebar order' : 'Sidebar order'}</h3><p className="organization-note">{local ? 'Show, hide, reorder or group pages. Hidden pages stay in More and search.' : 'Today and Frondose stay at the top. Frondose is always visible. Pin adds a shortcut to the header or floating dock, according to your Appearance setting, without moving the sidebar row. Reorder rows with drag or arrows, or use “Group for” to move them into custom groups.'}</p>{local ? LOCAL_PRIMARY_NAV.map(item => row(item.id, 'root', LOCAL_PRIMARY_NAV.map(item => item.id))) : null}{draft.layout.root.filter(visibleEntry).filter(key => !local || !LOCAL_PRIMARY_NAV.some(item => item.id === key)).map((key, index, items) => row(key, 'root', items))}</section>
      <section><h3>{local ? 'Project and Area shortcuts' : 'Project, team, agent, and chat shortcuts'}</h3>{['projects','teams','agents','chats'].filter(view => !local || isLocalNavigationItemAllowed(view)).flatMap(view => visible(data[view] ?? []).map(item => {
        const key = entityKey(view, item.id);
        const placed = draft.layout.root.includes(key) || draft.layout.groups.some(g => g.items.includes(key));
        if (placed) return null;
        return <div className="sidebar-layout-editor-row" key={key}><span>{item.name || item.title}</span><Button onClick={() => move(key, 'root')}>Move to top level</Button><Select aria-label={'Group for ' + (item.name || item.title)} value="" onChange={value => { if (value) move(key, value); }}><option value="">Move to group…</option>{draft.layout.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></div>;
      }))}</section>
      <section><h3>Hidden items</h3>{draft.hiddenItems.filter(ref => !local || isLocalNavigationItemAllowed(ref)).map(ref => <div className="sidebar-layout-editor-row" key={favoriteKey(ref)}><span>{resolveFavorite(data, ref)?.title || 'Unavailable item'}</span><Button onClick={() => patch({ hiddenItems: draft.hiddenItems.filter(item => favoriteKey(item) !== favoriteKey(ref)) })}>Restore</Button></div>)}</section>
      <ErrorMessage error={error} />
    </div>
    <footer className="dialog-footer"><Button icon={RotateCcw} onClick={() => { const defaults = local ? localSidebarEditorDraft(null) : normalizeOrganization(null); setDraft({ ...draft, layout: defaults.layout, order: defaults.order, visibility: defaults.visibility, navigationMode: defaults.navigationMode, localSidebarCustomized: defaults.localSidebarCustomized, pinnedLayout: [], hiddenItems: [], entityOrder: defaults.entityOrder }); }}>Reset layout</Button><span className="dialog-footer-spacer" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { try { updateOrganization(local ? savedLocalSidebarDraft(draft) : draft); onClose(); } catch (cause) { setError(cause); } }}>Save layout</Button></footer>
  </Dialog>;
}

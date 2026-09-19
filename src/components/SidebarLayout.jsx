import { Children, cloneElement } from 'react';
import { ChevronRight, ChevronDown, Ellipsis } from './icons.jsx';
import { parseEntityKey } from '../lib/sidebar-layout.js';

export function SidebarLayout({ children, organization, arrange, renderTab, renderEntity, updateOrganization, customizeSidebar }) {
  const builtins = new Map();
  Children.forEach(children, child => { if (child?.props?.['data-layout-id']) builtins.set(child.props['data-layout-id'], child); });
  const renderEntry = (key, container = 'root') => {
    if (organization.visibility[key] === 'hidden') return null;
    const group = organization.layout.groups.find(g => g.id === key);
    let node;
    if (group) node = <section className="sidebar-custom-group">
      <div className="sidebar-section-heading" {...arrange.bind({ id: key, title: group.name })}>
        <button className="section-disclosure" aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.name}`} aria-expanded={!group.collapsed} onClick={() => updateOrganization({ ...organization, layout: { ...organization.layout, groups: organization.layout.groups.map(g => g.id === key ? { ...g, collapsed: !g.collapsed } : g) } })}><ChevronRight morphTo={group.collapsed ? ChevronRight : ChevronDown} /></button>
        <span className="section-title">{group.name}</span><button aria-label={`Edit ${group.name} group`} onClick={customizeSidebar}><Ellipsis /></button>
      </div>
      {!group.collapsed ? <div className="sidebar-custom-children">{group.items.map(id => renderEntry(id, key))}</div> : null}
      {arrange.dragging || !group.items.length ? <div className="sidebar-custom-drop" {...arrange.drop(key)}>Drop tabs into {group.name}</div> : null}
    </section>;
    else if (builtins.has(key)) node = cloneElement(builtins.get(key), { style: { ...builtins.get(key).props.style, order: undefined } });
    else if (parseEntityKey(key)) node = renderEntity(parseEntityKey(key));
    else node = renderTab(key);
    if (!node) return null;
    return <div className="sidebar-layout-entry" data-layout-entry={key} key={key} {...arrange.drop(container, key)}>{node}</div>;
  };
  return <div className={`sidebar-free-layout ${arrange.dragging ? 'is-dragging' : ''}`}>
    {organization.layout.root.map(key => renderEntry(key))}
    <div className="sidebar-end-drop" {...arrange.drop('root')} aria-label="Move to end of sidebar">{arrange.dragging ? 'Move to end of sidebar' : null}</div>
  </div>;
}

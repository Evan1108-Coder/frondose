import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, ErrorMessage, useApp } from '../ui.jsx';
import { useDisplayPreferences, readDisplayPreferences } from '../lib/display-preferences.js';
import { groupColorDefaults, pageTeam, resolveNavColors, resolveEmptyIconColor } from '../lib/icon-colors.js';
import { ColorPolicyChoice } from './ColorPolicyChoice.jsx';
import { NAV_ITEMS } from '../lib/organization.js';
import { SETTINGS_GROUPS } from '../lib/settings-catalog.js';
import './team-appearance.css';

const IconColorsContext = createContext(null);
export const TEAM_TABS = [['overview', 'Overview'], ['routes', 'Routes'], ['projects', 'Projects'], ['resources', 'Resources'], ['documents', 'Documents'], ['updates', 'Updates'], ['people', 'Contacts']];
export const PROJECT_TABS = [['projects', 'Overview'], ['workbench', 'Workbench'], ['tasks', 'Routes'], ['chats', 'Chats'], ['library', 'Outputs'], ['memory', 'Memory'], ['strategy', 'Strategy & risks'], ['timeline', 'Timeline'], ['documents', 'Documents'], ['updates', 'Updates'], ['changes', 'Changes'], ['activity', 'Activity']];
export function useIconColors() { return useContext(IconColorsContext); }

export function IconColorsProvider({ children }) {
  const { workspace, data, page, organization } = useApp();
  const [settings, save] = useDisplayPreferences();
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const keyFor = id => `${workspace.id}/${id}`;
  const getOverride = id => settings.tabColors[keyFor(id)] || {};
  const groupFor = id => organization.layout.groups.find(group => group.items.includes(id.replace(/^main:/, '')));
  const inheritedTeam = (id, team) => {
    if (team) return team;
    const group = groupFor(id);
    if (!group) return undefined;
    return groupColorDefaults(getOverride(group.id));
  };
  const colorsFor = (id, team) => resolveNavColors(settings, inheritedTeam(id, id.endsWith(':identity') && team ? { ...team, tab_icon_color: team.icon_color || 'global' } : team), getOverride(id));
  function update(id, patch) {
    try {
      const current = readDisplayPreferences().tabColors;
      save({ tabColors: { ...current, [keyFor(id)]: { ...current[keyFor(id)], ...patch } } }); setError(null);
    } catch { setError(new Error('Could not save colors in this browser. Check available storage and try again.')); }
  }
  const team = pageTeam(page, data);
  const emptyColor = resolveEmptyIconColor(settings, team);
  const editingTeam = data.teams.find(team => team.id === editing?.team?.id);
  const editingGroup = editing && groupFor(editing.id);
  const preview = editing ? colorsFor(editing.id, editingTeam) : {};
  return <IconColorsContext.Provider value={{ settings, colorsFor, getOverride, editColors: item => { setError(null); setEditing(item); } }}><div className="icon-color-scope" style={{ '--empty-icon-color': emptyColor || 'var(--secondary)', '--empty-copy-color': settings.emptyTextColor || undefined }}>{children}</div>{editing ? createPortal(<Dialog title={`${editing.label} colors`} subtitle="Personal to this browser and workspace. The tab’s icon shape stays unchanged." onClose={() => setEditing(null)}><div className="tab-color-editor"><div className="tab-color-preview"><span style={{ color: preview.icon || 'var(--secondary)' }}>◇</span><strong style={{ color: preview.label || 'var(--text)' }}>{editing.label}</strong></div><ColorPolicyChoice label="Tab icon color" value={getOverride(editing.id).icon || 'inherit'} options={[[ 'inherit', editingTeam ? 'Follow Area settings' : editingGroup ? 'Follow group settings' : 'Follow global tab icon color'], ...(editingTeam || editingGroup ? [['global', 'Follow global tab icon color']] : [])]} onChange={icon => update(editing.id, { icon })} /><ColorPolicyChoice label="Tab name color" value={getOverride(editing.id).label || 'inherit'} options={[[ 'inherit', editingTeam ? 'Follow Area settings' : editingGroup ? 'Follow group settings' : 'Follow global tab name color'], ...(editingTeam || editingGroup ? [['global', 'Follow global tab name color']] : []), ['icon', 'Match this tab icon'], ['neutral', 'Theme default (neutral)']]} onChange={label => update(editing.id, { label })} /><p>Changes save immediately. “Follow” options update automatically when the source color changes.</p><ErrorMessage error={error} />{editing.onNavigate ? <button type="button" className="button secondary" onClick={() => { editing.onNavigate(); setEditing(null); }}>Open tab</button> : null}</div></Dialog>, document.body) : null}</IconColorsContext.Provider>;
}

/** One navigation target; appearance editing is deliberately confined to Settings. */
export function ColorableNavItem({ colorId, team, icon: Icon, label, title, children, compact = false, className = '', onClick, ...props }) {
  const { colorsFor } = useIconColors();
  const colors = colorsFor(colorId, team);
  const current = props['aria-current'];
  const accessibleName = props['aria-label'] || label;
  delete props['aria-current']; delete props['aria-label'];
  return <button {...props} type="button" className={`nav-item colorable-nav ${className}`} data-color-id={colorId} aria-label={accessibleName} aria-current={current} title={title} onClick={onClick}><span className="nav-color-trigger" style={{ color: colors.icon || undefined }} aria-hidden="true"><Icon /></span><span className="nav-color-link" style={{ color: colors.label || undefined }}><span>{label}</span>{children}</span></button>;
}

export function TabColorsSettings() {
  const { data, organization } = useApp();
  const { editColors, colorsFor } = useIconColors();
  const [query, setQuery] = useState('');
  const entries = [
    ...organization.layout.groups.map(group => ({ id: group.id, label: `Group · ${group.name}` })),
    ...NAV_ITEMS.map(item => ({ id: `main:${item.id}`, label: item.label })),
    ...['agents', 'chats', 'projects'].flatMap(view => data[view].filter(item => !item.archived_at).map(item => ({ id: `entity:${view}:${item.id}`, label: `${view} · ${item.name || item.title}`, team: data.teams.find(t => t.id === item.team_id) }))),
    ...data.teams.filter(t => !t.archived_at).flatMap(team => TEAM_TABS.map(([id, label]) => ({ id: `team:${team.id}:${id}`, label: `${team.name} · ${label}`, team }))),
    ...data.projects.filter(p => !p.archived_at).flatMap(project => PROJECT_TABS.map(([id, label]) => ({ id: `project:${project.id}:${id}`, label: `${project.name} · ${label}`, team: data.teams.find(t => t.id === project.team_id) }))),
    ...SETTINGS_GROUPS.flatMap(([group, items]) => items.map(([id, label]) => ({ id: `settings:${id}`, label: `Settings · ${group} · ${label}` }))),
  ];
  return <section className="tab-colors-settings"><h3>Individual tabs</h3><p>Tabs follow their team or global colors by default. Choose a tab here to customize it. Overrides apply only to this workspace in your browser.</p><input aria-label="Find a tab color setting" placeholder="Find a tab…" value={query} onChange={e => setQuery(e.target.value)} /><div className="tab-colors-list">{entries.filter(e => e.label.toLowerCase().includes(query.toLowerCase())).map(entry => { const colors = colorsFor(entry.id, entry.team); return <button type="button" key={entry.id} onClick={() => editColors(entry)}><i style={{ background: colors.icon || 'var(--secondary)' }} /><span style={{ color: colors.label || undefined }}>{entry.label}</span><small>Edit colors</small></button>; })}</div></section>;
}

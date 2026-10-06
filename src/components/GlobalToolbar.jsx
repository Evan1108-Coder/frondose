import { useState } from 'react';
import { Dialog, useApp } from '../ui.jsx';
import { Focus, Search, Settings } from './icons.jsx';
import { initials } from '../lib/model.js';
import { favoriteKey, resolveFavorite } from '../lib/organization.js';
import { NAV } from './Shell.jsx';
import { FloatingPinnedDock } from './FloatingPinnedDock.jsx';
import { useRumboAgentAppearance } from '../lib/rumbo-agent-appearance.js';
import './global-toolbar.css';

export function GlobalToolbar({ onSearch }) {
  const { data, navigate, page, organization, workspace } = useApp();
  const agentAppearance = useRumboAgentAppearance(workspace?.id);
  const [languageOpen, setLanguageOpen] = useState(false);
  const tabs = [...new Set([...(organization.quickAccess ?? ['focus', 'settings']), ...(organization.showPinnedInHeader !== false ? organization.pinnedLayout ?? [] : [])])]
    .map(id => NAV.find(item => item.id === id)).filter(Boolean);
  const pinnedItems = organization.showPinnedInHeader !== false ? (organization.favorites ?? []).map(reference => resolveFavorite(data, reference)).filter(Boolean) : [];
  return <div className="global-toolbar" aria-label="Workspace tools">
    <button type="button" className="global-search" onClick={onSearch} aria-label="Search all Rumbo content, settings, and documentation"><Search aria-hidden="true" /><span>Search</span><kbd>⌘ K</kbd></button>
    <div className="global-quick-access" aria-label="Header quick access">
      {tabs.map(item => { const Icon = item.icon || (item.id === 'settings' ? Settings : Focus); const label = item.id === 'rumbo-agent' ? agentAppearance.display_name : item.label; return <button type="button" key={item.id} className="global-tool" title={label} aria-label={`Open ${label}`} aria-current={page.view === item.id ? 'page' : undefined} onClick={() => navigate(item.id, item.id === 'settings' ? 'preferences' : null)}><Icon aria-hidden="true" /></button>; })}
      {pinnedItems.map(item => { const Icon = NAV.find(entry => entry.id === item.view)?.icon || Focus; return <button type="button" key={favoriteKey(item)} className="global-tool global-pinned-item" title={item.title} aria-label={`Open pinned ${item.title}`} aria-current={page.view === item.view && page.id === item.id ? 'page' : undefined} onClick={() => navigate(item.view, item.id)}><Icon aria-hidden="true" /></button>; })}
    </div>
    <button type="button" className="global-language" aria-label="Interface language" onClick={() => setLanguageOpen(true)}>EN</button>
    <button type="button" className="global-profile" aria-label="Open your profile" onClick={() => navigate('settings', 'profile')}>{data.profile?.avatar_url ? <img src={data.profile.avatar_url} alt="" /> : initials(data.profile?.name)}</button>
    <FloatingPinnedDock />
    {languageOpen ? <Dialog title="Interface language" onClose={() => setLanguageOpen(false)}><div className="global-language-dialog"><p>English is the only complete interface translation in this build. Other languages need reviewed translations across the whole app before they can be offered here.</p><button type="button" onClick={() => setLanguageOpen(false)}>Continue in English</button></div></Dialog> : null}
  </div>;
}

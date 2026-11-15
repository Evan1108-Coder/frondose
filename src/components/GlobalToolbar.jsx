import {useInterfaceLanguage} from './InterfaceLanguage.jsx';
import {INTERFACE_LANGUAGES,interfaceText} from '../lib/interface-language.js';
import { useApp } from '../ui.jsx';
import { Focus, Search, Settings } from './icons.jsx';
import { initials } from '../lib/model.js';
import { favoriteKey, resolveFavorite } from '../lib/organization.js';
import { NAV, navigationForProduct } from './Shell.jsx';
import { FloatingPinnedDock } from './FloatingPinnedDock.jsx';
import { useFrondoseAgentAppearance } from '../lib/frondose-agent-appearance.js';
import { isLocalProduct } from '../lib/local-product.js';
import { isLocalNavigationItemAllowed } from '../lib/local-navigation.js';
import { localWorkspaceQuickAccess } from '../lib/local-settings-catalog.js';
import './global-toolbar.css';

export function GlobalToolbar({ onSearch }) {
  const { data, navigate, page, organization, workspace } = useApp();
  const agentAppearance = useFrondoseAgentAppearance(isLocalProduct(data) ? null : workspace?.id);
  const language=useInterfaceLanguage();
  const navigation = navigationForProduct(data);
  const tabs = localWorkspaceQuickAccess([...new Set([...(organization.quickAccess ?? ['focus', 'settings']), ...(organization.showPinnedInHeader !== false ? organization.pinnedLayout ?? [] : [])])], data)
    .filter(id => !isLocalProduct(data) || isLocalNavigationItemAllowed(id)).map(id => navigation.find(item => item.id === id)).filter(Boolean);
  const pinnedItems = organization.showPinnedInHeader !== false ? (organization.favorites ?? []).map(reference => resolveFavorite(data, reference)).filter(Boolean) : [];
  return <div className="global-toolbar" aria-label="Workspace tools">
    <button type="button" className="global-search" onClick={onSearch} aria-label="Search all Frondose content, settings, and documentation"><Search aria-hidden="true" /><span>Search</span><kbd>⌘ K</kbd></button>
    <div className="global-quick-access" aria-label="Header quick access">
      {tabs.map(item => { const Icon = item.icon || (item.id === 'settings' ? Settings : Focus); const label = item.id === 'rumbo-agent' ? agentAppearance.display_name : item.label; return <button type="button" key={item.id} className="global-tool" title={label} aria-label={`Open ${label}`} aria-current={page.view === item.id ? 'page' : undefined} onClick={() => navigate(item.id, item.id === 'settings' ? 'preferences' : null)}><Icon aria-hidden="true" /></button>; })}
      {pinnedItems.map(item => { const Icon = NAV.find(entry => entry.id === item.view)?.icon || Focus; return <button type="button" key={favoriteKey(item)} className="global-tool global-pinned-item" title={item.title} aria-label={`Open pinned ${item.title}`} aria-current={page.view === item.view && page.id === item.id ? 'page' : undefined} onClick={() => navigate(item.view, item.id)}><Icon aria-hidden="true" /></button>; })}
    </div>
    <button type="button" className="global-language" aria-label={interfaceText('Interface language',language)} onClick={() => navigate('settings','languages')}>{INTERFACE_LANGUAGES.find(row=>row.id===language)?.code||'EN'}</button>
    <button type="button" className="global-profile" aria-label="Open your profile" title={data.profile?.self_display_name || data.profile?.name || 'You'} onClick={() => navigate('settings', 'profile')}>{data.profile?.avatar_url ? <img src={data.profile.avatar_url} alt="" /> : initials(data.profile?.self_display_name || data.profile?.name)}</button>
    <FloatingPinnedDock />
  </div>;
}

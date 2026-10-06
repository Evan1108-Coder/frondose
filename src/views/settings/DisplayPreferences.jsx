import { useState } from 'react';
import { ErrorMessage, Toggle, useApp } from '../../ui.jsx';
import { ColorChoice } from '../../components/ColorChoice.jsx';
import { ColorPolicyChoice } from '../../components/ColorPolicyChoice.jsx';
import { TabColorsSettings } from '../../components/IconColors.jsx';
import { EmptyIllustration } from '../../components/EmptyState.jsx';
import { useDisplayPreferences } from '../../lib/display-preferences.js';
import { HEADER_QUICK_ACCESS, NAV_ITEMS } from '../../lib/organization.js';

export function DisplayPreferences({ colors = false }) {
  const [settings, save] = useDisplayPreferences();
  const { organization, updateOrganization } = useApp();
  const [error, setError] = useState(null);
  const update = patch => { try { save(patch); setError(null); } catch { setError(new Error('Your browser could not save this preference. Check available storage and try again.')); } };
  const setQuickAccess = (id, checked) => {
    const current = organization.quickAccess ?? ['focus', 'settings'];
    const next = checked ? [...current, id] : current.filter(value => value !== id);
    try { updateOrganization({ ...organization, quickAccess: next }); setError(null); }
    catch (cause) { setError(cause); }
  };
  return <section className="settings-panel display-preferences"><h2>{colors ? 'Icons & name colors' : 'Chat scrolling'}</h2><p>Personal to this browser. Area defaults are shared; your individual overrides are not.</p>{colors ? <>
    <div className="empty-color-preview" style={{ '--empty-icon-color': settings.emptyIconColor || 'var(--text)' }}><EmptyIllustration kind="teams" /><strong style={{ color: settings.emptyTextColor || 'var(--text)' }}>Empty-state preview</strong></div>
    <ColorChoice label="Global empty-state image tint" value={settings.emptyIconColor} onChange={emptyIconColor => update({ emptyIconColor })} />
    <p>Generated images retain their photographed material and shading. This color tints them; the default is neutral, not the Area color. Area overrides are optional below.</p>
    <Toggle label="Use Area image tints" checked={settings.emptyIconFollowArea} onChange={emptyIconFollowArea => update({ emptyIconFollowArea })} />
    <ColorChoice label="Empty-state text color" value={settings.emptyTextColor} onChange={emptyTextColor => update({ emptyTextColor })} />
    <p>Headings and descriptions use neutral theme colors by default, independently of Area and illustration colors. Choose a custom text color here if you prefer.</p>
    <ColorChoice label="Global tab icon color" value={settings.tabIconColor} onChange={tabIconColor => update({ tabIconColor })} />
    <ColorPolicyChoice label="Global tab name color" value={settings.tabLabelColor} options={[[ 'neutral', 'Theme default (neutral)'], ['icon', 'Match each tab icon']]} onChange={tabLabelColor => update({ tabLabelColor })} />
    <p>Tab names start neutral. Area and custom-group settings are inherited automatically; explicit per-tab choices take priority.</p>
    <TabColorsSettings />
    <section className="header-shortcut-settings" aria-label="Header quick access"><h3>Header quick access</h3><p>Choose up to eight page shortcuts for the top bar. Pinned tabs and starred items do not create a second sidebar group.</p><div>{HEADER_QUICK_ACCESS.map(id => {
      const checked = (organization.quickAccess ?? ['focus', 'settings']).includes(id);
      const label = NAV_ITEMS.find(item => item.id === id)?.label ?? id;
      return <label key={id}><input type="checkbox" checked={checked} disabled={!checked && (organization.quickAccess ?? ['focus', 'settings']).length >= 8} onChange={event => setQuickAccess(id, event.target.checked)} /><span>{label}</span></label>;
    })}</div><div className="header-pinned-placement"><Toggle label="Show pinned tabs in header" description="Turn off to use a draggable floating dock instead. Move it near a screen side for a vertical dock." checked={organization.showPinnedInHeader !== false} onChange={showPinnedInHeader => updateOrganization({ ...organization, showPinnedInHeader })} /></div></section>
  </> : <><Toggle label="Smoothly follow new chat messages" checked={settings.smoothChatScroll} onChange={smoothChatScroll => update({ smoothChatScroll })} /><p>On by default. New messages ease into view while you’re at the bottom. Scroll up to pause; choose Latest messages to resume. Reduced motion skips the animation.</p></>}<ErrorMessage error={error} /></section>;
}

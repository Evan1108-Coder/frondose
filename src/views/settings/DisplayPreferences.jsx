import { useState } from 'react';
import { ErrorMessage, Toggle } from '../../ui.jsx';
import { ColorChoice } from '../../components/ColorChoice.jsx';
import { ColorPolicyChoice } from '../../components/ColorPolicyChoice.jsx';
import { TabColorsSettings } from '../../components/IconColors.jsx';
import { EmptyIllustration } from '../../components/EmptyState.jsx';
import { useDisplayPreferences } from '../../lib/display-preferences.js';

export function DisplayPreferences({ colors = false }) {
  const [settings, save] = useDisplayPreferences();
  const [error, setError] = useState(null);
  const update = patch => { try { save(patch); setError(null); } catch { setError(new Error('Your browser could not save this preference. Check available storage and try again.')); } };
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
  </> : <><Toggle label="Smoothly follow new chat messages" checked={settings.smoothChatScroll} onChange={smoothChatScroll => update({ smoothChatScroll })} /><p>On by default. New messages ease into view while you’re at the bottom. Scroll up to pause; choose Latest messages to resume. Reduced motion skips the animation.</p></>}<ErrorMessage error={error} /></section>;
}

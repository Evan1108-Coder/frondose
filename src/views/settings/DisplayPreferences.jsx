import { useState } from 'react';
import { ErrorMessage, Toggle } from '../../ui.jsx';
import { ColorChoice } from '../../components/ColorChoice.jsx';
import { EmptyIllustration } from '../../components/EmptyState.jsx';
import { useDisplayPreferences } from '../../lib/display-preferences.js';

export function DisplayPreferences({ colors = false }) {
  const [settings, save] = useDisplayPreferences();
  const [error, setError] = useState(null);
  const update = patch => { try { save(patch); setError(null); } catch { setError(new Error('Your browser could not save this preference. Check available storage and try again.')); } };
  return <section className="settings-panel display-preferences"><h2>{colors ? 'Empty-state icons' : 'Chat scrolling'}</h2><p>Personal to this browser. Other people’s preferences are unchanged.</p>{colors ? <><div className="empty-color-preview"><EmptyIllustration kind="teams" /></div><ColorChoice label="Empty-state icon color" value={settings.emptyIconColor} onChange={emptyIconColor => update({ emptyIconColor })} /><p>Used for illustrations in empty tabs. Choose Default to follow the theme. Team icons have their own colors.</p></> : <><Toggle label="Smoothly follow new chat messages" checked={settings.smoothChatScroll} onChange={smoothChatScroll => update({ smoothChatScroll })} /><p>On by default. New messages ease into view while you’re at the bottom. Scroll up to pause; choose Latest messages to resume. Reduced motion skips the animation.</p></>}<ErrorMessage error={error} /></section>;
}

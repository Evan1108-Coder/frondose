import { useState } from 'react';
import { useExternalFileSettings } from '../../lib/external-file-settings.js';
export function ExternalFileSettings() {
  const [settings, save] = useExternalFileSettings(), [error, setError] = useState('');
  const toggle = (key, value) => { try { save({ [key]: value }); setError(''); } catch { setError('This browser could not save the preference. Nothing was changed.'); } };
  return <section className="settings-panel identity-setup external-file-settings"><h2>External file changes</h2>
    <p>Checks visible files every 3 seconds and when you return to Frondose. Other editors’ unsaved buffers are not visible.</p>
    {[['autoReload', 'Reload unchanged drafts automatically', 'Reload saved disk changes only when you have no local edits.'], ['autoMerge', 'Merge non-overlapping edits into my draft', 'Off by default. Never saves automatically. Lockfiles always require review.'], ['recovery', 'Keep local recovery copies', 'Keeps up to 20 text copies in this app or browser, at most 4 per file. Old copies expire as space is needed.']].map(([key, label, description]) => <label key={key} className="external-file-setting"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={settings[key]} onChange={event => toggle(key, event.target.checked)} /></label>)}
    <p>Recovery copies include file text, stay on this device, and are not encrypted by Frondose. Disabling recovery stops new copies; existing copies remain available from each file’s state badge.</p>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}

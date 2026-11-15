import { Field } from '../../ui.jsx';
import { useEditorChanges } from '../../lib/editor-changes.js';

export function EditorChangesSettings() {
  const [settings, save] = useEditorChanges();
  return <section className="settings-panel identity-setup"><h2>Recent file changes</h2><Field label="Recent changes interval (minutes)"><input type="number" min={1} max={1440} value={settings.recentMinutes} onChange={event => { if (event.target.value !== '') save({ recentMinutes: Number(event.target.value) }); }} /></Field><p>Compare edits Frondose has observed while files are open. History is kept only in bounded app memory; it does not recover edits made before tracking began.</p></section>;
}

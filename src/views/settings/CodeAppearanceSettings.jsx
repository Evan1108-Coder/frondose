import { useState } from 'react';
import { Button, Field, Select, Toggle, useApp } from '../../ui.jsx';
import { CodeViewer } from '../../components/CodeViewer.jsx';
import { CODE_DEFAULTS, useCodeAppearance } from '../../lib/code-appearance.js';
const PREVIEW = '@@ -1,4 +1,4 @@\n export function review(route) {\n-  const status = "in_progress";\n+  const status = "ready_for_review";\n   return { ...route, status };\n }';
export function CodeAppearanceSettings() {
  const [settings, save] = useCodeAppearance(), [preview, setPreview] = useState('diff');
  const { navigate } = useApp();
  return <><header className="settings-heading"><div><h1>Code & reviews</h1><p>Choose how source files and changes appear in GitHub and Workbench. These display preferences are personal to this browser.</p></div></header>
    <div className="code-settings-preview"><Select label="Preview" value={preview} onChange={setPreview}><option value="diff">Code changes</option><option value="file">Source file</option></Select><CodeViewer content={preview === 'diff' ? PREVIEW : 'export async function review(route) {\n  const result = await inspect(route);\n  // Keep the evidence with the work.\n  return { status: "review", result };\n}'} diff={preview === 'diff'} settings={settings} /></div>
    <section className="settings-panel identity-setup"><div className="cp-form-grid">
      <Select label="Code theme" value={settings.theme} onChange={theme => save({ theme })}><option value="app">Match Rumbo</option><option value="light">Light</option><option value="dark">Dark</option><option value="contrast">High contrast</option></Select>
      <Select label="Code font" value={settings.font} onChange={font => save({ font })}>{['system', 'Menlo', 'Monaco', 'Consolas'].map(font => <option key={font} value={font}>{font === 'system' ? 'System monospace' : font}</option>)}</Select>
      <Field label="Font size"><input type="number" min={10} max={24} value={settings.fontSize} onChange={e => save({ fontSize: Number(e.target.value) })} /></Field>
      <Field label="Line height"><input type="number" min={1.2} max={2.2} step={0.05} value={settings.lineHeight} onChange={e => save({ lineHeight: Number(e.target.value) })} /></Field>
      <Select label="Tab width" value={String(settings.tabSize)} onChange={value => save({ tabSize: Number(value) })}>{[2, 4, 8].map(value => <option key={value} value={value}>{value} spaces</option>)}</Select>
      <Select label="Diff layout" value={settings.diffLayout} onChange={diffLayout => save({ diffLayout })}><option value="unified">Unified</option><option value="split">Side by side</option></Select>
    </div>{[['wrap', 'Wrap long lines'], ['lineNumbers', 'Show line numbers'], ['syntax', 'Highlight code syntax'], ['diffMarkers', 'Show + / − change markers']].map(([key, label]) => <Toggle key={key} label={label} checked={settings[key]} onChange={value => save({ [key]: value })} />)}
    <div className="code-settings-actions"><Button onClick={() => save(CODE_DEFAULTS)}>Reset code appearance</Button><Button onClick={() => navigate('connections')}>Open GitHub connections</Button></div></section>
  </>;
}

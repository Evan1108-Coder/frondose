import { useState } from 'react';
import { Button, Field, SearchField, Select, Toggle, useApp } from '../../ui.jsx';
import { CodeViewer } from '../../components/CodeViewer.jsx';
import { CODE_DEFAULTS, useCodeAppearance } from '../../lib/code-appearance.js';
import { CODE_FONTS, BUNDLED_CODE_FONTS, codeFontFamily } from '../../lib/code-fonts.js';
import { CODE_THEMES, filterCodeChoices } from '../../lib/code-themes.js';
const PREVIEW = '@@ -1,4 +1,4 @@\n export function review(route) {\n-  const status = "in_progress";\n+  const status = "ready_for_review";\n   return { ...route, status };\n }';
export function CodeAppearanceSettings() {
  const [settings, save] = useCodeAppearance(), [preview, setPreview] = useState('diff');
  const [themeQuery, setThemeQuery] = useState(''), [fontQuery, setFontQuery] = useState(''), [tone, setTone] = useState('all');
  const themes = filterCodeChoices(CODE_THEMES, themeQuery, tone), fonts = filterCodeChoices(CODE_FONTS, fontQuery);
  const selectedTheme = CODE_THEMES.find(item => item.id === settings.theme), selectedFont = CODE_FONTS.find(item => item.id === settings.font);
  const { navigate } = useApp();
  return <><header className="settings-heading"><div><h1>Code & reviews</h1><p>Choose how source files and changes appear in GitHub and Workbench. These display preferences are personal to this browser.</p></div></header>
    <div className="code-settings-preview"><Select label="Preview" value={preview} onChange={setPreview}><option value="diff">Code changes</option><option value="file">Source file</option></Select><CodeViewer content={preview === 'diff' ? PREVIEW : 'export async function review(route) {\n  const result = await inspect(route);\n  // Keep the evidence with the work.\n  return { status: "review", result };\n}'} diff={preview === 'diff'} settings={settings} /></div>
    <section className="settings-panel identity-setup code-catalog"><div className="code-catalog-heading"><h2>Themes & fonts</h2><p>{CODE_THEMES.length} theme choices · {BUNDLED_CODE_FONTS.length} bundled fonts + system options</p></div><div className="cp-form-grid">
      <div className="code-catalog-column"><SearchField label="Find code themes" placeholder="Find a theme…" value={themeQuery} onChange={setThemeQuery} /><Select label="Theme appearance" value={tone} onChange={setTone}><option value="all">All appearances</option><option value="dark">Dark themes</option><option value="light">Light themes</option></Select><Select label="Code theme" value={settings.theme} onChange={theme => save({ theme })}>
        {!themes.some(item => item.id === settings.theme) ? <optgroup label="Current selection"><option value={selectedTheme.id}>{selectedTheme.label}</option></optgroup> : null}
        {['automatic', 'dark', 'light'].map(group => <optgroup key={group} label={group === 'automatic' ? 'Automatic' : `${group === 'dark' ? 'Dark' : 'Light'} themes`}>{themes.filter(item => item.tone === group).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
      </Select><small role="status">{themes.length} matching themes. Search does not change your selection.</small>{selectedTheme.colors ? <div className="code-palette-swatches" aria-label={`${selectedTheme.label} palette`}>{Object.entries(selectedTheme.colors).map(([key, color]) => <span key={key} style={{ background: color }} title={`${key}: ${color}`} />)}</div> : null}</div>
      <div className="code-catalog-column"><SearchField label="Find code fonts" placeholder="Find a font…" value={fontQuery} onChange={setFontQuery} /><Select label="Code font" value={settings.font} onChange={font => save({ font })}>
        {!fonts.some(item => item.id === settings.font) ? <optgroup label="Current selection"><option value={selectedFont.id}>{selectedFont.label}</option></optgroup> : null}
        <optgroup label="Bundled · no installation needed">{fonts.filter(item => item.bundled).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup><optgroup label="System fonts">{fonts.filter(item => !item.bundled).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>
      </Select><small role="status">{fonts.length} matching fonts. Bundled fonts are served by Rumbo, not a third-party CDN.</small><div className="code-font-specimen" style={{ fontFamily: codeFontFamily(settings.font) }}><span>{selectedFont.label}</span><code>0O 1Il {'{} [] () => !='}<br />The quick brown fox 0123456789</code></div></div>
    </div></section>
    <section className="settings-panel identity-setup"><div className="cp-form-grid">
      <Field label="Font size"><input type="number" min={10} max={24} value={settings.fontSize} onChange={e => save({ fontSize: Number(e.target.value) })} /></Field>
      <Field label="Line height"><input type="number" min={1.2} max={2.2} step={0.05} value={settings.lineHeight} onChange={e => save({ lineHeight: Number(e.target.value) })} /></Field>
      <Select label="Tab width" value={String(settings.tabSize)} onChange={value => save({ tabSize: Number(value) })}>{[2, 4, 8].map(value => <option key={value} value={value}>{value} spaces</option>)}</Select>
      <Select label="Diff layout" value={settings.diffLayout} onChange={diffLayout => save({ diffLayout })}><option value="unified">Unified</option><option value="split">Side by side</option></Select>
    </div>{[['wrap', 'Wrap long lines'], ['lineNumbers', 'Show line numbers'], ['syntax', 'Highlight code syntax'], ['diffMarkers', 'Show + / − change markers'], ['hideWhitespace', 'Hide whitespace-only changes in reviews']].map(([key, label]) => <Toggle key={key} label={label} checked={settings[key]} onChange={value => save({ [key]: value })} />)}
    <div className="code-settings-actions"><Button onClick={() => { save(CODE_DEFAULTS); setThemeQuery(''); setFontQuery(''); setTone('all'); }}>Reset code appearance</Button><Button onClick={() => navigate('connections')}>Open GitHub connections</Button></div><p className="code-catalog-notes">Font selection affects source and diff previews, not terminal output or interface text. Fonts include Latin glyphs; other scripts use your system fallback. Syntax palettes are adapted to Rumbo’s lightweight highlighter. <a href="/licenses/code-themes.txt" target="_blank" rel="noreferrer">Theme licenses</a> · <a href="/licenses/code-fonts.txt" target="_blank" rel="noreferrer">Font licenses</a></p></section>
  </>;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSync } from 'esbuild';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const bundle = buildSync({ stdin: { contents: `export {NavigationHistory} from './src/components/NavigationHistory.jsx'; export {AppContext} from './src/app-context.js';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require);
const { NavigationHistory, AppContext } = module.exports;
function render(showControls) {
  return renderToStaticMarkup(React.createElement(AppContext.Provider, { value: { page: { view: 'overview' }, navigate() {} } }, React.createElement(NavigationHistory, { showControls })));
}
test('headless global history renders no label, arrows or empty wrapper', () => {
  assert.equal(render(false), '');
  assert.match(render(true), /Workspace history/);
});
test('the shared topbar removes the breadcrumb strip but retains tools and tabs', () => {
  const app = source('src/App.jsx');
  assert.doesNotMatch(app, /<Breadcrumbs|workspace-surface-title|Current workspace tab|activeSurface|setActiveSurface/);
  assert.match(app, /<NavigationHistory key=\{workspace.id\} showControls=\{false\}/);
  for (const retained of ['<GlobalToolbar', '<WorkspaceSurface', 'connection-health', 'closeSettings']) assert.ok(app.includes(retained));
});
test('hidden history keeps guarded keyboard navigation without intercepting text or terminal input', () => {
  const history = source('src/components/NavigationHistory.jsx');
  assert.match(history, /window.addEventListener\('keydown', key\)/);
  for (const guard of ['event.defaultPrevented', 'event.isComposing', 'event.repeat', 'input, textarea, select', '.xterm', 'aria-modal="true"']) assert.ok(history.includes(guard), guard);
  assert.match(history, /navigate\(target.view, target.id, target\)/);
  const settings = source('src/views/settings/SettingsCenter.jsx'), browser = source('src/components/workspace/BrowserWorkspace.jsx');
  assert.match(settings, /Back to workspace/);
  assert.match(browser, /aria-label="Go back"/); assert.match(browser, /aria-label="Go forward"/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
test('retained page chrome reflows to actual work-pane width without shrinking text or hiding controls', () => {
  const css=read('src/components/workspace/workspace-responsive.css');
  assert.match(css,/container-name: workspace-body/);assert.match(css,/@container workspace-body \(max-width: 700px\)/);
  assert.match(css,/\.page > \.page-heading \{ flex-direction: column/);
  assert.match(css,/\.page \.output-layout,[^\n]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css,/\.page \.toolbar \.search-field,[^\n]*min-width: 0/);
  assert.doesNotMatch(css,/transform:.*scale|zoom:|font-size:\s*[0-9]px|display:\s*none/);
  assert.match(read('src/components/workspace/WorkspaceSurface.jsx'),/import '\.\/workspace-responsive.css'/);
});
test('choosing a file or native view dismisses the mobile explorer only after the draft guard permits navigation', () => {
  const surface=read('src/components/workspace/WorkspaceSurface.jsx');
  const choose=surface.slice(surface.indexOf('const showContent='),surface.indexOf('const commitClose='));
  assert.match(choose,/workspaceNavigationDisposition\(current,tab\)==='replace'\)guard\(apply\);else apply\(\)/);
  assert.match(choose,/update\(\{type:'navigate',tab\}\)/);
  assert.match(choose,/matchMedia\('\(max-width: 800px\)'\)\.matches\)\{setExplorerOpen\(false\)/);
  assert.match(choose,/tabElements\.current\.get\(stateRef\.current\.activeTabId\)\?\.focus\(\)/);
});

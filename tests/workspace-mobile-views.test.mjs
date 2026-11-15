import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';

const source = await readFile(new URL('../src/components/workspace/WorkspaceViews.jsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/components/workspace/workspace-views.css', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const declaration = ast.program.body.find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === 'workspaceViewSwitchIndex').declaration;
const nextIndex = Function(`return (${source.slice(declaration.start, declaration.end)});`)();

test('phone view tabs support bounded wraparound arrows, Home and End for every group size', () => {
  for (let count = 1; count <= 8; count++) for (let index = 0; index < count; index++) {
    assert.equal(nextIndex('ArrowLeft', index, count), (index - 1 + count) % count);
    assert.equal(nextIndex('ArrowRight', index, count), (index + 1) % count);
    assert.equal(nextIndex('Home', index, count), 0); assert.equal(nextIndex('End', index, count), count - 1);
    for (const key of ['Enter', 'Escape', 'Tab', 'ArrowUp', 'x']) assert.equal(nextIndex(key, index, count), -1);
  }
  for (const count of [0, -1, NaN, 2.5]) assert.equal(nextIndex('ArrowRight', 0, count), -1);
});

test('phone switcher is semantic, focus-only and linked to retained keyed panels', () => {
  assert.match(source, /role="tablist" aria-label="Views in this tab" aria-orientation="horizontal"/);
  assert.match(source, /role="tab" id=\{`workspace-view-option-\$\{view\.id\}`\} aria-controls=\{`workspace-pane-\$\{view\.id\}`\} aria-selected=\{selectedId === view\.id\}/);
  assert.match(source, /tabIndex=\{selectedId === view\.id \? 0 : -1\}/);
  assert.match(source, /id=\{`workspace-pane-\$\{view\.id\}`\} role=\{compact \? 'tabpanel'/);
  assert.match(source, /onClick=\{\(\) => onFocus\?\.\(view\.id\)\}/);
  assert.match(source, /onFocus\?\.\(target\.id\); switchButtons\.current\.get\(target\.id\)\?\.focus\(\)/);
  assert.match(source, /data-workspace-view-focused=\{String\(focused\)\}/);
  assert.doesNotMatch(source, /stopWorkspaceTerminal|launchRequests|guard\(|detach-view/);
});

test('all live leaves remain in one flat entity-keyed layer on phone; hidden panes never become placeholders', () => {
  assert.match(source, /className="workspace-view-leaves">\s*\{views\.map\(view => <WorkspaceViewLeaf key=\{view\.entityId\}/);
  assert.doesNotMatch(source, /views\.filter\(|compact \? renderView|phone \? renderView/);
  assert.match(source, /canDragViews=\{canDragViews && !compact\}/);
  assert.match(source, /workspaceNeedsFocusMode\(geometry\.leaves, bounds\.width, bounds\.height\)/);
  assert.match(source, /dispatchEvent\(new CustomEvent\('frondose:workspace-view-geometry'\)\); \}, \[geometry, hideHeaders, selectedId, compact\]/);
  assert(source.indexOf('className="workspace-view-switcher"') < source.indexOf('className="workspace-view-leaves"'));
  assert.match(source, /data-multiple-views=\{String\(views\.length > 1\)\}/);
});

test('only phone groups replace the mosaic with a full-size focused panel below a bounded horizontal bar', () => {
  assert.match(css, /\.workspace-view-switcher \{ display:none; \}/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /\[data-multiple-views="true"\] > \.workspace-view-switcher \{[^}]*height:36px;[^}]*overflow-x:auto/);
  assert.match(css, /\[data-multiple-views="true"\] > \.workspace-view-leaves \{ top:36px; \}/);
  assert.match(css, /\[data-multiple-views="true"\] > \.workspace-view-dividers \{ display:none; \}/);
  assert.match(css, /\.workspace-view \{ left:0!important;top:0!important;width:100%!important;height:100%!important; \}/);
  assert.match(css, /\.workspace-view\[data-workspace-view-focused="false"\] \{ display:none; \}/);
});

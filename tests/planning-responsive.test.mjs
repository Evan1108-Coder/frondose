import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const css = source('views/planning-responsive.css');
const ast = postcss.parse(css);
function declarations(query, selector) {
  const result = {};
  ast.walkAtRules('container', rule => {
    if (rule.params !== `frondose-planning (max-width: ${query}px)`) return;
    rule.walkRules(item => { if (item.selector === selector) item.walkDecls(decl => { result[decl.prop] = decl.value; }); });
  });
  return result;
}

test('Project and Route pages reflow against a named available-width container', () => {
  assert.match(source('views/workspace-spaces.css'), /\.space-page[^\n]*container-type: inline-size; container-name: frondose-planning/);
  assert.match(css, /\.planning-page[^\n]*container-type: inline-size; container-name: frondose-planning/);
  const jsx = source('views/Projects.jsx');
  assert.equal((jsx.match(/className="page planning-page projects-page"/g) || []).length, 2);
  assert.equal((jsx.match(/className="page planning-page routes-page"/g) || []).length, 3);
  assert.match(jsx, /className="page planning-page route-detail-page"/);
  assert.match(jsx, /import '\.\/planning-responsive\.css'/);
});

test('narrow Project overview and Route detail stack without removing either content column', () => {
  assert.equal(declarations(900, '.space-page .space-overview-grid')['grid-template-columns'], 'minmax(0, 1fr)');
  assert.equal(declarations(900, '.route-detail-page .project-detail-grid')['grid-template-columns'], 'minmax(0, 1fr)');
  assert.equal(declarations(700, '.space-page .space-properties, .route-detail-page .detail-aside')['grid-template-columns'], 'minmax(0, 1fr)');
  assert.equal(declarations(900, '.space-page .space-properties')['border-left'], '0');
  assert.doesNotMatch(css, /(?:space-properties|detail-aside)[^\n]*display:\s*none/);
});

test('narrow headings reserve a full title line before wrapping their actions', () => {
  assert.equal(declarations(700, ':is(.planning-page, .space-page) .page-heading')['flex-direction'], 'column');
  assert.equal(declarations(700, ':is(.planning-page, .space-page) .page-heading > div:first-child')['width'], '100%');
  assert.equal(declarations(700, ':is(.planning-page, .space-page) .page-actions')['flex-wrap'], 'wrap');
  assert.equal(declarations(700, ':is(.planning-page, .space-page) .page-actions .button')['white-space'], 'normal');
});

test('only deliberate tabs and boards scroll horizontally; nested route metadata remains available', () => {
  assert.match(css, /\.space-page \.space-tabs[^\n]*overflow-x: auto/);
  assert.match(css, /\.planning-page \.route-board[^\n]*max-width: 100%/);
  assert.equal(declarations(550, ':is(.planning-page, .space-page) .route-row .route-status')['display'], 'flex');
  assert.equal(declarations(550, ':is(.planning-page, .space-page) .route-row > .priority')['display'], 'flex');
  assert.equal(declarations(550, ':is(.planning-page, .space-page) .route-date')['display'], 'block');
  assert.equal(declarations(550, ':is(.planning-page, .space-page) .route-tree-title')['padding-inline-start'], 'calc(var(--route-depth, 0) * 8px)');
});

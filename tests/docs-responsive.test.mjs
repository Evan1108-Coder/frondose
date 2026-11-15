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
const bundle = buildSync({ stdin: { contents: `export {DocsView} from './src/views/Docs.jsx'; export {AppContext} from './src/app-context.js';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require);
const { DocsView, AppContext } = module.exports;
function render(local = true, articleId = null) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { dataset: { theme: 'dark' } } } });
  try {
    const value = { data: { meta: { product: { edition: local ? 'local' : 'compatible' } } }, page: { view: 'docs', id: articleId }, navigate() {}, closeDocs() {}, showFeedback() {}, perform() {}, notify() {} };
    return renderToStaticMarkup(React.createElement(AppContext.Provider, { value }, React.createElement(DocsView)));
  } finally { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document; }
}

test('standalone local Docs has one main landmark, useful content and a real workspace return', () => {
  const html = render();
  assert.equal((html.match(/id="main-content"/g) || []).length, 1);
  assert.match(html, /Back to workspace/); assert.match(html, /Frondose Docs/);
  assert.match(html, /Files, tabs &amp; terminals/); assert.match(html, /Search documentation/);
  assert.doesNotMatch(html, /docs-nav-backdrop|<iframe|<webview/);
  assert.match(render(false), /Open app/);
});
test('mobile documentation disclosure links its toggle to the real navigation panel', () => {
  const html = render();
  const toggle = html.match(/<button[^>]*aria-label="Open documentation navigation"[^>]*>/)?.[0];
  assert.ok(toggle); assert.match(toggle, /aria-expanded="false"/);
  const id = toggle.match(/aria-controls="([^"]+)"/)?.[1]; assert.ok(id);
  assert.ok(html.includes(`<aside id="${id}"`));
  const jsx = source('src/views/Docs.jsx');
  assert.match(jsx, /if \(!mobileNav \|\| searchOpen\) return/);
  assert.match(jsx, /event\.key !== 'Escape' \|\| event\.defaultPrevented/);
  assert.match(jsx, /setMobileNav\(false\); navTrigger\.current\?\.focus\(\)/);
  assert.match(jsx, /navPanel\.current\?\.querySelector\('button'\)\?\.focus\(\)/);
  assert.match(jsx, /desktop\.removeEventListener\('change', resize\)/);
});
test('narrow Docs uses full-width inline navigation, wrapping controls and single-column cards', () => {
  const css = source('src/views/docs.css'), mobile = css.slice(css.indexOf('@media (max-width: 700px)'));
  assert.match(css, /\.docs-shell[^\n]*height: 100%[^\n]*min-width: 0[^\n]*overflow: hidden/);
  assert.match(mobile, /grid-template-rows: auto auto auto minmax\(0,1fr\)/);
  assert.match(mobile, /\.docs-topbar[^\n]*flex-wrap: wrap/);
  assert.match(mobile, /\.docs-sidebar\.is-open[^\n]*width: 100%[^\n]*max-height: min\(44dvh, 380px\)/);
  assert.doesNotMatch(mobile, /\.docs-sidebar\.is-open[^\n]*position: fixed|inset: 108px/);
  assert.match(mobile, /\.docs-card-grid, \.docs-card-grid\.docs-featured, \.docs-topic-grid, \.docs-article-layout \{ grid-template-columns: minmax\(0,1fr\)/);
  assert.match(css, /\.docs-search-results > button > span[^\n]*overflow-wrap: anywhere/);
});
test('Docs preserves curated article search, Markdown copy, source links and article focus', () => {
  const html = render(true, 'local-cli-workspace'), jsx = source('src/views/Docs.jsx');
  assert.match(html, /Your local workspace/); assert.match(html, /Copy page/);
  assert.match(jsx, /searchDocs\(DOC_ARTICLES, query\)/);
  assert.match(jsx, /articleMarkdown\(article\)/);
  assert.match(jsx, /headingRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(jsx, /localEdition \? closeDocs \? closeDocs\(\)/);
});

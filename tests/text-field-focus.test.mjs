import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('text fields use their border while non-text keyboard controls keep the global outline', () => {
  const css = source('src/styles.css');
  assert.match(css, /:focus-visible\s*\{[^}]*outline: 2px solid var\(--focus\)/);
  assert.match(css, /:is\(input, textarea, select\):not\(:where\([^}]*\[type="checkbox"\][^}]*\[type="radio"\][^}]*\[type="range"\][^}]*\)\):focus-visible\s*\{\s*outline: none;/);
  assert.match(css, /input:focus,\s*textarea:focus,\s*select:focus\s*\{\s*border-color: var\(--focus\)/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?--focus: Highlight/);
});
test('search wrappers own one border and their input has no nested border', () => {
  const css = source('src/styles.css');
  assert.match(css, /\.search-field\s*\{[^}]*border: 1px solid var\(--border\)/);
  assert.match(css, /\.search-field input\s*\{[^}]*border: 0/);
  assert.match(css, /:is\(\.search-field, \.settings-search, \.command-search\):focus-within\s*\{\s*border-color: var\(--focus\);\s*outline: none/);
  for (const path of ['src/components/slash-command-menu.css', 'src/views/chats-page.css']) {
    assert.match(source(path), /\.command-library-search:focus-within\s*\{[^}]*border-color:var\(--focus\);outline:none/);
    assert.match(source(path), /\.command-library-search input\s*\{[^}]*border:0/);
  }
  assert.match(source('src/views/workbench.css'), /\.wb-slash-launcher:focus-within\s*\{[^}]*border-color:var\(--focus\);outline:none/);
});
test('specialized text settings and onboarding do not reintroduce a second outline or spread ring', () => {
  const agent = source('src/views/talvori-agent.css'), fields = source('src/views/settings/field-defaults-settings.css');
  assert.match(agent, /\.rumbo-agent-onboarding-form textarea:focus\s*\{[^}]*border-color: var\(--focus\); outline: none; box-shadow: none/);
  assert.match(agent, /\.rumbo-agent-identity-fields textarea:focus-visible\s*\{[^}]*border-color: var\(--focus\); outline: none; box-shadow: none/);
  assert.match(fields, /\.field-default-search input:focus,[^}]*border-color: var\(--focus\); outline: none; box-shadow: none/);
  assert.match(fields, /\.field-default-settings button:focus-visible\s*\{[^}]*outline: 2px/);
  assert.match(source('src/components/help-menu.css'), /\.rumbo-feedback-drop:focus-within[^}]*border-color: var\(--focus\); outline: none/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSync } from 'esbuild';
const require = createRequire(import.meta.url);
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('../src/components/ProjectLeadPicker.jsx', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require);
const { ProjectLeadPicker } = module.exports;
const agents = [{ id: 'a', name: 'Codex' }, { id: 'b', name: 'Claude' }];
const render = props => renderToStaticMarkup(React.createElement(ProjectLeadPicker, { agents, onChange: () => {}, ...props }));
const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('empty lead is an editable combobox with a dashed No lead indicator', () => {
  const html = render({ value: '', id: 'lead' });
  assert.match(html, /class="no-lead-icon"/);
  assert.match(html, /id="lead"[^>]*aria-label="Project lead"[^>]*role="combobox"/);
  assert.match(html, /placeholder="No lead"/);
  assert.match(html, /aria-expanded="false"/);
});
test('agent and custom names survive rendering and remain escaped', () => {
  assert.match(render({ value: 'Codex' }), /value="Codex"/);
  assert.match(render({ value: '<Custom lead>' }), /value="&lt;Custom lead&gt;"/);
});
test('local custom-only picker preserves an existing lead name without restoring a profile catalog', () => {
  assert.match(render({ agents: [], value: 'Codex' }), /value="Codex"/);
  assert.match(render({ agents: [], value: '<Saved custom lead>' }), /value="&lt;Saved custom lead&gt;"/);
  const editor = source('src/components/EntityDialog.jsx');
  assert.match(editor, /const local = isLocalProduct\(data\)/);
  assert.match(editor, /agents=\{local \? \[\] : conversationAgents\}/);
  assert.match(editor, /lead: base.lead \?\? ""/);
  assert.match(editor, /lead: form.lead.trim\(\)/);
  assert.match(editor, /assignee_agent_ids: form.assignee_agent_ids/);
});
test('lead field defaults remain attached to the persisted input, not popup search', () => {
  const html = render({ value: 'Evan', 'data-field-default-key': 'project.new.lead', disabled: true });
  assert.match(html, /<input[^>]*data-field-default-key="project.new.lead"[^>]*value="Evan"/);
  assert.match(html, /disabled=""/);
  assert.match(source('src/components/ProjectLeadPicker.jsx'), /ref=\{search\} data-field-defaults-exclude/);
});
test('picker supports clear, workspace agent choices, custom names and keyboard cancellation', () => {
  const picker = source('src/components/ProjectLeadPicker.jsx');
  assert.match(picker, /choose\(''\)/);
  assert.match(picker, /matches.map\(agent/);
  assert.match(picker, /choose\(agent.name\)/);
  assert.match(picker, /choose\(name\)/);
  assert.match(picker, /event.key === 'Escape'/);
  assert.match(picker, /event.key === 'ArrowDown'/);
  assert.match(picker, /event.key === 'Enter'\) \{ event.preventDefault\(\); event.stopPropagation\(\)/);
});
test('project editor has one aligned responsive metadata row and keeps existing lead persistence', () => {
  const editor = source('src/components/EntityDialog.jsx');
  const css = source('src/components/editor-dialog.css');
  assert.match(editor, /className="project-metadata-row"/);
  assert.match(editor, /agents=\{local \? \[\] : conversationAgents\}/);
  assert.match(editor, /const conversationAgents = visible\(data.agents\)\.filter/);
  assert.match(editor, /lead: form.lead.trim\(\)/);
  assert.match(css, /project-metadata-row[^\n]*display: grid/);
  assert.match(css, /project-metadata-row[^\n]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /project-metadata-row[^\n]*repeat\(2, minmax\(0, 1fr\)\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATIC_FIELD_DEFINITIONS, fieldDefinitionsForWorkspace } from '../src/lib/field-inventory.js';
import { normalizeFieldDefinition } from '../src/lib/field-defaults.js';
import { RESOURCE_TYPES } from '../src/lib/settings-catalog.js';
import { parse } from '@babel/parser';

function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(child => visit(child, callback)); return; }
  if (typeof node.type === 'string') callback(node);
  for (const [key, child] of Object.entries(node)) if (key !== 'loc' && key !== 'comments' && key !== 'tokens') visit(child, callback);
}

function editorControls(path, functionName) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let editor = null;
  visit(ast.program, node => { if (node.type === 'FunctionDeclaration' && node.id?.name === functionName) editor = node; });
  assert.ok(editor, `${functionName} should exist`);
  const controls = [];
  visit(editor.body, node => {
    if (node.type !== 'JSXOpeningElement' || !['input', 'textarea', 'DateField'].includes(node.name?.name)) return;
    const code = source.slice(node.start, node.end);
    const type = /\btype="([^"]+)"/.exec(code)?.[1] || '';
    if (['checkbox', 'radio', 'file', 'color', 'search', 'password', 'hidden'].includes(type)) return;
    // Contact names/email and display-only color editing are deliberately not
    // candidates for browser-stored reusable text.
    if (/form\.(?:role|email)|aria-label="Hex color"/.test(code)) return;
    controls.push({ code, tagged: /defaultField\(|data-field-default-key/.test(code) });
  });
  return controls;
}

test('registered field names are unique, eligible and safely named', () => {
  // Update the feature guide's supported-field count when this changes.
  assert.equal(STATIC_FIELD_DEFINITIONS.length, 107);
  const keys = STATIC_FIELD_DEFINITIONS.map(field => field.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const field of STATIC_FIELD_DEFINITIONS) {
    const normalized = normalizeFieldDefinition(field);
    assert.equal(normalized?.eligible, true, field.key);
    assert.ok(field.page && field.label, field.key);
  }
});

test('new static fields have matching tagged form controls', () => {
  const source = [
    '../src/components/EntityDialog.jsx', '../src/views/Work.jsx',
    '../src/views/Chats.jsx', '../src/views/RumboAgent.jsx',
    '../src/components/RouteTools.jsx', '../src/views/Playbooks.jsx',
    '../src/components/AgentEditor.jsx', '../src/components/ActivityFeed.jsx',
    '../src/components/RumboAgentEntry.jsx', '../src/views/Library.jsx',
    '../src/views/TeamResources.jsx',
  ].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
  for (const key of ['project.new.start-date', 'project.new.target-date', 'route.new.due-date', 'session.new.prompt', 'conversation.compose.message', 'rumbo-agent.new.request', 'rumbo-agent.entry.request', 'route.split.titles', 'route.repeat.interval', 'route.repeat.first-date', 'update.new.title', 'update.new.content', 'update.reply.content', 'output.new.title', 'output.new.content', 'context.new.name', 'context.new.additional', 'knowledge.new.title', 'knowledge.new.content', 'knowledge.new.review-date', 'area-resource.new.name', 'area-resource.new.description']) {
    // EntityDialog and RouteTools use stable key builders for scoped variants.
    if (key === 'project.new.start-date') assert.match(source, /defaultField\('start-date'/);
    else if (key === 'project.new.target-date') assert.match(source, /defaultField\('target-date'/);
    else if (key === 'route.new.due-date') assert.match(source, /defaultField\('due-date'/);
    else assert.ok(source.includes(key), key);
  }
});

test('future custom template fields are discoverable by template and label', () => {
  const fields = fieldDefinitionsForWorkspace({ workspace_items: [
    { id: 'tpl-1', kind: 'route_template', name: 'Bug report', payload: { fields: [{ id: 'steps', label: 'Steps to reproduce', type: 'textarea' }, { id: 'severity', label: 'Severity', type: 'select' }] } },
    { id: 'tpl-2', kind: 'route_template', name: 'Archived report', archived_at: '2026-01-01', payload: { fields: [{ id: 'old', label: 'Old field', type: 'text' }] } },
  ] });
  assert.ok(fields.some(field => field.key === 'template.tpl-1.steps' && field.page === 'Bug report template' && field.label === 'Steps to reproduce'));
  assert.equal(fields.some(field => field.key === 'template.tpl-1.severity'), false);
  assert.equal(fields.some(field => field.key === 'template.tpl-2.old'), false);
});

test('new settings resources have one stable default key per safe text field', () => {
  const source = readFileSync(new URL('../src/views/settings/ResourcePage.jsx', import.meta.url), 'utf8');
  assert.match(source, /resource\.\$\{kind\}\.new\.\$\{key\}/);
  assert.match(source, /data-field-default-mode': item \? 'edit' : 'create'/);
  const expected = Object.entries(RESOURCE_TYPES).flatMap(([kind, spec]) => [
    `resource.${kind}.new.name`,
    ...Object.entries(spec.fields)
      .filter(([key, field]) => ['text', 'textarea'].includes(field.type) && !['query', 'requester', 'owner'].includes(key))
      .map(([key]) => `resource.${kind}.new.${key}`),
  ]);
  const actual = STATIC_FIELD_DEFINITIONS.filter(field => field.key.startsWith('resource.')).map(field => field.key);
  assert.deepEqual(actual, expected);
  assert.equal(actual.some(key => /query|requester|owner/.test(key)), false);
});

test('Area, document and milestone creation fields are tagged but contact data is not', () => {
  const source = readFileSync(new URL('../src/components/WorkspaceEditor.jsx', import.meta.url), 'utf8');
  assert.match(source, /data-field-default-key': `\$\{defaultKey\}\.new\.\$\{key\}`/);
  assert.match(source, /data-field-default-allow="true"/);
  for (const key of ['area.new.name', 'area.new.description', 'document.new.title', 'document.new.content', 'milestone.new.title', 'milestone.new.description', 'milestone.new.target-date']) {
    assert.ok(STATIC_FIELD_DEFINITIONS.some(field => field.key === key), key);
  }
  assert.equal(STATIC_FIELD_DEFINITIONS.some(field => field.key.startsWith('contact.') || field.key.startsWith('teamMember.')), false);
});

test('draft Skill forms expose named defaults without tagging run inputs or permission controls', () => {
  const editor = readFileSync(new URL('../src/views/Skills.jsx', import.meta.url), 'utf8');
  const fromRun = readFileSync(new URL('../src/components/SkillFromRun.jsx', import.meta.url), 'utf8');
  assert.match(editor, /skill\.new\.\$\{key\}/);
  assert.match(editor, /skill \? 'edit' : 'create'/);
  assert.match(fromRun, /skill-from-run\.new\.\$\{key\}/);
  for (const key of ['skill.new.name', 'skill.new.purpose', 'skill.new.instructions', 'skill.new.capabilities', 'skill.new.output-format', 'skill-from-run.new.name', 'skill-from-run.new.purpose', 'skill-from-run.new.instructions']) {
    assert.ok(STATIC_FIELD_DEFINITIONS.some(field => field.key === key), key);
  }
});

test('audited creation editors cannot add an unregistered text/date control silently', () => {
  for (const [path, name] of [
    ['../src/views/settings/ResourcePage.jsx', 'ResourceEditor'],
    ['../src/components/WorkspaceEditor.jsx', 'WorkspaceEditor'],
  ]) {
    const controls = editorControls(path, name);
    assert.ok(controls.length >= 3, `${name} control audit unexpectedly empty`);
    for (const control of controls) assert.equal(control.tagged, true, `${name}: ${control.code.slice(0, 120)}`);
  }
});

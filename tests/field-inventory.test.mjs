import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATIC_FIELD_DEFINITIONS, fieldDefinitionsForWorkspace } from '../src/lib/field-inventory.js';
import { normalizeFieldDefinition } from '../src/lib/field-defaults.js';

test('registered field names are unique, eligible and safely named', () => {
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
    { id: 'tpl-1', kind: 'route_template', name: 'Bug report', payload: { fields: [{ id: 'steps', label: 'Steps to reproduce', type: 'textarea' }] } },
  ] });
  assert.ok(fields.some(field => field.key === 'template.tpl-1.steps' && field.page === 'Bug report template' && field.label === 'Steps to reproduce'));
});

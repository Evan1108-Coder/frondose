import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';
import { normalizeTemplateFields, resolveTemplateValues, templateInstanceFor, templateInstanceSnapshot } from '../server/structured-templates.mjs';

const FIELDS = [
  { id: 'problem', label: 'Problem', type: 'textarea', required: true, default_value: 'Describe the problem' },
  { id: 'agent_task', label: 'Tell the agent what to do', type: 'text', default_value: 'Investigate' },
  { id: 'impact', label: 'Impact', type: 'select', options: ['Small', 'Large'], default_value: 'Small' },
];

async function fixture(fn) {
  const dataDir = await mkdtemp(join(tmpdir(), 'rumbo-structured-templates-'));
  const forbidden = () => { throw new Error('Real providers forbidden in template tests'); };
  const api = createLocalApi({ dataDir, integrationOptions: { env: {}, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden } });
  const db = new DatabaseSync(api.dbPath);
  const server = createServer(api.middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = async (path, body, method = body ? 'POST' : 'GET', expected = method === 'POST' ? 201 : 200) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    assert.equal(res.status, expected, JSON.stringify(data));
    return data;
  };
  try {
    const workspace = (await call('/workspaces', { name: 'Template lab' })).workspace;
    await fn({ call, api, db, workspace, instances: () => templateInstanceSnapshot(db) });
  } finally {
    db.close();
    api.close();
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('template field definitions reject malformed, duplicate, and unsafe definitions', () => {
  const normalized = normalizeTemplateFields(FIELDS);
  assert.deepEqual(normalized.map(field => field.id), ['problem', 'agent_task', 'impact']);
  assert.throws(() => normalizeTemplateFields([...FIELDS, FIELDS[0]]), /unique/);
  assert.throws(() => normalizeTemplateFields([{ id: '__proto__', label: 'Bad' }]), /IDs/);
  assert.throws(() => normalizeTemplateFields([{ id: 'secret', label: 'Secret', type: 'password' }]), /text, long text, or select/);
  assert.throws(() => normalizeTemplateFields([{ id: 'unsafe', label: 'Unsafe', handler: 'run' }]), /Unknown template field setting/);
  assert.throws(() => normalizeTemplateFields([{ id: 'choice', label: 'Choice', type: 'select', options: ['a', 'a'] }]), /distinct/);
  assert.throws(() => normalizeTemplateFields([{ id: 'huge', label: 'Huge', default_value: 'x'.repeat(501) }]), /Default value/);
  assert.throws(() => normalizeTemplateFields(Array.from({ length: 25 }, (_, n) => ({ id: `field_${n}`, label: `Field ${n}` }))), /up to 24/);
});

test('template answers use defaults, reject unknown fields, and enforce required/select values', () => {
  assert.deepEqual(resolveTemplateValues(FIELDS), { problem: 'Describe the problem', agent_task: 'Investigate', impact: 'Small' });
  assert.deepEqual(resolveTemplateValues(FIELDS, { problem: 'A real problem', impact: 'Large' }), { problem: 'A real problem', agent_task: 'Investigate', impact: 'Large' });
  assert.throws(() => resolveTemplateValues(FIELDS, { extra: 'surprise' }), /Unknown template field/);
  assert.throws(() => resolveTemplateValues(FIELDS, { problem: '' }), /required/);
  assert.throws(() => resolveTemplateValues(FIELDS, { impact: 'Critical' }), /Choose an option/);
  assert.throws(() => resolveTemplateValues(FIELDS, { agent_task: 42 }), /characters/);
});

test('route, project, and chat instances preserve independent fields and legacy content', async () => fixture(async ({ call, api, workspace, instances }) => {
  for (const [kind, entityType, content] of [
    ['route_template', 'tasks', 'Legacy route brief'],
    ['project_template', 'projects', 'Legacy project brief'],
    ['chat_template', 'chats', 'Legacy opening note'],
  ]) {
    const template = (await call('/workspace-items', { workspace_id: workspace.id, kind, name: `Structured ${entityType}`, payload: { content, fields: FIELDS } })).result;
    assert.equal(template.payload.fields.length, 3);
    const result = (await call(`/workspace-items/${template.id}/action`, { version: template.version, action: 'instantiate', name: `Created ${entityType}`, field_values: { problem: `${entityType} issue`, impact: 'Large' } }, 'POST', 200)).result;
    const instance = instances().find(row => row.entity_id === result.id);
    assert.equal(instance.entity_type, entityType);
    assert.equal(instance.template_id, template.id);
    assert.equal(instance.template_version, template.version);
    assert.equal(instance.values.problem, `${entityType} issue`);
    assert.equal(instance.values.agent_task, 'Investigate');
    assert.equal(instance.values.impact, 'Large');
    const created = api.snapshot()[entityType].find(row => row.id === result.id);
    if (entityType !== 'chats') assert.equal(created.description, content);
    else assert.equal(api.snapshot().messages.find(message => message.chat_id === result.id).content, content);
    assert.equal(api.snapshot().runs.length, 0);
  }
}));

test('changing a template pins new answers without rewriting earlier instances', async () => fixture(async ({ call, workspace, instances }) => {
  const original = (await call('/workspace-items', { workspace_id: workspace.id, kind: 'route_template', name: 'Versioned route', payload: { fields: FIELDS } })).result;
  const first = (await call(`/workspace-items/${original.id}/action`, { version: original.version, action: 'instantiate', name: 'Before edit' }, 'POST', 200)).result;
  const changedFields = FIELDS.map(field => field.id === 'agent_task' ? { ...field, default_value: 'Review the evidence' } : field);
  const edited = (await call(`/workspace-items/${original.id}`, { version: original.version, payload: { ...original.payload, fields: changedFields } }, 'PATCH', 200)).result;
  const second = (await call(`/workspace-items/${original.id}/action`, { version: edited.version, action: 'instantiate', name: 'After edit' }, 'POST', 200)).result;
  const before = instances().find(instance => instance.entity_id === first.id);
  const after = instances().find(instance => instance.entity_id === second.id);
  assert.equal(before.template_version, original.version);
  assert.equal(after.template_version, edited.version);
  assert.equal(before.values.agent_task, 'Investigate');
  assert.equal(after.values.agent_task, 'Review the evidence');
  assert.equal(before.fields.find(field => field.id === 'agent_task').default_value, 'Investigate');
}));

test('invalid answers roll back instance and destination; old templates still instantiate', async () => fixture(async ({ call, api, workspace, instances, db }) => {
  const template = (await call('/workspace-items', { workspace_id: workspace.id, kind: 'route_template', name: 'Strict route', payload: { fields: FIELDS } })).result;
  await call(`/workspace-items/${template.id}/action`, { version: template.version, action: 'instantiate', name: 'Should fail', field_values: { impact: 'Invalid' } }, 'POST', 400);
  assert.equal(api.snapshot().tasks.length, 0);
  assert.equal(instances().length, 0);
  const legacy = (await call('/workspace-items', { workspace_id: workspace.id, kind: 'route_template', name: 'Legacy route', payload: { content: 'A plain brief' } })).result;
  const result = (await call(`/workspace-items/${legacy.id}/action`, { version: legacy.version, action: 'instantiate', name: 'Old way' }, 'POST', 200)).result;
  assert.equal(api.snapshot().tasks.find(task => task.id === result.id).description, 'A plain brief');
  assert.equal(instances().length, 0);
  assert.equal(templateInstanceFor(db, { workspaceId: workspace.id, entityType: 'tasks', entityId: result.id, canRead: () => true }), null);
}));

test('instance reads require canonical entity access and exact workspace', async () => fixture(async ({ call, workspace, db }) => {
  const template = (await call('/workspace-items', { workspace_id: workspace.id, kind: 'route_template', name: 'Scoped', payload: { fields: FIELDS } })).result;
  const result = (await call(`/workspace-items/${template.id}/action`, { version: template.version, action: 'instantiate', name: 'Private route' }, 'POST', 200)).result;
  assert.equal(templateInstanceFor(db, { workspaceId: workspace.id, entityType: 'tasks', entityId: result.id, canRead: () => false }), null);
  assert.equal(templateInstanceFor(db, { workspaceId: 'other', entityType: 'tasks', entityId: result.id, canRead: () => true }), null);
  assert.equal(templateInstanceFor(db, { workspaceId: workspace.id, entityType: 'tasks', entityId: result.id, canRead: () => true }).values.problem, 'Describe the problem');
  assert.throws(() => templateInstanceFor(db, { workspaceId: workspace.id, entityType: 'tasks', entityId: result.id }), /readable/);
}));

test('authenticated instance endpoint returns pinned answers only for its readable workspace item', async () => fixture(async ({ call, workspace }) => {
  const template = (await call('/workspace-items', { workspace_id: workspace.id, kind: 'route_template', name: 'Endpoint form', payload: { fields: FIELDS } })).result;
  const item = (await call(`/workspace-items/${template.id}/action`, { version: template.version, action: 'instantiate', name: 'A Route', field_values: { problem: 'Pinned answer' } }, 'POST', 200)).result;
  const path = `/template-instances/tasks/${encodeURIComponent(item.id)}?workspace_id=${encodeURIComponent(workspace.id)}`;
  const read = (await call(path)).result;
  assert.equal(read.values.problem, 'Pinned answer');
  assert.equal(read.template_version, template.version);
  await call(`/template-instances/tasks/${encodeURIComponent(item.id)}?workspace_id=other`, undefined, 'GET', 404);
  await call(`/template-instances/chats/${encodeURIComponent(item.id)}?workspace_id=${encodeURIComponent(workspace.id)}`, undefined, 'GET', 404);
}));

test('hard-removing a template-created item removes its pinned answers', async () => fixture(async ({ call, workspace, db, instances }) => {
  const template = (await call('/workspace-items', { workspace_id: workspace.id, kind: 'route_template', name: 'Disposable', payload: { fields: FIELDS } })).result;
  const item = (await call(`/workspace-items/${template.id}/action`, { version: template.version, action: 'instantiate', name: 'Disposable Route' }, 'POST', 200)).result;
  assert.equal(instances().length, 1);
  db.prepare('DELETE FROM tasks WHERE id=?').run(item.id);
  assert.equal(instances().length, 0);
}));

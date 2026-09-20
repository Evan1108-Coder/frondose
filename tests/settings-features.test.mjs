import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';
import { RESOURCE_TYPES, SETTINGS_GROUPS, PAGE_RESOURCE, matchingRoutes } from '../src/lib/settings-catalog.js';
import { monthCells } from '../src/lib/calendar.js';

async function fixture(fn) {
  const dataDir = await mkdtemp(join(tmpdir(), 'rumbo-settings-test-'));
  const forbidden = () => { throw new Error('Real providers forbidden'); };
  const api = createLocalApi({ dataDir, integrationOptions: { env: {}, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden } });
  const server = createServer(api.middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = async (path, body, method = body ? 'POST' : 'GET', expected = method === 'POST' ? 201 : 200) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json(); assert.equal(res.status, expected, JSON.stringify(data)); return data;
  };
  const workspace = (await call('/workspaces', { name: 'Settings lab' })).workspace;
  const item = async (kind, name, payload = {}) => (await call('/workspace-items', { workspace_id: workspace.id, kind, name, payload })).result;
  const action = (resource, action, rest = {}, expected = 200) => call(`/workspace-items/${resource.id}/action`, { version: resource.version, action, ...rest }, 'POST', expected);
  try { await fn({ call, api, workspace, item, action }); }
  finally { api.close(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); }
}
test('settings catalog has unique pages, typed resource editors, and two week starts', () => {
  const ids = SETTINGS_GROUPS.flatMap(([, pages]) => pages.map(([id]) => id));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 40);
  for (const [page, kind] of Object.entries(PAGE_RESOURCE)) { assert.ok(ids.includes(page)); assert.ok(RESOURCE_TYPES[kind]); }
  assert.equal(monthCells(new Date(2026, 8, 19), 0)[0].getDay(), 0);
  assert.equal(monthCells(new Date(2026, 8, 19))[0].getDay(), 1);
});
test('all workspace resource types persist, revise, archive and restore without provider calls', async () => fixture(async ({ item, call, api }) => {
  for (const [kind, spec] of Object.entries(RESOURCE_TYPES)) {
    const record = await item(kind, spec.title, kind === 'emoji' ? { symbol: '🎉' } : {});
    const revised = (await call(`/workspace-items/${record.id}`, { version: record.version, name: `${record.name} revised` }, 'PATCH')).result;
    assert.equal(revised.version, 2);
    await call(`/workspace-items/${record.id}`, { version: 1, name: 'stale' }, 'PATCH', 409);
    const archived = (await call(`/workspace-items/${record.id}`, { version: 2, archived_at: new Date().toISOString() }, 'PATCH')).result;
    await call(`/workspace-items/${record.id}`, { version: archived.version, archived_at: null }, 'PATCH');
  }
  assert.equal(api.snapshot().workspace_items.length, Object.keys(RESOURCE_TYPES).length);
  assert.ok(api.snapshot().audit_log.length > 60);
}));
test('custom workflow stages preserve lifecycle semantics and block unsafe removal', async () => fixture(async ({ call, item, workspace, api }) => {
  const custom = await item('route_status', 'Ready for review', { category: 'review' });
  const task = (await call('/tasks', { workspace_id: workspace.id, title: 'Review layout', workflow_status_id: custom.id, status: 'review' })).task;
  assert.equal(task.workflow_status_id, custom.id);
  await call(`/workspace-items/${custom.id}`, { version: 1, archived_at: new Date().toISOString() }, 'PATCH', 400);
  await call(`/tasks/${task.id}`, { status: 'done' }, 'PATCH');
  assert.equal(api.snapshot().tasks[0].workflow_status_id, null);
  await call(`/workspace-items/${custom.id}`, { version: 1, archived_at: new Date().toISOString() }, 'PATCH');
  await call('/projects', { workspace_id: workspace.id, name: 'Wrong status', status: 'active', workflow_status_id: custom.id }, 'POST', 400);
}));
test('emoji shortcodes remain stable after rename and cannot collide with active or archived codes', async () => fixture(async ({ call, item, workspace }) => {
  const emoji = await item('emoji', 'Party Time', { symbol: '🎉' });
  assert.equal(emoji.payload.shortcode, 'party-time');
  const renamed = (await call(`/workspace-items/${emoji.id}`, { version: emoji.version, name: 'Celebrate' }, 'PATCH')).result;
  assert.equal(renamed.payload.shortcode, 'party-time');
  await call('/workspace-items', { workspace_id: workspace.id, kind: 'emoji', name: 'Party-Time', payload: { symbol: '🎈' } }, 'POST', 400);
  await call(`/workspace-items/${emoji.id}`, { version: renamed.version, archived_at: new Date().toISOString() }, 'PATCH');
  await call('/workspace-items', { workspace_id: workspace.id, kind: 'emoji', name: 'Party Time', payload: { symbol: '🎈' } }, 'POST', 400);
}));
test('labels and resource references reject cross-workspace and invalid kinds', async () => fixture(async ({ call, item, workspace }) => {
  const other = (await call('/workspaces', { name: 'Other' })).workspace;
  const project = (await call('/projects', { workspace_id: other.id, name: 'Private' })).project;
  await call('/workspace-items', { workspace_id: workspace.id, kind: 'goal', name: 'Invalid', payload: { project_ids: [project.id] } }, 'POST', 400);
  const label = await item('route_label', 'Research');
  await call('/tasks', { workspace_id: other.id, title: 'Wrong', labels: [label.id] }, 'POST', 400);
  await call('/projects', { workspace_id: workspace.id, name: 'Wrong type', labels: [label.id] }, 'POST', 400);
  await call('/workspace-items', { workspace_id: workspace.id, kind: 'route_label', name: 'research' }, 'POST', 400);
  await call('/workspace-items', { workspace_id: workspace.id, kind: 'route_label', name: 'Bad color', payload: { color: 'url(evil)' } }, 'POST', 400);
}));
test('templates create linked project milestones, routes and non-executing chat notes', async () => fixture(async ({ call, item, action, api }) => {
  const projectTemplate = await item('project_template', 'Launch', { content: 'A brief', goal: 'Ship', milestones: 'Prototype\nReview\nRelease' });
  const project = await action(projectTemplate, 'instantiate', { name: 'New launch' });
  assert.equal(api.snapshot().milestones.filter(m => m.project_id === project.result.id).length, 3);
  const routeTemplate = await item('route_template', 'Bug', { content: '- [ ] Reproduce', status: 'ready' });
  const route = await action(routeTemplate, 'instantiate', { name: 'Fix search' });
  assert.equal(api.snapshot().tasks.find(t => t.id === route.result.id).status, 'ready');
  const chatTemplate = await item('chat_template', 'Planning', { content: 'Goals for today' });
  await action(chatTemplate, 'instantiate', { name: 'Monday' });
  assert.equal(api.snapshot().messages.at(-1).kind, 'note');
  assert.equal(api.snapshot().runs.length, 0);
}));
test('request conversion is idempotent and rules require an up-to-date preview', async () => fixture(async ({ item, action, api, call, workspace }) => {
  const req = await item('request', 'Improve search', { content: 'Find work faster' });
  const converted = await action(req, 'convert');
  const current = api.snapshot().workspace_items.find(i => i.id === req.id);
  const again = await action(current, 'convert');
  assert.equal(converted.result.id, again.result.id);
  assert.equal(api.snapshot().tasks.length, 1);
  const rule = await item('automation', 'Ready triage', { from: 'backlog', to: 'ready' });
  const preview = await action(rule, 'preview-rule');
  await call('/tasks', { workspace_id: workspace.id, title: 'Arrived later' });
  await action(rule, 'apply-rule', { ids: preview.result.matches.map(t => t.id) }, 400);
  const refreshed = await action(rule, 'preview-rule');
  const applied = await action(rule, 'apply-rule', { ids: refreshed.result.matches.map(t => t.id) });
  assert.equal(applied.result.count, 2);
  assert.equal(api.snapshot().tasks.every(t => t.status === 'ready'), true);
}));
test('instruction presets keep a revision and do not overwrite shared agent profiles', async () => fixture(async ({ item, action, call, workspace }) => {
  const preset = await item('preset', 'Reviewer', { content: 'Review changes carefully' });
  await action(preset, 'apply-preset', { agent_id: 'codex' }, 400);
  const agent = (await call('/agents', { workspace_id: workspace.id, name: 'My reviewer', provider: 'codex' })).agent;
  await action(preset, 'apply-preset', { agent_id: agent.id });
  const history = await call(`/history/${agent.id}?workspace_id=${workspace.id}`);
  assert.equal(history.result[0].after.instructions, 'Review changes carefully');
}));
test('preferences validate and persist without enabling unrelated services', async () => fixture(async ({ call, api }) => {
  await call('/settings', { preferences: { home: 'focus', sendKey: 'modifier', weekStart: 'sunday' }, appearance: { textSize: 'large' }, codeReview: { wrap: false }, personalization: { instructions: 'Be direct.' } }, 'PATCH');
  assert.equal(api.snapshot().settings.preferences.sendKey, 'modifier');
  await call('/settings', { preferences: { home: 'external' } }, 'PATCH', 400);
  await call('/settings', { preferences: { sendKey: 'modifier', fake: true } }, 'PATCH', 400);
  assert.equal(api.snapshot().settings.personalization.instructions, 'Be direct.');
}));
test('workspace content import remaps references, clears folder access and rolls back malformed archives', async () => fixture(async ({ call, item, workspace, api }) => {
  const label = await item('route_label', 'Bug');
  const status = await item('route_status', 'Verify', { category: 'review' });
  const project = (await call('/projects', { workspace_id: workspace.id, name: 'Launch', local_path: '/tmp/project' })).project;
  await call('/tasks', { workspace_id: workspace.id, title: 'Review', project_id: project.id, status: 'review', workflow_status_id: status.id, labels: [label.id] });
  await item('goal', 'Launch safely', { project_ids: [project.id] });
  const exported = await call(`/export?workspace_id=${workspace.id}`);
  const imported = await call('/import', exported);
  const data = api.snapshot(), newId = imported.result.id;
  const newProject = data.projects.find(p => p.workspace_id === newId);
  const newRoute = data.tasks.find(p => p.workspace_id === newId);
  assert.equal(newProject.local_path, null);
  assert.equal(newRoute.project_id, newProject.id);
  assert.notEqual(newRoute.workflow_status_id, status.id);
  assert.equal(data.runs.length, 0);
  const before = data.workspaces.length;
  exported.data.workspace_items[0].payload.color = 'invalid';
  await call('/import', exported, 'POST', 400);
  assert.equal(api.snapshot().workspaces.length, before);
}));
test('label merge updates work atomically, deduplicates labels and preserves history', async () => fixture(async ({ item, action, api, call, workspace }) => {
  const old = await item('route_label', 'Old label');
  const target = await item('route_label', 'Target');
  const task = (await call('/tasks', { workspace_id: workspace.id, title: 'Merge check', labels: [old.id, target.id] })).task;
  await action(old, 'merge-label', { target_id: target.id });
  assert.deepEqual(api.snapshot().tasks.find(t => t.id === task.id).labels, [target.id]);
  assert.ok(api.snapshot().workspace_items.find(t => t.id === old.id).archived_at);
  assert.ok((await call(`/history/${task.id}?workspace_id=${workspace.id}`)).result.some(r => r.action === 'labels merged'));
}));
test('resources referencing archived content can still be archived', async () => fixture(async ({ item, call, workspace, api }) => {
  const project = (await call('/projects', { workspace_id: workspace.id, name: 'Archive reference' })).project;
  const goal = await item('goal', 'Archive goal', { project_ids: [project.id] });
  await call(`/projects/${project.id}`, { archived_at: new Date().toISOString() }, 'PATCH');
  await call(`/workspace-items/${goal.id}`, { version: goal.version, archived_at: new Date().toISOString() }, 'PATCH');
  assert.ok(api.snapshot().workspace_items.find(i => i.id === goal.id).archived_at);
}));
test('saved queries do not include archived projects or duplicate routes', () => {
  const data = { projects: [{ id: 'p' }, { id: 'hidden', archived_at: 'now' }], tasks: [{ id: 'a', title: 'Review', project_id: 'p', status: 'ready', assignee_agent_ids: ['agent'] }, { id: 'b', title: 'Review', project_id: 'hidden' }] };
  assert.deepEqual(matchingRoutes(data, { query: 'review', status: 'ready', agent_ids: ['agent'] }).map(t => t.id), ['a']);
});

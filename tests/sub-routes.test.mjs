import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createLocalApi } from '../server/local-api.mjs';
import { createGovernanceService } from '../server/governance-service.mjs';
import { createAccessBoundary } from '../server/access-boundary.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-subroutes-'));
  const api = createLocalApi({ dataDir: directory, seedMode: 'demo' }), db = new DatabaseSync(api.dbPath);
  const governance = createGovernanceService({ db }), access = createAccessBoundary({ db, governance });
  const project = api.snapshot().projects[0], ws = project.workspace_id;
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body, cookie) => { const response = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }; };
  const route = async (title = 'Root', projectId = project.id) => { const response = await call('POST', '/tasks', { workspace_id: ws, project_id: projectId, title }); assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body.task; };
  const root = await route();
  const tree = async (id = root.id) => { const response = await call('GET', `/sub-routes/${id}?workspace_id=${ws}`); assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.result; };
  let sequence = 0;
  const command = async (id, action, fields = {}) => call('POST', `/sub-routes/${id}/${action}`, { workspace_id: ws, revision: (await tree(id)).revision, request_id: `request-${++sequence}`, ...fields });
  const child = async (id = root.id, title = 'Child') => { const response = await command(id, 'create', { title }); assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body.result.task_ids[0]; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); api.close(); await rm(directory, { recursive: true, force: true }); });
  return { api, db, ws, project, root, route, tree, command, child, call, governance, access };
}

test('single sub-route creation inherits scope, starts no agents, and retries without duplicate work', async t => {
  const { api, ws, root, tree, call } = await fixture(t);
  const beforeRuns = api.snapshot().runs.length;
  const payload = { workspace_id: ws, revision: (await tree()).revision, request_id: 'create-once', title: 'First child' };
  const first = await call('POST', `/sub-routes/${root.id}/create`, payload), again = await call('POST', `/sub-routes/${root.id}/create`, payload);
  assert.equal(first.status, 201); assert.deepEqual(again.body.result.task_ids, first.body.result.task_ids);
  const children = (await tree()).children;
  assert.equal(children.length, 1); assert.equal(children[0].project_id, root.project_id); assert.equal(children[0].team_id, root.team_id); assert.equal(children[0].status, 'backlog');
  assert.equal(api.snapshot().runs.length, beforeRuns);
  assert.equal((await call('POST', `/sub-routes/${root.id}/create`, { ...payload, title: 'Changed retry' })).status, 409);
  assert.equal((await call('POST', `/sub-routes/${root.id}/create`, { ...payload, request_id: 'fresh-stale' })).status, 409);
});

test('attach/reparent/detach and complete sibling reorder preserve canonical links', async t => {
  const { root, route, child, tree, command } = await fixture(t);
  const first = await child(), second = await child(root.id, 'Second'), anotherParent = await route('New parent'), standalone = await route('Standalone');
  assert.equal((await command(root.id, 'reorder', { child_ids: [first] })).status, 400);
  assert.equal((await command(root.id, 'reorder', { child_ids: [second, first] })).status, 200);
  assert.deepEqual((await tree()).children.map(item => item.id), [second, first]);
  assert.equal((await command(standalone.id, 'attach', { parent_id: root.id })).status, 200);
  assert.equal((await command(first, 'attach', { parent_id: anotherParent.id })).status, 409);
  assert.equal((await command(first, 'reparent', { parent_id: anotherParent.id })).status, 200);
  assert.equal((await tree(first)).parent.id, anotherParent.id);
  assert.equal((await command(first, 'detach')).status, 200); assert.equal((await tree(first)).parent, null);
});

test('cycles, cross-project edges, depth six and archived parents are rejected atomically', async t => {
  const { api, ws, root, project, route, child, tree, command, call } = await fixture(t);
  let parent = root.id; for (let depth = 2; depth <= 5; depth++) parent = await child(parent, `Depth ${depth}`);
  const count = api.snapshot().tasks.length;
  assert.equal((await command(parent, 'create', { title: 'Too deep' })).status, 409); assert.equal(api.snapshot().tasks.length, count);
  assert.equal((await command(root.id, 'attach', { parent_id: parent })).status, 409);
  const foreignProject = (await call('POST', '/projects', { workspace_id: ws, name: 'Other project' })).body.project;
  const foreign = await route('Different project', foreignProject.id);
  assert.equal((await command(foreign.id, 'attach', { parent_id: root.id })).status, 409);
  const archived = await route('Archived', project.id); await call('PATCH', `/tasks/${archived.id}`, { archived_at: new Date().toISOString() });
  assert.equal((await command(root.id, 'attach', { parent_id: archived.id })).status, 404);
  assert.equal((await tree(parent)).route.depth, 5);
});

test('completion gates include archived unfinished descendants and never automatically complete parents', async t => {
  const { root, child, tree, call } = await fixture(t);
  const id = await child();
  assert.equal((await call('PATCH', `/tasks/${root.id}`, { status: 'done' })).status, 409);
  await call('PATCH', `/tasks/${id}`, { archived_at: new Date().toISOString() });
  assert.equal((await tree()).progress.archived, 1); assert.equal((await tree()).progress.ratio, null);
  assert.equal((await call('PATCH', `/tasks/${root.id}`, { status: 'done' })).status, 409);
  await call('PATCH', `/tasks/${id}`, { archived_at: null });
  assert.equal((await call('PATCH', `/tasks/${id}`, { status: 'done' })).status, 200);
  assert.equal((await tree()).route.status, 'backlog'); assert.equal((await tree()).progress.ratio, 1);
  assert.equal((await call('PATCH', `/tasks/${root.id}`, { status: 'done' })).status, 200);
  assert.equal((await call('PATCH', `/tasks/${id}`, { status: 'ready' })).status, 409);
  assert.equal((await call('POST', `/route-tools/${root.id}/split`, { request_id: 'split-done', titles: ['A', 'B'] })).status, 409);
});

test('generic moves and hard deletion cannot break hierarchy; archiving changes only the chosen route', async t => {
  const { ws, root, child, tree, call } = await fixture(t);
  const id = await child();
  const other = (await call('POST', '/projects', { workspace_id: ws, name: 'Destination' })).body.project;
  assert.equal((await call('PATCH', `/tasks/${id}`, { project_id: other.id })).status, 409);
  assert.equal((await call('PATCH', `/tasks/${root.id}`, { project_id: other.id })).status, 409);
  assert.equal((await call('DELETE', `/tasks/${root.id}`)).status, 409);
  assert.equal((await call('PATCH', `/tasks/${root.id}`, { archived_at: new Date().toISOString() })).status, 200);
  const data = await tree(id); assert.ok(data.parent.archived_at); assert.equal(data.route.archived_at, null);
});

test('legacy invalid hierarchy is retained read-only until an explicit repair', async t => {
  const { db, ws, root, child, tree, command, call } = await fixture(t);
  const id = await child(); const other = (await call('POST', '/projects', { workspace_id: ws, name: 'Legacy project' })).body.project;
  db.prepare('UPDATE tasks SET project_id=? WHERE id=?').run(other.id, id);
  const legacy = await tree(id); assert.equal(legacy.integrity.valid, false); assert.equal(legacy.capabilities.can_create, false); assert.equal(legacy.capabilities.can_repair, true); assert.equal(legacy.progress.complete, false);
  assert.equal((await command(id, 'detach')).status, 409);
  assert.equal((await command(id, 'detach', { repair: true })).status, 200);
  assert.equal((await tree(id)).integrity.valid, true); assert.equal((await tree()).children.length, 0);
  assert.equal(db.prepare('SELECT project_id FROM tasks WHERE id=?').get(root.id).project_id, root.project_id);
});

test('workspace export/import preserves ordered hierarchy but not request keys, and invalid imports roll back', async t => {
  const { api, ws, root, child, command, call } = await fixture(t);
  const first = await child(), second = await child(root.id, 'Second'); await command(root.id, 'reorder', { child_ids: [second, first] });
  const archive = (await call('GET', `/export?workspace_id=${ws}`)).body;
  assert.equal(archive.data.sub_route_requests, undefined);
  const imported = await call('POST', '/import', archive); assert.equal(imported.status, 201, JSON.stringify(imported.body));
  const importedWs = imported.body.result.id, importedRoot = imported.body.bootstrap.tasks.find(task => task.workspace_id === importedWs && task.title === root.title);
  const importedTree = await call('GET', `/sub-routes/${importedRoot.id}?workspace_id=${importedWs}`);
  assert.deepEqual(importedTree.body.result.children.map(item => item.title), ['Second', 'Child']);
  const parent = archive.data.route_workflows.find(item => item.id === root.id); parent.parent_task_id = first;
  const before = api.snapshot().workspaces.length;
  assert.equal((await call('POST', '/import', archive)).status, 400); assert.equal(api.snapshot().workspaces.length, before);
});

test('hidden legacy parents and descendants redact IDs/depth and make bootstrap rollups unknown', async t => {
  const { api, db, ws, root, child, project, governance, access, call } = await fixture(t);
  const id = await child(); const privateProject = (await call('POST', '/projects', { workspace_id: ws, name: 'Private' })).body.project;
  db.prepare('UPDATE tasks SET project_id=? WHERE id=?').run(privateProject.id, id);
  const member = governance.command(ws, 'local-owner', 'create_member', { name: 'Limited', rank: 'Admin', email: 'limited@example.com' });
  governance.command(ws, 'local-owner', 'grant', { member_id: member.id, permission: 'routes.read', scope_type: 'project', scope_id: privateProject.id, effect: 'deny', reason: 'Private routes' });
  const snapshot = access.filter(api.snapshot(), { id: member.id });
  assert.ok(!snapshot.tasks.some(task => task.id === id)); assert.equal(snapshot.route_workflows.find(item => item.id === root.id).hierarchy_restricted, true); assert.ok(!JSON.stringify(snapshot).includes(id));
  const owner = await call('POST', '/identity/setup', { name: 'Owner', email: 'owner@example.com', password: 'long owner password 123' });
  const invitation = await call('POST', '/identity/invite', { workspace_id: ws, member_id: member.id }, owner.cookie);
  const signed = await call('POST', '/identity/accept', { token: invitation.body.result.invitation_token, password: 'long member password 123' });
  for (const path of ['/bootstrap', `/export?workspace_id=${ws}`]) assert.ok(!JSON.stringify((await call('GET', path, undefined, signed.cookie)).body).includes(id), path);
  const result = await call('GET', `/sub-routes/${root.id}?workspace_id=${ws}`, undefined, signed.cookie);
  assert.equal(result.status, 200); assert.equal(result.body.result.route.depth, null); assert.equal(result.body.result.progress.ratio, null); assert.ok(!JSON.stringify(result.body).includes(id));
  const denied = await call('PATCH', `/workflow/routes/${root.id}`, { version: 0, parent_task_id: id, dependency_ids: [] }, signed.cookie);
  assert.ok([403, 409].includes(denied.status));
  assert.equal(project.id, root.project_id);
});

test('sub-route and legacy split retries recheck moved result permissions before returning IDs', async t => {
  const { db, ws, root, governance, call } = await fixture(t);
  const privateProject = (await call('POST', '/projects', { workspace_id: ws, name: 'Private results' })).body.project;
  const member = governance.command(ws, 'local-owner', 'create_member', { name: 'Builder', rank: 'Admin', email: 'builder@example.com' });
  governance.command(ws, 'local-owner', 'grant', { member_id: member.id, permission: 'routes.read', scope_type: 'project', scope_id: privateProject.id, effect: 'deny', reason: 'Private results' });
  const owner = await call('POST', '/identity/setup', { name: 'Owner', email: 'owner@example.com', password: 'long owner password 123' });
  const invitation = await call('POST', '/identity/invite', { workspace_id: ws, member_id: member.id }, owner.cookie);
  const memberAccount = await call('POST', '/identity/accept', { token: invitation.body.result.invitation_token, password: 'long member password 123' });
  const tree = (await call('GET', `/sub-routes/${root.id}?workspace_id=${ws}`, undefined, memberAccount.cookie)).body.result;
  for (const [path, payload] of [
    [`/sub-routes/${root.id}/create`, { workspace_id: ws, revision: tree.revision, request_id: 'secure-create', title: 'Created child' }],
    [`/route-tools/${root.id}/split`, { request_id: 'secure-split', titles: ['First split', 'Second split'] }],
  ]) {
    const created = await call('POST', path, payload, memberAccount.cookie); assert.equal(created.status, 201, JSON.stringify(created.body));
    const hiddenId = created.body.result.task_ids[0];
    db.prepare('UPDATE route_workflows SET parent_task_id=NULL WHERE id=?').run(hiddenId);
    db.prepare('UPDATE tasks SET project_id=? WHERE id=?').run(privateProject.id, hiddenId);
    const replay = await call('POST', path, payload, memberAccount.cookie);
    assert.equal(replay.status, 403); assert.ok(!JSON.stringify(replay.body).includes(hiddenId));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApi } from '../server/local-api.mjs';

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-today-http-'));
  let providerCalls = 0;
  const forbidden = () => { providerCalls += 1; throw new Error('Provider access forbidden in Today tests.'); };
  const api = createLocalApi({ dataDir: directory, seedMode: 'clean', integrationOptions: { env: {}, execute: forbidden, fetchImpl: forbidden, spawnProcess: forbidden } });
  const server = createServer((req, res) => api.middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const create = async (resource, body) => { const result = await request(`/${resource}`, body); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body[resource === 'areas' ? 'team' : resource.slice(0, -1)]; };
  const db = new DatabaseSync(api.dbPath);
  try { await run({ request, create, db, providerCalls: () => providerCalls }); }
  finally { db.close(); api.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

function databaseContents(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()]);
}

test('Today HTTP summary is read-only, provider-free and links scoped real records', () => fixture(async ({ request, create, db, providerCalls }) => {
  const workspace = await create('workspaces', { name: 'Today fixture' });
  const area = await create('areas', { workspace_id: workspace.id, name: 'Engineering' });
  const project = await create('projects', { workspace_id: workspace.id, team_id: area.id, name: 'App' });
  const route = await create('tasks', { workspace_id: workspace.id, project_id: project.id, team_id: area.id, title: 'Ready for a reviewed launch', status: 'ready' });
  const other = await create('workspaces', { name: 'Other workspace' });
  await create('tasks', { workspace_id: other.id, title: 'FOREIGN_ROUTE_DO_NOT_RETURN', status: 'ready' });
  // Warm the pre-existing installation owner bootstrap before comparing reads.
  await request('/bootstrap');
  const before = databaseContents(db);
  const response = await request(`/today?workspace_id=${workspace.id}&area_id=${area.id}&project_id=${project.id}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.result.sections.suggested_next.map(item => item.id), [route.id]);
  assert.equal(response.body.result.sections.suggested_next[0].view, 'tasks');
  assert.equal(response.body.result.sections.suggested_next[0].area_id, area.id);
  assert(!JSON.stringify(response.body).includes('FOREIGN_ROUTE'));
  assert.deepEqual(databaseContents(db), before, 'Opening Today must not change workspace state');
  assert.equal(providerCalls(), 0);
}));

test('Today HTTP rejects invalid, cross-workspace and conflicting scope filters', () => fixture(async ({ request, create }) => {
  const workspace = await create('workspaces', { name: 'One' });
  const area = await create('areas', { workspace_id: workspace.id, name: 'Area' });
  const project = await create('projects', { workspace_id: workspace.id, name: 'Unscoped project' });
  const other = await create('workspaces', { name: 'Two' });
  const foreign = await create('projects', { workspace_id: other.id, name: 'Foreign project' });
  assert.equal((await request('/today')).status, 404);
  assert.equal((await request(`/today?workspace_id=${workspace.id}&project_id=${foreign.id}`)).status, 404);
  assert.equal((await request(`/today?workspace_id=${workspace.id}&area_id=${area.id}&project_id=${project.id}`)).status, 400);
  assert.equal((await request(`/today?workspace_id=${workspace.id}&workspace_id=${other.id}`)).status, 400);
  assert.equal((await request(`/today?workspace_id=${workspace.id}&area_id=missing`)).status, 404);
}));

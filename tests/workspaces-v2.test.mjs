import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';

async function withApi(callback) {
  const dataDir = await mkdtemp(join(tmpdir(), 'rumbo-spaces-test-'));
  const forbidden = () => { throw new Error('Provider access is forbidden'); };
  const integrationOptions = { env: {}, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden };
  const api = createLocalApi({ dataDir, integrationOptions });
  const server = createServer((req, res) => api.middleware(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, body, method = body === undefined ? 'GET' : 'POST', expected = method === 'POST' ? 201 : 200) => {
    const res = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await res.json();
    assert.equal(res.status, expected, JSON.stringify(result));
    return result;
  };
  try {
    const workspace = (await call('/workspaces', { name: 'Studio' })).workspace;
    await callback({ call, api, workspace, dataDir, integrationOptions });
  } finally { api.close(); await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); }
}

test('teams, local members, documents and project milestones persist through edits and restart', async () => {
  await withApi(async ({ call, api, workspace, dataDir, integrationOptions }) => {
    const team = (await call('/teams', { workspace_id: workspace.id, name: 'Product', description: 'Build and learn.' })).team;
    const member = (await call('/team-members', { workspace_id: workspace.id, team_id: team.id, name: 'Evan', email: 'evan@example.test', role: 'Designer' })).team_member;
    const project = (await call('/projects', { workspace_id: workspace.id, team_id: team.id, name: 'Launch', start_date: '2026-09-19', target_date: '2026-10-01', lead: 'Evan' })).project;
    const doc = (await call('/documents', { workspace_id: workspace.id, team_id: team.id, title: 'How we work', content: '# Guidelines\nKeep it clear.' })).document;
    const projectDoc = (await call('/documents', { workspace_id: workspace.id, project_id: project.id, title: 'Specification' })).document;
    const milestone = (await call('/milestones', { workspace_id: workspace.id, project_id: project.id, title: 'Private preview', target_date: '2026-09-24' })).milestone;
    await call(`/documents/${doc.id}`, { content: 'Revised guidelines.' }, 'PATCH');
    await call(`/team-members/${member.id}`, { role: 'Builder' }, 'PATCH');
    await call(`/milestones/${milestone.id}`, { status: 'completed' }, 'PATCH');
    const reopened = createLocalApi({ dataDir, integrationOptions });
    try {
      const data = reopened.snapshot();
      assert.equal(data.teams[0].id, team.id);
      assert.equal(data.team_members[0].role, 'Builder');
      assert.equal(data.documents.find((item) => item.id === doc.id).content, 'Revised guidelines.');
      assert.equal(data.documents.find((item) => item.id === projectDoc.id).project_id, project.id);
      assert.equal(data.milestones[0].status, 'completed');
      assert.equal(data.projects[0].lead, 'Evan');
    } finally { reopened.close(); }
    assert.equal(api.snapshot().team_members.length, 1);
  });
});

test('scope, document ownership, calendar dates and local member email are validated', async () => {
  await withApi(async ({ call, workspace }) => {
    const other = (await call('/workspaces', { name: 'Other' })).workspace;
    const team = (await call('/teams', { workspace_id: workspace.id, name: 'Product' })).team;
    const project = (await call('/projects', { workspace_id: workspace.id, name: 'Launch' })).project;
    await call('/projects', { workspace_id: other.id, team_id: team.id, name: 'Wrong' }, 'POST', 400);
    await call('/documents', { workspace_id: workspace.id, title: 'Missing owner' }, 'POST', 400);
    await call('/documents', { workspace_id: workspace.id, team_id: team.id, project_id: project.id, title: 'Two owners' }, 'POST', 400);
    await call('/documents', { workspace_id: other.id, team_id: team.id, title: 'Wrong owner' }, 'POST', 400);
    await call('/team-members', { workspace_id: workspace.id, team_id: team.id, name: 'Evan', email: 'nope' }, 'POST', 400);
    await call(`/projects/${project.id}`, { start_date: '2026-10-02', target_date: '2026-10-01' }, 'PATCH', 400);
    await call(`/projects/${project.id}`, { target_date: '2026-02-30' }, 'PATCH', 400);
    await call('/milestones', { workspace_id: workspace.id, project_id: project.id, title: 'Bad', status: 'done' }, 'POST', 400);
    await call(`/teams/${team.id}`, { archived_at: new Date().toISOString() }, 'PATCH');
    await call('/projects', { workspace_id: workspace.id, team_id: team.id, name: 'Archived team' }, 'POST', 400);
    await call(`/teams/${team.id}`, { archived_at: null }, 'PATCH');
    await call('/projects', { workspace_id: workspace.id, team_id: team.id, name: 'Restored team' });
  });
});

test('project routes inherit team ownership and follow project team changes', async () => {
  await withApi(async ({ call, workspace }) => {
    const first = (await call('/teams', { workspace_id: workspace.id, name: 'Design' })).team;
    const second = (await call('/teams', { workspace_id: workspace.id, name: 'Engineering' })).team;
    const project = (await call('/projects', { workspace_id: workspace.id, team_id: first.id, name: 'Launch' })).project;
    const task = (await call('/tasks', { workspace_id: workspace.id, project_id: project.id, title: 'Preview' })).task;
    assert.equal(task.team_id, first.id);
    await call(`/tasks/${task.id}`, { team_id: second.id }, 'PATCH', 400);
    await call(`/projects/${project.id}`, { team_id: second.id }, 'PATCH');
    assert.equal((await call(`/tasks/${task.id}`)).task.team_id, second.id);
    const standalone = (await call('/tasks', { workspace_id: workspace.id, team_id: first.id, title: 'Planning' })).task;
    assert.equal(standalone.team_id, first.id);
    const moved = (await call(`/tasks/${standalone.id}`, { project_id: project.id }, 'PATCH')).task;
    assert.equal(moved.team_id, second.id);
    await call(`/projects/${project.id}`, { team_id: null }, 'PATCH');
    assert.equal((await call(`/tasks/${task.id}`)).task.team_id, null);
  });
});

test('workspace exports include only that workspace’s new collections and deletion follows ownership', async () => {
  await withApi(async ({ call, api, workspace }) => {
    const other = (await call('/workspaces', { name: 'Other' })).workspace;
    await call('/teams', { workspace_id: other.id, name: 'Private' });
    const team = (await call('/teams', { workspace_id: workspace.id, name: 'Product' })).team;
    const project = (await call('/projects', { workspace_id: workspace.id, team_id: team.id, name: 'Launch' })).project;
    await call('/documents', { workspace_id: workspace.id, team_id: team.id, title: 'Team doc' });
    await call('/team-members', { workspace_id: workspace.id, team_id: team.id, name: 'Evan' });
    const projectDoc = (await call('/documents', { workspace_id: workspace.id, project_id: project.id, title: 'Project doc' })).document;
    await call('/milestones', { workspace_id: workspace.id, project_id: project.id, title: 'Preview' });
    const exported = (await call(`/export?workspace_id=${workspace.id}`)).data;
    assert.deepEqual(exported.teams.map((row) => row.id), [team.id]);
    for (const key of ['teams', 'team_members', 'documents', 'milestones']) assert(exported[key].every((row) => row.workspace_id === workspace.id));
    await call(`/teams/${team.id}`, undefined, 'DELETE');
    assert.equal(api.snapshot().projects.find((row) => row.id === project.id).team_id, null);
    assert.deepEqual(api.snapshot().documents.map((row) => row.id), [projectDoc.id]);
    assert.equal(api.snapshot().team_members.length, 0);
    await call(`/projects/${project.id}`, undefined, 'DELETE');
    assert.equal(api.snapshot().documents.length, 0);
    assert.equal(api.snapshot().milestones.length, 0);
  });
});

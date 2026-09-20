import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createLocalApi } from '../server/local-api.mjs';
import { createAccessBoundary } from '../server/access-boundary.mjs';
import { createGovernanceService } from '../server/governance-service.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-access-regression-'));
  const api = createLocalApi({ dataDir: directory, seedMode: 'demo' });
  const db = new DatabaseSync(api.dbPath);
  const governance = createGovernanceService({ db });
  const access = createAccessBoundary({ db, governance });
  const snapshot = api.snapshot(); const project = snapshot.projects[0], workspaceId = project.workspace_id;
  t.after(async () => { db.close(); api.close(); await rm(directory, { recursive: true, force: true }); });
  return { api, db, governance, access, project, workspaceId };
}

test('archive authorization descriptor binds the delete capability', async t => {
  const { access, project } = await fixture(t);
  const result = access.check({ actor: { id: 'local-owner' }, path: `/projects/${project.id}`, method: 'PATCH', url: new URL('http://localhost'), body: { archived_at: new Date().toISOString() } });
  assert.equal(result.permission, 'projects.delete');
  assert.equal(result.destructive, true);
});

test('alternate archive and forget actions are classified as destructive', async t => {
  const { access, workspaceId } = await fixture(t);
  for (const [path, body, expected] of [
    ['/workflow/outputs/unknown', { workspace_id: workspaceId, archived: true }, 'documents.delete'],
    ['/workspace-items/unknown/action', { workspace_id: workspaceId, action: 'merge-label' }, 'workspace.delete'],
    ['/agent-memories/unknown/forget', { workspace_id: workspaceId, confirmed: true }, 'agents.delete'],
  ]) {
    const result = access.check({ actor: { id: 'local-owner' }, path, method: 'POST', url: new URL('http://localhost'), body });
    assert.equal(result.permission, expected); assert.equal(result.destructive, true);
  }
});

test('activity posts cannot use workspace permission to enter a denied project', async t => {
  const { governance, access, project, workspaceId } = await fixture(t);
  const member = governance.command(workspaceId, 'local-owner', 'create_member', { name: 'Admin', rank: 'Admin' });
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: member.id, permission: 'projects.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Restricted project' });
  assert.throws(() => access.check({ actor: { id: member.id }, path: '/activity', method: 'POST', url: new URL('http://localhost'), body: { workspace_id: workspaceId, target_type: 'project', target_id: project.id, content: 'Attempt', update_type: 'comment' } }), /Permission|required|denied/i);
});

test('encoded entity identifiers cannot bypass object scope checks', async t => {
  const { db, governance, access, project, workspaceId } = await fixture(t);
  const member = governance.command(workspaceId, 'local-owner', 'create_member', { name: 'Member' });
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: member.id, permission: 'projects.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Restricted' });
  const now = new Date().toISOString();
  db.prepare('INSERT INTO activity_entries(id,workspace_id,target_type,target_id,update_type,parent_id,actor_type,actor_id,actor_name,content,version,archived_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('entry', workspaceId, 'project', project.id, 'comment', null, 'user', 'local-owner', 'Owner', 'Private update', 1, null, now, now);
  assert.throws(() => access.check({ actor: { id: member.id }, path: '/activity/%65ntry', method: 'GET', url: new URL(`http://localhost/?workspace_id=${workspaceId}`) }), /Permission|unavailable/);
});

test('context snapshots cannot copy a source from a denied project directly or through a pack', async t => {
  const { db, governance, access, project, workspaceId } = await fixture(t);
  const member = governance.command(workspaceId, 'local-owner', 'create_member', { name: 'Member' });
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: member.id, permission: 'projects.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Restricted' });
  const now = new Date().toISOString();
  db.prepare('INSERT INTO documents(id,workspace_id,project_id,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('private-doc', workspaceId, project.id, 'Secret document', 'Private text', now, now);
  db.prepare('INSERT INTO workspace_items VALUES(?,?,?,?,?,?,?,?,?,?)').run('pack', workspaceId, 'context_pack', 'Shared-looking pack', JSON.stringify({ document_ids: ['private-doc'] }), 1, 1, null, now, now);
  const actor = { id: member.id }, method = 'POST', url = new URL('http://localhost');
  assert.throws(() => access.check({ actor, method, url, path: '/workflow/context', body: { workspace_id: workspaceId, sources: [{ type: 'documents', id: 'private-doc' }] } }), /context source/);
  assert.throws(() => access.check({ actor, method, url, path: '/chat-collaboration/unused', body: { workspace_id: workspaceId, action: 'context', sources: [{ kind: 'pack', id: 'pack' }] } }), /context source/);
});

test('project workflow reads use project permissions rather than document permissions', async t => {
  const { governance, access, project, workspaceId } = await fixture(t);
  const member = governance.command(workspaceId, 'local-owner', 'create_member', { name: 'Member' });
  governance.command(workspaceId, 'local-owner', 'grant', { member_id: member.id, permission: 'documents.read', effect: 'deny', reason: 'No document access' });
  assert.doesNotThrow(() => access.check({ actor: { id: member.id }, path: `/workflow/projects/${project.id}`, method: 'GET', url: new URL(`http://localhost/?workspace_id=${workspaceId}`) }));
});

test('signed activity attribution comes from the session and cannot forge an agent', async t => {
  const { api, project, workspaceId } = await fixture(t);
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const setup = await fetch(`${base}/identity/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Actual Owner', email: 'owner@example.com', password: 'correct long password' }) });
  assert.equal(setup.status, 200);
  const response = await fetch(`${base}/activity`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: setup.headers.get('set-cookie').split(';')[0] }, body: JSON.stringify({ workspace_id: workspaceId, target_type: 'project', target_id: project.id, update_type: 'comment', content: 'Authored update', actor_type: 'agent', actor_id: 'forged-codex', actor_name: 'Impersonated agent' }) });
  const body = await response.json(); assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.result.actor_id, 'local-owner'); assert.equal(body.result.actor_name, 'Actual Owner'); assert.equal(body.result.actor_type, 'user');
});

test('open event streams close before emitting new events after membership revocation', async t => {
  const { api, project, workspaceId } = await fixture(t);
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = async (path, body, cookie) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const controller = new AbortController();
  t.after(async () => { controller.abort(); await new Promise(resolve => server.close(resolve)); });
  const member = (await post('/governance', { workspace_id: workspaceId, action: 'create_member', name: 'Stream reader', email: 'reader@example.com' })).data.result;
  const run = (await post('/runs', { workspace_id: workspaceId, project_id: project.id, scenario: 'approval', mode: 'mock' })).data.run;
  const owner = await post('/identity/setup', { name: 'Owner', email: 'owner@example.com', password: 'correct long owner password' });
  const invitation = (await post('/identity/invite', { workspace_id: workspaceId, member_id: member.id }, owner.cookie)).data.result;
  const readerAccount = await post('/identity/accept', { token: invitation.invitation_token, password: 'correct long member password' });
  const response = await fetch(`${base}/runs/${run.id}/stream`, { headers: { cookie: readerAccount.cookie }, signal: controller.signal });
  assert.equal(response.status, 200); const stream = response.body.getReader(); await stream.read();
  await post('/governance', { workspace_id: workspaceId, action: 'remove_member', member_id: member.id, version: 1 }, owner.cookie);
  await post(`/runs/${run.id}/stop`, {}, owner.cookie);
  let trailing = ''; const timeout = setTimeout(() => controller.abort(), 1500);
  try { while (true) { const part = await stream.read(); if (part.done) break; trailing += new TextDecoder().decode(part.value); } }
  finally { clearTimeout(timeout); }
  assert.ok(!trailing.includes('run.stopped'), trailing);
});

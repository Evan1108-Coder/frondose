import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createLocalApi } from './fixtures/legacy-account-api.mjs';

test('signed members cannot read foreign workspaces or project-denied chat data through lists, exports, or direct endpoints', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'rumbo-identity-api-'));
  const api = createLocalApi({ dataDir, seedMode: 'demo' });
  const server = createServer((req, res) => api.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, method = 'GET', body, cookie) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const good = async (...args) => { const result = await call(...args); assert.ok(result.status < 300, JSON.stringify(result)); return result; };
  try {
    const initial = (await good('/bootstrap')).body;
    const ws = initial.workspaces[0].id;
    const foreign = (await good('/workspaces', 'POST', { name: 'Foreign private workspace' })).body.workspace.id;
    const project = (await good('/projects', 'POST', { workspace_id: ws, name: 'Hidden project', identifier: 'HID' })).body.project;
    const chat = (await good('/chats', 'POST', { workspace_id: ws, project_id: project.id, title: 'Hidden conversation' })).body.chat;
    const message = (await good(`/chats/${chat.id}/messages`, 'POST', { sender_type: 'user', sender_name: 'Owner', content: 'Private project discussion' })).body.message;
    const member = (await good('/governance', 'POST', { workspace_id: ws, action: 'create_member', name: 'Member', email: 'member@example.com' })).body.result;
    const setup = await good('/identity/setup', 'POST', { name: 'Owner', email: 'owner@example.com', password: 'owner test password 123' });
    const ownerCookie = setup.cookie;
    assert.equal((await call('/bootstrap')).status, 401);
    const invitation = (await good('/identity/invite', 'POST', { workspace_id: ws, member_id: member.id }, ownerCookie)).body.result;
    const accepted = await good('/identity/accept', 'POST', { token: invitation.invitation_token, password: 'member test password 123' });
    const memberCookie = accepted.cookie;
    const bootstrap = (await good('/bootstrap', 'GET', undefined, memberCookie)).body;
    assert.deepEqual(bootstrap.workspaces.map(w => w.id), [ws]);
    assert.equal((await call(`/workspaces/${foreign}`, 'GET', undefined, memberCookie)).status, 403);
    assert.equal((await call(`/export?workspace_id=${foreign}`, 'GET', undefined, memberCookie)).status, 403);
    assert.equal((await call('/governance', 'POST', { workspace_id: foreign, action: 'create_member', name: 'Intruder' }, memberCookie)).status, 403);
    await good('/governance', 'POST', { workspace_id: ws, action: 'grant', member_id: member.id, permission: 'projects.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Restricted project' }, ownerCookie);
    for (const path of [`/projects/${project.id}`, `/chats/${chat.id}`, `/chats/${chat.id}/messages`, `/chats/${chat.id}/export`, `/messages/${message.id}`]) assert.equal((await call(path, 'GET', undefined, memberCookie)).status, 403, path);
    assert.equal((await call(`/chats/${chat.id}/messages`, 'POST', { content: 'Bypass', sender_type: 'user', sender_name: 'Member' }, memberCookie)).status, 403);
    const filtered = (await good('/bootstrap', 'GET', undefined, memberCookie)).body;
    assert.ok(!filtered.projects.some(p => p.id === project.id));
    assert.ok(!filtered.chats.some(c => c.id === chat.id));
    assert.ok(!filtered.messages.some(m => m.id === message.id));
    assert.ok(!(await good('/messages', 'GET', undefined, memberCookie)).body.messages.some(m => m.id === message.id));
    await good('/governance', 'POST', { workspace_id: ws, action: 'remove_member', member_id: member.id, version: 1 }, ownerCookie);
    assert.equal((await call(`/projects?workspace_id=${ws}`, 'GET', undefined, memberCookie)).status, 403);
    assert.deepEqual((await good('/bootstrap', 'GET', undefined, memberCookie)).body.workspaces, []);
  } finally {
    await new Promise(resolve => server.close(resolve)); api.close(); await rm(dataDir, { recursive: true, force: true });
  }
});

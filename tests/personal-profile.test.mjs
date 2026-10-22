import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createLocalApi } from '../server/local-api.mjs';

test('personal names are actor scoped, handles unique, and private labels never shared or exported', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'frondose-personal-profile-'));
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
    const ws = (await good('/bootstrap')).body.workspaces[0].id;
    const person = (await good('/governance', 'POST', { workspace_id: ws, action: 'create_member', name: 'Member', email: 'member@example.com' })).body.result;
    const owner = (await good('/identity/setup', 'POST', { name: 'Owner', email: 'owner@example.com', password: 'owner test password 123' })).cookie;
    const invitation = (await good('/identity/invite', 'POST', { workspace_id: ws, member_id: person.id }, owner)).body.result;
    const member = (await good('/identity/accept', 'POST', { token: invitation.invitation_token, password: 'member test password 123' })).cookie;
    await good('/profile', 'PATCH', { name: 'Shared Owner', username: 'Owner.Name', self_display_name: 'Owner private nickname' }, owner);
    const edited = await good('/profile', 'PATCH', { name: 'Shared Member', username: 'member.name', self_display_name: 'Member private nickname', user_id: 'local-owner' }, member);
    assert.equal(edited.body.profile.id, person.id, 'supplied target IDs never select another account');
    const own = (await good('/bootstrap', 'GET', undefined, member)).body.profile;
    assert.equal(own.name, 'Shared Member'); assert.equal(own.self_display_name, 'Member private nickname');
    assert.equal((await good('/profile', 'GET', undefined, owner)).body.profile.username, 'owner.name');
    const directory = (await good(`/governance?workspace_id=${ws}`, 'GET', undefined, owner)).body;
    assert.ok(!JSON.stringify(directory).includes('private nickname'));
    assert.equal(directory.result.members.find(item => item.id === person.id).name, 'Shared Member');
    assert.equal(directory.result.members.find(item => item.id === person.id).username, 'member.name');
    const identity = (await good('/identity', 'GET', undefined, member)).body;
    assert.equal(identity.result.user.name, 'Shared Member');
    assert.ok(!JSON.stringify(identity).includes('private nickname'));
    const exported = (await good(`/export?workspace_id=${ws}`, 'GET', undefined, owner)).body;
    assert.ok(!Object.hasOwn(exported.data, 'profile')); assert.ok(!JSON.stringify(exported).includes('private nickname'));
    for (const username of ['OWNER.NAME', 'a', 'bad name', 'x@y', 'x'.repeat(33)]) {
      assert.equal((await call('/profile', 'PATCH', { username }, member)).status, 400, username);
    }
    for (const input of [{ name: '' }, { name: 'x\nspoof' }, { self_display_name: 'x'.repeat(101) }, { username: null }, { avatar_url: 'data:image/svg+xml;base64,PHN2Zy8+' }]) {
      assert.equal((await call('/profile', 'PATCH', input, member)).status, 400, JSON.stringify(input));
    }
    await good('/profile', 'PATCH', { self_display_name: '', username: '', avatar_url: null }, member);
    assert.equal((await good('/profile', 'GET', undefined, member)).body.profile.self_display_name, '');
    assert.equal((await call('/profile')).status, 401);
    assert.equal((await call(`/profile/${person.id}`, 'PATCH', { name: 'Bypass' }, member)).status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve)); api.close(); await rm(dataDir, { recursive: true, force: true });
  }
});

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
import { installActivity } from '../server/activity-service.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-updates-'));
  const api = createLocalApi({ dataDir: directory, seedMode: 'demo' });
  const db = new DatabaseSync(api.dbPath), governance = createGovernanceService({ db }), access = createAccessBoundary({ db, governance });
  const project = api.snapshot().projects[0], ws = project.workspace_id;
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body, cookie) => { const response = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }; };
  const post = extra => call('POST', '/activity', { workspace_id: ws, target_type: 'project', target_id: project.id, update_type: 'progress', content: 'Public work', ...extra });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); api.close(); await rm(directory, { recursive: true, force: true }); });
  return { api, db, governance, access, project, ws, call, post };
}

test('drafts stay author-only and are absent from every export and public history before and after publishing', async t => {
  const { api, db, governance, access, ws, call, post } = await fixture(t);
  const member = governance.command(ws, 'local-owner', 'create_member', { name: 'Reader' });
  const draft = (await post({ publication_state: 'draft', content: 'PRIVATE DRAFT', title: 'Private title' })).body.result;
  assert.equal(draft.actor_id, 'local-owner'); assert.equal(draft.can_edit, true);
  assert.equal(access.filter(api.snapshot(), { id: member.id }).activity_entries.length, 0);
  assert.equal(access.filter(api.snapshot(), { id: 'local-owner' }).activity_entries.length, 1);
  assert.equal((await call('GET', `/export?workspace_id=${ws}`)).body.data.activity_entries.length, 0);
  assert.deepEqual((await call('GET', `/history/${draft.id}?workspace_id=${ws}`)).body.result, []);
  assert.deepEqual((await call('GET', `/activity/${draft.id}/history?workspace_id=${ws}`)).body.result, []);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM change_log WHERE entity_id=?").get(draft.id).n, 0);
  assert.throws(() => access.check({ actor: { id: member.id }, path: `/activity/${draft.id}`, method: 'GET', url: new URL(`http://local/?workspace_id=${ws}`) }), /unavailable/);
  const published = await call('PATCH', `/activity/${draft.id}`, { workspace_id: ws, version: 1, publication_state: 'published', content: 'Safe published text', title: 'Public title', idempotency_key: 'publish-001' });
  assert.equal(published.status, 200); assert.ok(published.body.result.published_at);
  for (const path of [`/activity/${draft.id}/history?workspace_id=${ws}`, `/history/${draft.id}?workspace_id=${ws}`, `/export?workspace_id=${ws}`, '/events']) {
    const response = await call('GET', path); assert.equal(response.status, 200); assert.ok(!JSON.stringify(response.body).includes('PRIVATE DRAFT'), path);
  }
  const history = (await call('GET', `/activity/${draft.id}/history?workspace_id=${ws}`)).body.result;
  assert.equal(history[0].before, null); assert.equal(history[0].after.content, 'Safe published text');
  assert.equal((await call('PATCH', `/activity/${draft.id}`, { workspace_id: ws, version: 2, publication_state: 'draft' })).status, 400);
});

test('creation and publication retry keys are stable, content-bound and do not duplicate updates', async t => {
  const { db, ws, call, post } = await fixture(t);
  const first = await post({ idempotency_key: 'create-001', publication_state: 'draft' });
  const retry = await post({ idempotency_key: 'create-001', publication_state: 'draft' });
  assert.equal(first.body.result.id, retry.body.result.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM activity_entries').get().n, 1);
  assert.equal((await post({ idempotency_key: 'create-001', content: 'Different' })).status, 409);
  const body = { workspace_id: ws, version: 1, publication_state: 'published', idempotency_key: 'publish-001' };
  assert.equal((await call('PATCH', `/activity/${first.body.result.id}`, body)).body.result.version, 2);
  assert.equal((await call('PATCH', `/activity/${first.body.result.id}`, body)).body.result.version, 2);
});

test('feed filters, stable equal-time cursor pagination and target metadata work together', async t => {
  const { ws, db, project, call, post } = await fixture(t);
  for (let index = 0; index < 5; index++) await post({ title: `Progress ${index}`, health: 'on_track' });
  db.prepare("UPDATE activity_entries SET published_at='2026-01-01T00:00:00.000Z'").run();
  const url = `/activity/feed?workspace_id=${ws}&limit=2&search=Progress&health=on_track&project_id=${project.id}`;
  let cursor = null; const ids = [];
  do { const response = await call('GET', url + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')); assert.equal(response.status, 200); const { items, next_cursor } = response.body.result; for (const item of items) { ids.push(item.id); assert.equal(item.target.title, project.name); assert.equal(item.permalink, `#/updates/${item.id}`); } cursor = next_cursor; } while (cursor);
  assert.equal(ids.length, 5); assert.equal(new Set(ids).size, 5);
});

test('reply trees are bounded and reject private or archived ancestry; reactions belong to each actor', async t => {
  const { ws, db, call, post } = await fixture(t);
  let parent = (await post()).body.result;
  for (let depth = 2; depth <= 5; depth++) { const reply = await post({ parent_id: parent.id, update_type: 'comment' }); assert.equal(reply.status, 201); parent = reply.body.result; }
  assert.equal(parent.can_reply, false);
  assert.equal((await post({ parent_id: parent.id })).status, 400);
  const draft = (await post({ publication_state: 'draft' })).body.result;
  assert.equal((await post({ parent_id: draft.id })).status, 400);
  const body = { workspace_id: ws, reaction: { id: 'icon:thumbs-up' }, action: 'add' };
  const response = await call('POST', `/activity/${parent.id}/reactions`, body);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  await call('POST', `/activity/${parent.id}/reactions`, body);
  db.prepare('INSERT INTO activity_reactions VALUES(?,?,?,?,?)').run(parent.id, 'other-member', 'icon:thumbs-up', '', new Date().toISOString());
  const removed = await call('POST', `/activity/${parent.id}/reactions`, { ...body, action: 'remove' });
  assert.equal(removed.body.result.reactions[0].count, 1); assert.equal(removed.body.result.reactions[0].mine, false);
  assert.equal((await call('POST', `/activity/${parent.id}/reactions`, { ...body, reaction: { id: 'custom:foreign' } })).status, 400);
});

test('target-area denial and legacy multi-project scope apply to bootstrap and history', async t => {
  const { api, db, governance, access, ws, project, post } = await fixture(t);
  const task = api.snapshot().tasks.find(item => item.workspace_id === ws);
  await post({ target_type: 'route', target_id: task.id });
  const member = governance.command(ws, 'local-owner', 'create_member', { name: 'Restricted' });
  governance.command(ws, 'local-owner', 'grant', { member_id: member.id, permission: 'routes.read', effect: 'deny', reason: 'Routes restricted' });
  assert.equal(access.filter(api.snapshot(), { id: member.id }).activity_entries.length, 0);
  governance.command(ws, 'local-owner', 'grant', { member_id: member.id, permission: 'projects.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Project restricted' });
  const time = new Date().toISOString();
  db.prepare('INSERT INTO workspace_items VALUES(?,?,?,?,?,?,?,?,?,?)').run('legacy-update', ws, 'update', 'Private project update', JSON.stringify({ project_ids: [project.id], content: 'Private' }), 0, 1, null, time, time);
  assert.ok(!access.filter(api.snapshot(), { id: member.id }).workspace_items.some(item => item.id === 'legacy-update'));
});

test('published updates import with remapped targets and parents, never draft content or author privileges', async t => {
  const { ws, call, post } = await fixture(t);
  const root = (await post()).body.result;
  await post({ parent_id: root.id, update_type: 'comment' });
  await post({ publication_state: 'draft', content: 'Never export' });
  const archive = (await call('GET', `/export?workspace_id=${ws}`)).body;
  assert.equal(archive.data.activity_entries.length, 2);
  archive.data.activity_entries.push({ ...root, id: 'private-draft', publication_state: 'draft', content: 'Never import' });
  const imported = await call('POST', '/import', archive);
  assert.equal(imported.status, 201, JSON.stringify(imported.body)); assert.equal(imported.body.result.skipped_activity_drafts, 1);
  const entries = imported.body.bootstrap.activity_entries.filter(item => item.workspace_id === imported.body.result.id);
  assert.equal(entries.length, 2); assert.ok(entries.every(item => item.actor_id === null && item.imported === 1 && item.can_edit === false));
  assert.notEqual(entries[0].target_id, root.target_id); assert.ok(entries.some(item => entries.some(other => other.id === item.parent_id)));
});

test('runtime activity migration keeps historical records published and is repeatable', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES('ws'); CREATE TABLE activity_entries(id TEXT PRIMARY KEY,workspace_id TEXT,target_type TEXT,target_id TEXT,update_type TEXT,parent_id TEXT,actor_type TEXT,actor_id TEXT,actor_name TEXT,content TEXT,version INTEGER,archived_at TEXT,created_at TEXT,updated_at TEXT); INSERT INTO activity_entries VALUES('old','ws','project','p','progress',NULL,'user',NULL,'Historical user','Old content',1,NULL,'2026-01-01','2026-01-01')");
  installActivity(db); installActivity(db);
  const columns = db.prepare('PRAGMA table_info(activity_entries)').all();
  assert.equal(columns.find(item => item.name === 'publication_state').dflt_value, "'published'");
  const existing = db.prepare('SELECT * FROM activity_entries WHERE id=?').get('old');
  assert.equal(existing.publication_state, 'published'); assert.equal(existing.published_at, '2026-01-01'); assert.equal(existing.actor_id, null); assert.equal(existing.title, '');
  db.close();
});

test('signed readers cannot get private drafts through detail, feed, bootstrap, events, export or history', async t => {
  const { ws, governance, call, post } = await fixture(t);
  const draft = (await post({ publication_state: 'draft', title: 'PRIVATE TITLE', content: 'PRIVATE CONTENT' })).body.result;
  const reader = governance.command(ws, 'local-owner', 'create_member', { name: 'Reader', email: 'reader@example.com' });
  const owner = await call('POST', '/identity/setup', { name: 'Owner', email: 'owner@example.com', password: 'long owner password 123' });
  const invitation = await call('POST', '/identity/invite', { workspace_id: ws, member_id: reader.id }, owner.cookie);
  const account = await call('POST', '/identity/accept', { token: invitation.body.result.invitation_token, password: 'long reader password 123' });
  for (const path of ['/bootstrap', '/events', `/activity/feed?workspace_id=${ws}&publication_state=draft`, `/export?workspace_id=${ws}`, `/history/${draft.id}?workspace_id=${ws}`, `/activity/${draft.id}/history?workspace_id=${ws}`, `/activity/${draft.id}?workspace_id=${ws}`]) {
    const response = await call('GET', path, undefined, account.cookie);
    assert.ok(!JSON.stringify(response.body).includes('PRIVATE'), path);
    if (path.includes(draft.id)) assert.equal(response.status, 403, path);
  }
});

test('moderators may archive and restore published updates but never rewrite words or inspect private drafts', async t => {
  const { ws, db, governance, access, call, post } = await fixture(t);
  const published = (await post()).body.result;
  const draft = (await post({ publication_state: 'draft' })).body.result;
  const manager = governance.command(ws, 'local-owner', 'create_member', { name: 'Manager', email: 'manager@example.com', rank: 'Manager' });
  governance.command(ws, 'local-owner', 'grant', { member_id: manager.id, permission: 'projects.delete', effect: 'allow', reason: 'Moderate project updates' });
  const owner = await call('POST', '/identity/setup', { name: 'Owner', email: 'owner@example.com', password: 'long owner password 123' });
  const invitation = await call('POST', '/identity/invite', { workspace_id: ws, member_id: manager.id }, owner.cookie);
  const account = await call('POST', '/identity/accept', { token: invitation.body.result.invitation_token, password: 'long manager password 123' });
  const read = await call('GET', `/activity/${published.id}?workspace_id=${ws}`, undefined, account.cookie);
  assert.equal(read.body.result.can_edit, false); assert.equal(read.body.result.can_archive, true);
  assert.equal((await call('PATCH', `/activity/${published.id}`, { workspace_id: ws, version: 1, content: 'Rewrite another author' }, account.cookie)).status, 403);
  // Protected mutation approvals are deliberately not bypassed by activity capabilities.
  const archived = await call('DELETE', `/activity/${published.id}`, { workspace_id: ws, version: 1 }, account.cookie);
  assert.ok([200, 409].includes(archived.status));
  if (archived.status === 409) assert.equal(archived.body.error.code, 'approval_required');
  assert.equal((await call('GET', `/activity/${draft.id}?workspace_id=${ws}`, undefined, account.cookie)).status, 403);
  const now = new Date().toISOString();
  db.prepare('UPDATE activity_entries SET archived_at=?,version=2 WHERE id=?').run(now, published.id);
  const result = access.filter({ activity_entries: [db.prepare('SELECT * FROM activity_entries WHERE id=?').get(published.id)] }, { id: manager.id }).activity_entries[0];
  assert.equal(result.can_restore, true);
  assert.equal((await call('PATCH', `/activity/${published.id}`, { workspace_id: ws, version: 2, archived_at: null, content: 'Sneaky restore edit' }, account.cookie)).status, 400);
});

test('historical draft snapshots stay hidden even after the current entry has been published', async t => {
  const { ws, db, call, post } = await fixture(t);
  const entry = (await post()).body.result;
  db.prepare('INSERT INTO change_log VALUES(?,?,?,?,?,?,?,?,?)').run('legacy-draft-log', ws, 'activity_entries', entry.id, 'updated', 'SECRET HISTORY NAME', JSON.stringify({ ...entry, publication_state: 'draft', content: 'SECRET HISTORY' }), JSON.stringify(entry), new Date().toISOString());
  for (const path of ['/bootstrap', '/events', `/history/${entry.id}?workspace_id=${ws}`, `/activity/${entry.id}/history?workspace_id=${ws}`, `/export?workspace_id=${ws}`]) assert.ok(!JSON.stringify((await call('GET', path)).body).includes('SECRET HISTORY'), path);
});

test('request updates require every linked project and accepted route visibility in feeds and snapshots', async t => {
  const { api, ws, db, governance, access, project, post } = await fixture(t);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workspace_items VALUES(?,?,?,?,?,?,?,?,?,?)').run('linked-request', ws, 'request', 'Restricted request', JSON.stringify({ project_ids: [project.id] }), 0, 1, null, now, now);
  const entry = (await post({ target_type: 'request', target_id: 'linked-request' })).body.result;
  assert.ok(entry?.id);
  const member = governance.command(ws, 'local-owner', 'create_member', { name: 'Scoped reader' });
  governance.command(ws, 'local-owner', 'grant', { member_id: member.id, permission: 'projects.read', effect: 'deny', scope_type: 'project', scope_id: project.id, reason: 'Private project' });
  assert.equal(access.filter(api.snapshot(), { id: member.id }).activity_entries.length, 0);
  assert.throws(() => access.check({ actor: { id: member.id }, path: `/activity/${entry.id}`, method: 'GET', url: new URL(`http://local/?workspace_id=${ws}`) }), /unavailable/);
  const route = api.snapshot().tasks.find(item => item.workspace_id === ws);
  const routeReader = governance.command(ws, 'local-owner', 'create_member', { name: 'No route access' });
  governance.command(ws, 'local-owner', 'grant', { member_id: routeReader.id, permission: 'routes.read', effect: 'deny', reason: 'Routes private' });
  db.prepare('UPDATE workspace_items SET payload_json=? WHERE id=?').run(JSON.stringify({ route_id: route.id }), 'linked-request');
  assert.equal(access.filter(api.snapshot(), { id: routeReader.id }).activity_entries.length, 0);
});

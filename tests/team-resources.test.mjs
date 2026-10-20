import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installTeamResources, teamResourcesRoute, TEAM_RESOURCE_LIMITS } from '../server/team-resources.mjs';
import { installWorkspaceFeatures } from '../server/workspace-features.mjs';

async function fixture(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-team-resources-'));
  const path = join(directory, 'test.sqlite');
  const db = new DatabaseSync(path);
  db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  for (const table of ['workspaces', 'projects', 'tasks', 'chats']) if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'archived_at')) db.exec(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
  installWorkspaceFeatures(db); installTeamResources(db);
  const now = new Date().toISOString();
  for (const id of ['ws', 'other']) db.prepare('INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, id, id, now, now);
  for (const [id, workspace] of [['team', 'ws'], ['team2', 'ws'], ['foreign', 'other']]) db.prepare('INSERT INTO teams(id,workspace_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, workspace, id, now, now);
  for (const [id, workspace] of [['project', 'ws'], ['foreign-project', 'other']]) db.prepare('INSERT INTO projects(id,workspace_id,name,identifier,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, workspace, id, id, now, now);
  const call = async (method = 'GET', suffix = '', body = {}, params = {}, headers = {}) => {
    let output, maximum;
    const url = new URL(`http://localhost/api/team-resources${suffix}`);
    for (const [key, value] of Object.entries({ workspace_id: 'ws', team_id: 'team', ...params })) url.searchParams.set(key, value);
    const res = { writeHead: (status, headers) => { output = { status, headers }; }, end: content => { output.content = content; } };
    const handled = await teamResourcesRoute({ db, req: { method, headers }, res, path: `/team-resources${suffix}`, url, readBody: async (_req, limit) => { maximum = limit; return { workspace_id: 'ws', team_id: 'team', ...body }; }, send: (_res, status, payload) => { output = { status, ...payload }; } });
    assert.equal(handled, true); return { ...output, maximum };
  };
  const add = (kind = 'url', extra = {}) => call('POST', '', { kind, name: 'Resource', url: 'https://example.com/guide', ...extra });
  const upload = (bytes, name = 'note.txt') => add('file', { file: { name, data_base64: Buffer.from(bytes).toString('base64') } });
  try { await fn({ db, path, call, add, upload }); } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
}

test('team resources persist metadata and bytes independently; bootstrap-sized list never contains files', async () => fixture(async ({ db, path, call, upload }) => {
  const result = (await upload('Keep this file', '../note.txt')).result;
  assert.equal(result.file_name, 'note.txt'); assert.equal(result.byte_size, 14);
  const listed = (await call()).result;
  assert.equal(listed.items[0].name, 'Resource'); assert.equal(listed.storage_bytes, 14);
  assert.ok(!JSON.stringify(listed).includes('Keep this file'));
  assert.ok(!db.prepare('SELECT after_json FROM change_log WHERE entity_id=?').get(result.id).after_json.includes('Keep this file'));
  const reopened = new DatabaseSync(path);
  try { assert.equal(Buffer.from(reopened.prepare('SELECT content FROM team_resource_files WHERE resource_id=?').get(result.id).content).toString(), 'Keep this file'); } finally { reopened.close(); }
}));

test('resources are scoped on listing, mutation and file download, including archived owners', async () => fixture(async ({ db, call, upload }) => {
  const item = (await upload('private team context')).result;
  assert.equal((await call('GET', '', {}, { team_id: 'team2' })).result.items.length, 0);
  await assert.rejects(call('GET', `/${item.id}/content`, {}, { team_id: 'team2' }), /not available/);
  await assert.rejects(call('PATCH', `/${item.id}`, { team_id: 'team2', version: 1, name: 'No' }), /not available/);
  await assert.rejects(call('GET', '', {}, { team_id: 'foreign' }), /active team/);
  db.prepare('UPDATE workspaces SET archived_at=? WHERE id=?').run('now', 'ws');
  await assert.rejects(call('GET', `/${item.id}/content`), /active team/);
}));

test('links reject executable URLs, credentials and invalid branch shapes without fetching anything', async () => fixture(async ({ add }) => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'https://user:secret@example.com/']) await assert.rejects(add('url', { url }), /http|credentials/);
  for (const url of ['https://example.com/a/b/tree/main', 'http://github.com/a/b/tree/main', 'https://github.com/a/b', 'https://github.com:8443/a/b/tree/main']) await assert.rejects(add('branch', { url }), /GitHub branch/);
  assert.equal((await add('branch', { url: 'https://github.com/example/repo/tree/feature/resources' })).result.kind, 'branch');
}));

test('Frondose references require active matching workspace records, and updates retain resource type', async () => fixture(async ({ db, call, add }) => {
  const resource = (await add('project', { ref_id: 'project' })).result;
  assert.equal(resource.ref_id, 'project');
  await assert.rejects(add('project', { ref_id: 'foreign-project' }), /workspace/);
  await assert.rejects(call('PATCH', `/${resource.id}`, { version: 1, kind: 'url', name: 'Changed', url: 'https://example.com' }), /types cannot/);
  db.prepare('UPDATE projects SET archived_at=? WHERE id=?').run('now', 'project');
  await assert.rejects(add('project', { ref_id: 'project' }), /active/);
}));

test('updates require the current revision; archive blocks access while restore retains original bytes', async () => fixture(async ({ call, upload }) => {
  const resource = (await upload('original')).result;
  const edited = (await call('PATCH', `/${resource.id}`, { version: 1, name: 'Edited', description: 'Explained' })).result;
  assert.equal(edited.version, 2); assert.equal(edited.description, 'Explained');
  await assert.rejects(call('PATCH', `/${resource.id}`, { version: 1, name: 'Stale' }), error => error.statusCode === 409);
  const archived = (await call('PATCH', `/${resource.id}`, { version: 2, archived_at: true })).result;
  assert.ok(archived.archived_at);
  await assert.rejects(call('GET', `/${resource.id}/content`), /Restore/);
  await assert.rejects(call('PATCH', `/${resource.id}`, { version: 3, name: 'No' }), /Restore/);
  await call('PATCH', `/${resource.id}`, { version: 3, archived_at: null });
  assert.equal((await call('GET', `/${resource.id}/content`)).content.toString(), 'original');
}));

test('file downloads are safe attachments regardless of claimed MIME or executable filename', async () => fixture(async ({ call, add }) => {
  const item = (await add('file', { file: { name: 'unsafe.html', type: 'image/png', data_base64: Buffer.from('<script>alert(1)</script>').toString('base64') } })).result;
  const response = await call('GET', `/${item.id}/content`, {}, { preview: '1' });
  assert.equal(response.headers['Content-Type'], 'application/octet-stream');
  assert.match(response.headers['Content-Disposition'], /^attachment/);
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(response.headers['Content-Security-Policy'], /sandbox/);
}));

test('permanent removal requires archive plus explicit confirmation and frees workspace storage', async () => fixture(async ({ db, call, upload }) => {
  const item = (await upload('context')).result;
  await assert.rejects(call('DELETE', `/${item.id}`, { version: 1, confirmed: true }), /Archive/);
  await call('PATCH', `/${item.id}`, { version: 1, archived_at: true });
  await assert.rejects(call('DELETE', `/${item.id}`, { version: 2 }), /confirm/);
  await assert.rejects(call('DELETE', `/${item.id}`, { version: 1, confirmed: true }), error => error.statusCode === 409);
  await call('DELETE', `/${item.id}`, { version: 2, confirmed: true });
  assert.equal(db.prepare('SELECT COUNT(*) count FROM team_resource_files').get().count, 0);
  assert.equal((await call()).result.storage_bytes, 0);
}));

test('validated media previews and range downloads have consistent lengths and HEAD semantics', async () => fixture(async ({ call, upload }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6d5sAAAAASUVORK5CYII=', 'base64');
  const item = (await upload(png, 'picture.png')).result;
  const preview = await call('GET', `/${item.id}/content`, {}, { preview: '1' });
  assert.equal(preview.headers['Content-Type'], 'image/png'); assert.match(preview.headers['Content-Disposition'], /^inline/);
  const range = await call('GET', `/${item.id}/content`, {}, {}, { range: 'bytes=1-3' });
  assert.equal(range.status, 206); assert.deepEqual(range.content, png.subarray(1, 4)); assert.equal(range.headers['Content-Length'], '3');
  assert.equal((await call('GET', `/${item.id}/content`, {}, {}, { range: 'bytes=999999-' })).status, 416);
  assert.equal((await call('GET', `/${item.id}/content`, {}, {}, { range: 'bytes=0-1,3-4' })).status, 416);
  assert.equal((await call('GET', `/${item.id}/content`, {}, {}, { range: 'bytes=-0' })).status, 416);
  const head = await call('HEAD', `/${item.id}/content`); assert.equal(head.content, undefined); assert.equal(head.headers['Content-Length'], String(png.length));
}));

test('invalid, empty or oversized uploads and storage limits fail before creating metadata or bytes', async () => fixture(async ({ db, add, upload }) => {
  for (const data_base64 of ['', '@@@@', 'eA==wrong', 'AB==']) await assert.rejects(add('file', { file: { name: 'file.txt', data_base64 } }), /file|upload/i);
  await assert.rejects(add('file', { file: { name: 'file.txt', data_base64: 'A'.repeat(Math.ceil(TEAM_RESOURCE_LIMITS.fileBytes / 3) * 4 + 4) } }), /25 MB/);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM team_resources').get().count, 0);
  const item = (await upload('one')).result;
  db.prepare('UPDATE team_resources SET byte_size=? WHERE id=?').run(TEAM_RESOURCE_LIMITS.workspaceBytes, item.id);
  await assert.rejects(upload('two'), /250 MB/);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM team_resources').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM team_resource_files').get().count, 1);
}));

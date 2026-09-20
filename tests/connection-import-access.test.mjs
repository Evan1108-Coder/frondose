import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectionImports } from '../server/connection-platform-imports.mjs';
import { installConnectionPlatform, createConnectionPlatform } from '../server/connection-platform.mjs';

const actor = { id: 'member' };
const denied = error => error.statusCode === 403;
const unavailable = error => error.code === 'target_unavailable';

async function fixture(run) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  // Production adds this relationship in the local API migration.
  db.exec('ALTER TABLE projects ADD COLUMN team_id TEXT REFERENCES teams(id)');
  db.exec('ALTER TABLE projects ADD COLUMN archived_at TEXT');
  installConnectionPlatform(db);
  for (const id of ['ws', 'other']) db.prepare('INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, id, id, 'now', 'now');
  for (const id of ['team', 'other-team']) db.prepare('INSERT INTO teams(id,workspace_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, 'ws', id, 'now', 'now');
  for (const [id, workspace, team] of [['project', 'ws', 'team'], ['restricted', 'ws', 'other-team'], ['foreign', 'other', null]]) {
    db.prepare('INSERT INTO projects(id,workspace_id,team_id,name,identifier,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, workspace, team, id, id, 'now', 'now');
  }
  const connection = { id: 'connection', workspace_id: 'ws', scope_type: 'workspace', scope_id: 'ws', settings: { selected_resources: ['repository'] } };
  db.prepare('INSERT INTO platform_connections(id,workspace_id,provider,scope_type,scope_id,settings,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(connection.id, 'ws', 'github', 'workspace', 'ws', JSON.stringify(connection.settings), 'now', 'now');
  const calls = [], deniedScopes = new Set();
  const imports = createConnectionImports({
    db, get: () => connection, audit: () => {},
    check: async (who, source, permission, override) => {
      const scope = override || source;
      calls.push({ actor: who.id, workspace_id: source.workspace_id, permission, scope_type: scope.scope_type, scope_id: scope.scope_id });
      if (deniedScopes.has(`${scope.scope_id}:${permission}`) || deniedScopes.has(`${scope.scope_id}:*`)) throw Object.assign(new Error('Explicit destination denial'), { statusCode: 403 });
    },
  });
  function addSource(id = 'source', body = 'Original source') {
    db.prepare('INSERT INTO platform_external_objects(id,connection_id,resource_id,kind,external_id,title,url,content,content_hash,provider_updated_at,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, connection.id, 'repository', 'issues', id, `Title ${id}`, null, JSON.stringify({ body }), id, 'now', 'now');
    return id;
  }
  function changeSource(id = 'source') { db.prepare('UPDATE platform_external_objects SET content=? WHERE id=?').run(JSON.stringify({ body: 'Changed source' }), id); }
  async function create(target_type, destination = {}, object_id = 'source') {
    return imports.importObject(connection.id, { target_type, object_id, ...destination }, actor);
  }
  async function conflict(target_type = 'document', destination = { project_id: 'project' }) {
    addSource();
    const created = await create(target_type, destination);
    const table = target_type === 'document' ? 'documents' : target_type === 'route' ? 'tasks' : 'projects';
    const text = target_type === 'document' ? 'content' : 'description';
    db.prepare(`UPDATE ${table} SET ${text}=? WHERE id=?`).run('Private local edit', created.target_id);
    changeSource();
    return { created, conflict: (await create(target_type, destination)).conflict };
  }
  try { await run({ db, connection, imports, calls, deniedScopes, addSource, changeSource, create, conflict }); }
  finally { db.close(); }
}

test('native creation authorizes the actual project/team, not just the workspace connection', () => fixture(async ({ db, addSource, create, deniedScopes, calls }) => {
  addSource();
  deniedScopes.add('restricted:*');
  for (const target of ['route', 'document']) await assert.rejects(create(target, { project_id: 'restricted' }), denied);
  deniedScopes.add('other-team:documents.edit');
  await assert.rejects(create('document', { team_id: 'other-team' }), denied);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_object_links').get().n, 0);
  const result = await create('document', { project_id: 'project' });
  assert.equal(result.status, 'created');
  assert.ok(calls.some(call => call.permission === 'documents.edit' && call.scope_type === 'project' && call.scope_id === 'project'));
  assert.ok(calls.some(call => call.permission === 'projects.read' && call.scope_id === 'project'));
  assert.ok(calls.every(call => call.workspace_id === 'ws' && call.actor === 'member'));
}));

test('repeat imports recheck access even when unchanged or caller supplies a different destination', () => fixture(async ({ db, create, addSource, changeSource, deniedScopes }) => {
  addSource();
  const first = await create('route', { project_id: 'project' });
  deniedScopes.add('project:routes.edit');
  await assert.rejects(create('route', { project_id: 'restricted' }), denied);
  changeSource();
  await assert.rejects(create('route', { project_id: 'restricted' }), denied);
  assert.equal(db.prepare('SELECT description FROM tasks WHERE id=?').get(first.target_id).description, 'Original source');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_sync_conflicts').get().n, 0);
}));

test('connection readers cannot list conflict text from denied native destinations', () => fixture(async ({ conflict, imports, connection, deniedScopes }) => {
  await conflict();
  assert.equal((await imports.conflicts(connection.id, actor))[0].local_value.text, 'Private local edit');
  for (const permission of ['projects.read', 'documents.read', 'workspace.read']) {
    deniedScopes.add(`project:${permission}`);
    assert.deepEqual(await imports.conflicts(connection.id, actor), []);
    deniedScopes.clear();
  }
  deniedScopes.add('project:documents.edit');
  assert.equal((await imports.conflicts(connection.id, actor)).length, 1, 'read-only access can inspect a conflict but not resolve it');
}));

test('conflict resolution rechecks destination permission and preserves data on denial', () => fixture(async ({ db, conflict, imports, connection, deniedScopes }) => {
  const { created, conflict: item } = await conflict();
  deniedScopes.add('project:documents.edit');
  for (const resolution of ['keep_local', 'use_external']) await assert.rejects(imports.resolve(connection.id, { conflict_id: item.id, expected_local_hash: item.local_hash, resolution }, actor), denied);
  assert.equal(db.prepare('SELECT content FROM documents WHERE id=?').get(created.target_id).content, 'Private local edit');
  assert.equal(db.prepare('SELECT state FROM platform_sync_conflicts WHERE id=?').get(item.id).state, 'open');
  deniedScopes.clear();
  assert.equal((await imports.resolve(connection.id, { conflict_id: item.id, expected_local_hash: item.local_hash, resolution: 'use_external' }, actor)).resolved, true);
  assert.equal(db.prepare('SELECT content FROM documents WHERE id=?').get(created.target_id).content, 'Changed source');
}));

test('moving a native target changes the scope checked by reads, repeated imports and resolution', () => fixture(async ({ db, conflict, imports, connection, create, deniedScopes }) => {
  const { created, conflict: item } = await conflict();
  db.prepare('UPDATE documents SET project_id=? WHERE id=?').run('restricted', created.target_id);
  deniedScopes.add('restricted:*');
  assert.deepEqual(await imports.conflicts(connection.id, actor), []);
  await assert.rejects(create('document', { project_id: 'project' }), denied);
  await assert.rejects(imports.resolve(connection.id, { conflict_id: item.id, expected_local_hash: item.local_hash, resolution: 'keep_local' }, actor), denied);
}));

test('archived and foreign destinations reject creation, including a project under an archived team', () => fixture(async ({ db, create, addSource }) => {
  addSource();
  await assert.rejects(create('route', { project_id: 'foreign' }), unavailable);
  db.prepare('UPDATE projects SET archived_at=? WHERE id=?').run('now', 'restricted');
  await assert.rejects(create('route', { project_id: 'restricted' }), unavailable);
  db.prepare('UPDATE teams SET archived_at=? WHERE id=?').run('now', 'team');
  await assert.rejects(create('document', { team_id: 'team' }), unavailable);
  await assert.rejects(create('document', { project_id: 'project' }), unavailable);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_object_links').get().n, 0);
}));

test('archiving a linked parent hides conflicts and blocks repeated import/resolution', () => fixture(async ({ db, conflict, imports, connection, create }) => {
  const { conflict: item } = await conflict();
  db.prepare('UPDATE projects SET archived_at=? WHERE id=?').run('now', 'project');
  assert.deepEqual(await imports.conflicts(connection.id, actor), []);
  await assert.rejects(create('document', { project_id: 'project' }), unavailable);
  await assert.rejects(imports.resolve(connection.id, { conflict_id: item.id, expected_local_hash: item.local_hash, resolution: 'use_external' }, actor), unavailable);
}));

test('team-scoped connections retain their ownership boundary despite broad destination grants', () => fixture(async ({ connection, create, addSource }) => {
  addSource();
  connection.scope_type = 'team'; connection.scope_id = 'team';
  await assert.rejects(create('route', { project_id: 'restricted' }), denied);
  await assert.rejects(create('document', { team_id: 'other-team' }), denied);
  await assert.rejects(create('project'), denied);
  assert.equal((await create('route', { project_id: 'project' })).status, 'created');
}));

test('imported projects use workspace creation scope then their own project scope on later imports', () => fixture(async ({ addSource, create, calls, deniedScopes }) => {
  addSource();
  const first = await create('project');
  assert.ok(calls.some(call => call.permission === 'projects.edit' && call.scope_type === 'workspace' && call.scope_id === 'ws'));
  deniedScopes.add(`${first.target_id}:projects.edit`);
  await assert.rejects(create('project'), denied);
}));

test('platform forwards destination scope without changing workspace/connection identity', () => fixture(async ({ db, addSource, connection }) => {
  addSource();
  const dataDir = mkdtempSync(join(tmpdir(), 'rumbo-import-access-'));
  const permissions = [];
  const platform = createConnectionPlatform({ db, dataDir, env: {}, workerIntervalMs: 0,
    fetchImpl: () => { throw new Error('This test must not contact any provider'); },
    authorize: request => {
      permissions.push(request);
      return request.scope_id !== 'restricted';
    },
  });
  try {
    await assert.rejects(platform.importObject(connection.id, { target_type: 'document', project_id: 'restricted', object_id: 'source' }, actor), denied);
    assert.ok(permissions.some(request => request.scope_type === 'project' && request.scope_id === 'restricted'));
    assert.ok(permissions.every(request => request.workspace_id === 'ws' && request.connection_id === connection.id));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_object_links').get().n, 0);
  } finally { platform.close(); rmSync(dataDir, { recursive: true }); }
}));

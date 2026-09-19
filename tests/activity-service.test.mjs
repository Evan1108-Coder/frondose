import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { installWorkspaceFeatures } from '../server/workspace-features.mjs';
import { installWorkflow } from '../server/workflow-service.mjs';
import { ACTIVITY_TYPES, activityRoute, installActivity } from '../server/activity-service.mjs';

async function fixture(run) {
  const db = new DatabaseSync(':memory:');
  db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  for (const table of ['workspaces', 'projects', 'tasks', 'chats']) if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'archived_at')) db.exec(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
  installWorkspaceFeatures(db); installWorkflow(db); installActivity(db);
  const now = new Date().toISOString();
  for (const id of ['ws', 'other']) db.prepare('INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, id, id, now, now);
  for (const [id, ws] of [['project', 'ws'], ['foreign-project', 'other']]) db.prepare('INSERT INTO projects(id,workspace_id,name,identifier,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, ws, id, id, now, now);
  db.prepare('INSERT INTO tasks(id,workspace_id,project_id,number,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('route', 'ws', 'project', 1, 'Route', now, now);
  db.prepare('INSERT INTO documents(id,workspace_id,project_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('document', 'ws', 'project', 'Document', now, now);
  db.prepare('INSERT INTO milestones(id,workspace_id,project_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('milestone', 'ws', 'project', 'Milestone', now, now);
  db.prepare('INSERT INTO workspace_items VALUES (?,?,?,?,?,?,?,?,?,?)').run('request', 'ws', 'request', 'Request', '{}', 1, 1, null, now, now);
  const call = async (method, suffix = '', body = {}, query = {}) => {
    let response;
    const url = new URL(`http://localhost/api/activity${suffix}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const handled = await activityRoute({ db, req: { method }, res: {}, path: `/activity${suffix}`, url, readBody: async () => body, send: (_res, status, payload) => { response = { status, ...payload }; } });
    assert.equal(handled, true); return response;
  };
  try { await run({ db, call }); } finally { db.close(); }
}

const entry = (target_type = 'project', target_id = 'project', extra = {}) => ({ workspace_id: 'ws', target_type, target_id, update_type: 'progress', actor_type: 'user', actor_id: 'local', actor_name: 'Evan', content: 'Work started', ...extra });

test('persists every update type on supported workspace-scoped targets', async () => fixture(async ({ call }) => {
  const targets = [['project', 'project'], ['route', 'route'], ['request', 'request'], ['document', 'document'], ['milestone', 'milestone']];
  for (let index = 0; index < ACTIVITY_TYPES.length; index++) {
    const [targetType, targetId] = targets[index % targets.length];
    const created = await call('POST', '', entry(targetType, targetId, { update_type: ACTIVITY_TYPES[index], content: ACTIVITY_TYPES[index] }));
    assert.equal(created.status, 201); assert.equal(created.result.update_type, ACTIVITY_TYPES[index]);
  }
  const listed = await call('GET', '', {}, { workspace_id: 'ws', target_type: 'project', target_id: 'project' });
  assert.deepEqual(listed.result.map(item => item.update_type), ['progress', 'outcome']);
}));

test('threaded replies stay on the same target and preserve actor attribution', async () => fixture(async ({ call }) => {
  const parent = (await call('POST', '', entry())).result;
  const reply = (await call('POST', '', entry('project', 'project', { parent_id: parent.id, update_type: 'comment', actor_type: 'agent', actor_id: 'agent_1', actor_name: 'Codex', content: 'Review result' }))).result;
  assert.equal(reply.parent_id, parent.id); assert.equal(reply.actor_type, 'agent'); assert.equal(reply.actor_name, 'Codex');
  await assert.rejects(call('POST', '', entry('route', 'route', { parent_id: parent.id })), error => error.statusCode === 404);
}));

test('rejects cross-workspace, archived, and non-request targets', async () => fixture(async ({ db, call }) => {
  await assert.rejects(call('POST', '', entry('project', 'foreign-project')), /this workspace/);
  await assert.rejects(call('POST', '', { ...entry('project', 'project'), workspace_id: 'other' }), /this workspace/);
  db.prepare("UPDATE workspace_items SET kind='goal' WHERE id='request'").run();
  await assert.rejects(call('POST', '', entry('request', 'request')), /active target/);
  db.prepare("UPDATE projects SET archived_at='now' WHERE id='project'").run();
  await assert.rejects(call('POST', '', entry()), /active target/);
}));

test('edits use optimistic versions and DELETE archives rather than removing rows', async () => fixture(async ({ db, call }) => {
  const created = (await call('POST', '', entry())).result;
  const edited = (await call('PATCH', `/${created.id}`, { workspace_id: 'ws', version: 1, update_type: 'decision', content: 'Decision made' })).result;
  assert.equal(edited.version, 2); assert.equal(edited.update_type, 'decision');
  await assert.rejects(call('PATCH', `/${created.id}`, { workspace_id: 'ws', version: 1, content: 'stale' }), error => error.statusCode === 409);
  const archived = (await call('DELETE', `/${created.id}`, { workspace_id: 'ws', version: 2 })).result;
  assert.ok(archived.archived_at); assert.equal(db.prepare('SELECT COUNT(*) count FROM activity_entries WHERE id=?').get(created.id).count, 1);
  const listed = await call('GET', '', {}, { workspace_id: 'ws', target_type: 'project', target_id: 'project' });
  assert.equal(listed.result.length, 0);
  const restored = (await call('PATCH', `/${created.id}`, { workspace_id: 'ws', version: 3, archived_at: null })).result;
  assert.equal(restored.archived_at, null); assert.equal(restored.version, 4);
}));

test('entries cannot be moved, reparented, or reattributed', async () => fixture(async ({ call }) => {
  const created = (await call('POST', '', entry())).result;
  for (const patch of [{ target_id: 'other' }, { target_type: 'route' }, { actor_name: 'Someone else' }, { actor_id: 'other' }, { parent_id: 'other' }]) {
    await assert.rejects(call('PATCH', `/${created.id}`, { workspace_id: 'ws', version: 1, ...patch }), /cannot change/);
  }
}));

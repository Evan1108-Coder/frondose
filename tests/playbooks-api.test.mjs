import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';

test('Playbooks API serves catalog, CRUD, manual receipts and event dispatch on an isolated DB', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-playbook-api-'));
  const api = createLocalApi({ dataDir: directory, seedMode: 'demo' });
  const server = createServer((req, res) => api.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, payload: await response.json() };
  };
  try {
    const catalog = await call('/playbooks/catalog');
    assert.equal(catalog.status, 200);
    assert.deepEqual(catalog.payload.result.actions.map(action => action.id), ['route.create_draft', 'document.create_draft', 'project.create_draft', 'chat.create_draft']);
    const definition = { trigger: { type: 'manual' }, steps: [{ action_id: 'route.create_draft', config: { title: 'API smoke', description: 'Playbook test', project_id: 'proj_sourcelens' } }] };
    const created = await call('/playbooks', 'POST', { workspace_id: 'ws_personal', name: 'Smoke', definition });
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    const id = created.payload.result.id;
    assert.equal((await call('/playbooks?workspace_id=ws_personal')).payload.result.length, 1);
    assert.equal((await call(`/playbooks/${id}`)).payload.result.name, 'Smoke');
    const run = await call(`/playbooks/${id}/run`, 'POST', { idempotency_key: 'api_smoke_12345678' });
    assert.equal(run.status, 200, JSON.stringify(run.payload));
    assert.equal(run.payload.result.status, 'completed');
    assert.equal((await call(`/playbooks/${id}/run`, 'POST', { idempotency_key: 'api_smoke_12345678' })).payload.result.id, run.payload.result.id);
    assert.equal((await call(`/playbooks/${id}/runs`)).payload.result.length, 1);
    assert.equal((await call(`/playbooks/${id}`, 'PATCH', { version: 1, enabled: false })).payload.result.enabled, false);
    assert.equal((await call(`/playbooks/${id}/run`, 'POST', { idempotency_key: 'different_12345678' })).status, 409);
    const event = await call('/playbooks', 'POST', { workspace_id: 'ws_personal', name: 'Inbox opened', definition: { ...definition, trigger: { type: 'event', event: 'inbox.opened' } } });
    assert.equal(event.status, 201);
    const dispatched = await call('/playbooks/dispatch-event', 'POST', { workspace_id: 'ws_personal', event: 'inbox.opened', idempotency_key: 'open_inbox_12345678' });
    assert.equal(dispatched.status, 200, JSON.stringify(dispatched.payload));
    assert.equal(dispatched.payload.result.length, 1);
    assert.equal(dispatched.payload.result[0].status, 'completed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    api.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the server timer starts due schedules automatically without a page view or tick API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-playbook-clock-'));
  const api = createLocalApi({ dataDir: directory, seedMode: 'demo', playbookOptions: { now: () => new Date('2026-10-05T12:00:00.000Z'), scheduleIntervalMs: 20 } });
  const server = createServer((req, res) => api.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const response = await fetch(`${base}/playbooks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      workspace_id: 'ws_personal', name: 'At noon', definition: { trigger: { type: 'schedule', time: '12:00', timezone: 'Etc/UTC' }, steps: [{ action_id: 'route.create_draft', config: { title: 'Scheduled Route' } }] },
    }) });
    assert.equal(response.status, 201, await response.text());
    await new Promise(resolve => setTimeout(resolve, 100));
    const db = new DatabaseSync(api.dbPath);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE title='Scheduled Route'").get().n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM playbook_runs WHERE trigger_type='schedule' AND status='completed'").get().n, 1);
    } finally { db.close(); }
  } finally {
    await new Promise(resolve => server.close(resolve));
    api.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('restart marks an uncertain Playbook run interrupted without replaying its actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-playbook-restart-'));
  let api = createLocalApi({ dataDir: directory, seedMode: 'demo' });
  const path = api.dbPath;
  api.close();
  try {
    const db = new DatabaseSync(path);
    const definition = JSON.stringify({ trigger: { type: 'manual' }, steps: [{ action_id: 'route.create_draft', config: { title: 'Must not replay', description: '', project_id: '' } }] });
    db.prepare('INSERT INTO playbooks(id,workspace_id,name,definition_json,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('book', 'ws_personal', 'Old run', definition, 'local-owner', '2026-10-05T12:00:00.000Z', '2026-10-05T12:00:00.000Z');
    db.prepare('INSERT INTO playbook_runs(id,playbook_id,workspace_id,playbook_version,trigger_type,trigger_key,actor_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('pending', 'book', 'ws_personal', 1, 'manual', 'manual:restart_12345678', 'local-owner', 'running', '2026-10-05T12:00:00.000Z');
    db.close();
    api = createLocalApi({ dataDir: directory, seedMode: 'demo' });
    const after = new DatabaseSync(path);
    try {
      assert.equal(after.prepare("SELECT status FROM playbook_runs WHERE id='pending'").get().status, 'interrupted');
      assert.equal(after.prepare("SELECT COUNT(*) n FROM tasks WHERE title='Must not replay'").get().n, 0);
    } finally { after.close(); }
  } finally { api.close(); await rm(directory, { recursive: true, force: true }); }
});

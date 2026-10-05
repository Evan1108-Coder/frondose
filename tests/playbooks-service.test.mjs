import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createPlaybooksService } from '../server/playbooks-service.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  for (const table of ['workspaces', 'projects', 'tasks', 'chats']) db.exec(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
  db.exec('ALTER TABLE tasks ADD COLUMN team_id TEXT');
  db.exec(`INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES('ws','Lab','lab','now','now'),('other','Other','other','now','now');
    INSERT INTO projects(id,workspace_id,name,identifier,created_at,updated_at) VALUES('project','ws','Project','P','now','now'),('foreign','other','Other','O','now','now');`);
  let current = new Date('2026-10-05T12:00:00.000Z');
  const denied = new Set();
  const allowed = (ws, actor, permission, scope = {}) => ws === 'ws' && actor?.id === 'owner' && !denied.has(permission) && (!scope.scope_id || scope.scope_id === 'project');
  const service = createPlaybooksService({ db, allowed, now: () => current });
  const actor = { id: 'owner' };
  const base = (trigger = { type: 'manual' }) => ({ workspace_id: 'ws', name: 'Prepare work', definition: { trigger, steps: [{ action_id: 'route.create_draft', config: { title: 'Investigate', description: 'Find cause', project_id: 'project' } }, { action_id: 'document.create_draft', config: { title: 'Findings', content: 'Draft notes', project_id: 'project' } }] } });
  return { db, service, actor, base, denied, setTime(value) { current = new Date(value); }, close() { db.close(); } };
}

test('Playbook definitions are scoped, versioned and reject unsupported actions or stale edits', () => {
  const f = fixture(); try {
    const book = f.service.create(f.base(), f.actor);
    assert.equal(book.version, 1);
    assert.equal(f.service.list('ws', f.actor).length, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM playbook_versions').get().n, 1);
    assert.throws(() => f.service.list('other', f.actor), e => e.statusCode === 403);
    assert.throws(() => f.service.create({ ...f.base(), definition: { trigger: { type: 'manual' }, steps: [{ action_id: 'email.mark_all_read', config: {} }] } }, f.actor), /unavailable action/);
    assert.throws(() => f.service.update(book.id, { version: 3, name: 'Oops' }, f.actor), e => e.statusCode === 409);
    const edited = f.service.update(book.id, { version: 1, name: 'Updated' }, f.actor);
    assert.equal(edited.version, 2);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM playbook_versions').get().n, 2);
    assert.throws(() => f.service.create({ ...f.base(), enabled: 'yes' }, f.actor), /Enabled/);
  } finally { f.close(); }
});

test('manual runs perform only supported actions, pin versions and dedupe retries', () => {
  const f = fixture(); try {
    const book = f.service.create(f.base(), f.actor);
    const first = f.service.run(book.id, { idempotency_key: 'request_12345678' }, f.actor);
    assert.equal(first.status, 'completed', JSON.stringify(first));
    assert.equal(first.playbook_version, 1);
    assert.equal(first.receipts.length, 2);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM documents').get().n, 1);
    assert.equal(f.service.run(book.id, { idempotency_key: 'request_12345678' }, f.actor).id, first.id);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 1);
    assert.equal(f.db.prepare('SELECT status FROM tasks').get().status, 'backlog');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM runs').get().n, 0, 'no agent launched');
    assert.equal(f.service.runs(book.id, f.actor)[0].receipts[0].result.route_id, first.receipts[0].result.route_id);
  } finally { f.close(); }
});

test('permissions are rechecked at execution and failure is an auditable, non-retried receipt', () => {
  const f = fixture(); try {
    const book = f.service.create(f.base(), f.actor);
    f.denied.add('routes.write');
    const run = f.service.run(book.id, { idempotency_key: 'permission_12345678' }, f.actor);
    assert.equal(run.status, 'failed');
    assert.equal(run.receipts[0].status, 'failed');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 0);
    f.denied.clear();
    assert.equal(f.service.run(book.id, { idempotency_key: 'permission_12345678' }, f.actor).status, 'failed');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 0, 'uncertain write is never replayed');
  } finally { f.close(); }
});

test('scheduled Playbooks run at the configured IANA local minute and only once per minute', () => {
  const f = fixture(); try {
    // 12:00 UTC is 08:00 in New York during daylight saving time.
    const book = f.service.create(f.base({ type: 'schedule', time: '08:00', timezone: 'America/New_York', days_of_week: [1] }), f.actor);
    assert.equal(f.service.dispatchDue().length, 1);
    assert.equal(f.service.dispatchDue().length, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM playbook_runs').get().n, 1);
    f.setTime('2026-10-05T12:01:00.000Z');
    assert.equal(f.service.dispatchDue().length, 0);
    f.setTime('2026-10-06T12:00:00.000Z');
    assert.equal(f.service.dispatchDue().length, 0, 'Tuesday is not selected');
    assert.equal(f.service.run(book.id, { idempotency_key: 'manual_12345678' }, f.actor).status, 'completed', 'Run button works for scheduled Playbooks too');
  } finally { f.close(); }
});

test('Inbox-open event requires an explicit signal, workspace permission and a deduplication key', () => {
  const f = fixture(); try {
    f.service.create(f.base({ type: 'event', event: 'inbox.opened' }), f.actor);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM playbook_runs').get().n, 0, 'reading Inbox does not implicitly execute');
    const body = { workspace_id: 'ws', event: 'inbox.opened', idempotency_key: 'opening_12345678' };
    const first = f.service.dispatchEvent(body, f.actor);
    assert.equal(first.length, 1);
    assert.equal(f.service.dispatchEvent(body, f.actor)[0].id, first[0].id);
    assert.equal(f.service.dispatchEvent({ ...body, idempotency_key: 'rerender_12345678' }, f.actor)[0].id, first[0].id, 'near-simultaneous remount is debounced');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM playbook_runs').get().n, 1);
    f.denied.add('automations.manage');
    assert.deepEqual(f.service.dispatchEvent({ ...body, idempotency_key: 'unauthorized_12345678' }, f.actor), []);
    f.denied.delete('automations.manage');
    f.setTime('2026-10-05T12:00:03.000Z');
    assert.notEqual(f.service.dispatchEvent({ ...body, idempotency_key: 'later_open_12345678' }, f.actor)[0].id, first[0].id);
    assert.throws(() => f.service.dispatchEvent({ ...body, workspace_id: 'other' }, f.actor), e => e.statusCode === 403);
    assert.throws(() => f.service.dispatchEvent({ ...body, event: 'provider.connected' }, f.actor), /Unsupported/);
  } finally { f.close(); }
});

test('cross-workspace targets fail without a write and archiving disables future dispatch', () => {
  const f = fixture(); try {
    const body = f.base(); body.definition.steps[0].config.project_id = 'foreign';
    const book = f.service.create(body, f.actor);
    const run = f.service.run(book.id, { idempotency_key: 'foreign_12345678' }, f.actor);
    assert.equal(run.status, 'failed');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 0);
    const archived = f.service.archive(book.id, { version: 1 }, f.actor);
    assert.ok(archived.archived_at);
    assert.equal(f.service.list('ws', f.actor).length, 0);
    assert.throws(() => f.service.run(book.id, { idempotency_key: 'new_request_12345678' }, f.actor), e => e.statusCode === 404);
  } finally { f.close(); }
});

test('project and conversation actions create local drafts without a provider run', () => {
  const f = fixture(); try {
    const book = f.service.create({ workspace_id: 'ws', name: 'Organize', definition: { trigger: { type: 'manual' }, steps: [
      { action_id: 'project.create_draft', config: { name: 'Planned project', description: 'Future work', goal: 'Define scope' } },
      { action_id: 'chat.create_draft', config: { title: 'Planning room', project_id: 'project' } },
    ] } }, f.actor);
    const run = f.service.run(book.id, { idempotency_key: 'organize_12345678' }, f.actor);
    assert.equal(run.status, 'completed', JSON.stringify(run));
    assert.equal(f.db.prepare("SELECT status FROM projects WHERE name='Planned project'").get().status, 'planned');
    assert.equal(f.db.prepare("SELECT kind FROM chats WHERE title='Planning room'").get().kind, 'general');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM runs').get().n, 0);
  } finally { f.close(); }
});

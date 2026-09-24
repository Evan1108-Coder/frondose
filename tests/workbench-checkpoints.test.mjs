import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createWorkbenchService } from '../server/workbench-service.mjs';
import { createWorkbenchCheckpointService } from '../server/workbench-checkpoint-service.mjs';

async function fixture(t, { adapterPatch } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-checkpoints-'));
  const root = join(directory, 'project'), storage = join(directory, 'private');
  await mkdir(root); await mkdir(storage);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,local_path TEXT,archived_at TEXT);
    INSERT INTO workspaces VALUES('ws',NULL);
    INSERT INTO projects VALUES('project','ws','${root.replaceAll("'", "''")}',NULL);`);
  const workbench = createWorkbenchService({ db, dataDir: storage, ptyFactory: { spawn() { throw new Error('PTY forbidden in checkpoint tests'); } } });
  if (adapterPatch) workbench.checkpointAdapter = adapterPatch(workbench.checkpointAdapter);
  const permissions = { denied: new Set() }, active = [];
  const allowed = (_workspaceId, actor, permission, scope) => actor?.id === 'human' && scope?.scope_type === 'project' && scope.scope_id === 'project' && !permissions.denied.has(permission);
  const checkpoints = createWorkbenchCheckpointService({ db, workbench, allowed, activeSessionsFor: () => active });
  const actor = { id: 'human', mode: 'account', name: 'Human reviewer' };
  t.after(async () => { workbench.close(); db.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, root, storage, db, workbench, checkpoints, permissions, active, actor };
}

function pins(preview) {
  return preview.files.map(file => ({ path: file.path, expected_current_state: file.current.state, expected_current_sha256: file.current.sha256, expected_current_mode: file.current.mode }));
}
async function restore(checkpoints, actor, checkpoint, preview, requestId = 'restore-request-0001') {
  return checkpoints.restore({ checkpointId: checkpoint.id, actor, paths: pins(preview), previewFingerprint: preview.preview_fingerprint,
    checkpointVersion: checkpoint.version, confirmed: true, requestId });
}

test('manual checkpoints restore exact selected text states, preserve the Git index, and create a durable recovery checkpoint', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'tracked.txt'), 'BEFORE\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: f.root });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'], { cwd: f.root });
  const checkpoint = await f.checkpoints.capture({ workspaceId: 'ws', projectId: 'project', actor: f.actor, kind: 'manual' });
  assert.equal(checkpoint.complete, true); assert.equal(checkpoint.files[0].sha256.length, 64);

  await writeFile(join(f.root, 'tracked.txt'), 'AFTER\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: f.root });
  const preview = await f.checkpoints.preview({ checkpointId: checkpoint.id, actor: f.actor, paths: ['tracked.txt'] });
  assert.equal(preview.files[0].operation, 'restore');
  assert.match(preview.files[0].patch, /-AFTER/); assert.match(preview.files[0].patch, /\+BEFORE/);
  const result = await restore(f.checkpoints, f.actor, checkpoint, preview);
  assert.equal(result.status, 'completed'); assert.equal(await readFile(join(f.root, 'tracked.txt'), 'utf8'), 'BEFORE\n');
  assert.match(execFileSync('git', ['diff', '--cached'], { cwd: f.root, encoding: 'utf8' }), /\+AFTER/, 'restore must not alter the Git index');

  const recovery = await f.checkpoints.get({ checkpointId: result.pre_restore_checkpoint_id, actor: f.actor });
  assert.equal(recovery.kind, 'pre_restore'); assert.equal(recovery.parent_checkpoint_id, checkpoint.id);
  const recoveryPreview = await f.checkpoints.preview({ checkpointId: recovery.id, actor: f.actor, paths: ['tracked.txt'] });
  await restore(f.checkpoints, f.actor, recovery, recoveryPreview, 'restore-recovery-0001');
  assert.equal(await readFile(join(f.root, 'tracked.txt'), 'utf8'), 'AFTER\n');

  const replay = await restore(f.checkpoints, f.actor, checkpoint, preview);
  assert.equal(replay.id, result.id); assert.equal(replay.replayed, true);
  const recreated = createWorkbenchCheckpointService({ db: f.db, workbench: f.workbench, allowed: () => true, activeSessionsFor: () => [] });
  assert.equal((await recreated.get({ checkpointId: checkpoint.id, actor: f.actor })).id, checkpoint.id, 'checkpoint survives service recreation');
  f.db.prepare('DELETE FROM projects WHERE id=?').run('project');
  assert.equal(f.db.prepare('SELECT COUNT(*) count FROM workbench_checkpoints').get().count, 0, 'project deletion removes private local checkpoints without FK blocking');
});

test('absent states delete only explicitly captured paths and stale previews perform zero file writes', async t => {
  const f = await fixture(t);
  const absent = await f.checkpoints.capture({ workspaceId: 'ws', projectId: 'project', actor: f.actor, kind: 'manual', paths: ['later.txt'] });
  assert.equal(absent.files[0].state, 'absent');
  await writeFile(join(f.root, 'later.txt'), 'FIRST CURRENT\n');
  const stalePreview = await f.checkpoints.preview({ checkpointId: absent.id, actor: f.actor, paths: ['later.txt'] });
  await writeFile(join(f.root, 'later.txt'), 'CHANGED AFTER PREVIEW\n');
  await assert.rejects(restore(f.checkpoints, f.actor, absent, stalePreview), error => error.code === 'stale_worktree' && error.statusCode === 409);
  assert.equal(await readFile(join(f.root, 'later.txt'), 'utf8'), 'CHANGED AFTER PREVIEW\n');
  assert.equal(f.db.prepare('SELECT COUNT(*) count FROM workbench_checkpoint_restores').get().count, 0);

  const fresh = await f.checkpoints.preview({ checkpointId: absent.id, actor: f.actor, paths: ['later.txt'] });
  const removed = await restore(f.checkpoints, f.actor, absent, fresh, 'restore-delete-0002');
  assert.equal(removed.status, 'completed');
  await assert.rejects(readFile(join(f.root, 'later.txt')), error => error.code === 'ENOENT');
  assert.equal((await f.checkpoints.get({ checkpointId: removed.pre_restore_checkpoint_id, actor: f.actor })).files[0].state, 'present');
});

test('checkpoint and restore fail closed for private paths, traversal, symlinks, active sessions, changed roots, agents, and revoked replay access', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'safe.txt'), 'SAFE\n');
  await writeFile(join(f.root, '.env'), 'TOKEN=secret\n');
  await writeFile(join(f.directory, 'outside.txt'), 'OUTSIDE\n');
  await symlink(join(f.directory, 'outside.txt'), join(f.root, 'outside-link'));
  await symlink(f.directory, join(f.root, 'outside-directory'));
  for (const path of ['../outside.txt', '/etc/passwd', '.env', 'outside-link', 'outside-directory/outside.txt']) {
    await assert.rejects(f.checkpoints.capture({ workspaceId: 'ws', projectId: 'project', actor: f.actor, paths: [path] }), /outside|private|regular/i);
  }
  await assert.rejects(f.checkpoints.capture({ workspaceId: 'ws', projectId: 'project', actor: { id: 'agent', mode: 'agent' }, paths: ['safe.txt'] }), error => error.code === 'access_denied');

  execFileSync('git', ['add', 'safe.txt'], { cwd: f.root });
  const checkpoint = await f.checkpoints.capture({ workspaceId: 'ws', projectId: 'project', actor: f.actor });
  await writeFile(join(f.root, 'safe.txt'), 'CHANGED\n');
  const preview = await f.checkpoints.preview({ checkpointId: checkpoint.id, actor: f.actor, paths: ['safe.txt'] });
  f.active.push({ id: 'run' });
  await assert.rejects(restore(f.checkpoints, f.actor, checkpoint, preview), error => error.code === 'active_sessions');
  f.active.length = 0;
  const restored = await restore(f.checkpoints, f.actor, checkpoint, preview);
  f.permissions.denied.add('workbench.write');
  await assert.rejects(restore(f.checkpoints, f.actor, checkpoint, preview), error => error.code === 'access_denied', 'idempotent replay rechecks current write permission');
  f.permissions.denied.clear();

  const replacement = join(f.directory, 'replacement'); await mkdir(replacement);
  execFileSync('git', ['init', '-b', 'main'], { cwd: replacement });
  f.db.prepare('UPDATE projects SET local_path=? WHERE id=?').run(replacement, 'project');
  await assert.rejects(f.checkpoints.get({ checkpointId: checkpoint.id, actor: f.actor }), error => error.code === 'root_changed');
  assert.ok(restored.pre_restore_checkpoint_id);
});

test('multi-file apply failures report partial state and retain an exact explicit recovery checkpoint', async t => {
  let applications = 0;
  const f = await fixture(t, { adapterPatch: adapter => ({ ...adapter, async applyCheckpointState(root, staged) {
    applications += 1;
    if (applications === 2) throw new Error('Injected second-file failure');
    return adapter.applyCheckpointState(root, staged);
  } }) });
  for (const [path, content] of [['a.txt', 'A BEFORE\n'], ['b.txt', 'B BEFORE\n']]) await writeFile(join(f.root, path), content);
  execFileSync('git', ['add', 'a.txt', 'b.txt'], { cwd: f.root });
  const checkpoint = await f.checkpoints.capture({ workspaceId: 'ws', projectId: 'project', actor: f.actor });
  await writeFile(join(f.root, 'a.txt'), 'A CURRENT\n'); await writeFile(join(f.root, 'b.txt'), 'B CURRENT\n');
  const preview = await f.checkpoints.preview({ checkpointId: checkpoint.id, actor: f.actor, paths: ['a.txt', 'b.txt'] });
  const result = await restore(f.checkpoints, f.actor, checkpoint, preview);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.outcomes.map(item => item.status), ['applied', 'failed']);
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'A BEFORE\n');
  assert.equal(await readFile(join(f.root, 'b.txt'), 'utf8'), 'B CURRENT\n');
  const recovery = await f.checkpoints.get({ checkpointId: result.pre_restore_checkpoint_id, actor: f.actor });
  assert.deepEqual(recovery.files.map(file => file.path), ['a.txt', 'b.txt']);
  const recoveryPreview = await f.checkpoints.preview({ checkpointId: recovery.id, actor: f.actor, paths: ['a.txt', 'b.txt'] });
  const recovered = await restore(f.checkpoints, f.actor, recovery, recoveryPreview, 'restore-partial-recovery');
  assert.equal(recovered.status, 'completed');
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'A CURRENT\n');
  assert.equal(await readFile(join(f.root, 'b.txt'), 'utf8'), 'B CURRENT\n');
});

test('automatic enumeration is bounded and never infers absent state from an incomplete checkpoint', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 201; index++) await writeFile(join(f.root, `file-${String(index).padStart(3, '0')}.txt`), `${index}\n`);
  execFileSync('git', ['add', '.'], { cwd: f.root });
  const checkpoint = await f.checkpoints.capture({ workspaceId: 'ws', projectId: 'project', actor: f.actor });
  assert.equal(checkpoint.file_count, 200); assert.equal(checkpoint.complete, false); assert.equal(checkpoint.limited, true);
  const omitted = Array.from({ length: 201 }, (_, index) => `file-${String(index).padStart(3, '0')}.txt`).find(path => !checkpoint.files.some(file => file.path === path));
  assert.ok(omitted);
  await unlink(join(f.root, omitted));
  await assert.rejects(f.checkpoints.preview({ checkpointId: checkpoint.id, actor: f.actor, paths: [omitted] }), error => error.code === 'unsupported_file');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, chmod, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createWorkbenchService } from '../server/workbench-service.mjs';
import { createWorkbenchCheckpointService } from '../server/workbench-checkpoint-service.mjs';

async function fixture(t, patch = adapter => adapter) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-checkpoint-security-'));
  const root = join(directory, 'project'), storage = join(directory, 'storage');
  await mkdir(root); await mkdir(storage); execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE workspaces(id TEXT PRIMARY KEY, archived_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,local_path TEXT,archived_at TEXT,team_id TEXT);
    INSERT INTO workspaces VALUES('ws',NULL),('foreign',NULL);`);
  db.prepare('INSERT INTO projects VALUES(?,?,?,NULL,NULL)').run('project', 'ws', root);
  const workbench = createWorkbenchService({ db, dataDir: storage, ptyFactory: { spawn() { throw new Error('No PTYs in security fixtures'); } } });
  const state = { denied: new Set(), deniedScopes: new Set(), active: [] }, actor = { id: 'human', mode: 'account' };
  const context = { directory, root, storage, db, workbench, state, actor };
  workbench.checkpointAdapter = patch(workbench.checkpointAdapter, context);
  const allowed = (ws, who, permission, scope) => ws === 'ws' && who.id === actor.id && ['project', 'area-old', 'area-new'].includes(scope?.scope_id) && !state.denied.has(permission) && !state.deniedScopes.has(scope?.scope_id);
  const checkpoints = createWorkbenchCheckpointService({ db, workbench, allowed, activeSessionsFor: () => state.active });
  t.after(async () => { workbench.close(); db.close(); await rm(directory, { recursive: true, force: true }); });
  const setup = async (paths = ['a.txt']) => {
    for (const path of paths) await writeFile(join(root, path), `SAVED ${path}\n`);
    const checkpoint = await checkpoints.capture({ workspaceId: 'ws', projectId: 'project', actor, paths });
    for (const path of paths) await writeFile(join(root, path), `CURRENT ${path}\n`);
    const preview = await checkpoints.preview({ checkpointId: checkpoint.id, actor, paths });
    const input = { checkpointId: checkpoint.id, actor, confirmed: true, requestId: 'security-restore-request', checkpointVersion: checkpoint.version, previewFingerprint: preview.preview_fingerprint, paths: preview.files.map(file => ({ path: file.path, expected_current_state: file.current.state, expected_current_sha256: file.current.sha256, expected_current_mode: file.current.mode })) };
    return { checkpoint, preview, input };
  };
  return { ...context, checkpoints, setup, allowed };
}

test('checkpoint security: permission revoked during asynchronous staging prevents working-tree writes', async t => {
  const f = await fixture(t, (adapter, context) => ({ ...adapter, async stageCheckpointState(...args) {
    const result = await adapter.stageCheckpointState(...args); context.state.denied.add('workbench.write'); return result;
  } }));
  const { input } = await f.setup();
  const result = await Promise.allSettled([f.checkpoints.restore(input)]);
  assert(result[0].status === 'rejected' || result[0].value.status === 'failed');
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'CURRENT a.txt\n');
});

test('checkpoint security: newly active sessions during staging prevent working-tree writes', async t => {
  const f = await fixture(t, (adapter, context) => ({ ...adapter, async stageCheckpointState(...args) {
    const result = await adapter.stageCheckpointState(...args); context.state.active.push({ id: 'new-run' }); return result;
  } }));
  const { input } = await f.setup();
  const result = await Promise.allSettled([f.checkpoints.restore(input)]);
  assert(result[0].status === 'rejected' || result[0].value.status === 'failed');
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'CURRENT a.txt\n');
});

test('checkpoint security: later file edits during an earlier application are not silently overwritten', async t => {
  let applications = 0;
  const f = await fixture(t, (adapter, context) => ({ ...adapter, async applyCheckpointState(...args) {
    const result = await adapter.applyCheckpointState(...args);
    if (++applications === 1) await writeFile(join(context.root, 'b.txt'), 'CONCURRENT HUMAN EDIT\n');
    return result;
  } }));
  const { input } = await f.setup(['a.txt', 'b.txt']);
  const result = await f.checkpoints.restore(input);
  assert.equal(await readFile(join(f.root, 'b.txt'), 'utf8'), 'CONCURRENT HUMAN EDIT\n');
  assert.notEqual(result.status, 'completed');
  assert(result.outcomes.some(row => row.path === 'b.txt' && row.status === 'failed'));
  assert.ok(result.pre_restore_checkpoint_id);
});

test('checkpoint security: concurrent same-key restore requests apply once and replay without post-write SQL failure', async t => {
  let release, staged = 0, applications = 0;
  const hold = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, adapter => ({ ...adapter,
    async stageCheckpointState(...args) { const result = await adapter.stageCheckpointState(...args); if (++staged === 1) { setImmediate(release); await hold; } return result; },
    async applyCheckpointState(...args) { applications++; return adapter.applyCheckpointState(...args); },
  }));
  const { input } = await f.setup();
  const results = await Promise.allSettled([f.checkpoints.restore(input), f.checkpoints.restore(input)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 2, JSON.stringify(results.map(row => row.reason?.message || row.value?.status)));
  assert.equal(applications, 1);
  assert.equal(new Set(results.map(row => row.value.id)).size, 1);
  assert.equal(results.filter(row => row.value.replayed).length, 1);
});

test('checkpoint security: permission revoked between selected files stops later applications', async t => {
  let applications = 0;
  const f = await fixture(t, (adapter, context) => ({ ...adapter, async applyCheckpointState(...args) {
    const result = await adapter.applyCheckpointState(...args);
    if (++applications === 1) context.state.denied.add('workbench.write');
    return result;
  } }));
  const { input } = await f.setup(['a.txt', 'b.txt']);
  const result = await f.checkpoints.restore(input);
  assert.equal(result.status, 'partial');
  assert.equal(applications, 1);
  assert.equal(await readFile(join(f.root, 'b.txt'), 'utf8'), 'CURRENT b.txt\n');
  assert.ok(result.pre_restore_checkpoint_id);
});

test('checkpoint security: replacing the linked root during staging cannot restore into a different inode', async t => {
  let replaced = false;
  const f = await fixture(t, (adapter, context) => ({ ...adapter, async stageCheckpointState(...args) {
    if (!replaced) {
      replaced = true; await rename(context.root, join(context.directory, 'original-project'));
      await mkdir(context.root); execFileSync('git', ['init', '-b', 'main'], { cwd: context.root });
      await writeFile(join(context.root, 'a.txt'), 'CURRENT a.txt\n');
    }
    return adapter.stageCheckpointState(...args);
  } }));
  const { input } = await f.setup();
  const result = await Promise.allSettled([f.checkpoints.restore(input)]);
  assert(result[0].status === 'rejected' || result[0].value.status === 'failed');
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'CURRENT a.txt\n');
});

test('checkpoint security: changing current file mode after preview invalidates restore rather than silently losing permissions', async t => {
  const f = await fixture(t), { input } = await f.setup();
  await chmod(join(f.root, 'a.txt'), 0o700);
  await assert.rejects(f.checkpoints.restore(input), error => ['stale_worktree', 'stale_checkpoint'].includes(error.code));
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'CURRENT a.txt\n');
  assert.equal((await stat(join(f.root, 'a.txt'))).mode & 0o777, 0o700);
});

test('checkpoint security: malformed UTF-8, symlink destinations and cross-workspace targets fail closed', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'invalid.txt'), Buffer.from([0xc0, 0xaf]));
  await assert.rejects(f.checkpoints.capture({ workspaceId: 'ws', projectId: 'project', actor: f.actor, paths: ['invalid.txt'] }), /UTF-8/);
  const { input } = await f.setup();
  await rename(join(f.root, 'a.txt'), join(f.directory, 'outside.txt'));
  await symlink(join(f.directory, 'outside.txt'), join(f.root, 'a.txt'));
  await assert.rejects(f.checkpoints.restore(input));
  assert.equal(await readFile(join(f.directory, 'outside.txt'), 'utf8'), 'CURRENT a.txt\n');
  await assert.rejects(f.checkpoints.capture({ workspaceId: 'foreign', projectId: 'project', actor: f.actor, paths: ['a.txt'] }));
});

test('checkpoint security: capture rechecks permission after reading asynchronous file content', async t => {
  const f = await fixture(t, (adapter, context) => ({ ...adapter, async checkpointState(...args) {
    const result = await adapter.checkpointState(...args); context.state.denied.add('workbench.write'); return result;
  } }));
  await writeFile(join(f.root, 'a.txt'), 'PRIVATE CONTENT\n');
  await assert.rejects(f.checkpoints.capture({ workspaceId: 'ws', projectId: 'project', actor: f.actor, paths: ['a.txt'] }), error => error.statusCode === 403);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM workbench_checkpoints').get().n, 0);
});

test('checkpoint security: moving projects does not bypass historical Area access', async t => {
  const f = await fixture(t);
  f.db.prepare("UPDATE projects SET team_id='area-old' WHERE id='project'").run();
  const { checkpoint, input } = await f.setup();
  f.db.prepare("UPDATE projects SET team_id='area-new' WHERE id='project'").run();
  f.state.deniedScopes.add('area-old');
  assert.deepEqual(await f.checkpoints.list({ workspaceId: 'ws', projectId: 'project', actor: f.actor }), []);
  await assert.rejects(f.checkpoints.get({ checkpointId: checkpoint.id, actor: f.actor }), error => error.statusCode === 403);
  await assert.rejects(f.checkpoints.preview({ checkpointId: checkpoint.id, actor: f.actor, paths: ['a.txt'] }), error => error.statusCode === 403);
  await assert.rejects(f.checkpoints.restore(input), error => error.statusCode === 403);
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'CURRENT a.txt\n');
});

test('checkpoint security: durable intent precedes writes and interrupted same-key replay never reapplies', async t => {
  let applications = 0;
  const f = await fixture(t, (adapter, context) => ({ ...adapter, async applyCheckpointState(...args) {
    applications++;
    const intent = context.db.prepare('SELECT r.*,q.request_key FROM workbench_checkpoint_restores r JOIN workbench_checkpoint_requests q ON q.restore_id=r.id').get();
    assert.ok(intent, 'Persist a restore and request receipt before the first working-tree mutation');
    assert.equal(intent.status, 'in_progress');
    const recovery = context.db.prepare('SELECT content FROM workbench_checkpoint_files WHERE checkpoint_id=? AND path=?').get(intent.pre_restore_checkpoint_id, 'a.txt');
    assert.equal(Buffer.from(recovery.content).toString('utf8'), 'CURRENT a.txt\n');
    return adapter.applyCheckpointState(...args);
  } }));
  const { input } = await f.setup();
  const completed = await f.checkpoints.restore(input);
  assert.equal(completed.status, 'completed');
  // Simulate restart with a durable intent whose final outcome was not committed.
  f.db.prepare("UPDATE workbench_checkpoint_restores SET status='in_progress' WHERE id=?").run(completed.id);
  const reopened = createWorkbenchCheckpointService({ db: f.db, workbench: f.workbench, allowed: f.allowed });
  const replay = await reopened.restore(input);
  assert.equal(replay.status, 'interrupted');
  assert.equal(replay.replayed, true);
  assert.equal(replay.pre_restore_checkpoint_id, completed.pre_restore_checkpoint_id);
  assert.equal(applications, 1);
});

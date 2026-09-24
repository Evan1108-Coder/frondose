import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-checkpoint-api-'));
  const projectRoot = join(directory, 'project'), dataDir = join(directory, 'private');
  await mkdir(projectRoot); await mkdir(dataDir);
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot });
  await writeFile(join(projectRoot, 'note.txt'), 'ORIGINAL\n');
  execFileSync('git', ['add', 'note.txt'], { cwd: projectRoot });
  const api = createLocalApi({ dataDir, seedMode: 'clean', integrationOptions: {
    env: {}, fetchImpl: () => { throw new Error('Network forbidden in checkpoint API tests.'); },
    execute: async () => ({ stdout: '[]', stderr: '', code: 0 }),
    spawnProcess: () => { throw new Error('Provider execution forbidden in checkpoint API tests.'); },
  } });
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (method, path, body) => {
    const response = await fetch(origin + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const call = async (method, path, body, expected = method === 'POST' ? 201 : 200) => {
    const response = await request(method, path, body); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(response.body)}`); return response.body;
  };
  const workspace = (await call('POST', '/workspaces', { name: 'Checkpoint API fixture' })).workspace;
  const project = (await call('POST', '/projects', { workspace_id: workspace.id, name: 'Local project', local_path: projectRoot })).project;
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { api, request, call, workspace, project, projectRoot };
}

const restorePaths = preview => preview.files.map(file => ({ path: file.path, expected_current_state: file.current.state, expected_current_sha256: file.current.sha256, expected_current_mode: file.current.mode }));

test('checkpoint HTTP contract captures, lists, previews, restores, replays, and exposes explicit recovery', async t => {
  const f = await fixture(t);
  const created = (await f.call('POST', '/workbench/checkpoints', { workspace_id: f.workspace.id, project_id: f.project.id })).result;
  assert.equal(created.kind, 'manual'); assert.equal(created.file_count, 1);
  const listed = (await f.call('GET', `/workbench/checkpoints?workspace_id=${f.workspace.id}&project_id=${f.project.id}`)).result;
  assert.ok(Array.isArray(listed)); assert.equal(listed[0].id, created.id);
  const detail = (await f.call('GET', `/workbench/checkpoints/${created.id}`)).result;
  assert.deepEqual(detail.files.map(file => file.path), ['note.txt']);

  await writeFile(join(f.projectRoot, 'note.txt'), 'CHANGED\n');
  const preview = (await f.call('POST', `/workbench/checkpoints/${created.id}/preview`, { paths: ['note.txt'] }, 200)).result;
  assert.equal(preview.files[0].operation, 'restore'); assert.match(preview.files[0].patch, /-CHANGED/);
  const restoreBody = { paths: restorePaths(preview), preview_fingerprint: preview.preview_fingerprint, checkpoint_version: created.version, confirmed: true, request_id: 'checkpoint-api-restore-0001' };

  const db = new DatabaseSync(f.api.dbPath);
  const stamp = new Date().toISOString();
  try {
    db.prepare('INSERT INTO runs (id,workspace_id,project_id,provider,agent_name,status,title,prompt,mode,started_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('active-checkpoint-run', f.workspace.id, f.project.id, 'codex', 'Fixture', 'running', 'Active fixture', '', 'mock', stamp, stamp, stamp);
    let blocked = await f.request('POST', `/workbench/checkpoints/${created.id}/restore`, restoreBody);
    assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'active_sessions');
    db.prepare("UPDATE runs SET status='completed',finished_at=?,updated_at=? WHERE id=?").run(stamp, stamp, 'active-checkpoint-run');
    db.prepare('INSERT INTO workbench_terminals (id,workspace_id,project_id,name,cwd,status,created_at) VALUES (?,?,?,?,?,?,?)')
      .run('active-terminal', f.workspace.id, f.project.id, 'Fixture', f.projectRoot, 'running', stamp);
    blocked = await f.request('POST', `/workbench/checkpoints/${created.id}/restore`, restoreBody);
    assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'active_sessions');
    db.prepare("UPDATE workbench_terminals SET status='stopped',ended_at=? WHERE id=?").run(stamp, 'active-terminal');
  } finally { db.close(); }

  const restored = (await f.call('POST', `/workbench/checkpoints/${created.id}/restore`, restoreBody, 200)).result;
  assert.equal(restored.status, 'completed'); assert.equal(await readFile(join(f.projectRoot, 'note.txt'), 'utf8'), 'ORIGINAL\n');
  const replay = (await f.call('POST', `/workbench/checkpoints/${created.id}/restore`, restoreBody, 200)).result;
  assert.equal(replay.id, restored.id); assert.equal(replay.replayed, true);

  const recovery = (await f.call('GET', `/workbench/checkpoints/${restored.pre_restore_checkpoint_id}`)).result;
  assert.equal(recovery.kind, 'pre_restore');
  const recoveryPreview = (await f.call('POST', `/workbench/checkpoints/${recovery.id}/preview`, { paths: ['note.txt'] }, 200)).result;
  const recovered = (await f.call('POST', `/workbench/checkpoints/${recovery.id}/restore`, { paths: restorePaths(recoveryPreview), preview_fingerprint: recoveryPreview.preview_fingerprint, checkpoint_version: recovery.version, confirmed: true, request_id: 'checkpoint-api-recovery-0001' }, 200)).result;
  assert.equal(recovered.status, 'completed'); assert.equal(await readFile(join(f.projectRoot, 'note.txt'), 'utf8'), 'CHANGED\n');
});

test('checkpoint HTTP routes reject stale state, scope spoofing, unsupported fields, and generic mutation methods', async t => {
  const f = await fixture(t);
  for (const body of [
    { workspace_id: f.workspace.id, project_id: f.project.id, kind: 'before_run' },
    { workspace_id: f.workspace.id, project_id: f.project.id, run_id: 'invented' },
  ]) assert.equal((await f.request('POST', '/workbench/checkpoints', body)).status, 400);
  const checkpoint = (await f.call('POST', '/workbench/checkpoints', { workspace_id: f.workspace.id, project_id: f.project.id, paths: ['note.txt'] })).result;
  assert.equal((await f.request('PATCH', `/workbench/checkpoints/${checkpoint.id}`, {})).status, 405);
  assert.equal((await f.request('POST', `/workbench/checkpoints/${checkpoint.id}/preview`, { paths: ['note.txt'], project_id: f.project.id })).status, 400);
  assert.equal((await f.request('GET', `/workbench/checkpoints/${checkpoint.id}?workspace_id=${f.workspace.id}`)).status, 400);

  await writeFile(join(f.projectRoot, 'note.txt'), 'FIRST\n');
  const preview = (await f.call('POST', `/workbench/checkpoints/${checkpoint.id}/preview`, { paths: ['note.txt'] }, 200)).result;
  await writeFile(join(f.projectRoot, 'note.txt'), 'SECOND\n');
  const response = await f.request('POST', `/workbench/checkpoints/${checkpoint.id}/restore`, { paths: restorePaths(preview), preview_fingerprint: preview.preview_fingerprint, checkpoint_version: checkpoint.version, confirmed: true, request_id: 'checkpoint-api-stale-0001' });
  assert.equal(response.status, 409); assert.equal(response.body.error.code, 'stale_worktree');
  assert.equal(await readFile(join(f.projectRoot, 'note.txt'), 'utf8'), 'SECOND\n');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createFrondoseServer } from '../server/start.mjs';

async function fixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-comments-http-'));
  const client = join(directory, 'client'), root = join(directory, 'project'), otherRoot = join(directory, 'other-project'), storage = join(directory, 'private');
  await Promise.all([mkdir(client), mkdir(root), mkdir(otherRoot)]);
  await writeFile(join(client, 'index.html'), '<!doctype html><title>Isolated Frondose comments fixture</title>');
  await writeFile(join(root, 'notes.md'), '# Fixture\nChosen saved selection\nOther text.');
  await writeFile(join(otherRoot, 'notes.md'), '# Other workspace');
  const forbidden = () => { throw Error('This test must not execute providers or access external services.'); };
  const { server } = createFrondoseServer({ env: { HOME: directory, PATH: '' }, clientDirectory: client, apiOptions: { dataDir: storage, integrationOptions: { autoDetect: false, probeIntervalMs: 0, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, method = body ? 'POST' : 'GET', requestOrigin = origin) => {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { origin: requestOrigin, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  try { await callback({ call, root, otherRoot }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

test('production HTTP comments flow saves a selection, replies, reacts and serves fresh scoped no-store context', async () => fixture(async ({ call, root }) => {
  const workspace = (await call('/workspaces', { name: 'Comments fixture' })).body.workspace;
  const project = (await call('/projects', { workspace_id: workspace.id, name: 'Project' })).body.project;
  const linked = await call('/directory-workspace', { workspace_id: workspace.id, project_id: project.id, path: root, confirmed: true }, 'PUT');
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  const binding = linked.body.result.binding.version, q = `?workspace_id=${workspace.id}&expected_binding_version=${binding}`;
  const file = await call(`/directory-workspace/file${q}&path=notes.md`); assert.equal(file.status, 200);
  const input = { expected_binding_version: binding, path: 'notes.md', expected_file_version: file.body.result.version, start: 10, end: 32, quote: 'Chosen saved selection', body: 'Please review @Codex as inert discussion text.', request_id: randomUUID(), confirmed: true };
  const created = await call(`/file-comments/threads${q}`, input);
  assert.equal(created.status, 200, JSON.stringify(created.body)); assert.equal(created.headers.get('cache-control'), 'no-store');
  let thread = created.body.result; assert.equal(thread.anchor.status, 'current'); assert.equal(thread.start_line, 2); assert.equal(thread.entries.length, 1);
  const reply = { expected_binding_version: binding, expected_version: thread.version, body: 'A saved reply; no message was sent to an AI.', request_id: randomUUID(), confirmed: true };
  const replied = await call(`/file-comments/threads/${thread.id}/replies${q}`, reply);
  assert.equal(replied.status, 200, JSON.stringify(replied.body)); thread = replied.body.result;
  const replayed = await call(`/file-comments/threads/${thread.id}/replies${q}`, reply);
  assert.equal(replayed.status, 200); assert.equal(replayed.body.result.entries.length, 2); assert.equal(replayed.body.result.version, 2);
  const reacted = await call(`/file-comments/threads/${thread.id}/reaction${q}`, { expected_binding_version: binding, expected_version: thread.version, entry_id: thread.entries[1].id, reaction: 'like', enabled: true, request_id: randomUUID(), confirmed: true });
  assert.equal(reacted.status, 200, JSON.stringify(reacted.body)); assert.equal(reacted.body.result.entries[1].reactions[0].reaction, 'like');
  const context = await call(`/file-comments/context${q}&thread_id=${thread.id}`);
  assert.equal(context.status, 200); assert.equal(context.headers.get('cache-control'), 'no-store');
  assert.match(context.body.result.text, /untrusted reference data/); assert.match(context.body.result.text, /Chosen saved selection/); assert.match(context.body.result.text, /A saved reply/); assert.match(context.body.result.text, /File: notes\.md/); assert(!context.body.result.text.includes(root));
  const list = await call(`/file-comments${q}`); assert.equal(list.status, 200); assert.equal(list.headers.get('cache-control'), 'no-store'); assert.equal(list.body.result.threads[0].entry_count, 2);
  const detail = await call(`/file-comments/threads/${thread.id}${q}`); assert.equal(detail.status, 200); assert.equal(detail.headers.get('cache-control'), 'no-store'); assert.equal(detail.body.result.version, 3);
}));

test('HTTP comments deny cross-workspace threads, stale roots, cross-origin reads and writes without changing discussion data', async () => fixture(async ({ call, root, otherRoot }) => {
  const makeWorkspace = async (name, path) => {
    const workspace = (await call('/workspaces', { name })).body.workspace;
    const project = (await call('/projects', { workspace_id: workspace.id, name: 'Project' })).body.project;
    const response = await call('/directory-workspace', { workspace_id: workspace.id, project_id: project.id, path, confirmed: true }, 'PUT');
    assert.equal(response.status, 200); return { workspace, binding: response.body.result.binding.version };
  };
  const first = await makeWorkspace('First workspace', root), second = await makeWorkspace('Second workspace', otherRoot);
  const query = value => `?workspace_id=${value.workspace.id}&expected_binding_version=${value.binding}`;
  const q = query(first), foreignQ = query(second), file = (await call(`/directory-workspace/file${q}&path=notes.md`)).body.result;
  const created = await call(`/file-comments/threads${q}`, { expected_binding_version: first.binding, path: 'notes.md', expected_file_version: file.version, start: 10, end: 32, quote: 'Chosen saved selection', body: 'Scoped secret fixture discussion.', request_id: randomUUID(), confirmed: true });
  assert.equal(created.status, 200, JSON.stringify(created.body)); const thread = created.body.result;
  for (const path of [`/file-comments/threads/${thread.id}${foreignQ}`, `/file-comments/context${foreignQ}&thread_id=${thread.id}`]) {
    const denied = await call(path); assert.equal(denied.status, 404); assert(!JSON.stringify(denied.body).includes('Scoped secret fixture'));
  }
  const crossWrite = await call(`/file-comments/threads/${thread.id}/replies${foreignQ}`, { expected_binding_version: second.binding, expected_version: 1, body: 'Must not append', request_id: randomUUID(), confirmed: true }); assert.equal(crossWrite.status, 404);
  const stale = await call(`/file-comments/threads/${thread.id}?workspace_id=${first.workspace.id}&expected_binding_version=stale`); assert.equal(stale.status, 409);
  assert.equal((await call(`/file-comments/context${q}`, undefined, 'GET', 'https://untrusted.invalid')).status, 403);
  const hostile = await call(`/file-comments/threads/${thread.id}/replies${q}`, { expected_binding_version: first.binding, expected_version: 1, body: 'Must not append', request_id: randomUUID(), confirmed: true }, 'POST', 'https://untrusted.invalid'); assert.equal(hostile.status, 403);
  const final = await call(`/file-comments/threads/${thread.id}${q}`); assert.equal(final.body.result.version, 1); assert.equal(final.body.result.entries.length, 1);
  const foreignList = await call(`/file-comments${foreignQ}`); assert.equal(foreignList.body.result.threads.length, 0);
}));

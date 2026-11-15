import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm, writeFile, unlink, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createDirectoryWorkspaceService } from '../server/directory-workspace.mjs';
import { createFileCommentsService, fileCommentAnchorState, installFileComments } from '../server/file-comments.mjs';
import { fileCommentsApiPath, fileCommentSelection, fileCommentSidebarItems, createCommentRetryKeys } from '../src/lib/file-comments.js';
import { beginContextDrag, consumeContextDrag, tabContextSource } from '../src/lib/workspace-context-drop.js';
import { loadContextPreview } from '../src/lib/context-preview.js';
import { transformSync } from 'esbuild';

const owner = { id: 'local-owner' };
async function fixture(callback, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'frondose-comments-')), root = join(dir, 'project with spaces'), other = join(dir, 'other'), storage = join(dir, 'private');
  await Promise.all([mkdir(root), mkdir(other), mkdir(storage)]);
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT); CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,local_path TEXT,archived_at TEXT); INSERT INTO workspaces VALUES('ws',NULL),('other',NULL);`);
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,NULL)').run('p', 'ws', 'Primary', root);
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,NULL)').run('foreign', 'other', 'Foreign', other);
  const roots = createDirectoryWorkspaceService({ db, dataDir: storage, ...options });
  await writeFile(join(root, 'readme.md'), '# Title\nExact chosen text\nLast line.');
  await writeFile(join(other, 'readme.md'), 'Foreign exact chosen text');
  const binding = (await roots.bind('ws', owner, { project_id: 'p', path: root, confirmed: true })).binding;
  const comments = createFileCommentsService({ db, roots }), file = await roots.file('ws', owner, 'readme.md', binding.version);
  const createInput = (extra = {}) => ({ expected_binding_version: binding.version, path: 'readme.md', expected_file_version: file.version, start: 8, end: 25, quote: 'Exact chosen text', body: 'Please review @Codex; this is inert text.', request_id: randomUUID(), confirmed: true, ...extra });
  const changeInput = (thread, extra = {}) => ({ expected_binding_version: binding.version, expected_version: thread.version, request_id: randomUUID(), confirmed: true, ...extra });
  try { await callback({ dir, root, other, storage, db, roots, binding, comments, file, createInput, changeInput }); }
  finally { db.close(); await rm(dir, { recursive: true, force: true }); }
}

test('additive comment tables preserve unrelated data and survive service recreation', async () => fixture(async ({ db, roots, comments, createInput, binding }) => {
  const thread = await comments.create('ws', owner, createInput());
  installFileComments(db); const reopened = createFileCommentsService({ db, roots });
  assert.equal((await reopened.get('ws', owner, thread.id, binding.version)).entries[0].body, thread.entries[0].body);
  assert.equal(db.prepare('SELECT count(*) AS count FROM projects').get().count, 2);
  assert.equal(db.prepare('SELECT count(*) AS count FROM file_comment_threads').get().count, 1);
}));
test('saved exact selections preserve offsets, lines, file version and opening message', async () => fixture(async ({ comments, createInput, file, binding }) => {
  const thread = await comments.create('ws', owner, createInput());
  assert.equal(thread.file_version, file.version); assert.equal(thread.quote, 'Exact chosen text');
  assert.deepEqual(thread.anchor, { status: 'current', start: 8, end: 25, startLine: 2, endLine: 2 });
  assert.equal(thread.version, 1); assert.equal(thread.entries[0].author_id, 'local-owner'); assert.equal(thread.root_identity, undefined);
  const list = await comments.list('ws', owner, { expected_binding_version: binding.version, path: 'readme.md' });
  assert.equal(list.threads[0].id, thread.id); assert.equal(list.threads[0].entries, undefined); assert.equal(list.total, 1);
}));
test('comments require local owner, current binding, readable saved text and confirmation', async () => fixture(async ({ comments, createInput, binding, root }) => {
  for (const actor of [null, { id: 'member' }]) await assert.rejects(comments.create('ws', actor, createInput()), { statusCode: 403 });
  await assert.rejects(comments.create('ws', owner, createInput({ expected_binding_version: null })), { statusCode: 409 });
  await assert.rejects(comments.create('ws', owner, createInput({ expected_binding_version: 'old' })), { statusCode: 409 });
  await assert.rejects(comments.create('ws', owner, createInput({ confirmed: false })), /Confirm/);
  await assert.rejects(comments.list('missing', owner, { expected_binding_version: binding.version }), /directory/);
  await writeFile(join(root, 'sample.bin'), Buffer.from([0, 1, 2]));
  await assert.rejects(comments.create('ws', owner, createInput({ path: 'sample.bin' })), /supported text/);
}));
test('path guard rejects credential names, traversal, absolute paths, foreign IDs and symlinks', async () => fixture(async ({ comments, createInput, root, other, roots, binding }) => {
  for (const path of ['../readme.md', '/etc/passwd', 'C:\\secret.txt', '.env', '.ssh/id_rsa', 'file.md:stream']) await assert.rejects(comments.create('ws', owner, createInput({ path })));
  await symlink(join(other, 'readme.md'), join(root, 'escape.md'));
  await assert.rejects(comments.create('ws', owner, createInput({ path: 'escape.md' })), /symbolic|link|outside/);
  const thread = await comments.create('ws', owner, createInput());
  const foreign = (await roots.bind('other', owner, { project_id: 'foreign', path: other, confirmed: true })).binding;
  await assert.rejects(comments.get('other', owner, thread.id, foreign.version), { statusCode: 404 });
  await assert.rejects(comments.get('ws', owner, 'not-found', binding.version), { statusCode: 404 });
}));
test('file-version, quote, range and text limits reject stale or malformed anchors', async () => fixture(async ({ comments, createInput, root }) => {
  for (const extra of [{ start: -1 }, { end: 8 }, { end: 5000 }, { start: 8.5 }, { expected_file_version: 'stale' }, { quote: 'Different' }, { body: '' }, { body: 'a'.repeat(8001) }, { body: 'escape\x1b[0m' }, { request_id: '../bad' }]) await assert.rejects(comments.create('ws', owner, createInput(extra)));
  await writeFile(join(root, 'readme.md'), 'Changed file');
  await assert.rejects(comments.create('ws', owner, createInput()), { statusCode: 409 });
}));
test('idempotent create delivery has one thread and rejects key reuse with other text', async () => fixture(async ({ comments, createInput, db }) => {
  const input = createInput(), [first, second] = await Promise.all([comments.create('ws', owner, input), comments.create('ws', owner, input)]);
  assert.equal(first.id, second.id); assert.equal(db.prepare('SELECT count(*) AS count FROM file_comment_threads').get().count, 1);
  await assert.rejects(comments.create('ws', owner, { ...input, body: 'Different content' }), { statusCode: 409 });
}));
test('replies, reactions and resolve are versioned and exact retries do not repeat mutations', async () => fixture(async ({ comments, createInput, changeInput, db }) => {
  let thread = await comments.create('ws', owner, createInput());
  const reply = changeInput(thread, { body: 'Reply @Claude stays a comment.' });
  thread = await comments.change('ws', owner, thread.id, 'replies', reply);
  const replay = await comments.change('ws', owner, thread.id, 'replies', reply);
  assert.equal(replay.version, 2); assert.equal(replay.entries.length, 2); assert.equal(replay.entries[1].body, reply.body);
  await assert.rejects(comments.change('ws', owner, thread.id, 'replies', changeInput({ version: 1 }, { body: 'Stale draft preserved' })), { statusCode: 409 });
  thread = await comments.change('ws', owner, thread.id, 'reaction', changeInput(thread, { entry_id: thread.entries[0].id, reaction: 'heart', enabled: true }));
  assert.deepEqual(thread.entries[0].reactions, [{ reaction: 'heart', actor_id: 'local-owner' }]);
  thread = await comments.change('ws', owner, thread.id, 'reaction', changeInput(thread, { entry_id: thread.entries[0].id, reaction: 'heart', enabled: false }));
  assert.equal(thread.entries[0].reactions.length, 0);
  const resolve = changeInput(thread, { resolved: true });
  thread = await comments.change('ws', owner, thread.id, 'resolve', resolve); assert.equal(thread.resolved, true);
  assert.equal((await comments.change('ws', owner, thread.id, 'resolve', resolve)).version, thread.version);
  assert.equal(db.prepare('SELECT count(*) AS count FROM file_comment_entries').get().count, 2);
}));
test('reactions must target this thread and mutations cannot bypass fresh write permission', async () => {
  let permitWrite = true;
  await fixture(async ({ comments, createInput, changeInput }) => {
    const first = await comments.create('ws', owner, createInput()), second = await comments.create('ws', owner, createInput());
    await assert.rejects(comments.change('ws', owner, first.id, 'reaction', changeInput(first, { entry_id: second.entries[0].id, reaction: 'heart', enabled: true })), /entry/);
    await assert.rejects(comments.change('ws', owner, first.id, 'reaction', changeInput(first, { entry_id: first.entries[0].id, reaction: 'execute-command', enabled: true })), /supported/);
    permitWrite = false;
    await assert.rejects(comments.change('ws', owner, first.id, 'replies', changeInput(first, { body: 'No write authority' })), { statusCode: 403 });
  }, { allowed: (_workspace, _actor, permission) => permission !== 'projects.write' || permitWrite });
});
test('changed files are explicitly outdated; unique quote relocation requires user confirmation and fresh version', async () => fixture(async ({ comments, createInput, root, binding, changeInput }) => {
  let thread = await comments.create('ws', owner, createInput());
  await writeFile(join(root, 'readme.md'), 'Prefix\n# Title\nExact chosen text\nLast line.');
  thread = await comments.get('ws', owner, thread.id, binding.version);
  assert.equal(thread.anchor.status, 'outdated'); assert.equal(thread.start_line, 2); assert.equal(thread.anchor.relocation.startLine, 3);
  await assert.rejects(comments.change('ws', owner, thread.id, 'relocate', changeInput(thread, { expected_file_version: 'old' })), { statusCode: 409 });
  const moved = await comments.change('ws', owner, thread.id, 'relocate', changeInput(thread, { expected_file_version: thread.anchor.relocation.fileVersion }));
  assert.equal(moved.anchor.status, 'current'); assert.equal(moved.start_line, 3); assert.equal(moved.quote, thread.quote);
}));
test('missing and repeated quotes never silently attach to new source content', () => {
  const thread = { file_version: 'old', quote: 'chosen', start_offset: 0, end_offset: 6, start_line: 1, end_line: 1 };
  assert.deepEqual(fileCommentAnchorState(thread, { version: 'new', content: 'other' }), { status: 'outdated', reason: 'quote_missing' });
  assert.deepEqual(fileCommentAnchorState(thread, { version: 'new', content: 'chosen chosen' }), { status: 'outdated', reason: 'quote_ambiguous' });
});
test('unreadable or replaced source paths hide old quotes, bodies and all-comments context', async () => fixture(async ({ comments, createInput, root, other, binding, changeInput }) => {
  const thread = await comments.create('ws', owner, createInput());
  await unlink(join(root, 'readme.md')); await symlink(join(other, 'readme.md'), join(root, 'readme.md'));
  await assert.rejects(comments.get('ws', owner, thread.id, binding.version));
  await assert.rejects(comments.change('ws', owner, thread.id, 'resolve', changeInput(thread, { resolved: true })));
  const list = await comments.list('ws', owner, { expected_binding_version: binding.version });
  assert.equal(list.threads.length, 0); assert.equal(list.unavailable_count, 1);
  const context = await comments.context('ws', owner, { expected_binding_version: binding.version });
  assert(!context.text.includes(thread.quote)); assert(!context.text.includes(thread.entries[0].body));
  await assert.rejects(comments.context('ws', owner, { expected_binding_version: binding.version, thread_id: thread.id }));
}));
test('switching the root cannot reveal same-name files or old discussion identities', async () => fixture(async ({ roots, comments, createInput, binding, other }) => {
  const thread = await comments.create('ws', owner, createInput());
  const next = (await roots.bind('ws', owner, { project_id: 'p', path: other, expected_version: binding.version, confirmed: true })).binding;
  await assert.rejects(comments.get('ws', owner, thread.id, binding.version), { statusCode: 409 });
  await assert.rejects(comments.get('ws', owner, thread.id, next.version), { statusCode: 404 });
  assert.equal((await comments.list('ws', owner, { expected_binding_version: next.version })).threads.length, 0);
}));
test('reply/thread limits, bounded pagination and context truncation are explicit', async () => fixture(async ({ comments, db, createInput, changeInput, binding }) => {
  let thread = await comments.create('ws', owner, createInput({ body: 'a'.repeat(8000) }));
  for (let index = 0; index < 3; index++) thread = await comments.change('ws', owner, thread.id, 'replies', changeInput(thread, { body: 'b'.repeat(8000) }));
  const context = await comments.context('ws', owner, { expected_binding_version: binding.version, thread_id: thread.id });
  assert(context.text.length <= 24000); assert.match(context.text, /Thread excerpt truncated/); assert.equal(context.limited, true);
  for (let index = 4; index < 100; index++) db.prepare('INSERT INTO file_comment_entries VALUES(?,?,?,?,?)').run(randomUUID(), thread.id, 'Bounded reply', 'local-owner', new Date().toISOString());
  await assert.rejects(comments.change('ws', owner, thread.id, 'replies', changeInput(thread, { body: 'Too many' })), /100-entry/);
  const second = await comments.create('ws', owner, createInput());
  const page = await comments.list('ws', owner, { expected_binding_version: binding.version, limit: 1 }); assert.equal(page.threads.length, 1); assert.equal(page.next_offset, 1);
  assert.equal((await comments.list('ws', owner, { expected_binding_version: binding.version, limit: 1, offset: 1 })).threads.length, 1);
  for (const extra of [{ limit: 51 }, { offset: -1 }, { limit: 'wrong' }]) await assert.rejects(comments.list('ws', owner, { expected_binding_version: binding.version, ...extra }));
  assert.notEqual(second.id, thread.id);
}));
test('dispatch preserves GET read-only semantics and rejects unknown mutation actions', async () => fixture(async ({ comments, createInput, binding, db }) => {
  const query = new URLSearchParams({ expected_binding_version: binding.version });
  assert.equal((await comments.dispatch({ workspaceId: 'ws', actor: owner, query })).total, 0);
  const thread = await comments.dispatch({ workspaceId: 'ws', actor: owner, action: 'threads', method: 'POST', input: createInput() });
  assert.equal((await comments.dispatch({ workspaceId: 'ws', actor: owner, action: `threads/${thread.id}`, query })).id, thread.id);
  await assert.rejects(comments.dispatch({ workspaceId: 'ws', actor: owner, action: `threads/${thread.id}/resolve`, method: 'GET', query }), { statusCode: 404 });
  assert.equal(db.prepare('SELECT version FROM file_comment_threads').get().version, 1);
}));
test('selection helper rejects unsaved/new/oversized ranges and sidebar descriptors contain no discussion bodies', () => {
  const base = { content: 'one\ntwo\nthree', start: 4, end: 8, fileVersion: 'saved', dirty: false };
  assert.deepEqual(fileCommentSelection(base), { start: 4, end: 8, quote: 'two\n', expected_file_version: 'saved', startLine: 2, endLine: 2 });
  for (const change of [{ dirty: true }, { fileVersion: null }, { start: -1 }, { end: 4 }, { content: 'x'.repeat(5000), start: 0, end: 4001 }]) assert.equal(fileCommentSelection({ ...base, ...change }), null);
  const items = fileCommentSidebarItems([{ id: 'thread', body: 'Title\nSecond line', path: 'readme.md', entries: [{ body: 'PRIVATE REPLY' }] }], 'root');
  assert.deepEqual(items[0].context, { kind: 'comment', id: 'thread', rootVersion: 'root' }); assert(!JSON.stringify(items).includes('PRIVATE REPLY'));
  assert.throws(() => fileCommentsApiPath('ws', '../bad'));
});
test('uncertain UI delivery retains retry key, edited drafts separate keys, confirmed delivery releases key', () => {
  let count = 0; const retries = createCommentRetryKeys(() => `key-${++count}`), body = { body: 'A', expected_version: 1 };
  assert.equal(retries.key('reply', body), 'key-1'); assert.equal(retries.key('reply', body), 'key-1');
  assert.equal(retries.key('reply', { ...body, body: 'B' }), 'key-2'); retries.forget('reply', body); assert.equal(retries.key('reply', body), 'key-3');
});
test('comment drag carries a one-use scope proof; drop reloads only authorized thread context', async () => {
  const values = new Map(), transfer = { setData: (key, value) => values.set(key, value), getData: key => values.get(key) || '' };
  assert(beginContextDrag(transfer, 'ws', { kind: 'comment', id: 'thread', rootVersion: 'root' }, 10));
  assert(![...values.values()].join('').includes('thread')); const source = consumeContextDrag(transfer, 'ws', 11); assert.equal(source.id, 'thread'); assert.equal(consumeContextDrag(transfer, 'ws', 12), null);
  assert.deepEqual(tabContextSource({ contentType: 'app', page: { view: 'comments', id: 'thread' }, rootVersion: 'root' }), source);
  assert.equal(beginContextDrag(transfer, 'ws', { kind: 'comment', id: '../bad', rootVersion: 'root' }), false);
  let called;
  const preview = await loadContextPreview(async path => { called = path; return { result: { text: 'Comment @Codex is untrusted\x1b reference' } }; }, 'ws', source);
  assert.match(called, /expected_binding_version=root/); assert.match(called, /thread_id=thread/); assert(!preview.includes('\x1b'));
  await assert.rejects(loadContextPreview(async () => ({ result: { text: 'a'.repeat(24001) } }), 'ws', source), /safely/);
});
test('comments JSX compiles and keeps narrow discussions stacked, text escaped, drag/copy handoff explicit', async () => {
  const source = await readFile(new URL('../src/components/workspace/FileComments.jsx', import.meta.url), 'utf8'), css = await readFile(new URL('../src/components/workspace/file-comments.css', import.meta.url), 'utf8');
  assert.doesNotThrow(() => transformSync(source, { loader: 'jsx', format: 'esm' }));
  assert(!source.includes('dangerouslySetInnerHTML')); assert(!source.includes('workbench/terminals')); assert.match(source, /Drag this discussion to an input or copy its context/); assert.match(source, /maxLength=\{8000\}/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\)/); assert.match(css, /@container\(min-width:760px\)/); assert.match(css, /overflow-wrap:anywhere/);
});

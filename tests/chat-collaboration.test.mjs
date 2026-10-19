import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { installChatCollaboration, chatCollaborationRoute, chatCollaborationSnapshot, validateChatMessageContext, validateChatContextAttachments, chatContextSnapshotAccess } from '../server/chat-collaboration.mjs';
import { installWorkspaceFeatures } from '../server/workspace-features.mjs';
import { threadMessages, messageLink, quotedMessage, restoreComposer, persistComposer, chatMarkdown } from '../src/lib/chats.js';
import { EMOJI_REACTIONS, ICON_REACTIONS } from '../src/lib/reaction-catalog.js';

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'rumbo-chat-collaboration-'));
  const db = new DatabaseSync(join(dir, 'test.sqlite'));
  db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  for (const table of ['workspaces', 'projects', 'chats', 'agents', 'memory_notes']) if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'archived_at')) db.exec(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
  installWorkspaceFeatures(db); installChatCollaboration(db);
  const now = '2026-09-19T00:00:00.000Z';
  for (const id of ['ws', 'other']) db.prepare('INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, id, id, now, now);
  for (const [id, workspace] of [['p', 'ws'], ['p2', 'ws'], ['other-p', 'other']]) db.prepare('INSERT INTO projects(id,workspace_id,name,identifier,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, workspace, id, id, now, now);
  for (const [id, workspace, project] of [['c', 'ws', 'p'], ['c2', 'ws', 'p2'], ['other-c', 'other', 'other-p']]) db.prepare('INSERT INTO chats(id,workspace_id,project_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, workspace, project, id, now, now);
  const message = (id, chat = 'c', content = id, metadata = {}) => db.prepare('INSERT INTO messages(id,chat_id,sender_type,sender_name,content,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, chat, 'user', 'Tester', content, JSON.stringify(metadata), now, now);
  message('m1'); message('m2', 'c', 'Reply', { reply_to: 'm1' }); message('m3'); message('foreign', 'other-c');
  const version = chat => chatCollaborationSnapshot(db).chat_collaboration.find(item => item.chat_id === chat)?.version || 0;
  const actor = { id: 'tester' }, denied = new Set();
  const allowed = (workspaceId, who, permission, scope) => workspaceId === 'ws' && who?.id === actor.id && !denied.has(`${permission}:${scope.scope_type || ''}:${scope.scope_id || ''}`);
  const call = async (action, body = {}, chat = 'c') => {
    let output;
    const request = { workspace_id: 'ws', version: version(chat), action, ...body };
    const handled = await chatCollaborationRoute({ db, req: { method: 'POST' }, res: {}, path: `/chat-collaboration/${chat}`, url: new URL('http://localhost/'), readBody: async () => request, send: (_res, status, payload) => { output = { status, ...payload }; }, snapshot: () => ({}), actor, allowed });
    assert.equal(handled, true); return output;
  };
  const getSnapshot = async id => {
    let output;
    await chatCollaborationRoute({ db, req: { method: 'GET' }, res: {}, path: `/chat-collaboration/c/snapshots/${id}`, url: new URL('http://localhost/?workspace_id=ws'), readBody: async () => ({}), send: (_res, _status, payload) => { output = payload.result; }, snapshot: () => ({}), actor, allowed });
    return output;
  };
  const document = (id, workspace = 'ws', content = 'Exact selected content') => db.prepare('INSERT INTO documents(id,workspace_id,project_id,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, workspace, workspace === 'ws' ? 'p' : 'other-p', id, content, now, now);
  try { await fn({ db, call, version, document, message, now, actor, allowed, denied, getSnapshot }); }
  finally { db.close(); await rm(dir, { recursive: true, force: true }); }
}

test('custom reactions enforce workspace ownership, archival and tint restrictions', () => fixture(async ({ db, call, now }) => {
  for (const [id, workspace, archived] of [['mine', 'ws', null], ['foreign-emoji', 'other', null], ['old', 'ws', now]]) db.prepare('INSERT INTO workspace_items VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, workspace, 'emoji', id, JSON.stringify({ symbol: '🎉' }), 0, 1, archived, now, now);
  await call('reaction', { message_id: 'm1', reaction_id: 'custom:mine', enabled: true });
  assert.match(db.prepare('SELECT payload_json FROM chat_collaboration WHERE chat_id=?').get('c').payload_json, /custom:mine/);
  for (const reaction_id of ['custom:foreign-emoji', 'custom:missing', 'custom:old']) await assert.rejects(call('reaction', { message_id: 'm1', reaction_id, enabled: true }));
  await assert.rejects(call('reaction', { message_id: 'm1', reaction_id: 'custom:mine', color: '#ffffff', enabled: true }));
  await call('reaction', { message_id: 'm1', reaction_id: 'custom:mine', enabled: false });
}));

test('bookmarks persist, reject stale changes, and cannot reference another chat', async () => fixture(async ({ db, call }) => {
  await call('bookmark', { message_id: 'm1', enabled: true });
  assert.deepEqual(chatCollaborationSnapshot(db).chat_collaboration[0].bookmarks, ['m1']);
  await assert.rejects(call('bookmark', { message_id: 'm2', enabled: true, version: 0 }), error => error.statusCode === 409);
  await assert.rejects(call('bookmark', { message_id: 'foreign', enabled: true }), /conversation/);
  await assert.rejects(call('bookmark', { message_id: 'foreign', enabled: true }, 'other-c'), /workspace/);
  await call('bookmark', { message_id: 'm1', enabled: false });
  assert.deepEqual(chatCollaborationSnapshot(db).chat_collaboration[0].bookmarks, []);
}));

test('icon and emoji reactions persist, have idempotent desired state, and preserve other collaboration features', async () => fixture(async ({ db, call }) => {
  await call('bookmark', { message_id: 'm1', enabled: true });
  await call('reaction', { message_id: 'm1', reaction_id: 'icon:rocket', color: '#AABBCC', enabled: true });
  await call('reaction', { message_id: 'm1', reaction_id: 'icon:rocket', color: '#aabbcc', enabled: true });
  const emoji = EMOJI_REACTIONS[0].id;
  await call('reaction', { message_id: 'm1', reaction_id: emoji, color: null, enabled: true });
  let state = chatCollaborationSnapshot(db).chat_collaboration[0];
  assert.deepEqual(state.bookmarks, ['m1']); assert.equal(state.reactions.m1.length, 2);
  assert.equal(state.reactions.m1[0].color, '#aabbcc');
  assert.equal(JSON.parse(db.prepare('SELECT payload_json FROM chat_collaboration WHERE chat_id=?').get('c').payload_json).reactions.m1.length, 2);
  await call('bookmark', { message_id: 'm2', enabled: true });
  assert.equal(chatCollaborationSnapshot(db).chat_collaboration[0].reactions.m1.length, 2);
  await call('reaction', { message_id: 'm1', reaction_id: 'icon:rocket', color: '#aabbcc', enabled: false });
  await call('reaction', { message_id: 'm1', reaction_id: emoji, enabled: false });
  assert.deepEqual(chatCollaborationSnapshot(db).chat_collaboration[0].reactions, {});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM runs').get().n, 0);
}));

test('reaction mutations reject foreign messages, archived scope, stale edits, invalid glyphs and unsafe colors', async () => fixture(async ({ db, call }) => {
  const base = { message_id: 'm1', reaction_id: 'icon:rocket', enabled: true };
  await call('reaction', base);
  await assert.rejects(call('reaction', { ...base, version: 0 }), error => error.statusCode === 409);
  await assert.rejects(call('reaction', { ...base, message_id: 'foreign' }), /conversation/);
  await assert.rejects(call('reaction', base, 'other-c'), /workspace/);
  await assert.rejects(call('reaction', { ...base, reaction_id: 'unknown' }), /supported reaction/);
  await assert.rejects(call('reaction', { ...base, color: 'url(https://example.com)' }), /supported reaction/);
  await assert.rejects(call('reaction', { ...base, reaction_id: EMOJI_REACTIONS[0].id, color: '#123456' }), /supported reaction/);
  await assert.rejects(call('reaction', { ...base, enabled: 'yes' }), /whether/);
  db.prepare('UPDATE chats SET archived_at=? WHERE id=?').run('2026-09-20', 'c');
  await assert.rejects(call('reaction', base), /active conversation/);
}));

test('reaction count is bounded per message and can be reduced at the limit', async () => fixture(async ({ db, call }) => {
  for (const reaction of ICON_REACTIONS.slice(0, 24)) await call('reaction', { message_id: 'm1', reaction_id: reaction.id, enabled: true });
  await assert.rejects(call('reaction', { message_id: 'm1', reaction_id: ICON_REACTIONS[24].id, enabled: true }), /24/);
  await call('reaction', { message_id: 'm1', reaction_id: ICON_REACTIONS[0].id, enabled: false });
  assert.equal(chatCollaborationSnapshot(db).chat_collaboration[0].reactions.m1.length, 23);
}));

test('context snapshots resolve packs, deduplicate sources, remain immutable and reject cross-workspace data', async () => fixture(async ({ db, call, document, now }) => {
  document('d'); document('private', 'other');
  db.prepare('INSERT INTO workspace_items(id,workspace_id,kind,name,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('pack', 'ws', 'context_pack', 'Starter', JSON.stringify({ document_ids: ['d'], content: 'Pack note' }), now, now);
  const response = await call('context', { sources: [{ kind: 'document', id: 'd' }, { kind: 'pack', id: 'pack' }] });
  assert.equal(response.result.sources.length, 2); assert.match(response.result.content, /Exact selected content/);
  db.prepare('UPDATE documents SET content=? WHERE id=?').run('Changed later', 'd');
  assert.match(db.prepare('SELECT content FROM chat_context_snapshots').get().content, /Exact selected content/);
  await assert.rejects(call('context', { sources: [{ kind: 'document', id: 'private' }] }), /workspace/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_context_snapshots').get().n, 1);
  assert.equal(validateChatMessageContext(db, 'c', { context_snapshot_id: response.result.id }).context_snapshot_id, response.result.id);
  assert.throws(() => validateChatMessageContext(db, 'c2', { context_snapshot_id: response.result.id }), /conversation/);
}));

test('context over the provider attachment limit is rejected instead of silently truncated', async () => fixture(async ({ db, call, document }) => {
  document('long', 'ws', 'x'.repeat(15000));
  await assert.rejects(call('context', { sources: [{ kind: 'document', id: 'long' }] }), /15 KB/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_context_snapshots').get().n, 0);
}));

test('only the exact selected immutable context can carry a snapshot marker', async () => fixture(async ({ db, call, document }) => {
  document('d');
  const snapshot = (await call('context', { sources: [{ kind: 'document', id: 'd' }] })).result;
  const file = { name: `talvori-context-${snapshot.id}.md`, type: 'text/markdown', content: snapshot.content, rumbo_context_snapshot: snapshot.id };
  const input = { context_snapshot_id: snapshot.id, reply_to: 'm1', attachments: [file] };
  assert.deepEqual(validateChatContextAttachments(db, 'c', input), { reply_to: 'm1', context_snapshot_id: snapshot.id });
  assert.throws(() => validateChatContextAttachments(db, 'c', { ...input, attachments: [{ ...file, content: 'Forged contents' }] }), /changed/);
  assert.throws(() => validateChatContextAttachments(db, 'c', { ...input, attachments: [{ ...file, rumbo_context_snapshot: 'other' }] }), /changed/);
  assert.throws(() => validateChatContextAttachments(db, 'c', { attachments: [file] }), /Choose a context/);
  assert.throws(() => validateChatContextAttachments(db, 'c', { ...input, attachments: [] }), /once/);
  assert.throws(() => validateChatContextAttachments(db, 'c', { ...input, attachments: [file, file] }), /once/);
  assert.throws(() => validateChatContextAttachments(db, 'c', { ...input, attachments: [{ name: 'another', content: 'file' }, file] }), /before/);
  assert.throws(() => validateChatContextAttachments(db, 'c2', input), /conversation/);
}));

const markedSnapshot = snapshot => ({ name: `talvori-context-${snapshot.id}.md`, type: 'text/markdown', content: snapshot.content, rumbo_context_snapshot: snapshot.id });
test('chat context captures source ACL lineage privately and rechecks original and current scopes after moves', async () => fixture(async ({ db, call, document, actor, allowed, denied, getSnapshot }) => {
  document('scoped');
  const snapshot = (await call('context', { sources: [{ kind: 'document', id: 'scoped' }] })).result;
  const options = { chatId: 'c', workspaceId: 'ws', attachments: [markedSnapshot(snapshot)], actor, allowed };
  const original = chatContextSnapshotAccess(db, options);
  assert.ok(original.sources.some(ref => ref.table === 'documents' && ref.id === 'scoped' && ref.scope.scope_id === 'p'));
  assert.ok(original.sources.some(ref => ref.table === 'chats' && ref.id === 'c'));
  assert.equal(Object.hasOwn(snapshot, 'source_access_json'), false);
  assert.equal(Object.hasOwn(await getSnapshot(snapshot.id), 'source_access_json'), false);
  db.prepare("UPDATE documents SET project_id='p2',content='Changed after capture' WHERE id='scoped'").run();
  assert.deepEqual(chatContextSnapshotAccess(db, options), original, 'Do not recapture current scope as replacement authority');
  assert.match((await getSnapshot(snapshot.id)).content, /Exact selected content/);
  denied.add('documents.read:project:p');
  assert.throws(() => chatContextSnapshotAccess(db, options), { code: 'context_access_revoked' });
  await assert.rejects(getSnapshot(snapshot.id), { code: 'context_access_revoked' });
  denied.clear(); denied.add('documents.read:project:p2');
  assert.throws(() => chatContextSnapshotAccess(db, options), { code: 'context_access_revoked' });
  denied.clear(); denied.add('chats.read:project:p');
  assert.throws(() => chatContextSnapshotAccess(db, options), { code: 'context_access_revoked' });
}));

test('snapshot lineage includes expanded context packs and rejects unreadable selection before persistence', async () => fixture(async ({ db, call, document, now, denied, actor, allowed }) => {
  document('pack-doc');
  db.prepare('INSERT INTO workspace_items(id,workspace_id,kind,name,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('private-pack', 'ws', 'context_pack', 'Pack', JSON.stringify({ document_ids: ['pack-doc'], content: 'Pack text' }), now, now);
  denied.add('documents.read:project:p');
  await assert.rejects(call('context', { sources: [{ kind: 'pack', id: 'private-pack' }] }), { code: 'context_access_revoked' });
  assert.equal(db.prepare('SELECT COUNT(*) count FROM chat_context_snapshots').get().count, 0);
  denied.clear();
  const snapshot = (await call('context', { sources: [{ kind: 'pack', id: 'private-pack' }] })).result;
  const access = chatContextSnapshotAccess(db, { chatId: 'c', workspaceId: 'ws', attachments: [markedSnapshot(snapshot)], actor, allowed });
  assert.ok(access.sources.some(ref => ref.table === 'workspace_items' && ref.id === 'private-pack'));
  assert.ok(access.sources.some(ref => ref.table === 'documents' && ref.id === 'pack-doc'));
  db.prepare("UPDATE documents SET archived_at=? WHERE id='pack-doc'").run(now);
  assert.throws(() => chatContextSnapshotAccess(db, { chatId: 'c', workspaceId: 'ws', attachments: [markedSnapshot(snapshot)], actor, allowed }), { code: 'context_access_revoked' });
}));

test('legacy snapshots require reselection and ordinary user attachments remain unaffected', async () => fixture(async ({ db, call, document, actor, allowed, getSnapshot }) => {
  document('d');
  const snapshot = (await call('context', { sources: [{ kind: 'document', id: 'd' }] })).result;
  db.prepare('UPDATE chat_context_snapshots SET source_access_json=NULL WHERE id=?').run(snapshot.id);
  const options = { chatId: 'c', workspaceId: 'ws', attachments: [markedSnapshot(snapshot)], actor, allowed };
  assert.throws(() => chatContextSnapshotAccess(db, options), { code: 'context_snapshot_reselect', statusCode: 409 });
  await assert.rejects(getSnapshot(snapshot.id), { code: 'context_snapshot_reselect' });
  assert.equal(chatContextSnapshotAccess(db, { ...options, attachments: [{ name: 'own.md', type: 'text/markdown', content: 'Own text' }] }), null);
  assert.equal(chatContextSnapshotAccess(db, { ...options, attachments: [] }), null);
}));

test('snapshot access cannot be forged by marker, text, filename, chat or workspace substitutions', async () => fixture(async ({ db, call, document, actor, allowed }) => {
  document('d');
  const snapshot = (await call('context', { sources: [{ kind: 'document', id: 'd' }] })).result;
  const file = markedSnapshot(snapshot), base = { chatId: 'c', workspaceId: 'ws', attachments: [file], actor, allowed };
  for (const changed of [{ content: 'Forged' }, { name: 'other.md' }, { type: 'text/plain' }, { rumbo_context_snapshot: 'missing' }]) assert.throws(() => chatContextSnapshotAccess(db, { ...base, attachments: [{ ...file, ...changed }] }));
  assert.throws(() => chatContextSnapshotAccess(db, { ...base, attachments: [file, file] }));
  assert.throws(() => chatContextSnapshotAccess(db, { ...base, chatId: 'c2' }));
  assert.throws(() => chatContextSnapshotAccess(db, { ...base, workspaceId: 'other' }));
  assert.throws(() => chatContextSnapshotAccess(db, { ...base, actor: { id: 'unauthorized' } }), { code: 'context_access_revoked' });
}));

test('chat snapshot migration adds nullable lineage without rewriting legacy content', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY); CREATE TABLE chats(id TEXT PRIMARY KEY);
      CREATE TABLE chat_context_snapshots(id TEXT PRIMARY KEY,workspace_id TEXT,chat_id TEXT,content TEXT,sources_json TEXT,created_at TEXT);
      INSERT INTO chat_context_snapshots VALUES('old','ws','c','Historical text','[]','2026-09-19');`);
    installChatCollaboration(db); installChatCollaboration(db);
    assert.deepEqual({ ...db.prepare('SELECT * FROM chat_context_snapshots').get() }, { id: 'old', workspace_id: 'ws', chat_id: 'c', content: 'Historical text', sources_json: '[]', created_at: '2026-09-19', source_access_json: null });
  } finally { db.close(); }
});

test('branches copy only history through the selected message, retain origins and never start agents', async () => fixture(async ({ db, call }) => {
  const before = db.prepare('SELECT * FROM messages WHERE chat_id=?').all('c');
  const result = (await call('branch', { message_id: 'm2', title: 'Alternative approach' })).result;
  const copied = db.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY rowid').all(result.chat_id);
  assert.equal(copied.length, 2); assert.ok(copied.every(item => item.sender_type === 'system' && item.kind === 'note'));
  assert.equal(JSON.parse(copied[0].metadata_json).origin_message_id, 'm1');
  assert.equal(JSON.parse(copied[1].metadata_json).reply_to, copied[0].id);
  assert.deepEqual(db.prepare('SELECT * FROM messages WHERE chat_id=?').all('c'), before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM runs').get().n, 0);
  assert.equal(chatCollaborationSnapshot(db).chat_collaboration.find(item => item.chat_id === result.chat_id).branch.copied_messages, 2);
}));

test('follow-up drafts preserve access and reply references without creating messages or runs', async () => fixture(async ({ db, call }) => {
  const result = (await call('draft', { content: 'Discuss later', recipient: 'note', permission: 'conversation', reply_to: 'm1' })).result;
  assert.equal(result.reply_to, 'm1'); assert.equal(result.permission, 'conversation');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n, 4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM runs').get().n, 0);
  await assert.rejects(call('draft', { content: 'Wrong', recipient: 'missing' }), /agent/);
  await assert.rejects(call('draft', { content: 'Wrong', reply_to: 'foreign' }), /conversation/);
  await call('remove-draft', { draft_id: result.id });
  assert.equal(chatCollaborationSnapshot(db).chat_collaboration[0].drafts.length, 0);
}));

test('document conversion retains source links and validates destination scope', async () => fixture(async ({ db, call }) => {
  const result = (await call('document', { message_id: 'm1', title: 'Decision' })).result;
  assert.match(db.prepare('SELECT content FROM documents WHERE id=?').get(result.id).content, /#\/chats\/c\?message=m1/);
  await assert.rejects(call('document', { message_id: 'm1', title: 'Wrong', project_id: 'other-p' }), /workspace/);
}));

test('moving conversations requires explicit confirmation, stays in workspace and clears Route link', async () => fixture(async ({ db, call, now }) => {
  db.prepare('INSERT INTO tasks(id,workspace_id,project_id,number,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('task', 'ws', 'p', 1, 'Task', now, now);
  db.prepare('UPDATE chats SET task_id=? WHERE id=?').run('task', 'c');
  await assert.rejects(call('move', { project_id: 'p2' }), /Confirm/);
  await assert.rejects(call('move', { project_id: 'other-p', confirmed: true }), /workspace/);
  await call('move', { project_id: 'p2', confirmed: true });
  assert.deepEqual({ ...db.prepare('SELECT project_id,task_id FROM chats WHERE id=?').get('c') }, { project_id: 'p2', task_id: null });
}));

test('thread navigation, quotation, source exports and composer context restoration are deterministic', () => {
  const messages = [{ id: 'a', content: 'Root' }, { id: 'b', content: 'Child', metadata: { reply_to: 'a' } }, { id: 'c', content: 'Nested', metadata: { reply_to: 'b' } }, { id: 'd', content: 'Other' }];
  assert.deepEqual(threadMessages(messages, 'a').map(item => item.id), ['a', 'b', 'c']);
  assert.equal(quotedMessage(messages[0]), '> Root\n\n');
  assert.equal(messageLink('chat', 'a', 'http://localhost/'), 'http://localhost/#/chats/chat?message=a');
  const map = new Map(), storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  const composer = { ...restoreComposer({ id: 'c' }, [], storage), replyTo: 'a', context: { id: 'ctx', content: 'Snapshot', sources: [] }, text: 'Follow-up' };
  persistComposer('c', composer, storage);
  assert.equal(restoreComposer({ id: 'c' }, [], storage).context.content, 'Snapshot');
  assert.equal(restoreComposer({ id: 'c' }, [], storage).replyTo, 'a');
  assert.match(chatMarkdown({ id: 'chat', title: 'Example' }, messages), /Source: \[Open message\]/);
});

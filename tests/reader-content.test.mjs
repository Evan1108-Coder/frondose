import assert from 'node:assert/strict';
import test from 'node:test';
import { breadcrumbItems, decodeReaderText, readableResource, readerBackPage, readerRecord, readerResourceTarget, READER_TEXT_LIMIT } from '../src/lib/reader-content.js';
import { pageHash, parsePage } from '../src/lib/navigation.js';
import { readerTarget } from '../src/lib/message-resources.js';
import { rememberPage } from '../src/lib/workspace-experience.js';

const snapshot = {
  documents: [
    { id: 'doc_1', workspace_id: 'w1', title: 'Fresh document', content: 'Current content' },
    { id: 'doc_other', workspace_id: 'w2', title: 'Other workspace', content: 'Private' },
    { id: 'doc_archived', workspace_id: 'w1', title: 'Archived', archived_at: 'now', content: 'Not available' },
  ],
  outputs: [{ id: 'out_1', workspace_id: 'w1', title: 'Output', current_version: 2 }],
  output_versions: [
    { id: 'v1', output_id: 'out_1', workspace_id: 'w1', number: 1, content: 'Obsolete' },
    { id: 'v2', output_id: 'out_1', workspace_id: 'w1', number: 2, content: 'Reviewed current version' },
    { id: 'v3', output_id: 'out_1', workspace_id: 'w1', number: 3, content: 'Not canonical' },
  ],
};

test('temporary reader routes round-trip with a canonical Back destination', () => {
  const origin = pageHash('chats', 'chat_1', { projectId: 'project_1', messageId: 'message_1' });
  const hash = pageHash('reader', readerTarget('documents', 'doc_1'), { returnTo: origin });
  assert.deepEqual(parsePage(hash), { view: 'reader', id: 'document:doc_1', projectId: null, returnTo: origin });
  assert.deepEqual(readerBackPage(origin), parsePage(origin));
  assert.equal(pageHash('reader', 'document:doc_1').includes('from='), false);
});

test('reader Back rejects external, nested-reader and repaired noncanonical destinations', () => {
  for (const hash of ['https://evil.example/#/chats', 'javascript:alert(1)', '#/reader/document:other', '#/chats?unknown=1', '#/chats/%ZZ', '#/conversations/chat_1', '#/chats?from=%23%2Fchats']) {
    assert.deepEqual(readerBackPage(hash), { view: 'chats', id: null, projectId: null }, hash);
  }
});

test('reader only resolves visible records in the current workspace', () => {
  assert.equal(readerRecord(snapshot, 'w1', { kind: 'document', id: 'doc_1' }).content, 'Current content');
  for (const id of ['doc_other', 'doc_archived', 'missing']) assert.equal(readerRecord(snapshot, 'w1', { kind: 'document', id }), null);
  assert.equal(readerRecord(snapshot, 'w1', { kind: 'guide', id: 'doc_1' }), null);
  assert.equal(readerRecord({}, 'w1', { kind: 'document', id: 'doc_1' }), null);
});

test('reader output selects exact canonical current version, not highest or old content', () => {
  const current = readerRecord(snapshot, 'w1', { kind: 'output', id: 'out_1' });
  assert.equal(current.content, 'Reviewed current version');
  assert.equal(current.version, 2);
  assert.deepEqual(current.source, { view: 'library', id: 'out_1' });
  assert.equal(readerRecord({ ...snapshot, output_versions: snapshot.output_versions.filter(v => v.number !== 2) }, 'w1', { kind: 'output', id: 'out_1' }), null);
  assert.equal(readerRecord({ ...snapshot, output_versions: snapshot.output_versions.map(v => ({ ...v, workspace_id: 'w2' })) }, 'w1', { kind: 'output', id: 'out_1' }), null);
});

test('resource reader accepts one scoped pair, not path traversal or control characters', () => {
  assert.deepEqual(readerResourceTarget('team_1:resource-1'), { teamId: 'team_1', resourceId: 'resource-1' });
  for (const id of ['team_1', 'team_1:resource_1:extra', '../team:resource', 'team:..', 'team:\\private', 'team:resource\u0000', ':resource']) assert.equal(readerResourceTarget(id), null, id);
});

test('resource reader bounds text files and rejects active HTML or non-UTF8/binary content', () => {
  const text = { kind: 'file', file_name: 'brief.md', byte_size: 100 };
  assert.equal(readableResource(text), true);
  for (const item of [{ ...text, archived_at: 'now' }, { ...text, byte_size: READER_TEXT_LIMIT + 1 }, { ...text, file_name: 'index.html' }, { ...text, file_name: 'file.pdf' }, { ...text, kind: 'url' }]) assert.equal(readableResource(item), false);
  assert.equal(decodeReaderText(new TextEncoder().encode('中文 → x ≤ y')), '中文 → x ≤ y');
  assert.throws(() => decodeReaderText(new Uint8Array([0xc3, 0x28])));
  assert.throws(() => decodeReaderText(new Uint8Array([65, 0, 66])));
  assert.throws(() => decodeReaderText(new Uint8Array(READER_TEXT_LIMIT + 1)));
});

test('breadcrumbs expose clickable canonical parents and a named current entity', () => {
  const data = { projects: [{ id: 'p1', name: 'Project' }], chats: [{ id: 'c1', title: 'Design conversation' }], teams: [{ id: 't1', name: 'Research' }] };
  const workspace = { name: 'Frondose Studio' };
  assert.deepEqual(breadcrumbItems({ page: { view: 'chats', id: 'c1', projectId: 'p1' }, workspace, data }).map(item => item.label), ['Frondose Studio', 'Projects', 'Project', 'Conversations', 'Design conversation']);
  const area = breadcrumbItems({ page: { view: 'teams', id: 't1', section: 'resources' }, workspace, data });
  assert.deepEqual(area.map(item => item.label), ['Frondose Studio', 'Areas', 'Research', 'Resources']);
  assert.deepEqual(area[2], { label: 'Research', view: 'teams', id: 't1' });
  assert.equal(area.at(-1).current, true);
});

test('temporary Docs reader never becomes a recent page', () => {
  const experience = { version: 1, recent: [{ view: 'chats', id: 'c1' }] };
  assert.equal(rememberPage(experience, { view: 'reader', id: 'document:doc_1' }), experience);
});

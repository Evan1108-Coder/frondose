import assert from 'node:assert/strict';
import test from 'node:test';
import { containsDraggedFiles, readComposerFiles } from '../src/lib/composer-files.js';

test('detects file drags without treating text drags as uploads', () => {
  assert.equal(containsDraggedFiles({ dataTransfer: { types: ['text/plain', 'Files'] } }), true);
  assert.equal(containsDraggedFiles({ dataTransfer: { types: ['text/plain'] } }), false);
  assert.equal(containsDraggedFiles({}), false);
});

test('reads dropped text files and retains existing attachments', async () => {
  const existing = [{ name: 'old.md', type: 'text/markdown', size: 3, content: 'old' }];
  const result = await readComposerFiles([new File(['hello'], 'new.md', { type: 'text/markdown' })], existing);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], existing[0]);
  assert.deepEqual(result[1], { name: 'new.md', type: 'text/markdown', size: 5, content: 'hello' });
  assert.equal(existing.length, 1);
});

test('rejects unsupported, oversized, too many, and collectively oversized files', async () => {
  await assert.rejects(readComposerFiles([new File(['x'], 'clip.mp4', { type: 'video/mp4' })]), /Choose a text file/);
  await assert.rejects(readComposerFiles([new File(['x'.repeat(350_001)], 'large.txt', { type: 'text/plain' })]), /too large/);
  await assert.rejects(readComposerFiles([new File(['x'], 'one.txt', { type: 'text/plain' })], Array.from({ length: 20 }, (_, i) => ({ name: `${i}.txt`, type: 'text/plain', size: 1, content: 'x' }))), /up to 20/);
  const twoLarge = [new File(['x'.repeat(340_000)], 'a.txt', { type: 'text/plain' }), new File(['x'.repeat(340_000)], 'b.txt', { type: 'text/plain' })];
  await assert.rejects(readComposerFiles(twoLarge), /too large together/);
});

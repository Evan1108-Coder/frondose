import test from 'node:test';
import assert from 'node:assert/strict';
import { customEmojis, emojiShortcode, isEmojiImage } from '../src/lib/custom-emojis.js';
import { payloadFor } from '../server/workspace-features.mjs';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
test('custom emoji payloads accept bounded raster files but reject markup and remote URLs', () => {
  assert.equal(payloadFor(null, 'emoji', { symbol: png }, 'ws').symbol, png);
  for (const symbol of ['data:image/svg+xml;base64,PHN2Zz4=', 'https://example.com/e.png', '', 'data:image/png;base64,AAAA', 'data:image/png;base64,' + 'A'.repeat(334001)]) assert.throws(() => payloadFor(null, 'emoji', { symbol }, 'ws'));
  assert.equal(payloadFor(null, 'emoji', { symbol: '🎉' }, 'ws').symbol, '🎉');
});
test('custom emoji library is workspace-scoped, excludes archived selections, and retains history', () => {
  const row = { id: 'e', name: 'Party Time', kind: 'emoji', workspace_id: 'ws', payload: { symbol: png } };
  const rows = [row, { ...row, id: 'foreign', workspace_id: 'other' }, { ...row, id: 'old', archived_at: 'yesterday' }];
  assert.deepEqual(customEmojis(rows, 'ws').map(item => item.id), ['custom:e']);
  assert.equal(customEmojis(rows, 'ws', true).length, 2);
  assert.equal(emojiShortcode(row), ':party-time:');
  assert.equal(isEmojiImage(png), true);
  assert.equal(isEmojiImage('<svg/>'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('conversation grid keeps the thread out of the resize track when the list becomes an overlay', () => {
  const css = readFileSync(new URL('../src/views/chats-page.css', import.meta.url), 'utf8');
  for (const [className, column] of [['chat-hub-list', 1], ['chat-list-resizer', 2], ['chat-thread', 3]]) {
    assert.match(css, new RegExp(`\\.chat-hub\\.resizable-chat-hub > \\.${className} \\{ grid-column: ${column}; grid-row: 1; \\}`));
  }
});

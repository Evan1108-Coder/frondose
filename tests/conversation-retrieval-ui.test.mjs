import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('past-conversation source UI searches only on explicit activation and sends source IDs', async () => {
  const picker = await readFile(new URL('../src/components/ConversationSources.jsx', import.meta.url), 'utf8');
  const chats = await readFile(new URL('../src/views/Chats.jsx', import.meta.url), 'utf8');
  assert.match(picker, /onClick=\{search\}/);
  assert.match(picker, /onKeyDown=.*event\.key === 'Enter'/);
  assert.match(picker, /AbortController/);
  assert.doesNotMatch(picker, /localStorage|sessionStorage|setTimeout|\/turns|\/context\/inspect/);
  assert.match(picker, /onToggle\(\{ kind: 'message', id: item\.id \}\)/);
  assert.match(chats, /contextPending \? contextLoadError/);
  assert.match(chats, /snapshots\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(chats, /composer\.context\?\.id === id/);
});

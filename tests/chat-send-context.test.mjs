import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareExplicitChatSend } from '../src/lib/chat-send-context.js';

const fixture = () => ({ id: 'one-use-inspection', manifest: {}, finalPrompt: 'Exact bounded prompt', expires_at: new Date(Date.now() + 60000).toISOString() });

test('explicit send captures server context and returns the one-use inspection, not a bypass', async () => {
  const request = { prompt: 'Hello', native_tools: false };
  let calls = 0;
  const result = await prepareExplicitChatSend({ request, inspect: async body => { calls++; assert.equal(body, request); return fixture(); } });
  assert.equal(result.id, 'one-use-inspection'); assert.equal(calls, 1);
});
test('reviewed elevated context is reused without a second inspection', async () => {
  const reviewed = fixture();
  assert.equal(await prepareExplicitChatSend({ request: {}, reviewed, inspect: () => assert.fail('unexpected inspect') }), reviewed);
});
test('uncertain delivery does not capture a new prompt or consume a different inspection', async () => {
  assert.equal(await prepareExplicitChatSend({ recovering: true, inspect: () => assert.fail('unexpected inspect') }), null);
});
test('malformed, expired, and changed drafts never proceed to send', async () => {
  for (const captured of [{}, { ...fixture(), expires_at: new Date(0).toISOString() }]) {
    await assert.rejects(prepareExplicitChatSend({ request: {}, inspect: async () => captured }), /could not be prepared/);
  }
  await assert.rejects(prepareExplicitChatSend({ request: {}, inspect: async () => fixture(), isCurrent: () => false }), /draft changed/);
  await assert.rejects(prepareExplicitChatSend({ request: {}, inspect: async () => { throw new Error('Source access revoked'); } }), /Source access revoked/);
});
test('composer keeps a profile recipient selector and no inline review, model, or schedule control', async () => {
  const chat = await readFile(new URL('../src/views/Chats.jsx', import.meta.url), 'utf8');
  const agent = await readFile(new URL('../src/views/TalvoriAgent.jsx', import.meta.url), 'utf8');
  const composer = chat.slice(chat.indexOf('<div className="chat-compose-controls">'), chat.indexOf('</Form>', chat.indexOf('<div className="chat-compose-controls">')));
  assert.doesNotMatch(composer, />Discuss<|>Inspect<|>Schedule<|Save follow-up draft|ModelChoice|☺/);
  assert.match(composer, />Chat</); assert.match(composer, /<Smile/);
  assert.doesNotMatch(agent, /ModelChoice|aria-label="AI model provider"|aria-label="Talvori Agent provider"/);
  assert.match(agent, /agent_id: selectedAgent.id/);
  assert.match(chat, /Schedule current message/);
});

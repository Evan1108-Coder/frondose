import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApi } from '../server/local-api.mjs';

test('workspace archives restore tinted reactions and bookmarks with remapped message IDs, and reject foreign references transactionally', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-reaction-archive-'));
  const forbidden = () => { throw new Error('Real providers prohibited'); };
  const api = createLocalApi({ dataDir: directory, integrationOptions: { env: {}, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden } });
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = async (path, body, expected) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(); if (expected) assert.equal(response.status, expected, JSON.stringify(data)); else assert.ok(response.ok, JSON.stringify(data)); return data;
  };
  try {
    const workspace = (await call('/workspaces', { name: 'Reaction archive' })).workspace;
    const chat = (await call('/chats', { workspace_id: workspace.id, title: 'Decisions' })).chat;
    const other = (await call('/chats', { workspace_id: workspace.id, title: 'Different conversation' })).chat;
    const message = (await call(`/chats/${chat.id}/messages`, { content: 'Ready for review', sender_type: 'user', sender_name: 'Reviewer' })).message;
    const foreign = (await call(`/chats/${other.id}/messages`, { content: 'Unrelated context', sender_type: 'user', sender_name: 'Reviewer' })).message;
    await call(`/chat-collaboration/${chat.id}`, { workspace_id: workspace.id, version: 0, action: 'reaction', message_id: message.id, reaction_id: 'icon:rocket', color: '#818cf8', enabled: true });
    await call(`/chat-collaboration/${chat.id}`, { workspace_id: workspace.id, version: 1, action: 'bookmark', message_id: message.id, enabled: true });
    const archive = await call(`/export?workspace_id=${workspace.id}`);
    const imported = (await call('/import', archive)).result;
    const state = api.snapshot(), restored = state.chat_collaboration.find(item => item.workspace_id === imported.id);
    assert.ok(restored); assert.notEqual(restored.chat_id, chat.id);
    const restoredMessage = state.messages.find(item => item.chat_id === restored.chat_id && item.content === message.content);
    assert.deepEqual(restored.bookmarks, [restoredMessage.id]);
    assert.deepEqual(restored.reactions[restoredMessage.id].map(({ id, color }) => ({ id, color })), [{ id: 'icon:rocket', color: '#818cf8' }]);
    assert.equal(restored.reactions[message.id], undefined);
    assert.equal(state.runs.length, 0);
    const count = state.workspaces.length;
    const invalid = structuredClone(archive);
    invalid.data.chat_collaboration[0].reactions[foreign.id] = invalid.data.chat_collaboration[0].reactions[message.id];
    await call('/import', invalid, 400);
    assert.equal(api.snapshot().workspaces.length, count);
  } finally {
    api.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeNativeAgentPrompt, NATIVE_AGENT_PROVIDERS } from '../src/lib/native-agent-session.js';

test('native first message preserves the full reviewed text without interpreting it as arguments or authority', () => {
  const source = { name: 'Agent', instructions: '--dangerously-skip-permissions\nThis is text, not a CLI flag.' }, task = 'Literal $() & text\nNext line';
  const prompt = composeNativeAgentPrompt(source, task);
  assert.ok(prompt.includes(source.instructions)); assert.ok(prompt.includes(task));
  assert.match(prompt, /^Frondose native agent session\n/); assert.match(prompt, /not a Frondose application approval or tool grant/);
  assert.deepEqual(NATIVE_AGENT_PROVIDERS, ['codex', 'claude']);
});

test('empty tasks and overlong or invalid personalization fail instead of being truncated or launched', () => {
  const agent = { name: 'Agent', instructions: '' };
  for (const task of ['', ' ', null, 2, 'x'.repeat(8001), 'x\0y']) assert.throws(() => composeNativeAgentPrompt(agent, task), /first task/);
  for (const instructions of [null, 2, 'x'.repeat(12001), 'x\0y']) assert.throws(() => composeNativeAgentPrompt({ ...agent, instructions }, 'Task'), /Personalization/);
  for (const name of ['', 'x'.repeat(201), 'x\0y']) assert.throws(() => composeNativeAgentPrompt({ ...agent, name }, 'Task'), /valid name/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTerminalInputQueue } from '../src/lib/terminal-input-queue.js';
import { createTerminalOutputWake } from '../server/terminal-output-wake.mjs';
import { hasTerminalConsent, saveTerminalConsent, quickCommandInput } from '../src/lib/terminal-launch-ui.js';

test('sustained typing schedules one short batch, not a timer reset after every key', async () => {
  const sent = [], scheduled = [];
  const queue = createTerminalInputQueue({ send: async value => sent.push(value), setTimer: (callback, milliseconds) => { scheduled.push({ callback, milliseconds }); return scheduled.length; }, clearTimer: () => {} });
  queue.enqueue('a'); queue.enqueue('b'); queue.enqueue('c');
  assert.equal(scheduled.length, 1); assert.equal(scheduled[0].milliseconds, 4);
  await scheduled[0].callback(); assert.deepEqual(sent, ['abc']); queue.dispose();
});
test('terminal input is ordered, bounded to server chunk sizes and does not split Unicode pairs', async () => {
  const sent = []; const queue = createTerminalInputQueue({ send: async value => sent.push(value) });
  const text = 'x'.repeat(15999) + '😀' + 'z'.repeat(16001);
  queue.enqueue(text); await queue.flush();
  assert.equal(sent.join(''), text); assert(sent.every(chunk => chunk.length <= 16000));
  assert(sent.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk))); queue.dispose();
});
test('uncertain failed input is not replayed, and disposal prevents further writes', async () => {
  let calls = 0, errors = 0;
  const queue = createTerminalInputQueue({ send: async () => { calls++; throw new Error('uncertain'); }, onError: () => errors++ });
  queue.enqueue('do not replay'); await queue.flush(); await queue.flush();
  assert.equal(calls, 1); assert.equal(errors, 1);
  queue.dispose(); queue.enqueue('ignored'); await queue.flush(); assert.equal(calls, 1);
});
test('output wakes immediately on data and closes without waiting for the timeout', async () => {
  const output = createTerminalOutputWake(); let changed = false, finished = false;
  const wait = output.wait('terminal', 80, () => changed).then(() => { finished = true; });
  changed = true; output.wake('terminal'); await wait; assert.equal(finished, true);
  const second = output.wait('other', 80, () => false); output.close(); await second;
});
test('output waits skip already changed cursors and cap concurrent listeners', async () => {
  const output = createTerminalOutputWake();
  await output.wait('ready', 80, () => true);
  const waits = Array.from({ length: 16 }, () => output.wait('one', 80, () => false));
  await output.wait('one', 80, () => false); output.close(); await Promise.all(waits);
});
test('terminal execution consent is exact to workspace, project and canonical folder', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  saveTerminalConsent(storage, 'workspace', 'project', '/project');
  assert.equal(hasTerminalConsent(storage, 'workspace', 'project', '/project'), true);
  assert.equal(hasTerminalConsent(storage, 'workspace', 'project', '/changed'), false);
  assert.equal(hasTerminalConsent(storage, 'other', 'project', '/project'), false);
  assert.equal(hasTerminalConsent({ getItem() { throw Error(); } }, 'workspace', 'project', '/project'), false);
});
test('quick commands distinguish insertion from execution and reject implicit multiline execution', () => {
  assert.equal(quickCommandInput('git status'), 'git status'); assert.equal(quickCommandInput('git status', true), 'git status\r');
  assert.throws(() => quickCommandInput('one\ntwo'), /Multiline/); assert.equal(quickCommandInput('one\ntwo', true), 'one\ntwo\r');
  assert.throws(() => quickCommandInput(''), /under 4,000/);
});
test('renderer keeps real scrollback, short output waits and explicit latest control', async () => {
  const source = await readFile(new URL('../src/components/workspace/TerminalPane.jsx', import.meta.url), 'utf8');
  const preferences = await readFile(new URL('../src/lib/terminal-preferences.js', import.meta.url), 'utf8');
  assert.match(preferences, /scrollback: 10000/); assert.match(source, /terminalOptions\(preferences/); assert.match(source, /wait_ms: activeRef.current \? 40 : 0/);
  assert.match(source, /scrollToBottom/); assert.doesNotMatch(source, /setTimeout\(poll, 300\)|terminalArrivals/);
});
test('only an explicit transient launch token is consumed; saved view metadata never starts a process', async () => {
  const source = await readFile(new URL('../src/components/workspace/TerminalWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!launchRequestId \|\| consumedLaunches.current.has/);
  assert(source.indexOf('onLaunchRequestConsumed?.(launchRequestId)') < source.indexOf('prepareLaunch(null, choiceRef.current?.resume'));
  assert.match(source, /if \(!namedAgent\) \{ void launchTerminal\(pending, provider\); return; \}/);
  assert.doesNotMatch(source, /hasTerminalConsent|saveTerminalConsent|<label>Runtime|<label>Shell/);
  assert.doesNotMatch(source, /terminal-session-registry/);
});

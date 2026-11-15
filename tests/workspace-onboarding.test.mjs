import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onboardingKey, normalizeWorkspaceOnboarding, readWorkspaceOnboarding, saveWorkspaceOnboarding, normalizeTipPreferences, readTipPreferences, saveTipPreferences, remainingTipDuration, tourPosition, createRunNoticeTracker } from '../src/lib/workspace-onboarding.js';
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }; };

test('workspace setup is isolated, resumable and never embeds execution authority', () => {
  const storage = memory();
  assert.equal(readWorkspaceOnboarding('ws_one', storage).completed, false);
  saveWorkspaceOnboarding('ws_one', { step: 2, defaultCli: 'codex', command: 'codex --dangerously-bypass-approvals-and-sandbox', token: 'secret', enabledTools: true }, storage);
  const state = readWorkspaceOnboarding('ws_one', storage);
  assert.equal(state.step, 2); assert.equal(state.defaultCli, 'codex');
  assert.equal(state.command, undefined); assert.equal(state.token, undefined); assert.equal(state.enabledTools, undefined);
  assert.equal(readWorkspaceOnboarding('ws_two', storage).step, 0);
});
test('setup completion and skip are explicit and replay can retain the chosen preference', () => {
  const storage = memory();
  saveWorkspaceOnboarding('ws_one', { step: 3, completed: true, skipped: true, defaultCli: 'claude' }, storage);
  assert.equal(readWorkspaceOnboarding('ws_one', storage).skipped, true);
  const replay = saveWorkspaceOnboarding('ws_one', { step: 0 }, storage);
  assert.equal(replay.defaultCli, 'claude'); assert.equal(replay.completed, true); assert.equal(replay.step, 0);
});
test('untrusted setup preference values are bounded and malformed storage is recoverable', () => {
  for (const value of ['../workspace', '', null, 'x'.repeat(129)]) assert.throws(() => onboardingKey(value));
  assert.equal(normalizeWorkspaceOnboarding({ step: 1000 }).step, 3);
  assert.equal(normalizeWorkspaceOnboarding({ step: -1 }).step, 0);
  assert.equal(normalizeWorkspaceOnboarding({ step: 1.5 }).step, 0);
  assert.equal(normalizeWorkspaceOnboarding({ defaultCli: 'codex; rm -rf /', completed: 'true', notificationsEnabled: 'true', notificationSound: 'arbitrary-file' }).defaultCli, '');
  assert.equal(normalizeWorkspaceOnboarding({ completed: 'true' }).completed, false);
  assert.equal(readWorkspaceOnboarding('ws', { getItem() { return '{broken'; } }).step, 0);
});
test('tips preferences retain independent duration, reduced-movement and hidden categories', () => {
  const storage = memory();
  assert.equal(readTipPreferences(storage).duration, 8000);
  saveTipPreferences({ duration: 0, movement: false, dismissedCategories: ['workspace-folder', 'workspace-folder', '../secret', 4] }, storage);
  const prefs = readTipPreferences(storage);
  assert.equal(prefs.duration, 0); assert.equal(prefs.movement, false);
  assert.deepEqual(prefs.dismissedCategories, ['workspace-folder']);
  assert.equal(normalizeTipPreferences({ duration: -1 }).duration, 8000);
  assert.equal(normalizeTipPreferences({ duration: '5000' }).duration, 8000);
  assert.equal(normalizeTipPreferences({ dismissedCategories: Array.from({ length: 100 }, () => 'x') }).dismissedCategories.length, 1);
  assert.equal(readTipPreferences({ getItem() { throw Error('disabled'); } }).enabled, true);
});
test('tip timer pauses account only elapsed visible time and never become negative', () => {
  assert.equal(remainingTipDuration(8000, 100, 2100), 6000);
  assert.equal(remainingTipDuration(6000, 2200, 12200), 0);
  assert.equal(remainingTipDuration(8000, 200, 100), 8000);
});
test('tour placement keeps anchored guidance inside narrow or edge-adjacent viewports', () => {
  const narrow = tourPosition({ left: 300, top: 100, bottom: 130, width: 50 }, { width: 360, height: 800 });
  assert.ok(narrow.left >= 12); assert.ok(narrow.left + narrow.width <= 348); assert.equal(narrow.above, false);
  const bottom = tourPosition({ left: 10, top: 750, bottom: 790, width: 40 }, { width: 1440, height: 800 });
  assert.equal(bottom.above, true); assert.ok(bottom.top < 750); assert.ok(bottom.arrowLeft >= 20);
});
test('run notifications baseline existing history and emit only workspace status transitions', () => {
  const tracker = createRunNoticeTracker();
  const row = { id: 'run_one', workspace_id: 'ws_one', title: 'Task', agent_name: 'Codex', mode: 'live', status: 'running', updated_at: '2026-10-25T10:00:00Z' };
  assert.deepEqual(tracker.observe([{ ...row, status: 'completed' }], 'ws_one'), []);
  assert.deepEqual(tracker.observe([row], 'ws_one'), []);
  const result = tracker.observe([{ ...row, status: 'needs_input', updated_at: '2026-10-25T10:01:00Z' }], 'ws_one');
  assert.equal(result.length, 1); assert.equal(result[0].runId, row.id); assert.match(result[0].title, /needs input/);
  assert.deepEqual(tracker.observe([{ ...row, status: 'needs_input', updated_at: '2026-10-25T10:02:00Z' }], 'ws_one'), []);
  assert.equal(tracker.observe([{ ...row, status: 'completed', updated_at: '2026-10-25T10:03:00Z' }], 'ws_one').length, 1);
  assert.deepEqual(tracker.observe([{ ...row, status: 'completed' }], 'ws_two'), []);
});
test('run notification dedupe suppresses stale repeats, simulations and historical imports', () => {
  const tracker = createRunNoticeTracker();
  const row = { id: 'r', workspace_id: 'ws', status: 'running', mode: 'live', updated_at: 'a' };
  tracker.observe([row], 'ws');
  assert.equal(tracker.observe([{ ...row, status: 'needs_input' }], 'ws').length, 1);
  tracker.observe([row], 'ws');
  assert.deepEqual(tracker.observe([{ ...row, status: 'needs_input' }], 'ws'), []);
  assert.deepEqual(tracker.observe([{ ...row, id: 'imported_old', status: 'completed' }, { ...row, id: 'mock', mode: 'mock', status: 'completed' }], 'ws'), []);
});
test('many run transitions are bounded to eight notification requests per observation', () => {
  const tracker = createRunNoticeTracker();
  const runs = Array.from({ length: 500 }, (_, index) => ({ id: 'r_' + index, workspace_id: 'ws', status: 'running', updated_at: '2026-10-25T10:00:00Z' }));
  tracker.observe(runs, 'ws');
  assert.equal(tracker.observe(runs.map(run => ({ ...run, status: 'completed' })), 'ws').length, 8);
  assert.deepEqual(tracker.observe(runs.map(run => ({ ...run, status: 'completed' })), 'ws'), []);
});
test('setup CSS keeps its close control anchored and footer visible in short viewports', async () => {
  const css = await readFile(new URL('../src/components/workspace/welcome.css', import.meta.url), 'utf8');
  assert.match(css, /\.dialog\.workspace-welcome-dialog\s*\{[^}]*position:\s*relative/);
  const body = css.match(/\.workspace-welcome-body\s*\{([^}]+)\}/)[1];
  assert.match(body, /min-height:\s*0/); assert.match(body, /max-height:\s*calc\(100dvh - 140px\)/); assert.match(body, /overflow:\s*auto/);
  assert.match(css, /\.workspace-welcome-footer\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(css, /@media \(min-height: 640px\)/);
});

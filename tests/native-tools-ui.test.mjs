import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { restoreComposer, persistComposer } from '../src/lib/chats.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const activity = read('../src/components/NativeToolActivity.jsx');
const work = read('../src/views/Work.jsx'), chats = read('../src/views/Chats.jsx'), workflows = read('../src/views/Workflows.jsx');
const helpers = runInNewContext(`${activity.slice(activity.indexOf('const REQUEST_FIELDS'), activity.indexOf('export function NativeToolsChoice')).replaceAll('export function', 'function')}\n({ nativeRequestFields, nativeRequestEffect, nativeHistoryNotice });`);

test('Only missing reviewed opt-in errors become a neutral unavailable-history notice', () => {
  for (const code of ['context_not_reviewed', 'native_tools_not_reviewed']) {
    assert.equal(helpers.nativeHistoryNotice({ code }), 'Native tool history unavailable for this run: no matching reviewed opt-in was recorded.');
  }
  for (const error of [null, new Error('This run has no matching consumed Context Inspector review.'), { status: 403 }, { code: 'tool_access_denied' }, { code: 'context_scope_mismatch' }, { code: 'network_error' }]) assert.equal(helpers.nativeHistoryNotice(error), null);
  assert.match(activity, /historyNotice \? <p>\{historyNotice\}<\/p> : <ErrorMessage error=\{state.error\} \/>/);
  assert.match(activity, /!state.error && !state.calls.length && !state.requests.length/);
});

test('native review renders only allowlisted proposal fields and never runtime credentials', () => {
  const fields = helpers.nativeRequestFields({ kind: 'project_update', payload: { project_id: 'project', patch: { name: 'Updated', credential: 'secret' }, access_token: 'secret', run_secret: 'secret' } });
  assert.deepEqual(JSON.parse(JSON.stringify(fields)), [['project_id', 'project'], ['patch', { name: 'Updated' }]]);
  assert.equal(helpers.nativeRequestFields({ kind: 'unknown', payload: { secret: 'hidden' } }).length, 0);
  assert.match(helpers.nativeRequestEffect({ kind: 'permission_request' }), /does not grant access/);
  assert.match(helpers.nativeRequestEffect({ kind: 'agent_handoff' }), /does not launch/);
  assert.match(helpers.nativeRequestEffect({ kind: 'output_draft' }), /does not accept/);
  assert.doesNotMatch(activity, /request_json|payload_json|JSON\.stringify\(call|JSON\.stringify\(request,/);
});

test('native tool consent defaults off and is restored only for an uncertain original delivery', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const chat = { id: 'chat' }, composer = restoreComposer(chat, [], storage);
  assert.equal(composer.nativeTools, false);
  composer.nativeTools = true;
  persistComposer(chat.id, composer, storage);
  assert.equal(restoreComposer(chat, [], storage).nativeTools, false);
  composer.turn = 'uncertain-original';
  persistComposer(chat.id, composer, storage);
  assert.equal(restoreComposer(chat, [], storage).nativeTools, true);
  composer.turn = null;
  persistComposer(chat.id, composer, storage);
  assert.equal(restoreComposer(chat, [], storage).nativeTools, false);
});

test('retry recovery keeps native choice attached only to a pending retry identity', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const composer = restoreComposer({ id: 'chat' }, [], storage);
  composer.retryKeys = { source: 'pending-retry' };
  composer.retryNativeTools = { source: true, old: true };
  persistComposer('chat', composer, storage);
  assert.deepEqual(restoreComposer({ id: 'chat' }, [], storage).retryNativeTools, { source: true });
  delete composer.retryKeys.source;
  persistComposer('chat', composer, storage);
  assert.deepEqual(restoreComposer({ id: 'chat' }, [], storage).retryNativeTools, {});
});

test('native choices are present in both reviewed context and actual launches without auto approval', () => {
  for (const source of [activity, work, chats, workflows]) assert.doesNotThrow(() => transformSync(source, { loader: 'jsx', format: 'esm' }));
  assert.match(work, /\[nativeTools, setNativeTools\] = useState\(false\)/);
  assert.match(work, /native_tools: nativeTools/);
  assert.match(work, /native_tools: mode === "live" && nativeTools/);
  assert.equal((chats.match(/native_tools: composer.nativeTools === true/g) || []).length, 2);
  assert.match(chats, /native_tools: retryRequest.native_tools/);
  assert.match(chats, /composer.nativeTools = false/);
  assert.match(workflows, /checked=\{step.config.native_tools === true\}/);
  assert.match(workflows, /\.\.\.prepared.run_request, context_inspection_id: reviewed.id/);
  assert.match(activity, /body: \{ decision: decision.value, version: decision.request.version \}/);
  assert.match(activity, /Confirm approval/);
  assert.match(activity, /pending_review/);
  assert.match(activity, /return \(\) => controller.abort\(\)/);
  assert.doesNotMatch(activity, /POST.*\/api\/runs|setInterval|window\.confirm|window\.alert/);
});

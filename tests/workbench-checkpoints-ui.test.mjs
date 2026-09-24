import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { checkpointCapturePaths, checkpointComparison, checkpointDeliveryUncertain, checkpointFileMode, checkpointPreviewInvalidated, checkpointRestoreBlock, checkpointRestoreOutcome, checkpointRestorePayload, checkpointRestoreRequest } from '../src/lib/workbench-checkpoints.js';

const source = readFileSync(new URL('../src/components/WorkbenchCheckpoints.jsx', import.meta.url), 'utf8');
const workbench = readFileSync(new URL('../src/views/Workbench.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/workbench-checkpoints.css', import.meta.url), 'utf8');
const scope = { workspaceId: 'workspace', projectId: 'project' };
const saved = { path: 'src/a.js', state: 'present', content: 'before\n', sha256: 'a'.repeat(64), mode: 0o644 };
const current = { ...saved, content: 'after\n', sha256: 'b'.repeat(64) };
const preview = () => ({ checkpoint: { id: 'checkpoint', workspace_id: 'workspace', project_id: 'project', version: 1 }, preview_fingerprint: 'f'.repeat(64), limited: false, files: [{ path: saved.path, before: { ...saved }, current: { ...current }, operation: 'restore', restorable: true, patch: '@@ -1 +1 @@\n-after\n+before' }] });

test('Explicit capture parses bounded distinct relative paths without shell interpretation', () => {
  assert.deepEqual(checkpointCapturePaths(' src/a.js\r\n\nreadme.md '), { paths: ['src/a.js', 'readme.md'], error: '' });
  for (const input of ['', '/private/file', '../file', 'src/../file', 'src\\file', 'a\na', Array.from({ length: 201 }, (_, i) => `path${i}`).join('\n')]) assert.ok(checkpointCapturePaths(input).error);
  assert.equal(checkpointCapturePaths('src/space name.js').error, '');
});

test('Restore requires this exact project checkpoint, complete selected text, hashes, modes and a bounded preview', () => {
  assert.equal(checkpointRestoreBlock(preview(), scope, 'checkpoint'), '');
  assert.match(checkpointRestoreBlock(preview(), { ...scope, workspaceId: 'other' }, 'checkpoint'), /exact project checkpoint/);
  assert.match(checkpointRestoreBlock(preview(), scope, 'other'), /exact project checkpoint/);
  for (const patch of [{ preview_fingerprint: null }, { files: [] }, { files: Array(51).fill(preview().files[0]) }, { limited: true }]) assert.ok(checkpointRestoreBlock({ ...preview(), ...patch }, scope, 'checkpoint'));
  for (const patch of [{ restorable: false }, { operation: 'unknown' }, { current: { ...current, sha256: null } }, { current: { ...current, mode: null } }, { current: { ...current, mode: 0o1777 } }, { before: { ...saved, content: null } }, { current: { ...current, content: null } }]) assert.ok(checkpointRestoreBlock({ ...preview(), files: [{ ...preview().files[0], ...patch }] }, scope, 'checkpoint'));
});

test('Absent, empty and unchanged files remain distinct and no-op restores cannot be approved', () => {
  const data = preview();
  data.files[0].current = { path: saved.path, state: 'absent', sha256: null, mode: null }; data.files[0].operation = 'create';
  assert.equal(checkpointRestoreBlock(data, scope, 'checkpoint'), '');
  data.files[0].before = { ...saved, content: '' };
  assert.equal(checkpointRestoreBlock(data, scope, 'checkpoint'), '');
  data.files[0].current.sha256 = '';
  assert.match(checkpointRestoreBlock(data, scope, 'checkpoint'), /hashes are unavailable/);
  const unchanged = preview(); unchanged.files[0].operation = 'unchanged';
  assert.match(checkpointRestoreBlock(unchanged, scope, 'checkpoint'), /No restore is needed/);
});

test('Restore bodies pin only returned paths, current states, hashes, modes and immutable preview identity', () => {
  const data = preview();
  const payload = checkpointRestorePayload(data);
  assert.deepEqual(payload, { paths: [{ path: saved.path, expected_current_state: 'present', expected_current_sha256: current.sha256, expected_current_mode: 0o644 }], preview_fingerprint: data.preview_fingerprint, checkpoint_version: 1, confirmed: true });
  assert.equal(Object.hasOwn(payload, 'workspace_id'), false);
  assert.equal(Object.hasOwn(payload, 'project_id'), false);
  assert.equal(Object.hasOwn(payload, 'content'), false);
  const first = checkpointRestoreRequest(payload, null, () => 'restore-1');
  assert.equal(checkpointRestoreRequest(payload, first.request, () => assert.fail('same input should reuse key')).body.request_id, 'restore-1');
  assert.equal(checkpointRestoreRequest({ ...payload, preview_fingerprint: 'c'.repeat(64) }, first.request, () => 'restore-2').body.request_id, 'restore-2');
});

test('Shared diff preserves direction and file icons while unavailable files remain unavailable', () => {
  const data = preview(); data.files.push({ path: 'gone.sql', operation: 'delete', restorable: false, reason: 'Current file unreadable', patch: '' });
  const comparison = checkpointComparison(data);
  assert.equal(comparison.base, 'Current working files');
  assert.equal(comparison.files[0].patch, data.files[0].patch);
  assert.equal(comparison.files[1].status, 'deleted');
  assert.equal(comparison.files[1].unavailable, 'Current file unreadable');
  assert.match(comparison.notice, /Mode-only changes/);
  assert.equal(checkpointFileMode(0o644), '0644');
  assert.equal(checkpointFileMode(0), '0000');
  assert.equal(checkpointFileMode(null), 'Not recorded');
});

test('Only completed restores claim completion; partial, failed and crash states retain uncertainty', () => {
  assert.equal(checkpointRestoreOutcome({ status: 'completed' }).title, 'Selected-file restore completed');
  assert.match(checkpointRestoreOutcome({ status: 'partial' }).detail, /not an atomic rollback/);
  assert.match(checkpointRestoreOutcome({ status: 'failed' }).detail, /no automatic recovery/);
  assert.match(checkpointRestoreOutcome({ status: 'interrupted' }).title, /final file state unknown/);
  assert.match(checkpointRestoreOutcome({ status: 'in_progress' }).title, /not confirmed/);
  for (const result of [null, {}, { status: 'unknown' }]) assert.match(checkpointRestoreOutcome(result).title, /unavailable/);
  for (const error of [{ code: 'network_error' }, { code: 'timeout' }, { code: 'invalid_response' }, { status: 503 }]) assert.equal(checkpointDeliveryUncertain(error), true);
  for (const error of [null, { status: 409, code: 'stale_worktree' }, { status: 403 }]) assert.equal(checkpointDeliveryUncertain(error), false);
});

test('Definite stale-preview failures revoke confirmation, while uncertain delivery keeps the same request', () => {
  for (const code of ['stale_worktree', 'stale_checkpoint', 'root_changed']) assert.equal(checkpointPreviewInvalidated({ code }), true);
  for (const error of [null, { code: 'network_error' }, { code: 'timeout' }, { code: 'active_sessions' }, { status: 409 }]) assert.equal(checkpointPreviewInvalidated(error), false);
  assert.match(source, /if \(checkpointPreviewInvalidated\(problem\)\) \{ setConfirmed\(false\); setPreviewStale\(true\); \}/);
  assert.match(source, /const block = previewStale \? 'This preview is no longer current/);
  assert.match(source, /setPreviewStale\(false\); request.current = null/);
  assert.match(source, /disabled=\{!uncertain && \(!confirmed \|\| Boolean\(block\)\)\}/);
  assert.match(source, /uses read-only Git inspection/);
  assert.doesNotMatch(source, /create a commit, run a command/);
});

test('Workbench entry is lazy and capture does not happen during load, provider activity or navigation', () => {
  assert.match(workbench, /const WorkbenchCheckpoints = lazy/);
  assert.match(workbench, /\{checkpointsOpen \? <Suspense/);
  assert.match(workbench, /captureReady=\{Boolean\(root && git\?\.repository\)\}/);
  assert.match(workbench, /<FilesPanel key=\{checkpointRevision\}/);
  assert.match(source, /async function capture\(\)/);
  assert.match(source, /onSubmit=\{event => \{ event.preventDefault\(\); void capture\(\); \}\}/);
  assert.doesNotMatch(source, /\/api\/runs|startSession|\/authorize|demoRequest|setInterval|window.confirm|window.alert/);
});

test('Capture and restore expose limitations, active-session blocking, destructive consent and recovery boundaries', () => {
  for (const text of ['512,000 bytes', '2,000,000 bytes', '100 newest checkpoints', 'not a simultaneous filesystem snapshot', 'unignored untracked', 'existing parent folders', 'same pinned request and idempotency key', 'Stop active agent sessions and Workbench terminals', 'I explicitly authorize replacing file contents or modes', 'pre-restore recovery checkpoint', 'Opening it is read-only']) assert.ok(source.includes(text), text);
  assert.match(source, /Capture delivery is uncertain/);
  assert.match(source, /capture is not automatically retried/);
  assert.match(source, /Recorded absent · restoring deletes this path/);
  assert.match(source, /Absence is not an empty file/);
  assert.match(source, /Missing outcomes are not proof that the files stayed unchanged/);
  assert.match(source, /result.replayed/);
});

test('Preview and restore honor exact scope/path binding, same-request recovery and in-flight protection', () => {
  assert.match(source, /response.result.checkpoint.workspace_id !== scope.workspaceId/);
  assert.match(source, /JSON.stringify\(response.result.files.map\(file => file.path\).sort\(\)\) !== JSON.stringify\(\[\.\.\.selected\].sort\(\)\)/);
  assert.match(source, /if \(!uncertain\) request.current = checkpointRestoreRequest/);
  assert.match(source, /body: request.current.body/);
  assert.match(source, /if \(inFlight.current \|\| result \|\| !uncertain && \(!confirmed \|\| block\)\) return/);
  assert.match(source, /requestUpdateNavigation\(onClose\)/);
  assert.match(source, /useUnsavedUpdate\(!result && Boolean\(selected.length \|\| preview \|\| confirmed\), busy \|\| previewBusy\)/);
  assert.match(source, /result && !busy && !delivered.current/);
  assert.match(source, /pre_restore_checkpoint_id \|\| error\?\.details\?\.pre_restore_checkpoint_id/);
});

test('Reads abort and stale response keys clear data; responsive dialogs support focus and safe internal scrolling', () => {
  assert.match(source, /apiRequest\(path, \{ signal: controller.signal \}\)/);
  assert.match(source, /return \(\) => controller.abort\(\)/);
  assert.match(source, /state.path === path/);
  assert.match(source, /previewRequest.current\?\.abort\(\)/);
  assert.match(source, /phaseHeading.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /<ChangeReview key=\{preview.preview_fingerprint\}/);
  assert.match(source, /<CodeViewer content=\{file.content\}/);
  for (const code of [source, workbench]) assert.doesNotThrow(() => transformSync(code, { loader: 'jsx', format: 'esm' }));
  const scroll = css.match(/\.dialog\s*>\s*\.wb-checkpoints-dialog\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(scroll, /min-height:\s*0/); assert.match(scroll, /overflow:\s*auto/);
  assert.match(css, /focus-visible/); assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /flex:\s*1 1 100%; width:\s*100%/);
  assert.doesNotMatch(css, /#[a-f\d]{3,8}\b|animation:/i);
});

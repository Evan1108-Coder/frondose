import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { installRunContextStore, saveInspection, getInspection, consumeInspection, captureRunContext, readRunContext } from '../server/run-context-store.mjs';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  installRunContextStore(db); installRunContextStore(db);
  const scope = { actorId: 'actor', workspaceId: 'workspace' };
  const inspection = {
    prefix: 'Reference data\n', finalPrompt: 'INTERNAL PROTOCOL nonce-example\nReference data\nCurrent instruction:\nHello',
    manifest: { fingerprint: 'content-fingerprint', resolved: { workspace_id: 'workspace', agent_id: 'agent' }, included: [], excluded: [], current_instruction: { content: 'Hello' } },
    runtimeProtocol: 'INTERNAL PROTOCOL nonce-example', actionNonce: 'nonce-example',
  };
  const input = { workspace_id: 'workspace', prompt: 'Hello', contextPackIds: ['pack-2', 'pack-1'], includeMemory: true };
  const save = (extra = {}) => saveInspection(db, { ...scope, input, inspection, ...extra });
  return { db, scope, inspection, input, save };
}

test('preview save/get freezes normalized input, exact payload, runtime protocol and ownership', t => {
  const { db, scope, inspection, input, save } = fixture(t);
  const original = structuredClone(inspection), originalInput = structuredClone(input);
  const saved = save();
  assert.match(saved.id, /^inspection_/);
  assert.equal(Date.parse(saved.expires_at) - Date.parse(saved.created_at), 600000);
  assert.equal(saved.actor_id, scope.actorId); assert.equal(saved.workspace_id, scope.workspaceId);
  assert.equal(saved.consumed_run_id, null);
  inspection.finalPrompt = 'Changed after saving'; input.contextPackIds.push('another');
  saved.inspection.actionNonce = 'Changed returned copy';
  const restored = getInspection(db, saved.id, scope);
  assert.deepEqual(restored.inspection, original); assert.deepEqual(restored.input, originalInput);
  assert.equal(restored.inspection.finalPrompt, original.finalPrompt);
  assert.equal(restored.inspection.runtimeProtocol, original.runtimeProtocol);
  assert.equal(restored.inspection.actionNonce, original.actionNonce);
  assert.notEqual(save().id, saved.id);
});

test('preview ownership fails closed for missing IDs, actors, workspaces and mismatched manifest/input scope', t => {
  const { db, scope, inspection, input, save } = fixture(t);
  const saved = save();
  for (const owner of [{ ...scope, actorId: 'different' }, { ...scope, workspaceId: 'different' }]) assert.throws(() => getInspection(db, saved.id, owner), { code: 'context_inspection_unavailable', statusCode: 403 });
  assert.throws(() => getInspection(db, 'missing', scope), { code: 'context_inspection_unavailable', statusCode: 403 });
  for (const invalid of [undefined, {}, { actorId: 'actor' }, { workspaceId: 'workspace' }]) assert.throws(() => getInspection(db, saved.id, invalid), { code: 'invalid_run_context', statusCode: 400 });
  assert.throws(() => save({ workspaceId: 'other', input: { ...input, workspace_id: 'other' } }), { code: 'invalid_run_context' });
  assert.throws(() => save({ input: { ...input, workspace_id: 'other' } }), { code: 'invalid_run_context' });
  assert.throws(() => save({ input: { workspaceId: 'other' } }), { code: 'invalid_run_context' });
  assert.throws(() => save({ inspection: { ...inspection, manifest: { ...inspection.manifest, resolved: {} } } }), { code: 'invalid_run_context' });
  assert.equal(db.prepare('SELECT count(*) count FROM run_context_inspections').get().count, 1);
});

test('preview expires at ten minutes, while already-consumed same-run retries and run snapshots remain valid', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 8, 24) });
  const { db, scope, inspection, save } = fixture(t);
  const expired = save(), consumed = save();
  consumeInspection(db, consumed.id, 'run'); captureRunContext(db, 'run', inspection);
  t.mock.timers.tick(599999);
  assert.equal(getInspection(db, expired.id, scope).id, expired.id);
  t.mock.timers.tick(1);
  assert.throws(() => getInspection(db, expired.id, scope), { code: 'context_inspection_expired', statusCode: 409 });
  assert.throws(() => consumeInspection(db, expired.id, 'new-run'), { code: 'context_inspection_expired', statusCode: 409 });
  assert.equal(db.prepare('SELECT consumed_run_id FROM run_context_inspections WHERE id=?').get(expired.id).consumed_run_id, null);
  t.mock.timers.tick(365 * 24 * 60 * 60 * 1000);
  assert.equal(consumeInspection(db, consumed.id, 'run').consumed_run_id, 'run');
  assert.deepEqual(readRunContext(db, 'run').inspection, inspection);
});

test('consume is one-use, same-run idempotent, and rejects run reuse or conflicting captured context', t => {
  const { db, scope, inspection, save } = fixture(t);
  const first = save(), second = save();
  assert.deepEqual(consumeInspection(db, first.id, 'run-1'), consumeInspection(db, first.id, 'run-1'));
  assert.throws(() => consumeInspection(db, first.id, 'run-2'), { code: 'context_inspection_consumed', statusCode: 409 });
  assert.throws(() => consumeInspection(db, second.id, 'run-1'), { code: 'run_context_conflict', statusCode: 409 });
  assert.equal(getInspection(db, second.id, scope).consumed_run_id, null);
  assert.throws(() => consumeInspection(db, 'missing', 'run-1'), { code: 'context_inspection_unavailable' });
  captureRunContext(db, 'run-3', { ...inspection, finalPrompt: 'Other context' });
  assert.throws(() => consumeInspection(db, second.id, 'run-3'), { code: 'run_context_conflict' });
  assert.equal(getInspection(db, second.id, scope).consumed_run_id, null);
});

test('run snapshots are immutable, canonical-key-order idempotent and cannot diverge from consumed preview', t => {
  const { db, inspection, save } = fixture(t);
  const preview = save(); consumeInspection(db, preview.id, 'run');
  const first = captureRunContext(db, 'run', inspection);
  const reordered = Object.fromEntries(Object.entries(inspection).reverse());
  assert.deepEqual(captureRunContext(db, 'run', reordered), first);
  assert.equal(readRunContext(db, 'missing'), null);
  for (const change of [{ finalPrompt: 'Different prompt' }, { actionNonce: 'other nonce' }, { runtimeProtocol: 'other protocol' }]) assert.throws(() => captureRunContext(db, 'run', { ...inspection, ...change }), { code: 'run_context_conflict', statusCode: 409 });
  const next = save(); consumeInspection(db, next.id, 'run-2');
  assert.throws(() => captureRunContext(db, 'run-2', { ...inspection, finalPrompt: 'Unreviewed payload' }), { code: 'run_context_conflict' });
  assert.equal(readRunContext(db, 'run-2'), null);
  assert.throws(() => db.prepare('UPDATE run_context_snapshots SET inspection_json=? WHERE run_id=?').run('{}', 'run'), /immutable/);
  assert.throws(() => db.prepare('UPDATE run_context_inspections SET actor_id=? WHERE id=?').run('other', preview.id), /immutable/);
  assert.throws(() => db.prepare('UPDATE run_context_inspections SET expires_at=expires_at+1 WHERE id=?').run(preview.id), /immutable/);
  assert.throws(() => db.prepare('UPDATE run_context_inspections SET consumed_run_id=NULL WHERE id=?').run(preview.id), /already consumed/);
  assert.deepEqual(readRunContext(db, 'run'), first);
});

test('nested savepoints preserve outer transactions and roll back preview consumption with run capture', t => {
  const { db, scope, inspection, save } = fixture(t);
  const preview = save();
  db.exec('BEGIN');
  consumeInspection(db, preview.id, 'run'); captureRunContext(db, 'run', inspection);
  db.exec('ROLLBACK');
  assert.equal(getInspection(db, preview.id, scope).consumed_run_id, null);
  assert.equal(readRunContext(db, 'run'), null);
  db.exec('BEGIN');
  const temporary = save();
  consumeInspection(db, preview.id, 'run');
  assert.throws(() => consumeInspection(db, preview.id, 'different-run'), { code: 'context_inspection_consumed' });
  captureRunContext(db, 'run', inspection);
  db.exec('COMMIT');
  assert.equal(getInspection(db, temporary.id, scope).id, temporary.id);
  assert.equal(getInspection(db, preview.id, scope).consumed_run_id, 'run');
  assert.ok(readRunContext(db, 'run'));
});

test('prompt and UTF-8 manifest bounds reject oversize content with structured validation errors', t => {
  const { db, inspection, save } = fixture(t);
  assert.equal(save({ inspection: { ...inspection, finalPrompt: 'a'.repeat(100000) } }).inspection.finalPrompt.length, 100000);
  assert.throws(() => save({ inspection: { ...inspection, finalPrompt: 'a'.repeat(100001) } }), { code: 'invalid_run_context', errorCode: 'invalid_run_context', statusCode: 400 });
  assert.throws(() => save({ inspection: { ...inspection, manifest: { ...inspection.manifest, excessive: '界'.repeat(350000) } } }), { code: 'invalid_run_context' });
  assert.throws(() => save({ input: { excessive: 'a'.repeat(1048576) } }), { code: 'invalid_run_context' });
  assert.throws(() => captureRunContext(db, 'oversized', { ...inspection, finalPrompt: 'a'.repeat(100001) }), { code: 'invalid_run_context' });
  assert.equal(readRunContext(db, 'oversized'), null);
});

test('normalization rejects non-JSON values, cycles, sparse arrays and getters without invoking them', t => {
  const { save } = fixture(t);
  const cycle = {}; cycle.child = cycle;
  let invoked = false;
  const getter = { get value() { invoked = true; return 'not accepted'; } };
  const symbol = { [Symbol('hidden')]: 'secret' };
  const hidden = Object.defineProperty({}, 'hidden', { value: 'secret' });
  for (const value of [undefined, () => 1, NaN, Infinity, 1n, new Date(), cycle, getter, symbol, hidden, [, 'sparse']]) assert.throws(() => save({ input: { value } }), { code: 'invalid_run_context', statusCode: 400 });
  assert.throws(() => save({ input: { get workspace_id() { invoked = true; return 'workspace'; } } }), { code: 'invalid_run_context' });
  assert.throws(() => save({ inspection: { get finalPrompt() { invoked = true; return 'Hello'; } } }), { code: 'invalid_run_context' });
  assert.equal(invoked, false);
});

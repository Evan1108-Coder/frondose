import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contextRequestKey, contextInspectionState, contextSizeFacts, validContextInspection } from '../src/lib/context-inspector-ui.js';

const now = Date.parse('2026-09-24T12:00:00Z');
const inspection = { id: 'inspection', manifest: {}, finalPrompt: 'Current instruction:\nReview the evidence.', expires_at: '2026-09-24T12:05:00Z' };

test('inspection is usable only for the same request and before its exact expiry boundary', () => {
  assert.deepEqual(contextInspectionState(null, null, 'current', now), { stale: false, expired: false, usable: false });
  assert.deepEqual(contextInspectionState(inspection, 'same', 'same', now), { stale: false, expired: false, usable: true });
  assert.deepEqual(contextInspectionState(inspection, 'old', 'changed', now), { stale: true, expired: false, usable: false });
  assert.deepEqual(contextInspectionState(inspection, 'same', 'same', Date.parse(inspection.expires_at)), { stale: false, expired: true, usable: false });
  assert.equal(contextInspectionState({ ...inspection, expires_at: 'invalid' }, 'same', 'same', now).usable, false);
});

test('all normalized request changes, including context and permissions, invalidate request identity', () => {
  const request = { workspace_id: 'w', agent_id: 'a', prompt: 'Review', context_pack_ids: ['p1'], permission_mode: 'read-only', include_memory: true };
  const key = contextRequestKey(request);
  assert.equal(contextRequestKey({ ...request }), key);
  for (const patch of [{ agent_id: 'b' }, { prompt: 'Implement' }, { context_pack_ids: ['p2'] }, { permission_mode: 'workspace-write' }, { include_memory: false }, { model: 'different-model' }]) assert.notEqual(contextRequestKey({ ...request, ...patch }), key);
  assert.equal(contextRequestKey(undefined), 'null');
});

test('incomplete or malformed server captures never qualify for use', () => {
  assert.equal(validContextInspection(inspection), true);
  for (const patch of [{ id: null }, { id: '' }, { manifest: null }, { manifest: [] }, { finalPrompt: null }, { expires_at: undefined }]) assert.equal(validContextInspection({ ...inspection, ...patch }), false);
  assert.equal(validContextInspection(null), false);
});

test('size facts report only recorded exact units and never invent tokens from characters', () => {
  const manifest = { counts: { character_count_exact: true, total_characters: 4321, character_unit: 'UTF-16 code units', utf8_bytes: 5000, approximate_tokens: 1000 }, included: [{ status: 'included' }, { status: 'truncated' }], excluded: [{ status: 'excluded' }] };
  assert.deepEqual(contextSizeFacts(manifest), { exactCharacters: 4321, characterUnit: 'UTF-16 code units', utf8Bytes: 5000, included: 2, excluded: 1, truncated: 1 });
  assert.deepEqual(contextSizeFacts(), { exactCharacters: null, characterUnit: 'UTF-16 code units', utf8Bytes: null, included: 0, excluded: 0, truncated: 0 });
  assert.equal(contextSizeFacts({ counts: { approximate_characters: 5000 } }).exactCharacters, null);
  assert.equal(contextSizeFacts({ counts: { character_count_exact: true, total_characters: -1, utf8_bytes: '100' } }).utf8Bytes, null);
  assert.equal(contextSizeFacts({ counts: { character_count_exact: true, total_characters: 0, utf8_bytes: 0 } }).exactCharacters, 0);
});

test('Context Inspector has explicit inspect/use actions, aborts stale requests, and never launches work', () => {
  const source = readFileSync(new URL('../src/components/ContextInspector.jsx', import.meta.url), 'utf8');
  assert.match(source, /apiRequest\('\/api\/context\/inspect', \{ method: 'POST', body: request, signal: controller.signal \}\)/);
  assert.match(source, /onClick=\{inspect\}/);
  assert.match(source, /onClick=\{useContext\}/);
  assert.match(source, /latest\.current\.requestKey !== requestedKey/);
  assert.match(source, /active\.current\?\.abort\(\)/);
  assert.match(source, /latest\.current\.onInvalidated\?\.\(\)/);
  assert.match(source, /latest\.current\.onReviewed\?\.\(inspection\)/);
  assert.match(source, /disabled=\{!usable \|\| state.reviewed \|\| !onReviewed\}/);
  assert.doesNotMatch(source, /startRun|startSession|spawnProcess|talvoriActions/);
  assert.doesNotMatch(source.slice(source.indexOf('useEffect(()'), source.indexOf('async function inspect')), /apiRequest/); // Network work remains in the explicit inspect handler.
});

test('source and provider boundaries remain visible with keyboard-readable raw text', () => {
  const source = readFileSync(new URL('../src/components/ContextInspector.jsx', import.meta.url), 'utf8');
  assert.match(source, /Exact Talvori-supplied prompt/);
  assert.match(source, /Provider-owned system instructions are not visible here/);
  assert.match(source, /project tools may read additional files within the access you explicitly grant/);
  assert.match(source, /Token count is not estimated/);
  assert.match(source, /Unavailable content is not revealed/);
  assert.match(source, /source\.status === 'excluded'/);
  assert.match(source, /<pre tabIndex=\{0\}/);
  assert.match(source, /role="status"/);
  assert.match(source, /window\.removeEventListener\('focus', expire\)/);
  assert.match(source, /document\.removeEventListener\('visibilitychange', expire\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { KNOWLEDGE_CONFLICT_DECISIONS, conflictKnowledgeChoices, knowledgeConflictPairError, knowledgeConflictDecisionBlock, knowledgeConflictDecisionEffect, knowledgeConflictRequest, knowledgeConflictDeliveryUncertain } from '../src/lib/knowledge-conflicts.js';

const source = readFileSync(new URL('../src/components/KnowledgeConflicts.jsx', import.meta.url), 'utf8');
const library = readFileSync(new URL('../src/views/Library.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/knowledge-conflicts.css', import.meta.url), 'utf8');
const entry = (id, patch = {}) => ({ id, workspace_id: 'workspace', title: `Entry ${id}`, state: 'approved', version: 1, content: `Exact ${id}\n`, archived_at: null, ...patch });

test('Conflict choices include only accessible input rows with active approved same-workspace versioned content', () => {
  const rows = [entry('b'), entry('a'), entry('other', { workspace_id: 'other' }), entry('draft', { state: 'draft' }), entry('old', { state: 'superseded' }), entry('archived', { archived_at: '2026-09-24' }), entry('missing', { content: null }), entry('unversioned', { version: undefined })];
  assert.deepEqual(conflictKnowledgeChoices(rows, 'workspace').map(row => row.id), ['a', 'b']);
  assert.equal(rows[0].id, 'b');
  assert.deepEqual(conflictKnowledgeChoices(null, 'workspace'), []);
  assert.equal(conflictKnowledgeChoices([entry('empty', { content: '' })], 'workspace').length, 1);
});

test('Manual comparison requires two distinct current eligible entries in the requested workspace', () => {
  assert.equal(knowledgeConflictPairError(entry('a'), entry('b'), 'workspace'), '');
  assert.match(knowledgeConflictPairError(entry('a'), entry('a'), 'workspace'), /different/);
  assert.match(knowledgeConflictPairError(null, entry('b'), 'workspace'), /Choose two/);
  assert.match(knowledgeConflictPairError(entry('a'), entry('b', { state: 'draft' }), 'workspace'), /no longer eligible/);
  assert.match(knowledgeConflictPairError(entry('a'), entry('b'), 'another'), /no longer eligible/);
});

test('Missing snapshot content is unavailable, not empty; stale and resolved reports block all fresh decisions', () => {
  const detail = { conflict: { status: 'open', freshness: 'current' }, left: { content: '' }, right: { content: 'text' } };
  assert.equal(knowledgeConflictDecisionBlock(detail), '');
  assert.match(knowledgeConflictDecisionBlock({ ...detail, left: { content: null } }), /unavailable/);
  assert.match(knowledgeConflictDecisionBlock(null), /unavailable/);
  assert.match(knowledgeConflictDecisionBlock({ ...detail, conflict: { status: 'open', freshness: 'stale' } }), /current entries and create a new report/);
  assert.match(knowledgeConflictDecisionBlock({ ...detail, conflict: { status: 'resolved', freshness: 'current' } }), /already has a recorded decision/);
});

test('Decisions describe human review and future inclusion without claiming deletion, merging or verification', () => {
  assert.deepEqual(KNOWLEDGE_CONFLICT_DECISIONS.map(([id]) => id), ['keep_both', 'supersede_left', 'supersede_right']);
  assert.match(knowledgeConflictDecisionEffect('keep_both'), /not an automatic verification/);
  for (const side of ['left', 'right']) {
    const description = knowledgeConflictDecisionEffect(`supersede_${side}`);
    assert.match(description, new RegExp(`The ${side} entry becomes superseded`));
    assert.match(description, /not deleted/); assert.match(description, /Earlier captured context and runs keep their original text/);
  }
  assert.match(knowledgeConflictDecisionEffect(''), /Nothing is merged, deleted or sent to an agent/);
});

test('Idempotent requests retain identity only for the same exact pinned payload', () => {
  const body = { workspace_id: 'workspace', left_id: 'a', left_version: 1, right_id: 'b', right_version: 2, reason: 'Different rule' };
  const first = knowledgeConflictRequest(body, null, () => 'first');
  assert.deepEqual(first.body, { ...body, request_id: 'first' });
  assert.equal(knowledgeConflictRequest(body, first.request, () => assert.fail('should reuse key')).body.request_id, 'first');
  assert.equal(knowledgeConflictRequest({ ...body, left_version: 2 }, first.request, () => 'new-version').body.request_id, 'new-version');
  assert.equal(knowledgeConflictRequest({ ...body, reason: 'New reason' }, first.request, () => 'new-reason').body.request_id, 'new-reason');
  for (const error of [{ code: 'network_error' }, { code: 'timeout' }, { status: 503 }]) assert.equal(knowledgeConflictDeliveryUncertain(error), true);
  for (const error of [null, { code: 'stale_knowledge', status: 409 }, { status: 403 }, { status: 400 }]) assert.equal(knowledgeConflictDeliveryUncertain(error), false);
});

test('Library entry is lazy and opening conflict history never launches providers or scans automatically', () => {
  assert.match(library, /const KnowledgeConflicts = lazy/);
  assert.match(library, /tab === 'knowledge' \? <Button[^\n]+Review conflicts/);
  assert.match(library, /\{conflictsOpen \? <Suspense/);
  assert.match(library, /key=\{workspace.id\} workspaceId=\{workspace.id\}/);
  assert.match(source, /\[scanRevision, setScanRevision\] = useState\(0\)/);
  assert.match(source, /view.type === 'list' && scanRevision \?/);
  assert.match(source, /onClick=\{\(\) => setScanRevision\(value => value \+ 1\)\}>Scan possible conflicts/);
  assert.match(source, /setScanRevision\(0\); setView\(next\)/);
  assert.doesNotMatch(source, /\/api\/runs|startSession|\/authorize|setInterval|confidence_percent|demoRequest|window.confirm|window.alert/);
});

test('Detection and lists expose bounded literal evidence rather than verified contradictions or total memory coverage', () => {
  assert.match(source, /same literal title, scope and type with different content/);
  assert.match(source, /does not detect or verify semantic contradictions/);
  assert.match(source, /does not establish that the knowledge is consistent/);
  for (const field of ['scanned_count', 'scan_limit', 'pair_limit', 'scan_truncated', 'pairs_truncated', 'has_more']) assert.match(source, new RegExp(`\\.${field}`));
  assert.match(source, /older reports are not shown here/);
  assert.doesNotMatch(source, /Load more|Load older|cursor:/);
});

test('Conflict reads abort on scope changes; stale requests cannot display data for a previous path', () => {
  assert.match(source, /new AbortController/);
  assert.match(source, /apiRequest\(path, \{ signal: controller.signal \}\)/);
  assert.match(source, /return \(\) => controller.abort\(\)/);
  assert.match(source, /state.key === path/);
  assert.match(source, /detail.conflict.workspace_id !== workspaceId \|\| detail.conflict.id !== id/);
});

test('Reporting and decisions require explicit current-version review; saved text and actor attribution are preserved', () => {
  assert.match(source, /left_id: left\?\.id, left_version: left\?\.version, right_id: right\?\.id, right_version: right\?\.version/);
  assert.match(source, /confirmedPair === pairKey/);
  assert.match(source, /decision, rationale: rationale.trim\(\), confirmed: true/);
  assert.match(source, /\[decision, setDecision\] = useState\(''\)/);
  assert.match(source, /\[confirmed, setConfirmed\] = useState\(false\)/);
  assert.match(source, /Compare current entries/);
  assert.match(source, /typeof entry.content === 'string'/);
  assert.match(source, /<DocumentContent content=\{entry.content\}/);
  assert.match(source, /<RevisionComparison before=\{left.content\} after=\{right.content\}/);
  assert.match(source, /actor=\{detail.conflict.reported_by\}/);
  assert.match(source, /actor=\{decision\?\.reviewed_by\}/);
  assert.match(source, /exact snapshots captured when the report was created/);
  assert.match(source, /left_after_version/);
  assert.match(source, /Sources match the recorded decision/);
  assert.match(source, /Snapshots at report time/);
});

test('Mutations protect pending work and retry an uncertain delivery with the original body', () => {
  assert.match(source, /if \(inFlight.current \|\| saved\) return/);
  assert.match(source, /if \(!uncertain\)/);
  assert.match(source, /apiRequest\(attempt.current.path, \{ method: 'POST', body: attempt.current.body \}\)/);
  assert.match(source, /useUnsavedUpdate\(dirty, mutation.busy/);
  assert.match(source, /requestUpdateNavigation\(onClose\)/);
  assert.match(source, /const dirty = !mutation.saved/);
  assert.match(source, /mutation.saved && !mutation.busy && !delivered.current/);
  assert.match(source, /Retry same report/); assert.match(source, /Retry same decision/);
  assert.match(source, /fields are locked/);
});

test('Dialog surfaces compile and preserve focus, keyboard scroll, mobile wrapping and theme tokens', () => {
  for (const code of [source, library]) assert.doesNotThrow(() => transformSync(code, { loader: 'jsx', format: 'esm' }));
  const scroll = css.match(/\.dialog\s*>\s*\.knowledge-conflicts-dialog\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(scroll, /min-height:\s*0/); assert.match(scroll, /overflow:\s*auto/);
  assert.match(source, /previousView.current === viewKey/);
  assert.match(source, /focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /bodyRef.current.scrollTop = 0/);
  assert.match(source, /tabIndex=\{0\} role="region" aria-label/);
  assert.match(css, /focus-visible/); assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /flex:\s*1 1 100%; width:\s*100%/);
  assert.doesNotMatch(css, /#[a-f\d]{3,8}\b|animation:/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { agentContentChanges, agentContentField, agentContentRequestBody, selectedAgentContentFields } from '../src/lib/agent-profile-history.js';

const source = readFileSync(new URL('../src/components/AgentProfileHistory.jsx', import.meta.url), 'utf8');
const roster = readFileSync(new URL('../src/views/AgentRoster.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/agent-profile-history.css', import.meta.url), 'utf8');

test('Profile content restore allowlist excludes identity, connection and authority fields', () => {
  assert.deepEqual(selectedAgentContentFields(['instructions', 'provider', 'model', 'name', 'role', 'reasoning_effort', 'working_directory', 'context_source_ids', 'memory_policy', 'permission_policy', 'status', 'provider_connection_id', 'description', 'output_behavior', 'instructions']), ['role', 'description', 'instructions', 'output_behavior']);
  assert.deepEqual(selectedAgentContentFields(null), []);
  assert.equal(agentContentField({ provider: 'codex' }, 'provider').available, false);
});

test('Unavailable historical content never becomes empty text or a deletion', () => {
  const unavailable = agentContentChanges(null, { role: '', description: '', instructions: 'Known', output_behavior: '' });
  assert.ok(unavailable.every(field => field.state === 'unavailable'));
  assert.deepEqual(agentContentField({ instructions: '' }, 'instructions'), { available: true, value: '' });
  assert.deepEqual(agentContentField({ instructions: null }, 'instructions'), { available: false, value: null });
  const changed = agentContentChanges({ instructions: 'Earlier' }, { instructions: '' }).find(field => field.id === 'instructions');
  assert.equal(changed.state, 'changed'); assert.equal(changed.after.value, '');
});

test('Field comparison preserves exact whitespace and unchanged text', () => {
  const before = { role: 'Builder', description: '', instructions: 'First\n', output_behavior: 'diff' };
  const after = { ...before, instructions: 'First' };
  assert.deepEqual(agentContentChanges(before, after).map(field => field.state), ['unchanged', 'unchanged', 'changed', 'unchanged']);
});

test('Profile restore request retries retain an ID only for identical pinned input', () => {
  const payload = { current_version: 5, source_version: 2, source_hash: 'hash', fields: ['instructions'], confirmed: true };
  const first = agentContentRequestBody(payload, null, () => 'one');
  assert.equal(agentContentRequestBody(payload, first.request, () => 'never').body.request_id, 'one');
  assert.equal(agentContentRequestBody({ ...payload, current_version: 6 }, first.request, () => 'two').body.request_id, 'two');
  assert.equal(agentContentRequestBody({ ...payload, fields: ['role'] }, first.request, () => 'three').body.request_id, 'three');
});

test('History loads lazily in bounded pages with cancellation and stable version IDs', () => {
  assert.doesNotThrow(() => transformSync(source, { loader: 'jsx', format: 'esm' }));
  assert.doesNotThrow(() => transformSync(roster, { loader: 'jsx', format: 'esm' }));
  assert.match(roster, /const AgentProfileHistory = lazy/);
  assert.match(roster, /\{historyOpen \? <Suspense/);
  assert.match(source, /content-history\?limit=20/);
  assert.match(source, /before_version: String\(state.result.next_before_version\)/);
  assert.match(source, /new Map\(\(old.result\?\.versions/);
  assert.match(source, /generation.current === current/);
  assert.match(source, /controller.abort\(\); pageRequest.current\?\.abort\(\)/);
  assert.doesNotMatch(source, /setInterval|demoRequest|window.confirm/);
});

test('Comparison uses shared code appearance and preserves unavailable versus recorded empty values', () => {
  assert.match(source, /<ChangeReview comparison=\{comparison\}/);
  assert.match(source, /textPatch\(left.value, right.value\)/);
  assert.match(source, /source\?\.restricted \? null : source\?\.content/);
  assert.match(source, /No additions or deletions are inferred/);
  assert.match(source, /Recorded empty value — this field will be cleared/);
  assert.match(source, /Source version/);
  assert.match(source, /Compare with version/);
  assert.match(source, /Field change summary/);
});

test('Restore is explicit, field-selective and pinned, with no authority fields or provider launch', () => {
  assert.match(source, /\[selectedFields, setSelectedFields\] = useState\(\[\]\)/);
  assert.match(source, /\[confirmed, setConfirmed\] = useState\(false\)/);
  assert.match(source, /current_version: currentVersion, source_version: source.version, source_hash: source.source_sha256, fields, confirmed: true/);
  assert.match(source, /if \(!confirmed \|\| !preview \|\| !canPrepare \|\| inFlight.current \|\| saved\) return/);
  assert.match(source, /Save as new version/);
  assert.match(source, /does not roll back files or workspace changes/);
  assert.doesNotMatch(source, /provider_connection_id:|permission_policy:|working_directory:|model:|reasoning_effort:|instructions:|\/api\/runs|startSession/);
});

test('Restoration respects stale state, source availability and legacy unknown authors', () => {
  assert.match(source, /agent.version > currentVersion/);
  assert.match(source, /latest_observed_version !== currentVersion/);
  assert.match(source, /source\?\.source_sha256 && !source.restricted && currentContent && !stale/);
  assert.match(source, /Author not recorded \(legacy \/ unknown\)/);
  assert.match(source, /Recorded server actor/);
  assert.match(source, /version.restored_from.version/);
});

test('Restore selection is guarded and save releases its own dirty guard before closing', () => {
  assert.match(source, /const dirty = !saved/);
  assert.match(source, /useUnsavedUpdate\(dirty, busy\)/);
  assert.match(source, /requestUpdateNavigation\(onClose\)/);
  assert.match(source, /saved && !busy && !delivered.current/);
  assert.match(source, /saved.restored_version\?\.version \?\? saved.current_version/);
  assert.match(source, /requestUpdateNavigation\(\(\) => \{ setSelectedFields\(\[\]\)/);
});

test('History and restore dialogs scroll and wrap safely on small screens', () => {
  const scroll = css.match(/\.dialog\s*>\s*\.agent-profile-history-dialog\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(scroll, /flex:\s*1 1 auto/); assert.match(scroll, /min-height:\s*0/); assert.match(scroll, /overflow:\s*auto/);
  assert.match(css, /\.form-submit-row\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /flex:\s*1 1 100%; width:\s*100%/);
  assert.match(css, /focus-visible/);
  assert.doesNotMatch(css, /#[a-f\d]{3,8}\b|animation:/i);
});

test('Preview mode transitions focus their heading and scroll only the dialog without motion', () => {
  const transition = source.match(/useEffect\(\(\) => \{\s*if \(previousPreview.current === preview\) return;([\s\S]*?)\}, \[preview\]\)/)?.[1] || '';
  assert.match(transition, /previousPreview.current = preview/);
  assert.match(transition, /preview \? previewHeading.current : restoreHeading.current/);
  assert.match(transition, /heading\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(transition, /body.scrollTop = preview \? 0/);
  assert.match(transition, /heading.getBoundingClientRect\(\).top - body.getBoundingClientRect\(\).top/);
  assert.match(source, /<div ref=\{bodyRef\} className="agent-profile-history-dialog"/);
  assert.match(source, /<h3 ref=\{previewHeading\} tabIndex=\{-1\}/);
  assert.match(source, /<legend ref=\{restoreHeading\} tabIndex=\{-1\}/);
  assert.doesNotMatch(transition, /window\.|document\.|scrollIntoView|smooth|requestAnimationFrame|setTimeout/);
});

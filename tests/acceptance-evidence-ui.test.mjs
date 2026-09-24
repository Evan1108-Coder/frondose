import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { acceptanceApprovalReason, acceptanceRequestBody, acceptanceStateKey, acceptanceStatusLabel, currentAcceptanceArtifacts } from '../src/lib/acceptance-evidence.js';

const component = readFileSync(new URL('../src/components/AcceptanceEvidence.jsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/components/RouteWorkflow.jsx', import.meta.url), 'utf8');
const library = readFileSync(new URL('../src/views/Library.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/acceptance-evidence.css', import.meta.url), 'utf8');
const output = { id: 'out', task_id: 'route', version: 3, current_version: 2 }, version = { id: 'v2', number: 2 }, agreement = { version: 4 };
const result = () => ({ policy: { policy_version: 2 }, output: { id: 'out', version: 3, current_version: 2, output_version_id: 'v2' }, coverage: { agreement_version: 4, output_version_id: 'v2', total: 1, passed: 1, failed: 0, missing: 0, complete: true, cases: [{ criterion_id: 'criterion', status: 'passed', assessment_id: 'assessment' }] } });
const reason = state => acceptanceApprovalReason(state, output, version, agreement);

test('Acceptance approval fails closed while policy or evidence cannot be read', () => {
  assert.match(reason({ loading: true }), /Checking/);
  assert.match(reason({ error: new Error('Access revoked') }), /unavailable/);
  assert.match(reason({}), /unavailable/);
  assert.equal(reason({ result: result() }), null);
});

test('Approval rejects earlier output, archived output and stale agreement snapshots', () => {
  assert.match(acceptanceApprovalReason({ result: result() }, output, { id: 'v1', number: 1 }, agreement), /Only the current/);
  assert.match(acceptanceApprovalReason({ result: result() }, { ...output, archived_at: 'now' }, version, agreement), /Restore/);
  for (const patch of [{ id: 'other' }, { version: 2 }, { output_version_id: 'v1' }]) {
    const value = result(); Object.assign(value.output, patch); assert.match(reason({ result: value }), /output changed/);
  }
  for (const patch of [{ agreement_version: 3 }, { output_version_id: 'v1' }]) {
    const value = result(); Object.assign(value.coverage, patch); assert.match(reason({ result: value }), /agreement or output changed/);
  }
});

test('Coverage needs every current criterion, a server assessment ID and explicit complete state', () => {
  for (const status of ['failed', 'missing', 'stale', 'unavailable', 'invented']) {
    const value = result(); value.coverage.cases[0].status = status; assert.match(reason({ result: value }), /Every current criterion/);
  }
  for (const patch of [{ total: 2 }, { complete: false }, { cases: [] }, { cases: [{ status: 'passed' }] }]) {
    const value = result(); Object.assign(value.coverage, patch); assert.match(reason({ result: value }), /Every current criterion/);
  }
  const empty = result(); empty.coverage.total = 0; assert.match(reason({ result: empty }), /at least one/);
});

test('Legacy policy preserves manual review without relabeling old ticks as v2 evidence', () => {
  const legacy = result(); legacy.policy.policy_version = 1; legacy.coverage = null;
  assert.equal(reason({ result: legacy }), null);
  assert.equal(acceptanceApprovalReason({ loading: true }, { ...output, task_id: null }, version, undefined), null);
  assert.match(route, /Legacy manual checklist/);
  assert.match(route, /const legacyChecks = !evidencePolicy.loading/);
  assert.match(component, /old ticks and approvals do not count as new evidence/);
});

test('Evidence requests retain idempotency for unchanged retries and renew it for edits', () => {
  const first = acceptanceRequestBody({ decision: 'passed', artifact: { type: 'output_version', id: 'v2' } }, null, () => 'one');
  const retry = acceptanceRequestBody({ decision: 'passed', artifact: { type: 'output_version', id: 'v2' } }, first.request, () => 'never');
  assert.equal(retry.body.request_id, 'one');
  const changed = acceptanceRequestBody({ decision: 'failed' }, first.request, () => 'two');
  assert.equal(changed.body.request_id, 'two');
});

test('State keys invalidate evidence for relevant output and agreement changes', () => {
  const initial = acceptanceStateKey(output, agreement);
  for (const patch of [{ id: 'other' }, { version: 4 }, { current_version: 3 }, { task_id: 'other' }]) assert.notEqual(acceptanceStateKey({ ...output, ...patch }, agreement), initial);
  assert.notEqual(acceptanceStateKey(output, { version: 5 }), initial);
  assert.equal(acceptanceStatusLabel('unknown-score'), 'Missing');
});

test('Artifact choices are server-returned readable output versions or terminal events only', () => {
  const allowed = { type: 'output_version', id: 'v2', content: 'Recorded text' };
  assert.deepEqual(currentAcceptanceArtifacts({ available_artifacts: [allowed, { type: 'run_event', id: 'event', content: 'Result' }, { type: 'prompt', id: 'x', content: 'Do not use' }, { type: 'run_event', id: 'hidden' }, { type: 'run_event', content: 'Missing ID' }] }), [allowed, { type: 'run_event', id: 'event', content: 'Result' }]);
  assert.match(component, /artifact: \{ type: artifact.type, id: artifact.id \}/);
  assert.match(component, /output_version: pinned.outputVersion, output_version_id: pinned.outputVersionId, agreement_version: pinned.agreementVersion/);
  assert.doesNotMatch(component, /content: rationale|evidence: rationale|artifact_content:/);
});

test('Policy enable and assessments are explicit human actions, never provider launches', () => {
  for (const source of [component, route, library]) assert.doesNotThrow(() => transformSync(source, { loader: 'jsx', format: 'esm' }));
  assert.match(component, /route_version: baseVersion, confirmed: true/);
  assert.match(component, /It cannot be disabled or downgraded/);
  assert.match(component, /useState\(false\).*useState\(false\)/);
  assert.match(component, /Your assessment/);
  assert.match(library, /decision === 'approved' && Boolean\(approvalReason\)/);
  assert.match(library, /if \(decision === 'approved' && approvalReason\) return/);
  assert.doesNotMatch(component, /\/api\/runs|\/runs['"`]|startSession|setInterval|window.confirm|demoRequest/);
});

test('Fetches cancel on scope changes and saved dirty forms release before closing', () => {
  assert.match(component, /return \(\) => controller.abort\(\)/);
  assert.match(component, /state.key === activeKey/);
  assert.match(component, /useUnsavedUpdate\(dirty, busy\)/);
  assert.match(component, /requestUpdateNavigation\(onClose\)/);
  assert.match(component, /saved && !busy && !delivered.current/);
  assert.match(component, /setAssessment\(\{ criterion: item, result \}\)/);
});

test('History is immutable, bounded and distinguishes server actor from typed attribution', () => {
  assert.match(component, /500 recent readable assessments/);
  assert.match(component, /100 recent readable immutable snapshots/);
  assert.match(component, /Historical \/ superseded — does not count/);
  assert.match(component, /assessment_id/);
  assert.match(component, /snapshot.output_version_id/);
  assert.match(library, /Reviewer display name/);
  assert.match(library, /Server actor: \{r.reviewer_id \|\| 'Not recorded \(legacy \/ imported\)'\}/);
  assert.match(library, /typing a name cannot impersonate that actor/);
  assert.doesNotMatch(component, /reviewer_id:|reviewer_name:/);
});

test('New evidence dialogs have viewport-bound scrolling, wrapping mobile actions and theme tokens', () => {
  const scroll = css.match(/\.dialog\s*>\s*\.acceptance-evidence-dialog\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(scroll, /flex:\s*1 1 auto/); assert.match(scroll, /min-height:\s*0/); assert.match(scroll, /overflow:\s*auto/);
  assert.match(css, /\.acceptance-evidence-dialog\s+\.form-submit-row\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /flex:\s*1 1 100%; width:\s*100%/);
  assert.match(css, /focus-visible/);
  assert.doesNotMatch(css, /#[a-f\d]{3,8}\b|animation:/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { skillCoverageRows, skillEvaluationsComparable, skillPreparationUsable, skillPublicationReason, skillEditorFields, skillEditorPayload } from '../src/lib/skills.js';

const source = readFileSync(new URL('../src/components/SkillEvaluation.jsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/views/Skills.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/skill-evaluation.css', import.meta.url), 'utf8');

test('Skill v2 editor preserves stable case IDs without copying runtime evidence', () => {
  const fields = skillEditorFields({ name: 'Case', test_cases: [{ id: 'case_1234567890abcdef1234', name: 'Input', inputs: {}, expected_output: 'Result' }], evaluations: [{ fake: 'never import' }] });
  const payload = skillEditorPayload(fields);
  assert.equal(payload.test_cases[0].id, 'case_1234567890abcdef1234');
  assert.equal(Object.hasOwn(payload, 'evaluations'), false);
  fields.test_cases.push({ name: 'New', inputs_text: '{}', expected_output: 'New result' });
  assert.equal(Object.hasOwn(skillEditorPayload(fields).test_cases[1], 'id'), false);
});

test('Skill case coverage stays Missing until a server-recorded matching case result exists', () => {
  const skill = { version: 2, test_cases: [{ id: 'one', name: 'First' }, { id: 'two', name: 'Second' }, { name: 'Legacy' }] };
  const coverage = { version_id: 'v2', cases: [{ test_case_id: 'one', status: 'passed', evaluation_id: 'e1' }, { test_case_id: 'two', status: 'failed', evaluation_id: 'e2' }] };
  const rows = skillCoverageRows(skill, coverage);
  assert.deepEqual(rows.map(row => row.status), ['passed', 'failed', 'missing']);
  assert.equal(rows[2].legacy, true);
  assert.equal(skillCoverageRows(skill, { cases: [{ test_case_id: 'one', status: 'confidence:99' }] })[0].status, 'missing');
  assert.match(skillPublicationReason(skill, coverage, [{ id: 'v2', number: 2 }]), /legacy version/);
  skill.test_cases.pop();
  assert.match(skillPublicationReason(skill, coverage, [{ id: 'v2', number: 2 }]), /Second \(Fail\)/);
  assert.match(skillPublicationReason(skill, null, [{ id: 'v2', number: 2 }]), /Legacy handwritten observations do not count/);
});

test('Comparison eligibility requires two different evaluations with the same case and exact input hash', () => {
  const left = { id: 'a', test_case_id: 'case', input_hash: 'hash', version_id: 'v1' };
  const right = { id: 'b', test_case_id: 'case', input_hash: 'hash', version_id: 'v2' };
  assert.equal(skillEvaluationsComparable(left, right), true, 'Skill version changes may be compared but are not a controlled benchmark');
  assert.equal(skillEvaluationsComparable(left, left), false);
  assert.equal(skillEvaluationsComparable(left, { ...right, test_case_id: 'other' }), false);
  assert.equal(skillEvaluationsComparable(left, { ...right, input_hash: 'different' }), false);
  assert.equal(skillEvaluationsComparable({ ...left, input_hash: undefined }, { ...right, input_hash: undefined }), false);
});

test('Prepared evaluation validity handles epoch and ISO expiry and excludes consumed reservations', () => {
  const now = Date.parse('2026-09-24T00:00:00Z');
  const preparation = { id: 'prepared', status: 'prepared', expires_at: now + 1000 };
  assert.equal(skillPreparationUsable(preparation, now), true);
  assert.equal(skillPreparationUsable({ ...preparation, expires_at: new Date(now + 1000).toISOString() }, now), true);
  for (const patch of [{ expires_at: now }, { expires_at: 'unknown' }, { expired: true }, { status: 'bound' }, { status: 'cancelled' }]) assert.equal(skillPreparationUsable({ ...preparation, ...patch }, now), false);
});

test('Skill evaluation only launches through explicit reviewed canonical binding with opt-in tools', () => {
  assert.doesNotThrow(() => transformSync(source, { loader: 'jsx', format: 'esm' }));
  assert.doesNotThrow(() => transformSync(page, { loader: 'jsx', format: 'esm' }));
  assert.match(source, /\[workMode, setWorkMode\] = useState\('conversation'\)/);
  assert.match(source, /\[permission, setPermission\] = useState\('read-only'\)/);
  assert.match(source, /\[nativeTools, setNativeTools\] = useState\(false\)/);
  assert.match(source, /skill_version_id: version.id, test_case_id: testCase.id, agent_id: agent.id, profile_version: agent.version/);
  assert.match(source, /<ContextInspector request=\{prepared.context_inspection_request\}/);
  assert.match(source, /\.\.\.prepared.run_request, context_inspection_id: reviewed.id/);
  assert.match(source, /Launch reviewed evaluation/);
  assert.match(source, /Launch delivery is uncertain/);
  assert.doesNotMatch(source, /setInterval|window.confirm|demoRequest|mode: ['"]mock|startSession\(/);
});

test('Manual results submit artifact IDs only and show the pinned server content instead of typed output', () => {
  assert.match(source, /artifact: \{ type: artifact.type, id: artifact.id \}/);
  assert.match(source, /aria-label="Exact recorded evidence"/);
  assert.match(source, /artifact.content/);
  assert.match(source, /Checks performed \/ rationale/);
  assert.doesNotMatch(source, /evidence: notes|artifact_content:|content: notes|evidence, notes|setEvidence/);
  assert.match(source, /left_evaluation_id: left.id, right_evaluation_id: right.id, decision, rationale/);
  assert.match(source, /not a controlled benchmark/);
  assert.match(source, /context_fingerprint/);
  assert.match(source, /profile_snapshot_hash/);
});

test('Skill evidence supports immutable history, error handling, dirty form guards and responsive review', () => {
  assert.match(page, /Legacy manual observations/);
  assert.match(page, /skillHasCurrentPass\(skill, coverage, versions\)/);
  assert.match(page, /const dirty = !saved/);
  assert.match(source, /return \(\) => controller.abort\(\)/);
  assert.match(source, /useUnsavedUpdate\(dirty, busy\)/);
  assert.match(source, /requestUpdateNavigation\(onClose\)/);
  assert.match(source, /delivered.current = true; onSaved\(\); onClose\(\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /focus-visible/);
  assert.doesNotMatch(css, /#[a-f\d]{3,8}\b|animation:/i);
});

test('Every evaluation dialog body can shrink and scroll inside the shared viewport-bounded dialog', () => {
  const bodies = source.match(/<(?:div|Form)\b[^>]*className="skill-evaluation-dialog"/g) || [];
  assert.equal(bodies.length, 3, 'Preparation, grading and comparison use the same scrollable direct wrapper');
  const scrollRule = css.match(/\.dialog\s*>\s*\.skill-evaluation-dialog\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(scrollRule, /flex:\s*1 1 auto/);
  assert.match(scrollRule, /min-height:\s*0/);
  assert.match(scrollRule, /overflow:\s*auto/);
  assert.match(scrollRule, /overscroll-behavior:\s*contain/);
  assert.doesNotMatch(scrollRule, /overflow:\s*(?:hidden|visible)/);
});

test('Evaluation action rows wrap and keep both controls inside narrow mobile dialogs', () => {
  const footer = css.match(/\.skill-evaluation-dialog\s+\.form-submit-row\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(footer, /flex-wrap:\s*wrap/);
  assert.match(footer, /gap:\s*8px/);
  const buttons = css.match(/\.skill-evaluation-dialog\s+\.form-submit-row\s*>\s*\.button\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(buttons, /min-width:\s*0/);
  assert.match(buttons, /max-width:\s*100%/);
  assert.match(buttons, /white-space:\s*normal/);
  const mobile = css.slice(css.lastIndexOf('@media (max-width: 600px)'));
  assert.match(mobile, /\.skill-evaluation-dialog\s+\.form-submit-row\s*>\s*\.button\s*\{[^}]*flex:\s*1 1 100%;[^}]*width:\s*100%/);
});

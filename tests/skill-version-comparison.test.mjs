import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { compareSkillVersions, skillVersionReadable, skillDefinitionText, SKILL_DEFINITION_FIELDS } from '../src/lib/skill-version-comparison.js';
const version = (number, definition = {}) => ({ id: `v${number}`, skill_id: 's', number, definition });

test('Skill comparison shows exact changed definitions, not runtime metadata or evidence verdicts', () => {
  const old = version(1, { instructions: 'Review\nStop.', allowed_tools: ['read_document'], test_cases: [{ id: 'c', inputs: { n: 1 }, expected_output: 'finding' }] });
  const next = { ...version(2, { ...old.definition, instructions: 'Review carefully\nStop.', allowed_tools: [] }), author_id: 'someone', outcome: 'passed' };
  const result = compareSkillVersions('s', old, next);
  assert.deepEqual(result.changedFields, ['Instructions', 'Allowed tools']);
  assert.match(result.files[0].patch, /-Review\n\+Review carefully/);
  assert.equal(result.files[0].path, 'instructions.md');
  assert.match(result.notice, /not evidence of better/);
  assert.doesNotMatch(JSON.stringify(result), /someone|outcome/);
});
test('Missing, restricted, malformed and cross-Skill definitions fail closed', () => {
  for (const bad of [null, { ...version(1), restricted: true }, { ...version(1), redacted: true }, { ...version(1), definition: null }, { ...version(1), definition: [] }, { ...version(1), skill_id: 'other' }]) {
    assert.equal(skillVersionReadable(bad, 's'), false); assert.equal(compareSkillVersions('s', bad, version(2)), null);
  }
});
test('JSON key ordering is presentation-only but arrays, null, missing and whitespace retain meaning', () => {
  const a = version(1, { inputs: [{ name: 'topic', type: 'string' }], instructions: 'hello\n' });
  const b = version(2, { inputs: [{ type: 'string', name: 'topic' }], instructions: 'hello' });
  assert.deepEqual(compareSkillVersions('s', a, b).changedFields, ['Instructions']);
  assert.match(compareSkillVersions('s', a, b).files[0].patch, /No newline/);
  assert.equal(compareSkillVersions('s', version(1), version(2, { preferred_agent_id: null })).files.length, 1);
  assert.equal(compareSkillVersions('s', version(1, { preferred_agent_id: null }), version(2, { preferred_agent_id: 'null' })).files.length, 1);
  assert.equal(compareSkillVersions('s', version(1), version(2, { instructions: '(Not recorded in this version)' })).files.length, 1);
  assert.match(compareSkillVersions('s', version(1), version(2, { instructions: '(Not recorded in this version)' })).files[0].patch, /\+Recorded/);
  assert.equal(skillDefinitionText(version(1, { instructions: '' }), 'instructions'), '');
});
test('All supported definition fields compare without credentials or arbitrary runtime state', () => {
  const fields = SKILL_DEFINITION_FIELDS.map(([key]) => key), definition = Object.fromEntries(fields.map(key => [key, `value for ${key}`]));
  const result = compareSkillVersions('s', version(1), version(2, { ...definition, credentials: 'PRIVATE' }));
  assert.equal(result.files.length, fields.length); assert(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(compareSkillVersions('s', version(1, definition), version(1, definition)).files.length, 0);
});
test('Skill comparison reuses shared code appearance, renders on demand and has no execution controls', async () => {
  const source = readFileSync(new URL('../src/components/SkillVersionComparison.jsx', import.meta.url), 'utf8');
  await transform(source, { loader: 'jsx' });
  assert.match(source, /<ChangeReview/); assert.match(source, /expanded \? compareSkillVersions/);
  assert.match(source, /missing content is not treated as deleted text/);
  assert.doesNotMatch(source, /apiRequest|startSession|startRun|method:\s*['"]POST/);
});

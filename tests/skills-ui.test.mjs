import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { skillEditorFields, skillEditorPayload, parseSkillInputs, skillTestDefaults, skillHasCurrentPass, skillContextChoices, skillRequestBody } from '../src/lib/skills.js';
import { parsePage, pageHash } from '../src/lib/navigation.js';
import { normalizeOrganization, NAV_ITEMS } from '../src/lib/organization.js';
import { resolveShortcut } from '../src/lib/shortcuts.js';

test('Skills are canonical navigation entries with a unique keyboard destination', () => {
  assert.deepEqual(parsePage(pageHash('skills', 'skill_1')), { view: 'skills', id: 'skill_1', projectId: null });
  const keys = NAV_ITEMS.map(item => item.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(resolveShortcut({ key: 'k' }, { prefix: { key: 'g', at: 1 }, now: 2 }).action, 'go:skills');
  const prefs = normalizeOrganization({ version: 1 });
  assert.ok(prefs.order.tools.includes('skills'));
  assert.ok(prefs.layout.root.includes('skills'));
});

test('Skill editor round-trips typed inputs, references, examples and test definitions without account state', () => {
  const skill = { name: 'Review', purpose: 'Review changes', instructions: 'Inspect {{change}}', inputs: [{ name: 'change', type: 'string', required: true, description: 'Diff' }, { name: 'depth', type: 'enum', required: false, description: 'Depth', options: ['brief', 'full'] }], required_context: [{ kind: 'document', id: 'd' }], allowed_tools: ['read_document'], required_capabilities: ['review'], examples: [{ inputs: { change: 'example' }, output: '# Findings' }], preferred_agent_id: 'a', output_format: 'Markdown', approval_policy: 'always', test_cases: [{ name: 'Small diff', inputs: { change: 'test' }, expected_output: 'Find the problem' }] };
  const form = skillEditorFields({ ...skill, credentials: 'never copy', state: 'published', version: 2 });
  assert.deepEqual(skillEditorPayload(form), skill);
  assert.equal(Object.hasOwn(form, 'credentials'), false);
  form.required_context[0].id = 'another';
  assert.equal(skill.required_context[0].id, 'd');
});

test('Input validation rejects ambiguous names, enum values and non-object test input', () => {
  const form = skillEditorFields();
  form.inputs = [{ name: 'invalid name', type: 'string', description: '' }];
  assert.throws(() => skillEditorPayload(form), /unique identifiers/);
  form.inputs = [{ name: 'choice', type: 'enum', description: '', options_text: 'a\na' }];
  assert.throws(() => skillEditorPayload(form), /unique options/);
  for (const text of ['[]', 'null', 'true', 'not json']) assert.throws(() => parseSkillInputs(text), /JSON/);
  assert.deepEqual(parseSkillInputs('{"topic":"Talvori"}'), { topic: 'Talvori' });
  assert.deepEqual(skillTestDefaults({ inputs: [{ name: 'count', type: 'number' }, { name: 'flag', type: 'boolean' }, { name: 'mode', type: 'enum', options: ['brief'] }] }), { count: 0, flag: false, mode: 'brief' });
});

test('Publishing readiness requires every exact case pass and never accepts legacy handwritten evidence', () => {
  const skill = { version: 2, test_cases: [{ id: 'case-a' }, { id: 'case-b' }] }, versions = [{ id: 'v1', number: 1 }, { id: 'v2', number: 2 }];
  const coverage = { version_id: 'v2', publishable: true, cases: [{ test_case_id: 'case-a', status: 'passed' }, { test_case_id: 'case-b', status: 'passed' }] };
  assert.equal(skillHasCurrentPass(skill, coverage, versions), true);
  assert.equal(skillHasCurrentPass(skill, { ...coverage, version_id: 'v1' }, versions), false);
  assert.equal(skillHasCurrentPass(skill, { ...coverage, cases: coverage.cases.slice(0, 1) }, versions), false);
  assert.equal(skillHasCurrentPass(skill, { ...coverage, cases: [{ test_case_id: 'case-a', status: 'passed' }, { test_case_id: 'case-b', status: 'failed' }] }, versions), false);
  assert.equal(skillHasCurrentPass(skill, [{ version_id: 'v2', mode: 'manual', outcome: 'passed' }], versions), false);
});

test('Context choices remain workspace-scoped and knowledge is approved only', () => {
  const data = { knowledge_entries: [{ id: 'good', workspace_id: 'w', state: 'approved' }, { id: 'draft', workspace_id: 'w', state: 'draft' }, { id: 'other', workspace_id: 'x', state: 'approved' }], workspace_items: [{ id: 'pack', workspace_id: 'w', kind: 'context_pack' }, { id: 'template', workspace_id: 'w', kind: 'route_template' }] };
  assert.deepEqual(skillContextChoices(data, 'w', 'knowledge').map(item => item.id), ['good']);
  assert.deepEqual(skillContextChoices(data, 'w', 'pack').map(item => item.id), ['pack']);
});

test('Retries retain the request ID for unchanged payloads without reusing it for edits', () => {
  let count = 0; const makeId = () => `key-${++count}`;
  const first = skillRequestBody({ version: 1, instructions: 'before' }, null, makeId);
  const retry = skillRequestBody({ version: 1, instructions: 'before' }, first.request, makeId);
  assert.equal(first.body.request_id, retry.body.request_id);
  const edited = skillRequestBody({ version: 1, instructions: 'after' }, retry.request, makeId);
  assert.notEqual(first.body.request_id, edited.body.request_id);
});

test('Skill definition controls retain legacy observations and sanitize conversion without provider launches', () => {
  const page = readFileSync(new URL('../src/views/Skills.jsx', import.meta.url), 'utf8');
  const conversion = readFileSync(new URL('../src/components/SkillFromRun.jsx', import.meta.url), 'utf8');
  assert.match(page, /No agent or provider is started/);
  assert.match(page, /useUnsavedUpdate\(dirty, busy\)/);
  assert.match(page, /requestUpdateNavigation\(onClose\)/);
  assert.doesNotMatch(page, /startSession\(|startRun\(/);
  assert.match(conversion, /inputs: \[\], required_context: \[\]/);
  assert.doesNotMatch(conversion, /run\.prompt|run\.output|startSession\(/);
});

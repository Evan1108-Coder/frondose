import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from '../server/local-api.mjs';
import { validateSkillDefinition } from '../server/skills-service.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rumbo-skill-reliability-'));
  const api = createLocalApi({ dataDir: dir, seedMode: 'demo' }), server = createServer(api.middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const db = new DatabaseSync(api.dbPath), snapshot = api.snapshot(), workspace = snapshot.workspaces[0];
  const call = async (method, path, body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); api.close(); await rm(dir, { recursive: true, force: true }); });
  return { api, db, call, workspace, snapshot };
}

const definition = {
  name: 'Evidence checker', purpose: 'Exercise immutable reliability evidence', instructions: 'Summarize the supplied material.',
  inputs: [{ name: 'topic', type: 'string', required: true }], allowed_tools: [], output_format: 'One short paragraph.',
  examples: [], test_cases: [{ name: 'Exact fixture', inputs: { topic: 'fixture' }, expected_output: 'REVIEWER_ONLY_EXPECTED_RESULT' }],
};

test('preparation pins a stable case and exact context without leaking the reviewer answer', async t => {
  const { api, call, workspace, snapshot } = await fixture(t);
  const project = snapshot.projects.find(item => item.workspace_id === workspace.id);
  const document = (await call('POST', '/documents', { workspace_id: workspace.id, project_id: project.id, title: 'Evidence', content: 'REQUIRED_PRIVATE_CONTEXT' })).body.document;
  const created = await call('POST', '/skills', { workspace_id: workspace.id, project_id: project.id, ...definition, required_context: [{ kind: 'document', id: document.id }] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const skill = created.body.result, detail = (await call('GET', `/skills/${skill.id}`)).body.result;
  const version = detail.versions[0], testCase = skill.test_cases[0], agent = api.snapshot().agents.find(item => ['codex', 'claude'].includes(item.provider) && item.status !== 'paused');
  const input = { skill_version_id: version.id, test_case_id: testCase.id, agent_id: agent.id, profile_version: agent.version, work_mode: 'conversation', permission_mode: 'read-only', request_id: 'prepare-one' };
  const prepared = await call('POST', `/skills/${skill.id}/evaluations/prepare`, input);
  assert.equal(prepared.status, 201, JSON.stringify(prepared.body));
  const result = prepared.body.result;
  assert.equal(result.preparation.test_case_id, testCase.id);
  assert.equal(result.context_inspection_request.skill_evaluation.preparation_id, result.preparation.id);
  assert.equal(result.context_inspection_request.skill_evaluation.preparation_token, undefined);
  assert.equal(typeof result.run_request.skill_evaluation.preparation_token, 'string');
  assert.match(result.context_inspection_request.attachments[0].content, /REQUIRED_PRIVATE_CONTEXT/);
  assert.ok(!JSON.stringify(result).includes('REVIEWER_ONLY_EXPECTED_RESULT'));
  const replay = await call('POST', `/skills/${skill.id}/evaluations/prepare`, input);
  assert.equal(replay.status, 201); assert.equal(replay.body.result.preparation.id, result.preparation.id);
  assert.equal(replay.body.result.preparation.version, result.preparation.version + 1);
  assert.notEqual(replay.body.result.run_request.skill_evaluation.preparation_token, result.run_request.skill_evaluation.preparation_token);
  const reliability = await call('GET', `/skills/${skill.id}/reliability`);
  assert.equal(reliability.status, 200); assert.deepEqual(reliability.body.result.coverage, { version_id: version.id, total: 1, passed: 0, failed: 0, missing: 1, complete: false, publishable: false, cases: [{ test_case_id: testCase.id, name: testCase.name, status: 'missing', evaluation_id: null }] });
  assert.deepEqual(reliability.body.result.preparations[0].artifacts, []);
  assert.equal((await call('POST', `/skills/${skill.id}/publish`, { version: skill.version })).status, 409);
});

test('reliability mutations reject caller-authored evidence and cancellation is optimistic', async t => {
  const { api, call, workspace } = await fixture(t);
  const skill = (await call('POST', '/skills', { workspace_id: workspace.id, ...definition, required_context: [] })).body.result;
  const detail = (await call('GET', `/skills/${skill.id}`)).body.result, agent = api.snapshot().agents.find(item => ['codex', 'claude'].includes(item.provider) && item.status !== 'paused');
  const prepared = (await call('POST', `/skills/${skill.id}/evaluations/prepare`, { skill_version_id: detail.versions[0].id, test_case_id: skill.test_cases[0].id, agent_id: agent.id, profile_version: agent.version })).body.result.preparation;
  const forged = await call('POST', `/skills/${skill.id}/evaluations`, { preparation_id: prepared.id, outcome: 'passed', artifact: { type: 'run_event', id: 'fake' }, evidence: 'caller says pass' });
  assert.equal(forged.status, 400); assert.equal(forged.body.error.code, 'invalid_skill_evaluation');
  assert.equal((await call('POST', `/skills/${skill.id}/evaluation-preparations/${prepared.id}/cancel`, { version: prepared.version + 1 })).status, 409);
  const cancelled = await call('POST', `/skills/${skill.id}/evaluation-preparations/${prepared.id}/cancel`, { version: prepared.version });
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.result.status, 'cancelled');
});

test('definition validation preserves explicit legacy policy while edited definitions receive stable v2 IDs', async t => {
  const { db, workspace } = await fixture(t), actor = { id: 'local-owner', mode: 'account' }, allow = () => true;
  const legacy = validateSkillDefinition(db, workspace.id, definition, actor, allow);
  assert.equal(legacy.evidence_policy_version, 1); assert.equal(legacy.test_cases[0].id, undefined);
  const upgraded = validateSkillDefinition(db, workspace.id, definition, actor, allow, { upgradeReliability: true });
  assert.equal(upgraded.evidence_policy_version, 2); assert.match(upgraded.test_cases[0].id, /^case_/);
  const edited = validateSkillDefinition(db, workspace.id, { ...upgraded, instructions: 'Changed' }, actor, allow, { upgradeReliability: true });
  assert.equal(edited.test_cases[0].id, upgraded.test_cases[0].id);
});

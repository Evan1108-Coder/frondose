import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';
import { replaySkillEvaluationRun, skillReliabilityDetail, skillReliabilityRoute } from '../server/skill-reliability-service.mjs';

const skillDefinition = agentId => ({
  name: 'Evidence brief', purpose: 'Create a concise evidence brief', instructions: 'Answer the exact topic using the reviewed context.',
  inputs: [{ name: 'topic', type: 'string', required: true }], required_context: [], allowed_tools: [], preferred_agent_id: agentId,
  required_capabilities: [], output_format: 'A concise evidence brief', examples: [], approval_policy: 'always',
  test_cases: [{ name: 'Core evidence', inputs: { topic: 'Reliability' }, expected_output: 'A concise evidence-backed result.' }],
});

function childFor(result) {
  const child = new EventEmitter();
  child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.kill = () => { queueMicrotask(() => child.emit('close', 1)); return true; };
  child.stdin.end = prompt => {
    child.prompt = prompt;
    if (result.hang) return;
    queueMicrotask(() => {
      if (result.exitCode) child.stderr.emit('data', Buffer.from(result.error || 'Injected provider failure'));
      else child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: result.text } })}\n`));
      child.emit('close', result.exitCode || 0);
    });
  };
  return child;
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-skill-evaluation-'));
  const fake = { launches: [], results: [] };
  const api = createLocalApi({ dataDir: directory, seedMode: 'clean', integrationOptions: {
    env: {}, fetchImpl: () => { throw new Error('Network forbidden in Skill evaluation tests.'); },
    execute: async (_command, args) => ({ stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '', code: 0 }),
    spawnProcess: (command, args, options) => {
      const result = fake.results.shift() || { text: 'Injected evaluation result.' };
      if (result.throwError) throw Object.assign(new Error(result.throwError), { code: 'injected_spawn_failure' });
      const child = childFor(result);
      fake.launches.push({ command, args: [...args], options, child, result }); return child;
    },
  } });
  const server = createServer((req, res) => api.middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (method, path, body) => {
    const response = await fetch(origin + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const call = async (method, path, body, expected = method === 'POST' ? 201 : 200) => {
    const response = await request(method, path, body); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(response.body)}`); return response.body;
  };
  const workspace = (await call('POST', '/workspaces', { name: 'Skill evaluation fixture' })).workspace;
  await call('POST', '/connections/codex/connect', { method: 'existing' }, 200);
  const agent = (await call('POST', '/agents', { workspace_id: workspace.id, name: 'Evaluation agent', provider: 'codex', provider_connection_id: 'conn_codex', permission_policy: 'read-only' })).agent;
  const skill = (await call('POST', '/skills', { workspace_id: workspace.id, ...skillDefinition(agent.id) })).result;
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { api, request, call, fake, workspace, agent, skill };
}

async function reliability(call, skillId) { return (await call('GET', `/skills/${skillId}/reliability`)).result; }
async function prepare(call, skill, agent, testCaseId, requestId) {
  return (await call('POST', `/skills/${skill.id}/evaluations/prepare`, {
    skill_version_id: skill.version_id, test_case_id: testCaseId, agent_id: agent.id, profile_version: agent.version,
    work_mode: 'conversation', permission_mode: 'read-only', request_id: requestId,
  })).result;
}
async function inspectAndLaunch(call, prepared, patch = {}) {
  const inspection = (await call('POST', '/context/inspect', prepared.context_inspection_request)).result;
  const launched = await call('POST', '/runs', { ...prepared.run_request, ...patch, context_inspection_id: inspection.id });
  await new Promise(resolve => setImmediate(resolve));
  return { inspection, run: launched.run };
}
async function terminalEvent(call, runId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const events = (await call('GET', `/runs/${runId}/events`)).events;
    const terminal = events.find(event => ['run.completed', 'run.failed', 'run.stopped'].includes(event.type));
    if (terminal) return terminal;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`Run ${runId} did not record a terminal event`);
}

async function directReliabilityPost({ db, skillId, path, body, allowed }) {
  let response;
  await skillReliabilityRoute({
    db, req: { method: 'POST' }, res: {}, path, body,
    actor: { id: 'local-owner', mode: 'account' }, allowed,
    send: (_res, status, payload) => { response = { status, payload }; },
  });
  assert.ok(response, `Reliability route did not handle ${path}`);
  return response;
}

test('two reviewed live evaluations pin current profiles, compare exact artifacts, and never publish automatically', async t => {
  const { request, call, fake, api, skill, agent } = await fixture(t);
  let detail = await reliability(call, skill.id);
  assert.equal(detail.policy_version, 2);
  assert.equal(detail.coverage.total, 1);
  const testCaseId = detail.coverage.cases[0].test_case_id, versionId = detail.coverage.version_id;
  skill.version_id = versionId;

  fake.results.push({ text: 'FIRST_EXACT_AGENT_RESULT' });
  const firstInitial = await prepare(call, skill, agent, testCaseId, 'prepare-first');
  const firstPrepared = await prepare(call, skill, agent, testCaseId, 'prepare-first');
  assert.equal(firstPrepared.preparation.id, firstInitial.preparation.id); assert.equal(firstPrepared.replayed, true);
  assert.equal(firstPrepared.preparation.profile_version, 1);
  assert.equal(firstPrepared.context_inspection_request.skill_evaluation.preparation_token, undefined);
  assert.ok(firstPrepared.run_request.skill_evaluation.preparation_token);
  const first = await inspectAndLaunch(call, firstPrepared), firstEvent = await terminalEvent(call, first.run.id);
  assert.equal(first.run.mode, 'live');
  assert.equal(first.run.agent_profile_version, 1);
  assert.equal((await call('GET', `/skills/${skill.id}`)).result.skill.state, 'draft', 'provider completion is not publication');
  const rejectedEvidence = await request('POST', `/skills/${skill.id}/evaluations`, { preparation_id: firstPrepared.preparation.id, outcome: 'passed', evidence: 'caller claim', artifact: { type: 'run_event', id: firstEvent.id }, request_id: 'fake-evidence' });
  assert.equal(rejectedEvidence.status, 400, JSON.stringify(rejectedEvidence.body));
  const finalizeFirst = { preparation_id: firstPrepared.preparation.id, outcome: 'passed', notes: 'Human checked the exact result.', artifact: { type: 'run_event', id: firstEvent.id }, request_id: 'finalize-first' };
  const firstEvaluation = (await call('POST', `/skills/${skill.id}/evaluations`, finalizeFirst, 200)).result;
  assert.equal((await call('POST', `/skills/${skill.id}/evaluations`, finalizeFirst, 200)).result.id, firstEvaluation.id);
  assert.equal(firstEvaluation.mode, 'reviewed_live'); assert.equal(firstEvaluation.evidence_version, 2); assert.equal(firstEvaluation.evaluator_id, 'local-owner');
  assert.match(firstEvaluation.evidence, /FIRST_EXACT_AGENT_RESULT/);

  const changed = (await call('PATCH', `/agents/${agent.id}`, { version: 1, output_behavior: 'Return the strongest evidence first.' }, 200)).agent;
  fake.results.push({ text: 'SECOND_EXACT_AGENT_RESULT' });
  const secondPrepared = await prepare(call, skill, changed, testCaseId, 'prepare-second');
  const second = await inspectAndLaunch(call, secondPrepared), secondEvent = await terminalEvent(call, second.run.id);
  assert.equal(second.run.agent_profile_version, 2);
  const secondEvaluation = (await call('POST', `/skills/${skill.id}/evaluations`, { preparation_id: secondPrepared.preparation.id, outcome: 'passed', notes: 'Human checked the revised profile result.', artifact: { type: 'run_event', id: secondEvent.id }, request_id: 'finalize-second' }, 200)).result;

  const compareBody = { left_evaluation_id: firstEvaluation.id, right_evaluation_id: secondEvaluation.id, decision: 'right_better', rationale: 'The second result leads with evidence.', request_id: 'compare-one' };
  const comparison = (await call('POST', `/skills/${skill.id}/comparisons`, compareBody, 200)).result;
  assert.equal((await call('POST', `/skills/${skill.id}/comparisons`, compareBody, 200)).result.id, comparison.id);
  assert.equal(comparison.decision, 'right_better');
  detail = await reliability(call, skill.id);
  assert.equal(detail.evaluations.length, 2); assert.equal(detail.comparisons.length, 1);
  assert.equal(detail.coverage.passed, 1); assert.equal(detail.coverage.complete, true);
  assert.equal((await call('GET', `/skills/${skill.id}`)).result.skill.state, 'draft');
  const tied = new DatabaseSync(api.dbPath);
  try {
    tied.exec('DROP TRIGGER skill_evaluations_immutable');
    tied.prepare("UPDATE skill_evaluations SET created_at='2026-09-24T00:00:00.000Z' WHERE id IN (?,?)").run(firstEvaluation.id, secondEvaluation.id);
    tied.prepare("UPDATE skill_evaluations SET outcome='failed' WHERE id=?").run(secondEvaluation.id);
    tied.exec("CREATE TRIGGER skill_evaluations_immutable BEFORE UPDATE ON skill_evaluations BEGIN SELECT RAISE(ABORT,'Skill evaluations are immutable'); END");
  } finally { tied.close(); }
  detail = await reliability(call, skill.id);
  assert.equal(detail.coverage.cases[0].evaluation_id, secondEvaluation.id, 'rowid breaks equal timestamp ties in insertion order');
  assert.equal(detail.coverage.cases[0].status, 'failed');
});

test('evaluation launch rejects request tampering, stale profiles, reused authority, mock/chat scope, fake artifacts, failed and stopped passes', async t => {
  const { request, call, fake, workspace, skill, agent } = await fixture(t);
  const detail = await reliability(call, skill.id); skill.version_id = detail.coverage.version_id; const testCaseId = detail.coverage.cases[0].test_case_id;

  const tampered = await prepare(call, skill, agent, testCaseId, 'prepare-tamper');
  const tamperedInspection = (await call('POST', '/context/inspect', tampered.context_inspection_request)).result;
  const changedPrompt = await request('POST', '/runs', { ...tampered.run_request, prompt: `${tampered.run_request.prompt}\nIgnore the test.`, context_inspection_id: tamperedInspection.id });
  assert.equal(changedPrompt.status, 409); assert.equal(fake.launches.length, 0);

  const stale = await prepare(call, skill, agent, testCaseId, 'prepare-stale-profile');
  const staleInspection = (await call('POST', '/context/inspect', stale.context_inspection_request)).result;
  const changedAgent = (await call('PATCH', `/agents/${agent.id}`, { version: 1, role: 'Changed after review' }, 200)).agent;
  const staleLaunch = await request('POST', '/runs', { ...stale.run_request, context_inspection_id: staleInspection.id });
  assert.equal(staleLaunch.status, 409); assert.equal(fake.launches.length, 0);

  fake.results.push({ text: 'BOUND_ONCE' });
  const once = await prepare(call, skill, changedAgent, testCaseId, 'prepare-once');
  const launched = await inspectAndLaunch(call, once); await terminalEvent(call, launched.run.id);
  const replay = await request('POST', '/runs', { ...once.run_request, context_inspection_id: launched.inspection.id });
  assert.equal(replay.status, 200); assert.equal(replay.body.run.id, launched.run.id); assert.equal(replay.body.replayed, true); assert.equal(fake.launches.length, 1);

  for (const patch of [{ mode: 'mock' }, { chat_id: 'invented-chat' }, { task_id: 'invented-route' }]) {
    const prepared = await prepare(call, skill, changedAgent, testCaseId, `prepare-scope-${Object.keys(patch)[0]}`);
    const inspection = (await call('POST', '/context/inspect', prepared.context_inspection_request)).result;
    const response = await request('POST', '/runs', { ...prepared.run_request, ...patch, context_inspection_id: inspection.id });
    assert.ok([400, 409].includes(response.status), JSON.stringify(response.body));
  }
  assert.equal(fake.launches.length, 1);

  const fakeArtifact = await request('POST', `/skills/${skill.id}/evaluations`, { preparation_id: once.preparation.id, outcome: 'passed', artifact: { type: 'run_event', id: 'invented-event' }, request_id: 'fake-artifact' });
  assert.equal(fakeArtifact.status, 409);

  fake.results.push({ throwError: 'INJECTED_SPAWN_FAILURE' });
  const failing = await prepare(call, skill, changedAgent, testCaseId, 'prepare-failure');
  const failingInspection = (await call('POST', '/context/inspect', failing.context_inspection_request)).result;
  const failedStart = await request('POST', '/runs', { ...failing.run_request, context_inspection_id: failingInspection.id });
  assert.ok(failedStart.status >= 400);
  const afterFailure = await reliability(call, skill.id), failedPreparation = afterFailure.preparations.find(item => item.id === failing.preparation.id);
  assert.ok(failedPreparation.canonical_run_id, 'spawn setup failure retains its bound failed run');
  const failedEvent = await terminalEvent(call, failedPreparation.canonical_run_id);
  assert.equal(failedEvent.type, 'run.failed');
  assert.equal(failedEvent.payload.error_code, 'injected_spawn_failure');
  const passFailure = await request('POST', `/skills/${skill.id}/evaluations`, { preparation_id: failing.preparation.id, outcome: 'passed', artifact: { type: 'run_event', id: failedEvent.id }, request_id: 'pass-failure' });
  assert.equal(passFailure.status, 409);

  fake.results.push({ text: 'WILL_BE_STOPPED', hang: true });
  const stopping = await prepare(call, skill, changedAgent, testCaseId, 'prepare-stop');
  const inspection = (await call('POST', '/context/inspect', stopping.context_inspection_request)).result;
  const started = (await call('POST', '/runs', { ...stopping.run_request, context_inspection_id: inspection.id })).run;
  await call('POST', `/runs/${started.id}/stop`, {}, 200);
  const stoppedEvent = await terminalEvent(call, started.id);
  const passStopped = await request('POST', `/skills/${skill.id}/evaluations`, { preparation_id: stopping.preparation.id, outcome: 'passed', artifact: { type: 'run_event', id: stoppedEvent.id }, request_id: 'pass-stop' });
  assert.equal(passStopped.status, 409);
  assert.equal((await reliability(call, skill.id)).coverage.publishable, false);
  assert.equal((await call('GET', `/skills?workspace_id=${workspace.id}`)).result[0].state, 'draft');
});

test('revoked captured context and output access fail closed across detail, coverage, finalize, comparison, and run replay', async t => {
  const { request, call, fake, api, workspace, skill, agent } = await fixture(t);
  const initial = await reliability(call, skill.id);
  skill.version_id = initial.coverage.version_id;
  const testCaseId = initial.coverage.cases[0].test_case_id;

  fake.results.push({ text: 'OLDER_ACCESSIBLE_RESULT' });
  const olderPrepared = await prepare(call, skill, agent, testCaseId, 'prepare-revocation-older');
  const olderRun = await inspectAndLaunch(call, olderPrepared);
  const olderEvent = await terminalEvent(call, olderRun.run.id);
  const olderFinalize = { preparation_id: olderPrepared.preparation.id, outcome: 'passed', artifact: { type: 'run_event', id: olderEvent.id }, request_id: 'finalize-revocation-older' };
  const olderEvaluation = (await call('POST', `/skills/${skill.id}/evaluations`, olderFinalize, 200)).result;

  const privateProject = (await call('POST', '/projects', { workspace_id: workspace.id, name: 'Revocable evidence project' })).project;
  fake.results.push({ text: 'NEWER_PROJECT_OUTPUT_RESULT' });
  const newerPrepared = await prepare(call, skill, agent, testCaseId, 'prepare-revocation-newer');
  const newerRun = await inspectAndLaunch(call, newerPrepared);
  await terminalEvent(call, newerRun.run.id);
  const output = (await call('POST', '/workflow/outputs', {
    workspace_id: workspace.id, project_id: privateProject.id, run_id: newerRun.run.id,
    title: 'Exact private evaluation artifact', kind: 'document', content: 'PRIVATE_OUTPUT_VERSION_EVIDENCE', reviewer_name: 'Owner',
  })).result;
  const outputVersion = api.snapshot().output_versions.find(item => item.output_id === output.id);
  await new Promise(resolve => setTimeout(resolve, 2));
  const newerFinalize = { preparation_id: newerPrepared.preparation.id, outcome: 'passed', artifact: { type: 'output_version', id: outputVersion.id }, request_id: 'finalize-revocation-newer' };
  const newerEvaluation = (await call('POST', `/skills/${skill.id}/evaluations`, newerFinalize, 200)).result;
  const compareBody = { left_evaluation_id: olderEvaluation.id, right_evaluation_id: newerEvaluation.id, decision: 'right_better', rationale: 'The exact output is stronger.', request_id: 'compare-revocation' };
  const comparison = (await call('POST', `/skills/${skill.id}/comparisons`, compareBody, 200)).result;

  const db = new DatabaseSync(api.dbPath);
  try {
    const skillRow = db.prepare('SELECT * FROM skills WHERE id=?').get(skill.id);
    const denyPrivateOutput = (_workspaceId, _actor, permission, target = {}) => !(permission === 'documents.read' && target.scope_type === 'project' && target.scope_id === privateProject.id);
    const restricted = skillReliabilityDetail({ db, skill: skillRow, actor: { id: 'local-owner', mode: 'account' }, allowed: denyPrivateOutput });
    assert.equal(restricted.evaluations.some(item => item.id === newerEvaluation.id), false, 'denied exact artifact is absent from detail');
    assert.equal(restricted.comparisons.some(item => item.id === comparison.id), false, 'comparisons cannot reveal denied evaluation IDs');
    assert.deepEqual(restricted.coverage.cases[0], { test_case_id: testCaseId, name: 'Core evidence', status: 'missing', evaluation_id: null }, 'latest inaccessible result must not fall back to an older pass');
    assert.equal(restricted.coverage.passed, 0); assert.equal(restricted.coverage.missing, 1); assert.equal(restricted.coverage.publishable, false);

    await assert.rejects(
      directReliabilityPost({ db, skillId: skill.id, path: `/skills/${skill.id}/evaluations`, body: newerFinalize, allowed: denyPrivateOutput }),
      error => error?.statusCode === 403 && error?.code === 'access_denied',
      'finalize idempotency replay must reauthorize its exact output version',
    );
    await assert.rejects(
      directReliabilityPost({ db, skillId: skill.id, path: `/skills/${skill.id}/comparisons`, body: compareBody, allowed: denyPrivateOutput }),
      error => error?.statusCode === 403 && error?.code === 'access_denied',
      'comparison replay must reauthorize both evaluations',
    );
    assert.throws(() => replaySkillEvaluationRun({
      db, skillEvaluation: newerPrepared.run_request.skill_evaluation, actor: { id: 'local-owner', mode: 'account' }, allowed: denyPrivateOutput,
      request: newerPrepared.run_request, inspectionId: newerRun.inspection.id,
    }), error => error?.statusCode === 403 && error?.code === 'access_denied', 'bound run replay must reauthorize finalized selected evidence');
  } finally { db.close(); }

  const changedAgent = (await call('PATCH', `/agents/${agent.id}`, { version: agent.version, memory_policy: 'reviewed' }, 200)).agent;
  await call('POST', '/memory-notes', { workspace_id: workspace.id, title: 'Revocable run-only memory', content: 'RUN_CONTEXT_ONLY_PRIVATE_MEMORY' });
  fake.results.push({ text: 'RUN_WITH_REVOKABLE_CONTEXT' });
  const contextPrepared = (await call('POST', `/skills/${skill.id}/evaluations/prepare`, {
    skill_version_id: skill.version_id, test_case_id: testCaseId, agent_id: changedAgent.id, profile_version: changedAgent.version,
    work_mode: 'conversation', permission_mode: 'read-only', include_memory: true, request_id: 'prepare-context-revocation',
  })).result;
  const contextRun = await inspectAndLaunch(call, contextPrepared);
  const contextEvent = await terminalEvent(call, contextRun.run.id);
  const contextFinalize = { preparation_id: contextPrepared.preparation.id, outcome: 'passed', artifact: { type: 'run_event', id: contextEvent.id }, request_id: 'finalize-context-revocation' };
  await call('POST', `/skills/${skill.id}/evaluations`, contextFinalize, 200);

  const contextDb = new DatabaseSync(api.dbPath);
  try {
    const captured = JSON.parse(contextDb.prepare('SELECT inspection_json FROM run_context_snapshots WHERE run_id=?').get(contextRun.run.id).inspection_json);
    assert.ok(captured.sourceAccess.sources.some(source => source.table === 'memory_notes'), 'fixture must exercise a run-only captured source');
    const denyWorkspaceDocuments = (_workspaceId, _actor, permission) => permission !== 'documents.read';
    assert.throws(() => replaySkillEvaluationRun({
      db: contextDb, skillEvaluation: contextPrepared.run_request.skill_evaluation, actor: { id: 'local-owner', mode: 'account' }, allowed: denyWorkspaceDocuments,
      request: contextPrepared.run_request, inspectionId: contextRun.inspection.id,
    }), error => error?.statusCode === 403 && error?.code === 'context_access_revoked', 'bound run replay must recheck every captured run source');
  } finally { contextDb.close(); }

  const removed = await request('DELETE', `/workspaces/${workspace.id}`, {});
  assert.equal(removed.status, 200, `completed evaluation rows must not block authorized workspace deletion: ${JSON.stringify(removed.body)}`);
});

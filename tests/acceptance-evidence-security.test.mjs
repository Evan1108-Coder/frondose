import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createLocalApi } from '../server/local-api.mjs';
import { acceptanceEvidenceRoute, acceptanceEvidenceDetail } from '../server/acceptance-evidence-service.mjs';
import { captureSourceAccess } from '../server/context-source-access.mjs';
import { captureRunContext } from '../server/run-context-store.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-acceptance-security-'));
  let externalCalls = 0;
  const forbidden = () => { externalCalls++; throw new Error('Providers and network are forbidden in acceptance tests'); };
  const api = createLocalApi({ dataDir: directory, seedMode: 'clean', integrationOptions: { env: {}, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden } });
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const db = new DatabaseSync(api.dbPath); db.exec('PRAGMA foreign_keys=ON');
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); db.close(); await rm(directory, { recursive: true, force: true }); assert.equal(externalCalls, 0); });
  const request = async (method, path, body, cookie) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const call = async (method, path, body, expected = method === 'POST' && !/(?:acceptance-(?:policy|evidence)|versions|review)$/.test(path) ? 201 : 200) => {
    const response = await request(method, path, body); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(response.body).slice(0, 1000)}`); return response.body;
  };
  const workspace = (await call('POST', '/workspaces', { name: 'Acceptance security' })).workspace;
  const project = (await call('POST', '/projects', { workspace_id: workspace.id, name: 'Project', identifier: 'SEC' })).project;
  const task = (await call('POST', '/tasks', { workspace_id: workspace.id, project_id: project.id, title: 'Deliver a checked result' })).task;
  const criteria = [{ id: 'accuracy', text: 'Result is accurate', done: true }, { id: 'coverage', text: 'Result covers the requested scope', done: true }];
  const agreement = (await call('PATCH', `/workflow/routes/${task.id}`, { version: 0, acceptance: criteria })).result;
  await call('POST', `/workflow/routes/${task.id}/acceptance-policy`, { route_version: agreement.version, confirmed: true, request_id: 'enable' });
  const output = (await call('POST', '/workflow/outputs', { workspace_id: workspace.id, task_id: task.id, title: 'Deliverable', content: 'Exact output evidence' })).result;
  const path = `/workflow/outputs/${output.id}/acceptance-evidence`;
  const detail = async () => (await call('GET', path)).result;
  const assessment = async (criterion, decision = 'passed', overrides = {}) => {
    const current = await detail();
    return { output_version: current.output.version, output_version_id: current.output.output_version_id, agreement_version: current.route.agreement_version, criterion_id: criterion, decision, rationale: 'Human inspected the exact artifact against this criterion.', artifact: { type: 'output_version', id: current.output.output_version_id }, request_id: `assessment-${criterion}-${decision}-${randomUUID()}`, ...overrides };
  };
  const assess = async (criterion, decision = 'passed', overrides = {}) => call('POST', path, await assessment(criterion, decision, overrides));
  const reviewBody = async () => { const current = await detail(); return { version: current.output.version, version_id: current.output.output_version_id, decision: 'approved', reviewer_name: 'Human reviewer' }; };
  return { api, db, workspace, project, task, criteria, output, path, call, request, detail, assessment, assess, reviewBody };
}

test('security: complete current coverage is required and a latest failed assessment replaces an older pass', async t => {
  const f = await fixture(t);
  assert.equal((await f.detail()).coverage.missing, 2);
  await f.assess('accuracy');
  assert.equal((await f.request('POST', `/workflow/outputs/${f.output.id}/review`, await f.reviewBody())).status, 409);
  await f.assess('coverage');
  assert.equal((await f.detail()).coverage.passed, 2);
  await f.assess('accuracy', 'failed');
  const current = await f.detail(); assert.equal(current.coverage.failed, 1); assert.equal(current.coverage.passed, 1);
  assert.equal((await f.request('POST', `/workflow/outputs/${f.output.id}/review`, await f.reviewBody())).status, 409);
});

test('security: criterion and output edits invalidate current coverage without rewriting assessment history', async t => {
  const f = await fixture(t);
  await f.assess('accuracy'); await f.assess('coverage');
  const before = await f.detail(), pending = await f.assessment('accuracy');
  await f.call('PATCH', `/workflow/routes/${f.task.id}`, { version: before.route.agreement_version, acceptance: f.criteria.map(item => item.id === 'accuracy' ? { ...item, text: 'Result is accurate and independently checked' } : item) });
  assert.equal((await f.request('POST', f.path, pending)).status, 409);
  assert.equal((await f.detail()).coverage.missing, 2);
  await f.assess('accuracy'); await f.assess('coverage');
  const preRevision = await f.detail();
  await f.call('POST', `/workflow/outputs/${f.output.id}/versions`, { version: preRevision.output.version, content: 'Second output draft', author_name: 'Human' });
  const after = await f.detail(); assert.equal(after.coverage.missing, 2);
  assert(after.assessments.length >= before.assessments.length);
  assert.equal((await f.request('POST', f.path, { ...pending, request_id: 'stale-output' })).status, 409);
});

test('security: exact retries do not duplicate evidence, changed-key payloads conflict and forged evidence is rejected', async t => {
  const f = await fixture(t), body = await f.assessment('accuracy', 'passed', { request_id: 'exact-retry' });
  await f.call('POST', f.path, body); await f.call('POST', f.path, body);
  assert.equal((await f.detail()).assessments.length, 1);
  assert.equal((await f.request('POST', f.path, { ...body, decision: 'failed' })).status, 409);
  const forged = await f.request('POST', f.path, { ...body, request_id: 'forged', evaluator_id: 'another-human', artifact_content: 'I claim this is real evidence' });
  assert.equal(forged.status, 400);
  const other = (await f.call('POST', '/workflow/outputs', { workspace_id: f.workspace.id, task_id: f.task.id, title: 'Unrelated output', content: 'Not the assessed output' })).result;
  const otherVersion = f.api.snapshot().output_versions.find(version => version.output_id === other.id);
  assert.equal((await f.request('POST', f.path, { ...body, request_id: 'wrong-output', artifact: { type: 'output_version', id: otherVersion.id } })).status, 409);
});

test('security: concurrent human reviews record one exact acceptance snapshot and never complete the Route', async t => {
  const f = await fixture(t); await f.assess('accuracy'); await f.assess('coverage');
  const body = await f.reviewBody(), responses = await Promise.all([f.request('POST', `/workflow/outputs/${f.output.id}/review`, body), f.request('POST', `/workflow/outputs/${f.output.id}/review`, body)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const accepted = await f.detail(); assert.equal(accepted.accepted_reviews.length, 1);
  assert.equal(f.db.prepare('SELECT status FROM tasks WHERE id=?').get(f.task.id).status, 'backlog');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM runs').get().count, 0);
});

test('security: cross-workspace artifacts never establish acceptance evidence', async t => {
  const f = await fixture(t);
  const other = (await f.call('POST', '/workspaces', { name: 'Other workspace' })).workspace;
  const foreign = (await f.call('POST', '/workflow/outputs', { workspace_id: other.id, title: 'Foreign output', content: 'PRIVATE FOREIGN EVIDENCE' })).result;
  const version = f.api.snapshot().output_versions.find(item => item.output_id === foreign.id);
  const result = await f.request('POST', f.path, await f.assessment('accuracy', 'passed', { artifact: { type: 'output_version', id: version.id } }));
  assert(result.status === 403 || result.status === 409);
  assert(!JSON.stringify(result.body).includes('PRIVATE FOREIGN EVIDENCE'));
  assert.equal((await f.detail()).assessments.length, 0);
});

test('security: exported and reimported records never recreate trusted acceptance assessments', async t => {
  const f = await fixture(t); await f.assess('accuracy'); await f.assess('coverage');
  await f.call('POST', `/workflow/outputs/${f.output.id}/review`, await f.reviewBody());
  const archive = await f.call('GET', `/export?workspace_id=${f.workspace.id}`);
  for (const key of Object.keys(archive.data)) assert(!/acceptance.*(?:assessment|review|request)/i.test(key), `Private authority collection exported: ${key}`);
  const imported = (await f.call('POST', '/import', archive)).result;
  const snapshot = f.api.snapshot(), output = snapshot.outputs.find(item => item.workspace_id === imported.id);
  const path = `/workflow/outputs/${output.id}/acceptance-evidence`;
  const detail = (await f.call('GET', path)).result;
  assert.equal(detail.policy?.policy_version, 2, 'Import preserves the stronger requirement, not its prior evidence authority');
  assert.equal(detail.assessments.length, 0); assert.equal(detail.accepted_reviews.length, 0); assert.equal(detail.coverage.passed, 0);
  const result = await f.request('POST', `/workflow/outputs/${output.id}/review`, { version: detail.output.version, version_id: detail.output.output_version_id, decision: 'approved', reviewer_name: 'Human reviewer' });
  assert.equal(result.status, 409);
  const historicalReviews = snapshot.output_reviews.filter(item => item.output_id === output.id);
  assert(historicalReviews.every(item => !item.reviewer_id));
});

test('security: immutable accepted evidence does not block authorized workspace deletion', async t => {
  const f = await fixture(t); await f.assess('accuracy'); await f.assess('coverage');
  await f.call('POST', `/workflow/outputs/${f.output.id}/review`, await f.reviewBody());
  const deleted = await f.request('DELETE', `/workspaces/${f.workspace.id}`, {});
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(f.db.prepare('SELECT id FROM workspaces WHERE id=?').get(f.workspace.id), undefined);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

const actor = { id: 'local-owner', name: 'Human reviewer', mode: 'account' };
async function direct(f, body, allowed = () => true, acting = actor) {
  let response;
  try {
    assert.equal(await acceptanceEvidenceRoute({ db: f.db, req: { method: 'POST' }, res: {}, path: f.path, body, actor: acting, allowed, send: (_res, status, result) => { response = { status, body: result }; } }), true);
  } catch (error) { response = { status: error.statusCode, body: { error: error.code } }; }
  return response;
}

test('security: same-timestamp assessments choose the latest insertion, never an earlier passing row', async t => {
  const f = await fixture(t);
  await f.assess('accuracy'); await f.assess('accuracy', 'failed');
  // Fixture-only deterministic timestamp collision; restore the production guard.
  f.db.exec("DROP TRIGGER route_acceptance_assessments_immutable; UPDATE route_acceptance_assessments SET created_at='2026-01-01T00:00:00.000Z'; CREATE TRIGGER route_acceptance_assessments_immutable BEFORE UPDATE ON route_acceptance_assessments BEGIN SELECT RAISE(ABORT,'Acceptance assessments are immutable'); END;");
  const result = await f.detail();
  assert.equal(result.coverage.cases.find(item => item.criterion_id === 'accuracy').status, 'failed');
  assert.equal(result.coverage.failed, 1);
  assert.throws(() => f.db.prepare("UPDATE route_acceptance_assessments SET decision='passed'").run(), /immutable/);
});

test('security: moved outputs retain their historical project boundary for evidence and retry responses', async t => {
  const f = await fixture(t), input = await f.assessment('accuracy');
  await f.call('POST', f.path, input); await f.assess('coverage');
  await f.call('POST', `/workflow/outputs/${f.output.id}/review`, await f.reviewBody());
  const publicProject = (await f.call('POST', '/projects', { workspace_id: f.workspace.id, name: 'Current public project' })).project;
  f.db.prepare('UPDATE tasks SET project_id=? WHERE id=?').run(publicProject.id, f.task.id);
  f.db.prepare('UPDATE outputs SET project_id=? WHERE id=?').run(publicProject.id, f.output.id);
  const allowed = (_ws, _actor, permission, scope) => !(permission === 'documents.read' && scope.scope_id === f.project.id);
  const result = acceptanceEvidenceDetail({ db: f.db, outputId: f.output.id, actor, allowed });
  assert.equal(result.assessments.length, 0); assert.equal(result.accepted_reviews.length, 0); assert.equal(result.coverage.missing, 2);
  assert.equal((await direct(f, input, allowed)).status, 403);
  assert.equal((await direct(f, { ...input, request_id: 'agent-forgery' }, () => true, { id: 'agent', mode: 'agent' })).status, 403);
});

async function derivedRun(f) {
  const privateProject = (await f.call('POST', '/projects', { workspace_id: f.workspace.id, name: 'Private source' })).project;
  const document = (await f.call('POST', '/documents', { workspace_id: f.workspace.id, project_id: privateProject.id, title: 'Private source', content: 'PRIVATE RUN SOURCE' })).document;
  const now = new Date().toISOString(), runId = `isolated-${randomUUID()}`;
  f.db.prepare('INSERT INTO runs(id,workspace_id,project_id,task_id,provider,agent_name,status,title,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(runId, f.workspace.id, f.project.id, f.task.id, 'codex', 'Fixture only', 'completed', 'Synthetic canonical run; never launched', 'live', now, now);
  const eventId = `event-${randomUUID()}`;
  f.db.prepare('INSERT INTO run_events(id,run_id,sequence,type,summary,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(eventId, runId, 1, 'run.completed', 'Completed', JSON.stringify({ summary: 'EXACT TERMINAL RESULT' }), now);
  f.db.prepare('UPDATE outputs SET run_id=? WHERE id=?').run(runId, f.output.id);
  const inspection = { finalPrompt: 'PRIVATE RUN SOURCE', manifest: { fingerprint: randomUUID(), resolved: { workspace_id: f.workspace.id, project_id: f.project.id, task_id: f.task.id }, included: [{ kind: 'document', id: document.id }], excluded: [] } };
  inspection.sourceAccess = captureSourceAccess(f.db, inspection); captureRunContext(f.db, runId, inspection);
  const revoked = (_ws, _actor, permission, scope) => !(permission === 'documents.read' && scope.scope_id === privateProject.id);
  return { runId, eventId, privateProject, document, revoked };
}

test('security: run-derived output evidence rechecks private context on creation, history, approval and retries', async t => {
  const f = await fixture(t), run = await derivedRun(f);
  const input = await f.assessment('accuracy');
  await f.call('POST', f.path, input); await f.assess('coverage');
  await f.call('POST', `/workflow/outputs/${f.output.id}/review`, await f.reviewBody());
  const safe = acceptanceEvidenceDetail({ db: f.db, outputId: f.output.id, actor, allowed: () => true });
  assert.equal(safe.accepted_reviews.length, 1);
  const hidden = acceptanceEvidenceDetail({ db: f.db, outputId: f.output.id, actor, allowed: run.revoked });
  assert.equal(hidden.assessments.length, 0); assert.equal(hidden.accepted_reviews.length, 0); assert.equal(hidden.available_artifacts.length, 0); assert.equal(hidden.coverage.missing, 2);
  assert.equal((await direct(f, input, run.revoked)).status, 403);
  const current = await f.assessment('accuracy');
  assert.equal((await direct(f, current, run.revoked)).status, 403);
  f.db.prepare('UPDATE documents SET project_id=?,content=? WHERE id=?').run(f.project.id, 'Current public text', run.document.id);
  assert.equal((await direct(f, input, run.revoked)).status, 403, 'Moving the source must not erase its old private context boundary');
});

test('security: terminal run evidence must be canonical, exact, readable and consistent with its run state', async t => {
  const f = await fixture(t), run = await derivedRun(f);
  const input = await f.assessment('accuracy', 'passed', { artifact: { type: 'run_event', id: run.eventId } });
  assert.equal((await direct(f, input)).status, 200);
  assert.equal((await direct(f, input, run.revoked)).status, 403);
  f.db.prepare("UPDATE run_events SET type='run.failed' WHERE id=?").run(run.eventId);
  assert.equal((await direct(f, { ...input, request_id: 'wrong-terminal' })).status, 409);
  assert.equal((await direct(f, { ...input, request_id: 'fake-terminal', artifact: { type: 'run_event', id: 'not-a-real-event' } })).status, 409);
});

test('security: an inaccessible newest assessment is missing, never replaced with an older visible pass', async t => {
  const f = await fixture(t); await f.assess('accuracy');
  const privateProject = (await f.call('POST', '/projects', { workspace_id: f.workspace.id, name: 'Private assessment scope' })).project;
  const move = projectId => { f.db.prepare('UPDATE tasks SET project_id=? WHERE id=?').run(projectId, f.task.id); f.db.prepare('UPDATE outputs SET project_id=? WHERE id=?').run(projectId, f.output.id); };
  move(privateProject.id); await f.assess('accuracy', 'failed'); move(f.project.id);
  const allowed = (_ws, _actor, permission, scope) => !(permission === 'documents.read' && scope.scope_id === privateProject.id);
  const result = acceptanceEvidenceDetail({ db: f.db, outputId: f.output.id, actor, allowed });
  assert.equal(result.assessments.length, 1); assert.equal(result.assessments[0].decision, 'passed');
  assert.equal(result.coverage.cases.find(item => item.criterion_id === 'accuracy').status, 'missing');
  assert.equal(result.coverage.complete, false);
});

test('security: authenticated HTTP evidence access honors read and write revocation without returning private artifacts', async t => {
  const f = await fixture(t), input = await f.assessment('accuracy');
  await f.call('POST', f.path, input);
  const member = (await f.call('POST', '/governance', { workspace_id: f.workspace.id, action: 'create_member', name: 'Reader', email: 'acceptance-reader@example.com' }, 200)).result;
  const owner = await f.request('POST', '/identity/setup', { name: 'Owner', email: 'acceptance-owner@example.com', password: 'isolated owner password 123' });
  assert.equal(owner.status, 200);
  const invitation = await f.request('POST', '/identity/invite', { workspace_id: f.workspace.id, member_id: member.id }, owner.cookie); assert.equal(invitation.status, 201);
  const accepted = await f.request('POST', '/identity/accept', { token: invitation.body.result.invitation_token, password: 'isolated reader password 123' }); assert.equal(accepted.status, 200);
  assert.equal((await f.request('GET', f.path, undefined, accepted.cookie)).status, 200);
  const deny = async permission => {
    const result = await f.request('POST', '/governance', { workspace_id: f.workspace.id, action: 'grant', member_id: member.id, permission, effect: 'deny', scope_type: 'project', scope_id: f.project.id, reason: 'Security test revocation' }, owner.cookie);
    assert.equal(result.status, 200, JSON.stringify(result.body));
  };
  await deny('documents.write');
  assert.equal((await f.request('POST', f.path, { ...input, request_id: 'member-assessment' }, accepted.cookie)).status, 403);
  await deny('documents.read');
  const hidden = await f.request('GET', f.path, undefined, accepted.cookie);
  assert.equal(hidden.status, 403); assert(!JSON.stringify(hidden.body).includes('Exact output evidence'));
});

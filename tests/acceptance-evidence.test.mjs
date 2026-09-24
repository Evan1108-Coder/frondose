import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { installAcceptanceEvidence, acceptanceEvidenceRoute, acceptanceEvidenceDetail } from '../server/acceptance-evidence-service.mjs';
import { installWorkflow, workflowRoute, workflowSnapshot } from '../server/workflow-service.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  for (const table of ['workspaces', 'projects', 'tasks', 'chats']) db.exec(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
  installWorkflow(db); installAcceptanceEvidence(db);
  db.exec(`INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES('ws','Lab','lab','now','now'),('other','Other','other','now','now');
    INSERT INTO projects(id,workspace_id,name,identifier,created_at,updated_at) VALUES('project','ws','Project','P','now','now'),('foreign','other','Foreign','F','now','now');
    INSERT INTO tasks(id,workspace_id,project_id,number,title,created_at,updated_at) VALUES('route','ws','project',1,'Ship','now','now'),('foreign-route','other','foreign',1,'Private','now','now');`);
  const actor = { id: 'owner', name: 'Owner', mode: 'account' }, allowed = () => true;
  const workflow = async (path, body, method = 'POST', options = {}) => { let response; await workflowRoute({ db, req: { method }, res: {}, path: `/workflow/${path}`, url: new URL('http://localhost'), readBody: async () => body, send: (_res, status, payload) => { response = { status, ...payload }; }, snapshot: workflowSnapshot, actor: options.actor ?? actor, allowed: options.allowed ?? allowed }); return response; };
  const evidence = async (method, path, body, options = {}) => { let response; await acceptanceEvidenceRoute({ db, req: { method }, res: {}, path: `/workflow/${path}`, body: body ?? {}, send: (_res, status, payload) => { response = { status, ...payload }; }, actor: options.actor ?? actor, allowed: options.allowed ?? allowed }); return response; };
  return { db, actor, allowed, workflow, evidence };
}
async function setup(f, criteria = [{ id: 'quality', text: 'Meets the quality bar', done: false }]) {
  const agreement = (await f.workflow('routes/route', { version: 0, reviewer_name: 'Owner', acceptance: criteria }, 'PATCH')).result;
  const output = (await f.workflow('outputs', { workspace_id: 'ws', task_id: 'route', title: 'Deliverable', content: 'EXACT_OUTPUT', reviewer_name: 'Owner' })).result;
  const version = f.db.prepare('SELECT * FROM output_versions WHERE output_id=?').get(output.id);
  return { agreement, output, version };
}

test('policy reads default safely before a Route agreement exists and cannot enable without criteria', async () => {
  const f = fixture(); try {
    const state = await f.evidence('GET', 'routes/route/acceptance-policy');
    assert.deepEqual(state.result.route, { id: 'route', agreement_version: 0, criteria: [] }); assert.equal(state.result.policy.policy_version, 1);
    await assert.rejects(f.evidence('POST', 'routes/route/acceptance-policy', { route_version: 0, confirmed: true }), error => error.code === 'agreement_required');
  } finally { f.db.close(); }
});

test('v2 policy requires exact per-criterion passes and snapshots them atomically with approval', async () => {
  const f = fixture(); try {
    const { agreement, output, version } = await setup(f, [{ id: 'quality', text: 'Meets quality', done: false }, { id: 'scope', text: 'Covers scope', done: false }]);
    const before = await f.evidence('GET', 'routes/route/acceptance-policy'); assert.equal(before.result.policy.policy_version, 1);
    const enabled = await f.evidence('POST', 'routes/route/acceptance-policy', { route_version: agreement.version, confirmed: true, request_id: 'enable' }); assert.equal(enabled.result.policy.policy_version, 2);
    const review = () => f.workflow(`outputs/${output.id}/review`, { version: output.version, version_id: version.id, decision: 'approved', reviewer_name: 'Owner' });
    await assert.rejects(review(), error => error.code === 'acceptance_evidence_required');
    for (const criterion of agreement.acceptance) {
      const body = { output_version: output.version, output_version_id: version.id, agreement_version: agreement.version, criterion_id: criterion.id, decision: 'passed', rationale: `${criterion.id} checked`, artifact: { type: 'output_version', id: version.id }, request_id: `assess-${criterion.id}` };
      const assessment = (await f.evidence('POST', `outputs/${output.id}/acceptance-evidence`, body)).result;
      assert.equal(assessment.output_version_id, version.id); assert.equal(assessment.artifact.hash, assessment.output_content_hash);
      assert.equal((await f.evidence('POST', `outputs/${output.id}/acceptance-evidence`, body)).result.id, assessment.id);
    }
    const detail = (await f.evidence('GET', `outputs/${output.id}/acceptance-evidence`)).result;
    assert.equal(detail.coverage.complete, true); assert.equal(detail.available_artifacts[0].id, version.id);
    const approved = (await review()).result; assert.equal(approved.acceptance_snapshot.criteria.length, 2);
    const after = acceptanceEvidenceDetail({ db: f.db, outputId: output.id, actor: f.actor, allowed: f.allowed });
    assert.equal(after.accepted_reviews[0].review_id, approved.id); assert.equal(after.accepted_reviews[0].output_version_id, version.id);
    assert.equal(f.db.prepare('SELECT status FROM tasks WHERE id=?').get('route').status, 'backlog', 'approval never auto-completes the Route');
  } finally { f.db.close(); }
});

test('criterion or output changes invalidate current coverage without rewriting immutable history', async () => {
  const f = fixture(); try {
    let { agreement, output, version } = await setup(f);
    const original = { output_version: output.version, output_version_id: version.id, agreement_version: agreement.version };
    await f.evidence('POST', 'routes/route/acceptance-policy', { route_version: agreement.version, confirmed: true });
    const assess = (decision, request_id) => f.evidence('POST', `outputs/${output.id}/acceptance-evidence`, { output_version: output.version, output_version_id: version.id, agreement_version: agreement.version, criterion_id: 'quality', decision, rationale: `${decision} rationale`, artifact: { type: 'output_version', id: version.id }, request_id });
    const passed = (await assess('passed', 'pass')).result, failed = (await assess('failed', 'fail')).result;
    f.db.exec('DROP TRIGGER route_acceptance_assessments_immutable');
    f.db.prepare("UPDATE route_acceptance_assessments SET created_at='2026-09-24T00:00:00.000Z' WHERE id IN (?,?)").run(passed.id, failed.id);
    f.db.exec("CREATE TRIGGER route_acceptance_assessments_immutable BEFORE UPDATE ON route_acceptance_assessments BEGIN SELECT RAISE(ABORT,'Acceptance assessments are immutable'); END");
    let detail = (await f.evidence('GET', `outputs/${output.id}/acceptance-evidence`)).result;
    assert.equal(detail.coverage.cases[0].assessment_id, failed.id); assert.equal(detail.coverage.cases[0].status, 'failed');
    agreement = (await f.workflow('routes/route', { version: agreement.version, acceptance: [{ id: 'quality', text: 'Changed quality wording', done: false }] }, 'PATCH')).result;
    detail = (await f.evidence('GET', `outputs/${output.id}/acceptance-evidence`)).result; assert.equal(detail.coverage.missing, 1); assert.equal(detail.assessments.length, 2);
    version = (await f.workflow(`outputs/${output.id}/versions`, { version: output.version, content: 'NEW_EXACT_OUTPUT' })).result;
    output = f.db.prepare('SELECT * FROM outputs WHERE id=?').get(output.id);
    detail = (await f.evidence('GET', `outputs/${output.id}/acceptance-evidence`)).result; assert.equal(detail.coverage.output_version_id, version.id); assert.equal(detail.coverage.missing, 1);
    await assert.rejects(f.evidence('POST', `outputs/${output.id}/acceptance-evidence`, { ...original, criterion_id: 'quality', decision: 'passed', rationale: 'Stale review', artifact: { type: 'output_version', id: original.output_version_id }, request_id: 'stale' }), error => error.code === 'stale_output');
  } finally { f.db.close(); }
});

test('assessment mutations reject agents, cross-output artifacts and forged fields without launching work', async () => {
  const f = fixture(); try {
    const { agreement, output, version } = await setup(f), other = (await f.workflow('outputs', { workspace_id: 'ws', task_id: 'route', title: 'Other', content: 'OTHER' })).result, otherVersion = f.db.prepare('SELECT * FROM output_versions WHERE output_id=?').get(other.id);
    await f.evidence('POST', 'routes/route/acceptance-policy', { route_version: agreement.version, confirmed: true });
    const base = { output_version: output.version, output_version_id: version.id, agreement_version: agreement.version, criterion_id: 'quality', decision: 'passed', rationale: 'Human checked', artifact: { type: 'output_version', id: version.id } };
    await assert.rejects(f.evidence('POST', `outputs/${output.id}/acceptance-evidence`, { ...base, reviewer_id: 'forged' }), /unsupported fields/);
    await assert.rejects(f.evidence('POST', `outputs/${output.id}/acceptance-evidence`, { ...base, artifact: { type: 'output_version', id: otherVersion.id } }), error => error.code === 'stale_output');
    await assert.rejects(f.evidence('POST', `outputs/${output.id}/acceptance-evidence`, base, { actor: { id: 'agent', mode: 'agent' } }), error => error.statusCode === 403);
    assert.equal(f.db.prepare('SELECT count(*) n FROM route_acceptance_assessments').get().n, 0); assert.equal(f.db.prepare('SELECT count(*) n FROM runs').get().n, 0);
  } finally { f.db.close(); }
});

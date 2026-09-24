import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { installAgentProfiles, snapshotAgentProfile } from '../server/agent-profiles.mjs';
import { captureSourceAccess } from '../server/context-source-access.mjs';
import { captureRunContext, installRunContextStore } from '../server/run-context-store.mjs';
import { installSkills } from '../server/skills-service.mjs';
import { installWorkflow } from '../server/workflow-service.mjs';
import {
  aggregateRunUsage,
  beginRunUsage,
  finalizeInterruptedRunUsage,
  finalizeRunUsage,
  getRunUsage,
  installRunUsage,
  recordRunUsage,
} from '../server/run-usage-service.mjs';

const actor = { id: 'local-owner', mode: 'account', name: 'Owner' };
const at = '2026-09-24T12:00:00.000Z';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  if (!db.prepare("PRAGMA table_info(runs)").all().some(column => column.name === 'agent_id')) db.exec('ALTER TABLE runs ADD COLUMN agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL');
  installAgentProfiles(db); installSkills(db); installWorkflow(db); installRunContextStore(db); installRunUsage(db);
  db.prepare('INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run('ws', 'Workspace', 'workspace', at, at);
  db.prepare(`INSERT INTO agents(id,workspace_id,name,provider,role,description,instructions,status,model,context_source_ids_json,permission_policy,output_behavior,version,color,created_at,updated_at)
    VALUES('agent','ws','Researcher','codex','','','','available','gpt-fixture','[]','read-only','',1,'#8b95a5',?,?)`).run(at, at);
  snapshotAgentProfile(db, 'agent', at);
  const allowed = () => true, filter = value => value;
  return { db, allowed, filter };
}

function addRun(db, id, { provider = 'codex', mode = 'live', agentId = 'agent', projectId = null, status = 'running', createdAt = at } = {}) {
  db.prepare(`INSERT INTO runs(id,workspace_id,provider,agent_name,status,title,mode,work_mode,started_at,created_at,updated_at,agent_id,agent_profile_version,project_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, 'ws', provider, agentId === 'agent' ? 'Researcher' : 'Other', status, id, mode, 'conversation', createdAt, createdAt, createdAt, agentId, agentId === 'agent' ? 1 : null, projectId);
  if (mode === 'live' && ['codex', 'claude'].includes(provider)) {
    const manifest = { resolved: { workspace_id: 'ws', project_id: projectId, task_id: null, area_id: null, agent_id: agentId }, included: [{ kind: 'run', id }], excluded: [], fingerprint: `fingerprint-${id}` };
    captureRunContext(db, id, { finalPrompt: 'PRIVATE PROMPT MUST NOT ENTER USAGE', manifest, sourceAccess: captureSourceAccess(db, { manifest }) });
  }
}

test('canonical Codex usage is immutable, idempotent, and reports cached/reasoning tokens without double counting', () => {
  const { db, allowed, filter } = fixture();
  try {
    addRun(db, 'codex-run');
    assert.deepEqual(beginRunUsage(db, 'codex-run'), { run_id: 'codex-run', eligible: true, replayed: false });
    assert.equal(beginRunUsage(db, 'codex-run').replayed, true);
    const report = { provider: 'codex', source: 'turn.completed', main: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, reasoning_output_tokens: 5 } };
    const first = recordRunUsage(db, 'codex-run', report);
    assert.equal(recordRunUsage(db, 'codex-run', report).duplicate, true);
    finalizeRunUsage(db, 'codex-run', { status: 'completed' });
    assert.equal(finalizeRunUsage(db, 'codex-run', { status: 'completed', reason: 'ignored_second_reason' }).replayed, true);
    assert.equal(recordRunUsage(db, 'codex-run', report).report_id, first.report_id, 'an exact terminal callback remains harmless');
    const detail = getRunUsage({ db, runId: 'codex-run', actor, allowed, filter });
    assert.equal(detail.state, 'reported'); assert.equal(detail.terminal_report_complete, true);
    assert.equal(detail.families[0].metrics.input_tokens.value, 100);
    assert.equal(detail.families[0].metrics.cached_input_tokens.value, 40);
    assert.equal(detail.families[0].metrics.reasoning_output_tokens.value, 5);
    assert.equal(detail.invocation.model, 'gpt-fixture');
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM run_usage_invocations').get()).includes('PRIVATE PROMPT'), false);
    assert.throws(() => db.prepare("UPDATE run_usage_reports SET report_json='{}'").run(), /immutable/);
    assert.throws(() => db.prepare("UPDATE run_usage_invocations SET model='changed'").run(), /immutable/);
  } finally { db.close(); }
});

test('Claude keeps main-loop, all-model, and estimated-cost families separate while failed reports remain partial', () => {
  const { db, allowed, filter } = fixture();
  try {
    addRun(db, 'claude-run', { provider: 'claude' }); beginRunUsage(db, 'claude-run');
    recordRunUsage(db, 'claude-run', { provider: 'claude', source: 'result', result_subtype: 'success', main: { input_tokens: 11, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 7 }, all_models: { input_tokens: 19, cache_creation_input_tokens: 4, cache_read_input_tokens: 5, output_tokens: 9, model_count: 2 }, estimated_cost_usd: 0.0123 });
    finalizeRunUsage(db, 'claude-run', { status: 'failed', reason: 'provider_error' });
    const detail = getRunUsage({ db, runId: 'claude-run', actor, allowed, filter });
    assert.equal(detail.state, 'partial'); assert.equal(detail.terminal_report_complete, false);
    assert.deepEqual(detail.families.map(family => family.id), ['claude.main_loop', 'claude.all_models']);
    assert.equal(detail.families[0].metrics.input_tokens.value, 11);
    assert.equal(detail.families[1].metrics.input_tokens.value, 19);
    assert.equal(detail.estimate.total_cost_usd.value, 0.0123);

    addRun(db, 'claude-error', { provider: 'claude', createdAt: '2026-09-24T12:01:00.000Z' }); beginRunUsage(db, 'claude-error');
    recordRunUsage(db, 'claude-error', { provider: 'claude', source: 'result', result_subtype: 'error_during_execution', main: { input_tokens: 0, output_tokens: 0 }, all_models: { input_tokens: 0, output_tokens: 0, model_count: 0 }, estimated_cost_usd: 0 });
    finalizeRunUsage(db, 'claude-error', { status: 'failed', reason: 'provider_error' });
    const unknown = getRunUsage({ db, runId: 'claude-error', actor, allowed, filter });
    assert.equal(unknown.state, 'unknown'); assert.equal(unknown.estimate.total_cost_usd.known, false);
    assert.equal(unknown.families[0].metrics.input_tokens.value, null);
  } finally { db.close(); }
});

test('conflicting final reports are ambiguous and never silently summed', () => {
  const { db, allowed, filter } = fixture();
  try {
    addRun(db, 'ambiguous'); beginRunUsage(db, 'ambiguous');
    recordRunUsage(db, 'ambiguous', { provider: 'codex', source: 'turn.completed', main: { input_tokens: 10, output_tokens: 2 } });
    recordRunUsage(db, 'ambiguous', { provider: 'codex', source: 'turn.completed', main: { input_tokens: 12, output_tokens: 2 } });
    finalizeRunUsage(db, 'ambiguous', { status: 'completed' });
    const detail = getRunUsage({ db, runId: 'ambiguous', actor, allowed, filter });
    assert.equal(detail.state, 'ambiguous'); assert.equal(detail.report_count, 2);
    assert.equal(detail.families[0].metrics.input_tokens.value, null);
  } finally { db.close(); }
});

test('aggregates filter inaccessible runs before every denominator and retain old-run unknown coverage', () => {
  const { db, allowed } = fixture();
  try {
    db.prepare(`INSERT INTO agents(id,workspace_id,name,provider,status,context_source_ids_json,permission_policy,output_behavior,version,color,created_at,updated_at)
      VALUES('denied','ws','Denied','codex','available','[]','read-only','',1,'#8b95a5',?,?)`).run(at, at);
    snapshotAgentProfile(db, 'denied', at);
    addRun(db, 'known'); beginRunUsage(db, 'known'); recordRunUsage(db, 'known', { provider: 'codex', source: 'turn.completed', main: { input_tokens: 8 } }); finalizeRunUsage(db, 'known', { status: 'completed' });
    addRun(db, 'old-unknown', { createdAt: '2026-09-24T11:59:00.000Z' });
    addRun(db, 'hidden', { agentId: 'denied', createdAt: '2026-09-24T11:58:00.000Z' }); beginRunUsage(db, 'hidden'); recordRunUsage(db, 'hidden', { provider: 'codex', source: 'turn.completed', main: { input_tokens: 1000 } }); finalizeRunUsage(db, 'hidden', { status: 'completed' });
    addRun(db, 'simulation', { mode: 'mock' });
    const filter = value => ({ ...value, runs: value.runs?.filter(run => run.agent_id !== 'denied') });
    const url = new URL('http://localhost/usage?workspace_id=ws&group_by=agent');
    const result = aggregateRunUsage({ db, url, actor, allowed, filter });
    assert.equal(result.totals.eligible_run_count, 2);
    assert.equal(result.totals.reported_run_count, 1);
    assert.equal(result.totals.unknown_run_count, 1);
    assert.equal(result.totals.families[0].metrics.input_tokens.known_subtotal, 8);
    assert.equal(result.totals.families[0].metrics.input_tokens.unknown_eligible_run_count, 1);
    assert.equal(JSON.stringify(result).includes('1000'), false);
    assert.equal(result.scope.bounded_window, true);
  } finally { db.close(); }
});

test('simulations are ineligible and unfinished ledgers finalize as interrupted without zero usage', () => {
  const { db, allowed, filter } = fixture();
  try {
    addRun(db, 'mock', { mode: 'mock' });
    assert.deepEqual(beginRunUsage(db, 'mock'), { run_id: 'mock', eligible: false });
    addRun(db, 'interrupted'); beginRunUsage(db, 'interrupted');
    assert.equal(finalizeInterruptedRunUsage(db), 1);
    const detail = getRunUsage({ db, runId: 'interrupted', actor, allowed, filter });
    assert.equal(detail.state, 'unknown'); assert.equal(detail.invocation.terminal_status, 'interrupted');
    assert.equal(detail.families[0].metrics.input_tokens.value, null);
  } finally { db.close(); }
});

test('non-numeric and unsafe metrics remain null, unsupported terminal sources reject without persistence', () => {
  const { db, allowed, filter } = fixture();
  try {
    addRun(db, 'invalid'); beginRunUsage(db, 'invalid');
    for (const source of ['assistant', 'system', undefined]) assert.throws(() => recordRunUsage(db, 'invalid', { provider: 'codex', source, main: { input_tokens: 1 } }), { statusCode: 400 });
    assert.throws(() => recordRunUsage(db, 'invalid', { provider: 'claude', source: 'result', main: { input_tokens: 1 } }), { errorCode: 'usage_provider_mismatch' });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM run_usage_reports').get().n, 0);
    recordRunUsage(db, 'invalid', { provider: 'codex', source: 'turn.completed', main: { input_tokens: '0', cached_input_tokens: -1, output_tokens: Number.MAX_SAFE_INTEGER + 1, reasoning_output_tokens: 1.5 } });
    finalizeRunUsage(db, 'invalid', { status: 'completed' });
    const detail = getRunUsage({ db, runId: 'invalid', actor, allowed, filter });
    assert.equal(detail.state, 'unknown');
    for (const metric of Object.values(detail.families[0].metrics)) assert.deepEqual(metric, { value: null, known: false });
  } finally { db.close(); }
});

test('Claude model count is metadata, not a usage observation or evidence for reliable error zeros', () => {
  const { db, allowed, filter } = fixture();
  try {
    addRun(db, 'models-only', { provider: 'claude' }); beginRunUsage(db, 'models-only');
    recordRunUsage(db, 'models-only', { provider: 'claude', source: 'result', result_subtype: 'success', all_models: { model_count: 1 } });
    finalizeRunUsage(db, 'models-only', { status: 'completed' });
    assert.equal(getRunUsage({ db, runId: 'models-only', actor, allowed, filter }).state, 'unknown');
    addRun(db, 'error-models', { provider: 'claude' }); beginRunUsage(db, 'error-models');
    recordRunUsage(db, 'error-models', { provider: 'claude', source: 'result', result_subtype: 'error_during_execution', main: { input_tokens: 0, output_tokens: 0 }, all_models: { input_tokens: 0, output_tokens: 0, model_count: 1 }, estimated_cost_usd: 0 });
    finalizeRunUsage(db, 'error-models', { status: 'failed' });
    const detail = getRunUsage({ db, runId: 'error-models', actor, allowed, filter });
    assert.equal(detail.state, 'unknown'); assert.equal(detail.estimate.total_cost_usd.known, false);
    for (const family of detail.families) for (const [key, metric] of Object.entries(family.metrics)) if (key !== 'model_count') assert.deepEqual(metric, { value: null, known: false });
  } finally { db.close(); }
});

test('fractional provider estimates plus integer zero remain valid sums rather than token overflow', () => {
  const { db, allowed, filter } = fixture();
  try {
    for (const [id, cost, stamp] of [['decimal', 0.1, '2026-09-24T12:01:00.000Z'], ['zero', 0, '2026-09-24T12:00:00.000Z']]) {
      addRun(db, id, { provider: 'claude', createdAt: stamp }); beginRunUsage(db, id);
      recordRunUsage(db, id, { provider: 'claude', source: 'result', result_subtype: 'success', estimated_cost_usd: cost });
      finalizeRunUsage(db, id, { status: 'completed' });
    }
    const result = aggregateRunUsage({ db, url: new URL('http://localhost/usage?workspace_id=ws&group_by=agent'), actor, allowed, filter });
    assert.equal(result.totals.estimate.known_subtotal, 0.1);
    assert.equal(result.totals.estimate.subtotal_overflow, false); assert.equal(result.totals.estimate.reporting_run_count, 2);
  } finally { db.close(); }
});

test('unsafe aggregate tokens and infinite aggregate costs explicitly lose subtotals but retain coverage', () => {
  const { db, allowed, filter } = fixture();
  try {
    for (const id of ['first', 'second']) {
      addRun(db, id, { provider: 'claude' }); beginRunUsage(db, id);
      recordRunUsage(db, id, { provider: 'claude', source: 'result', main: { input_tokens: Number.MAX_SAFE_INTEGER }, estimated_cost_usd: Number.MAX_VALUE });
      finalizeRunUsage(db, id, { status: 'completed' });
    }
    const result = aggregateRunUsage({ db, url: new URL('http://localhost/usage?workspace_id=ws&group_by=agent'), actor, allowed, filter });
    const metric = result.totals.families.find(item => item.id === 'claude.main_loop').metrics.input_tokens;
    assert.equal(metric.known_subtotal, null); assert.equal(metric.subtotal_overflow, true); assert.equal(metric.reporting_run_count, 2);
    assert.equal(result.totals.estimate.known_subtotal, null); assert.equal(result.totals.estimate.subtotal_overflow, true); assert.equal(result.totals.estimate.reporting_run_count, 2);
  } finally { db.close(); }
});

test('parent deletion is not blocked by immutable provenance and workspace cleanup removes usage records', () => {
  const { db, allowed, filter } = fixture();
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.prepare("INSERT INTO projects(id,workspace_id,name,identifier,created_at,updated_at) VALUES('parent-project','ws','Parent','P',?,?)").run(at, at);
    addRun(db, 'parent-delete', { projectId: 'parent-project' }); beginRunUsage(db, 'parent-delete');
    recordRunUsage(db, 'parent-delete', { provider: 'codex', source: 'turn.completed', main: { input_tokens: 3 } });
    finalizeRunUsage(db, 'parent-delete', { status: 'completed' });
    assert.doesNotThrow(() => db.prepare("DELETE FROM projects WHERE id='parent-project'").run());
    assert.equal(db.prepare("SELECT project_id FROM run_usage_invocations WHERE run_id='parent-delete'").get().project_id, 'parent-project');
    assert.doesNotThrow(() => db.prepare("DELETE FROM agents WHERE id='agent'").run());
    assert.equal(db.prepare("SELECT agent_id FROM run_usage_invocations WHERE run_id='parent-delete'").get().agent_id, 'agent');
    assert.throws(() => getRunUsage({ db, runId: 'parent-delete', actor, allowed, filter }), { statusCode: 403 });
    assert.doesNotThrow(() => db.prepare("DELETE FROM workspaces WHERE id='ws'").run());
    assert.equal(db.prepare('SELECT COUNT(*) n FROM run_usage_invocations').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM run_usage_reports').get().n, 0);
  } finally { db.close(); }
});

test('a persisted report with failed capture remains partial even when canonical execution completed', () => {
  const { db, allowed, filter } = fixture();
  try {
    addRun(db, 'capture-failed'); beginRunUsage(db, 'capture-failed');
    recordRunUsage(db, 'capture-failed', { provider: 'codex', source: 'turn.completed', main: { input_tokens: 3 } });
    finalizeRunUsage(db, 'capture-failed', { status: 'completed', reason: 'usage_persistence_failed' });
    const detail = getRunUsage({ db, runId: 'capture-failed', actor, allowed, filter });
    assert.equal(detail.state, 'partial'); assert.equal(detail.terminal_report_complete, false);
    assert.equal(detail.families[0].metrics.input_tokens.value, 3);
  } finally { db.close(); }
});

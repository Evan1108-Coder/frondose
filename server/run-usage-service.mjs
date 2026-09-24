import { createHash, randomUUID } from 'node:crypto';
import { captureSourceAccess, assertSourceAccess } from './context-source-access.mjs';
import { manualWorkflowVisible } from './manual-workflow-service.mjs';
import { readRunContext } from './run-context-store.mjs';
import { validationError } from './validation.mjs';

const ACCESSIBLE_LIMIT = 5000;
const PAGE_SIZE = 250;
const TERMINAL = new Set(['completed', 'failed', 'stopped', 'interrupted']);
const CLAUDE_RESULT_SUBTYPES = new Set(['success', 'error_during_execution', 'error_max_turns', 'error_max_budget_usd', 'error_max_structured_output_retries']);
const now = () => new Date().toISOString();
const uid = prefix => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, errorCode = 'invalid_usage', statusCode = 400) => { throw Object.assign(new Error(message), { code: errorCode, errorCode, statusCode }); };
const parse = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
const tableExists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const token = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const FAMILY_METRICS = Object.freeze({
  'codex.main': ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens'],
  'claude.main_loop': ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'],
  'claude.all_models': ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens', 'model_count'],
});
const FAMILY_LABELS = Object.freeze({
  'codex.main': 'Codex main turn',
  'claude.main_loop': 'Claude main loop',
  'claude.all_models': 'Claude all-model usage',
});

function normalizeFamily(value, fields) {
  const result = {};
  for (const field of fields) result[field] = token(value?.[field]);
  return result;
}

function normalizeReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) fail('Usage report must be an object.');
  if (!['codex', 'claude'].includes(report.provider)) fail('Usage report provider is unsupported.');
  if (report.source !== (report.provider === 'codex' ? 'turn.completed' : 'result')) fail('Usage report source does not match the provider terminal event.');
  if (report.provider === 'codex') return {
    provider: 'codex', source: report.source,
    main: normalizeFamily(report.main, FAMILY_METRICS['codex.main']),
  };
  const normalized = {
    provider: 'claude', source: report.source,
    result_subtype: CLAUDE_RESULT_SUBTYPES.has(report.result_subtype) ? report.result_subtype : null,
    main: normalizeFamily(report.main, FAMILY_METRICS['claude.main_loop']),
    all_models: normalizeFamily(report.all_models, FAMILY_METRICS['claude.all_models']),
    estimated_cost_usd: money(report.estimated_cost_usd),
  };
  const observed = [...Object.values(normalized.main), ...Object.entries(normalized.all_models).filter(([key]) => key !== 'model_count').map(([, value]) => value), normalized.estimated_cost_usd].filter(value => value !== null);
  // Claude documents zero-valued usage on some execution-error results as
  // unreliable. Preserve the error subtype, but never present those zeros as
  // a measured observation.
  if (normalized.result_subtype === 'error_during_execution' && observed.length && observed.every(value => value === 0)) {
    for (const family of [normalized.main, normalized.all_models]) for (const key of Object.keys(family)) family[key] = null;
    normalized.estimated_cost_usd = null;
  }
  return normalized;
}

function workflowLink(db, runId) {
  if (!tableExists(db, 'work_plan_step_runs') || !tableExists(db, 'work_plan_runs')) return null;
  const rows = db.prepare(`SELECT wr.id workflow_run_id,wr.plan_id workflow_id
    FROM work_plan_step_runs sr JOIN work_plan_runs wr ON wr.id=sr.run_id
    WHERE sr.canonical_run_id=?`).all(runId);
  if (rows.length > 1) fail('The canonical run is linked to multiple workflow attempts.', 'ambiguous_workflow', 409);
  return rows[0] || null;
}

function profileModel(db, run) {
  if (!run.agent_id || !Number.isSafeInteger(run.agent_profile_version) || !tableExists(db, 'agent_profile_versions')) return null;
  const row = db.prepare('SELECT snapshot_json,snapshot_hash FROM agent_profile_versions WHERE agent_id=? AND version=?').get(run.agent_id, run.agent_profile_version);
  if (!row || hash(row.snapshot_json) !== row.snapshot_hash) return null;
  const snapshot = parse(row.snapshot_json);
  return typeof snapshot?.model === 'string' ? snapshot.model : null;
}

function sourceAccessForRun(db, run) {
  return captureSourceAccess(db, { manifest: { resolved: {
    workspace_id: run.workspace_id, project_id: run.project_id || null, task_id: run.task_id || null,
    area_id: null, agent_id: run.agent_id || null,
  }, included: [{ kind: 'run', id: run.id }], excluded: [] } });
}

function invocation(db, runId) {
  const row = db.prepare('SELECT * FROM run_usage_invocations WHERE run_id=?').get(runId);
  return row ? { ...row, source_access: parse(row.source_access_json), source_access_json: undefined } : null;
}

export function installRunUsage(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS run_usage_invocations (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    mode TEXT NOT NULL,
    agent_id TEXT,
    agent_profile_version INTEGER,
    model TEXT,
    project_id TEXT,
    task_id TEXT,
    workflow_id TEXT,
    workflow_run_id TEXT,
    context_fingerprint TEXT NOT NULL,
    source_access_json TEXT NOT NULL,
    started_at TEXT NOT NULL,
    terminal_status TEXT,
    terminal_reason TEXT,
    finalized_at TEXT
  );
  CREATE TABLE IF NOT EXISTS run_usage_reports (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES run_usage_invocations(run_id) ON DELETE CASCADE,
    report_hash TEXT NOT NULL,
    report_json TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    UNIQUE(run_id,report_hash)
  );
  CREATE INDEX IF NOT EXISTS run_usage_scope ON run_usage_invocations(workspace_id,started_at DESC);
  CREATE TRIGGER IF NOT EXISTS run_usage_invocation_identity_immutable
    BEFORE UPDATE OF run_id,workspace_id,provider,mode,agent_id,agent_profile_version,model,project_id,task_id,workflow_id,workflow_run_id,context_fingerprint,source_access_json,started_at
    ON run_usage_invocations BEGIN SELECT RAISE(ABORT,'run usage invocation provenance is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS run_usage_invocation_final_once
    BEFORE UPDATE OF terminal_status,terminal_reason,finalized_at ON run_usage_invocations
    WHEN OLD.finalized_at IS NOT NULL AND (NEW.terminal_status IS NOT OLD.terminal_status OR NEW.terminal_reason IS NOT OLD.terminal_reason OR NEW.finalized_at IS NOT OLD.finalized_at)
    BEGIN SELECT RAISE(ABORT,'run usage finalization is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS run_usage_reports_immutable BEFORE UPDATE ON run_usage_reports
    BEGIN SELECT RAISE(ABORT,'run usage reports are immutable'); END;`);
}

export function beginRunUsage(db, runId) {
  const run = db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
  if (!run) fail('Canonical run not found.', 'not_found', 404);
  if (run.mode !== 'live' || !['codex', 'claude'].includes(run.provider)) return { run_id: runId, eligible: false };
  const context = readRunContext(db, runId);
  if (!context?.inspection?.manifest?.fingerprint) fail('Canonical usage requires an immutable captured context.', 'run_context_not_recorded', 409);
  const linked = workflowLink(db, runId), captured = sourceAccessForRun(db, run);
  const record = {
    run_id: run.id, workspace_id: run.workspace_id, provider: run.provider, mode: 'independent',
    agent_id: run.agent_id || null, agent_profile_version: Number.isSafeInteger(run.agent_profile_version) ? run.agent_profile_version : null,
    model: profileModel(db, run), project_id: run.project_id || null, task_id: run.task_id || null,
    workflow_id: linked?.workflow_id || null, workflow_run_id: linked?.workflow_run_id || null,
    context_fingerprint: context.inspection.manifest.fingerprint, source_access_json: JSON.stringify(captured),
    started_at: run.started_at || run.created_at || now(),
  };
  const existing = db.prepare('SELECT * FROM run_usage_invocations WHERE run_id=?').get(runId);
  if (existing) {
    for (const [key, value] of Object.entries(record)) if (existing[key] !== value) fail('This run already has different usage provenance.', 'usage_provenance_conflict', 409);
    return { run_id: runId, eligible: true, replayed: true };
  }
  db.prepare(`INSERT INTO run_usage_invocations
    (run_id,workspace_id,provider,mode,agent_id,agent_profile_version,model,project_id,task_id,workflow_id,workflow_run_id,context_fingerprint,source_access_json,started_at)
    VALUES (@run_id,@workspace_id,@provider,@mode,@agent_id,@agent_profile_version,@model,@project_id,@task_id,@workflow_id,@workflow_run_id,@context_fingerprint,@source_access_json,@started_at)`).run(record);
  return { run_id: runId, eligible: true, replayed: false };
}

export function recordRunUsage(db, runId, report) {
  const tracked = invocation(db, runId);
  if (!tracked) fail('Run usage was not initialized.', 'usage_not_initialized', 409);
  const normalized = normalizeReport(report);
  if (normalized.provider !== tracked.provider) fail('Usage report provider does not match the canonical run.', 'usage_provider_mismatch', 409);
  const json = JSON.stringify(normalized), reportHash = hash(json);
  const existing = db.prepare('SELECT * FROM run_usage_reports WHERE run_id=? AND report_hash=?').get(runId, reportHash);
  if (existing) return { run_id: runId, report_id: existing.id, duplicate: true };
  if (tracked.finalized_at) fail('Run usage is already finalized.', 'usage_finalized', 409);
  const id = uid('usage_report');
  db.prepare('INSERT INTO run_usage_reports VALUES(?,?,?,?,?)').run(id, runId, reportHash, json, now());
  return { run_id: runId, report_id: id, duplicate: false };
}

export function finalizeRunUsage(db, runId, { status, reason = null } = {}) {
  if (!TERMINAL.has(status)) throw validationError('Choose a terminal canonical run status.');
  if (reason !== null && (typeof reason !== 'string' || reason.length > 120 || /[\u0000-\u001f]/.test(reason))) throw validationError('Usage finalization reason must be a bounded error code.');
  const row = db.prepare('SELECT * FROM run_usage_invocations WHERE run_id=?').get(runId);
  if (!row) return { run_id: runId, eligible: false };
  if (row.finalized_at) {
    if (row.terminal_status !== status) fail('Run usage was finalized with a different terminal status.', 'usage_finalization_conflict', 409);
    return { run_id: runId, eligible: true, replayed: true, status: row.terminal_status };
  }
  const stamp = now();
  db.prepare('UPDATE run_usage_invocations SET terminal_status=?,terminal_reason=?,finalized_at=? WHERE run_id=? AND finalized_at IS NULL').run(status, reason, stamp, runId);
  return { run_id: runId, eligible: true, replayed: false, status };
}

export function finalizeInterruptedRunUsage(db, reason = 'server_interrupted') {
  if (typeof reason !== 'string' || reason.length > 120) throw validationError('Choose a bounded interruption reason.');
  const stamp = now();
  return db.prepare("UPDATE run_usage_invocations SET terminal_status='interrupted',terminal_reason=?,finalized_at=? WHERE finalized_at IS NULL").run(reason, stamp).changes;
}

function reports(db, runId) {
  return db.prepare('SELECT * FROM run_usage_reports WHERE run_id=? ORDER BY observed_at,id').all(runId).map(row => ({ ...row, report: parse(row.report_json) }));
}

function hasMetric(report) {
  return Object.values(report?.main || {}).some(value => value !== null)
    || Object.entries(report?.all_models || {}).some(([key, value]) => key !== 'model_count' && value !== null)
    || report?.estimated_cost_usd !== null && report?.estimated_cost_usd !== undefined;
}

function detailFamilies(provider, report) {
  const ids = provider === 'codex' ? ['codex.main'] : provider === 'claude' ? ['claude.main_loop', 'claude.all_models'] : [];
  return ids.map(id => {
    const values = id === 'codex.main' || id === 'claude.main_loop' ? report?.main : report?.all_models;
    return { id, provider, label: FAMILY_LABELS[id], metrics: Object.fromEntries(FAMILY_METRICS[id].map(metric => [metric, { value: values?.[metric] ?? null, known: values?.[metric] !== null && values?.[metric] !== undefined }])) };
  });
}

function assertReadable({ db, run, tracked, actor, allowed, filter }) {
  if (!actor?.id || typeof allowed !== 'function' || typeof filter !== 'function') fail('Sign in to continue.', 'access_denied', 403);
  let visible;
  try { visible = filter({ runs: [run] })?.runs || []; } catch { visible = []; }
  if (!visible.some(item => item.id === run.id)) fail('Run usage is unavailable.', 'access_denied', 403);
  const context = readRunContext(db, run.id);
  if (tracked && (!context || context.inspection?.manifest?.fingerprint !== tracked.context_fingerprint)) fail('Run usage context provenance is unavailable.', 'context_access_revoked', 403);
  if (context) assertSourceAccess(db, context.inspection, actor, allowed);
  if (tracked) assertSourceAccess(db, { manifest: { resolved: { workspace_id: tracked.workspace_id } }, sourceAccess: tracked.source_access }, actor, allowed);
  const linked = tracked?.workflow_run_id ? db.prepare('SELECT * FROM work_plan_runs WHERE id=?').get(tracked.workflow_run_id) : workflowLink(db, run.id)?.workflow_run_id ? db.prepare('SELECT * FROM work_plan_runs WHERE id=?').get(workflowLink(db, run.id).workflow_run_id) : null;
  if (linked && !manualWorkflowVisible(db, linked, 'work_plan_runs', actor, allowed)) fail('Run usage is unavailable.', 'access_denied', 403);
  return linked;
}

export function getRunUsage({ db, runId, actor, allowed, filter }) {
  const run = db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
  if (!run) fail('Run not found.', 'not_found', 404);
  const tracked = invocation(db, runId);
  const linked = assertReadable({ db, run, tracked, actor, allowed, filter });
  const eligible = run.mode === 'live' && ['codex', 'claude'].includes(run.provider);
  const rows = tracked ? reports(db, runId) : [], ambiguous = rows.length > 1, report = rows.length === 1 ? rows[0].report : null;
  const any = hasMetric(report), terminalComplete = Boolean(tracked?.terminal_status === 'completed' && tracked.terminal_reason !== 'usage_persistence_failed' && report && !ambiguous && any && (report.provider === 'codex' || report.result_subtype === 'success'));
  const state = ambiguous ? 'ambiguous' : !eligible || !tracked || !rows.length || !any ? 'unknown' : terminalComplete ? 'reported' : 'partial';
  const workflow = linked ? db.prepare('SELECT title FROM work_plans WHERE id=?').get(linked.plan_id) : null;
  return {
    run_id: run.id, eligible, tracked: Boolean(tracked), state, terminal_report_complete: terminalComplete,
    invocation: tracked ? {
      workspace_id: tracked.workspace_id, provider: tracked.provider, mode: tracked.mode, agent_id: tracked.agent_id,
      agent_profile_version: tracked.agent_profile_version, model: tracked.model, project_id: tracked.project_id,
      task_id: tracked.task_id, workflow_id: tracked.workflow_id, workflow_run_id: tracked.workflow_run_id,
      context_fingerprint: tracked.context_fingerprint, started_at: tracked.started_at,
      terminal_status: tracked.terminal_status, terminal_reason: tracked.terminal_reason, finalized_at: tracked.finalized_at,
    } : null,
    families: detailFamilies(run.provider, ambiguous ? null : report),
    estimate: run.provider === 'claude' ? { total_cost_usd: { value: ambiguous ? null : report?.estimated_cost_usd ?? null, known: !ambiguous && report?.estimated_cost_usd !== null && report?.estimated_cost_usd !== undefined }, label: 'Provider client estimate — not billing' } : null,
    report_count: rows.length,
    workflow_label: workflow?.title || null,
    limitations: [
      'Provider token families are reported separately and are not interchangeable.',
      'Cost is a provider-client estimate, not an account charge or billing record.',
      terminalComplete ? 'This completed run recorded one terminal provider report.' : 'No complete terminal provider report is available for this run.',
    ],
  };
}

function aggregateBucket(key, label) {
  return { key, label, eligible_run_count: 0, reported_run_count: 0, unknown_run_count: 0, ambiguous_run_count: 0, partial_run_count: 0, complete_report_run_count: 0, _families: new Map(), _estimate: null };
}

function addKnown(item, value, integer = true) {
  item.reporting_run_count++;
  if (item.subtotal_overflow) return;
  if (item.known_subtotal === null) { item.known_subtotal = value; return; }
  const next = item.known_subtotal + value;
  const valid = Number.isFinite(next) && (!integer || Number.isSafeInteger(next));
  if (valid) item.known_subtotal = next;
  else { item.known_subtotal = null; item.subtotal_overflow = true; }
}

function addDetail(bucket, detail) {
  bucket.eligible_run_count++;
  bucket[`${detail.state === 'reported' ? 'reported' : detail.state}_run_count`]++;
  if (detail.terminal_report_complete) bucket.complete_report_run_count++;
  for (const family of detail.families) {
    if (!bucket._families.has(family.id)) bucket._families.set(family.id, { id: family.id, provider: family.provider, label: family.label, metrics: Object.fromEntries(Object.keys(family.metrics).map(metric => [metric, { known_subtotal: null, subtotal_overflow: false, reporting_run_count: 0, unknown_eligible_run_count: 0, complete_report_run_count: 0, partial_run_count: 0 }])) });
    const target = bucket._families.get(family.id);
    for (const [metric, reading] of Object.entries(family.metrics)) {
      const item = target.metrics[metric];
      if (reading.known && detail.state !== 'ambiguous') {
        addKnown(item, reading.value);
        if (detail.terminal_report_complete) item.complete_report_run_count++;
        else item.partial_run_count++;
      } else item.unknown_eligible_run_count++;
    }
  }
  if (detail.estimate) {
    bucket._estimate ||= { known_subtotal: null, subtotal_overflow: false, reporting_run_count: 0, unknown_eligible_run_count: 0, complete_report_run_count: 0, partial_run_count: 0, label: detail.estimate.label };
    if (detail.estimate.total_cost_usd.known && detail.state !== 'ambiguous') {
      addKnown(bucket._estimate, detail.estimate.total_cost_usd.value, false);
      if (detail.terminal_report_complete) bucket._estimate.complete_report_run_count++; else bucket._estimate.partial_run_count++;
    } else bucket._estimate.unknown_eligible_run_count++;
  }
}

function publicBucket(bucket) {
  const { _families, _estimate, ...result } = bucket;
  return { ...result, families: [..._families.values()].sort((a, b) => a.id.localeCompare(b.id)), estimate: _estimate };
}

function iso(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) throw validationError(`${label} must be an ISO date-time.`);
  return new Date(value).toISOString();
}

export function aggregateRunUsage({ db, url, actor, allowed, filter }) {
  const allowedKeys = new Set(['workspace_id', 'group_by', 'agent_id', 'project_id', 'workflow_id', 'from', 'to']);
  for (const key of url.searchParams.keys()) if (!allowedKeys.has(key) || url.searchParams.getAll(key).length !== 1) throw validationError('Choose valid usage filters.');
  const workspaceId = url.searchParams.get('workspace_id'), groupBy = url.searchParams.get('group_by');
  if (!workspaceId) throw validationError('Choose a workspace.');
  if (!['agent', 'project', 'workflow'].includes(groupBy)) throw validationError('Group usage by agent, project or Workflow.');
  const filters = { agent_id: url.searchParams.get('agent_id'), project_id: url.searchParams.get('project_id'), workflow_id: url.searchParams.get('workflow_id'), from: iso(url.searchParams.get('from'), 'From'), to: iso(url.searchParams.get('to'), 'To') };
  if (filters.from && filters.to && filters.from >= filters.to) throw validationError('The usage start must be before the end.');
  const requestedScope = filters.project_id ? { scope_type: 'project', scope_id: filters.project_id } : filters.agent_id ? { scope_type: 'agent', scope_id: filters.agent_id } : {};
  if (!actor?.id || typeof allowed !== 'function' || !allowed(workspaceId, actor, 'agents.read', requestedScope)) fail('Usage reporting is unavailable.', 'access_denied', 403);
  const visible = [];
  let cursor = null, exhausted = false;
  while (visible.length <= ACCESSIBLE_LIMIT && !exhausted) {
    const rows = db.prepare(`SELECT r.* FROM runs r LEFT JOIN run_usage_invocations ui ON ui.run_id=r.id WHERE r.workspace_id=? AND r.mode='live' AND r.provider IN ('codex','claude')
      AND (? IS NULL OR CASE WHEN ui.run_id IS NOT NULL THEN ui.agent_id=? ELSE r.agent_id=? END)
      AND (? IS NULL OR CASE WHEN ui.run_id IS NOT NULL THEN ui.project_id=? ELSE r.project_id=? END)
      AND (? IS NULL OR COALESCE((SELECT started_at FROM run_usage_invocations u WHERE u.run_id=r.id),r.started_at,r.created_at)>=?)
      AND (? IS NULL OR COALESCE((SELECT started_at FROM run_usage_invocations u WHERE u.run_id=r.id),r.started_at,r.created_at)<?)
      AND (? IS NULL OR (COALESCE((SELECT started_at FROM run_usage_invocations u WHERE u.run_id=r.id),r.started_at,r.created_at)< ? OR (COALESCE((SELECT started_at FROM run_usage_invocations u WHERE u.run_id=r.id),r.started_at,r.created_at)=? AND r.id<?)))
      ORDER BY COALESCE((SELECT started_at FROM run_usage_invocations u WHERE u.run_id=r.id),r.started_at,r.created_at) DESC,r.id DESC LIMIT ?`).all(
        workspaceId, filters.agent_id, filters.agent_id, filters.agent_id, filters.project_id, filters.project_id, filters.project_id,
        filters.from, filters.from, filters.to, filters.to,
        cursor?.time || null, cursor?.time || null, cursor?.time || null, cursor?.id || '', PAGE_SIZE,
      );
    if (rows.length < PAGE_SIZE) exhausted = true;
    if (!rows.length) break;
    const last = rows.at(-1), trackedLast = invocation(db, last.id);
    cursor = { time: trackedLast?.started_at || last.started_at || last.created_at, id: last.id };
    for (const run of rows) {
      try {
        const detail = getRunUsage({ db, runId: run.id, actor, allowed, filter });
        const linkedWorkflowId = detail.invocation?.workflow_id || workflowLink(db, run.id)?.workflow_id || null;
        if (filters.workflow_id && linkedWorkflowId !== filters.workflow_id) continue;
        detail._workflow_id = linkedWorkflowId;
        visible.push({ run, detail });
        if (visible.length > ACCESSIBLE_LIMIT) break;
      } catch (error) { if (error?.statusCode !== 403) throw error; }
    }
  }
  const bounded = visible.length > ACCESSIBLE_LIMIT;
  if (bounded) visible.length = ACCESSIBLE_LIMIT;
  const groups = new Map(), total = aggregateBucket('all', 'All accessible runs');
  for (const { run, detail } of visible) {
    const pinnedAgent = detail.tracked ? detail.invocation.agent_id : run.agent_id, pinnedProject = detail.tracked ? detail.invocation.project_id : run.project_id;
    const key = groupBy === 'agent' ? pinnedAgent || 'unassigned' : groupBy === 'project' ? pinnedProject || 'unassigned' : detail._workflow_id || 'unassigned';
    let label = groupBy === 'agent' ? run.agent_name || 'Unassigned agent' : groupBy === 'project' ? db.prepare('SELECT name FROM projects WHERE id=?').get(pinnedProject)?.name || 'No project' : detail.workflow_label || 'No Workflow';
    if (!groups.has(key)) groups.set(key, aggregateBucket(key, label));
    addDetail(groups.get(key), detail); addDetail(total, detail);
  }
  return {
    scope: { workspace_id: workspaceId, group_by: groupBy, filters, bounded_window: true, accessible_run_limit: ACCESSIBLE_LIMIT, accessible_window_truncated: bounded },
    groups: [...groups.values()].map(publicBucket).sort((a, b) => b.eligible_run_count - a.eligible_run_count || a.label.localeCompare(b.label)),
    totals: publicBucket(total),
  };
}

export async function runUsageRoute({ db, req, res, path, url, send, actor, allowed, filter }) {
  const match = path.match(/^\/runs\/([^/]+)\/usage$/);
  if (match && req.method === 'GET') {
    let runId; try { runId = decodeURIComponent(match[1]); } catch { throw validationError('Choose a valid run.'); }
    send(res, 200, { result: getRunUsage({ db, runId, actor, allowed, filter }) }); return true;
  }
  if (path === '/usage' && req.method === 'GET') { send(res, 200, { result: aggregateRunUsage({ db, url, actor, allowed, filter }) }); return true; }
  if (match || path === '/usage') fail('Usage action not found.', 'not_found', 404);
  return false;
}

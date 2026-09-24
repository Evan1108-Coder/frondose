import { assertSourceAccess, captureSourceAccess } from './context-source-access.mjs';

const SECTION_LIMIT = 24;
const CLUSTER_LIMIT = 12;
const WARNING_LIMIT = 24;
const TERMINAL_RUNS = new Set(['completed', 'failed', 'stopped', 'interrupted', 'cancelled']);
const ACTIVE_RUNS = new Set(['queued', 'starting', 'running']);
const TERMINAL_WORKFLOWS = new Set(['completed', 'failed', 'cancelled']);

const fail = (message, code = 'today_scope_unavailable', statusCode = 404) => {
  throw Object.assign(new Error(message), { code, errorCode: code, statusCode });
};
const array = value => Array.isArray(value) ? value : [];
const parse = (value, fallback = {}) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value && typeof value === 'object' ? value : fallback; }
  catch { return fallback; }
};
const timeValue = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const trim = (value, max = 360) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};
const simulation = run => ['mock', 'demo', 'simulation'].includes(run?.mode);
const compare = (a, b) => (Date.parse(b.time || b.latest_time || 0) || 0) - (Date.parse(a.time || a.latest_time || 0) || 0) || a.key.localeCompare(b.key);
const bounded = values => values.sort(compare).slice(0, SECTION_LIMIT);
const scope = (projectId, areaId) => projectId ? { scope_type: 'project', scope_id: projectId } : areaId ? { scope_type: 'team', scope_id: areaId } : {};

function item({ key, title, detail = '', view, id, projectId = null, areaId = null, kind, time = null, isSimulation = false }) {
  return Object.freeze({ key, title: trim(title, 200) || 'Untitled', detail: trim(detail), view, id, project_id: projectId, area_id: areaId, kind, time: timeValue(time), simulation: Boolean(isSimulation) });
}

/**
 * Derive the Today attention summary from an already permission-filtered
 * bootstrap snapshot. This function is deliberately read-only: it never
 * installs tables, probes providers, starts work, or records that Today opened.
 */
export function buildTodaySummary({ db, data, actor, allowed, filter = value => value, workspaceId, areaId = null, projectId = null, now = () => new Date().toISOString(), nativeService = null } = {}) {
  if (!db?.prepare || !actor?.id || typeof allowed !== 'function' || typeof filter !== 'function') throw new TypeError('Today requires db, actor, allowed, and filter services.');
  if (typeof workspaceId !== 'string' || !workspaceId) fail('Choose an accessible workspace.');
  const generatedAt = typeof now === 'function' ? now() : now;
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) throw new TypeError('Today now must return an ISO date.');
  let visible;
  try { visible = filter(data && typeof data === 'object' ? data : {}, actor) || {}; } catch { fail('Today data is unavailable.', 'today_access_denied', 403); }
  const permits = (permission, at = {}) => { try { return allowed(workspaceId, actor, permission, at) === true; } catch { return false; } };
  if (!permits('workspace.read', {})) fail('Today is unavailable in this workspace.', 'today_access_denied', 403);

  const workspace = array(visible.workspaces).find(row => row?.id === workspaceId && !row.archived_at);
  if (!workspace) fail('Choose an accessible workspace.');
  const areas = new Map(array(visible.teams).filter(row => row?.workspace_id === workspaceId && !row.archived_at && permits('workspace.read', { scope_type: 'team', scope_id: row.id })).map(row => [row.id, row]));
  const projects = new Map(array(visible.projects).filter(row => row?.workspace_id === workspaceId && !row.archived_at && (!row.team_id || areas.has(row.team_id)) && permits('projects.read', { scope_type: 'project', scope_id: row.id })).map(row => [row.id, row]));
  if (areaId && !areas.has(areaId)) fail('Choose an accessible active Area.');
  if (projectId && !projects.has(projectId)) fail('Choose an accessible active Project.');
  if (areaId && projectId && projects.get(projectId).team_id !== areaId) fail('The Project is outside the selected Area.', 'today_invalid_scope', 400);

  const inSelection = (project, area) => (!projectId || project === projectId) && (!areaId || area === areaId);
  const locate = row => {
    const project = row?.project_id ? projects.get(row.project_id) : null;
    const projectKey = project?.id || null;
    const areaKey = project?.team_id || row?.team_id || null;
    if (row?.project_id && !project || areaKey && !areas.has(areaKey)) return null;
    return inSelection(projectKey, areaKey) ? { projectId: projectKey, areaId: areaKey } : null;
  };
  const tasks = new Map(array(visible.tasks).filter(row => {
    if (!row || row.workspace_id !== workspaceId || row.archived_at) return false;
    const where = locate(row); return where && permits('routes.read', scope(where.projectId, where.areaId));
  }).map(row => [row.id, row]));
  const runs = array(visible.runs).filter(row => {
    if (!row || row.workspace_id !== workspaceId) return false;
    const task = row.task_id ? tasks.get(row.task_id) : null;
    if (row.task_id && !task) return false;
    const where = locate({ ...row, project_id: row.project_id || task?.project_id || null, team_id: task?.team_id || null });
    return where && permits('agents.read', scope(where.projectId, where.areaId));
  });
  const runById = new Map(runs.map(row => [row.id, row]));
  const runScope = run => {
    const task = run?.task_id ? tasks.get(run.task_id) : null;
    return locate({ ...run, project_id: run?.project_id || task?.project_id || null, team_id: task?.team_id || null });
  };
  const plans = new Map(array(visible.manual_workflows).filter(row => row?.workspace_id === workspaceId && row.kind === 'manual_workflow' && locate(row)).map(row => [row.id, row]));
  const workflowRuns = array(visible.manual_workflow_runs).filter(row => row?.workspace_id === workspaceId && plans.has(row.plan_id) && locate(row));
  const workflowRunById = new Map(workflowRuns.map(row => [row.id, row]));
  const attempts = array(visible.manual_workflow_step_runs).filter(row => workflowRunById.has(row?.run_id));
  const latestAttempts = new Map();
  for (const attempt of attempts) {
    const key = `${attempt.run_id}:${attempt.step_id}`, prior = latestAttempts.get(key);
    if (!prior || Number(attempt.attempt || 0) > Number(prior.attempt || 0) || Number(attempt.attempt || 0) === Number(prior.attempt || 0) && String(attempt.id).localeCompare(String(prior.id)) > 0) latestAttempts.set(key, attempt);
  }
  const attemptsFor = runId => [...latestAttempts.values()].filter(row => row.run_id === runId);
  const workflowSimulation = runId => attemptsFor(runId).some(attempt => simulation(runById.get(attempt.canonical_run_id)));
  const sections = { needs_you: [], working_now: [], ready_to_review: [], suggested_next: [], recent_context: [] };

  const failureByRun = new Map();
  for (const event of array(visible.events)) {
    const run = runById.get(event?.run_id); if (!run || event.type !== 'run.failed') continue;
    const prior = failureByRun.get(run.id);
    if (!prior || Number(event.sequence || 0) > Number(prior.sequence || 0)) failureByRun.set(run.id, event);
  }
  const recordedFailure = run => {
    const event = failureByRun.get(run.id), payload = parse(event?.payload ?? event?.payload_json, {}), raw = typeof payload.error_code === 'string' ? payload.error_code : typeof payload.code === 'string' ? payload.code : 'unknown';
    const code = /^[A-Za-z0-9_.:-]{1,120}$/.test(raw) ? raw : 'unknown';
    return { event, code, detail: code === 'unknown' ? 'Run failed without a recorded error code.' : `Run failed · recorded error code: ${code}.` };
  };

  for (const run of runs) {
    const where = runScope(run); if (!where) continue;
    const base = { projectId: where.projectId, areaId: where.areaId, view: 'work', id: run.id, isSimulation: simulation(run), time: run.updated_at || run.started_at || run.created_at };
    if (run.status === 'needs_input') sections.needs_you.push(item({ ...base, key: `run-input:${run.id}`, title: run.title, detail: `${run.agent_name || 'Agent'} is waiting for input.`, kind: 'run_needs_input' }));
    else if (ACTIVE_RUNS.has(run.status)) sections.working_now.push(item({ ...base, key: `run-active:${run.id}`, title: run.title, detail: `${run.agent_name || 'Agent'} · ${String(run.status).replaceAll('_', ' ')}`, kind: 'agent_run' }));
    else if (run.status === 'failed') { const failure = recordedFailure(run); sections.needs_you.push(item({ ...base, key: `run-failed:${run.id}`, title: run.title, detail: failure.detail, kind: 'run_failed', time: failure.event?.created_at || base.time })); }
    else if (run.status === 'paused') sections.suggested_next.push(item({ ...base, key: `run-paused:${run.id}`, title: run.title, detail: 'Paused agent run · open it to decide whether to continue.', kind: 'paused_run' }));
  }

  for (const approval of array(visible.approvals)) {
    const run = runById.get(approval?.run_id), where = runScope(run);
    if (!run || !where || approval.status !== 'pending' || TERMINAL_RUNS.has(run.status)) continue;
    sections.needs_you.push(item({ key: `approval:${approval.id}`, title: approval.title, detail: approval.detail || `Review ${run.title}.`, view: 'work', id: run.id, projectId: where.projectId, areaId: where.areaId, kind: 'run_approval', time: approval.created_at, isSimulation: simulation(run) }));
  }

  for (const workflow of workflowRuns) {
    const plan = plans.get(workflow.plan_id), where = locate(workflow), activeAttempts = attemptsFor(workflow.id);
    if (!where) continue;
    if (TERMINAL_WORKFLOWS.has(workflow.status)) continue;
    const waitingAttempt = activeAttempts.find(attempt => attempt.status === 'waiting_approval');
    const waiting = Boolean(waitingAttempt && array(visible.manual_workflow_approvals).some(approval => approval.run_id === workflow.id && approval.step_run_id === waitingAttempt.id && approval.status === 'pending'));
    const bound = activeAttempts.find(attempt => attempt.status === 'bound' && ACTIVE_RUNS.has(runById.get(attempt.canonical_run_id)?.status));
    if (bound) {
      const canonical = runById.get(bound.canonical_run_id);
      sections.working_now.push(item({ key: `workflow-active:${workflow.id}`, title: plan.title, detail: `Workflow step is executing in “${trim(canonical.title, 120)}”.`, view: 'workflows', id: `run:${workflow.id}`, projectId: where.projectId, areaId: where.areaId, kind: 'workflow_run', time: canonical.updated_at || canonical.started_at || workflow.started_at || workflow.created_at, isSimulation: simulation(canonical) }));
      continue;
    }
    if (waiting) continue; // The exact current gate is added below.
    const prepared = activeAttempts.find(attempt => attempt.status === 'prepared');
    const expired = prepared?.expires_at && Date.parse(prepared.expires_at) <= Date.parse(generatedAt);
    const detail = expired ? 'Prepared step expired · prepare it again explicitly.'
      : prepared ? 'Reviewed step is prepared · launch it explicitly to continue.'
        : workflow.status === 'needs_attention' || waitingAttempt ? 'Workflow needs attention · open it to explicitly retry or continue.'
          : 'Ready for you to explicitly start the next Workflow step.';
    if (['ready', 'pending', 'in_progress', 'needs_attention', 'waiting_approval'].includes(workflow.status)) sections.suggested_next.push(item({ key: `workflow-next:${workflow.id}`, title: plan.title, detail, view: 'workflows', id: `run:${workflow.id}`, projectId: where.projectId, areaId: where.areaId, kind: expired ? 'workflow_preparation_expired' : 'workflow_next_step', time: prepared?.expires_at || workflow.started_at || workflow.created_at, isSimulation: workflowSimulation(workflow.id) }));
  }
  for (const approval of array(visible.manual_workflow_approvals)) {
    const workflow = workflowRunById.get(approval?.run_id), attempt = latestAttempts.get(`${approval?.run_id}:${attempts.find(row => row.id === approval?.step_run_id)?.step_id}`), where = locate(workflow), plan = workflow && plans.get(workflow.plan_id);
    if (!workflow || !where || !plan || approval.status !== 'pending' || TERMINAL_WORKFLOWS.has(workflow.status) || !attempt || attempt.id !== approval.step_run_id || attempt.status !== 'waiting_approval') continue;
    sections.needs_you.push(item({ key: `workflow-approval:${approval.id}`, title: plan.title, detail: approval.prompt || 'A workflow gate needs review.', view: 'workflows', id: `run:${workflow.id}`, projectId: where.projectId, areaId: where.areaId, kind: 'workflow_approval', time: approval.created_at, isSimulation: workflowSimulation(workflow.id) }));
  }

  let pendingNativeRunIds = null;
  if (nativeService && typeof nativeService.listRunHistory === 'function') try {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_tool_requests'").get();
    pendingNativeRunIds = exists ? new Set(db.prepare("SELECT run_id FROM agent_tool_requests WHERE workspace_id=? AND status='pending_review' GROUP BY run_id ORDER BY MAX(created_at) DESC,run_id").all(workspaceId).map(row => row.run_id)) : new Set();
  } catch { /* Injected tests may provide a history service without a SQLite reader. */ }
  if (nativeService && typeof nativeService.listRunHistory === 'function') for (const run of runs.filter(run => pendingNativeRunIds == null || pendingNativeRunIds.has(run.id)).sort((a, b) => compare({ key: a.id, time: a.created_at }, { key: b.id, time: b.created_at }))) {
    let history; try { history = nativeService.listRunHistory(run.id, actor); } catch { continue; }
    const where = runScope(run); if (!where) continue;
    for (const request of array(history?.requests)) if (request.status === 'pending_review') sections.needs_you.push(item({ key: `native-request:${request.id}`, title: `Review ${String(request.kind || request.tool_name || 'agent request').replaceAll('_', ' ')}`, detail: `Requested by ${run.agent_name || 'the agent'} during “${trim(run.title, 120)}”.`, view: 'work', id: run.id, projectId: where.projectId, areaId: where.areaId, kind: 'native_tool_review', time: request.created_at, isSimulation: simulation(run) }));
  }

  for (const output of array(visible.outputs)) {
    if (!output || output.workspace_id !== workspaceId || output.archived_at || output.state !== 'needs_review') continue;
    const task = output.task_id ? tasks.get(output.task_id) : null, where = locate({ ...output, project_id: output.project_id || task?.project_id || null, team_id: task?.team_id || null });
    if (!where || !permits('documents.read', scope(where.projectId, where.areaId))) continue;
    const sourceRun = runById.get(output.run_id);
    sections.ready_to_review.push(item({ key: `output-review:${output.id}`, title: output.title, detail: `${String(output.kind || 'output').replaceAll('_', ' ')} · version ${output.current_version || 1}`, view: 'library', id: output.id, projectId: where.projectId, areaId: where.areaId, kind: 'output_review', time: output.updated_at || output.created_at, isSimulation: simulation(sourceRun) }));
  }

  for (const route of tasks.values()) if (route.status === 'ready') {
    const where = locate(route); if (!where) continue;
    sections.suggested_next.push(item({ key: `route-ready:${route.id}`, title: route.title, detail: route.priority && route.priority !== 'no_priority' ? `${route.priority} priority Route` : 'Ready Route', view: 'tasks', id: route.id, projectId: where.projectId, areaId: where.areaId, kind: 'ready_route', time: route.updated_at || route.due_at || route.created_at, isSimulation: false }));
  }

  for (const snapshot of array(visible.context_snapshots)) {
    if (!snapshot || snapshot.workspace_id !== workspaceId) continue;
    const where = locate(snapshot); if (!where || !permits('documents.read', scope(where.projectId, where.areaId))) continue;
    try {
      const manifest = { resolved: { workspace_id: workspaceId }, included: [{ kind: 'context_snapshot', id: snapshot.id }], excluded: [] };
      const sourceAccess = captureSourceAccess(db, { manifest });
      assertSourceAccess(db, { manifest, sourceAccess }, actor, allowed);
    } catch { continue; }
    sections.recent_context.push(item({ key: `context:${snapshot.id}`, title: snapshot.name, detail: 'Recorded Context Snapshot', view: 'library', id: snapshot.id, projectId: where.projectId, areaId: where.areaId, kind: 'context_snapshot', time: snapshot.created_at, isSimulation: false }));
  }
  for (const knowledge of array(visible.knowledge_entries)) {
    if (!knowledge || knowledge.workspace_id !== workspaceId || knowledge.archived_at || knowledge.state !== 'approved') continue;
    const where = locate(knowledge); if (!where || !permits('documents.read', scope(where.projectId, where.areaId))) continue;
    sections.recent_context.push(item({ key: `knowledge:${knowledge.id}`, title: knowledge.title, detail: `Approved ${knowledge.kind || 'knowledge'}`, view: 'library', id: knowledge.id, projectId: where.projectId, areaId: where.areaId, kind: 'knowledge', time: knowledge.updated_at || knowledge.created_at, isSimulation: false }));
  }

  const grouped = new Map();
  for (const run of runs) if (run.status === 'failed') {
    const failure = recordedFailure(run), event = failure.event, errorCode = failure.code, where = runScope(run); if (!where) continue;
    const key = `${where.projectId || ''}:${where.areaId || ''}:${errorCode}:${simulation(run)}`, group = grouped.get(key) || { errorCode, runs: [], projectId: where.projectId, areaId: where.areaId, isSimulation: simulation(run), latestTime: null };
    group.runs.push(run.id); const stamp = timeValue(event?.created_at || run.finished_at || run.updated_at || run.created_at); if (!group.latestTime || Date.parse(stamp || 0) > Date.parse(group.latestTime)) group.latestTime = stamp; grouped.set(key, group);
  }
  const failure_clusters = [...grouped.values()].filter(group => group.runs.length >= 2).map(group => Object.freeze({ key: `failure:${group.projectId || 'workspace'}:${group.areaId || 'workspace'}:${group.errorCode}:${group.isSimulation ? 'simulation' : 'live'}`, title: `${group.runs.length} runs failed with ${group.errorCode}`, detail: group.errorCode === 'unknown' ? 'The failures did not record a specific error code.' : `Repeated recorded error code: ${group.errorCode}.`, error_code: group.errorCode, count: group.runs.length, latest_time: group.latestTime, run_ids: group.runs.sort(), project_id: group.projectId, area_id: group.areaId, simulation: group.isSimulation })).sort(compare).slice(0, CLUSTER_LIMIT);

  const warnings = [];
  const today = generatedAt.slice(0, 10);
  for (const knowledge of array(visible.knowledge_entries)) {
    if (!knowledge || knowledge.workspace_id !== workspaceId || knowledge.archived_at || knowledge.state !== 'approved' || !/^\d{4}-\d{2}-\d{2}$/.test(knowledge.review_date || '') || knowledge.review_date > today) continue;
    const where = locate(knowledge); if (!where || !permits('documents.read', scope(where.projectId, where.areaId))) continue;
    warnings.push(item({ key: `stale-memory:${knowledge.id}`, title: `Review “${knowledge.title}”`, detail: `Knowledge review date ${knowledge.review_date} has arrived.`, view: 'library', id: knowledge.id, projectId: where.projectId, areaId: where.areaId, kind: 'stale_memory', time: `${knowledge.review_date}T00:00:00.000Z`, isSimulation: false }));
  }
  const agents = new Map(array(visible.agents).filter(agent => !agent?.archived_at && (agent.workspace_id == null || agent.workspace_id === workspaceId)).map(agent => [agent.id, agent]));
  const versions = new Map(array(visible.manual_workflow_versions).map(version => [version.id, version]));
  for (const plan of plans.values()) {
    const version = [...versions.values()].find(candidate => candidate.plan_id === plan.id && Number(candidate.number) === Number(plan.current_definition_version));
    const definition = parse(version?.definition, parse(version?.definition_json, {}));
    for (const step of array(definition.steps)) {
      const agent = agents.get(step?.config?.agent_id), pinned = step?.config?.profile_version;
      if (!agent || !Number.isInteger(pinned) || pinned === agent.version) continue;
      const where = locate(plan); if (!where) continue;
      warnings.push(item({ key: `stale-profile:${plan.id}:${step.id}`, title: `${plan.title} pins an older profile`, detail: `${step.name || 'Workflow step'} pins ${agent.name} version ${pinned}; current version is ${agent.version}.`, view: 'workflows', id: plan.id, projectId: where.projectId, areaId: where.areaId, kind: 'stale_profile', time: plan.updated_at, isSimulation: false }));
    }
  }

  for (const key of Object.keys(sections)) sections[key] = Object.freeze(bounded(sections[key]));
  return Object.freeze({ sections: Object.freeze(sections), failure_clusters: Object.freeze(failure_clusters), warnings: Object.freeze(warnings.sort(compare).slice(0, WARNING_LIMIT)) });
}

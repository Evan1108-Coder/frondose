import { createHash } from 'node:crypto';
import { assertSourceAccess } from './context-source-access.mjs';

const fail = (code, message, statusCode = 400) => { throw Object.assign(new Error(message), { code, errorCode: code, statusCode }); };
const parse = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
const hash = value => createHash('sha256').update(value).digest('hex');
const activeStatus = new Set(['running']);
const sourceKinds = new Set(['workspace', 'area', 'area_instructions', 'agent', 'project', 'route', 'context_pack', 'documents', 'memory_notes', 'agent_memories', 'knowledge_entries', 'message', 'attachment', 'connection', 'skill', 'skill_version', 'output', 'output_version', 'context_snapshot']);

function scopeFor(run, inspection) {
  const resolved = inspection.manifest.resolved;
  if (resolved.project_id) return { scope_type: 'project', scope_id: resolved.project_id };
  if (resolved.area_id) return { scope_type: 'team', scope_id: resolved.area_id };
  return {};
}

function checkWorkflowBinding(db, run, request, requireActive) {
  if (!request.workflow_step) return;
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='work_plan_step_runs'").get()) fail('tool_authority_revoked', 'The bound Workflow is unavailable.', 409);
  const binding = request.workflow_step;
  const attempt = db.prepare('SELECT * FROM work_plan_step_runs WHERE id=? AND run_id=?').get(binding.step_run_id, binding.workflow_run_id);
  const accepted = requireActive ? new Set(['bound']) : new Set(['bound', 'completed', 'failed', 'timed_out', 'cancelled']);
  if (!attempt || attempt.canonical_run_id !== run.id || !accepted.has(attempt.status)) fail('tool_authority_revoked', 'The run is no longer the exact bound Workflow attempt.', 409);
}

function includedSections(inspection) {
  return (inspection.manifest.included || []).filter(item => item && typeof item.id === 'string' && sourceKinds.has(item.kind)
    && typeof item.content === 'string' && ['included', 'truncated'].includes(item.status)
    && typeof item.content_hash === 'string' && hash(item.content) === item.content_hash)
    .map(item => Object.freeze({
      kind: item.kind, id: item.id, label: typeof item.label === 'string' ? item.label : '',
      content: item.content, content_hash: item.content_hash, truncated: item.status === 'truncated',
    }));
}

/**
 * Loads authority exclusively from server-owned persisted records. `runId` must
 * come from the bridge callback, never model arguments. The immutable snapshot
 * must exactly match a consumed, actor-bound Context Inspector preview.
 */
export function loadNativeToolAuthority(db, runId, actor, allowed, { requireActive = true } = {}) {
  if (typeof runId !== 'string' || !runId || runId.length > 200) fail('invalid_run', 'A stable run ID is required.');
  if (!actor?.id || typeof allowed !== 'function') fail('tool_access_denied', 'Authenticated tool authority is required.', 403);
  const run = db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
  if (!run || run.mode !== 'live' || requireActive && !activeStatus.has(run.status)) fail('run_not_active', 'Native tools require an active live run.', 409);
  const sponsor = db.prepare('SELECT actor_id FROM agent_run_sponsors WHERE run_id=?').get(run.id);
  if (!sponsor?.actor_id) fail('tool_access_denied', 'The run has no authenticated sponsor.', 403);
  const snapshot = db.prepare('SELECT * FROM run_context_snapshots WHERE run_id=? AND workspace_id=?').get(run.id, run.workspace_id);
  const consumed = db.prepare('SELECT * FROM run_context_inspections WHERE consumed_run_id=? AND workspace_id=?').get(run.id, run.workspace_id);
  if (!snapshot || !consumed || snapshot.inspection_json !== consumed.inspection_json) fail('context_not_reviewed', 'This run has no matching consumed Context Inspector review.', 409);
  const inspection = parse(snapshot.inspection_json);
  if (!inspection?.manifest?.resolved || !inspection?.request || inspection.request.native_tools !== true) fail('native_tools_not_reviewed', 'Native tools were not enabled in the reviewed context.', 403);
  const resolved = inspection.manifest.resolved;
  if (resolved.workspace_id !== run.workspace_id || (resolved.project_id || null) !== (run.project_id || null)
    || (resolved.task_id || null) !== (run.task_id || null) || (resolved.agent_id || null) !== (run.agent_id || null)) fail('context_scope_mismatch', 'The captured tool scope does not match the canonical run.', 409);
  if (!run.agent_id || !Number.isSafeInteger(run.agent_profile_version)) fail('profile_not_pinned', 'Native tools require a pinned agent profile.', 409);
  const profile = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? AND version=?').get(run.agent_id, run.agent_profile_version);
  if (!profile) fail('profile_not_pinned', 'The run’s pinned agent profile is unavailable.', 409);
  checkWorkflowBinding(db, run, inspection.request, requireActive);
  assertSourceAccess(db, inspection, actor, allowed);
  if (!allowed(run.workspace_id, actor, 'agents.run', scopeFor(run, inspection))) fail('tool_access_denied', 'Current run authority is unavailable.', 403);
  const enabled = new Set((inspection.manifest.permissions?.available_tools || []).filter(tool => tool?.available === true && typeof tool.id === 'string').map(tool => tool.id.replace(/^rumbo\./, '').replace(/\.v1$/, '')));
  const sections = includedSections(inspection);
  return Object.freeze({
    run: Object.freeze({ ...run }), sponsor_id: sponsor.actor_id, profile: Object.freeze({ ...profile }),
    inspection, context_fingerprint: inspection.manifest.fingerprint,
    enabled_tools: enabled, sections: Object.freeze(sections), resolved: Object.freeze({ ...resolved }),
  });
}

export function loadRunSponsor(db, runId) {
  return db.prepare('SELECT actor_id FROM agent_run_sponsors WHERE run_id=?').get(runId)?.actor_id || null;
}

export function assertReviewedTarget(authority, kind, id) {
  const found = authority.sections.find(section => section.kind === kind && section.id === id);
  if (!found) fail('target_not_in_reviewed_context', 'The target was not included in the reviewed run context.', 403);
  return found;
}

export function nativeToolError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'native_tool_error',
    message: typeof error?.message === 'string' && error?.code ? error.message : 'The native tool failed safely.',
    status: Number.isSafeInteger(error?.statusCode) ? error.statusCode : 500,
    retryable: false,
  };
}

import { createHash } from 'node:crypto';
import { isRecord, validationError } from './validation.mjs';
import { validateManualWorkflowDefinition } from './manual-workflow-service.mjs';

// Import reusable definitions only. Never restore reservations, run claims,
// human decisions, process bindings, folder grants or idempotency receipts.
export function importManualWorkflows(db, data, ids, workspaceId, stamp) {
  const source = (table, id) => (data[table] || []).find(row => row.id === id);
  const ref = (table, id, required = false) => {
    if (!id && !required) return null;
    if (!source(table, id) || !ids.has(id)) throw validationError(`Cannot import Workflow: missing ${table} reference.`);
    return ids.get(id);
  };
  const contexts = { pack: 'workspace_items', document: 'documents', memory: 'memory_notes', knowledge: 'knowledge_entries', context_snapshot: 'context_snapshots', output_version: 'output_versions' };
  const versions = data.manual_workflow_versions || [];
  for (const row of data.manual_workflows || []) {
    if (row.kind !== 'manual_workflow' || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 200 || !Number.isInteger(row.current_definition_version)) throw validationError('Cannot import an invalid Workflow definition.');
    const own = versions.filter(version => version.plan_id === row.id);
    if (!own.some(version => version.number === row.current_definition_version)) throw validationError('Cannot import a Workflow without its current version.');
    const planId = ids.get(row.id), projectId = ref('projects', row.project_id);
    db.prepare('INSERT INTO work_plans(id,workspace_id,project_id,title,state,steps_json,version,created_at,updated_at,kind,current_definition_version) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(planId, workspaceId, projectId, row.title.trim(), 'paused', '[]', 1, stamp, stamp, 'manual_workflow', row.current_definition_version);
    const seen = new Set();
    for (const version of own) {
      if (!Number.isInteger(version.number) || version.number < 1 || version.number > 100000 || seen.has(version.number) || !isRecord(version.definition) || !Array.isArray(version.definition.steps)) throw validationError('Cannot import an invalid Workflow version.');
      seen.add(version.number);
      const raw = { ...version.definition, steps: version.definition.steps.map(step => {
        if (!isRecord(step)) throw validationError('Cannot import an invalid Workflow step.');
        const config = { ...step.config };
        if (['agent', 'skill'].includes(step.type)) {
          config.agent_id = ref('agents', config.agent_id, true);
          config.profile_version = db.prepare('SELECT version FROM agents WHERE id=?').get(config.agent_id).version;
          config.task_id = ref('tasks', config.task_id);
          config.permission_mode = 'read-only';
          config.native_tools = false;
        }
        if (step.type === 'skill') {
          config.skill_id = ref('skills', config.skill_id, true);
          config.version_id = ref('skill_versions', config.version_id, true);
        }
        const contextRefs = step.context_refs || [];
        if (!Array.isArray(contextRefs)) throw validationError('Cannot import invalid Workflow context.');
        return { ...step, config, context_refs: contextRefs.map(item => {
          if (!isRecord(item) || !contexts[item.kind]) throw validationError('Cannot import an unknown Workflow context type.');
          return { kind: item.kind, id: ref(contexts[item.kind], item.id, true) };
        }) };
      }) };
      const definition = validateManualWorkflowDefinition(db, workspaceId, projectId, raw, { id: 'imported', mode: 'local' }, () => true, { importing: true });
      const json = JSON.stringify(definition);
      db.prepare('INSERT INTO work_plan_versions(id,plan_id,workspace_id,number,definition_json,definition_hash,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(ids.get(version.id), planId, workspaceId, version.number, json, createHash('sha256').update(json).digest('hex'), 'imported', stamp);
    }
  }
  if (versions.some(version => !source('manual_workflows', version.plan_id))) throw validationError('Cannot import an orphaned Workflow version.');
}

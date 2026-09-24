import { randomUUID } from 'node:crypto';
import { validateRecord, validationError } from './validation.mjs';
import { recordChange } from './workspace-features.mjs';

const uid = kind => `${kind}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const text = (value, name, max, fallback) => {
  const result = value ?? fallback;
  if (typeof result !== 'string' || !result.trim() || result.length > max) throw validationError(`${name} must be nonempty text under ${max} characters.`);
  return result.trim();
};

// These callbacks are deliberately synchronous: the caller reviews an exact
// proposal and commits the decision + resulting record in one SQL savepoint.
// No provider, file, command, credential, permission or background action here.
export function createNativeToolApply({ db, allowed }) {
  function authorize(run, actor, permission, projectId = run.project_id) {
    const sponsor = db.prepare('SELECT actor_id FROM agent_run_sponsors WHERE run_id=?').get(run.id)?.actor_id;
    if (!sponsor || !actor?.id || actor.mode === 'agent' || actor.id === run.agent_id) throw Object.assign(validationError('A human reviewer and the original run sponsor are required.'), { statusCode: 403 });
    if (!db.prepare('SELECT 1 FROM workspaces WHERE id=? AND archived_at IS NULL').get(run.workspace_id)) throw validationError('Restore this workspace before applying a proposal.');
    const project = projectId ? db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(projectId, run.workspace_id) : null;
    const captured = db.prepare('SELECT inspection_json FROM run_context_snapshots WHERE run_id=?').get(run.id);
    const areaId = captured ? JSON.parse(captured.inspection_json).manifest?.resolved?.area_id : null;
    if (projectId && !project || run.project_id && projectId !== run.project_id) throw validationError('The proposed target is outside the run Project.');
    if (areaId && !project && permission === 'documents.write') throw Object.assign(validationError('Area-only memory and outputs need a Project scope; they cannot be saved as workspace-wide content.'), { statusCode: 403 });
    if (project?.team_id && !db.prepare('SELECT 1 FROM teams WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(project.team_id, run.workspace_id)) throw validationError('Restore the project Area first.');
    const scope = project ? { scope_type: 'project', scope_id: project.id } : areaId ? { scope_type: 'team', scope_id: areaId } : {};
    for (const who of [actor, { id: sponsor }]) if (!allowed(run.workspace_id, who, permission, scope)) throw Object.assign(validationError('Both the reviewer and run sponsor need permission for this change.'), { statusCode: 403 });
    return project;
  }
  function insert(table, row) {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(row));
    recordChange(db, table, null, row, 'created');
    return row;
  }
  return {
    create_draft_route({ run, proposal, actor }) {
      const project = authorize(run, actor, 'routes.write', proposal.project_id || run.project_id || null);
      const stamp = new Date().toISOString();
      const row = { id: uid('task'), workspace_id: run.workspace_id, project_id: project?.id || null, team_id: project?.team_id || null,
        number: Number(db.prepare('SELECT COALESCE(MAX(number),0)+1 AS next FROM tasks WHERE workspace_id=?').get(run.workspace_id).next),
        title: text(proposal.title, 'Route title', 200), description: proposal.description || '', status: 'backlog', priority: proposal.priority || 'no_priority',
        assignee_agent_ids_json: '[]', labels_json: '[]', created_at: stamp, updated_at: stamp };
      validateRecord(db, 'tasks', row, ['workspace_id', 'title'], ['project_id', 'team_id', 'title', 'description', 'status', 'priority']);
      insert('tasks', row);
      return { type: 'route', id: row.id, status: row.status, execution_started: false };
    },
    propose_project_update({ run, proposal, actor }) {
      const project = authorize(run, actor, 'projects.write', proposal.project_id);
      const fields = Object.keys(proposal.patch || {});
      if (!project || !fields.length || fields.some(key => !['name', 'description', 'goal', 'status'].includes(key))) throw validationError('Choose supported Project fields.');
      const next = { ...project, ...proposal.patch, updated_at: new Date().toISOString() };
      if (proposal.patch.status !== undefined && proposal.patch.status !== project.status) next.workflow_status_id = null;
      validateRecord(db, 'projects', next, ['workspace_id', 'name'], fields);
      const updates = [...fields, 'updated_at', ...(next.workflow_status_id !== project.workflow_status_id ? ['workflow_status_id'] : [])];
      db.prepare(`UPDATE projects SET ${updates.map(key => `${key}=?`).join(',')} WHERE id=?`).run(...updates.map(key => next[key]), project.id);
      recordChange(db, 'projects', project, next, 'updated');
      return { type: 'project', id: project.id, updated_fields: fields };
    },
    save_memory_candidate({ run, proposal, request, actor }) {
      const project = authorize(run, actor, 'documents.write', proposal.project_id || run.project_id || null);
      const stamp = new Date().toISOString();
      const row = { id: uid('knowledge'), workspace_id: run.workspace_id, project_id: project?.id || null,
        title: text(proposal.title, 'Memory title', 200), kind: 'fact', content: text(proposal.content, 'Memory content', 50000),
        source: `Native tool proposal ${request.id}; run ${run.id}. Candidate only, not approved knowledge.`, state: 'draft', review_date: '', version: 1, archived_at: null, created_at: stamp, updated_at: stamp };
      insert('knowledge_entries', row);
      return { type: 'knowledge', id: row.id, state: 'draft', usable_as_approved_memory: false };
    },
    submit_output({ run, proposal, actor }) {
      const project = authorize(run, actor, 'documents.write', proposal.project_id || run.project_id || null);
      const routeId = proposal.route_id || run.task_id || null;
      const route = routeId ? db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(routeId, run.workspace_id) : null;
      if (routeId && (!route || route.project_id !== (project?.id || null) || run.task_id && routeId !== run.task_id)) throw validationError('Output links must refer to the run’s work.');
      const kind = proposal.kind || 'document';
      if (!['document', 'report', 'code_change', 'design', 'test_result', 'research', 'other'].includes(kind)) throw validationError('Choose a supported output kind.');
      const stamp = new Date().toISOString();
      const row = { id: uid('output'), workspace_id: run.workspace_id, project_id: project?.id || null, task_id: routeId, run_id: run.id,
        chat_id: run.chat_id || null, source_message_id: run.source_message_id || null, title: text(proposal.title, 'Output title', 200), kind,
        reviewer_name: '', state: 'needs_review', current_version: 1, version: 1, archived_at: null, created_at: stamp, updated_at: stamp };
      insert('outputs', row);
      const version = { id: uid('version'), output_id: row.id, workspace_id: run.workspace_id, number: 1,
        content: text(proposal.content, 'Output content', 100000), summary: 'Submitted through a reviewed native tool request.', author_name: run.agent_name || 'Agent', created_at: stamp };
      insert('output_versions', version);
      return { type: 'output', id: row.id, version_id: version.id, state: 'needs_review', accepted: false };
    },
  };
}

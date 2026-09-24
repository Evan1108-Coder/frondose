export const WORKFLOW_INPUT_TYPES = ['string', 'number', 'boolean', 'json'];
export const WORKFLOW_CONDITIONS = ['equals', 'not_equals', 'exists', 'truthy'];
export const FEATURE_ROLES = [
  { id: 'researcher', label: 'Researcher', description: 'Analyze the feature request and cite evidence.' },
  { id: 'planner', label: 'Planner', description: 'Turn research into a bounded implementation plan.' },
  { id: 'builder', label: 'Builder', description: 'Implement the approved plan within explicit project permissions.' },
  { id: 'reviewer', label: 'Reviewer', description: 'Review the diff and test evidence, including unresolved risks.' },
];

export function featureWorkflowDefinition({ roles, agents = [], description = '', minutes = 30, attempts = 2, allowEdits = false }) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) throw new Error('Choose a timeout from 1 to 30 whole minutes.');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new Error('Choose 1 to 5 maximum attempts.');
  const base = (id, name, type, depends_on, instructions, config) => ({ id, name, type, depends_on, description: instructions, config, condition: null, context_refs: [], retry: { max_attempts: attempts }, limits: { timeout_ms: minutes * 60000 }, on_failure: 'stop' });
  const agent = (id, name, depends, instructions) => {
    const profile = agents.find(item => item.id === roles[id]);
    if (!profile || !Number.isInteger(profile.version)) throw new Error(`Choose a current ${id} profile before saving.`);
    return base(id, name, 'agent', depends, instructions, { agent_id: profile.id, profile_version: profile.version, permission_mode: id === 'builder' && allowEdits ? 'workspace-write' : 'read-only', include_memory: true, include_chat: false });
  };
  return {
    schema_version: 1, description,
    inputs: [{ name: 'feature_request', type: 'string', required: true, description: 'The goal, constraints, and acceptance criteria for this run.' }],
    steps: [
      agent('researcher', 'Research the request', [], 'Analyze the feature_request input and approved context. Separate evidence, assumptions, and missing information. Produce one bounded research report with sources and risks. Do not edit files or start other agents. Stop after submitting your report.'),
      agent('planner', 'Plan the implementation', ['researcher'], 'Use the feature_request input and exact research handoff. Produce one implementation plan with scope, acceptance criteria, tests, permission needs, and stopping conditions. Do not implement the plan. Stop and await human approval.'),
      base('plan_gate', 'Approve the plan', 'human_approval', ['planner'], 'A human reviews the exact planner output before Builder can be prepared.', { prompt: 'Does this plan match your intent and approved scope?', source_step_id: 'planner', requires_approved_output: false }),
      agent('builder', 'Build the approved plan', ['planner', 'plan_gate'], 'Follow the exact approved planner handoff and feature_request input. Work only inside the reviewed permissions. In read-only mode, produce an implementation proposal without changing files. Otherwise implement the bounded plan and run permitted tests. Submit one result with changes, test evidence, and unresolved limitations. Stop when the bounded task is complete or blocked.'),
      agent('reviewer', 'Review the result', ['builder'], 'Review the exact Builder output and permitted project evidence against acceptance criteria. Examine the diff and available tests where tools permit it. Do not change files, approve your own result, or invent verification. Submit one review with findings and explicit unknowns, then stop.'),
      base('output_gate', 'Accept the exact output', 'human_approval', ['builder', 'reviewer'], 'Review the Builder output version in Library, record its approval there, then explicitly accept this gate. The Reviewer report informs this human decision.', { prompt: 'Accept this reviewed Builder output version for knowledge?', source_step_id: 'builder', requires_approved_output: true }),
      base('memory', 'Keep approved knowledge', 'tool', ['builder', 'output_gate'], 'A human explicitly records knowledge from the exact approved Builder output and review. This does not authorize future tools.', { tool: 'finalize_approved_knowledge', source_step_id: 'builder', kind: 'fact', title: '' }),
    ],
    handoffs: [{ from: 'researcher', to: 'planner' }, { from: 'planner', to: 'builder' }, { from: 'builder', to: 'reviewer' }, { from: 'reviewer', to: 'output_gate' }, { from: 'builder', to: 'memory' }].map(item => ({ ...item, output: 'result', required: true })),
  };
}

export function workflowInputValues(definition, saved = {}) {
  return Object.fromEntries((definition?.inputs ?? []).map(input => [input.name, Object.hasOwn(saved, input.name) ? saved[input.name] : Object.hasOwn(input, 'default') ? structuredClone(input.default) : input.type === 'boolean' ? false : '']));
}

export function parseWorkflowInputs(definition, values) {
  const result = {};
  for (const input of definition.inputs ?? []) {
    const value = values[input.name];
    if (typeof value === 'string' && !value.trim() || value === undefined || value === null && input.type !== 'json') {
      if (input.required) throw new Error(`Provide ${input.name}.`);
      continue;
    }
    if (input.type === 'number') {
      if (!['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value))) throw new Error(`${input.name} must be a finite number.`);
      result[input.name] = Number(value);
    } else if (input.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`${input.name} must be true or false.`);
      result[input.name] = value;
    } else if (input.type === 'json') {
      try { result[input.name] = typeof value === 'string' ? JSON.parse(value) : structuredClone(value); }
      catch { throw new Error(`${input.name} must be valid JSON.`); }
    } else result[input.name] = String(value);
  }
  return result;
}

export function workflowRequestBody(payload, previous, makeId = () => crypto.randomUUID()) {
  const fingerprint = JSON.stringify(payload);
  const request = previous?.fingerprint === fingerprint ? previous : { fingerprint, key: makeId() };
  return { request, body: { ...payload, idempotency_key: request.key } };
}

export function latestWorkflowAttempts(attempts = []) {
  const result = new Map();
  for (const attempt of attempts) if (!result.has(attempt.step_id) || Number(result.get(attempt.step_id).attempt) < Number(attempt.attempt)) result.set(attempt.step_id, attempt);
  return result;
}

export function workflowStepState(step, attempts = []) {
  const latest = latestWorkflowAttempts(attempts), attempt = latest.get(step.id);
  if (attempt) return attempt.status;
  return step.depends_on?.some(id => !['completed', 'skipped'].includes(latest.get(id)?.status)) ? 'blocked' : 'ready';
}

export function scopedWorkflowContext(data, workspaceId, projectId, kind) {
  const table = { pack: 'workspace_items', document: 'documents', memory: 'memory_notes', knowledge: 'knowledge_entries', context_snapshot: 'context_snapshots', output_version: 'output_versions' }[kind];
  if (!table) return [];
  return (data[table] ?? []).filter(item => {
    const parent = kind === 'output_version' ? data.outputs?.find(output => output.id === item.output_id) : item;
    return parent?.workspace_id === workspaceId && !parent.archived_at && (!projectId || !parent.project_id || parent.project_id === projectId) && (kind !== 'knowledge' || item.state === 'approved') && (kind !== 'pack' || item.kind === 'context_pack');
  }).map(item => ({ ...item, displayName: item.name || item.title || (kind === 'output_version' ? `${data.outputs?.find(output => output.id === item.output_id)?.title || 'Output'} · v${item.number}` : item.id) }));
}

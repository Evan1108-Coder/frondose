export const SKILL_INPUT_TYPES = ['string', 'number', 'boolean', 'enum'];
export const SKILL_TOOL_NAMES = ['search_workspace', 'get_area_context', 'get_project_context', 'get_route', 'search_knowledge', 'read_document', 'create_draft_route', 'propose_project_update', 'save_memory_candidate', 'request_permission', 'submit_output', 'handoff_to_agent'];
export const skillLines = value => String(value ?? '').split('\n').map(item => item.trim()).filter(Boolean);
export function skillEditorFields(skill = {}) {
  return {
    name: skill.name ?? '', purpose: skill.purpose ?? '', instructions: skill.instructions ?? '',
    inputs: (skill.inputs ?? []).map(input => ({ ...input, options_text: (input.options ?? []).join('\n') })),
    required_context: (skill.required_context ?? []).map(ref => ({ ...ref })), allowed_tools: [...(skill.allowed_tools ?? [])],
    required_capabilities: (skill.required_capabilities ?? []).join('\n'), examples: (skill.examples ?? []).map(example => ({ ...example, inputs_text: JSON.stringify(example.inputs ?? {}, null, 2) })),
    preferred_agent_id: skill.preferred_agent_id ?? '', output_format: skill.output_format ?? '',
    test_cases: (skill.test_cases ?? []).map(item => ({ ...item, inputs_text: JSON.stringify(item.inputs ?? {}, null, 2) })),
  };
}
export function parseSkillInputs(value) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error('Enter valid JSON for test inputs.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Test inputs must be a JSON object keyed by input name.');
  return parsed;
}
export function skillEditorPayload(form) {
  const names = new Set();
  const inputs = form.inputs.map(input => {
    const name = input.name.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || names.has(name)) throw new Error('Input names must be unique identifiers, starting with a letter.');
    if (!SKILL_INPUT_TYPES.includes(input.type)) throw new Error('Choose a supported input type.');
    names.add(name);
    const options = skillLines(input.options_text);
    if (input.type === 'enum' && (!options.length || new Set(options).size !== options.length)) throw new Error('Enum inputs need unique options, one per line.');
    return { name, type: input.type, required: input.required === true, description: input.description.trim(), ...(input.type === 'enum' ? { options } : {}) };
  });
  return { name: form.name.trim(), purpose: form.purpose.trim(), instructions: form.instructions,
    inputs, required_context: form.required_context.map(({ kind, id }) => ({ kind, id })), allowed_tools: [...form.allowed_tools],
    required_capabilities: skillLines(form.required_capabilities), examples: form.examples.map(example => ({ inputs: parseSkillInputs(example.inputs_text), output: example.output })),
    preferred_agent_id: form.preferred_agent_id || null, output_format: form.output_format, approval_policy: 'always',
    test_cases: form.test_cases.map(item => ({ ...(item.id ? { id: item.id } : {}), name: item.name.trim(), inputs: parseSkillInputs(item.inputs_text), expected_output: item.expected_output })) };
}
export function skillTestDefaults(skill, testCase = null) {
  return testCase?.inputs ?? Object.fromEntries((skill.inputs ?? []).map(input => [input.name, input.type === 'number' ? 0 : input.type === 'boolean' ? false : input.type === 'enum' ? input.options?.[0] ?? '' : '']));
}
export function skillHasCurrentPass(skill, coverage, versions = []) {
  const version = versions.find(item => item.number === skill.version);
  return Boolean(version && coverage && !Array.isArray(coverage) && coverage.version_id === version.id && coverage.publishable === true &&
    skill.test_cases?.length && coverage.cases?.length === skill.test_cases.length && skill.test_cases.every(testCase => testCase.id && coverage.cases.some(item => item.test_case_id === testCase.id && item.status === 'passed')));
}
export function skillCoverageRows(skill, coverage) {
  return (skill.test_cases || []).map(testCase => {
    const recorded = testCase.id && coverage?.cases?.find(item => item.test_case_id === testCase.id);
    return { ...testCase, status: ['passed', 'failed'].includes(recorded?.status) ? recorded.status : 'missing', evaluation_id: recorded?.evaluation_id || null, legacy: !testCase.id };
  });
}
export function skillPublicationReason(skill, coverage, versions = []) {
  if (skillHasCurrentPass(skill, coverage, versions)) return 'Every case has a qualifying recorded pass for this exact version. Publishing remains a human decision, not independent verification.';
  if (!skill.test_cases?.length) return 'Add defined test cases before publishing this version.';
  if (skill.test_cases.some(testCase => !testCase.id)) return 'This legacy version has no stable case IDs. Save a new version, then evaluate every case against recorded run evidence.';
  if (!coverage) return 'Load current case coverage before publishing. Legacy handwritten observations do not count as case-bound evidence.';
  const incomplete = skillCoverageRows(skill, coverage).filter(testCase => testCase.status !== 'passed');
  if (incomplete.length) return `Publication is blocked: ${incomplete.map(testCase => `${testCase.name} (${testCase.status === 'failed' ? 'Fail' : 'Missing'})`).join('; ')}. Each case needs a qualifying recorded pass for this exact version.`;
  return 'This version does not currently meet the server evidence policy. Refresh coverage and inspect its recorded evaluations.';
}
export function skillEvaluationsComparable(left, right) {
  return Boolean(left?.id && right?.id && left.id !== right.id && left.test_case_id && left.test_case_id === right.test_case_id && left.input_hash && left.input_hash === right.input_hash);
}
export function skillPreparationUsable(preparation, time = Date.now()) {
  const expires = typeof preparation?.expires_at === 'number' ? preparation.expires_at : Date.parse(preparation?.expires_at);
  return Boolean(preparation?.id && preparation.status === 'prepared' && !preparation.expired && Number.isFinite(expires) && expires > time);
}
export function skillContextChoices(data, workspaceId, kind) {
  const table = { document: 'documents', memory: 'memory_notes', knowledge: 'knowledge_entries', pack: 'workspace_items' }[kind];
  return (data[table] ?? []).filter(item => item.workspace_id === workspaceId && !item.archived_at && (kind !== 'pack' || item.kind === 'context_pack') && (kind !== 'knowledge' || item.state === 'approved'));
}
export function skillRequestBody(payload, previous, makeId) {
  const fingerprint = JSON.stringify(payload);
  const request = previous?.fingerprint === fingerprint ? previous : { fingerprint, requestId: makeId() };
  return { request, body: { ...payload, request_id: request.requestId } };
}

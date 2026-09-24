export const AGENT_CONTENT_FIELDS = [
  { id: 'role', label: 'Role' },
  { id: 'description', label: 'Description' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'output_behavior', label: 'Expected output behavior' },
];

export function agentContentField(content, field) {
  if (!AGENT_CONTENT_FIELDS.some(item => item.id === field) || !content || typeof content[field] !== 'string') return { available: false, value: null };
  return { available: true, value: content[field] };
}

export function agentContentChanges(before, after) {
  return AGENT_CONTENT_FIELDS.map(field => {
    const left = agentContentField(before, field.id), right = agentContentField(after, field.id);
    return { ...field, before: left, after: right, state: !left.available || !right.available ? 'unavailable' : left.value === right.value ? 'unchanged' : 'changed' };
  });
}

export function selectedAgentContentFields(fields) {
  return AGENT_CONTENT_FIELDS.map(item => item.id).filter(field => Array.isArray(fields) && fields.includes(field));
}

export function agentContentRequestBody(payload, previous, makeId) {
  const key = JSON.stringify(payload);
  const request = previous?.key === key ? previous : { key, id: makeId() };
  return { request, body: { ...payload, request_id: request.id } };
}

export function agentContentVersionLabel(version) {
  if (!version) return 'Version unavailable';
  return `Version ${version.version}${version.restricted ? ' · restricted' : ''}`;
}

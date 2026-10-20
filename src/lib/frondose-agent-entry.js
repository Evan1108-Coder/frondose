// A one-shot, in-memory handoff. This is a draft request, never authorization.
// Resolve source IDs on the server; do not copy protected workspace text into
// navigation state, a URL, or browser storage.
const SOURCE_TYPES = new Set(['document', 'update', 'task', 'project']);
let pending = null;

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && !/[\/\\\u0000-\u001f\u007f]/.test(value) && value !== '.' && value !== '..';
}

export function prepareFrondoseAgentEntry({ workspaceId, source = null, instruction = '', agentId = null } = {}) {
  if (!validId(workspaceId)) throw new TypeError('Choose an active workspace before opening Frondose.');
  if (typeof instruction !== 'string' || instruction.trim().length > 10000) throw new TypeError('Keep the request within 10,000 characters.');
  if (source !== null && (!source || !SOURCE_TYPES.has(source.type) || !validId(source.id))) throw new TypeError('Choose a supported workspace source.');
  if (agentId !== null && (typeof agentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(agentId))) throw new TypeError('Choose a valid agent profile.');
  pending = Object.freeze({ workspaceId, instruction: instruction.trim(), source: source ? Object.freeze({ type: source.type, id: source.id }) : null, ...(agentId !== null ? { agentId } : {}) });
  return pending;
}

// Reading is repeatable for React initializers. A different workspace cannot
// inspect the request, including its instruction or source identifier.
export function peekFrondoseAgentEntry(workspaceId) {
  return pending?.workspaceId === workspaceId ? pending : null;
}

export function consumeFrondoseAgentEntry(workspaceId) {
  const entry = peekFrondoseAgentEntry(workspaceId);
  if (entry) pending = null;
  return entry;
}

export function clearFrondoseAgentEntry(workspaceId) {
  if (pending?.workspaceId === workspaceId) pending = null;
}

export function frondoseAgentSourceLabel(type) {
  return ({ document: 'document', update: 'update', task: 'Route', project: 'project' })[type] || 'workspace';
}

export function defaultFrondoseAgentInstruction(type) {
  const label = frondoseAgentSourceLabel(type);
  return type === 'update' || type === 'document'
    ? `Help me improve this ${label}. Suggest changes for me to review.`
    : `Help me plan the next step for this ${label}. Explain your recommendation before proposing actions.`;
}

export function frondoseAgentActivitySource({ entry, replyTo, targetType, targetId }) {
  // Published discussion is an attributable source. Private/unsaved drafts are
  // not copied; use their saved parent work instead and keep draft text local.
  const update = [entry, replyTo].find(item => item?.id && item.publication_state !== 'draft');
  if (update) return { type: 'update', id: update.id };
  const type = targetType === 'route' ? 'task' : targetType;
  return ['document', 'task', 'project'].includes(type) && targetId ? { type, id: targetId } : null;
}

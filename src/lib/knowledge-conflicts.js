export const KNOWLEDGE_CONFLICT_DECISIONS = [
  ['keep_both', 'Keep both approved entries'],
  ['supersede_left', 'Supersede the left entry'],
  ['supersede_right', 'Supersede the right entry'],
];

export function conflictKnowledgeChoices(entries, workspaceId) {
  return (Array.isArray(entries) ? entries : []).filter(entry => entry.workspace_id === workspaceId
    && entry.state === 'approved' && !entry.archived_at
    && Number.isSafeInteger(entry.version) && entry.version > 0 && typeof entry.content === 'string')
    .toSorted((left, right) => String(left.title).localeCompare(String(right.title)) || left.id.localeCompare(right.id));
}

export function knowledgeConflictPairError(left, right, workspaceId) {
  if (!left || !right) return 'Choose two accessible, active, approved knowledge entries.';
  if (left.id === right.id) return 'Choose two different knowledge entries.';
  if (conflictKnowledgeChoices([left, right], workspaceId).length !== 2) return 'One of these entries is no longer eligible. Refresh knowledge before reporting.';
  return '';
}

export function knowledgeConflictDecisionBlock(detail) {
  if (!detail?.conflict || typeof detail.left?.content !== 'string' || typeof detail.right?.content !== 'string') return 'The exact recorded pair is unavailable. No decision can be made here.';
  if (detail.conflict.status !== 'open') return 'This report already has a recorded decision.';
  if (detail.conflict.freshness !== 'current') return 'This report is stale. Review the current entries and create a new report; the historical snapshots stay unchanged.';
  return '';
}

export function knowledgeConflictDecisionEffect(decision) {
  if (decision === 'keep_both') return 'Both entries remain approved and eligible for future context. This records your judgment, not an automatic verification that the text agrees.';
  if (decision === 'supersede_left' || decision === 'supersede_right') return `The ${decision === 'supersede_left' ? 'left' : 'right'} entry becomes superseded and is excluded from future automatic context inclusion. It is not deleted. Earlier captured context and runs keep their original text.`;
  return 'Choose a human decision. Nothing is merged, deleted or sent to an agent.';
}

export function knowledgeConflictRequest(payload, previous, makeId) {
  const key = JSON.stringify(payload);
  const request = previous?.key === key ? previous : { key, id: makeId() };
  return { request, body: { ...payload, request_id: request.id } };
}

export function knowledgeConflictDeliveryUncertain(error) {
  return ['network_error', 'timeout'].includes(error?.code) || Number(error?.status) >= 500;
}

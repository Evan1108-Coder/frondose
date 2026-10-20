export function coordinationRequest(fields, requestId) {
  if (!fields || !['steer', 'handoff'].includes(fields.kind) || typeof fields.content !== 'string' || !fields.content.trim() || fields.content.length > 10000 || typeof requestId !== 'string' || !requestId || requestId.length > 240) throw new Error('Choose a message and stable request ID.');
  if (fields.kind === 'handoff' && (!fields.target_chat_id || !fields.target_agent_id)) throw new Error('Choose a destination conversation and agent.');
  return { request_id: requestId, kind: fields.kind, content: fields.content.trim(), ...(fields.kind === 'handoff' ? { target_chat_id: fields.target_chat_id, target_agent_id: fields.target_agent_id } : {}) };
}

export function coordinationDestination(item) {
  if (!item?.id || !item.source_run_id || !item.target_chat_id) throw new Error('Choose a saved coordination message.');
  return { chatId: item.target_chat_id, options: { coordinationRunId: item.source_run_id, coordinationId: item.id } };
}

export function recordedWorkEvents(events) {
  // Never surface raw private reasoning events as a task transcript. Provider
  // public progress summaries and observed tool events are different records.
  return (events || []).filter(event => !/reasoning|chain.of.thought|private.analysis/i.test(event.type || '')).slice(-300);
}

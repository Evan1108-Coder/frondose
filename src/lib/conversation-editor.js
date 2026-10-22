import { val } from './model.js';

export function initialConversationAgent(base, editing = false) {
  if (val(base, 'responding_agent_id')) return val(base, 'responding_agent_id');
  const participants = val(base, 'participant_agent_ids') || [];
  // Editing a legacy title must not silently turn a historical participant
  // into the agent for all future replies. That choice must be explicit.
  return !editing && participants.length === 1 ? participants[0] : '';
}

export function conversationAgentFields({ item, agentId, agents = [], workspaceId }) {
  const bound = val(item, 'responding_agent_id');
  if (bound && bound !== agentId) throw new Error('The responding agent cannot be changed. Create another conversation to use a different agent.');
  if (!item && !agentId) throw new Error('Choose one responding agent for this conversation.');
  if (agentId && !bound) {
    const agent = agents.find(profile => profile.id === agentId);
    if (!agent || val(agent, 'archived_at') || agent.status === 'paused' || val(agent, 'workspace_id') && val(agent, 'workspace_id') !== workspaceId) throw new Error('Choose an available agent in this workspace.');
  }
  return {
    participant_agent_ids: item ? val(item, 'participant_agent_ids') || [] : [agentId],
    ...(agentId ? { responding_agent_id: agentId } : {}),
  };
}

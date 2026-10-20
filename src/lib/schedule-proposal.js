import { prepareExplicitChatSend } from './chat-send-context.js';
import { validTimezone } from './scheduled-time.js';

export async function prepareScheduleProposal({ proposalId, workspaceId, agentId, prepare, inspect, isCurrent }) {
  const proposed = await prepare(proposalId, workspaceId);
  if (!proposed || proposed.action_request_id !== proposalId || proposed.workspace_id !== workspaceId || (agentId && proposed.agent_id !== agentId) || typeof proposed.chat_id !== 'string' || !proposed.chat_id || typeof proposed.agent_id !== 'string' || !proposed.agent_id || typeof proposed.content !== 'string' || !proposed.content.trim() || proposed.content.length > 10000 || typeof proposed.model !== 'string' || !proposed.model.trim() || proposed.model.length > 120 || !Number.isFinite(Date.parse(proposed.run_at)) || !validTimezone(proposed.timezone) || !['none','daily','weekly'].includes(proposed.recurrence || 'none')) {
    throw new Error('The schedule proposal is incomplete or no longer matches this conversation.');
  }
  const request = { workspace_id: workspaceId, chat_id: proposed.chat_id, agent_id: proposed.agent_id, prompt: proposed.content, model: proposed.model, work_mode: 'conversation', permission_mode: 'read-only', native_tools: false, include_chat: true, include_memory: true, include_workspace: true, attachments: [], source_message_id: null, context_pack_ids: [] };
  const inspection = await prepareExplicitChatSend({ request, inspect, isCurrent });
  return { proposed, inspection, payload: { chat_id: proposed.chat_id, agent_id: proposed.agent_id, content: proposed.content, model: proposed.model, action_request_id: proposalId } };
}

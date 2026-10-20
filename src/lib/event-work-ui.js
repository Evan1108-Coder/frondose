import { agentReadiness } from './agents.js';
import { val, visible } from './model.js';
import { validContextInspection } from './context-inspector-ui.js';

export const EVENT_WORK_EVENTS = Object.freeze([
  { id: 'route.created', label: 'A Route is created' },
  { id: 'route.updated', label: 'A Route is updated' },
  { id: 'update.published', label: 'An update or reply is published' },
]);

// Existing canonical conversations and identities only. A catalog entry, sample
// connection, or unbound profile must never become an event execution target.
export function eventWorkRecipients(data = {}, workspaceId) {
  const agents = new Map(visible(data.agents || []).filter(agent => {
    if (val(agent, 'workspace_id') && val(agent, 'workspace_id') !== workspaceId) return false;
    const binding = val(agent, 'provider_connection_id');
    if (!binding) return false;
    const connection = (data.connections || []).find(item => item.id === binding && item.provider === agent.provider);
    return agentReadiness(agent, connection).canStartLive;
  }).map(agent => [agent.id, agent]));
  return visible(data.chats || []).filter(chat => val(chat, 'workspace_id') === workspaceId).flatMap(chat =>
    (val(chat, 'participant_agent_ids') || []).filter(id => agents.has(id)).map(id => ({
      id: JSON.stringify([chat.id, id]), chat, agent: agents.get(id),
      label: `${chat.title || 'Untitled conversation'} · ${agents.get(id).name}`,
    })));
}

export function eventWorkInspectionRequest(workspaceId, recipient, content) {
  if (!recipient?.chat?.id || !recipient?.agent?.id || val(recipient.chat, 'workspace_id') !== workspaceId || !content.trim()) return null;
  return {
    workspace_id: workspaceId, chat_id: recipient.chat.id, agent_id: recipient.agent.id,
    project_id: val(recipient.chat, 'project_id') || null, task_id: val(recipient.chat, 'task_id') || null,
    prompt: content.trim(), work_mode: 'conversation', permission_mode: 'read-only', native_tools: false,
    include_chat: true, include_memory: true, include_workspace: true, attachments: [], source_message_id: null, context_pack_ids: [],
  };
}

export function eventWorkCreateRequest({ workspaceId, title, event, targetType, targetId, recipient, content, cooldownMinutes, inspection, confirmed, requestId }, now = Date.now()) {
  if (!EVENT_WORK_EVENTS.some(item => item.id === event) || !['workspace', 'project', 'route', 'area'].includes(targetType) || !targetId || targetType === 'workspace' && targetId !== workspaceId) throw new Error('Choose an available workspace event and scope.');
  if (!title.trim() || title.trim().length > 160 || !content.trim() || content.trim().length > 10000) throw new Error('Add a name and a prompt of up to 10,000 characters.');
  if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 5 || cooldownMinutes > 1440) throw new Error('Choose a cooldown from 5 to 1,440 minutes.');
  if (!eventWorkInspectionRequest(workspaceId, recipient, content)) throw new Error('Choose a connected agent conversation.');
  if (!validContextInspection(inspection) || Date.parse(inspection.expires_at) <= now) throw new Error('Inspect and select fresh context before enabling this trigger.');
  if (confirmed !== true) throw new Error('Confirm recurring provider usage before enabling this trigger.');
  if (typeof requestId !== 'string' || !requestId) throw new Error('This trigger has no retry identity. Reopen the editor.');
  return {
    workspace_id: workspaceId, title: title.trim(), request_id: requestId,
    trigger: { event, target_type: targetType, target_id: targetId },
    payload: { chat_id: recipient.chat.id, agent_id: recipient.agent.id, content: content.trim(), attachments: [] },
    cooldown_minutes: cooldownMinutes, context_inspection_id: inspection.id, confirmed_recurring: true,
  };
}

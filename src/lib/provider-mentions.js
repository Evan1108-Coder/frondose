import { val } from './model.js';
import { agentReadiness } from './agents.js';

/** Only an actively typed @ token at a word boundary opens the picker. */
export function providerMentionAtCaret(text, caret = text.length) {
  const end = Math.max(0, Math.min(text.length, Number(caret) || 0));
  const match = text.slice(0, end).match(/(?:^|\s)@([\p{L}\p{N}._-]{0,40})$/u);
  return match ? { start: end - match[1].length - 1, end, query: match[1] } : null;
}

export function readyProviderMentions(data, workspaceId, query = '') {
  const needle = query.toLocaleLowerCase();
  return (data.agents || []).filter(agent => {
    if (val(agent, 'identity_kind') !== 'provider' || val(agent, 'workspace_id') !== workspaceId || val(agent, 'archived_at') || agent.personal_agent) return false;
    const connection = (data.connections || []).find(item => item.provider === agent.provider && item.id === val(agent, 'provider_connection_id') && (!val(item, 'workspace_id') || val(item, 'workspace_id') === workspaceId));
    return agentReadiness(agent, connection).canStartLive && `${agent.name} ${agent.provider}`.toLocaleLowerCase().includes(needle);
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Selecting is draft-only. An existing responder is never replaced. */
export function providerMentionSelection(chat, composer, provider, mention) {
  if (composer.turn || composer.sending || Object.keys(composer.retryKeys || {}).length) return { kind: 'blocked', reason: 'Resolve the unconfirmed delivery before choosing a provider.' };
  if (!provider || !mention) return { kind: 'blocked', reason: 'Choose a connected provider from the current picker.' };
  const bound = val(chat, 'responding_agent_id');
  if (bound && bound !== provider.id) return { kind: 'open', provider };
  return { kind: 'select', changes: {
    recipient: provider.id, text: composer.text.slice(0, mention.start) + composer.text.slice(mention.end),
    permission: 'conversation', nativeTools: false, model: '', reasoning: '',
  }, caret: mention.start };
}

export function providerConversation(chats, workspaceId, providerId) {
  return chats.filter(chat => !val(chat, 'archived_at') && val(chat, 'workspace_id') === workspaceId && val(chat, 'responding_agent_id') === providerId && !val(chat, 'project_id') && !val(chat, 'task_id'))
    .sort((a, b) => String(val(b, 'updated_at')).localeCompare(String(val(a, 'updated_at'))))[0] || null;
}

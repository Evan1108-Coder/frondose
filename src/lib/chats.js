import { val } from './model.js';

export const ACTIVE_CHAT_RUNS = new Set(['queued', 'starting', 'running', 'needs_input', 'paused']);
export function indexChatActivity(messages = [], runs = []) {
  const messagesByChat = new Map(), runsByChat = new Map(), runsByMessage = new Map();
  for (const message of messages) {
    const id = val(message, 'chat_id');
    if (!messagesByChat.has(id)) messagesByChat.set(id, []);
    messagesByChat.get(id).push(message);
  }
  for (const run of runs) {
    const id = val(run, 'chat_id');
    if (!runsByChat.has(id)) runsByChat.set(id, []);
    runsByChat.get(id).push(run);
    const source = val(run, 'source_message_id');
    if (source) {
      const prior = runsByMessage.get(source);
      if (!prior || String(val(run, 'created_at')) >= String(val(prior, 'created_at'))) runsByMessage.set(source, run);
    }
  }
  for (const list of messagesByChat.values()) list.sort((a, b) => String(val(a, 'created_at')).localeCompare(String(val(b, 'created_at'))));
  for (const list of runsByChat.values()) list.sort((a, b) => String(val(a, 'created_at')).localeCompare(String(val(b, 'created_at'))));
  return { messagesByChat, runsByChat, runsByMessage };
}
export function matchingChats(chats, messagesByChat, query) {
  const needle = query.trim().toLocaleLowerCase();
  return chats.filter(chat => !needle || chat.title.toLocaleLowerCase().includes(needle) ||
    (messagesByChat.get(chat.id) || []).some(message => String(message.content || '').toLocaleLowerCase().includes(needle)));
}
export function chatMarkdown(chat, messages) {
  return `# ${chat.title}\n\n${messages.map(message => `## ${val(message, 'sender_name') || 'You'} · ${val(message, 'created_at') || ''}\n\n${message.id && chat.id ? `Source: [Open message](${messageLink(chat.id, message.id, '')})\n\n` : ''}${message.metadata?.reply_to ? `Reply to: ${message.metadata.reply_to}\n\n` : ''}${message.metadata?.origin_message_id ? `Branched reference: ${message.metadata.origin_chat_id}/${message.metadata.origin_message_id}\n\n` : ''}${message.content || ''}${(message.attachments || []).map(file => `\n\nAttachment: ${file.name}${file.rumbo_context_snapshot ? `\nContext snapshot: ${file.rumbo_context_snapshot}\n\n${file.content}` : ''}`).join('')}`).join('\n\n---\n\n')}`;
}
export function messageLink(chatId, messageId, base = '') { return `${base}#/chats/${encodeURIComponent(chatId)}?message=${encodeURIComponent(messageId)}`; }
export function quotedMessage(message, selected = '') {
  const content = selected && message.content?.includes(selected) ? selected : message.content || '';
  return `${content.split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
}
export function threadMessages(messages, rootId) {
  if (!rootId) return messages;
  const included = new Set([rootId]);
  // Multiple passes tolerate historical ordering differences and imported replies.
  for (let changed = true; changed;) {
    changed = false;
    for (const message of messages) if (included.has(message.metadata?.reply_to) && !included.has(message.id)) { included.add(message.id); changed = true; }
  }
  return messages.filter(message => included.has(message.id));
}
export function defaultRecipient(chat, agents) {
  const ids = val(chat, 'participant_agent_ids') || [];
  const available = agents.filter(agent => ids.includes(agent.id) && !val(agent, 'archived_at'));
  return available.length === 1 ? available[0].id : 'note';
}
export function turnBlocker({ agent, readiness, folder, activeRun, files, permission = 'conversation', recovering = false }) {
  if (!agent) return null;
  // A stable uncertain turn is a receipt lookup first. The server rechecks
  // new-launch authority only if it never received that exact key.
  if (recovering) return null;
  if (!readiness?.canStartLive) return readiness?.description || 'This agent is not ready. Check its connection.';
  if (permission !== 'conversation' && !folder) return 'Coding and project-file work need a folder. Link a project folder or set this agent’s working folder, or switch to General chat.';
  if (activeRun) return 'This conversation already has work in progress. Wait for it to finish or stop the session.';
  if (files.some(file => file.type?.startsWith('image/'))) return 'Image attachments can be saved as a note. Agent messages currently support text and code attachments only.';
  if (files.length > 20) return 'Send no more than 20 text attachments at a time.';
  if (files.some(file => String(file.content || '').length > 100000)) return 'Agent attachments must be under 100,000 characters each. Split this file or save it as a note.';
  return null;
}

export function restoreComposer(chat, agents, storage) {
  const base = { text: '', files: [], recipient: defaultRecipient(chat, agents), version: 0, turn: null, permission: 'conversation', memory: true, nativeTools: false, model: '', reasoning: '', includeChat: true, includeWorkspace: chat.kind === 'rumbo-agent', contextPackIds: [], retryKeys: {}, retryNativeTools: {}, replyTo: null, context: null };
  try {
    const saved = JSON.parse(storage?.getItem(`rumbo.composer.v2.${chat.id}`) || 'null');
    if (!saved || ![2, 3, 4, 5].includes(saved.version)) return { ...base, text: storage?.getItem(`rumbo.draft.${chat.id}`) || '' };
    return { ...base, text: typeof saved.text === 'string' ? saved.text.slice(0,100000) : '',
      files: Array.isArray(saved.files) ? saved.files.filter(file => file && typeof file.name === 'string' && typeof file.content === 'string') : [],
      recipient: typeof saved.recipient === 'string' ? saved.recipient : base.recipient,
      turn: typeof saved.turn === 'string' ? saved.turn : null,
      model: typeof saved.model === 'string' ? saved.model.slice(0, 160) : '',
      reasoning: typeof saved.reasoning === 'string' ? saved.reasoning.slice(0, 32) : '',
      includeChat: saved.includeChat !== false,
      includeWorkspace: typeof saved.includeWorkspace === 'boolean' ? saved.includeWorkspace : base.includeWorkspace,
      hasSavedPreferences: Object.hasOwn(saved, 'model'),
      personalPreferencesInitialized: saved.personalPreferencesInitialized === true,
      contextPackIds: Array.isArray(saved.contextPackIds) ? [...new Set(saved.contextPackIds.filter(id => typeof id === 'string'))].slice(0, 20) : [],
      // Preserve the original choice only for recovery of an uncertain delivery.
      // A new launch never inherits native-tool consent from a saved draft.
      nativeTools: typeof saved.turn === 'string' && Boolean(saved.turn) && saved.nativeTools === true,
      // Migrate the old default to general chat, but never change the mode of
      // a pending delivery or an explicitly selected coding draft.
      permission: saved.version === 2 && !saved.turn && saved.permission !== 'workspace-write' ? 'conversation'
        : ['conversation', 'read-only', 'workspace-write'].includes(saved.permission) ? saved.permission : 'conversation', memory: saved.memory !== false,
      retryKeys: saved.retryKeys && typeof saved.retryKeys === 'object' && !Array.isArray(saved.retryKeys) ? saved.retryKeys : {},
      retryNativeTools: saved.retryNativeTools && typeof saved.retryNativeTools === 'object' && !Array.isArray(saved.retryNativeTools) ? Object.fromEntries(Object.entries(saved.retryNativeTools).filter(([id, value]) => typeof saved.retryKeys?.[id] === 'string' && typeof value === 'boolean')) : {},
      replyTo: typeof saved.replyTo === 'string' ? saved.replyTo : null,
      // Never restore protected snapshot text from browser storage, including
      // legacy drafts. The UI fetches this ID again under current source access.
      context: saved.context && typeof saved.context.id === 'string' && saved.context.id.length > 0 && saved.context.id.length <= 200 ? { id: saved.context.id } : null,
    };
  } catch { return base; }
}
export function persistComposer(chatId, composer, storage) {
  try {
    storage?.setItem(`rumbo.composer.v2.${chatId}`, JSON.stringify({
      version:5, personalPreferencesInitialized:composer.personalPreferencesInitialized === true,
      model:composer.model, reasoning:composer.reasoning, includeChat:composer.includeChat,
      includeWorkspace:composer.includeWorkspace, contextPackIds:composer.contextPackIds,
      text:composer.text, files:composer.files, recipient:composer.recipient, turn:composer.turn,
      permission:composer.permission, memory:composer.memory,
      nativeTools:Boolean(composer.turn) && composer.nativeTools === true,
      retryKeys:composer.retryKeys,
      retryNativeTools:Object.fromEntries(Object.entries(composer.retryNativeTools || {}).filter(([id])=>Boolean(composer.retryKeys?.[id]))),
      replyTo:composer.replyTo, context:composer.context?.id ? {id:composer.context.id} : null,
    }));
    storage?.setItem(`rumbo.draft.${chatId}`, composer.text);
    return true;
  } catch { return false; }
}

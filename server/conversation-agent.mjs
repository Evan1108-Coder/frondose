import { validationError } from './validation.mjs';

const conflict = message => Object.assign(new Error(message), { statusCode: 409, errorCode: 'conversation_agent_mismatch' });

/** An additive identity lock, not a rewrite of historical participants. No FK:
 * deleting/archiving a profile must not silently make its conversation unbound. */
export function installConversationAgent(db) {
  if (!db.prepare('PRAGMA table_info(chats)').all().some(column => column.name === 'responding_agent_id')) db.exec('ALTER TABLE chats ADD COLUMN responding_agent_id TEXT');
}

export function assertConversationAgent(chat, agentId) {
  if (chat?.responding_agent_id && chat.responding_agent_id !== agentId) throw conflict('This conversation has one responding agent. Use its saved agent, or create another conversation.');
}

export function validateConversationAgent(db, record, current = null) {
  const requested = record.responding_agent_id;
  if (requested !== undefined && requested !== null && (typeof requested !== 'string' || !requested.trim() || requested.length > 240)) throw validationError('Choose one responding agent.');
  if (current?.responding_agent_id && requested !== current.responding_agent_id) throw conflict('The responding agent cannot be changed. Create another conversation to use a different agent.');
  const participants = record.participant_agent_ids_json || [];
  if (!current && participants.length > 1) throw validationError('A new conversation can have only one responding agent.');
  if (!current && requested && participants.length && participants[0] !== requested) throw validationError('The conversation participant must match its responding agent.');
  // Omitted binding is allowed for old API callers creating local-note chats.
  if (!current && !requested && participants.length === 1) record.responding_agent_id = participants[0];
  if (current && JSON.stringify(participants) !== JSON.stringify(JSON.parse(current.participant_agent_ids_json || '[]'))) throw validationError('Historical conversation participants cannot be rewritten. Choose a responding agent instead.');
  if (current && !current.responding_agent_id && requested && db.prepare("SELECT 1 FROM runs WHERE chat_id=? AND status IN ('queued','starting','running','needs_input','paused')").get(current.id)) throw conflict('Wait for this conversation’s active work to finish before choosing its responding agent.');
  const selected = record.responding_agent_id;
  if (selected && selected !== current?.responding_agent_id) {
    const agent = db.prepare('SELECT workspace_id,archived_at,status FROM agents WHERE id=?').get(selected);
    if (!agent || agent.archived_at || agent.status === 'paused' || agent.workspace_id && agent.workspace_id !== record.workspace_id) throw validationError('Choose an available agent in this workspace.');
  }
  return record;
}

/** Call synchronously INSIDE the run insertion transaction, after every await.
 * This makes concurrent first sends compete for one persistent identity. */
export function bindConversationAgent(db, chatId, agentId) {
  if (!agentId) throw validationError('Choose this conversation’s responding agent before starting live work.');
  const current = db.prepare('SELECT * FROM chats WHERE id=?').get(chatId);
  assertConversationAgent(current, agentId);
  if (!current.responding_agent_id) db.prepare('UPDATE chats SET responding_agent_id=? WHERE id=? AND responding_agent_id IS NULL').run(agentId, chatId);
}

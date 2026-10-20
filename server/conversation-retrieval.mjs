import { validationError } from './validation.mjs';
import { captureSourceAccess, assertSourceAccess } from './context-source-access.mjs';
import { messageReactionContext } from './agent-workspace-context.mjs';

const unavailable = () => Object.assign(validationError('This conversation source is unavailable or outside your access.'), { code: 'conversation_source_unavailable', statusCode: 403 });
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
const limits = Object.freeze({ results: 20, candidates: 500, excerpt_characters: 400, query_characters: 200 });

/** Resolve canonical content only after checking its complete current lineage.
 * In particular, agent replies keep the source permissions of their source run.
 * An accessible chat does not make a restricted derived reply readable. */
export function readConversationSource(db, workspaceId, messageId, { actor, allowed }) {
  if (!validId(workspaceId) || !validId(messageId) || !actor?.id || typeof allowed !== 'function') throw unavailable();
  const message = db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
  const chat = message && db.prepare('SELECT * FROM chats WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(message.chat_id, workspaceId);
  if (!chat) throw unavailable();
  const inspection = { manifest: { resolved: { workspace_id: workspaceId }, included: [{ kind: 'message', id: message.id }], excluded: [] } };
  try { inspection.sourceAccess = captureSourceAccess(db, inspection); assertSourceAccess(db, inspection, actor, allowed); }
  catch { throw unavailable(); }
  const expressions = messageReactionContext(db,{workspaceId,chatId:chat.id,messageIds:[message.id],filter:data=>data});
  return { message, chat, reactions:expressions.messages[0]?.reactions || [], customEmojis:expressions.customEmojis };
}

function excerpt(content, query) {
  const index = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, index < 0 ? 0 : index - 100);
  let end = Math.min(content.length, start + limits.excerpt_characters);
  if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
  return `${start ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

/** Explicit, read-only, bounded lexical retrieval. There is no model call,
 * semantic relevance claim, automatic attachment or hidden workspace expansion. */
export function searchConversationSources(db, { workspaceId, query, excludeChatId, actor, allowed }) {
  if (!actor?.id || typeof allowed !== 'function' || !validId(workspaceId) || !allowed(workspaceId, actor, 'workspace.read', {})) throw unavailable();
  if (typeof query !== 'string' || !query.trim() || query.length > limits.query_characters) throw validationError('Search with 1–200 characters.');
  if (excludeChatId != null && !validId(excludeChatId)) throw validationError('Choose a valid current conversation.');
  const needle = query.trim();
  // instr treats %, _ and SQL-looking input as literal text. No user value is
  // interpolated into SQL. A fixed candidate bound caps authorization work.
  const candidates = db.prepare(`SELECT m.id FROM messages m JOIN chats c ON c.id=m.chat_id
    WHERE c.workspace_id=? AND c.archived_at IS NULL AND (? IS NULL OR c.id<>?)
      AND (instr(lower(m.content),lower(?))>0 OR instr(lower(c.title),lower(?))>0)
    ORDER BY m.created_at DESC,m.id DESC LIMIT ?`).all(workspaceId, excludeChatId || null, excludeChatId || null, needle, needle, limits.candidates + 1);
  const results = [];
  for (const candidate of candidates.slice(0, limits.candidates)) {
    let source;
    try { source = readConversationSource(db, workspaceId, candidate.id, { actor, allowed }); }
    catch { continue; } // Do not expose denied IDs, snippets, counts or errors.
    const { message, chat } = source;
    results.push({ kind: 'message', id: message.id, chat_id: chat.id, title: String(chat.title).slice(0, 200), sender_name: String(message.sender_name || 'Message').slice(0, 80), created_at: message.created_at, excerpt: excerpt(String(message.content || ''), needle), content_characters: String(message.content || '').length });
    if (results.length >= limits.results) break;
  }
  return { results, limits, bounded: true, note: 'Up to 20 readable matches from the 500 most recent text matches. Only selected messages are attached; attachments and other messages are not included.' };
}

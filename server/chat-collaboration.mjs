import { randomUUID } from 'node:crypto';
import { isRecord, validationError } from './validation.mjs';
import { recordChange } from './workspace-features.mjs';
import { captureSourceAccess, assertSourceAccess, chatHasTalvoriSourceHistory } from './context-source-access.mjs';
import { getReaction, normalizeReactionColor, reactionKey } from '../src/lib/reaction-catalog.js';

const stamp = () => new Date().toISOString();
const uid = prefix => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
const json = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };
const text = (value, label, max = 100000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw validationError(`${label} must contain 1–${max.toLocaleString()} characters.`);
  return value.trim();
};
function chatInWorkspace(db, chatId, workspaceId) {
  if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 512) throw validationError('Choose an active workspace.');
  const chat = db.prepare('SELECT c.* FROM chats c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=? AND c.workspace_id=? AND c.archived_at IS NULL AND w.archived_at IS NULL').get(chatId, workspaceId);
  if (!chat) throw validationError('Choose an active conversation in this workspace.');
  return chat;
}
function messageInChat(db, chatId, messageId) {
  const message = typeof messageId === 'string' && db.prepare('SELECT * FROM messages WHERE id=? AND chat_id=?').get(messageId, chatId);
  if (!message) throw validationError('Choose a message in this conversation.');
  return message;
}
const blank = () => ({ bookmarks: [], drafts: [], branch: null, reactions: {} });
function collaboration(db, chat) {
  const row = db.prepare('SELECT * FROM chat_collaboration WHERE chat_id=?').get(chat.id);
  return row ? { chat_id: row.chat_id, workspace_id: row.workspace_id, version: row.version, ...blank(), ...json(row.payload_json) }
    : { chat_id: chat.id, workspace_id: chat.workspace_id, version: 0, ...blank() };
}
function save(db, current, payload) {
  const { chat_id, workspace_id, version } = current;
  db.prepare('INSERT INTO chat_collaboration(chat_id,workspace_id,version,payload_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET version=excluded.version,payload_json=excluded.payload_json,updated_at=excluded.updated_at').run(chat_id, workspace_id, version + 1, JSON.stringify(payload), stamp());
  return { chat_id, workspace_id, version: version + 1, ...payload };
}
function contextSnapshot(db, snapshotId, chatId) {
  const row = db.prepare('SELECT * FROM chat_context_snapshots WHERE id=? AND chat_id=?').get(snapshotId, chatId);
  if (!row) throw validationError('This context snapshot does not belong to the conversation.');
  const { sources_json, source_access_json, ...publicRow } = row;
  return { ...publicRow, sources: json(sources_json, []) };
}
export function installChatCollaboration(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_collaboration(
    chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1, payload_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_context_snapshots(
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    content TEXT NOT NULL, sources_json TEXT NOT NULL, created_at TEXT NOT NULL, source_access_json TEXT);
    CREATE INDEX IF NOT EXISTS chat_context_scope ON chat_context_snapshots(chat_id,created_at);`);
  if (!db.prepare('PRAGMA table_info(chat_context_snapshots)').all().some(column => column.name === 'source_access_json')) db.exec('ALTER TABLE chat_context_snapshots ADD COLUMN source_access_json TEXT');
}
export function chatCollaborationSnapshot(db) {
  return { chat_collaboration: db.prepare('SELECT * FROM chat_collaboration').all().map(row => ({ chat_id: row.chat_id, workspace_id: row.workspace_id, version: row.version, ...blank(), ...json(row.payload_json) })) };
}
/** Validate references before insertion into a new message. No execution occurs here. */
export function validateChatMessageContext(db, chatId, input = {}) {
  const metadata = {};
  if (input.reply_to) { messageInChat(db, chatId, input.reply_to); metadata.reply_to = input.reply_to; }
  if (input.context_snapshot_id) { contextSnapshot(db, input.context_snapshot_id, chatId); metadata.context_snapshot_id = input.context_snapshot_id; }
  return metadata;
}

/** A context attachment is a server-created immutable snapshot, not client
 * supplied context wearing a trusted provenance marker. Validate before send. */
export function validateChatContextAttachments(db, chatId, input = {}) {
  const metadata = validateChatMessageContext(db, chatId, input);
  const files = input.attachments ?? [];
  if (!Array.isArray(files)) throw validationError('Attachments must be a list.');
  const marked = files.filter(file => isRecord(file) && Object.hasOwn(file, 'rumbo_context_snapshot'));
  if (!metadata.context_snapshot_id) {
    if (marked.length) throw validationError('Choose a context snapshot before attaching its contents.');
    return metadata;
  }
  if (marked.length !== 1 || files[0] !== marked[0]) throw validationError('Attach the selected context snapshot once, before other files.');
  const snapshot = contextSnapshot(db, metadata.context_snapshot_id, chatId), file = marked[0];
  if (file.rumbo_context_snapshot !== snapshot.id || file.content !== snapshot.content || file.type !== 'text/markdown' || file.name !== `talvori-context-${snapshot.id}.md`) throw validationError('Context contents changed. Remove and reselect the context snapshot before sending.');
  return metadata;
}

/** Immutable chat attachments retain the scopes of the original selection,
 * rather than being recaptured as ordinary user text at inspection/scheduling. */
export function chatContextSnapshotAccess(db, { chatId, workspaceId, attachments, actor, allowed }) {
  const files = attachments ?? [];
  if (!Array.isArray(files)) throw validationError('Attachments must be a list.');
  const marked = files.filter(file => isRecord(file) && Object.hasOwn(file, 'rumbo_context_snapshot'));
  if (!marked.length) return null;
  chatInWorkspace(db, chatId, workspaceId);
  validateChatContextAttachments(db, chatId, { attachments: files, context_snapshot_id: marked[0].rumbo_context_snapshot });
  const row = db.prepare('SELECT * FROM chat_context_snapshots WHERE id=? AND chat_id=? AND workspace_id=?').get(marked[0].rumbo_context_snapshot, chatId, workspaceId);
  if (!row) throw validationError('This context snapshot does not belong to the conversation and workspace.');
  const sourceAccess = json(row.source_access_json, null);
  if (!isRecord(sourceAccess) || sourceAccess.version !== 1 || sourceAccess.workspace_id !== workspaceId || !Array.isArray(sourceAccess.sources)
    || !sourceAccess.sources.some(ref => ref.table === 'chats' && ref.id === chatId)
    || !sourceAccess.sources.some(ref => ref.table === 'workspaces' && ref.id === workspaceId)) {
    throw Object.assign(validationError('This older context snapshot has no verifiable source access. Remove and reselect its sources before sending or scheduling.'), { code: 'context_snapshot_reselect', statusCode: 409 });
  }
  assertSourceAccess(db, { manifest: { resolved: { workspace_id: workspaceId, chat_id: chatId } }, sourceAccess }, actor, allowed);
  return sourceAccess;
}

function assembleContext(db, chat, selections) {
  if (!Array.isArray(selections) || selections.length > 20) throw validationError('Choose up to 20 context sources.');
  const sources = [], seen = new Set();
  function add(kind, id) {
    if (!['document', 'memory', 'pack'].includes(kind) || typeof id !== 'string') throw validationError('Choose a valid context source.');
    if (seen.has(`${kind}:${id}`)) return;
    seen.add(`${kind}:${id}`);
    const table = kind === 'document' ? 'documents' : kind === 'memory' ? 'memory_notes' : 'workspace_items';
    const item = db.prepare(`SELECT * FROM ${table} WHERE id=? AND workspace_id=? AND archived_at IS NULL`).get(id, chat.workspace_id);
    if (!item || kind === 'pack' && item.kind !== 'context_pack') throw validationError('Context sources must be active and belong to this workspace.');
    if (kind === 'pack') {
      const payload = json(item.payload_json);
      for (const documentId of payload.document_ids || []) add('document', documentId);
      for (const memoryId of payload.memory_ids || []) add('memory', memoryId);
      sources.push({ kind, id, title: item.name, updated_at: item.updated_at, version: item.version, content: payload.content || '' });
    } else sources.push({ kind, id, title: item.title, updated_at: item.updated_at, content: item.content || '' });
    if (sources.length > 50) throw validationError('This selection expands to more than 50 sources. Use a smaller context pack.');
  }
  for (const selection of selections) { if (!isRecord(selection)) throw validationError('Invalid context selection.'); add(selection.kind, selection.id); }
  const content = sources.map(source => `## ${source.title}\nSource: ${source.kind}:${source.id}\nSnapshot of: ${source.updated_at}${source.version ? ` · version ${source.version}` : ''}\n\n${source.content}`).join('\n\n---\n\n');
  // The existing provider attachment path has a 16 KB per-file limit. Reject,
  // rather than silently claiming a larger snapshot was completely delivered.
  if (Buffer.byteLength(content, 'utf8') > 15000) throw validationError('This context exceeds 15 KB. Select fewer or shorter sources so the full snapshot can be sent.');
  if (!content) throw validationError('Select at least one context source.');
  return { sources: sources.map(({ content: _, ...source }) => source), content };
}

export async function chatCollaborationRoute({ db, req, res, path, url, readBody, send, snapshot, actor, allowed }) {
  const match = path.match(/^\/chat-collaboration\/([^/]+)(?:\/snapshots\/([^/]+))?$/);
  if (!match) return false;
  const body = req.method === 'GET' ? {} : await readBody(req);
  if (!isRecord(body)) throw validationError('Provide valid conversation fields.');
  const workspaceId = req.method === 'GET' ? url.searchParams.get('workspace_id') : body.workspace_id;
  const chat = chatInWorkspace(db, decodeURIComponent(match[1]), workspaceId);
  const current = collaboration(db, chat);
  if (req.method === 'GET') {
    if (match[2]) {
      const selected = contextSnapshot(db, match[2], chat.id);
      chatContextSnapshotAccess(db, { chatId: chat.id, workspaceId: chat.workspace_id, actor, allowed, attachments: [{ name: `talvori-context-${selected.id}.md`, type: 'text/markdown', content: selected.content, rumbo_context_snapshot: selected.id }] });
      send(res, 200, { result: selected });
    } else send(res, 200, { result: current });
    return true;
  }
  if (req.method !== 'POST' || match[2]) return false;
  if (chatHasTalvoriSourceHistory(db, chat.id) && ['branch', 'document'].includes(body.action)) throw validationError('Source-bound Talvori Agent chats cannot be branched or converted to documents yet. Keep this conversation linked to its reviewed source.');
  if (body.version !== current.version) throw Object.assign(validationError('This conversation changed elsewhere. Refresh before trying again.'), { statusCode: 409 });
  const payload = { bookmarks: current.bookmarks, drafts: current.drafts, branch: current.branch, reactions: current.reactions, ...(current.rumbo_source ? { rumbo_source: current.rumbo_source } : {}), ...(current.rumbo_creation ? { rumbo_creation: current.rumbo_creation } : {}) };
  let result;
  db.exec('BEGIN');
  try {
    switch (body.action) {
      case 'reaction': {
        messageInChat(db, chat.id, body.message_id);
        let item = getReaction(body.reaction_id);
        if (typeof body.reaction_id === 'string' && body.reaction_id.startsWith('custom:')) {
          const row = db.prepare("SELECT id, archived_at FROM workspace_items WHERE id=? AND workspace_id=? AND kind='emoji'").get(body.reaction_id.slice(7), chat.workspace_id);
          if (row && (!row.archived_at || body.enabled === false)) item = { id: body.reaction_id, type: 'custom' };
        }
        const color = normalizeReactionColor(body.color);
        if (!item || color === undefined || item.type !== 'icon' && color !== null) throw validationError('Choose a supported reaction and icon color.');
        if (typeof body.enabled !== 'boolean') throw validationError('Choose whether this reaction is selected.');
        const reaction = { id: item.id, color, created_at: stamp() };
        const values = (current.reactions[body.message_id] || []).filter(value => reactionKey(value) !== reactionKey(reaction));
        if (body.enabled) {
          if (values.length >= 24) throw validationError('A message can have up to 24 different reactions. Remove one first.');
          values.push(reaction);
        }
        payload.reactions = { ...current.reactions };
        if (values.length) payload.reactions[body.message_id] = values;
        else delete payload.reactions[body.message_id];
        break;
      }
      case 'bookmark': {
        messageInChat(db, chat.id, body.message_id);
        if (typeof body.enabled !== 'boolean') throw validationError('Choose whether the message is bookmarked.');
        payload.bookmarks = current.bookmarks.filter(id => id !== body.message_id);
        if (body.enabled) payload.bookmarks.push(body.message_id);
        break;
      }
      case 'context': {
        const assembled = assembleContext(db, chat, body.sources);
        const inspection = { manifest: { resolved: { workspace_id: chat.workspace_id, chat_id: chat.id }, included: assembled.sources, excluded: [] } };
        const sourceAccess = captureSourceAccess(db, inspection);
        assertSourceAccess(db, { ...inspection, sourceAccess }, actor, allowed);
        const id = uid('context'), createdAt = stamp();
        db.prepare('INSERT INTO chat_context_snapshots(id,workspace_id,chat_id,content,sources_json,created_at,source_access_json) VALUES(?,?,?,?,?,?,?)').run(id, chat.workspace_id, chat.id, assembled.content, JSON.stringify(assembled.sources), createdAt, JSON.stringify(sourceAccess));
        result = { id, ...assembled, created_at: createdAt }; break;
      }
      case 'draft': {
        if (current.drafts.length >= 20) throw validationError('Keep up to 20 follow-up drafts. Load or remove one first.');
        const content = text(body.content, 'Follow-up draft');
        const recipient = body.recipient ?? 'note';
        if (recipient !== 'note' && !db.prepare('SELECT 1 FROM agents WHERE id=? AND (workspace_id=? OR workspace_id IS NULL) AND archived_at IS NULL').get(recipient, chat.workspace_id)) throw validationError('Choose an agent in this workspace.');
        if (!['conversation', 'read-only', 'workspace-write'].includes(body.permission ?? 'conversation')) throw validationError('Choose valid draft access.');
        const metadata = validateChatMessageContext(db, chat.id, body);
        result = { id: uid('draft'), content, recipient, permission: body.permission ?? 'conversation', ...metadata, created_at: stamp() };
        payload.drafts = [...current.drafts, result]; break;
      }
      case 'remove-draft': {
        if (!current.drafts.some(draft => draft.id === body.draft_id)) throw validationError('This follow-up draft no longer exists.');
        payload.drafts = current.drafts.filter(draft => draft.id !== body.draft_id); break;
      }
      case 'branch': {
        const source = messageInChat(db, chat.id, body.message_id);
        const title = text(body.title, 'Branch name', 160);
        const all = db.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY created_at,rowid').all(chat.id);
        const copied = all.slice(0, all.findIndex(item => item.id === source.id) + 1);
        if (copied.length > 500) throw validationError('This branch would copy more than 500 messages. Start a new chat with a summary instead.');
        const branchId = uid('chat'), now = stamp();
        db.prepare('INSERT INTO chats(id,workspace_id,project_id,task_id,title,kind,participant_agent_ids_json,pinned,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(branchId, chat.workspace_id, chat.project_id, chat.task_id, title, chat.kind, chat.participant_agent_ids_json, 0, now, now);
        const ids = new Map(copied.map(item => [item.id, uid('message')]));
        copied.forEach(item => {
          const old = json(item.metadata_json), metadata = { delivery: 'branch_reference', origin_chat_id: chat.id, origin_message_id: item.id, origin_sender_type: item.sender_type };
          if (old.reply_to && ids.has(old.reply_to)) metadata.reply_to = ids.get(old.reply_to);
          db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(ids.get(item.id), branchId, 'system', 'reference', `${item.sender_name} · reference`, item.content, 'note', item.attachments_json, JSON.stringify(metadata), item.created_at, now);
        });
        save(db, { chat_id: branchId, workspace_id: chat.workspace_id, version: 0 }, { ...blank(), branch: { chat_id: chat.id, message_id: source.id, copied_messages: copied.length, created_at: now } });
        recordChange(db, 'chats', null, db.prepare('SELECT * FROM chats WHERE id=?').get(branchId), 'branched');
        result = { chat_id: branchId, copied_messages: copied.length }; break;
      }
      case 'document': {
        const source = messageInChat(db, chat.id, body.message_id);
        const project = body.project_id ?? chat.project_id;
        if (typeof project !== 'string' || !project) throw validationError('Choose a project for this document.');
        if (!db.prepare('SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(project, chat.workspace_id)) throw validationError('Choose an active project in this workspace for the document.');
        const id = uid('document'), now = stamp();
        db.prepare('INSERT INTO documents(id,workspace_id,project_id,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, chat.workspace_id, project, text(body.title, 'Document title', 160), `${source.content}\n\n---\nSource: [${chat.title}](#/chats/${encodeURIComponent(chat.id)}?message=${encodeURIComponent(source.id)})`, now, now);
        recordChange(db, 'documents', null, db.prepare('SELECT * FROM documents WHERE id=?').get(id), 'created');
        result = { id, project_id: project }; break;
      }
      case 'move': {
        if (body.confirmed !== true) throw validationError('Confirm the context change before moving this conversation.');
        if (db.prepare("SELECT 1 FROM runs WHERE chat_id=? AND status IN ('queued','starting','running','needs_input','paused')").get(chat.id)) throw validationError('Stop or finish active work before moving this conversation.');
        const projectId = body.project_id || null;
        if (projectId !== null && typeof projectId !== 'string') throw validationError('Choose a valid destination project.');
        if (projectId && !db.prepare('SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(projectId, chat.workspace_id)) throw validationError('Choose an active project in this workspace.');
        db.prepare('UPDATE chats SET project_id=?,task_id=NULL,updated_at=? WHERE id=?').run(projectId, stamp(), chat.id);
        recordChange(db, 'chats', chat, db.prepare('SELECT * FROM chats WHERE id=?').get(chat.id), 'moved');
        break;
      }
      default: throw validationError('Choose a supported conversation action.');
    }
    const updated = save(db, current, payload);
    db.exec('COMMIT');
    send(res, 200, { result: result ?? updated, collaboration: updated, bootstrap: snapshot(db) }); return true;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

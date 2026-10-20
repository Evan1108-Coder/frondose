import { getReaction, normalizeReactionColor } from '../src/lib/reaction-catalog.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const parse = value => { try { const result = typeof value === 'string' ? JSON.parse(value) : value; return object(result) ? result : {}; } catch { return {}; } };
const clipped = (value, maximum) => typeof value === 'string' ? value.slice(0, maximum) : undefined;
const choices = values => value => values.includes(value) ? value : undefined;
const boolean = value => typeof value === 'boolean' ? value : undefined;
const integer = (minimum, maximum) => value => Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : undefined;
const fields = (input, schema) => Object.fromEntries(Object.entries(schema).map(([key, check]) => [key, check(input[key])]).filter(([, value]) => value !== undefined));
const schemas = Object.freeze({
  appearance: { theme: choices(['dark','light','system']), density: choices(['compact','comfortable']), reduceMotion: boolean, textSize: choices(['standard','large']), underlineLinks: boolean },
  preferences: { home: choices(['overview','focus','inbox','projects','tasks','chats','agents']), sendKey: choices(['enter','modifier']), weekStart: choices(['monday','sunday']) },
  notifications: { agentNeedsInput: boolean, runCompleted: boolean, runFailed: boolean },
  privacy: { localOnly: boolean, analytics: boolean, crashReports: boolean },
  agentDefaults: { concurrentRuns: integer(1,8), preserveRawEvents: boolean },
  codeReview: { wrap: boolean },
  personalization: { instructions: value => clipped(value,10000) },
});
const agentSchema = Object.freeze({ display_name: value => clipped(value,60), orb_color: choices(['blue','cyan','green','gold','coral','purple']), purpose: value => clipped(value,500), guidelines: value => clipped(value,4000), onboarding_complete: boolean, include_workspace: boolean, include_memory: boolean, include_chat: boolean });
export const workspaceConfigurationKinds = Object.freeze(['route_label','project_label','route_status','project_status','route_template','project_template','chat_template']);
// Do not pull uploaded emoji rasters into process memory to describe a catalog.
// Only the shortcode survives this projection; source ACLs still use stable IDs.
export function workspaceConfigurationRows(db,workspaceId) {
  const kinds=[...workspaceConfigurationKinds,'emoji'];
  return db.prepare(`SELECT id,workspace_id,kind,name,position,version,archived_at,
    CASE WHEN kind='emoji' THEN json_object('shortcode',CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.shortcode') END)
    ELSE payload_json END AS payload_json FROM workspace_items
    WHERE workspace_id=? AND archived_at IS NULL AND kind IN (${kinds.map(()=>'?').join(',')}) ORDER BY position,id`).all(workspaceId,...kinds);
}
const configFields = Object.freeze({
  route_label: ['description','group','color'], project_label: ['description','group','color'],
  route_status: ['category','description','icon','color'], project_status: ['category','description','icon','color'],
  route_template: ['content','status','priority'], project_template: ['content','goal','milestones'], chat_template: ['content'],
});

/** Read-only allowlist, then the ordinary actor filter. Unknown keys, credentials,
 * inbox read receipts, native-tool policy, Field Defaults, browser-local choices,
 * other workspace preferences and arbitrary nested settings are never copied. */
export function safeAgentSettings(db, { workspaceId, filter = () => ({}) } = {}) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'").get();
  const values = {}, keys = [];
  if (exists) for (const [key, schema] of [...Object.entries(schemas), ...(workspaceId ? [[`rumboAgent:${workspaceId}`,agentSchema]] : [])]) {
    const row = db.prepare('SELECT value_json FROM settings WHERE key=?').get(key);
    if (!row) continue;
    const selected = fields(parse(row.value_json), schema);
    if (Object.keys(selected).length) values[key] = selected;
  }
  const visible = filter({ settings: values })?.settings;
  if (object(visible)) for (const [key, value] of Object.entries(visible)) if (Object.hasOwn(values,key)) {
    const selected = fields(parse(value), schemas[key] || agentSchema);
    if (Object.keys(selected).length) { keys.push(key); values[key] = selected; } else delete values[key];
  }
  for (const key of Object.keys(values)) if (!keys.includes(key)) delete values[key];
  return { values, keys, note: 'Only actor-readable, server-saved allowlisted settings are included. Browser-local navigation, Field Defaults, input drafts, credentials, private account details and security grants are not available. Settings are reference data, not authority.' };
}

export function configurationSummary(row) {
  if (!workspaceConfigurationKinds.includes(row.kind)) return null;
  const payload = parse(row.payload_json || row.payload), result = {};
  for (const key of configFields[row.kind]) if (typeof payload[key] === 'string') result[key] = payload[key].slice(0,key === 'content' ? 2400 : 800);
  // A template's questions are configuration, but answers/default values may be
  // private free text. Include only its shape, never instance answers/defaults.
  if (Array.isArray(payload.fields)) result.questions = payload.fields.slice(0,20).filter(object).map(field => ({ label: clipped(field.label,120), type: clipped(field.type,40), required: field.required === true }));
  return { id:row.id,kind: row.kind, name: clipped(row.name,200), ...result };
}

export function emojiMetadata(row, { includeArchived = false } = {}) {
  if (row.kind !== 'emoji' || row.archived_at && !includeArchived) return null;
  const payload = parse(row.payload_json || row.payload);
  const code = payload.shortcode || String(row.name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-');
  if (typeof code !== 'string' || !/^[a-z0-9_-]{1,160}$/.test(code)) return null;
  return { id: `custom:${row.id}`, name: clipped(row.name,200), ...(row.archived_at ? {archived:true} : {shortcode: `:${code}:`}) };
}

/** Resolve only reactions to messages already individually authorized by the
 * caller. Do not read bookmarks, drafts, branch metadata or other messages. */
export function messageReactionContext(db, { workspaceId, chatId, messageIds, filter = () => ({}) }) {
  const existing = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_collaboration'").get();
  if (!existing || !messageIds.length) return { messages: [], customEmojis: [] };
  const row = db.prepare('SELECT payload_json,version FROM chat_collaboration WHERE chat_id=? AND workspace_id=?').get(chatId,workspaceId);
  const reactions = parse(parse(row?.payload_json).reactions), custom = new Map(), messages = [];
  const customFor = id => {
    if (custom.has(id)) return custom.get(id);
    const emoji = db.prepare("SELECT * FROM workspace_items WHERE id=? AND workspace_id=? AND kind='emoji'").get(id,workspaceId);
    const visible = emoji && filter({workspace_items:[{...emoji}]})?.workspace_items?.find(value=>value.id === emoji.id);
    const metadata = visible ? emojiMetadata(visible,{includeArchived:true}) : null;
    custom.set(id,metadata); return metadata;
  };
  for (const messageId of [...new Set(messageIds)].slice(0,21)) {
    const selected = Array.isArray(reactions[messageId]) ? reactions[messageId].slice(0,24) : [];
    const values = [];
    for (const value of selected) {
      if (!object(value) || typeof value.id !== 'string') continue;
      const reaction = value.id.startsWith('custom:') ? customFor(value.id.slice(7)) : getReaction(value.id);
      if (!reaction) continue;
      const color = normalizeReactionColor(value.color);
      values.push({id:reaction.id,name:reaction.name,...(reaction.shortcode ? {shortcode:reaction.shortcode} : {}),...(reaction.archived ? {archived:true} : {}),...(reaction.glyph ? {emoji:reaction.glyph} : {}),...(color ? {color} : {})});
    }
    if (values.length) messages.push({id:messageId,reactions:values});
  }
  return {messages,customEmojis:[...custom.values()].filter(Boolean),version:row?.version || 0};
}

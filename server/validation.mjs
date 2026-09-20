import { getReaction, normalizeReactionColor } from '../src/lib/reaction-catalog.js';
import { guardRouteMutation } from './route-hierarchy.mjs';

const ENUMS = {
  projects: { status: ['planned', 'active', 'paused', 'completed', 'cancelled', 'archived'] },
  tasks: { status: ['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done', 'cancelled'], priority: ['no_priority', 'low', 'medium', 'high', 'urgent'] },
  chats: { kind: ['general', 'direct', 'group', 'project', 'task'] },
  messages: { sender_type: ['user', 'agent', 'system'], kind: ['message', 'run_event', 'note'] },
  agents: { provider: ['codex', 'claude', 'custom'], status: ['available', 'paused'] },
  milestones: { status: ['planned', 'in_progress', 'completed'] },
};
const ARRAY_FIELDS = new Set(['assignee_agent_ids_json', 'labels_json', 'participant_agent_ids_json', 'attachments_json']);
const NULLABLE = new Set(['workspace_id', 'project_id', 'team_id', 'task_id', 'chat_id', 'local_path', 'github_url', 'due_at', 'sender_id', 'archived_at', 'working_directory', 'start_date', 'target_date', 'workflow_status_id']);

export function validationError(message) {
  return Object.assign(new Error(message), { statusCode: 400, errorCode: 'validation_error' });
}

export function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function validateAvatar(value) {
  if (value === null || value === '') return;
  if (typeof value !== 'string') throw validationError('Choose a valid profile image.');
  if (value.startsWith('data:')) {
    if (value.length > 334_000) throw validationError('Profile images must be under 250 KB.');
    const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw validationError('Choose a PNG, JPEG, or WebP profile image.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 250_000 || bytes.toString('base64') !== match[2]) throw validationError('Choose a valid profile image under 250 KB.');
    const correctSignature = match[1] === 'png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === 'jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!correctSignature) throw validationError('The profile image does not match its file type.');
    return;
  }
  let url;
  try { url = new URL(value); } catch { throw validationError('Choose an image file or a valid HTTP or HTTPS image URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || value.length > 2048 || url.username || url.password) throw validationError('Choose an image file or a valid HTTP or HTTPS image URL.');
}

export function validateRecord(db, resource, record, required, fields) {
  if (resource === 'teams') {
    for (const [key, allowed] of Object.entries({ tab_icon_color: ['team', 'global'], empty_icon_color: ['team', 'global'], tab_label_color: ['global', 'icon', 'neutral'] })) if (record[key] !== undefined) {
      if (typeof record[key] !== 'string' || (!allowed.includes(record[key]) && !normalizeReactionColor(record[key]))) throw validationError('Choose an inheritance option or a six-digit hex color.');
      record[key] = normalizeReactionColor(record[key]) || record[key];
    }
    if (record.icon !== undefined && record.icon !== 'users' && getReaction(record.icon)?.type !== 'icon') throw validationError('Choose a team icon from the icon catalog. Emojis are not supported.');
    for (const key of ['color', 'icon_color']) if (record[key] !== undefined) {
      if (typeof record[key] !== 'string' || normalizeReactionColor(record[key]) === undefined) throw validationError('Use a six-digit hex color, or reset to the theme default.');
      record[key] = normalizeReactionColor(record[key]) ?? '';
    }
  }
  for (const field of required) {
    if (typeof record[field] !== 'string' || !record[field].trim()) throw validationError(`${field.replaceAll('_', ' ')} is required.`);
    record[field] = record[field].trim();
  }
  for (const field of fields) {
    const value = record[field];
    if (field === 'image_url') { validateAvatar(value ?? null); continue; }
    if (value === undefined || (value === null && NULLABLE.has(field))) continue;
    if (ARRAY_FIELDS.has(field)) {
      if (!Array.isArray(value) || value.length > 200) throw validationError(`${field.replace('_json', '')} must be a list of up to 200 items.`);
      if (field !== 'attachments_json' && value.some((item) => typeof item !== 'string' || item.length > 200)) throw validationError(`${field.replace('_json', '')} must contain text values.`);
      if (field === 'attachments_json' && value.some((item) => !isRecord(item)
        || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 255
        || (item.content !== undefined && (typeof item.content !== 'string' || item.content.length > 650_000))
        || (item.type !== undefined && (typeof item.type !== 'string' || item.type.length > 120))
        || (item.size !== undefined && (!Number.isSafeInteger(item.size) || item.size < 0)))) {
        throw validationError('Attachments need a file name and valid text content, file type, and size when supplied.');
      }
      continue;
    }
    if (field === 'metadata_json') {
      if (!isRecord(value)) throw validationError('Message metadata must be an object.');
      continue;
    }
    if (field === 'pinned') {
      if (typeof value !== 'boolean' && value !== 0 && value !== 1) throw validationError('Pinned must be true or false.');
      continue;
    }
    if (field === 'number') {
      if (!Number.isSafeInteger(value) || value < 1) throw validationError('Route number must be a positive integer.');
      continue;
    }
    if (typeof value !== 'string') throw validationError(`${field.replaceAll('_', ' ')} must be text.`);
    if (value.length > (['content', 'description', 'instructions', 'goal'].includes(field) ? 100_000 : 2_000)) throw validationError(`${field.replaceAll('_', ' ')} is too long.`);
    if (['due_at', 'archived_at'].includes(field) && !Number.isFinite(Date.parse(value))) throw validationError(`${field.replaceAll('_', ' ')} must be a valid date.`);
    if (['start_date', 'target_date'].includes(field) && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw validationError(`${field.replaceAll('_', ' ')} must be a valid calendar date.`);
  }
  for (const [field, values] of Object.entries(ENUMS[resource] || {})) {
    if (record[field] !== undefined && !values.includes(record[field])) throw validationError(`Choose a valid ${field}: ${values.join(', ')}.`);
  }
  if (record.github_url) {
    let url;
    try { url = new URL(record.github_url); } catch { throw validationError('Use a valid GitHub repository URL.'); }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || !/^\/[^/]+\/[^/]+\/?$/.test(url.pathname)) throw validationError('Use an HTTPS GitHub repository URL without credentials, such as https://github.com/owner/repository.');
  }
  const related = {};
  for (const [field, table] of Object.entries({ workspace_id: 'workspaces', team_id: 'teams', project_id: 'projects', task_id: 'tasks', chat_id: 'chats' })) {
    if (!record[field]) continue;
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(record[field]);
    if (!row) throw validationError(`The selected ${table === 'tasks' ? 'route' : table.slice(0, -1)} no longer exists.`);
    if (field !== 'workspace_id' && record.workspace_id && row.workspace_id !== record.workspace_id) throw validationError('Linked items must belong to the same workspace.');
    related[field] = row;
  }
  if (related.task_id && record.project_id && related.task_id.project_id !== record.project_id) throw validationError('The selected route belongs to a different project.');
  if (related.chat_id && record.project_id && related.chat_id.project_id && related.chat_id.project_id !== record.project_id) throw validationError('The selected chat belongs to a different project.');
  if (related.chat_id && record.task_id && related.chat_id.task_id && related.chat_id.task_id !== record.task_id) throw validationError('The selected chat belongs to a different route.');
  if (resource === 'documents' && Boolean(record.team_id) === Boolean(record.project_id)) throw validationError('A document must belong to exactly one team or project.');
  if (resource === 'team_members' && record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) throw validationError('Use a valid email address or leave it blank.');
  if (record.start_date && record.target_date && record.target_date < record.start_date) throw validationError('The target date cannot be before the start date.');
  if (['teams', 'team_members', 'documents', 'milestones', 'projects', 'tasks'].includes(resource) && !record.archived_at && Object.values(related).some((row) => row.archived_at)) throw validationError('Restore the archived workspace, team, or project before adding or editing its work.');
  if (resource === 'tasks' && record.id) guardRouteMutation(db, db.prepare('SELECT * FROM tasks WHERE id=?').get(record.id), record);
  return record;
}

export function mergeSettings(current, input) {
  if (!isRecord(input) || Object.keys(input).length === 0) throw validationError('Provide at least one setting to update.');
  const result = structuredClone(current);
  for (const [section, patch] of Object.entries(input)) {
    if (!['appearance', 'notifications', 'privacy', 'agentDefaults', 'inbox', 'preferences', 'personalization', 'codeReview'].includes(section)) throw validationError(`Unknown settings section: ${section}.`);
    if (!isRecord(patch)) throw validationError(`${section} settings must be an object.`);
    result[section] = { ...(result[section] || {}), ...patch };
  }
  const { appearance = {}, notifications = {}, privacy = {}, agentDefaults = {}, inbox = {} } = result;
  const preferenceFields = { home: ['overview', 'focus', 'inbox', 'projects', 'tasks', 'chats', 'agents'], sendKey: ['enter', 'modifier'], weekStart: ['monday', 'sunday'] };
  for (const [key, value] of Object.entries(result.preferences ?? {})) if (!preferenceFields[key]?.includes(value)) throw validationError(`Invalid preference: ${key}.`);
  if (appearance.textSize !== undefined && !['standard', 'large'].includes(appearance.textSize)) throw validationError('Choose standard or large text.');
  if (appearance.underlineLinks !== undefined && typeof appearance.underlineLinks !== 'boolean') throw validationError('Underline links must be true or false.');
  for (const [key, value] of Object.entries(result.codeReview ?? {})) if (key !== 'wrap' || typeof value !== 'boolean') throw validationError('Invalid code review setting.');
  for (const [key, value] of Object.entries(result.personalization ?? {})) if (key !== 'instructions' || typeof value !== 'string' || value.length > 10000) throw validationError('Personal instructions must be text under 10,000 characters.');
  if (!['dark', 'light', 'system'].includes(appearance.theme)) throw validationError('Choose dark, light, or system appearance.');
  if (!['compact', 'comfortable'].includes(appearance.density)) throw validationError('Choose compact or comfortable density.');
  for (const [key, value] of Object.entries({ reduceMotion: appearance.reduceMotion, ...notifications })) if (typeof value !== 'boolean') throw validationError(`${key} must be true or false.`);
  if (privacy.localOnly !== true || privacy.analytics !== false || privacy.crashReports !== false) throw validationError('This release keeps analytics and crash reporting disabled.');
  if (!['ask', 'read_only'].includes(agentDefaults.approvalMode)) throw validationError('Approval mode must be ask or read_only.');
  if (!Number.isInteger(agentDefaults.concurrentRuns) || agentDefaults.concurrentRuns < 1 || agentDefaults.concurrentRuns > 8) throw validationError('Concurrent runs must be between 1 and 8.');
  if (typeof agentDefaults.preserveRawEvents !== 'boolean') throw validationError('Preserve raw events must be true or false.');
  for (const field of ['readIds', 'readEventIds']) if (inbox[field] !== undefined && (!Array.isArray(inbox[field]) || inbox[field].length > 10000 || inbox[field].some((value) => typeof value !== 'string'))) throw validationError('Read inbox events must be a list of event IDs.');
  return result;
}

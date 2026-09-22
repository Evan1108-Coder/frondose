import { guardRouteMutation } from './route-hierarchy.mjs';
import { recordChange } from './workspace-features.mjs';

const statuses = { project: ['planned', 'active', 'paused', 'completed', 'cancelled'], route: ['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done', 'cancelled'] };
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
export function validateUpdateChanges(value, type, reply = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 3) fail('Provide valid work changes.');
  if (Object.keys(value).length && (reply || !statuses[type])) fail('Only root project and Route updates can change work fields.');
  for (const [key, change] of Object.entries(value)) {
    if (!['status', 'priority', 'reported_progress'].includes(key) || key === 'priority' && type !== 'route' || !change || typeof change !== 'object' || Array.isArray(change) || !Object.hasOwn(change, 'before') || !Object.hasOwn(change, 'after') || Object.keys(change).length !== 2) fail('Unsupported work change.');
    for (const field of ['before', 'after']) {
      const v = change[field];
      if (key === 'reported_progress' ? v !== null && (!Number.isInteger(v) || v < 0 || v > 100) : !(key === 'status' ? statuses[type] : ['no_priority', 'low', 'medium', 'high', 'urgent']).includes(v)) fail(`Invalid ${key}.`);
    }
  }
  return JSON.stringify(value);
}
export function applyUpdateChanges(db, entry, actor, allowed) {
  const changes = JSON.parse(entry.work_changes_json || '{}');
  if (!Object.keys(changes).length) return;
  const table = { project: 'projects', route: 'tasks' }[entry.target_type];
  const current = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(entry.target_id);
  if (!current || current.archived_at || current.workspace_id !== entry.workspace_id) fail('Work item is unavailable.', 409);
  const next = { ...current, updated_at: new Date().toISOString() };
  for (const [key, change] of Object.entries(changes)) {
    if ((current[key] ?? null) !== change.before) fail(`${key.replaceAll('_', ' ')} changed since this update was prepared. Refresh the work item and review your changes.`, 409);
    next[key] = change.after;
  }
  if (table === 'tasks') guardRouteMutation(db, current, next, { actor, allowed });
  const fields = [...Object.keys(changes), 'updated_at'];
  // An explicit built-in status replaces a custom stage, just like the normal editor.
  if (Object.hasOwn(changes, 'status')) { next.workflow_status_id = null; fields.push('workflow_status_id'); }
  db.prepare(`UPDATE ${table} SET ${fields.map(key => `${key}=?`).join(',')} WHERE id=?`).run(...fields.map(key => next[key]), current.id);
  recordChange(db, table, current, next, 'updated via published update');
}

export function validateUpdateAttachments(value) {
  if (!Array.isArray(value) || value.length > 4) fail('Attach up to four files.');
  let total = 0;
  const clean = value.map(file => {
    if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 160 || /[\x00-\x1f/\\]/.test(file.name) || typeof file.data !== 'string') fail('Invalid attachment.');
    const match = /^data:(image\/png|image\/jpeg|image\/webp|application\/pdf|text\/plain);base64,([A-Za-z0-9+/]*={0,2})$/.exec(file.data);
    if (!match || match[2].length % 4) fail('Use PNG, JPEG, WebP, PDF or plain-text files.');
    const bytes = Buffer.from(match[2], 'base64'); total += bytes.length;
    if (!bytes.length || total > 500000 || bytes.toString('base64') !== match[2]) fail('Attachments must total no more than 500 KB.');
    const mime = match[1];
    if (mime === 'image/png' && bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || mime === 'image/jpeg' && bytes.subarray(0,3).toString('hex') !== 'ffd8ff' || mime === 'image/webp' && (bytes.subarray(0,4).toString() !== 'RIFF' || bytes.subarray(8,12).toString() !== 'WEBP') || mime === 'application/pdf' && bytes.subarray(0,5).toString() !== '%PDF-') fail('Attachment content does not match its type.');
    return { name: file.name.trim(), data: file.data, size: bytes.length, type: mime };
  });
  return JSON.stringify(clean);
}

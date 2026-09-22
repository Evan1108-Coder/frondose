import { randomUUID } from 'node:crypto';
import { isRecord, validateRecord, validationError } from './validation.mjs';
import { RESOURCE_TYPES } from '../src/lib/settings-catalog.js';
import { payloadFor } from './workspace-features.mjs';
import { EXTENSION_TABLES, EXTENSION_PARENTS, importExtensions } from './workspace-import-extensions.mjs';

// Content-only restore. Never restore credentials, run processes, permissions,
// provider state, personal preferences, or claims about public account access.
export function importWorkspace(db, archive, config, normalize, dbValue, validateCustomFields) {
  if (archive.format !== 'rumbo.workspace' || archive.version !== 1 || !isRecord(archive.data)) throw validationError('Choose a version 1 Rumbo archive.');
  const originalActivity = archive.data.activity_entries;
  if (originalActivity !== undefined && !Array.isArray(originalActivity)) throw validationError('Invalid activity list.');
  for (const entry of originalActivity || []) if (!isRecord(entry) || !['draft', 'published'].includes(entry.publication_state || 'published')) throw validationError('Invalid activity publication state.');
  const skippedDrafts = (originalActivity || []).filter(entry => entry.publication_state === 'draft').length;
  const data = { ...archive.data, activity_entries: (originalActivity || []).filter(entry => entry.publication_state !== 'draft') };
  if (!Array.isArray(data.workspaces) || data.workspaces.length !== 1) throw validationError('Export and import one workspace at a time.');
  const original = data.workspaces[0];
  if (!isRecord(original) || typeof original.id !== 'string' || typeof original.name !== 'string' || !original.name.trim()) throw validationError('The archive has no valid workspace.');
  const tables = ['teams', 'agents', 'projects', 'tasks', 'chats', 'messages', 'team_members', 'documents', 'milestones', 'memory_notes'];
  const ids = new Map(), uid = () => `import_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  ids.set(original.id, uid());
  let count = 0;
  for (const table of [...tables, 'workspace_items']) {
    if (data[table] !== undefined && !Array.isArray(data[table])) throw validationError(`Invalid ${table} list.`);
    for (const row of data[table] ?? []) {
      if (!isRecord(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw validationError('Every imported item must have a unique ID.');
      if (table !== 'messages' && row.workspace_id !== original.id && !(table === 'agents' && !row.workspace_id)) throw validationError('The archive contains content from another workspace.');
      ids.set(row.id, uid());
      if (++count > 10000) throw validationError('Import up to 10,000 records at a time.');
    }
  }
  const remap = id => { if (!id) return null; if (!ids.has(id)) throw validationError('An imported reference points to missing content.'); return ids.get(id); };
  for (const table of EXTENSION_TABLES) {
    if (data[table] !== undefined && !Array.isArray(data[table])) throw validationError(`Invalid ${table} list.`);
    const seen = new Set();
    for (const row of data[table] ?? []) {
      if (!isRecord(row) || typeof row.id !== 'string' || !row.id || row.workspace_id !== original.id || seen.has(row.id)) throw validationError('Invalid extended workspace record.');
      seen.add(row.id);
      if (EXTENSION_PARENTS[table]) { if (!(data[EXTENSION_PARENTS[table]] ?? []).some(parent=>parent.id === row.id)) throw validationError('Missing extended record parent.'); }
      else { if (ids.has(row.id)) throw validationError('Imported content must have unique IDs.'); ids.set(row.id,uid()); }
      if (++count > 10000) throw validationError('Import up to 10,000 records at a time.');
    }
  }
  const timestamp = new Date().toISOString(), workspaceId = ids.get(original.id);
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO workspaces (id,name,slug,description,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(workspaceId, `${original.name.slice(0, 140)} (imported)`, workspaceId, String(original.description ?? '').slice(0, 100000), timestamp, timestamp);
    const pending = [];
    for (const table of tables) for (const source of data[table] ?? []) {
      const row = normalize(table, source);
      if (table === 'teams' && source.tab_icon_color === undefined && row.color?.toLowerCase() === '#8b95a5') row.color = '';
      if (table === 'teams' && row.color === undefined) row.color = '';
      row.id = ids.get(source.id);
      if (table !== 'messages') row.workspace_id = workspaceId;
      for (const field of ['team_id', 'project_id', 'task_id', 'chat_id', 'workflow_status_id']) if (row[field]) row[field] = remap(row[field]);
      for (const field of ['assignee_agent_ids_json', 'participant_agent_ids_json']) if (row[field]) { if (!Array.isArray(row[field])) throw validationError('Invalid agent references.'); row[field] = row[field].map(remap); }
      if (row.labels_json) { if (!Array.isArray(row.labels_json)) throw validationError('Invalid labels.'); row.labels_json = row.labels_json.map(v => ids.get(v) ?? v); }
      // An imported project must not grant access to folders on this computer.
      if (table === 'projects') { row.local_path = null; row.identifier = row.id.slice(-12).toUpperCase(); }
      if (table === 'agents') row.working_directory = null;
      if (table === 'messages') {
        const metadata = row.metadata_json;
        row.metadata_json = {};
        if (metadata?.reply_to) {
          const originalReply = (data.messages ?? []).find(item => item.id === metadata.reply_to);
          if (!originalReply || originalReply.chat_id !== source.chat_id) throw validationError('An imported reply points outside its conversation.');
          row.metadata_json.reply_to = remap(metadata.reply_to);
        }
        // Keep attachment contents as ordinary imported evidence. A marker for
        // a snapshot absent from this database must not claim trusted provenance.
        if (Array.isArray(row.attachments_json)) row.attachments_json = row.attachments_json.map(file => {
          if (!isRecord(file)) throw validationError('Invalid message attachment.');
          const { rumbo_context_snapshot, ...attachment } = file;
          return attachment;
        });
      }
      validateRecord(db, table, { ...row, archived_at: row.archived_at ?? timestamp }, config[table].required, config[table].fields);
      const fields = config[table].fields.filter(f => row[f] !== undefined);
      db.prepare(`INSERT INTO ${table} (id,${fields.join(',')},created_at,updated_at) VALUES (?,${fields.map(() => '?').join(',')},?,?)`).run(row.id, ...fields.map(f => dbValue(f, row[f])), timestamp, timestamp);
      if (['projects', 'tasks'].includes(table) && source.reported_progress != null) {
        if (!Number.isInteger(source.reported_progress) || source.reported_progress < 0 || source.reported_progress > 100) throw validationError('Invalid reported progress.');
        db.prepare(`UPDATE ${table} SET reported_progress=? WHERE id=?`).run(source.reported_progress, row.id);
      }
      if (table === 'tasks' || table === 'projects') pending.push([table, row]);
    }
    for (const source of data.workspace_items ?? []) {
      const spec = RESOURCE_TYPES[source.kind];
      if (!spec || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 160 || !isRecord(source.payload)) throw validationError('Invalid workspace resource.');
      if (source.archived_at != null && (typeof source.archived_at !== 'string' || !Number.isFinite(Date.parse(source.archived_at)))) throw validationError('Invalid resource archive date.');
      if (!source.archived_at && db.prepare('SELECT 1 FROM workspace_items WHERE workspace_id=? AND kind=? AND lower(name)=lower(?) AND archived_at IS NULL').get(workspaceId, source.kind, source.name.trim())) throw validationError('Duplicate active resource names in archive.');
      const p = { ...source.payload };
      for (const [key, field] of Object.entries(spec.fields)) if (field.type === 'refs') { if (!Array.isArray(p[key])) throw validationError('Invalid resource references.'); p[key] = p[key].map(remap); }
      if (p.route_id) p.route_id = remap(p.route_id);
      payloadFor(db, source.kind, p, workspaceId, { allowArchived: true });
      db.prepare('INSERT INTO workspace_items VALUES (?,?,?,?,?,?,?,?,?,?)').run(ids.get(source.id), workspaceId, source.kind, source.name, JSON.stringify(p), Number.isFinite(source.position) ? source.position : 0, 1, source.archived_at ?? null, timestamp, timestamp);
    }
    for (const [table, row] of pending) validateCustomFields(db, table, row);
    importExtensions(db, data, ids, workspaceId, timestamp);
    db.exec('COMMIT');
    return { id: workspaceId, importedRecords: count, skipped_activity_drafts: skippedDrafts, excluded: ['connections', 'credentials', 'sessions', 'personal settings', 'folder access', 'private activity drafts, activity reactions and author privileges', 'chat bookmarks, follow-up drafts and attachment metadata'], reviewRequired: ['outputs', 'knowledge'], paused: ['work plans'] };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

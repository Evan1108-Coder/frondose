import { randomUUID } from 'node:crypto';
import { isRecord, validateAvatar, validateRecord, validationError } from './validation.mjs';
import { RESOURCE_TYPES } from '../src/lib/settings-catalog.js';
import { payloadFor } from './workspace-features.mjs';
import { EXTENSION_TABLES, EXTENSION_PARENTS, importExtensions } from './workspace-import-extensions.mjs';
import { validateAgentProfile, snapshotAgentProfile } from './agent-profiles.mjs';

// Content-only restore. Never restore credentials, run processes, permissions,
// provider state, personal preferences, or claims about public account access.
export function importWorkspace(db, archive, config, normalize, dbValue, validateCustomFields) {
  if (!['frondose.workspace', 'talvori.workspace', 'rumbo.workspace'].includes(archive.format) || archive.version !== 1 || !isRecord(archive.data)) throw validationError('Choose a version 1 Frondose archive.');
  const originalActivity = archive.data.activity_entries;
  if (originalActivity !== undefined && !Array.isArray(originalActivity)) throw validationError('Invalid activity list.');
  for (const entry of originalActivity || []) if (!isRecord(entry) || !['draft', 'published'].includes(entry.publication_state || 'published')) throw validationError('Invalid activity publication state.');
  const skippedDrafts = (originalActivity || []).filter(entry => entry.publication_state === 'draft').length;
  const data = { ...archive.data, activity_entries: (originalActivity || []).filter(entry => entry.publication_state !== 'draft') };
  if (!Array.isArray(data.workspaces) || data.workspaces.length !== 1) throw validationError('Export and import one workspace at a time.');
  const original = data.workspaces[0];
  if (!isRecord(original) || typeof original.id !== 'string' || typeof original.name !== 'string' || !original.name.trim()) throw validationError('The archive has no valid workspace.');
  validateAvatar(original.image_url ?? null);
  if (data.agent_project_links !== undefined && (!Array.isArray(data.agent_project_links) || data.agent_project_links.length > 10000)) throw validationError('Invalid project agent associations.');
  const projectLinkKeys = new Set();
  const projectLinkCounts = new Map();
  for (const link of data.agent_project_links || []) {
    if (!isRecord(link) || Object.keys(link).some(key=>!['workspace_id','project_id','agent_id'].includes(key)) || link.workspace_id !== original.id || !Array.isArray(data.projects) || !data.projects.some(row=>row?.id === link.project_id && row.workspace_id === original.id) || !Array.isArray(data.agents) || !data.agents.some(row=>row?.id === link.agent_id && (!row.workspace_id || row.workspace_id === original.id))) throw validationError('Project agent associations require local content references, never authority.');
    const key = JSON.stringify([link.project_id,link.agent_id]);
    if (projectLinkKeys.has(key)) throw validationError('Duplicate project agent association.');
    projectLinkKeys.add(key);
    const linked = (projectLinkCounts.get(link.project_id) || 0) + 1;
    if (linked > 50) throw validationError('Import up to 50 agent associations per project.');
    projectLinkCounts.set(link.project_id,linked);
  }
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
    db.prepare('INSERT INTO workspaces (id,name,slug,description,image_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(workspaceId, `${original.name.slice(0, 140)} (imported)`, workspaceId, String(original.description ?? '').slice(0, 100000), original.image_url ?? null, timestamp, timestamp);
    const pending = [], importedProfiles = [], unavailableAgents = new Map();
    const importedAgentIds = new Set((data.agents || []).map(agent => agent.id));
    const remapConversationAgent = originalAgentId => {
      if (typeof originalAgentId !== 'string' || !originalAgentId.trim() || originalAgentId.length > 240) throw validationError('Invalid conversation agent identity.');
      if (importedAgentIds.has(originalAgentId)) return remap(originalAgentId);
      if (ids.has(originalAgentId)) throw validationError('A conversation agent reference points to non-agent content.');
      // A deleted profile can remain in both historical participants and the
      // responder lock. Preserve that relationship without reviving its identity.
      if (!unavailableAgents.has(originalAgentId)) unavailableAgents.set(originalAgentId, uid());
      return unavailableAgents.get(originalAgentId);
    };
    for (const table of tables) for (const source of data[table] ?? []) {
      const row = normalize(table, source);
      if (table === 'teams' && source.tab_icon_color === undefined && row.color?.toLowerCase() === '#8b95a5') row.color = '';
      if (table === 'teams' && row.color === undefined) row.color = '';
      row.id = ids.get(source.id);
      if (table !== 'messages') row.workspace_id = workspaceId;
      for (const field of ['team_id', 'project_id', 'task_id', 'chat_id', 'workflow_status_id']) if (row[field]) row[field] = remap(row[field]);
      for (const field of ['assignee_agent_ids_json', 'participant_agent_ids_json']) if (row[field]) { if (!Array.isArray(row[field])) throw validationError('Invalid agent references.'); row[field] = row[field].map(table === 'chats' && field === 'participant_agent_ids_json' ? remapConversationAgent : remap); }
      if (table === 'chats' && row.responding_agent_id) {
        // Content identities remap; credentials and execution consent do not.
        // A deleted/missing profile stays blocked, never accidentally pointing
        // back into the workspace from which this archive was exported.
        row.responding_agent_id = remapConversationAgent(row.responding_agent_id);
      }
      if (row.labels_json) { if (!Array.isArray(row.labels_json)) throw validationError('Invalid labels.'); row.labels_json = row.labels_json.map(v => ids.get(v) ?? v); }
      // An imported project must not grant access to folders on this computer.
      if (table === 'projects') { row.local_path = null; row.identifier = row.id.slice(-12).toUpperCase(); }
      if (table === 'agents') {
        // Bindings to machine execution accounts and folders are never portable.
        row.working_directory = null;
        row.provider_connection_id = null;
        row.permission_policy = 'read-only';
        const sources = row.context_source_ids_json ?? [];
        if (!Array.isArray(sources)) throw validationError('Invalid profile context references.');
        importedProfiles.push({ row, default_area_id: remap(row.default_area_id), default_project_id: remap(row.default_project_id), context_source_ids_json: sources.map(remap) });
        // Agents precede projects and Context Packs in the restore order. Resolve
        // these references only once all their canonical parents exist.
        row.default_area_id = null; row.default_project_id = null; row.context_source_ids_json = [];
      }
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
    for (const profile of importedProfiles) {
      const record = validateAgentProfile(db, { ...profile.row, default_area_id: profile.default_area_id, default_project_id: profile.default_project_id, context_source_ids_json: profile.context_source_ids_json }, { importing: true });
      db.prepare('UPDATE agents SET default_area_id=?,default_project_id=?,context_source_ids_json=? WHERE id=?').run(record.default_area_id, record.default_project_id, JSON.stringify(record.context_source_ids_json), record.id);
      snapshotAgentProfile(db, record.id, timestamp);
    }
    importExtensions(db, data, ids, workspaceId, timestamp);
    for (const link of data.agent_project_links || []) db.prepare('INSERT INTO agent_project_links(workspace_id,project_id,agent_id,created_at) VALUES(?,?,?,?)').run(workspaceId,remap(link.project_id),remap(link.agent_id),timestamp);
    db.exec('COMMIT');
    return { id: workspaceId, importedRecords: count, skipped_activity_drafts: skippedDrafts, excluded: ['connections', 'credentials', 'sessions', 'Workflow runs, reservations and approvals', 'personal settings', 'folder access', 'private activity drafts, activity reactions and author privileges', 'chat bookmarks, follow-up drafts and attachment metadata'], reviewRequired: ['outputs', 'knowledge', 'Workflow definitions'], paused: ['work plans', 'manual Workflows'] };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

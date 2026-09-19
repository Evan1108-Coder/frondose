import { randomUUID, createHash } from 'node:crypto';
import { providerError as fail } from './connectors/adapters.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const TARGETS = { route: { table: 'tasks', title: 'title', text: 'description', permission: 'routes.edit' }, project: { table: 'projects', title: 'name', text: 'description', permission: 'projects.edit' }, document: { table: 'documents', title: 'title', text: 'content', permission: 'documents.edit' } };

export function installConnectionImports(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS platform_object_links (
    id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
    object_id TEXT NOT NULL REFERENCES platform_external_objects(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, imported_hash TEXT NOT NULL, external_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(object_id,target_type));
  CREATE TABLE IF NOT EXISTS platform_sync_conflicts (
    id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
    link_id TEXT NOT NULL REFERENCES platform_object_links(id) ON DELETE CASCADE,
    local_hash TEXT NOT NULL, external_hash TEXT NOT NULL, local_value TEXT NOT NULL, external_value TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, resolved_at TEXT);`);
}

function textContent(value, depth = 0) {
  if (depth > 15 || value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(x => textContent(x, depth + 1)).filter(Boolean).join('\n');
  if (typeof value !== 'object') return '';
  if (value.textRun?.content) return value.textRun.content;
  if (value.text && typeof value.text === 'string') return value.text;
  return ['description', 'body', 'content', 'paragraph', 'elements', 'documentTab', 'tabs', 'slides', 'pageElements', 'shape', 'text', 'textElements', 'document', 'children', 'characters', 'sheets', 'data', 'rowData', 'values', 'formattedValue'].map(key => textContent(value[key], depth + 1)).filter(Boolean).join('\n');
}

export function createConnectionImports({ db, check, audit, get }) {
  installConnectionImports(db);
  const targetValues = (row, target) => ({ title: row[target.title], text: row[target.text] });
  const checkTargetScope = (connection, row, targetType) => {
    if (connection.scope_type !== 'team') return;
    const team = row.team_id || (row.project_id ? db.prepare('SELECT * FROM projects WHERE id=?').get(row.project_id)?.team_id : null);
    if (team !== connection.scope_id || targetType === 'project' && row.team_id !== connection.scope_id) throw fail('scope_required', 'The linked Rumbo object is outside this connection’s team.', 403);
  };
  const writeValues = (target, id, values) => db.prepare(`UPDATE ${target.table} SET ${target.title}=?,${target.text}=?,updated_at=? WHERE id=?`).run(values.title, values.text, now(), id);
  const source = (connection, objectId) => {
    const object = db.prepare('SELECT * FROM platform_external_objects WHERE id=? AND connection_id=?').get(objectId, connection.id);
    if (!object || !connection.settings.selected_resources.includes(object.resource_id)) throw fail('object_missing', 'Choose a cached object from an enabled resource.', 404);
    return object;
  };
  async function importObject(connectionId, input, actor) {
    const connection = get(connectionId), target = TARGETS[input?.target_type];
    if (!target || typeof input.object_id !== 'string') throw fail('invalid_import', 'Choose an external object and a Rumbo target type.');
    await check(actor, connection, 'connections.import'); await check(actor, connection, target.permission);
    const object = source(connection, input.object_id), content = JSON.parse(object.content);
    const values = { title: object.title.slice(0, 500), text: `${textContent(content.fields || content).slice(0, 90000)}${object.url ? `\n\nSource: ${object.url}` : ''}`.trim() };
    const externalHash = digest(values), existing = db.prepare('SELECT * FROM platform_object_links WHERE object_id=? AND target_type=?').get(object.id, input.target_type);
    if (existing) {
      const row = db.prepare(`SELECT * FROM ${target.table} WHERE id=? AND workspace_id=?`).get(existing.target_id, connection.workspace_id);
      if (!row || row.archived_at) throw fail('target_unavailable', 'The linked Rumbo object is archived or unavailable.', 409);
      checkTargetScope(connection, row, input.target_type);
      const local = targetValues(row, target), localHash = digest(local);
      if (externalHash === existing.external_hash) return { status: 'unchanged', link: existing };
      if (localHash !== existing.imported_hash) {
        const prior = db.prepare("SELECT * FROM platform_sync_conflicts WHERE link_id=? AND state='open' AND local_hash=? AND external_hash=?").get(existing.id, localHash, externalHash);
        if (prior) return { status: 'conflict', conflict: { ...prior, local_value: JSON.parse(prior.local_value), external_value: JSON.parse(prior.external_value) } };
        const conflict = { id: randomUUID(), connection_id: connectionId, link_id: existing.id, local_hash: localHash, external_hash: externalHash, local_value: local, external_value: values, state: 'open', created_at: now() };
        db.prepare('INSERT INTO platform_sync_conflicts(id,connection_id,link_id,local_hash,external_hash,local_value,external_value,created_at) VALUES(?,?,?,?,?,?,?,?)').run(conflict.id, connectionId, existing.id, localHash, externalHash, JSON.stringify(local), JSON.stringify(values), conflict.created_at);
        audit(connection, actor, 'import_conflict', { object_id: object.id, target_type: input.target_type, target_id: existing.target_id }); return { status: 'conflict', conflict };
      }
      db.exec('BEGIN'); try { writeValues(target, existing.target_id, values); db.prepare('UPDATE platform_object_links SET imported_hash=?,external_hash=?,updated_at=? WHERE id=?').run(externalHash, externalHash, now(), existing.id); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
      audit(connection, actor, 'import_updated', { target_type: input.target_type, target_id: existing.target_id }); return { status: 'updated', target_type: input.target_type, target_id: existing.target_id };
    }
    if (input.project_id && !db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=?').get(input.project_id, connection.workspace_id)) throw fail('invalid_project', 'Choose a project in this workspace.');
    if (input.team_id && !db.prepare('SELECT id FROM teams WHERE id=? AND workspace_id=?').get(input.team_id, connection.workspace_id)) throw fail('invalid_team', 'Choose a team in this workspace.');
    if (input.target_type === 'document' && Boolean(input.project_id) === Boolean(input.team_id)) throw fail('document_scope', 'Select either a project or a team for the document.');
    // A team-scoped connection cannot create native content outside that team.
    if (connection.scope_type === 'team') {
      if (input.target_type === 'project') throw fail('scope_required', 'Import projects through a workspace connection; a team connection cannot choose project ownership.', 403);
      if (input.team_id && input.team_id !== connection.scope_id) throw fail('scope_required', 'Import into this connection’s team.', 403);
      if (input.project_id) { const project = db.prepare('SELECT * FROM projects WHERE id=?').get(input.project_id); if (project.team_id !== connection.scope_id) throw fail('scope_required', 'Import into a project in this connection’s team.', 403); }
      else if (input.target_type === 'route') throw fail('scope_required', 'Select a project in this connection’s team.', 403);
    }
    const id = `${input.target_type}_${randomUUID()}`, linkId = randomUUID(), date = now();
    db.exec('BEGIN'); try {
      if (input.target_type === 'project') db.prepare('INSERT INTO projects(id,workspace_id,name,identifier,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, connection.workspace_id, values.title, `EXT${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, values.text, date, date);
      if (input.target_type === 'route') { const number = db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM tasks WHERE workspace_id=?').get(connection.workspace_id).n; db.prepare('INSERT INTO tasks(id,workspace_id,project_id,number,title,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, connection.workspace_id, input.project_id || null, number, values.title, values.text, date, date); }
      if (input.target_type === 'document') db.prepare('INSERT INTO documents(id,workspace_id,team_id,project_id,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, connection.workspace_id, input.team_id || null, input.project_id || null, values.title, values.text, date, date);
      db.prepare('INSERT INTO platform_object_links VALUES(?,?,?,?,?,?,?,?,?)').run(linkId, connectionId, object.id, input.target_type, id, externalHash, externalHash, date, date);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    audit(connection, actor, 'import_created', { object_id: object.id, target_type: input.target_type, target_id: id }); return { status: 'created', target_type: input.target_type, target_id: id, link_id: linkId };
  }
  async function conflicts(id, actor) { const connection = get(id); await check(actor, connection, 'connections.read'); return db.prepare("SELECT conflicts.*,objects.resource_id FROM platform_sync_conflicts conflicts JOIN platform_object_links links ON links.id=conflicts.link_id JOIN platform_external_objects objects ON objects.id=links.object_id WHERE conflicts.connection_id=? AND conflicts.state='open' ORDER BY conflicts.created_at DESC").all(id).filter(row => connection.settings.selected_resources.includes(row.resource_id)).map(row => ({ ...row, local_value: JSON.parse(row.local_value), external_value: JSON.parse(row.external_value) })); }
  async function resolve(id, input, actor) {
    const connection = get(id); await check(actor, connection, 'connections.import');
    if (!['keep_local', 'use_external'].includes(input?.resolution)) throw fail('invalid_resolution', 'Choose which version to keep.');
    const conflict = db.prepare("SELECT * FROM platform_sync_conflicts WHERE id=? AND connection_id=? AND state='open'").get(input.conflict_id, id);
    if (!conflict || conflict.local_hash !== input.expected_local_hash) throw fail('stale_conflict', 'Reload this conflict before resolving it.', 409);
    const link = db.prepare('SELECT * FROM platform_object_links WHERE id=?').get(conflict.link_id), target = TARGETS[link.target_type]; await check(actor, connection, target.permission);
    const current = db.prepare(`SELECT * FROM ${target.table} WHERE id=? AND workspace_id=?`).get(link.target_id, connection.workspace_id);
    if (!current || current.archived_at || digest(targetValues(current, target)) !== conflict.local_hash) throw fail('stale_conflict', 'The Rumbo object changed again. Import again to review the latest conflict.', 409);
    checkTargetScope(connection, current, link.target_type);
    source(connection, link.object_id);
    db.exec('BEGIN'); try {
      if (input.resolution === 'use_external') writeValues(target, link.target_id, JSON.parse(conflict.external_value));
      db.prepare('UPDATE platform_object_links SET imported_hash=?,external_hash=?,updated_at=? WHERE id=?').run(input.resolution === 'use_external' ? conflict.external_hash : conflict.local_hash, conflict.external_hash, now(), link.id);
      db.prepare('UPDATE platform_sync_conflicts SET state=?,resolved_at=? WHERE id=?').run(input.resolution, now(), conflict.id); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    audit(connection, actor, 'conflict_resolved', { conflict_id: conflict.id, resolution: input.resolution }); return { resolved: true, target_type: link.target_type, target_id: link.target_id };
  }
  return { importObject, conflicts, resolve };
}

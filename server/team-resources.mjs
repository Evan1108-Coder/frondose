import { randomUUID } from 'node:crypto';
import { isRecord, validationError } from './validation.mjs';
import { recordChange } from './workspace-features.mjs';

export const TEAM_RESOURCE_LIMITS = Object.freeze({ fileBytes: 25 * 1024 * 1024, workspaceBytes: 250 * 1024 * 1024, resourcesPerTeam: 500 });
const FIELDS = 'id,workspace_id,team_id,kind,name,description,url,ref_id,file_name,mime_type,byte_size,version,archived_at,created_at,updated_at';
const REFERENCES = { route: 'tasks', project: 'projects', chat: 'chats', document: 'documents' };
const KINDS = new Set(['file', 'url', 'branch', ...Object.keys(REFERENCES)]);
const stamp = () => new Date().toISOString();
const invalid = (message, statusCode = 400) => Object.assign(validationError(message), { statusCode });
const clean = (value, label, maximum, optional = false) => {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (!optional && !value.trim())) throw invalid(`${label} must ${optional ? '' : 'not be empty and '}contain at most ${maximum} characters.`);
  return value.trim();
};

export function installTeamResources(db) {
  // Content is deliberately separate: bootstrap, audit logs and JSON exports
  // never accidentally include file bytes or paths to the host filesystem.
  db.exec(`CREATE TABLE IF NOT EXISTS team_resources (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    url TEXT, ref_id TEXT, file_name TEXT, mime_type TEXT, byte_size INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1, archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS team_resources_scope ON team_resources(workspace_id,team_id);
    CREATE TABLE IF NOT EXISTS team_resource_files (
      resource_id TEXT PRIMARY KEY REFERENCES team_resources(id) ON DELETE CASCADE, content BLOB NOT NULL);`);
}

function scope(db, workspaceId, teamId) {
  if (typeof workspaceId !== 'string' || typeof teamId !== 'string' ||
    !db.prepare('SELECT 1 FROM teams t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=? AND t.workspace_id=? AND t.archived_at IS NULL AND w.archived_at IS NULL').get(teamId, workspaceId)) throw invalid('Choose an active team in this workspace.', 404);
}

function safeUrl(value, kind) {
  const text = clean(value, 'URL', 2048);
  let url;
  try { url = new URL(text); } catch { throw invalid('Enter a full https:// or http:// URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw invalid('Use an http:// or https:// URL without embedded credentials.');
  if (kind === 'branch' && (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || !/^\/[^/]+\/[^/]+\/tree\/.+/.test(url.pathname))) throw invalid('Use a GitHub branch URL, such as https://github.com/owner/repository/tree/branch.');
  return url.href;
}

function detectedMedia(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.toString('ascii', 12, 16) === 'IHDR') return 'image/png';
  if (buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.length >= 13 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'image/gif';
  if (buffer.length >= 16 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 16 && buffer.toString('ascii', 4, 8) === 'ftyp' && /^(isom|iso[2-6]|mp4[12]|avc1|M4V |qt  )$/.test(buffer.toString('ascii', 8, 12))) return 'video/mp4';
  if (buffer.length >= 16 && buffer.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) && buffer.subarray(0, 4096).includes(Buffer.from('webm'))) return 'video/webm';
  if (buffer.length >= 16 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (buffer.length >= 16 && buffer.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  return 'application/octet-stream';
}

function fileFor(input) {
  if (!isRecord(input)) throw invalid('Choose a file to upload.');
  const fileName = clean(input.name, 'File name', 240).replaceAll('\\', '/').split('/').at(-1);
  if (!fileName || fileName === '.' || fileName === '..') throw invalid('Choose a file with a valid name.');
  const encoded = input.data_base64;
  if (typeof encoded !== 'string' || !encoded || encoded.length > Math.ceil(TEAM_RESOURCE_LIMITS.fileBytes / 3) * 4 || encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded)) throw invalid('Choose a non-empty file of at most 25 MB.');
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length > TEAM_RESOURCE_LIMITS.fileBytes || buffer.toString('base64') !== encoded) throw invalid('This file is too large or its upload is incomplete.');
  return { file_name: fileName, mime_type: detectedMedia(buffer), byte_size: buffer.length, buffer };
}

function fields(db, input, workspaceId, current) {
  const kind = current?.kind ?? input.kind;
  if (!KINDS.has(kind) || current && input.kind !== undefined && input.kind !== kind) throw invalid('Choose a supported resource type. Resource types cannot be changed after saving.');
  const name = clean(input.name ?? current?.name, 'Resource name', 160);
  const description = clean(input.description ?? current?.description ?? '', 'Description', 2000, true);
  let url = null, refId = null;
  if (kind === 'url' || kind === 'branch') url = safeUrl(input.url ?? current?.url, kind);
  if (REFERENCES[kind]) {
    refId = clean(input.ref_id ?? current?.ref_id, 'Reference', 100);
    if (!db.prepare(`SELECT 1 FROM ${REFERENCES[kind]} WHERE id=? AND workspace_id=? AND archived_at IS NULL`).get(refId, workspaceId)) throw invalid('Choose an active Frondose item in this workspace.');
  }
  return { kind, name, description, url, ref_id: refId };
}

function contentResponse(req, res, url, item, content) {
  const inline = url.searchParams.get('preview') === '1' && /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|audio\/(wav|mpeg))$/.test(item.mime_type);
  const fallback = item.file_name.replace(/[^\w. -]/g, '_').replaceAll('"', '_');
  const headers = {
    'Content-Type': inline ? item.mime_type : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(item.file_name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', 'Cross-Origin-Resource-Policy': 'same-origin',
  };
  let start = 0, end = content.length - 1, status = 200;
  if (req.headers?.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, content.length - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
    }
    if (!range || !(range[1] || range[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= content.length) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${content.length}`, 'Content-Length': '0' }); res.end(); return;
    }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${content.length}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  res.writeHead(status, headers); res.end(req.method === 'HEAD' ? undefined : content.subarray(start, end + 1));
}

export async function teamResourcesRoute({ db, req, res, path, url, readBody, send }) {
  const match = /^\/team-resources(?:\/([^/]+))?(?:\/(content))?$/.exec(path);
  if (!match) return false;
  const [, encodedId, content] = match;
  const isRead = req.method === 'GET' || req.method === 'HEAD';
  if (!isRead && !['POST', 'PATCH', 'DELETE'].includes(req.method) || content && !isRead) return false;
  const body = isRead ? {} : await readBody(req, Math.ceil(TEAM_RESOURCE_LIMITS.fileBytes / 3) * 4 + 20000);
  if (!isRecord(body)) throw invalid('Provide valid resource fields.');
  const workspaceId = isRead ? url.searchParams.get('workspace_id') : body.workspace_id;
  const teamId = isRead ? url.searchParams.get('team_id') : body.team_id;
  scope(db, workspaceId, teamId);
  const id = encodedId ? decodeURIComponent(encodedId) : null;
  const current = id ? db.prepare(`SELECT ${FIELDS} FROM team_resources WHERE id=? AND workspace_id=? AND team_id=?`).get(id, workspaceId, teamId) : null;
  if (id && !current) throw invalid('This resource is not available in this team.', 404);
  if (req.method === 'DELETE') {
    if (!current?.archived_at || body.confirmed !== true) throw invalid('Archive the resource and confirm permanent deletion first.');
    if (body.version !== current.version) throw invalid('This resource changed. Refresh before deleting it.', 409);
    db.exec('BEGIN IMMEDIATE');
    try {
      recordChange(db, 'team_resources', current, null, 'deleted');
      db.prepare('DELETE FROM team_resource_files WHERE resource_id=?').run(id);
      db.prepare('DELETE FROM team_resources WHERE id=?').run(id);
      db.exec('COMMIT'); send(res, 200, { result: { id, deleted: true } }); return true;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (isRead) {
    if (content) {
      if (current.archived_at || current.kind !== 'file') throw invalid('Restore the file resource before opening it.', 404);
      const file = db.prepare('SELECT content FROM team_resource_files WHERE resource_id=?').get(id);
      if (!file) throw invalid('This file is unavailable.', 404);
      contentResponse(req, res, url, current, Buffer.from(file.content)); return true;
    }
    const result = id ? current : {
      items: db.prepare(`SELECT ${FIELDS} FROM team_resources WHERE workspace_id=? AND team_id=? ORDER BY updated_at DESC,id`).all(workspaceId, teamId),
      storage_bytes: db.prepare('SELECT COALESCE(SUM(byte_size),0) bytes FROM team_resources WHERE workspace_id=?').get(workspaceId).bytes,
      limits: TEAM_RESOURCE_LIMITS,
    };
    send(res, 200, { result }); return true;
  }
  if (req.method === 'POST' && id || req.method === 'PATCH' && !id) return false;
  if (current && body.version !== current.version) throw invalid('This resource changed. Refresh before saving your changes.', 409);
  if (current && Object.hasOwn(body, 'archived_at') && ![null, true].includes(body.archived_at)) throw invalid('Choose whether to archive or restore this resource.');
  if (current?.archived_at && body.archived_at !== null) throw invalid('Restore this resource before editing it.');
  const data = current && Object.hasOwn(body, 'archived_at') ? current : fields(db, body, workspaceId, current);
  const file = !current && data.kind === 'file' ? fileFor(body.file) : null;
  if (current && body.file !== undefined) throw invalid('Add a new resource to upload another file.');
  const now = stamp();
  const resourceId = id || `resource_${randomUUID().replaceAll('-', '')}`;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!current) {
      if (db.prepare('SELECT COUNT(*) count FROM team_resources WHERE team_id=?').get(teamId).count >= TEAM_RESOURCE_LIMITS.resourcesPerTeam) throw invalid('This team has reached its 500 resource limit, including archived resources.');
      if (file && db.prepare('SELECT COALESCE(SUM(byte_size),0) bytes FROM team_resources WHERE workspace_id=?').get(workspaceId).bytes + file.byte_size > TEAM_RESOURCE_LIMITS.workspaceBytes) throw invalid('This workspace has reached its 250 MB resource storage limit, including archived files.');
      db.prepare('INSERT INTO team_resources(id,workspace_id,team_id,kind,name,description,url,ref_id,file_name,mime_type,byte_size,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(resourceId, workspaceId, teamId, data.kind, data.name, data.description, data.url, data.ref_id, file?.file_name ?? null, file?.mime_type ?? null, file?.byte_size ?? 0, now, now);
      if (file) db.prepare('INSERT INTO team_resource_files(resource_id,content) VALUES(?,?)').run(resourceId, file.buffer);
    } else {
      db.prepare('UPDATE team_resources SET name=?,description=?,url=?,ref_id=?,version=version+1,archived_at=?,updated_at=? WHERE id=?').run(data.name, data.description, data.url, data.ref_id, Object.hasOwn(body, 'archived_at') ? body.archived_at ? now : null : current.archived_at, now, resourceId);
    }
    const result = db.prepare(`SELECT ${FIELDS} FROM team_resources WHERE id=?`).get(resourceId);
    recordChange(db, 'team_resources', current, result, !current ? 'created' : body.archived_at === true ? 'archived' : current.archived_at && body.archived_at === null ? 'restored' : 'updated');
    db.exec('COMMIT'); send(res, current ? 200 : 201, { result }); return true;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

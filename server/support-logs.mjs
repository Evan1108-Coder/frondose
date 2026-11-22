import { SUPPORT_ACTIONS, SUPPORT_STATUSES, SUPPORT_LOG_RETENTION_DAYS } from '../src/lib/support-logs.js';
import { WORKSPACE_ACTIVITY_KINDS } from './workspace-activity.mjs';

const retention = SUPPORT_LOG_RETENTION_DAYS * 86_400_000;
const deviceLimit = 2000;
const exportLimit = 3000;
const owns = (map, key) => typeof key === 'string' && Object.hasOwn(map, key);

export function installSupportLogs(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS local_support_events (
    id INTEGER PRIMARY KEY,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    code INTEGER,
    recorded_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_support_events_date ON local_support_events(recorded_at DESC, id DESC);`);
  pruneExpired(db, Date.now());
}

function pruneExpired(db, now) {
  db.prepare('DELETE FROM local_support_events WHERE recorded_at < ?').run(now - retention);
}

// Fixed route classifications only. IDs, paths, queries, errors and bodies
// cannot appear in the log, even when they contain credentials or file text.
const apiActions = [
  [/^\/workspaces(?:\/[^/]+)?$/, 'workspace.change', true],
  [/^\/settings$/, 'settings.change', true],
  [/^\/import$/, 'workspace.import', true],
  [/^\/local-todos(?:\/|$)/, 'todo.change'],
  [/^\/projects(?:\/[^/]+)?$/, 'project.change'],
  [/^\/(?:tasks|routes)(?:\/[^/]+)?$/, 'route.change'],
  [/^\/teams(?:\/[^/]+)?$/, 'area.change'],
  [/^\/documents(?:\/[^/]+)?$/, 'document.change'],
  [/^\/team-resources(?:\/|$)/, 'resource.change'],
  [/^\/workspace-items(?:\/|$)/, 'workspace-item.change'],
  [/^\/directory-workspace(?:\/|$)/, 'directory.change'],
  [/^\/local-git(?:\/|$)/, 'git.change'],
  [/^\/(?:workbench|local-terminal|workspace-terminals)(?:\/|$)/, 'terminal.change'],
  [/^\/(?:workspace-agent-chat|chats)(?:\/|$)/, 'chat.change'],
  [/^\/local-automations(?:\/|$)/, 'automation.change', true],
  [/^\/(?:connections|ai-connections)(?:\/|$)/, 'integration.change', true],
];
const writes = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export function classifySupportRequest(method, path) {
  if (!writes.has(method) || typeof path !== 'string') return null;
  const match = apiActions.find(([pattern]) => pattern.test(path));
  if (!match) return null;
  return { action: match[1], includeAccepted: match[2] === true };
}

export function supportRequestOutcome(request, code) {
  if (!request || !Number.isInteger(code)) return null;
  if (code >= 200 && code < 300 && request.includeAccepted) return { action: request.action, status: 'accepted', code };
  if (code >= 400 && code < 600) return { action: request.action, status: code >= 500 ? 'failed' : [409, 423, 429].includes(code) ? 'blocked' : 'rejected', code };
  return null;
}

export function recordSupportEvent(db, event, now = Date.now()) {
  const { action, status, code } = event ?? {};
  if (!owns(SUPPORT_ACTIONS, action) || !owns(SUPPORT_STATUSES, status)) return false;
  const safeCode = Number.isInteger(code) && code >= 200 && code <= 599 ? code : null;
  pruneExpired(db, now);
  db.prepare('INSERT INTO local_support_events (action, status, code, recorded_at) VALUES (?, ?, ?, ?)').run(action, status, safeCode, now);
  db.prepare(`DELETE FROM local_support_events WHERE id IN (
    SELECT id FROM local_support_events ORDER BY recorded_at DESC, id DESC LIMIT -1 OFFSET ?)`).run(deviceLimit);
  return true;
}

const activityStatus = {
  'terminal.started': 'started', 'terminal.stopped': 'ended',
  'chat.started': 'started', 'chat.finished': 'ended',
  'automation.started': 'dispatched', 'automation.finished': 'completed',
};

export function readSupportLogs(db, now = Date.now()) {
  pruneExpired(db, now);
  const raw = db.prepare(`SELECT kind AS action, NULL AS status, NULL AS code, id, recorded_at AS stamp, 0 AS device
    FROM local_workspace_activity WHERE recorded_at >= ? AND recorded_at <= ?
    UNION ALL
    SELECT action, status, code, id, recorded_at AS stamp, 1 AS device
    FROM local_support_events WHERE recorded_at >= ? AND recorded_at <= ?
    ORDER BY stamp DESC, device DESC, id DESC LIMIT ?`)
    .all(now - retention, now, now - retention, now, exportLimit + 1);
  const rows = raw.slice(0, exportLimit).flatMap(({ action, status, code, stamp, device }) => {
    const catalog = device ? SUPPORT_ACTIONS : WORKSPACE_ACTIVITY_KINDS;
    if (!owns(catalog, action) || (device && !owns(SUPPORT_STATUSES, status))) return [];
    return [{
      label: catalog[action],
      status: device ? status : activityStatus[action] ?? 'recorded',
      recordedAt: new Date(stamp).toISOString(),
      ...(device && Number.isInteger(code) && code >= 200 && code <= 599 ? { code } : {}),
    }];
  });
  return { rows, truncated: raw.length > exportLimit };
}

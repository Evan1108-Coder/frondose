import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { RUNNER_PROVIDER_CATALOG, getRunnerProvider } from '../src/lib/runner-provider-catalog.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const fail = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });
const parse = value => { try { return JSON.parse(value); } catch { return []; } };
const safeEqual = (left, right) => typeof left === 'string' && typeof right === 'string' && left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const text = (value, max, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw fail('validation_error', `Choose a valid ${name}.`, 400);
  return value.trim();
};

export function installRunnerConnections(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS personal_runners (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), owner_actor_id TEXT NOT NULL,
    name TEXT NOT NULL, platform TEXT NOT NULL, architecture TEXT NOT NULL,
    credential_hash TEXT NOT NULL, runtimes_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL, last_seen_at TEXT, revoked_at TEXT, version INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS personal_runners_owner ON personal_runners(workspace_id,owner_actor_id);
  CREATE TABLE IF NOT EXISTS runner_pairing_requests (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), owner_actor_id TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    runner_id TEXT, confirmed_at TEXT, consumed_at TEXT
  );`);
}

// Pairing is deliberately two-phase: the browser approves an individual claim.
// A code alone never makes a newly connected computer an execution authority.
export function createRunnerConnectionsService({ db, authorize, now = () => Date.now() }) {
  if (typeof authorize !== 'function') throw new TypeError('Computer connections require an authorization boundary.');
  const stamp = () => new Date(now()).toISOString();
  const check = (workspaceId, actor, permission = 'connections.view') => {
    if (!actor?.id || typeof workspaceId !== 'string' || !workspaceId) throw fail('sign_in_required', 'Sign in and choose a workspace.', 401);
    const decision = authorize(workspaceId, actor, permission);
    if (decision !== true && decision?.allowed !== true) throw fail('access_denied', 'This workspace connection is unavailable.', 403);
  };
  function owned(runnerId, workspaceId, actor, permission = 'connections.view') {
    check(workspaceId, actor, permission);
    const row = db.prepare('SELECT * FROM personal_runners WHERE id=? AND workspace_id=? AND owner_actor_id=?').get(runnerId, workspaceId, actor.id);
    if (!row || row.revoked_at) throw fail('runner_unavailable', 'This computer connection is unavailable.', 404);
    return row;
  }
  function present(row) {
    const pairing = db.prepare('SELECT confirmed_at FROM runner_pairing_requests WHERE runner_id=? AND consumed_at IS NOT NULL').get(row.id);
    return { id: row.id, workspace_id: row.workspace_id, owner_actor_id: row.owner_actor_id, name: row.name,
      platform: row.platform, architecture: row.architecture, version: row.version,
      created_at: row.created_at, last_seen_at: row.last_seen_at, revoked_at: row.revoked_at,
      state: row.revoked_at ? 'revoked' : !pairing?.confirmed_at ? 'approval_required' : row.last_seen_at && now() - Date.parse(row.last_seen_at) < 90_000 ? 'online' : 'offline',
      runtimes: parse(row.runtimes_json), execution_available: false };
  }
  function pairing(workspaceId, actor, name) {
    check(workspaceId, actor, 'connections.use');
    const active = db.prepare('SELECT count(*) AS n FROM runner_pairing_requests WHERE owner_actor_id=? AND expires_at>? AND consumed_at IS NULL').get(actor.id, stamp()).n;
    if (active >= 5) throw fail('pairing_limit', 'Finish or wait for your previous pairing requests to expire.');
    const reserved = db.prepare('SELECT count(*) AS n FROM runner_pairing_requests WHERE workspace_id=? AND owner_actor_id=? AND expires_at>? AND consumed_at IS NULL').get(workspaceId, actor.id, stamp()).n;
    if (reserved + db.prepare('SELECT count(*) AS n FROM personal_runners WHERE workspace_id=? AND owner_actor_id=? AND revoked_at IS NULL').get(workspaceId, actor.id).n >= 10) throw fail('runner_limit', 'Disconnect an unused computer before pairing another.');
    const code = secret(), id = `pair_${secret().slice(0, 20)}`, expires = new Date(now() + 10 * 60_000).toISOString();
    db.prepare('INSERT INTO runner_pairing_requests(id,workspace_id,owner_actor_id,code_hash,name,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(id, workspaceId, actor.id, digest(code), text(name, 100, 'computer name'), stamp(), expires);
    return { id, code, expires_at: expires, requires_browser_confirmation: true };
  }
  function claim({ code, platform, architecture }) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw fail('invalid_pairing', 'Pairing code is invalid or expired.', 403);
    if (!['darwin', 'win32', 'linux'].includes(platform) || !['x64', 'arm64', 'ia32', 'arm', 'riscv64', 'ppc64', 's390x'].includes(architecture)) throw fail('unsupported_platform', 'This helper supports macOS, Windows and Linux; this platform or architecture is not supported.', 400);
    const row = db.prepare('SELECT * FROM runner_pairing_requests WHERE code_hash=? AND expires_at>? AND consumed_at IS NULL').get(digest(code), stamp());
    if (!row) throw fail('invalid_pairing', 'Pairing code is invalid, already used, or expired.', 403);
    check(row.workspace_id, { id: row.owner_actor_id }, 'connections.use');
    const token = secret(), id = `runner_${secret().slice(0, 20)}`;
    db.exec('BEGIN IMMEDIATE');
    try {
      const changed = db.prepare('UPDATE runner_pairing_requests SET runner_id=?,consumed_at=? WHERE id=? AND consumed_at IS NULL').run(id, stamp(), row.id);
      if (changed.changes !== 1) throw fail('invalid_pairing', 'Pairing code has already been used.', 403);
      db.prepare('INSERT INTO personal_runners(id,workspace_id,owner_actor_id,name,platform,architecture,credential_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, row.workspace_id, row.owner_actor_id, row.name, platform, architecture, digest(token), stamp());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { runner_id: id, credential: token, state: 'approval_required' };
  }
  function confirm(workspaceId, actor, runnerId) {
    owned(runnerId, workspaceId, actor, 'connections.use');
    const row = db.prepare('SELECT * FROM runner_pairing_requests WHERE runner_id=? AND expires_at>?').get(runnerId, stamp());
    if (!row) throw fail('pairing_expired', 'Pairing expired. Disconnect this claim and pair again.');
    db.prepare('UPDATE runner_pairing_requests SET confirmed_at=? WHERE id=?').run(stamp(), row.id);
    return present(owned(runnerId, workspaceId, actor));
  }
  function authenticate(runnerId, token) {
    if (typeof runnerId !== 'string' || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw fail('runner_unauthorized', 'Computer authentication failed.', 401);
    const row = db.prepare('SELECT * FROM personal_runners WHERE id=? AND revoked_at IS NULL').get(runnerId);
    if (!row || !safeEqual(row.credential_hash, digest(token))) throw fail('runner_unauthorized', 'Computer authentication failed.', 401);
    check(row.workspace_id, { id: row.owner_actor_id }, 'connections.use');
    const approved = db.prepare('SELECT confirmed_at FROM runner_pairing_requests WHERE runner_id=?').get(row.id)?.confirmed_at;
    if (!approved) return { ...row, approved: false };
    return { ...row, approved: true };
  }
  function heartbeat(runnerId, token, runtimes = []) {
    const row = authenticate(runnerId, token);
    if (!row.approved) return { state: 'approval_required', execution_available: false };
    if (!Array.isArray(runtimes) || runtimes.length > RUNNER_PROVIDER_CATALOG.length) throw fail('invalid_inventory', 'Invalid runtime inventory.', 400);
    const seen = new Set();
    const clean = runtimes.map(item => {
      if (!item || !getRunnerProvider(item.id) || seen.has(item.id) || !['installed', 'not_found', 'launcher_only', 'unsupported', 'error'].includes(item.state)) throw fail('invalid_inventory', 'Invalid runtime inventory entry.', 400);
      seen.add(item.id);
      return { id: item.id, state: item.state, authenticated: 'unknown', inference_verified: false };
    });
    db.prepare('UPDATE personal_runners SET last_seen_at=?,runtimes_json=? WHERE id=?').run(stamp(), JSON.stringify(clean), row.id);
    return { state: 'connected', execution_available: false, next_heartbeat_ms: 30_000 };
  }
  return {
    createPairing: ({ workspaceId, actor, name }) => pairing(workspaceId, actor, name), claim,
    confirm: ({ workspaceId, actor, runnerId }) => confirm(workspaceId, actor, runnerId),
    heartbeat, authenticate,
    list: ({ workspaceId, actor }) => { check(workspaceId, actor); return db.prepare('SELECT * FROM personal_runners WHERE workspace_id=? AND owner_actor_id=? AND revoked_at IS NULL ORDER BY created_at').all(workspaceId, actor.id).map(present); },
    checkBinding({ workspaceId, actor, runnerId, runtimeId, operation }) {
      const row = owned(runnerId, workspaceId, actor, operation === 'use' ? 'connections.use' : 'connections.view');
      if (!getRunnerProvider(runtimeId)) throw fail('invalid_provider', 'Choose a supported runtime.', 400);
      if (present(row).state === 'approval_required') throw fail('runner_approval_required', 'Confirm this computer connection first.');
      if (operation === 'use') throw fail('runner_execution_not_released', 'Computer discovery is connected. Remote AI execution is not released yet.');
      return true;
    },
    revoke: ({ workspaceId, actor, runnerId, version }) => {
      const row = owned(runnerId, workspaceId, actor, 'connections.use');
      if (version !== row.version) throw fail('stale_runner', 'This computer connection changed. Refresh before disconnecting.');
      db.prepare('UPDATE personal_runners SET credential_hash=?,revoked_at=?,version=version+1,runtimes_json=? WHERE id=?').run(digest(secret()), stamp(), '[]', row.id);
      return { id: row.id, state: 'revoked' };
    },
  };
}

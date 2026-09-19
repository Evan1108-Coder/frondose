import { randomBytes, createHash, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createGovernanceService, GOVERNANCE_RANKS } from './governance-service.mjs';

const scrypt = promisify(derive);
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, code: 'identity_error' });
const publicUser = row => row ? { id: row.id, name: row.name, email: row.email } : null;
const emailOf = value => {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw error('Enter a valid email address.');
  return email;
};
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw error('Use a password between 12 and 256 characters.');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
async function passwordMatches(password, stored) {
  const [salt, expected] = stored.split(':');
  if (typeof password !== 'string' || password.length > 256) return false;
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export function createIdentityService({ db, now = () => Date.now() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS identity_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS identity_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS identity_invites (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL, created_by TEXT NOT NULL, workspace_id TEXT NOT NULL, expires_at INTEGER NOT NULL, accepted_at INTEGER);
    CREATE TABLE IF NOT EXISTS identity_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);`);
  const configured = () => Boolean(db.prepare("SELECT 1 FROM identity_users WHERE id='local-owner'").get());
  function resolve(req) {
    const raw = /(?:^|;\s*)rumbo_session=([^;]+)/.exec(req.headers?.cookie || '')?.[1];
    if (raw) {
      const session = db.prepare('SELECT * FROM identity_sessions WHERE token_hash=? AND expires_at>?').get(digest(raw), now());
      if (session) {
        db.prepare('UPDATE identity_sessions SET last_seen_at=? WHERE token_hash=?').run(now(), session.token_hash);
        return { ...publicUser(db.prepare('SELECT * FROM identity_users WHERE id=?').get(session.user_id)), session_id: session.token_hash, mode: 'account' };
      }
    }
    return configured() ? null : { id: 'local-owner', name: 'You', mode: 'local' };
  }
  function createSession(userId) {
    const raw = token();
    db.prepare('DELETE FROM identity_sessions WHERE expires_at<=?').run(now());
    db.prepare('INSERT INTO identity_sessions VALUES (?,?,?,?,?)').run(digest(raw), userId, now(), now() + 7 * 86400000, now());
    return { token: raw, user: publicUser(db.prepare('SELECT * FROM identity_users WHERE id=?').get(userId)) };
  }
  function cookie(value, secure = false) { return `rumbo_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? 604800 : 0}${secure ? '; Secure' : ''}`; }
  function throttle(key) {
    const existing = db.prepare('SELECT * FROM identity_attempts WHERE key=?').get(key);
    if (existing?.expires_at > now() && existing.attempts >= 8) throw error('Too many attempts. Try again in 15 minutes.', 429);
    db.prepare('INSERT OR REPLACE INTO identity_attempts VALUES (?,?,?)').run(key, existing?.expires_at > now() ? existing.attempts + 1 : 1, existing?.expires_at > now() ? existing.expires_at : now() + 900000);
  }
  async function setup(input, actor) {
    if (configured() || actor?.id !== 'local-owner') throw error('Account setup is already complete.', 409);
    const email = emailOf(input.email), name = String(input.name || 'You').trim().slice(0, 160);
    const hash = await passwordHash(input.password);
    if (configured()) throw error('Account setup is already complete.', 409);
    db.prepare('INSERT INTO identity_users VALUES (?,?,?,?,?)').run('local-owner', name, email, hash, now());
    return createSession('local-owner');
  }
  async function login(input) {
    const email = emailOf(input.email);
    throttle(`login:${email}`);
    const user = db.prepare('SELECT * FROM identity_users WHERE email=?').get(email);
    // Equal-cost work for unknown addresses avoids a cheap account enumeration path.
    const valid = await passwordMatches(input.password, user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!user || !valid) throw error('Email or password is incorrect.', 401);
    db.prepare('DELETE FROM identity_attempts WHERE key=?').run(`login:${email}`);
    return createSession(user.id);
  }
  function invite(input, actor) {
    if (!configured()) throw error('Set up your account before inviting members.', 409);
    const raw = token(), email = emailOf(input.email);
    validateInvitationAuthority({ workspace_id: input.workspace_id, user_id: input.user_id, email, created_by: actor.id });
    if (db.prepare('SELECT 1 FROM identity_users WHERE email=?').get(email)) throw error('This email already has an account. Add that account to the workspace instead.', 409);
    // Issuing a new link retires all prior links for that member.
    db.prepare('UPDATE identity_invites SET expires_at=? WHERE user_id=? AND workspace_id=? AND accepted_at IS NULL').run(now(), input.user_id, input.workspace_id);
    db.prepare('INSERT INTO identity_invites VALUES (?,?,?,?,?,?,?,NULL)').run(digest(raw), input.user_id, email, String(input.name || email).slice(0, 160), actor.id, input.workspace_id, now() + 2 * 86400000);
    return { invitation_token: raw, expires_at: new Date(now() + 2 * 86400000).toISOString(), delivery: 'copy_link' };
  }
  function validateInvitationAuthority(invitation) {
    const target = db.prepare("SELECT * FROM governance_members WHERE workspace_id=? AND id=? AND status='active'").get(invitation.workspace_id, invitation.user_id);
    const issuer = db.prepare("SELECT * FROM governance_members WHERE workspace_id=? AND id=? AND status='active'").get(invitation.workspace_id, invitation.created_by);
    if (!target || !issuer || GOVERNANCE_RANKS[issuer.rank] <= GOVERNANCE_RANKS[target.rank] || target.email.toLowerCase() !== invitation.email) throw error('This invitation no longer matches an active membership.', 410);
    const governance = createGovernanceService({ db });
    if (!governance.explain(invitation.workspace_id, issuer.id, 'members.manage').allowed) throw error('The inviter no longer has authority to invite this member.', 410);
  }
  async function accept(input) {
    if (typeof input.token !== 'string' || input.token.length > 256) throw error('Invitation is invalid or expired.', 410);
    throttle(`invite:${digest(input.token)}`);
    const invitation = db.prepare('SELECT * FROM identity_invites WHERE token_hash=? AND accepted_at IS NULL AND expires_at>?').get(digest(input.token), now());
    if (!invitation) throw error('Invitation is invalid or expired.', 410);
    const hash = await passwordHash(input.password);
    db.exec('BEGIN IMMEDIATE');
    try {
      validateInvitationAuthority(invitation);
      const claimed = db.prepare('UPDATE identity_invites SET accepted_at=? WHERE token_hash=? AND accepted_at IS NULL AND expires_at>?').run(now(), invitation.token_hash, now());
      if (!claimed.changes) throw error('Invitation is invalid or expired.', 410);
      db.prepare('INSERT INTO identity_users VALUES (?,?,?,?,?)').run(invitation.user_id, invitation.name, invitation.email, hash, now());
      db.exec('COMMIT');
    } catch (failure) { db.exec('ROLLBACK'); throw failure; }
    return createSession(invitation.user_id);
  }
  function sessions(actor) { return db.prepare('SELECT token_hash AS id,created_at,expires_at,last_seen_at FROM identity_sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC').all(actor.id, now()).map(item => ({ ...item, current: item.id === actor.session_id })); }
  function revoke(actor, id) { db.prepare('DELETE FROM identity_sessions WHERE user_id=? AND token_hash=?').run(actor.id, id); }
  return { configured, resolve, setup, login, invite, accept, sessions, revoke, cookie };
}

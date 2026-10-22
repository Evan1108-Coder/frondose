import { validateAvatar, validationError } from './validation.mjs';

export function installPersonalProfiles(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS personal_profiles (
    user_id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL, self_display_name TEXT NOT NULL DEFAULT '',
    contact_email TEXT, avatar_url TEXT, updated_at TEXT NOT NULL
  )`);
}

// This projection is self-only. Never use it for authors, directories or AI input.
export function selfProfile(db, actor) {
  const saved = db.prepare('SELECT * FROM personal_profiles WHERE user_id=?').get(actor.id);
  const legacy = actor.id === 'local-owner' ? db.prepare("SELECT * FROM local_profile WHERE id='local'").get() : null;
  return {
    id: actor.mode === 'account' ? actor.id : 'local',
    name: saved?.display_name ?? (actor.mode === 'account' ? actor.name : legacy?.name) ?? 'You',
    username: saved?.username ?? '',
    self_display_name: saved?.self_display_name ?? '',
    email: saved ? saved.contact_email : actor.email ?? legacy?.email ?? null,
    avatar_url: saved?.avatar_url ?? legacy?.avatar_url ?? null,
    updated_at: saved?.updated_at ?? legacy?.updated_at ?? null,
  };
}

export function updateSelfProfile(db, actor, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw validationError('Supply a profile object.');
  const keys = ['name', 'username', 'self_display_name', 'email', 'avatar_url'];
  if (!keys.some(key => Object.hasOwn(input, key))) throw validationError('No supported profile fields were supplied.');
  const previous = selfProfile(db, actor);
  const next = { ...previous, ...Object.fromEntries(keys.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]])) };
  if (typeof next.name !== 'string' || !next.name.trim() || next.name.length > 100 || /[\u0000-\u001f]/.test(next.name)) throw validationError('Display name must contain 1–100 characters.');
  if (typeof next.self_display_name !== 'string' || next.self_display_name.length > 100 || /[\u0000-\u001f]/.test(next.self_display_name)) throw validationError('Display name (You) must be at most 100 characters.');
  if (typeof next.username !== 'string') throw validationError('Enter a valid username.');
  next.username = next.username.trim().toLowerCase();
  if (next.username && !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(next.username)) throw validationError('Username must be 3–32 characters: letters, numbers, dots, underscores or hyphens, starting with a letter or number.');
  if (next.email !== null && (typeof next.email !== 'string' || next.email.length > 254 || next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email))) throw validationError('Enter a valid contact email.');
  validateAvatar(next.avatar_url);
  next.name = next.name.trim(); next.self_display_name = next.self_display_name.trim();
  if (next.username && db.prepare('SELECT user_id FROM personal_profiles WHERE username=? AND user_id<>?').get(next.username, actor.id)) throw validationError('That username is already in use. Choose another.');
  const stamp = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO personal_profiles VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
      username=excluded.username,display_name=excluded.display_name,self_display_name=excluded.self_display_name,
      contact_email=excluded.contact_email,avatar_url=excluded.avatar_url,updated_at=excluded.updated_at`)
      .run(actor.id, next.username || null, next.name, next.self_display_name, next.email, next.avatar_url, stamp);
    if (actor.mode === 'account') db.prepare('UPDATE identity_users SET name=? WHERE id=?').run(next.name, actor.id);
    if (actor.id === 'local-owner') db.prepare("UPDATE local_profile SET name=?,email=?,avatar_url=?,updated_at=? WHERE id='local'").run(next.name, next.email, next.avatar_url, stamp);
    db.prepare('UPDATE governance_members SET name=? WHERE id=?').run(next.name, actor.id);
    db.exec('COMMIT');
  } catch (cause) { db.exec('ROLLBACK'); throw cause; }
  return selfProfile(db, { ...actor, name: next.name });
}

export function sharedProfile(db, userId) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='personal_profiles'").get()) return {};
  const saved = db.prepare('SELECT username,display_name,avatar_url FROM personal_profiles WHERE user_id=?').get(userId);
  return saved ? { username: saved.username || '', name: saved.display_name, avatar_url: saved.avatar_url } : {};
}

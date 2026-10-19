import { talvoriEnvironment } from './brand-config.mjs';
import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { CONNECTOR_CATALOG, OAUTH_PROVIDERS } from './connectors/catalog.mjs';
import { createProviderAdapter, providerError as fail } from './connectors/adapters.mjs';
import { createConnectionImports } from './connection-platform-imports.mjs';
import { createConnectionJobs } from './connection-platform-jobs.mjs';
import { connectionReadOptions, effectiveReadOptions } from './connectors/read-options.mjs';
import { readProviderIdentity } from './connectors/identity.mjs';

const now = () => new Date().toISOString();
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const parse = value => JSON.parse(value || '{}');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const safe = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\x00-\x1f]/.test(value);
const API_HOSTS = new Set(['api.github.com', 'www.googleapis.com', 'docs.googleapis.com', 'sheets.googleapis.com', 'slides.googleapis.com', 'api.linear.app', 'api.atlassian.com', 'slack.com', 'api.figma.com']);

export function installConnectionPlatform(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS platform_connections (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT,
    state TEXT NOT NULL DEFAULT 'not_connected', settings TEXT NOT NULL, account_label TEXT,
    last_sync_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS platform_connections_workspace ON platform_connections(workspace_id);
  CREATE TABLE IF NOT EXISTS platform_connection_secrets (connection_id TEXT PRIMARY KEY REFERENCES platform_connections(id) ON DELETE CASCADE, ciphertext TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS platform_external_objects (
    id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL, kind TEXT NOT NULL, external_id TEXT NOT NULL, title TEXT NOT NULL,
    url TEXT, content TEXT NOT NULL, content_hash TEXT NOT NULL, provider_updated_at TEXT, synced_at TEXT NOT NULL,
    UNIQUE(connection_id,resource_id,kind,external_id));
  CREATE TABLE IF NOT EXISTS platform_connection_events (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE, actor_id TEXT, type TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS platform_connection_actions (connection_id TEXT NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE, idempotency_key TEXT NOT NULL, input_hash TEXT NOT NULL, state TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, PRIMARY KEY(connection_id,idempotency_key));`);
  if (!db.prepare('PRAGMA table_info(platform_connections)').all().some(column => column.name === 'verification')) db.exec("ALTER TABLE platform_connections ADD COLUMN verification TEXT NOT NULL DEFAULT '{}'");
}

export function createConnectionPlatform({ db, dataDir, env = process.env, fetchImpl = fetch, authorize, requireApproval, workerIntervalMs = 5000, paused = false } = {}) {
  env = talvoriEnvironment(env);
  if (!db || !dataDir || typeof authorize !== 'function') throw new Error('Connection platform requires a database, private data directory and authorization callback.');
  installConnectionPlatform(db);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  let key;
  if (env.TALVORI_CONNECTION_ENCRYPTION_KEY) key = Buffer.from(env.TALVORI_CONNECTION_ENCRYPTION_KEY, 'base64');
  else {
    const keyPath = join(dataDir, 'connections.key');
    try { key = readFileSync(keyPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; key = randomBytes(32); writeFileSync(keyPath, key, { flag: 'wx', mode: 0o600 }); }
    chmodSync(keyPath, 0o600);
  }
  if (key.length !== 32) throw new Error('TALVORI_CONNECTION_ENCRYPTION_KEY must encode exactly 32 bytes.');
  const pending = new Map(), refreshes = new Map(), authGenerations = new Map(), figmaLifecycles = new Map();
  const actorId = actor => actor?.id || actor?.user_id || actor?.principal_id || null;
  const audit = (connection, actor, type, detail = {}) => db.prepare('INSERT INTO platform_connection_events VALUES(?,?,?,?,?,?)').run(randomUUID(), connection.id, actorId(actor), type, JSON.stringify(detail), now());
  const decode = row => row ? { ...row, settings: parse(row.settings), verification: parse(row.verification) } : null;
  const get = id => { const row = decode(db.prepare('SELECT * FROM platform_connections WHERE id=?').get(id)); if (!row) throw fail('connection_missing', 'Connection not found.', 404); return row; };
  const check = async (actor, connection, permission, scopeOverride) => {
    const decision = await authorize({ actor, workspace_id: connection.workspace_id, scope_type: scopeOverride?.scope_type || connection.scope_type, scope_id: scopeOverride?.scope_id || connection.scope_id, connection_id: connection.id, permission });
    if (decision === false || decision?.allowed === false) throw fail('permission_denied', 'You do not have access to this connection action.', 403);
  };
  const update = (id, fields) => { const allowed = ['settings', 'verification', 'state', 'account_label', 'last_sync_at', 'last_error']; const entries = Object.entries(fields).filter(([name]) => allowed.includes(name)); db.prepare(`UPDATE platform_connections SET ${entries.map(([name]) => `${name}=?`).join(',')},updated_at=? WHERE id=?`).run(...entries.map(([name, value]) => ['settings', 'verification'].includes(name) ? JSON.stringify(value) : value), now(), id); return get(id); };
  function storeToken(id, token) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(token)), cipher.final()]);
    db.prepare('INSERT INTO platform_connection_secrets VALUES(?,?) ON CONFLICT(connection_id) DO UPDATE SET ciphertext=excluded.ciphertext').run(id, [iv, cipher.getAuthTag(), encrypted].map(x => x.toString('base64')).join('.'));
  }
  function readToken(id) {
    const row = db.prepare('SELECT ciphertext FROM platform_connection_secrets WHERE connection_id=?').get(id);
    if (!row) throw fail('not_connected', 'Connect this account first.', 409);
    try { const [iv, tag, encrypted] = row.ciphertext.split('.').map(x => Buffer.from(x, 'base64')); const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(tag); return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()])); }
    catch { throw fail('credentials_unreadable', 'Connection credentials could not be decrypted. Reconnect this account.', 409); }
  }
  const config = provider => {
    const family = CONNECTOR_CATALOG[provider]?.auth_family;
    if (!family) throw fail('unknown_provider', 'Choose a supported connection.');
    const prefix = `TALVORI_${family.toUpperCase()}`;
    const callback = env[`${prefix}_CALLBACK_URL`] || env.TALVORI_CONNECTION_CALLBACK_URL || 'http://127.0.0.1:4174/api/connection-platform/oauth/callback';
    let callback_error;
    try {
      const url = new URL(callback);
      if (url.username || url.password || url.hash || url.search || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) callback_error = 'OAuth callback must use HTTPS or loopback HTTP, without credentials, query, or fragment.';
      if (family === 'slack' && url.protocol !== 'https:') callback_error = 'Slack requires an HTTPS callback. Configure TALVORI_SLACK_CALLBACK_URL with an operator-controlled HTTPS callback before connecting.';
    } catch { callback_error = 'Configure a valid OAuth callback URL.'; }
    const writeScopes = { 'google-docs': 'https://www.googleapis.com/auth/documents', 'google-sheets': 'https://www.googleapis.com/auth/spreadsheets', 'google-slides': 'https://www.googleapis.com/auth/presentations' };
    return { ...OAUTH_PROVIDERS[family], ...(writeScopes[provider] ? { scopes: `${OAUTH_PROVIDERS[family].scopes} ${writeScopes[provider]}` } : {}), family, client_id: env[`${prefix}_CLIENT_ID`], client_secret: env[`${prefix}_CLIENT_SECRET`], redirect_uri: callback, callback_error, prefix };
  };
  async function jsonFetch(url, options = {}) {
    let response;
    try { response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
    catch { throw fail('provider_unreachable', 'The provider could not be reached. Try again later.', 502); }
    if (!response.ok) {
      const code = response.status === 429 ? 'rate_limited' : response.status === 401 ? 'reconnect_required' : response.status === 403 ? 'provider_permission' : 'provider_error';
      const error = fail(code, response.status === 429 ? 'The provider rate limit was reached. Retry later.' : response.status === 401 ? 'Authorization expired. Reconnect this account.' : response.status === 403 ? 'The provider denied access. Review granted permissions.' : `The provider returned status ${response.status}.`, response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 409 : 502);
      error.definitelyRejected = [400, 401, 403, 404, 422, 429].includes(response.status);
      const retrySeconds = Number(response.headers?.get('retry-after'));
      if (response.status === 429 && Number.isFinite(retrySeconds) && retrySeconds > 0) error.retryAfterMs = Math.min(86400000, retrySeconds * 1000);
      throw error;
    }
    if (response.status === 204) return { completed: true };
    if (Number(response.headers?.get('content-length')) > 8_000_000) { await response.body?.cancel(); throw fail('response_too_large', 'The provider response exceeds the safe cache size. Select a smaller resource.', 413); }
    let raw;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), parts = []; let length = 0;
      try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > 8_000_000) { await reader.cancel(); throw fail('response_too_large', 'The provider response exceeds the safe cache size. Select a smaller resource.', 413); } parts.push(Buffer.from(value)); } raw = Buffer.concat(parts).toString('utf8'); }
      finally { reader.releaseLock(); }
    } else raw = await response.text();
    if (!raw) return { completed: true };
    if (raw.length > 8_000_000) throw fail('response_too_large', 'The provider response exceeds the safe cache size. Select a smaller resource.', 413);
    try { return JSON.parse(raw); } catch { throw fail('provider_response', 'The provider returned an unexpected response.', 502); }
  }
  async function exchange(cfg, fields) {
    const payload = { client_id: cfg.client_id, client_secret: cfg.client_secret, ...fields };
    let body, headers = { Accept: 'application/json' };
    if (cfg.family === 'jira') { body = JSON.stringify(payload); headers['Content-Type'] = 'application/json'; }
    else { body = new URLSearchParams(payload).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (cfg.family === 'figma') { headers.Authorization = `Basic ${Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64')}`; const form = new URLSearchParams(fields); body = form.toString(); }
    const tokenUrl = cfg.family === 'figma' && fields.grant_type === 'refresh_token' ? 'https://api.figma.com/v1/oauth/refresh' : cfg.token;
    let token;
    try { token = await jsonFetch(tokenUrl, { method: 'POST', headers, body }); }
    catch (error) { if (error.code === 'reconnect_required' || error.code === 'provider_error' && error.definitelyRejected) throw fail('oauth_rejected', 'Authorization was rejected. Reconnect this account.', 409); throw error; }
    if (token.error || token.ok === false || !token.access_token) throw fail('oauth_rejected', 'Authorization could not be completed. Start a new connection attempt.', 409);
    return { ...token, expires_at: token.expires_in ? Date.now() + Number(token.expires_in) * 1000 : null };
  }
  // Figma has one active access token per app/user. Keep exchanges and API requests
  // ordered, including a new consent flow whose user is unknown until exchange.
  function figmaLifecycle(cfg, run) {
    if (cfg.family !== 'figma') return run();
    const previous = figmaLifecycles.get(cfg.client_id) || Promise.resolve();
    const result = previous.catch(() => {}).then(run);
    figmaLifecycles.set(cfg.client_id, result);
    return result.finally(() => { if (figmaLifecycles.get(cfg.client_id) === result) figmaLifecycles.delete(cfg.client_id); });
  }
  const scopeKey = scopes => String(scopes || '').split(/[ ,]+/).filter(Boolean).sort().join(' ');
  const figmaBinding = (cfg, token) => typeof token.user_id_string === 'string' && safe(token.user_id_string) ? { app: cfg.client_id, account: token.user_id_string, scopes: scopeKey(token.scope || cfg.scopes) } : null;
  function figmaPeers() {
    return db.prepare("SELECT id FROM platform_connections WHERE provider IN ('figma','figjam') AND state='connected'").all().flatMap(({ id }) => {
      try { const token = readToken(id); return token.rumbo_oauth_binding ? [{ id, token }] : []; } catch { return []; }
    });
  }
  function shareFigmaToken(binding, next, peers) {
    if (!binding) return;
    for (const peer of peers) {
      if (get(peer.id).state !== 'connected') continue;
      const current = readToken(peer.id), prior = current.rumbo_oauth_binding;
      if (prior?.app !== binding.app || prior?.account !== binding.account || prior?.scopes !== binding.scopes || current.refresh_token !== peer.token.refresh_token) continue;
      // Maintain each existing grant's refresh token and all Talvori resource/actor
      // permissions. Starting (but not completing) consent does not revoke that
      // existing grant; disconnect does. Never populate an unapproved record.
      storeToken(peer.id, { ...current, access_token: next.access_token, expires_at: next.expires_at, expires_in: next.expires_in });
    }
  }
  async function accessToken(connection) {
    if (get(connection.id).state !== 'connected') throw fail('not_connected', 'Connect this account first.', 409);
    let token = readToken(connection.id);
    const cfg = config(connection.provider);
    if (token.rumbo_oauth_binding && token.rumbo_oauth_binding.app !== cfg.client_id) throw fail('reconnect_required', 'The provider application changed. Reconnect this account.', 409);
    if (token.expires_at && token.expires_at < Date.now() + 60000) {
      if (!token.refresh_token) { update(connection.id, { state: 'reconnect_required' }); throw fail('reconnect_required', 'Reconnect this account to renew access.', 409); }
      if (!refreshes.has(connection.id)) refreshes.set(connection.id, (async () => {
        try {
          const generation = authGenerations.get(connection.id) || 0, peers = cfg.family === 'figma' ? figmaPeers() : [];
          const next = await exchange(cfg, { grant_type: 'refresh_token', refresh_token: token.refresh_token });
          if (cfg.family === 'figma') shareFigmaToken(token.rumbo_oauth_binding, next, peers);
          if ((authGenerations.get(connection.id) || 0) !== generation || get(connection.id).state !== 'connected') throw fail('not_connected', 'Connection changed while renewing access. Try again.', 409);
          const merged = { ...token, ...next }; storeToken(connection.id, merged); return merged;
        } finally { refreshes.delete(connection.id); }
      })());
      token = await refreshes.get(connection.id);
    }
    return token.access_token;
  }
  const providerRequest = (connection, attempt) => async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !API_HOSTS.has(parsed.hostname) || parsed.port || parsed.username || parsed.password) throw fail('invalid_provider_url', 'Provider request was rejected.');
    const generation = authGenerations.get(connection.id) || 0;
    return figmaLifecycle(config(connection.provider), async () => { try {
      if ((authGenerations.get(connection.id) || 0) !== generation) throw fail('connection_changed', 'Connection authorization changed. Try again.', 409);
      const token = await accessToken(connection), writes = !['GET', 'HEAD'].includes(options.method || 'GET');
      if (attempt && writes) attempt.dispatched = true;
      const result = await jsonFetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
      if (attempt && writes) attempt.responseReceived = true;
      if ((authGenerations.get(connection.id) || 0) !== generation || get(connection.id).state !== 'connected') throw fail('connection_changed', 'Connection changed during this request. Check its status.', 409);
      return result;
    }
    catch (error) { if ((authGenerations.get(connection.id) || 0) === generation && get(connection.id).state === 'connected') update(connection.id, { last_error: error.message, ...(['reconnect_required', 'oauth_rejected'].includes(error.code) ? { state: 'reconnect_required' } : {}) }); throw error; } });
  };
  const adapter = (connection, attempt) => createProviderAdapter(connection.provider, providerRequest(connection, attempt));
  const requireSelected = (connection, id) => { if (!connection.settings.selected_resources.includes(id)) throw fail('resource_not_selected', 'Select this resource in connection settings first.', 403); };

  async function catalog(workspaceId, actor) {
    await check(actor, { workspace_id: workspaceId, scope_type: 'workspace' }, 'connections.view');
    const runners = [['codex', 'Codex'], ['claude', 'Claude Code']].map(([id, name]) => ({ id, name, category: 'AI agents', auth_family: 'runner', execution: 'existing_runner', configured: true, setup_required: [], features: [], actions: [], sync_kinds: [], resource_hint: 'Manage the existing provider account and agent execution settings.' }));
    const registration = { github: 'https://github.com/settings/developers', google: 'https://console.cloud.google.com/apis/credentials', linear: 'https://linear.app/settings/api', jira: 'https://developer.atlassian.com/console/myapps/', slack: 'https://api.slack.com/apps', figma: 'https://www.figma.com/developers/apps' };
    return [...runners, ...Object.values(CONNECTOR_CATALOG).map(item => { const cfg = config(item.id), missing = []; if (!cfg.client_id) missing.push(`The Talvori operator must configure ${cfg.prefix}_CLIENT_ID.`); if (!cfg.client_secret) missing.push(`The Talvori operator must configure ${cfg.prefix}_CLIENT_SECRET.`); if (cfg.callback_error) missing.push(cfg.callback_error); return { ...item, availability: paused ? 'coming_soon' : 'available', configured: !paused && !missing.length, setup_required: paused ? ['External service connections are paused while Talvori focuses on AI agents.'] : missing, callback_url: paused || cfg.callback_error ? null : cfg.redirect_uri, scopes: cfg.scopes, registration_url: paused ? null : registration[cfg.family] }; })];
  }
  async function list(workspaceId, actor) {
    await check(actor, { workspace_id: workspaceId, scope_type: 'workspace' }, 'connections.view');
    const result = []; for (const row of db.prepare('SELECT * FROM platform_connections WHERE workspace_id=? ORDER BY created_at').all(workspaceId)) { const connection = decode(row); try { await check(actor, connection, 'connections.view'); result.push(connection); } catch (error) { if (error.statusCode !== 403) throw error; } } return result;
  }
  async function create(input, actor) {
    if (!record(input) || !CONNECTOR_CATALOG[input.provider] || !safe(input.workspace_id)) throw fail('invalid_connection', 'Choose a workspace and supported provider.');
    if (!db.prepare('SELECT id FROM workspaces WHERE id=?').get(input.workspace_id)) throw fail('workspace_missing', 'Workspace not found.', 404);
    const scope_type = input.scope_type || 'workspace', scope_id = scope_type === 'workspace' ? input.workspace_id : input.scope_id;
    if (!['workspace', 'team'].includes(scope_type) || !safe(scope_id)) throw fail('invalid_scope', 'Choose workspace or team scope.');
    if (scope_type === 'team' && !db.prepare('SELECT id FROM teams WHERE id=? AND workspace_id=?').get(scope_id, input.workspace_id)) throw fail('invalid_scope', 'Choose a team in this workspace.');
    const connection = { id: `conn_${randomUUID()}`, workspace_id: input.workspace_id, scope_type, scope_id };
    await check(actor, connection, 'connections.manage');
    db.prepare('INSERT INTO platform_connections(id,workspace_id,provider,scope_type,scope_id,settings,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(connection.id, input.workspace_id, input.provider, scope_type, scope_id, JSON.stringify({ enabled_features: ['read'], selected_resources: [], sync_mode: 'cache', agent_access: false, allowed_agent_ids: [] }), now(), now());
    audit(connection, actor, 'created', { provider: input.provider }); return get(connection.id);
  }
  async function beginAuthorization(id, actor) {
    const connection = get(id); await check(actor, connection, 'connections.manage');
    const cfg = config(connection.provider);
    if (cfg.callback_error) throw fail('invalid_callback', cfg.callback_error, 409);
    if (!cfg.client_id || !cfg.client_secret) throw fail('operator_setup_required', 'The Talvori operator must configure this provider OAuth application first.', 409);
    for (const [state, entry] of pending) if (entry.expires < Date.now() || entry.id === id) pending.delete(state);
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    const generation = (authGenerations.get(id) || 0) + 1; authGenerations.set(id, generation);
    pending.set(state, { id, actor, verifier, generation, cfg, expires: Date.now() + 10 * 60_000 });
    const url = new URL(cfg.authorize); Object.entries({ client_id: cfg.client_id, redirect_uri: cfg.redirect_uri, response_type: 'code', scope: cfg.scopes, state }).forEach(([name, value]) => url.searchParams.set(name, value));
    if (cfg.pkce) { url.searchParams.set('code_challenge_method', 'S256'); url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url')); }
    if (cfg.family === 'google') { url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent'); }
    if (cfg.family === 'jira') { url.searchParams.set('audience', 'api.atlassian.com'); url.searchParams.set('prompt', 'consent'); }
    audit(connection, actor, 'authorization_started');
    return { authorization_url: url.href, expires_at: new Date(Date.now() + 600000).toISOString() };
  }
  async function completeAuthorization(query, actor) {
    const entry = pending.get(query.state); pending.delete(query.state);
    if (entry && actor && actorId(actor) !== actorId(entry.actor)) throw fail('oauth_actor_mismatch', 'Complete authorization from the same Talvori account.', 403);
    if (entry && query.error && entry.expires >= Date.now()) { audit(get(entry.id), entry.actor, 'authorization_denied'); throw fail('authorization_denied', 'Authorization was declined. No new credentials were saved. You can connect again.', 409); }
    if (!entry || entry.expires < Date.now() || typeof query.code !== 'string' || !query.code || query.code.length > 4096 || /[\x00-\x1f]/.test(query.code)) throw fail('invalid_oauth_state', 'This authorization attempt expired or was already used. Connect again.', 409);
    if (actor && actorId(actor) !== actorId(entry.actor)) throw fail('oauth_actor_mismatch', 'Complete authorization from the same Talvori account.', 403);
    const connection = get(entry.id); await check(entry.actor, connection, 'connections.manage');
    const cfg = entry.cfg;
    return figmaLifecycle(cfg, async () => {
    if (authGenerations.get(connection.id) !== entry.generation) throw fail('authorization_cancelled', 'This authorization attempt was cancelled. Connect again.', 409);
    await check(entry.actor, get(connection.id), 'connections.manage');
    if (authGenerations.get(connection.id) !== entry.generation) throw fail('authorization_cancelled', 'This authorization attempt was cancelled. Connect again.', 409);
    const peers = cfg.family === 'figma' ? figmaPeers() : [];
    const token = await exchange(cfg, { grant_type: 'authorization_code', code: query.code, redirect_uri: cfg.redirect_uri, ...(cfg.pkce ? { code_verifier: entry.verifier } : {}) });
    if (cfg.family === 'figma') { const binding = figmaBinding(cfg, token); if (binding) { token.rumbo_oauth_binding = binding; shareFigmaToken(binding, token, peers); } }
    if (authGenerations.get(connection.id) !== entry.generation) throw fail('authorization_cancelled', 'This authorization attempt was cancelled. Connect again.', 409);
    await check(entry.actor, get(connection.id), 'connections.manage');
    if (authGenerations.get(connection.id) !== entry.generation) throw fail('authorization_cancelled', 'This authorization attempt was cancelled. Connect again.', 409);
    storeToken(connection.id, token);
    const label = token.team?.name || token.authed_user?.id || token.user_id_string || null;
    update(connection.id, { state: 'connected', account_label: label, last_error: null, verification: { authorized_at: now() } }); audit(connection, entry.actor, 'connected'); return get(connection.id);
    });
  }
  async function verify(id, actor) {
    const connection = get(id); await check(actor, connection, 'connections.read');
    const generation = authGenerations.get(id) || 0;
    try {
      const identity = await readProviderIdentity(CONNECTOR_CATALOG[connection.provider].auth_family, providerRequest(connection));
      const current = get(id); await check(actor, current, 'connections.read');
      if ((authGenerations.get(id) || 0) !== generation || current.state !== 'connected') throw fail('connection_changed', 'This connection changed during verification. Check again.', 409);
      audit(current, actor, 'identity_verified');
      return update(id, { account_label: identity.label, last_error: null, verification: { ...current.verification, identity_checked_at: now() } });
    } catch (error) { if ((authGenerations.get(id) || 0) === generation) update(id, { verification: { ...get(id).verification, identity_checked_at: null }, last_error: error.message }); throw error; }
  }
  async function settings(id, input, actor) {
    const connection = get(id); await check(actor, connection, 'connections.manage');
    if (!record(input) || Object.keys(input).some(key => !['enabled_features', 'selected_resources', 'sync_mode', 'agent_access', 'allowed_agent_ids', 'read_options'].includes(key))) throw fail('invalid_settings', 'Unsupported connection settings.');
    const next = { agent_access: false, allowed_agent_ids: [], ...connection.settings, ...input }, known = CONNECTOR_CATALOG[connection.provider].features.map(x => x.id);
    if (!Array.isArray(next.enabled_features) || next.enabled_features.some(x => !known.includes(x)) || !Array.isArray(next.selected_resources) || next.selected_resources.length > 1000 || next.selected_resources.some(x => !safe(x)) || !['link', 'cache'].includes(next.sync_mode)) throw fail('invalid_settings', 'Choose supported features, resources, and sync mode.');
    next.enabled_features = [...new Set(next.enabled_features)]; next.selected_resources = [...new Set(next.selected_resources)];
    if (typeof next.agent_access !== 'boolean' || !Array.isArray(next.allowed_agent_ids) || next.allowed_agent_ids.length > 100 || next.allowed_agent_ids.some(id => !safe(id))) throw fail('invalid_agents', 'Choose specific agents allowed to use this connection.');
    for (const id of next.allowed_agent_ids) { const agent = db.prepare('SELECT * FROM agents WHERE id=?').get(id); if (!agent || agent.archived_at || agent.workspace_id && agent.workspace_id !== connection.workspace_id) throw fail('invalid_agents', 'Choose available agents in this workspace.'); }
    next.allowed_agent_ids = [...new Set(next.allowed_agent_ids)];
    next.read_options = connectionReadOptions(connection.provider, next.read_options || {});
    audit(connection, actor, 'settings_updated', { before: connection.settings, after: next }); return update(id, { settings: next });
  }
  async function resources(id, query, actor) { const connection = get(id); await check(actor, connection, 'connections.read'); return adapter(connection).resources(query); }
  async function code(id, query, actor) { const connection = get(id); await check(actor, connection, 'connections.read'); requireSelected(connection, query.resource_id); if (!connection.settings.enabled_features.includes('read')) throw fail('feature_disabled', 'Enable reading in connection settings.', 409); return adapter(connection).readCode(query); }
  async function sync(id, input, actor) {
    const connection = get(id); await check(actor, connection, 'connections.sync');
    const generation = authGenerations.get(id) || 0;
    if (!record(input)) throw fail('invalid_sync', 'Select a resource to sync.'); requireSelected(connection, input.resource_id);
    if (!connection.settings.enabled_features.includes('read')) throw fail('feature_disabled', 'Enable reading in connection settings.', 409);
    const kind = input.kind || CONNECTOR_CATALOG[connection.provider].sync_kinds[0]; if (!CONNECTOR_CATALOG[connection.provider].sync_kinds.includes(kind)) throw fail('invalid_kind', 'Choose a supported content type.');
    const options = effectiveReadOptions(connection.provider, connection.settings.read_options, input, kind);
    const result = await adapter(connection).sync({ ...input, ...options, kind });
    const current = get(id); await check(actor, current, 'connections.sync'); requireSelected(current, input.resource_id);
    if ((authGenerations.get(id) || 0) !== generation || current.state !== 'connected' || !current.settings.enabled_features.includes('read')) throw fail('connection_changed', 'Connection access changed during synchronization. No results were saved.', 409);
    const stmt = db.prepare(`INSERT INTO platform_external_objects VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,resource_id,kind,external_id) DO UPDATE SET title=excluded.title,url=excluded.url,content=excluded.content,content_hash=excluded.content_hash,provider_updated_at=excluded.provider_updated_at,synced_at=excluded.synced_at`);
    db.exec('BEGIN'); try { for (const item of result.items) { const content = current.settings.sync_mode === 'cache' ? JSON.stringify(item.content) : '{}'; stmt.run(randomUUID(), id, input.resource_id, item.kind, item.external_id, item.title, item.url, content, hash(content), item.provider_updated_at, now()); } db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
    update(id, { last_sync_at: now(), last_error: null, verification: { ...get(id).verification, resource_checked_at: now(), resource_id: input.resource_id, kind } }); audit(connection, actor, 'synced', { resource_id: input.resource_id, kind, count: result.items.length }); return { count: result.items.length, cursor: result.cursor || null };
  }
  async function objects(id, actor) { const connection = get(id); await check(actor, connection, 'connections.read'); return db.prepare('SELECT * FROM platform_external_objects WHERE connection_id=? ORDER BY synced_at DESC LIMIT 1000').all(id).filter(row => connection.settings.selected_resources.includes(row.resource_id)).map(row => ({ ...row, content: parse(row.content), provider: connection.provider, workspace_id: connection.workspace_id, provenance: { connection_id: id, resource_id: row.resource_id, external_id: row.external_id, url: row.url, synced_at: row.synced_at } })); }
  async function execute(id, body, actor) {
    const connection = get(id), definition = CONNECTOR_CATALOG[connection.provider].actions.find(x => x.id === body?.action);
    if (!definition || !record(body.input) || !safe(body.idempotency_key)) throw fail('invalid_action', 'Choose an action, its fields, and a unique request key.');
    await check(actor, connection, `connections.${connection.provider}.${definition.id}`);
    if (!connection.settings.enabled_features.includes(definition.id)) throw fail('feature_disabled', 'Enable this action in connection settings first.', 409);
    const input = {};
    for (const field of definition.fields) { const value = body.input[field.name]; if (field.required && (value === undefined || value === '')) throw fail('required_field', `${field.label} is required.`); if (value !== undefined) { if (field.type !== 'json' && (typeof value !== 'string' || value.length > 100000)) throw fail('invalid_field', `${field.label} must be text.`); input[field.name] = value; } }
    if (input.resource_id) requireSelected(connection, input.resource_id);
    const fingerprint = hash({ action: definition.id, input, actor: actorId(actor), agent_id: actor?.delegated_agent_id || null });
    const prior = db.prepare('SELECT * FROM platform_connection_actions WHERE connection_id=? AND idempotency_key=?').get(id, body.idempotency_key);
    if (prior) { if (prior.input_hash !== fingerprint) throw fail('idempotency_conflict', 'This request key belongs to another action.', 409); if (prior.state === 'completed') return parse(prior.result); if (prior.state === 'rejected') throw fail('action_rejected', 'This request was not executed. Create a corrected new draft.', 409); throw fail('action_uncertain', 'This action was already attempted. Verify the provider before trying a new request.', 409); }
    if (['destructive', 'consequential', 'communication'].includes(definition.risk)) {
      if (!requireApproval) throw fail('approval_required', 'This external action requires approval.', 409);
      const approved = await requireApproval({ actor, connection, action: definition.id, input, risk: definition.risk, idempotency_key: body.idempotency_key });
      if (approved !== true && approved?.approved !== true) return { approval_required: true, approval: approved || null };
      const fresh = get(id); await check(actor, fresh, `connections.${connection.provider}.${definition.id}`);
      if (!fresh.settings.enabled_features.includes(definition.id)) throw fail('feature_disabled', 'This action was disabled while awaiting approval.', 409);
      if (input.resource_id) requireSelected(fresh, input.resource_id);
    }
    db.prepare('INSERT INTO platform_connection_actions VALUES(?,?,?,?,?,?)').run(id, body.idempotency_key, fingerprint, 'started', null, now());
    audit(connection, actor, 'action_started', { action: definition.id, resource_id: input.resource_id || null, idempotency_key: body.idempotency_key, agent_id: actor?.delegated_agent_id || null });
    const attempt = { dispatched: false };
    try { const result = await adapter(connection, attempt).execute(definition.id, input); db.prepare("UPDATE platform_connection_actions SET state='completed',result=? WHERE connection_id=? AND idempotency_key=?").run(JSON.stringify(result), id, body.idempotency_key); audit(connection, actor, 'action_completed', { action: definition.id, idempotency_key: body.idempotency_key }); return result; }
    catch (error) {
      const rejected = !attempt.dispatched || (!attempt.responseReceived && error.definitelyRejected);
      db.prepare('UPDATE platform_connection_actions SET state=? WHERE connection_id=? AND idempotency_key=?').run(rejected ? 'rejected' : 'uncertain', id, body.idempotency_key);
      audit(connection, actor, 'action_failed', { action: definition.id, code: error.code || 'invalid_action', execution: rejected ? 'rejected' : 'uncertain' });
      throw fail(rejected ? (attempt.dispatched ? 'action_rejected' : 'action_not_sent') : 'action_uncertain', rejected ? `${error.message} This request was not executed; you can create a corrected new draft.` : 'The result of this action is uncertain. Check the provider before creating another request.', error.statusCode || 409);
    }
  }
  async function disconnect(id, input, actor) {
    const connection = get(id); await check(actor, connection, 'connections.manage');
    let purgeFingerprint;
    if (input?.delete_cache) {
      await check(actor, connection, 'connections.delete_cache');
      if (!safe(input.idempotency_key)) throw fail('idempotency_required', 'Supply a request key before clearing cached data.');
      purgeFingerprint = hash({ action: 'purge_cache', actor: actorId(actor), connection_id: id });
      const previous = db.prepare('SELECT * FROM platform_connection_actions WHERE connection_id=? AND idempotency_key=?').get(id, input.idempotency_key);
      if (previous) {
        if (previous.input_hash !== purgeFingerprint) throw fail('idempotency_conflict', 'This request key belongs to a different operation.', 409);
        if (previous.state === 'completed') return get(id);
        throw fail('action_uncertain', 'This purge is already being handled.', 409);
      }
      if (!requireApproval) throw fail('approval_required', 'Clearing cached connection data requires approval.', 409);
      const approved = await requireApproval({ actor, connection, action: 'purge_cache', input: { delete_cache: true, connection_revision: connection.updated_at }, risk: 'destructive', idempotency_key: input.idempotency_key });
      if (approved !== true && approved?.approved !== true) return { approval_required: true, approval: approved || null };
      const fresh = get(id);
      if (fresh.updated_at !== connection.updated_at) throw fail('stale_connection', 'The connection changed while approving the purge. Start a new request.', 409);
      await check(actor, fresh, 'connections.manage'); await check(actor, fresh, 'connections.delete_cache');
    }
    authGenerations.set(id, (authGenerations.get(id) || 0) + 1);
    db.exec('BEGIN');
    try {
      if (input?.delete_cache) db.prepare('INSERT INTO platform_connection_actions VALUES(?,?,?,?,?,?)').run(id, input.idempotency_key, purgeFingerprint, 'started', null, now());
      db.prepare('DELETE FROM platform_connection_secrets WHERE connection_id=?').run(id);
      if (input?.delete_cache) db.prepare('DELETE FROM platform_external_objects WHERE connection_id=?').run(id);
      audit(connection, actor, 'disconnected', { cache_deleted: Boolean(input?.delete_cache), provider_revocation: 'Revoke the Talvori app in provider settings to invalidate its grant.' });
      update(id, { state: 'not_connected', account_label: null, last_error: null, verification: {} });
      if (input?.delete_cache) db.prepare("UPDATE platform_connection_actions SET state='completed',result=? WHERE connection_id=? AND idempotency_key=?").run(JSON.stringify({ disconnected: true, cache_deleted: true }), id, input.idempotency_key);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    for (const [state, entry] of pending) if (entry.id === id) pending.delete(state);
    return get(id);
  }
  async function activity(id, actor) { const connection = get(id); await check(actor, connection, 'connections.view'); return db.prepare('SELECT * FROM platform_connection_events WHERE connection_id=? ORDER BY created_at DESC LIMIT 200').all(id).map(row => ({ ...row, detail: parse(row.detail) })); }
  function agentAllowed(connection, agentId) {
    const agent = db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
    return Boolean(agent && !agent.archived_at && agent.status !== 'paused' && (!agent.workspace_id || agent.workspace_id === connection.workspace_id) && connection.state === 'connected' && connection.settings.agent_access === true && connection.settings.allowed_agent_ids?.includes(agentId));
  }
  async function agentContext(workspaceId, agentId, sponsor) {
    if (paused) return [];
    const result = [];
    for (const connection of await list(workspaceId, sponsor)) {
      if (!agentAllowed(connection, agentId)) continue;
      try {
        await check(sponsor, connection, 'connections.read');
        const catalog = CONNECTOR_CATALOG[connection.provider], actions = [];
        for (const action of catalog.actions.filter(x => connection.settings.enabled_features.includes(x.id))) {
          try { await check(sponsor, connection, `connections.${connection.provider}.${action.id}`); actions.push(action); } catch (error) { if (error.statusCode !== 403) throw error; }
        }
        const snippets = connection.settings.enabled_features.includes('read') ? (await objects(connection.id, sponsor)).slice(0, 20).map(item => ({ id: item.id, title: item.title, kind: item.kind, provenance: item.provenance, content_excerpt: JSON.stringify(item.content).slice(0, 2000) })) : [];
        result.push({ id: connection.id, provider: connection.provider, name: catalog.name, state: connection.state, selected_resources: connection.settings.selected_resources, actions, last_sync_at: connection.last_sync_at, last_error: connection.last_error, cached_objects: snippets });
      } catch (error) { if (error.statusCode !== 403) throw error; }
    }
    return result;
  }
  async function executeForAgent(id, body, { agent_id, sponsor } = {}) {
    if (paused) throw fail('coming_soon', 'External service connections are coming soon. No provider action was sent.', 409);
    const connection = get(id);
    if (!agentAllowed(connection, agent_id) || !actorId(sponsor)) throw fail('agent_access_denied', 'This agent is not authorized to use this connection.', 403);
    return execute(id, body, { ...sponsor, delegated_agent_id: agent_id });
  }
  const imports = createConnectionImports({ db, check, audit, get });
  const jobs = createConnectionJobs({ db, env, check, get, sync, imports, audit, intervalMs: paused ? 0 : workerIntervalMs, paused });
  async function handle({ method, path, query = {}, body = {}, actor, rawBody, headers }) {
    path = path.replace(/^\/api/, ''); if (!path.startsWith('/connection-platform/')) return null;
    const suffix = path.slice('/connection-platform'.length), respond = (result, statusCode = 200) => ({ statusCode, body: { result } });
    if (method === 'GET' && suffix === '/catalog') return respond(await catalog(query.workspace_id, actor));
    if (method === 'GET' && suffix === '/connections') return respond(await list(query.workspace_id, actor));
    if (paused) {
      const archived = suffix.match(/^\/connections\/([^/]+)(?:\/(activity))?$/);
      if (archived && method === 'GET') {
        if (archived[2]) return respond(await activity(archived[1], actor));
        const connection = get(archived[1]); await check(actor, connection, 'connections.view'); return respond(connection);
      }
      const disconnectMatch = suffix.match(/^\/connections\/([^/]+)\/disconnect$/);
      if (disconnectMatch && method === 'POST') return respond(await disconnect(disconnectMatch[1], body, actor));
      throw fail('coming_soon', 'External service connections are coming soon. Existing records are preserved, but authorization, sync, and actions are paused.', 409);
    }
    if (method === 'POST' && suffix === '/connections') return respond(await create(body, actor), 201);
    if (method === 'GET' && suffix === '/oauth/callback') return respond(await completeAuthorization(query, actor));
    const webhook = suffix.match(/^\/webhooks\/([^/]+)$/);
    if (method === 'POST' && webhook) { const result = await jobs.ingest(webhook[1], rawBody, headers); return { statusCode: 200, body: result }; }
    const match = suffix.match(/^\/connections\/([^/]+)(?:\/(authorize|check|resources|settings|sync|objects|actions|disconnect|activity|code|import|conflicts|resolve-conflict|sync-policy|jobs|retry-job))?$/);
    if (!match) throw fail('not_found', 'Connection endpoint not found.', 404);
    const [, id, operation] = match;
    if (!operation && method === 'GET') { const connection = get(id); await check(actor, connection, 'connections.view'); return respond(connection); }
    if (method === 'POST' && operation === 'authorize') return respond(await beginAuthorization(id, actor));
    if (method === 'POST' && operation === 'check') return respond(await verify(id, actor));
    if (method === 'GET' && operation === 'resources') return respond(await resources(id, query, actor));
    if (method === 'GET' && operation === 'code') return respond(await code(id, query, actor));
    if (method === 'PATCH' && operation === 'settings') return respond(await settings(id, body, actor));
    if (method === 'POST' && operation === 'sync') return respond(await sync(id, body, actor));
    if (method === 'GET' && operation === 'objects') return respond(await objects(id, actor));
    if (method === 'POST' && operation === 'actions') return respond(await execute(id, body, actor));
    if (method === 'POST' && operation === 'disconnect') return respond(await disconnect(id, body, actor));
    if (method === 'GET' && operation === 'activity') return respond(await activity(id, actor));
    if (method === 'POST' && operation === 'import') return respond(await imports.importObject(id, body, actor));
    if (method === 'GET' && operation === 'conflicts') return respond(await imports.conflicts(id, actor));
    if (method === 'POST' && operation === 'resolve-conflict') return respond(await imports.resolve(id, body, actor));
    if (method === 'GET' && operation === 'sync-policy') return respond(await jobs.policy(id, actor));
    if (method === 'PATCH' && operation === 'sync-policy') return respond(await jobs.policy(id, actor, body));
    if (method === 'GET' && operation === 'jobs') return respond(await jobs.jobs(id, actor));
    if (method === 'POST' && operation === 'jobs') return respond(await jobs.enqueue(id, body, actor), 202);
    if (method === 'POST' && operation === 'retry-job') return respond(await jobs.retry(id, body.job_id, actor));
    throw fail('method_not_allowed', 'This operation does not support that method.', 405);
  }
  return { catalog, list, create, beginAuthorization, completeAuthorization, verify, settings, resources, code, sync, objects, execute, executeForAgent, agentContext, disconnect, activity, ...imports, jobs, handle, close: () => { pending.clear(); jobs.close(); } };
}

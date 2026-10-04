import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const now = () => new Date().toISOString();
const digest = value => createHash('sha256').update(value).digest('base64url');
const failure = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const BASE = 'https://openrouter.ai';
const CALLBACK = '/api/ai-connections/openrouter/callback/';
const HF_BASE = 'https://huggingface.co';
const HF_ROUTER = 'https://router.huggingface.co';
const HF_CALLBACK = '/api/ai-connections/huggingface/callback';
const MAX_RESPONSE_BYTES = 8_000_000;

export function installAiConnections(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_account_connections (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL, provider TEXT NOT NULL, state TEXT NOT NULL,
    encrypted_credential TEXT NOT NULL, account_label TEXT, checked_at TEXT,
    model_tested_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(workspace_id, actor_id, provider));
  CREATE TABLE IF NOT EXISTS ai_authorization_attempts (
    state_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL, provider TEXT NOT NULL, encrypted_verifier TEXT NOT NULL,
    callback_origin TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS ai_authorization_attempts_expiry ON ai_authorization_attempts(expires_at);`);
}

export function createAiConnectionsService({ db, dataDir, fetchImpl = fetch, env = process.env, authorize }) {
  installAiConnections(db);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  let key;
  if (env.RUMBO_CONNECTION_ENCRYPTION_KEY) key = Buffer.from(env.RUMBO_CONNECTION_ENCRYPTION_KEY, 'base64');
  else {
    const path = join(dataDir, 'connections.key');
    try { key = readFileSync(path); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      key = randomBytes(32);
      try { writeFileSync(path, key, { flag: 'wx', mode: 0o600 }); }
      catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; key = readFileSync(path); }
    }
    chmodSync(path, 0o600);
  }
  if (key.length !== 32) throw new Error('RUMBO_CONNECTION_ENCRYPTION_KEY must encode exactly 32 bytes.');

  const seal = (id, value) => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.');
  };
  const unseal = (id, value) => {
    try {
      const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64'));
      const cipher = createDecipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
    } catch { throw failure('credential_unreadable', 'The saved authorization cannot be decrypted. Reconnect this account.', 409); }
  };
  const requireActor = actor => { if (!actor?.id) throw failure('sign_in_required', 'Sign in to connect an AI account.', 401); return actor.id; };
  const requireWorkspace = async (workspaceId, actor) => {
    requireActor(actor);
    if (typeof workspaceId !== 'string' || !db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspaceId)) throw failure('workspace_missing', 'Workspace unavailable.', 404);
    await authorize(workspaceId, actor);
  };
  const read = (workspaceId, actorId, provider = 'openrouter') => db.prepare('SELECT * FROM ai_account_connections WHERE workspace_id=? AND actor_id=? AND provider=?').get(workspaceId, actorId, provider);
  const publicRow = row => row ? { provider: row.provider, state: row.state, account_label: row.account_label, checked_at: row.checked_at, model_tested_at: row.model_tested_at } : null;
  const callbackOrigin = host => {
    const configured = env.RUMBO_PUBLIC_BASE_URL;
    let url;
    try { url = new URL(configured || `http://${host}`); }
    catch { throw failure('callback_setup', 'Configure a valid RUMBO_PUBLIC_BASE_URL.', 409); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw failure('callback_setup', 'RUMBO_PUBLIC_BASE_URL must be an HTTPS origin, or a local loopback HTTP origin.', 409);
    return url.origin;
  };
  async function requestJson(url, options = {}) {
    let response;
    const provider = new URL(url).hostname === 'openrouter.ai' ? 'OpenRouter' : 'Hugging Face';
    try { response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
    catch { throw failure('provider_unreachable', `${provider} could not be reached. Try again later.`, 502); }
    if (!response.ok) throw failure(response.status === 401 ? 'reconnect_required' : response.status === 429 ? 'rate_limited' : 'provider_error', response.status === 401 ? `${provider} rejected this authorization. Reconnect.` : response.status === 429 ? `${provider} rate limit reached. Try later.` : `${provider} returned HTTP ${response.status}.`, response.status === 401 ? 409 : response.status === 429 ? 429 : 502);
    if (Number(response.headers?.get('content-length')) > MAX_RESPONSE_BYTES) throw failure('provider_response_too_large', `${provider} response was too large.`, 502);
    let content;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw failure('provider_response_too_large', `${provider} response was too large.`, 502); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      content = Buffer.concat(chunks).toString('utf8');
    } else {
      content = await response.text();
      if (content.length > MAX_RESPONSE_BYTES) throw failure('provider_response_too_large', `${provider} response was too large.`, 502);
    }
    try { return JSON.parse(content); } catch { throw failure('provider_response', `${provider} returned an unreadable response.`, 502); }
  }
  const providerJson = (path, options) => requestJson(`${BASE}${path}`, options);
  const hfJson = (path, options) => requestJson(`${HF_BASE}${path}`, options);
  const hfRouterJson = (path, options) => requestJson(`${HF_ROUTER}${path}`, options);
  async function checkKey(keyValue) {
    const response = await providerJson('/api/v1/key', { headers: { Authorization: `Bearer ${keyValue}` } });
    if (!response?.data || typeof response.data !== 'object') throw failure('provider_response', 'OpenRouter did not confirm this key.', 502);
    return response.data;
  }
  function connected(workspaceId, actorId) {
    const row = read(workspaceId, actorId);
    if (!row) throw failure('not_connected', 'Connect your OpenRouter account first.', 409);
    return { row, keyValue: unseal(row.id, row.encrypted_credential) };
  }
  async function start({ workspace_id }, actor, host) {
    await requireWorkspace(workspace_id, actor);
    const origin = callbackOrigin(host), state = randomBytes(24).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    const stateHash = digest(state), createdAt = now();
    db.prepare('DELETE FROM ai_authorization_attempts WHERE expires_at<?').run(createdAt);
    db.prepare("DELETE FROM ai_authorization_attempts WHERE workspace_id=? AND actor_id=? AND provider='openrouter'").run(workspace_id, actor.id);
    db.prepare('INSERT INTO ai_authorization_attempts VALUES (?,?,?,?,?,?,?,?)').run(stateHash, workspace_id, actor.id, 'openrouter', seal(stateHash, verifier), origin, new Date(Date.now() + 10 * 60_000).toISOString(), createdAt);
    const url = new URL('/auth', BASE);
    url.searchParams.set('callback_url', `${origin}${CALLBACK}${state}`);
    url.searchParams.set('code_challenge', digest(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('key_label', 'Rumbo');
    return { authorization_url: url.toString(), expires_at: new Date(Date.now() + 10 * 60_000).toISOString() };
  }
  async function complete(state, code, actor, host) {
    requireActor(actor);
    if (!/^[A-Za-z0-9_-]{32}$/.test(state) || typeof code !== 'string' || !code || code.length > 2048) throw failure('oauth_invalid', 'Invalid OpenRouter authorization response.', 400);
    const stateHash = digest(state), attempt = db.prepare('SELECT * FROM ai_authorization_attempts WHERE state_hash=?').get(stateHash);
    if (!attempt || attempt.actor_id !== actor.id || attempt.provider !== 'openrouter' || attempt.expires_at <= now() || callbackOrigin(host) !== attempt.callback_origin) throw failure('oauth_expired', 'This OpenRouter sign-in is expired or belongs to another session. Start again.', 409);
    await requireWorkspace(attempt.workspace_id, actor);
    const exchanged = await providerJson('/api/v1/auth/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, code_verifier: unseal(stateHash, attempt.encrypted_verifier), code_challenge_method: 'S256' }) });
    if (typeof exchanged?.key !== 'string' || !exchanged.key.startsWith('sk-or-')) throw failure('oauth_invalid', 'OpenRouter did not return a usable key.', 502);
    const metadata = await checkKey(exchanged.key), id = read(attempt.workspace_id, actor.id)?.id || randomUUID(), timestamp = now();
    if (!db.prepare('SELECT state_hash FROM ai_authorization_attempts WHERE state_hash=? AND actor_id=? AND expires_at>?').get(stateHash, actor.id, timestamp)) throw failure('oauth_cancelled', 'This sign-in was cancelled or superseded. Start again.', 409);
    db.prepare('DELETE FROM ai_authorization_attempts WHERE state_hash=?').run(stateHash);
    db.prepare(`INSERT INTO ai_account_connections (id,workspace_id,actor_id,provider,state,encrypted_credential,account_label,checked_at,model_tested_at,created_at,updated_at)
      VALUES (?,?,?,'openrouter','connected',?,?,?,?,?,?)
      ON CONFLICT(workspace_id,actor_id,provider) DO UPDATE SET state='connected',encrypted_credential=excluded.encrypted_credential,account_label=excluded.account_label,checked_at=excluded.checked_at,model_tested_at=NULL,updated_at=excluded.updated_at`)
      .run(id, attempt.workspace_id, actor.id, seal(id, exchanged.key), typeof metadata.label === 'string' ? metadata.label.slice(0, 120) : 'OpenRouter account', timestamp, null, timestamp, timestamp);
    return publicRow(read(attempt.workspace_id, actor.id));
  }
  async function list(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    return { openrouter: publicRow(read(workspaceId, actor.id)), huggingface: publicRow(read(workspaceId, actor.id, 'huggingface')), huggingface_configured: Boolean(env.RUMBO_HF_CLIENT_ID), requirements: { openrouter: 'No operator API key; HTTPS public origin required for deployment.', huggingface: 'Rumbo OAuth application with inference-api scope and exact callback.', copilot: 'Rumbo GitHub OAuth App and isolated server-side Copilot SDK runtime; user Copilot subscription required.' } };
  }
  async function check(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    const { row, keyValue } = connected(workspaceId, actor.id);
    const metadata = await checkKey(keyValue), timestamp = now();
    db.prepare('UPDATE ai_account_connections SET state=?,account_label=?,checked_at=?,updated_at=? WHERE id=?').run('connected', typeof metadata.label === 'string' ? metadata.label.slice(0, 120) : row.account_label, timestamp, timestamp, row.id);
    return { connection: publicRow(read(workspaceId, actor.id)), key: { is_free_tier: Boolean(metadata.is_free_tier), limit_remaining: Number.isFinite(metadata.limit_remaining) ? metadata.limit_remaining : null } };
  }
  async function models(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    const { keyValue } = connected(workspaceId, actor.id);
    const result = await providerJson('/api/v1/models/user', { headers: { Authorization: `Bearer ${keyValue}` } });
    if (!Array.isArray(result?.data)) throw failure('provider_response', 'OpenRouter did not return a model list.', 502);
    return result.data.slice(0, 500).filter(item => typeof item.id === 'string' && item.id.length <= 200).map(item => ({ id: item.id, name: typeof item.name === 'string' ? item.name.slice(0, 160) : item.id, input_modalities: item.architecture?.input_modalities || [], output_modalities: item.architecture?.output_modalities || [] }));
  }
  async function testModel(workspaceId, model, actor) {
    await requireWorkspace(workspaceId, actor);
    if (typeof model !== 'string' || !/^[\w./:~-]{2,200}$/.test(model)) throw failure('invalid_model', 'Choose a model from the available list.');
    const available = await models(workspaceId, actor);
    if (!available.some(item => item.id === model)) throw failure('model_unavailable', 'This model is not available to this account.', 409);
    const { row, keyValue } = connected(workspaceId, actor.id);
    const result = await providerJson('/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${keyValue}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 16, stream: false }) });
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw failure('model_response', 'The model request completed without a text response.', 502);
    const timestamp = now();
    db.prepare('UPDATE ai_account_connections SET model_tested_at=?,updated_at=? WHERE id=?').run(timestamp, timestamp, row.id);
    return { model, reply: content.slice(0, 500), tested_at: timestamp, usage: result.usage ?? null };
  }
  async function disconnect(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    db.prepare("DELETE FROM ai_account_connections WHERE workspace_id=? AND actor_id=? AND provider='openrouter'").run(workspaceId, actor.id);
    db.prepare("DELETE FROM ai_authorization_attempts WHERE workspace_id=? AND actor_id=? AND provider='openrouter'").run(workspaceId, actor.id);
    return { disconnected: true, remote_key_revoked: false };
  }
  const hfClientId = () => {
    const clientId = env.RUMBO_HF_CLIENT_ID;
    if (typeof clientId !== 'string' || !clientId || clientId.length > 500) throw failure('operator_setup_required', 'The Rumbo operator must configure RUMBO_HF_CLIENT_ID before Hugging Face sign-in.', 409);
    return clientId;
  };
  const hfRedirect = host => `${callbackOrigin(host)}${HF_CALLBACK}`;
  async function hfToken(fields) {
    const clientId = hfClientId();
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (env.RUMBO_HF_CLIENT_SECRET) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${env.RUMBO_HF_CLIENT_SECRET}`).toString('base64')}`;
    const result = await hfJson('/oauth/token', { method: 'POST', headers, body: new URLSearchParams({ client_id: clientId, ...fields }).toString() });
    if (typeof result.access_token !== 'string' || !result.access_token) throw failure('oauth_invalid', 'Hugging Face did not return an access token.', 502);
    return { access_token: result.access_token, refresh_token: result.refresh_token || null, expires_at: Number.isFinite(Number(result.expires_in)) ? Date.now() + Number(result.expires_in) * 1000 : null };
  }
  async function hfStart({ workspace_id }, actor, host) {
    await requireWorkspace(workspace_id, actor);
    const clientId = hfClientId(), origin = callbackOrigin(host), state = randomBytes(24).toString('base64url'), verifier = randomBytes(48).toString('base64url'), stateHash = digest(state), createdAt = now();
    db.prepare('DELETE FROM ai_authorization_attempts WHERE expires_at<?').run(createdAt);
    db.prepare("DELETE FROM ai_authorization_attempts WHERE workspace_id=? AND actor_id=? AND provider='huggingface'").run(workspace_id, actor.id);
    db.prepare('INSERT INTO ai_authorization_attempts VALUES (?,?,?,?,?,?,?,?)').run(stateHash, workspace_id, actor.id, 'huggingface', seal(stateHash, verifier), origin, new Date(Date.now() + 10 * 60_000).toISOString(), createdAt);
    const url = new URL('/oauth/authorize', HF_BASE);
    for (const [name, value] of Object.entries({ client_id: clientId, redirect_uri: hfRedirect(host), response_type: 'code', scope: 'openid profile inference-api', state, code_challenge: digest(verifier), code_challenge_method: 'S256' })) url.searchParams.set(name, value);
    return { authorization_url: url.toString(), callback_url: hfRedirect(host) };
  }
  async function hfComplete(state, code, actor, host) {
    requireActor(actor);
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(state) || typeof code !== 'string' || !code || code.length > 2048) throw failure('oauth_invalid', 'Invalid Hugging Face authorization response.');
    const stateHash = digest(state), attempt = db.prepare('SELECT * FROM ai_authorization_attempts WHERE state_hash=?').get(stateHash);
    if (!attempt || attempt.actor_id !== actor.id || attempt.provider !== 'huggingface' || attempt.expires_at <= now() || attempt.callback_origin !== callbackOrigin(host)) throw failure('oauth_expired', 'This Hugging Face sign-in is expired or belongs to another session.', 409);
    await requireWorkspace(attempt.workspace_id, actor);
    const credential = await hfToken({ grant_type: 'authorization_code', code, redirect_uri: hfRedirect(host), code_verifier: unseal(stateHash, attempt.encrypted_verifier) });
    const identity = await hfJson('/api/whoami-v2', { headers: { Authorization: `Bearer ${credential.access_token}` } });
    const timestamp = now(), id = read(attempt.workspace_id, actor.id, 'huggingface')?.id || randomUUID();
    if (!db.prepare('SELECT state_hash FROM ai_authorization_attempts WHERE state_hash=? AND actor_id=? AND expires_at>?').get(stateHash, actor.id, timestamp)) throw failure('oauth_cancelled', 'This sign-in was cancelled or superseded.', 409);
    db.prepare('DELETE FROM ai_authorization_attempts WHERE state_hash=?').run(stateHash);
    db.prepare(`INSERT INTO ai_account_connections (id,workspace_id,actor_id,provider,state,encrypted_credential,account_label,checked_at,model_tested_at,created_at,updated_at)
      VALUES (?,?,?,'huggingface','connected',?,?,?,?,?,?)
      ON CONFLICT(workspace_id,actor_id,provider) DO UPDATE SET state='connected',encrypted_credential=excluded.encrypted_credential,account_label=excluded.account_label,checked_at=excluded.checked_at,model_tested_at=NULL,updated_at=excluded.updated_at`)
      .run(id, attempt.workspace_id, actor.id, seal(id, JSON.stringify(credential)), typeof identity.name === 'string' ? identity.name.slice(0, 120) : 'Hugging Face account', timestamp, null, timestamp, timestamp);
    return publicRow(read(attempt.workspace_id, actor.id, 'huggingface'));
  }
  async function hfCredential(workspaceId, actor) {
    const row = read(workspaceId, actor.id, 'huggingface');
    if (!row) throw failure('not_connected', 'Connect your Hugging Face account first.', 409);
    let credential;
    try { credential = JSON.parse(unseal(row.id, row.encrypted_credential)); }
    catch { throw failure('credential_unreadable', 'Reconnect your Hugging Face account.', 409); }
    if (credential.expires_at && credential.expires_at < Date.now() + 60_000) {
      if (!credential.refresh_token) throw failure('reconnect_required', 'Your Hugging Face session expired. Reconnect.', 409);
      const refreshed = await hfToken({ grant_type: 'refresh_token', refresh_token: credential.refresh_token });
      credential = { ...credential, ...refreshed, refresh_token: refreshed.refresh_token || credential.refresh_token };
      const updated = db.prepare('UPDATE ai_account_connections SET encrypted_credential=?,updated_at=? WHERE id=? AND encrypted_credential=?').run(seal(row.id, JSON.stringify(credential)), now(), row.id, row.encrypted_credential);
      if (!updated.changes) throw failure('connection_changed', 'Hugging Face authorization changed during refresh. Retry.', 409);
    }
    return { row, token: credential.access_token };
  }
  async function hfCheck(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    const { row, token } = await hfCredential(workspaceId, actor);
    const identity = await hfJson('/api/whoami-v2', { headers: { Authorization: `Bearer ${token}` } }), timestamp = now();
    db.prepare('UPDATE ai_account_connections SET account_label=?,checked_at=?,updated_at=? WHERE id=?').run(typeof identity.name === 'string' ? identity.name.slice(0, 120) : row.account_label, timestamp, timestamp, row.id);
    return publicRow(read(workspaceId, actor.id, 'huggingface'));
  }
  async function hfModels(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    const { token } = await hfCredential(workspaceId, actor);
    const result = await hfRouterJson('/v1/models', { headers: { Authorization: `Bearer ${token}` } });
    if (!Array.isArray(result?.data)) throw failure('provider_response', 'Hugging Face did not return a model list.', 502);
    return result.data.slice(0, 500).filter(item => typeof item.id === 'string' && item.id.length <= 200).map(item => ({ id: item.id, name: item.id, input_modalities: item.architecture?.input_modalities || [], output_modalities: item.architecture?.output_modalities || [] }));
  }
  async function hfTestModel(workspaceId, model, actor) {
    await requireWorkspace(workspaceId, actor);
    if (typeof model !== 'string' || !/^[\w./:~-]{2,200}$/.test(model)) throw failure('invalid_model', 'Choose a model from the catalog.');
    const available = await hfModels(workspaceId, actor);
    if (!available.some(item => item.id === model)) throw failure('model_unavailable', 'This model is not in the current Hugging Face catalog.', 409);
    const { row, token } = await hfCredential(workspaceId, actor);
    const result = await hfRouterJson('/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 16, stream: false }) });
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw failure('model_response', 'The model request completed without a text response.', 502);
    const timestamp = now();
    db.prepare('UPDATE ai_account_connections SET model_tested_at=?,updated_at=? WHERE id=?').run(timestamp, timestamp, row.id);
    return { model, reply: content.slice(0, 500), tested_at: timestamp, usage: result.usage ?? null };
  }
  async function hfDisconnect(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    db.prepare("DELETE FROM ai_account_connections WHERE workspace_id=? AND actor_id=? AND provider='huggingface'").run(workspaceId, actor.id);
    db.prepare("DELETE FROM ai_authorization_attempts WHERE workspace_id=? AND actor_id=? AND provider='huggingface'").run(workspaceId, actor.id);
    return { disconnected: true, remote_access_revoked: false };
  }
  return { start, complete, list, check, models, testModel, disconnect, hfStart, hfComplete, hfCheck, hfModels, hfTestModel, hfDisconnect };
}

import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_PROVIDERS, apiProviderDefinition, validApiModel } from '../src/lib/ai-provider-catalog.js';
import { apiKeyConfiguration, discoverApiModels, apiCompletionRequest, parseApiCompletion } from './model-api-adapters.mjs';
import { createCopilotOAuthService } from './copilot-oauth-service.mjs';

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

export function createAiConnectionsService({ db, dataDir, fetchImpl = fetch, env = process.env, authorize, onCopilotReplace }) {
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
  let closed = false;
  const shutdown = new AbortController(), authorizationClaims = new Map(), activeRuns = new Map();
  const scopeKey = (provider, workspaceId, actor) => JSON.stringify([provider, workspaceId, actor.id]);
  const assertOpen = () => { if (closed) throw failure('service_closed', 'The AI connection service is closed.', 409); };
  function cancelRuns(provider, workspaceId, actor) {
    for (const stop of [...(activeRuns.get(scopeKey(provider, workspaceId, actor)) || [])]) stop();
  }
  function cancelAuthorization(provider, workspaceId, actor) {
    authorizationClaims.delete(scopeKey(provider, workspaceId, actor));
    db.prepare('DELETE FROM ai_authorization_attempts WHERE workspace_id=? AND actor_id=? AND provider=?').run(workspaceId, actor.id, provider);
  }

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
    assertOpen();
    requireActor(actor);
    if (typeof workspaceId !== 'string' || !db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspaceId)) throw failure('workspace_missing', 'Workspace unavailable.', 404);
    await authorize(workspaceId, actor);
    assertOpen();
  };
  const read = (workspaceId, actorId, provider = 'openrouter') => db.prepare('SELECT * FROM ai_account_connections WHERE workspace_id=? AND actor_id=? AND provider=?').get(workspaceId, actorId, provider);
  async function assertCredentialCurrent(provider, workspaceId, actor, captured) {
    await requireWorkspace(workspaceId, actor);
    const current = read(workspaceId, actor.id, provider);
    if (!captured || !current || current.id !== captured.id || current.encrypted_credential !== captured.encrypted_credential) throw failure('connection_changed', 'This AI account was disconnected or replaced. Review the current connection before trying again.', 409);
  }
  async function withAuthorizationClaim(attempt, stateHash, action) {
    const key = scopeKey(attempt.provider, attempt.workspace_id, { id: attempt.actor_id }), nonce = randomUUID();
    if (!db.prepare('DELETE FROM ai_authorization_attempts WHERE state_hash=? AND actor_id=?').run(stateHash, attempt.actor_id).changes) throw failure('oauth_replayed', 'This authorization callback was already used.', 409);
    authorizationClaims.set(key, nonce);
    try { return await action(async actor => {
      await requireWorkspace(attempt.workspace_id, actor);
      if (authorizationClaims.get(key) !== nonce || attempt.expires_at <= now()) throw failure('oauth_cancelled', 'This sign-in was cancelled, superseded or expired. Start again.', 409);
    }); } finally { if (authorizationClaims.get(key) === nonce) authorizationClaims.delete(key); }
  }
  const savedApiConfig = row => {
    if (!row) return null;
    const secret = unseal(row.id, row.encrypted_credential);
    if (!secret.startsWith('{')) return null;
    let config;
    try { config = JSON.parse(secret); } catch { return null; }
    return config.type === 'api_key' ? apiKeyConfiguration(row.provider, config) : null;
  };
  const publicRow = row => {
    if (!row) return null;
    const config = savedApiConfig(row);
    return { provider: row.provider, state: row.state, account_label: row.account_label, checked_at: row.checked_at, model_tested_at: row.model_tested_at,
      method: config ? 'api_key' : 'oauth', ...(config ? { model_ids: config.model_ids, region: config.region, provider_workspace: config.provider_workspace } : {}) };
  };
  const callbackOrigin = host => {
    const configured = env.RUMBO_PUBLIC_BASE_URL;
    let url;
    try { url = new URL(configured || `http://${host}`); }
    catch { throw failure('callback_setup', 'Configure a valid RUMBO_PUBLIC_BASE_URL.', 409); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw failure('callback_setup', 'RUMBO_PUBLIC_BASE_URL must be an HTTPS origin, or a local loopback HTTP origin.', 409);
    return url.origin;
  };
  async function requestJson(url, options = {}) {
    assertOpen();
    let response;
    const provider = new URL(url).hostname === 'openrouter.ai' ? 'OpenRouter' : new URL(url).hostname.endsWith('huggingface.co') ? 'Hugging Face' : ['github.com', 'api.github.com'].includes(new URL(url).hostname) ? 'GitHub' : 'The AI provider';
    try { response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.any([shutdown.signal, options.signal || AbortSignal.timeout(20_000)]) }); }
    catch { throw failure('provider_unreachable', `${provider} could not be reached. Try again later.`, 502); }
    assertOpen();
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
      if (Buffer.byteLength(content, 'utf8') > MAX_RESPONSE_BYTES) throw failure('provider_response_too_large', `${provider} response was too large.`, 502);
    }
    assertOpen();
    try { return JSON.parse(content); } catch { throw failure('provider_response', `${provider} returned an unreadable response.`, 502); }
  }
  const providerJson = (path, options) => requestJson(`${BASE}${path}`, options);
  const hfJson = (path, options) => requestJson(`${HF_BASE}${path}`, options);
  const hfRouterJson = (path, options) => requestJson(`${HF_ROUTER}${path}`, options);
  const copilotOAuth = createCopilotOAuthService({ db, env, seal, unseal, requireWorkspace, callbackOrigin, requestJson, onReplace: onCopilotReplace });
  async function checkKey(keyValue) {
    const response = await providerJson('/api/v1/key', { headers: { Authorization: `Bearer ${keyValue}` } });
    if (!response?.data || typeof response.data !== 'object') throw failure('provider_response', 'OpenRouter did not confirm this key.', 502);
    return response.data;
  }
  function connected(workspaceId, actorId) {
    const row = read(workspaceId, actorId);
    if (!row) throw failure('not_connected', 'Connect your OpenRouter account first.', 409);
    const keyValue = unseal(row.id, row.encrypted_credential);
    if (!keyValue.startsWith('sk-or-') || keyValue.length > 4096) throw failure('connection_changed', 'Use the current OpenRouter connection method and start this operation again.', 409);
    return { row, keyValue };
  }
  async function start({ workspace_id }, actor, host) {
    await requireWorkspace(workspace_id, actor);
    const origin = callbackOrigin(host), state = randomBytes(24).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    const stateHash = digest(state), createdAt = now();
    db.prepare('DELETE FROM ai_authorization_attempts WHERE expires_at<?').run(createdAt);
    cancelAuthorization('openrouter', workspace_id, actor);
    db.prepare('INSERT INTO ai_authorization_attempts VALUES (?,?,?,?,?,?,?,?)').run(stateHash, workspace_id, actor.id, 'openrouter', seal(stateHash, verifier), origin, new Date(Date.now() + 10 * 60_000).toISOString(), createdAt);
    const url = new URL('/auth', BASE);
    url.searchParams.set('callback_url', `${origin}${CALLBACK}${state}`);
    url.searchParams.set('code_challenge', digest(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('key_label', 'Rumbo');
    return { authorization_url: url.toString(), expires_at: new Date(Date.now() + 10 * 60_000).toISOString() };
  }
  async function complete(state, code, actor, host) {
    assertOpen();
    requireActor(actor);
    if (!/^[A-Za-z0-9_-]{32}$/.test(state) || typeof code !== 'string' || !code || code.length > 2048) throw failure('oauth_invalid', 'Invalid OpenRouter authorization response.', 400);
    const stateHash = digest(state), attempt = db.prepare('SELECT * FROM ai_authorization_attempts WHERE state_hash=?').get(stateHash);
    if (!attempt || attempt.actor_id !== actor.id || attempt.provider !== 'openrouter' || attempt.expires_at <= now() || callbackOrigin(host) !== attempt.callback_origin) throw failure('oauth_expired', 'This OpenRouter sign-in is expired or belongs to another session. Start again.', 409);
    await requireWorkspace(attempt.workspace_id, actor);
    return withAuthorizationClaim(attempt, stateHash, async assertPending => {
    const exchanged = await providerJson('/api/v1/auth/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, code_verifier: unseal(stateHash, attempt.encrypted_verifier), code_challenge_method: 'S256' }) });
    await assertPending(actor);
    if (typeof exchanged?.key !== 'string' || !exchanged.key.startsWith('sk-or-')) throw failure('oauth_invalid', 'OpenRouter did not return a usable key.', 502);
    const metadata = await checkKey(exchanged.key);
    await assertPending(actor);
    const id = read(attempt.workspace_id, actor.id)?.id || randomUUID(), timestamp = now();
    cancelRuns('openrouter', attempt.workspace_id, actor);
    db.prepare(`INSERT INTO ai_account_connections (id,workspace_id,actor_id,provider,state,encrypted_credential,account_label,checked_at,model_tested_at,created_at,updated_at)
      VALUES (?,?,?,'openrouter','connected',?,?,?,?,?,?)
      ON CONFLICT(workspace_id,actor_id,provider) DO UPDATE SET state='connected',encrypted_credential=excluded.encrypted_credential,account_label=excluded.account_label,checked_at=excluded.checked_at,model_tested_at=NULL,updated_at=excluded.updated_at`)
      .run(id, attempt.workspace_id, actor.id, seal(id, exchanged.key), typeof metadata.label === 'string' ? metadata.label.slice(0, 120) : 'OpenRouter account', timestamp, null, timestamp, timestamp);
    return publicRow(read(attempt.workspace_id, actor.id));
    });
  }
  async function list(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    return { ...Object.fromEntries(API_PROVIDERS.map(provider => [provider.id, publicRow(read(workspaceId, actor.id, provider.id))])), huggingface_configured: Boolean(env.RUMBO_HF_CLIENT_ID), requirements: { openrouter: 'Browser authorization or your API key.', huggingface: 'Browser authorization requires an OAuth app; a personal inference token does not.', copilot: 'Local ACP requires Copilot CLI and each user’s eligible Copilot subscription/access. Hosted GitHub authorization requires operator app registration; each user needs eligible Copilot access. Only explicit successful inference verifies it.' } };
  }
  async function check(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    const { row, keyValue } = connected(workspaceId, actor.id);
    const metadata = await checkKey(keyValue), timestamp = now();
    await assertCredentialCurrent('openrouter', workspaceId, actor, row);
    db.prepare('UPDATE ai_account_connections SET state=?,account_label=?,checked_at=?,updated_at=? WHERE id=?').run('connected', typeof metadata.label === 'string' ? metadata.label.slice(0, 120) : row.account_label, timestamp, timestamp, row.id);
    return { connection: publicRow(read(workspaceId, actor.id)), key: { is_free_tier: Boolean(metadata.is_free_tier), limit_remaining: Number.isFinite(metadata.limit_remaining) ? metadata.limit_remaining : null } };
  }
  async function models(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    const { row, keyValue } = connected(workspaceId, actor.id);
    const result = await providerJson('/api/v1/models/user', { headers: { Authorization: `Bearer ${keyValue}` } });
    await assertCredentialCurrent('openrouter', workspaceId, actor, row);
    if (!Array.isArray(result?.data)) throw failure('provider_response', 'OpenRouter did not return a model list.', 502);
    return result.data.slice(0, 500).filter(item => typeof item.id === 'string' && item.id.length <= 200).map(item => ({ id: item.id, name: typeof item.name === 'string' ? item.name.slice(0, 160) : item.id, input_modalities: item.architecture?.input_modalities || [], output_modalities: item.architecture?.output_modalities || [] }));
  }
  async function testModel(workspaceId, model, actor) {
    await requireWorkspace(workspaceId, actor);
    if (typeof model !== 'string' || !/^[\w./:~-]{2,200}$/.test(model)) throw failure('invalid_model', 'Choose a model from the available list.');
    const captured = connected(workspaceId, actor.id).row;
    const available = await models(workspaceId, actor);
    await assertCredentialCurrent('openrouter', workspaceId, actor, captured);
    if (!available.some(item => item.id === model)) throw failure('model_unavailable', 'This model is not available to this account.', 409);
    const { row, keyValue } = connected(workspaceId, actor.id);
    const result = await providerJson('/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${keyValue}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 16, stream: false }) });
    await assertCredentialCurrent('openrouter', workspaceId, actor, row);
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw failure('model_response', 'The model request completed without a text response.', 502);
    const timestamp = now();
    db.prepare('UPDATE ai_account_connections SET model_tested_at=?,updated_at=? WHERE id=?').run(timestamp, timestamp, row.id);
    return { model, reply: content.slice(0, 500), tested_at: timestamp, usage: result.usage ?? null };
  }
  async function disconnect(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    cancelRuns('openrouter', workspaceId, actor); cancelAuthorization('openrouter', workspaceId, actor);
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
  async function hfToken(fields, signal) {
    const clientId = hfClientId();
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (env.RUMBO_HF_CLIENT_SECRET) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${env.RUMBO_HF_CLIENT_SECRET}`).toString('base64')}`;
    const result = await hfJson('/oauth/token', { method: 'POST', headers, body: new URLSearchParams({ client_id: clientId, ...fields }).toString(), ...(signal ? { signal } : {}) });
    if (typeof result.access_token !== 'string' || !result.access_token) throw failure('oauth_invalid', 'Hugging Face did not return an access token.', 502);
    return { access_token: result.access_token, refresh_token: result.refresh_token || null, expires_at: Number.isFinite(Number(result.expires_in)) ? Date.now() + Number(result.expires_in) * 1000 : null };
  }
  async function hfStart({ workspace_id }, actor, host) {
    await requireWorkspace(workspace_id, actor);
    const clientId = hfClientId(), origin = callbackOrigin(host), state = randomBytes(24).toString('base64url'), verifier = randomBytes(48).toString('base64url'), stateHash = digest(state), createdAt = now();
    db.prepare('DELETE FROM ai_authorization_attempts WHERE expires_at<?').run(createdAt);
    cancelAuthorization('huggingface', workspace_id, actor);
    db.prepare('INSERT INTO ai_authorization_attempts VALUES (?,?,?,?,?,?,?,?)').run(stateHash, workspace_id, actor.id, 'huggingface', seal(stateHash, JSON.stringify({ verifier, client_id: clientId })), origin, new Date(Date.now() + 10 * 60_000).toISOString(), createdAt);
    const url = new URL('/oauth/authorize', HF_BASE);
    for (const [name, value] of Object.entries({ client_id: clientId, redirect_uri: hfRedirect(host), response_type: 'code', scope: 'openid profile inference-api', state, code_challenge: digest(verifier), code_challenge_method: 'S256' })) url.searchParams.set(name, value);
    return { authorization_url: url.toString(), callback_url: hfRedirect(host) };
  }
  async function hfComplete(state, code, actor, host) {
    assertOpen();
    requireActor(actor);
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(state) || typeof code !== 'string' || !code || code.length > 2048) throw failure('oauth_invalid', 'Invalid Hugging Face authorization response.');
    const stateHash = digest(state), attempt = db.prepare('SELECT * FROM ai_authorization_attempts WHERE state_hash=?').get(stateHash);
    if (!attempt || attempt.actor_id !== actor.id || attempt.provider !== 'huggingface' || attempt.expires_at <= now() || attempt.callback_origin !== callbackOrigin(host)) throw failure('oauth_expired', 'This Hugging Face sign-in is expired or belongs to another session.', 409);
    await requireWorkspace(attempt.workspace_id, actor);
    let pending;
    try { pending = JSON.parse(unseal(stateHash, attempt.encrypted_verifier)); } catch { throw failure('oauth_expired', 'Start Hugging Face sign-in again with the current app registration.', 409); }
    if (pending.client_id !== hfClientId() || typeof pending.verifier !== 'string') throw failure('oauth_expired', 'The Hugging Face app registration changed. Start sign-in again.', 409);
    return withAuthorizationClaim(attempt, stateHash, async assertPending => {
    const credential = await hfToken({ grant_type: 'authorization_code', code, redirect_uri: hfRedirect(host), code_verifier: pending.verifier });
    await assertPending(actor);
    credential.client_id = pending.client_id;
    const identity = await hfJson('/api/whoami-v2', { headers: { Authorization: `Bearer ${credential.access_token}` } });
    await assertPending(actor);
    const timestamp = now(), id = read(attempt.workspace_id, actor.id, 'huggingface')?.id || randomUUID();
    if (pending.client_id !== hfClientId()) throw failure('oauth_expired', 'The Hugging Face app registration changed. Start sign-in again.', 409);
    cancelRuns('huggingface', attempt.workspace_id, actor);
    db.prepare(`INSERT INTO ai_account_connections (id,workspace_id,actor_id,provider,state,encrypted_credential,account_label,checked_at,model_tested_at,created_at,updated_at)
      VALUES (?,?,?,'huggingface','connected',?,?,?,?,?,?)
      ON CONFLICT(workspace_id,actor_id,provider) DO UPDATE SET state='connected',encrypted_credential=excluded.encrypted_credential,account_label=excluded.account_label,checked_at=excluded.checked_at,model_tested_at=NULL,updated_at=excluded.updated_at`)
      .run(id, attempt.workspace_id, actor.id, seal(id, JSON.stringify(credential)), typeof identity.name === 'string' ? identity.name.slice(0, 120) : 'Hugging Face account', timestamp, null, timestamp, timestamp);
    return publicRow(read(attempt.workspace_id, actor.id, 'huggingface'));
    });
  }
  async function hfCredential(workspaceId, actor, signal) {
    const row = read(workspaceId, actor.id, 'huggingface');
    if (!row) throw failure('not_connected', 'Connect your Hugging Face account first.', 409);
    let credential;
    try { credential = JSON.parse(unseal(row.id, row.encrypted_credential)); }
    catch { throw failure('credential_unreadable', 'Reconnect your Hugging Face account.', 409); }
    if (credential.client_id && credential.client_id !== hfClientId()) throw failure('reconnect_required', 'Reconnect Hugging Face using the current Rumbo app registration.', 409);
    if (credential.expires_at && credential.expires_at < Date.now() + 60_000) {
      if (!credential.refresh_token) throw failure('reconnect_required', 'Your Hugging Face session expired. Reconnect.', 409);
      const refreshed = await hfToken({ grant_type: 'refresh_token', refresh_token: credential.refresh_token }, signal);
      await assertCredentialCurrent('huggingface', workspaceId, actor, row);
      credential = { ...credential, ...refreshed, refresh_token: refreshed.refresh_token || credential.refresh_token };
      const updated = db.prepare('UPDATE ai_account_connections SET encrypted_credential=?,updated_at=? WHERE id=? AND encrypted_credential=?').run(seal(row.id, JSON.stringify(credential)), now(), row.id, row.encrypted_credential);
      if (!updated.changes) throw failure('connection_changed', 'Hugging Face authorization changed during refresh. Retry.', 409);
    }
    if (typeof credential.access_token !== 'string' || !credential.access_token || credential.access_token.length > 8192) throw failure('credential_unreadable', 'Reconnect your Hugging Face account.', 409);
    return { row: read(workspaceId, actor.id, 'huggingface'), token: credential.access_token };
  }
  async function hfCheck(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    const { row, token } = await hfCredential(workspaceId, actor);
    const identity = await hfJson('/api/whoami-v2', { headers: { Authorization: `Bearer ${token}` } }), timestamp = now();
    await assertCredentialCurrent('huggingface', workspaceId, actor, row);
    db.prepare('UPDATE ai_account_connections SET account_label=?,checked_at=?,updated_at=? WHERE id=?').run(typeof identity.name === 'string' ? identity.name.slice(0, 120) : row.account_label, timestamp, timestamp, row.id);
    return publicRow(read(workspaceId, actor.id, 'huggingface'));
  }
  async function hfModels(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    const { row, token } = await hfCredential(workspaceId, actor);
    const result = await hfRouterJson('/v1/models', { headers: { Authorization: `Bearer ${token}` } });
    await assertCredentialCurrent('huggingface', workspaceId, actor, row);
    if (!Array.isArray(result?.data)) throw failure('provider_response', 'Hugging Face did not return a model list.', 502);
    return result.data.slice(0, 500).filter(item => typeof item.id === 'string' && item.id.length <= 200).map(item => ({ id: item.id, name: item.id, input_modalities: item.architecture?.input_modalities || [], output_modalities: item.architecture?.output_modalities || [] }));
  }
  async function hfTestModel(workspaceId, model, actor) {
    await requireWorkspace(workspaceId, actor);
    if (typeof model !== 'string' || !/^[\w./:~-]{2,200}$/.test(model)) throw failure('invalid_model', 'Choose a model from the catalog.');
    const captured = (await hfCredential(workspaceId, actor)).row;
    const available = await hfModels(workspaceId, actor);
    await assertCredentialCurrent('huggingface', workspaceId, actor, captured);
    if (!available.some(item => item.id === model)) throw failure('model_unavailable', 'This model is not in the current Hugging Face catalog.', 409);
    const { row, token } = await hfCredential(workspaceId, actor);
    const result = await hfRouterJson('/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 16, stream: false }) });
    await assertCredentialCurrent('huggingface', workspaceId, actor, row);
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw failure('model_response', 'The model request completed without a text response.', 502);
    const timestamp = now();
    db.prepare('UPDATE ai_account_connections SET model_tested_at=?,updated_at=? WHERE id=?').run(timestamp, timestamp, row.id);
    return { model, reply: content.slice(0, 500), tested_at: timestamp, usage: result.usage ?? null };
  }
  async function hfDisconnect(workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    cancelRuns('huggingface', workspaceId, actor); cancelAuthorization('huggingface', workspaceId, actor);
    db.prepare("DELETE FROM ai_account_connections WHERE workspace_id=? AND actor_id=? AND provider='huggingface'").run(workspaceId, actor.id);
    db.prepare("DELETE FROM ai_authorization_attempts WHERE workspace_id=? AND actor_id=? AND provider='huggingface'").run(workspaceId, actor.id);
    return { disconnected: true, remote_access_revoked: false };
  }
  async function saveApiKey(provider, input, actor) {
    await requireWorkspace(input.workspace_id, actor);
    const config = apiKeyConfiguration(provider, input), timestamp = now();
    cancelRuns(provider, input.workspace_id, actor); cancelAuthorization(provider, input.workspace_id, actor);
    const existing = read(input.workspace_id, actor.id, provider), id = existing?.id || randomUUID();
    db.prepare(`INSERT INTO ai_account_connections (id,workspace_id,actor_id,provider,state,encrypted_credential,account_label,checked_at,model_tested_at,created_at,updated_at)
      VALUES (?,?,?,?,'configured',?,?,NULL,NULL,?,?)
      ON CONFLICT(workspace_id,actor_id,provider) DO UPDATE SET state='configured',encrypted_credential=excluded.encrypted_credential,account_label=excluded.account_label,checked_at=NULL,model_tested_at=NULL,updated_at=excluded.updated_at`)
      .run(id, input.workspace_id, actor.id, provider, seal(id, JSON.stringify(config)), `${apiProviderDefinition(provider).name} API key`, timestamp, timestamp);
    db.prepare('DELETE FROM ai_authorization_attempts WHERE workspace_id=? AND actor_id=? AND provider=?').run(input.workspace_id, actor.id, provider);
    return publicRow(read(input.workspace_id, actor.id, provider));
  }
  async function connectionModels(provider, workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    const row = read(workspaceId, actor.id, provider), config = savedApiConfig(row);
    if (config) {
      const catalog = await discoverApiModels(provider, config, requestJson);
      await assertCredentialCurrent(provider, workspaceId, actor, row);
      return catalog;
    }
    if (provider === 'openrouter') return models(workspaceId, actor);
    if (provider === 'huggingface') return hfModels(workspaceId, actor);
    throw failure('not_connected', 'Save an API key for this provider first.', 409);
  }
  async function connectionCheck(provider, workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    const row = read(workspaceId, actor.id, provider), config = savedApiConfig(row);
    if (!config) {
      if (provider === 'openrouter') return check(workspaceId, actor);
      if (provider === 'huggingface') return hfCheck(workspaceId, actor);
      throw failure('not_connected', 'Save an API key for this provider first.', 409);
    }
    if (!apiProviderDefinition(provider).discovery) return { connection: publicRow(row), requires_model_test: true };
    const catalog = await discoverApiModels(provider, config, requestJson);
    await assertCredentialCurrent(provider, workspaceId, actor, row);
    db.prepare('UPDATE ai_account_connections SET checked_at=?,updated_at=? WHERE id=? AND encrypted_credential=?').run(now(), now(), row.id, row.encrypted_credential);
    return { connection: publicRow(read(workspaceId, actor.id, provider)), model_count: catalog.length, requires_model_test: !row.model_tested_at };
  }
  async function connectionTest(provider, workspaceId, model, actor) {
    await requireWorkspace(workspaceId, actor);
    const row = read(workspaceId, actor.id, provider), config = savedApiConfig(row);
    if (!config) {
      if (provider === 'openrouter') return testModel(workspaceId, model, actor);
      if (provider === 'huggingface') return hfTestModel(workspaceId, model, actor);
      throw failure('not_connected', 'Save an API key for this provider first.', 409);
    }
    const catalog = await discoverApiModels(provider, config, requestJson);
    await assertCredentialCurrent(provider, workspaceId, actor, row);
    if (!validApiModel(model) || !catalog.some(item => item.id === model)) throw failure('model_unavailable', 'Choose a model from this connection’s catalog or configured model IDs.', 409);
    const request = apiCompletionRequest(provider, config, model, 'Reply with the single word OK.', { test: true });
    const parsed = parseApiCompletion(provider, await requestJson(request.url, { ...request.options, signal: AbortSignal.timeout(60_000) }), config.api_key);
    await assertCredentialCurrent(provider, workspaceId, actor, row);
    const timestamp = now();
    const updated = db.prepare("UPDATE ai_account_connections SET state='connected',checked_at=?,model_tested_at=?,updated_at=? WHERE id=? AND encrypted_credential=?").run(timestamp, timestamp, timestamp, row.id, row.encrypted_credential);
    if (!updated.changes) throw failure('connection_changed', 'The connection changed during this test. Test the current connection again.', 409);
    return { model, reply: parsed.text.slice(0, 500), tested_at: timestamp, usage: parsed.usage || null };
  }
  async function connectionDisconnect(provider, workspaceId, actor) {
    await requireWorkspace(workspaceId, actor);
    cancelRuns(provider, workspaceId, actor); cancelAuthorization(provider, workspaceId, actor);
    db.prepare('DELETE FROM ai_account_connections WHERE workspace_id=? AND actor_id=? AND provider=?').run(workspaceId, actor.id, provider);
    db.prepare('DELETE FROM ai_authorization_attempts WHERE workspace_id=? AND actor_id=? AND provider=?').run(workspaceId, actor.id, provider);
    return { disconnected: true, remote_access_revoked: false };
  }
  function readyState(provider, workspaceId, actor) {
    const capabilities = { provider, model_required: true, execution_mode: 'browser-api', native_tools: false, file_tools: false };
    try {
      assertOpen();
      requireActor(actor);
      if (!apiProviderDefinition(provider)) throw failure('unsupported_provider', 'Choose a supported API provider.', 400);
      if (!db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspaceId)) throw failure('workspace_missing', 'Workspace unavailable.', 404);
      const authorization = authorize(workspaceId, actor);
      if (authorization?.then) {
        authorization.catch(() => {});
        throw failure('authorization_pending', 'Synchronous workspace authorization is required for readiness.', 409);
      }
      const row = read(workspaceId, actor.id, provider);
      const config = savedApiConfig(row);
      if (config && row.state !== 'connected') throw failure('model_test_required', 'Test a model to finish connecting this API key.', 409);
      if (config) return { ...capabilities, state: 'connected' };
      if (!['openrouter', 'huggingface'].includes(provider)) throw failure('not_connected', 'Save and test an API key for this provider.', 409);
      if (provider === 'huggingface') hfClientId();
      if (!row || row.state !== 'connected') throw failure('not_connected', 'Connect this AI account first.', 409);
      const secret = unseal(row.id, row.encrypted_credential);
      if (provider === 'openrouter' && (!secret.startsWith('sk-or-') || secret.length > 4096)) throw failure('credential_unreadable', 'Reconnect this AI account.', 409);
      if (provider === 'huggingface') {
        let credential;
        try { credential = JSON.parse(secret); } catch { throw failure('credential_unreadable', 'Reconnect this AI account.', 409); }
        if (credential.client_id && credential.client_id !== hfClientId()) throw failure('reconnect_required', 'Reconnect Hugging Face using the current Rumbo app registration.', 409);
        if (typeof credential.access_token !== 'string' || !credential.access_token) throw failure('credential_unreadable', 'Reconnect this AI account.', 409);
        if (credential.expires_at && credential.expires_at < Date.now() + 60_000 && !credential.refresh_token) throw failure('reconnect_required', 'Your Hugging Face session expired. Reconnect.', 409);
      }
      return { ...capabilities, state: 'connected' };
    } catch (error) {
      return { ...capabilities, state: 'not_connected', error_code: error.code || 'access_denied', reason: error.message || 'This AI account is unavailable.' };
    }
  }

  async function startAgentRun({ provider, workspaceId, actor, prompt, model, timeoutMs = 120_000, signal }, { onEvent = () => {}, onComplete = () => {} } = {}) {
    if (!apiProviderDefinition(provider)) throw failure('unsupported_provider', 'Choose a supported API provider.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100_000) throw failure('invalid_prompt', 'Write an instruction between 1 and 100,000 characters.');
    if (!validApiModel(model)) throw failure('invalid_model', 'Choose an explicit provider model before starting this run.');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000) throw failure('invalid_timeout', 'Choose an execution limit between one second and thirty minutes.');
    if (signal?.aborted) throw failure('session_cancelled', 'This run was cancelled before it started.', 409);
    await requireWorkspace(workspaceId, actor);
    const initial = read(workspaceId, actor.id, provider);
    const initialConfig = savedApiConfig(initial);
    if (!initialConfig && !['openrouter', 'huggingface'].includes(provider)) throw failure('not_connected', 'Save and test an API key for this provider.', 409);
    if (provider === 'huggingface' && !initialConfig) hfClientId();
    if (!initial || initial.state !== 'connected') throw failure('not_connected', 'Connect this AI account first.', 409);
    // Read/decrypt only the current actor's connection. No key check, model probe,
    // tool bridge, project folder or automatic fallback request is performed.
    if (provider === 'openrouter' && !initialConfig) {
      const credential = unseal(initial.id, initial.encrypted_credential);
      if (!credential.startsWith('sk-or-') || credential.length > 4096) throw failure('credential_unreadable', 'Reconnect this AI account.', 409);
    }
    const abort = new AbortController(), runKey = scopeKey(provider, workspaceId, actor);
    let settled = false, timedOut = false, stopped = false, timeout;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', stop);
      const jobs = activeRuns.get(runKey); jobs?.delete(stop); if (!jobs?.size) activeRuns.delete(runKey);
      onComplete(result);
    };
    const stop = () => {
      if (settled) return;
      stopped = true;
      abort.abort();
      finish({ status: 'stopped', text: '', error_code: 'session_cancelled' });
    };
    const jobs = activeRuns.get(runKey) || new Set(); jobs.add(stop); activeRuns.set(runKey, jobs);
    signal?.addEventListener('abort', stop, { once: true });
    timeout = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      abort.abort();
      finish({ status: 'failed', text: '', error: 'The provider execution time limit was reached. Delivery may be uncertain; this request was not retried.', error_code: 'execution_timeout' });
    }, timeoutMs);
    if (signal?.aborted) stop();
    void (async () => {
      try {
        if (settled) return;
        const credential = initialConfig ? { row: initial, token: initialConfig.api_key } : provider === 'huggingface' ? await hfCredential(workspaceId, actor, abort.signal) : { row: initial, token: unseal(initial.id, initial.encrypted_credential) };
        if (settled) return;
        await requireWorkspace(workspaceId, actor);
        const current = read(workspaceId, actor.id, provider);
        if (!current || current.state !== 'connected' || current.id !== initial.id || current.encrypted_credential !== credential.row?.encrypted_credential) throw failure('connection_changed', 'This AI authorization changed before execution. Start a freshly reviewed run.', 409);
        if (settled) return;
        const apiRequest = initialConfig ? apiCompletionRequest(provider, initialConfig, model, prompt, { signal: abort.signal }) : null;
        const result = await requestJson(apiRequest?.url || (provider === 'openrouter' ? `${BASE}/api/v1/chat/completions` : `${HF_ROUTER}/v1/chat/completions`), apiRequest?.options || {
          method: 'POST', headers: { Authorization: `Bearer ${credential.token}`, 'Content-Type': 'application/json' }, signal: abort.signal,
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 8192, stream: false }),
        });
        if (settled) return;
        await assertCredentialCurrent(provider, workspaceId, actor, credential.row);
        if (settled) return;
        if (initialConfig) {
          const parsed = parseApiCompletion(provider, result, credential.token);
          onEvent({ type: 'agent.message', summary: parsed.text.slice(0, 12_000), payload: { text: parsed.text } });
          finish({ status: 'completed', ...parsed, provider, model });
          return;
        }
        if (result?.error) throw failure('provider_error', 'The provider returned an execution error. This request was not retried.', 502);
        const choice = result?.choices?.[0], content = choice?.message?.content;
        const responseText = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('') : '';
        const text = responseText.replaceAll(credential.token, '[redacted authorization]');
        if (!text.trim()) throw failure('model_response', 'The model request completed without a text response.', 502);
        if (text.length > 100_000) throw failure('model_response_too_large', 'The model response exceeded the supported text size.', 502);
        if (choice.finish_reason && choice.finish_reason !== 'stop') throw failure('model_response_incomplete', 'The provider did not return a complete final reply. No actions were extracted.', 502);
        // Usage is raw allowlisted provider evidence, not CLI usage or billing.
        const usage = {};
        for (const name of ['prompt_tokens', 'completion_tokens', 'total_tokens']) if (Number.isSafeInteger(result.usage?.[name]) && result.usage[name] >= 0) usage[name] = result.usage[name];
        onEvent({ type: 'agent.message', summary: text.slice(0, 12_000), payload: { text } });
        finish({ status: 'completed', text, provider, model, ...(Object.keys(usage).length ? { usage: { source: 'chat_completion', ...usage } } : {}) });
      } catch (error) {
        if (settled || timedOut || stopped) return;
        finish({ status: 'failed', text: '', error: error.code ? error.message : 'The provider request could not complete. Delivery may be uncertain; it was not retried.', error_code: error.code || 'provider_unreachable' });
      }
    })();
    return { stop };
  }
  const close = () => {
    if (closed) return;
    closed = true; shutdown.abort(); authorizationClaims.clear();
    for (const jobs of activeRuns.values()) for (const stop of [...jobs]) stop();
    activeRuns.clear(); copilotOAuth.close();
  };
  return { copilotOAuth, close, start, complete, list, check, models, testModel, disconnect, hfStart, hfComplete, hfCheck, hfModels, hfTestModel, hfDisconnect, readyState, startAgentRun, saveApiKey, connectionModels, connectionCheck, connectionTest, connectionDisconnect };
}

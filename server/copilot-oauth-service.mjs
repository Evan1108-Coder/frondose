import { frondoseEnvironment } from './brand-config.mjs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

const stamp = () => new Date().toISOString();
const hash = value => createHash('sha256').update(value).digest('base64url');
const fail = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });
export const COPILOT_CALLBACK = '/api/ai-connections/copilot/callback';
const LOCAL_MARKER = 'provider-owned-local-account';

// GitHub authorization is identity, not evidence of Copilot entitlement. Only
// an explicit successful SDK inference test enables execution.
export function createCopilotOAuthService({ db, env, seal, unseal, requireWorkspace, callbackOrigin, requestJson, onReplace = () => {} }) {
  env = frondoseEnvironment(env);
  const completing = new Map(), refreshing = new Map();
  let closed = false;
  const identity = (workspace, actor) => JSON.stringify([workspace, actor?.id]);
  const read = (workspace, actor) => db.prepare("SELECT * FROM ai_account_connections WHERE workspace_id=? AND actor_id=? AND provider='copilot'").get(workspace, actor.id);
  const isOAuth = row => Boolean(row && row.encrypted_credential !== LOCAL_MARKER);
  function setup() {
    const missing = ['FRONDOSE_GITHUB_CLIENT_ID', 'FRONDOSE_GITHUB_CLIENT_SECRET'].filter(name => typeof env[name] !== 'string' || !env[name].trim());
    return { configured: !missing.length, missing, callback_path: COPILOT_CALLBACK, docs: 'https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth' };
  }
  function client() {
    const description = setup();
    if (!description.configured) throw fail('operator_setup_required', `Configure ${description.missing.join(' and ')} for Frondose’s GitHub App or OAuth App.`);
    if (!/^[A-Za-z0-9_.-]{1,200}$/.test(env.FRONDOSE_GITHUB_CLIENT_ID) || env.FRONDOSE_GITHUB_CLIENT_SECRET.length > 8192) throw fail('operator_setup_required', 'The GitHub app configuration is invalid.');
    return env.FRONDOSE_GITHUB_CLIENT_ID;
  }
  function assertOpen() { if (closed) throw fail('service_closed', 'The provider account service is closed.'); }
  function decoded(row) {
    if (!isOAuth(row)) throw fail('not_connected', 'Authorize your GitHub account for this Frondose workspace first.');
    let value;
    try { value = JSON.parse(unseal(row.id, row.encrypted_credential)); } catch { throw fail('credential_unreadable', 'Reconnect this GitHub account.'); }
    if (value.type !== 'github_oauth' || !/^gh[ou]_[A-Za-z0-9_]+$/.test(value.access_token) || value.access_token.length > 8192 || value.client_id !== client()) throw fail('reconnect_required', 'Reconnect GitHub using the current Frondose app registration.');
    return value;
  }
  function status(workspace, actor) {
    const row = read(workspace, actor);
    if (!isOAuth(row)) return null;
    return { provider: 'copilot', method: 'github_oauth', state: row.state, account_label: row.account_label, checked_at: row.checked_at, model_tested_at: row.model_tested_at };
  }
  async function start({ workspace_id }, actor, host) {
    assertOpen(); await requireWorkspace(workspace_id, actor);
    const clientId = client(), origin = callbackOrigin(host), state = randomBytes(24).toString('base64url'), verifier = randomBytes(48).toString('base64url'), key = hash(state), now = stamp();
    completing.delete(identity(workspace_id, actor));
    db.prepare('DELETE FROM ai_authorization_attempts WHERE expires_at<?').run(now);
    db.prepare("DELETE FROM ai_authorization_attempts WHERE workspace_id=? AND actor_id=? AND provider='copilot'").run(workspace_id, actor.id);
    db.prepare('INSERT INTO ai_authorization_attempts VALUES(?,?,?,?,?,?,?,?)').run(key, workspace_id, actor.id, 'copilot', seal(key, JSON.stringify({ verifier, clientId })), origin, new Date(Date.now() + 600000).toISOString(), now);
    const url = new URL('https://github.com/login/oauth/authorize');
    for (const [name, value] of Object.entries({ client_id: clientId, redirect_uri: `${origin}${COPILOT_CALLBACK}`, state, code_challenge: hash(verifier), code_challenge_method: 'S256', scope: 'read:user offline_access', prompt: 'select_account' })) url.searchParams.set(name, value);
    return { authorization_url: url.href, callback_url: `${origin}${COPILOT_CALLBACK}` };
  }
  async function token(fields) {
    const response = await requestJson('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: client(), client_secret: env.FRONDOSE_GITHUB_CLIENT_SECRET, ...fields }) });
    if (!/^gh[ou]_[A-Za-z0-9_]+$/.test(response.access_token || '') || response.access_token.length > 8192 || response.token_type?.toLowerCase() !== 'bearer') throw fail('oauth_invalid', 'GitHub did not return a usable user authorization. Reconnect.');
    const lifetime = (value, max) => value == null ? null : Number.isSafeInteger(value) && value > 0 && value <= max ? Date.now() + value * 1000 : (() => { throw fail('oauth_invalid', 'GitHub returned an invalid token lifetime.'); })();
    if (response.refresh_token && (!/^ghr_[A-Za-z0-9_]+$/.test(response.refresh_token) || response.refresh_token.length > 8192)) throw fail('oauth_invalid', 'GitHub returned an invalid refresh token.');
    return { type: 'github_oauth', client_id: client(), access_token: response.access_token, refresh_token: response.refresh_token || null, expires_at: lifetime(response.expires_in, 31536000), refresh_expires_at: lifetime(response.refresh_token_expires_in, 63072000) };
  }
  const githubIdentity = accessToken => requestJson('https://api.github.com/user', { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  async function complete(state, code, actor, host, denial) {
    assertOpen();
    if (!actor?.id) throw fail('sign_in_required', 'Sign in to the same Frondose account that started this authorization.', 401);
    if (!/^[A-Za-z0-9_-]{32}$/.test(state || '')) throw fail('oauth_invalid', 'Invalid GitHub authorization state.', 400);
    const key = hash(state), attempt = db.prepare('SELECT * FROM ai_authorization_attempts WHERE state_hash=?').get(key);
    if (!attempt || attempt.provider !== 'copilot' || attempt.actor_id !== actor.id || attempt.expires_at <= stamp() || attempt.callback_origin !== callbackOrigin(host)) throw fail('oauth_expired', 'This GitHub sign-in is expired or belongs to another Frondose session.');
    await requireWorkspace(attempt.workspace_id, actor);
    const claim = db.prepare('DELETE FROM ai_authorization_attempts WHERE state_hash=? AND actor_id=?').run(key, actor.id);
    if (!claim.changes) throw fail('oauth_replayed', 'This GitHub authorization callback was already used.');
    if (denial) throw fail('oauth_denied', 'GitHub authorization was not completed.');
    if (typeof code !== 'string' || !code || code.length > 2048) throw fail('oauth_invalid', 'Invalid GitHub authorization code.', 400);
    const pending = JSON.parse(unseal(key, attempt.encrypted_verifier));
    if (pending.clientId !== client()) throw fail('oauth_expired', 'The GitHub app registration changed. Start sign-in again.');
    const scope = identity(attempt.workspace_id, actor), nonce = randomUUID(); completing.set(scope, nonce);
    try {
      const credential = await token({ code, redirect_uri: `${attempt.callback_origin}${COPILOT_CALLBACK}`, code_verifier: pending.verifier });
      const account = await githubIdentity(credential.access_token);
      if (!Number.isSafeInteger(account.id) || account.id < 1 || typeof account.login !== 'string') throw fail('oauth_invalid', 'GitHub did not confirm the account identity.');
      assertOpen(); await requireWorkspace(attempt.workspace_id, actor);
      if (completing.get(scope) !== nonce) throw fail('oauth_cancelled', 'This sign-in was cancelled or superseded.');
      onReplace(attempt.workspace_id, actor);
      credential.github_id = account.id;
      const id = randomUUID(), now = stamp();
      db.prepare(`INSERT INTO ai_account_connections(id,workspace_id,actor_id,provider,state,encrypted_credential,account_label,checked_at,model_tested_at,created_at,updated_at)
        VALUES(?,?,?,'copilot','configured',?,?,?,NULL,?,?) ON CONFLICT(workspace_id,actor_id,provider) DO UPDATE SET state='configured',encrypted_credential=excluded.encrypted_credential,account_label=excluded.account_label,checked_at=excluded.checked_at,model_tested_at=NULL,updated_at=excluded.updated_at,id=excluded.id`)
        .run(id, attempt.workspace_id, actor.id, seal(id, JSON.stringify(credential)), account.login.slice(0, 120), now, now, now);
      return status(attempt.workspace_id, actor);
    } finally { if (completing.get(scope) === nonce) completing.delete(scope); }
  }
  async function credential(workspace, actor, { allowUnverified = false } = {}) {
    assertOpen(); await requireWorkspace(workspace, actor);
    let row = read(workspace, actor), value = decoded(row);
    if (!allowUnverified && row.state !== 'connected') throw fail('model_test_required', 'Test a Copilot model before sending a conversation.');
    if (value.expires_at && value.expires_at <= Date.now() + 60000) {
      if (!value.refresh_token || value.refresh_expires_at && value.refresh_expires_at <= Date.now()) throw fail('reconnect_required', 'Your GitHub authorization expired. Reconnect.');
      const fingerprint = row.encrypted_credential, refreshKey = hash(fingerprint);
      if (!refreshing.has(refreshKey)) {
        const refreshingToken = (async () => {
          const next = { ...await token({ grant_type: 'refresh_token', refresh_token: value.refresh_token }), github_id: value.github_id };
          assertOpen(); await requireWorkspace(workspace, actor);
          const updated = db.prepare('UPDATE ai_account_connections SET encrypted_credential=?,updated_at=? WHERE id=? AND encrypted_credential=?').run(seal(row.id, JSON.stringify(next)), stamp(), row.id, fingerprint);
          if (!updated.changes) throw fail('connection_changed', 'The GitHub connection changed during refresh.');
        })();
        refreshing.set(refreshKey, refreshingToken); refreshingToken.finally(() => refreshing.delete(refreshKey)).catch(() => {});
      }
      await refreshing.get(refreshKey);
      assertOpen(); await requireWorkspace(workspace, actor); row = read(workspace, actor); value = decoded(row);
    }
    const captured = row.encrypted_credential, capturedId = row.id;
    return { accessToken: value.access_token, accountId: value.github_id, async assertCurrent() {
      assertOpen(); await requireWorkspace(workspace, actor);
      const current = read(workspace, actor);
      if (!current || current.id !== capturedId || current.encrypted_credential !== captured) throw fail('connection_changed', 'This GitHub account was disconnected or replaced.');
    }, async verified() {
      await this.assertCurrent(); const now = stamp();
      db.prepare("UPDATE ai_account_connections SET state='connected',model_tested_at=?,updated_at=? WHERE id=? AND encrypted_credential=?").run(now, now, capturedId, captured);
      return status(workspace, actor);
    } };
  }
  async function check(workspace, actor) {
    const captured = await credential(workspace, actor, { allowUnverified: true });
    const account = await githubIdentity(captured.accessToken); await captured.assertCurrent();
    if (account.id !== captured.accountId) throw fail('account_changed', 'GitHub returned a different account. Reauthorize.');
    return { ...status(workspace, actor), requires_model_test: status(workspace, actor)?.state !== 'connected' };
  }
  async function disconnect(workspace, actor) {
    await requireWorkspace(workspace, actor); completing.delete(identity(workspace, actor));
    db.prepare("DELETE FROM ai_authorization_attempts WHERE workspace_id=? AND actor_id=? AND provider='copilot'").run(workspace, actor.id);
    onReplace(workspace, actor);
    db.prepare("DELETE FROM ai_account_connections WHERE workspace_id=? AND actor_id=? AND provider='copilot'").run(workspace, actor.id);
    return { disconnected: true, remote_access_revoked: false };
  }
  return { setup, start, complete, status, credential, check, disconnect, close() { closed = true; completing.clear(); } };
}

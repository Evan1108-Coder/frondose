import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, renameSync, chmodSync, statSync, realpathSync } from 'node:fs';
import { join, isAbsolute, parse as parsePath, relative } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';
import { providerSetup, listProviderSetups, providerCatalog } from './provider-adapters.mjs';

const execFileAsync = promisify(execFile);
const now = () => new Date().toISOString();
const error = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const known = (provider) => { if (!providerCatalog()[provider]) throw error('unknown_provider', 'Unknown connection.', 404); };
const redact = (value) => String(value || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+|ya29\.[A-Za-z0-9_-]+)/g, '[redacted]').slice(0, 12_000);
const parse = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };

// Commands use argument arrays, never shell interpolation. Opening the app starts no process.
async function execute(command, args, options = {}) {
  try { return { ...await execFileAsync(command, args, { timeout: 15_000, maxBuffer: 1_000_000, ...options }), code: 0 }; }
  catch (failure) {
    if (failure.code === 'ENOENT') throw error('not_installed', `${command} is not installed or is not available to the server.`, 409);
    if (failure.killed) throw error('provider_timeout', 'The provider did not respond in time. Try again.', 504);
    return { stdout: failure.stdout || '', stderr: failure.stderr || '', code: Number(failure.code) || 1 };
  }
}

export function createIntegrationService({ dataDir, env = process.env, execute: runCommand = execute, spawnProcess = spawn, fetchImpl = fetch, onConnectionChange = () => {} } = {}) {
  if (!dataDir) throw new Error('Integration storage directory is required.');
  const secretPath = join(dataDir, 'integrations.private.json');
  let saved = {};
  try { saved = JSON.parse(readFileSync(secretPath, 'utf8')); }
  catch (failure) { if (failure.code !== 'ENOENT') throw error('credentials_unreadable', 'The connection file cannot be read. Restore it from a backup before reconnecting.', 500); }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw error('credentials_unreadable', 'The connection file has an invalid format.', 500);
  // A browser login cannot survive a local server restart. Do not show an endless spinner.
  for (const value of Object.values(saved)) if (value?.state === 'connecting') value.state = 'not_connected';
  const authProcesses = new Map(), liveProcesses = new Set(), liveControllers = new Map(), oauthStates = new Map();
  let closed = false;
  const knownSecrets = new Set(Object.entries(env).filter(([name]) => /(?:TOKEN|SECRET|API_KEY|PASSWORD)$/i.test(name)).map(([, value]) => value));
  function rememberSecrets(item) { for (const value of [item?.token, item?.accessToken, item?.refreshToken]) if (value) knownSecrets.add(value); }
  Object.values(saved).forEach(rememberSecrets);
  // Do not allow a provider's output to echo credentials into persisted chat or events.
  function scrubString(value, limit = 100_000) {
    let result = String(value || '');
    for (const secret of knownSecrets) if (typeof secret === 'string' && secret.length >= 8) result = result.split(secret).join('[redacted]');
    return result.replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+|ya29\.[A-Za-z0-9_-]+)/g, '[redacted]').slice(0, limit);
  }
  function scrubPayload(value, depth = 0) {
    if (depth > 8) return '[truncated]';
    if (typeof value === 'string') return scrubString(value);
    if (Array.isArray(value)) return value.slice(0, 1000).map((item) => scrubPayload(item, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, /^(?:token|access_token|refresh_token|api_key|authorization|client_secret)$/i.test(key) ? '[redacted]' : scrubPayload(item, depth + 1)]));
    return value;
  }
  const commandEnv = (provider) => {
    const result = { ...env, NO_COLOR: '1', FORCE_COLOR: '0', GH_PROMPT_DISABLED: '1' };
    if (provider !== 'github') { delete result.GH_TOKEN; delete result.GITHUB_TOKEN; }
    if (provider !== 'codex') { delete result.OPENAI_API_KEY; delete result.CODEX_API_KEY; }
    if (provider !== 'claude') { delete result.ANTHROPIC_API_KEY; delete result.CLAUDE_CODE_OAUTH_TOKEN; }
    delete result.RUMBO_GOOGLE_CLIENT_ID; delete result.RUMBO_GOOGLE_CLIENT_SECRET;
    return result;
  };
  function persist() {
    mkdirSync(dataDir, { recursive: true });
    const temp = `${secretPath}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(temp, JSON.stringify(saved), { mode: 0o600, flag: 'wx' });
    renameSync(temp, secretPath); chmodSync(secretPath, 0o600);
  }
  function status(provider) {
    known(provider);
    const value = saved[provider] || {}, auth = authProcesses.get(provider);
    return { provider, state: value.state || 'not_connected', method: value.method || null, accountLabel: value.accountLabel || null, checkedAt: value.checkedAt || null, liveAccountChecked: Boolean(value.checkedAt), ...(auth ? { auth: { status: auth.status, output: scrubString(redact(auth.output), 12_000), startedAt: auth.startedAt } } : {}) };
  }
  function update(provider, values) {
    rememberSecrets(values);
    saved[provider] = { ...saved[provider], ...values }; persist();
    const connection = status(provider);
    onConnectionChange(provider, { state: connection.state, mode: 'local', metadata: connection, last_probed_at: connection.checkedAt, updated_at: now() });
    return connection;
  }
  const setup = (provider, options = {}) => ({ ...providerSetup(provider, { env, ...options }), connection: status(provider) });
  const listSetups = (options = {}) => listProviderSetups({ env, ...options }).map((item) => ({ ...item, connection: status(item.provider) }));
  async function requestJson(url, options = {}) {
    let response;
    try { response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15_000) }); }
    catch { throw error('provider_unreachable', 'Cannot reach the provider. Check your connection and try again.', 502); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const unauthorized = response.status === 401 || response.status === 403;
      throw error(unauthorized ? 'provider_permission' : 'provider_error', unauthorized ? 'The provider rejected access. Check your account permissions or reconnect.' : `The provider returned an error (${response.status}). Try again later.`, unauthorized ? 403 : 502);
    }
    return payload;
  }
  const githubRequest = (path, token) => requestJson(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  async function inspectAuth(provider, { method } = {}) {
    known(provider);
    if (provider === 'google-drive') {
      if (!saved[provider]?.refreshToken && !saved[provider]?.accessToken) return update(provider, { state: 'not_connected', checkedAt: now() });
      const accessToken = await driveToken();
      const profile = await requestJson('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', { headers: { Authorization: `Bearer ${accessToken}` } });
      return update(provider, { state: 'connected', accountLabel: profile.user?.emailAddress || profile.user?.displayName || 'Google Drive account', checkedAt: now() });
    }
    if (provider === 'github' && saved.github?.token && method !== 'existing') {
      const account = await githubRequest('/user', saved.github.token);
      return update(provider, { state: 'connected', method: 'token', accountLabel: account.login, checkedAt: now() });
    }
    const args = provider === 'codex' ? ['login', 'status'] : provider === 'claude' ? ['auth', 'status'] : ['api', 'user'];
    const result = await runCommand(provider === 'github' ? 'gh' : provider, args, { env: commandEnv(provider) });
    const account = parse(result.stdout);
    const connected = result.code === 0 && (provider !== 'claude' || account.loggedIn !== false);
    return update(provider, { state: connected ? 'connected' : 'not_connected', method: 'existing', token: undefined, accountLabel: connected ? (account.login || account.email || `${providerCatalog()[provider].displayName} CLI account`) : null, checkedAt: now() });
  }
  async function authStatus(provider, options) {
    known(provider);
    try { return await inspectAuth(provider, options); }
    catch (failure) { if (!closed) update(provider, { state: 'not_connected', accountLabel: null, checkedAt: now() }); throw failure; }
  }
  async function connect(provider, { method = 'existing', token, origin = 'http://127.0.0.1:4174' } = {}) {
    known(provider);
    if (closed) throw error('service_closed', 'Connections service is closed.', 503);
    if (!providerCatalog()[provider].methods.includes(method)) throw error('unsupported_method', 'Choose a supported connection method.');
    if (method === 'token') {
      if (typeof token !== 'string' || !token.trim() || token.length > 4096) throw error('invalid_token', 'Enter a valid GitHub access token.');
      const account = await githubRequest('/user', token.trim());
      return { connection: update(provider, { state: 'connected', method, token: token.trim(), accountLabel: account.login, checkedAt: now() }) };
    }
    if (provider === 'google-drive') return beginGoogleAuth(origin);
    if (method === 'existing') return { connection: await authStatus(provider, { method }) };
    if (authProcesses.get(provider)?.status === 'running') return { connection: status(provider) };
    const args = provider === 'codex' ? ['login'] : provider === 'claude' ? ['auth', 'login'] : ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key'];
    const child = spawnProcess(provider === 'github' ? 'gh' : provider, args, { env: commandEnv(provider), stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const auth = { child, status: 'running', output: '', startedAt: now() }; authProcesses.set(provider, auth);
    child.stdin?.on('error', () => {});
    child.stdin?.end(provider === 'github' ? '\n' : undefined);
    const capture = (chunk) => { auth.output = scrubString(redact(auth.output + chunk.toString()), 12_000); };
    child.stdout?.on('data', capture); child.stderr?.on('data', capture);
    const timeout = setTimeout(() => { auth.status = 'expired'; child.kill('SIGTERM'); if (!closed) update(provider, { state: 'not_connected' }); }, 5 * 60_000); timeout.unref?.();
    child.on('error', (failure) => { clearTimeout(timeout); auth.status = 'failed'; auth.output = failure.code === 'ENOENT' ? `${providerCatalog()[provider].displayName} CLI is not installed. Install it, then retry.` : 'Could not start sign-in. Try again.'; if (!closed) update(provider, { state: 'not_connected' }); });
    child.on('close', async (code) => {
      clearTimeout(timeout); if (auth.status !== 'running' || closed) return;
      auth.status = code === 0 ? 'complete' : 'failed';
      if (code === 0) { try { await authStatus(provider); } catch (failure) { auth.output = failure.message; auth.status = 'failed'; update(provider, { state: 'not_connected' }); } }
      else update(provider, { state: 'not_connected' });
    });
    return { connection: update(provider, { state: 'connecting', method: 'existing', token: undefined }), message: 'Complete sign-in in the provider window. Rumbo updates when sign-in finishes.' };
  }
  function beginGoogleAuth(origin) {
    const descriptor = providerSetup('google-drive', { env, origin });
    if (!descriptor.configured) throw error('configuration_required', descriptor.startReason, 409);
    const callback = new URL(descriptor.callbackUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(callback.hostname) || callback.protocol !== 'http:') throw error('invalid_callback', 'OAuth callback must be a loopback HTTP address.');
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    for (const [key, item] of oauthStates) if (item.expires < Date.now()) oauthStates.delete(key);
    oauthStates.set(state, { verifier, callbackUrl: descriptor.callbackUrl, expires: Date.now() + 10 * 60_000 });
    const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorization.search = new URLSearchParams({ client_id: env.RUMBO_GOOGLE_CLIENT_ID, redirect_uri: descriptor.callbackUrl, response_type: 'code', scope: descriptor.scopes.join(' '), state, access_type: 'offline', prompt: 'consent', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    return { authorizationUrl: authorization.href, connection: update('google-drive', { state: 'connecting', method: 'browser' }) };
  }
  async function completeGoogleAuth({ code, state, origin }) {
    const pending = oauthStates.get(state); oauthStates.delete(state);
    if (!pending || pending.expires < Date.now() || pending.callbackUrl !== new URL('/api/auth/google-drive/callback', origin).href) throw error('invalid_oauth_state', 'This sign-in link expired or is invalid. Start again from Connections.');
    if (typeof code !== 'string' || !code) { update('google-drive', { state: 'not_connected' }); throw error('oauth_denied', 'Google sign-in was not completed. Try again from Connections.'); }
    const tokens = await requestJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.RUMBO_GOOGLE_CLIENT_ID, client_secret: env.RUMBO_GOOGLE_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: pending.callbackUrl, code_verifier: pending.verifier }).toString() });
    if (!tokens.access_token) throw error('invalid_provider_response', 'Google did not return an access token.', 502);
    return update('google-drive', { state: 'connected', method: 'browser', accessToken: tokens.access_token, refreshToken: tokens.refresh_token || saved['google-drive']?.refreshToken, expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000, accountLabel: 'Google Drive account', checkedAt: now() });
  }
  async function driveToken() {
    const credentials = saved['google-drive'];
    if (!credentials?.accessToken) throw error('not_connected', 'Connect Google Drive first.', 409);
    if (credentials.expiresAt > Date.now() + 60_000) return credentials.accessToken;
    if (!credentials.refreshToken) throw error('session_expired', 'Google sign-in expired. Reconnect Google Drive.', 409);
    const tokens = await requestJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.RUMBO_GOOGLE_CLIENT_ID, client_secret: env.RUMBO_GOOGLE_CLIENT_SECRET, refresh_token: credentials.refreshToken, grant_type: 'refresh_token' }).toString() });
    if (!tokens.access_token) throw error('session_expired', 'Google sign-in expired. Reconnect Google Drive.', 409);
    update('google-drive', { accessToken: tokens.access_token, expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 }); return tokens.access_token;
  }
  async function resources(provider, { pageToken = '' } = {}) {
    known(provider);
    if (status(provider).state !== 'connected') throw error('not_connected', 'Connect this provider before browsing resources.', 409);
    if (provider === 'github') {
      const page = /^\d{1,4}$/.test(pageToken) ? Number(pageToken) : 1, path = `/user/repos?per_page=50&sort=updated&page=${page}`;
      let repos;
      if (saved.github.token) repos = await githubRequest(path, saved.github.token);
      else { const result = await runCommand('gh', ['api', path], { env: commandEnv('github') }); if (result.code !== 0) throw error('provider_error', 'GitHub could not list repositories. Check your permissions or reconnect.', 502); repos = parse(result.stdout, []); }
      if (!Array.isArray(repos)) throw error('invalid_provider_response', 'GitHub returned an unexpected response.', 502);
      return { resources: repos.map((repo) => ({ id: String(repo.id), name: repo.full_name, url: repo.html_url, description: repo.description || '', private: Boolean(repo.private), updatedAt: repo.updated_at, kind: 'repository' })), nextPageToken: repos.length === 50 ? String(page + 1) : null };
    }
    if (provider === 'google-drive') {
      const token = await driveToken(), params = new URLSearchParams({ pageSize: '50', fields: 'files(id,name,mimeType,webViewLink,modifiedTime),nextPageToken', q: 'trashed = false', orderBy: 'modifiedTime desc' });
      if (pageToken) params.set('pageToken', pageToken.slice(0, 2000));
      const response = await requestJson(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      return { resources: (response.files || []).map((file) => ({ id: file.id, name: file.name, url: file.webViewLink, mimeType: file.mimeType, updatedAt: file.modifiedTime, kind: 'file' })), nextPageToken: response.nextPageToken || null };
    }
    throw error('unsupported_operation', 'This connection runs agents rather than listing files.');
  }
  function disconnect(provider) {
    known(provider);
    const auth = authProcesses.get(provider);
    if (auth) { auth.status = 'cancelled'; auth.child.kill('SIGTERM'); authProcesses.delete(provider); }
    if (provider === 'google-drive') oauthStates.clear();
    delete saved[provider]; return update(provider, { state: 'not_connected', method: null, accountLabel: null, checkedAt: null });
  }

  async function startRun(request, callbacks = {}) {
    const workMode = request.workMode ?? 'project';
    if (!['conversation', 'project'].includes(workMode)) throw error('invalid_work_mode', 'Choose general chat or project work.');
    if (workMode !== 'conversation') return startRunInDirectory(request, callbacks);
    if ((request.permissionMode ?? 'read-only') !== 'read-only' || request.cwd || request.allowedRoot) throw error('invalid_permissions', 'General chat does not use a project folder or editing permissions.');
    // CLIs still need an OS working directory. Never substitute the user's home,
    // Rumbo's code checkout, or .rumbo (which contains credentials and records).
    const scratch = mkdtempSync(join(tmpdir(), 'rumbo-conversation-'));
    let cleaned = false;
    const cleanup = () => { if (!cleaned) { cleaned = true; rmSync(scratch, { recursive: true, force: true }); } };
    try {
      return await startRunInDirectory({ ...request, cwd: scratch, workMode }, {
        ...callbacks,
        onComplete: (result) => { cleanup(); callbacks.onComplete?.(result); },
      });
    } catch (failure) { cleanup(); throw failure; }
  }

  async function startRunInDirectory({ provider, prompt, cwd, allowedRoot, signal, permissionMode = 'read-only', workMode = 'project' }, { onEvent = () => {}, onComplete = () => {} } = {}) {
    if (signal?.aborted) throw error('session_cancelled', 'The session was cancelled before it started.', 409);
    if (!['codex', 'claude'].includes(provider)) throw error('unsupported_provider', 'Choose Codex or Claude for agent work.');
    if (closed) throw error('service_closed', 'Agent service is closed.', 503);
    if (status(provider).state !== 'connected') throw error('not_connected', `Connect ${providerCatalog()[provider].displayName} first.`, 409);
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100_000) throw error('invalid_prompt', 'Write an instruction between 1 and 100,000 characters.');
    if (!cwd || !isAbsolute(cwd)) throw error('invalid_directory', 'Link an absolute project folder before starting work.');
    try { cwd = realpathSync(cwd); if (!statSync(cwd).isDirectory()) throw new Error(); } catch { throw error('invalid_directory', 'The linked project folder does not exist.'); }
    if ([parsePath(cwd).root, homedir(), '/Users', '/System', '/Library', '/Applications', '/usr', '/etc', '/private', '/var'].includes(cwd)) throw error('unsafe_directory', 'Choose a specific project folder, not your home folder or a system directory.');
    if (allowedRoot) {
      let root; try { root = realpathSync(allowedRoot); } catch { throw error('invalid_directory', 'The permitted project root does not exist.'); }
      const fromRoot = relative(root, cwd);
      if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) throw error('directory_outside_project', 'The working folder must stay inside the selected project.');
    }
    if (!['read-only', 'workspace-write'].includes(permissionMode)) throw error('invalid_permissions', 'Choose analysis or project editing permissions.');
    if (provider === 'claude' && permissionMode !== 'read-only') throw error('unsupported_permissions', 'Claude currently supports analysis only. Use Codex for edits inside the project folder.');
    const codexOverrides = ['approval_policy="never"', 'features.hooks=false', 'features.apps=false', 'features.remote_plugin=false', 'features.multi_agent=false', 'sandbox_workspace_write.writable_roots=[]', 'sandbox_workspace_write.network_access=false', 'sandbox_workspace_write.exclude_tmpdir_env_var=true', 'sandbox_workspace_write.exclude_slash_tmp=true', 'shell_environment_policy.ignore_default_excludes=false'].flatMap((value) => ['-c', value]);
    if (workMode === 'conversation') codexOverrides.push(...[
      'features.shell_tool=false', 'features.unified_exec=false', 'features.shell_snapshot=false',
      'features.code_mode.enabled=false', 'features.code_mode_host=false',
      'features.browser_use=false', 'features.computer_use=false', 'features.plugins=false',
      'features.memories=false', 'features.goals=false', 'features.image_generation=false',
      'tools.view_image=false', 'web_search="disabled"', 'project_doc_max_bytes=0',
    ].flatMap((value) => ['-c', value]));
    if (provider === 'codex') {
      // List configuration only; no servers or paid session are started by this command.
      // Disable each inherited MCP server explicitly because empty tables can merge with lower layers.
      const check = await runCommand('codex', [...codexOverrides, 'mcp', 'list', '--json'], { cwd, env: commandEnv(provider) });
      const servers = parse(check.stdout, null);
      if (check.code !== 0 || !Array.isArray(servers)) throw error('provider_configuration', 'Rumbo could not verify the Codex tool configuration. Update Codex CLI and try again.', 409);
      for (const server of servers) {
        if (typeof server.name !== 'string' || server.name.length > 200 || /[\u0000-\u001f]/.test(server.name)) throw error('provider_configuration', 'A Codex tool server has an unsupported name. Rename it before running through Rumbo.', 409);
        // General chat ignores user config. An enabled-only override would
        // recreate an invalid transportless entry. Supply a valid, disabled
        // stdio definition instead, so even names discovered in system config
        // remain disabled. No transport process is allowed to start.
        codexOverrides.push('-c', workMode === 'conversation'
          ? `mcp_servers.${JSON.stringify(server.name)}={enabled=false,command="false"}`
          : `mcp_servers.${JSON.stringify(server.name)}.enabled=false`);
      }
    }
    const args = provider === 'codex'
      ? ['exec', '--json', '--color', 'never', '--sandbox', permissionMode, '--skip-git-repo-check', ...(workMode === 'conversation' ? ['--ignore-user-config', '--ignore-rules', '--ephemeral'] : []), ...codexOverrides, '-']
      : ['-p', '--bare', '--restricted', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk', '--tools', workMode === 'conversation' ? '' : 'Read,Glob,Grep', '--disallowedTools', workMode === 'conversation' ? '*' : 'mcp__*', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--max-turns', '12'];
    if (signal?.aborted) throw error('session_cancelled', 'The session was cancelled before it started.', 409);
    if (closed || status(provider).state !== 'connected') throw error('not_connected', 'This connection was closed while the session was starting. Reconnect and try again.', 409);
    const child = spawnProcess(provider, args, { cwd, env: commandEnv(provider), stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32' });
    liveProcesses.add(child);
    let buffer = '', stderr = '', text = '', settled = false, stopped = false, providerError = '', eventCount = 0, timeout;
    const decoder = new StringDecoder('utf8');
    const appendText = (value) => { text = `${text}${scrubString(value)}\n`.slice(-100_000); };
    const emit = (type, summary, payload = {}) => { if (!stopped && !settled && eventCount++ < 5000) onEvent({ type, summary: scrubString(redact(summary), 12_000), payload: scrubPayload(payload) }); };
    const finish = (runStatus, failure) => { if (settled) return; settled = true; clearTimeout(timeout); liveProcesses.delete(child); liveControllers.delete(child); onComplete({ status: runStatus, text: scrubString(text.slice(-100_000)), ...(failure ? { error: scrubString(redact(failure), 12_000) } : {}) }); };
    const stop = () => {
      if (settled || stopped) return; stopped = true;
      try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { child.kill('SIGTERM'); }
      const kill = setTimeout(() => { if (!settled) { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} finish(providerError ? 'failed' : 'stopped', providerError); } }, 3000); kill.unref?.();
    };
    liveControllers.set(child, stop);
    function consume(line) {
      if (stopped || settled) return;
      const event = parse(line, null);
      if (!event) { if (line.trim()) emit('provider.output', line); return; }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        const progress = event.item.phase === 'commentary';
        if (!progress) appendText(event.item.text || '');
        emit(progress ? 'agent.progress' : 'agent.message', event.item.text || '', { text: (event.item.text || '').slice(-100_000) });
      }
      else if (event.type === 'assistant') { for (const block of event.message?.content || []) if (block.type === 'text') { appendText(block.text); emit('agent.message', block.text, { text: (block.text || '').slice(-100_000) }); } }
      else if (event.type === 'result') { if (event.result) text = scrubString(String(event.result).slice(-100_000)); if (event.is_error) providerError = (Array.isArray(event.errors) ? event.errors : []).join('\n') || event.result || 'Claude could not complete this run.'; }
      else if (event.type === 'turn.failed' || event.type === 'error') { providerError = event.error?.message || event.message || (typeof event.error === 'string' ? event.error : '') || 'The provider could not complete this run.'; emit('provider.error', providerError); }
      else if (event.item?.type === 'command_execution') emit('command.output', event.item.command || 'Command', { command: redact(event.item.command), output: redact(event.item.aggregated_output), exitCode: event.item.exit_code });
      else if (event.item?.type === 'file_change') emit('files.changed', 'Project files changed', { changes: event.item.changes || [] });
      else if (event.type === 'thread.started' || event.type === 'system') emit('provider.ready', 'Agent session ready');
      else if (event.type === 'turn.completed') emit('provider.usage', 'Agent turn finished', { usage: event.usage || {} });
    }
    child.stdout?.on('data', (chunk) => { if (stopped || settled) return; buffer += decoder.write(chunk); if (buffer.length > 2_000_000) { providerError = 'Provider output exceeded the capture limit.'; stop(); return; } const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) consume(line); });
    child.stderr?.on('data', (chunk) => { if (!stopped && !settled) stderr = scrubString(redact(stderr + chunk.toString()), 12_000); });
    child.on('error', (failure) => finish(stopped ? 'stopped' : 'failed', stopped ? undefined : failure.code === 'ENOENT' ? `${provider} CLI is not installed or not on the server PATH.` : 'The agent process could not start.'));
    child.on('close', (code) => {
      buffer += decoder.end(); if (buffer && buffer.length < 2_000_000) consume(buffer);
      if (workMode === 'conversation' && !stopped && code === 0 && !providerError && !text.trim()) providerError = 'The provider finished without a text reply. Your message is saved. Retry the reply or review the session details.';
      finish(stopped ? (providerError ? 'failed' : 'stopped') : code === 0 && !providerError ? 'completed' : 'failed', providerError || (code !== 0 && !stopped ? stderr || `Agent exited with code ${code}.` : undefined));
    });
    timeout = setTimeout(() => { providerError = 'The run reached the 30-minute limit. Start a follow-up to continue.'; stop(); }, 30 * 60_000); timeout.unref?.();
    child.stdin?.on('error', () => {}); child.stdin?.end(prompt);
    emit('run.started', `${providerCatalog()[provider].displayName} started`, { permissionMode, cwd: workMode === 'conversation' ? null : cwd, workMode, liveAccountContacted: true });
    return { stop };
  }

  async function handle(req, res, { path, url }) {
    const match = path.match(/^\/connections\/(github|google-drive|codex|claude)\/(connect|status|check|disconnect|resources|setup)$/), callback = path === '/auth/google-drive/callback';
    if (!match && !callback && path !== '/connections/setup') return false;
    const respond = (code, data) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data)); };
    const origin = `http://${req.headers.host}`;
    try {
      if (callback && req.method === 'GET') { await completeGoogleAuth({ code: url.searchParams.get('code'), state: url.searchParams.get('state'), origin }); res.statusCode = 303; res.setHeader('Location', '/?connection=google-drive'); res.setHeader('Cache-Control', 'no-store'); res.end(); return true; }
      if (path === '/connections/setup' && req.method === 'GET') { respond(200, { setups: listSetups({ origin }), accountSafe: true }); return true; }
      if (!match) { respond(405, { error: { code: 'method_not_allowed', message: 'Unsupported request method.' } }); return true; }
      const [, provider, action] = match;
      if (req.method === 'GET' && action === 'setup') respond(200, { setup: setup(provider, { origin }), accountSafe: true });
      else if (req.method === 'GET' && action === 'status') respond(200, { connection: status(provider) });
      else if (req.method === 'GET' && action === 'resources') respond(200, await resources(provider, { pageToken: url.searchParams.get('pageToken') || '' }));
      else if (req.method === 'POST' && action === 'check') respond(200, { connection: await authStatus(provider) });
      else if (req.method === 'POST' && action === 'disconnect') respond(200, { connection: disconnect(provider), message: 'Disconnected from Rumbo. CLI sign-in remains available in your other applications.' });
      else if (req.method === 'POST' && action === 'connect') {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16_000) throw error('body_too_large', 'Connection request is too large.', 413); }
        let body; try { body = JSON.parse(raw || '{}'); } catch { throw error('invalid_json', 'Request must contain valid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw error('invalid_body', 'Connection request must contain an object.');
        respond(200, await connect(provider, { ...body, origin }));
      } else respond(405, { error: { code: 'method_not_allowed', message: 'Unsupported request method.' } });
    } catch (failure) { respond(failure.statusCode || 500, { error: { code: failure.code || 'integration_error', message: redact(failure.message) } }); }
    return true;
  }
  function close() { closed = true; for (const auth of authProcesses.values()) auth.child.kill('SIGTERM'); for (const stop of liveControllers.values()) stop(); oauthStates.clear(); }
  return { setup, listSetups, status, connect, authStatus, disconnect, resources, completeGoogleAuth, startRun, handle, close };
}

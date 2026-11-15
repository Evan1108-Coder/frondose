import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { resolveRunnerExecutable } from './runner-process.mjs';
import { terminalDiscoveryEnvironment } from './terminal-install-discovery.mjs';
import { githubRepositoryFromRemote } from '../src/lib/local-git.js';
import { createRepositoryWork } from './repository-work.mjs';
import { directoryRelativePath } from './directory-workspace.mjs';

const exec = promisify(execFile);
const MAX_RECORD_BYTES = 128_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const problem = (message, code = 'local_git_error', statusCode = 400) => Object.assign(new Error(message), { code, errorCode: code, statusCode });
const conflict = message => problem(message, 'local_git_conflict', 409);
const inside = (root, target) => { const part = relative(root, target); return part === '' || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part); };
const safeText = (value, max = 200) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';

function cleanEnvironment(env) {
  const next = { ...env };
  // A selected directory, inherited GIT_DIR or injected config cannot redirect
  // these operations into another repository. The owner's normal Git/gh login
  // remains owned by their installed tools; no token is copied into Frondose.
  for (const key of Object.keys(next)) if (/^GIT_/i.test(key)) delete next[key];
  return { ...next, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GH_PROMPT_DISABLED: '1', NO_COLOR: '1', CLICOLOR: '0' };
}

function validRecord(value) {
  return value && value.owner === 'local-owner' && typeof value.workspaceId === 'string' && value.workspaceId.length < 160 && typeof value.projectId === 'string' && typeof value.root === 'string' && typeof value.rootIdentity === 'string' && typeof value.rootVersion === 'string' && (value.consentId === undefined || typeof value.consentId === 'string' && /^[a-f0-9-]{36}$/.test(value.consentId)) && githubRepositoryFromRemote(value.repositoryUrl)?.slug === value.slug;
}

/** Installation-private consent metadata. No credentials, schema migration or
 * portable export authority. A changed directory/remote requires consent again. */
function privateConnections(dataDir) {
  let queue = Promise.resolve();
  async function location() { return join(await realpath(resolve(dataDir)), 'local-git-connections.json'); }
  async function load() {
    const file = await location(); let handle;
    try {
      const visible = await lstat(file, { bigint: true });
      if (visible.isSymbolicLink()) throw problem('The local Git connection record must not be a symbolic link.', 'local_git_storage', 409);
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const info = await handle.stat({ bigint: true });
      if (!info.isFile() || info.nlink !== 1n || info.size > BigInt(MAX_RECORD_BYTES) || visible.dev !== info.dev || visible.ino !== info.ino
        || process.platform !== 'win32' && ((info.mode & 0o077n) !== 0n || typeof process.getuid === 'function' && info.uid !== BigInt(process.getuid()))) throw problem('The local Git connection record is unsafe or unavailable.', 'local_git_storage', 409);
      const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1); let offset = 0;
      while (offset < bytes.length) { const result = await handle.read(bytes, offset, bytes.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
      const after = await handle.stat({ bigint: true }), again = await lstat(file, { bigint: true });
      if (offset > MAX_RECORD_BYTES || BigInt(offset) !== info.size || info.size !== after.size || info.mtimeNs !== after.mtimeNs || info.ctimeNs !== after.ctimeNs || again.isSymbolicLink() || again.dev !== after.dev || again.ino !== after.ino) throw problem('The local Git connection record changed while it was being read.', 'local_git_storage', 409);
      const value = JSON.parse(bytes.subarray(0, offset).toString('utf8'));
      if (value.version !== 1 || !Array.isArray(value.records) || value.records.length > 256 || value.records.some(row => !validRecord(row))) throw problem('The local Git connection record is invalid.', 'local_git_storage', 409);
      return value.records;
    } catch (error) { if (error.code === 'ENOENT') return []; if (error.statusCode) throw error; throw problem('The local Git connection record cannot be read safely.', 'local_git_storage', 409); }
    finally { await handle?.close(); }
  }
  function update(workspaceId, record) {
    const task = queue.catch(() => {}).then(async () => {
      const records = (await load()).filter(row => row.workspaceId !== workspaceId);
      if (record) records.push(record);
      if (records.length > 256) throw problem('Too many local repository connections. Disconnect an unused workspace first.');
      const content = JSON.stringify({ version: 1, records }) + '\n';
      if (Buffer.byteLength(content) > MAX_RECORD_BYTES) throw problem('Local repository connection metadata is full. Disconnect an unused workspace first.');
      const file = await location(), temporary = `${file}.${randomUUID()}.tmp`; let handle;
      try {
        handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
        await handle.writeFile(content); await handle.sync(); await handle.close(); handle = null;
        await rename(temporary, file);
      } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    });
    queue = task; return task;
  }
  return { load, update };
}

export function createLocalGitService({ db, dataDir, roots, env = process.env, platform = process.platform, activeSessionsFor = () => [], runCommand, recordActivity = () => {} } = {}) {
  const connections = privateConnections(dataDir), mutations = new Set(), mutatingRoots = new Set(), mutatingPaths = new Set();
  let environment;
  const binaries = new Map();
  async function command(tool, args, cwd) {
    if (runCommand) {
      try { return await runCommand({ tool, args, cwd }); }
      catch (error) {
        // Test/native-host adapters may return raw execFile rejections. Treat
        // numeric exit statuses like the production runner below, so optional
        // Git probes (e.g. no upstream) keep their normal fallback semantics.
        if (typeof error?.code !== 'number') throw error;
        throw Object.assign(new Error(`${tool === 'git' ? 'Git' : 'GitHub'} command did not complete.`), { exitCode: error.code, tool, commandFailed: true, stdout: error.stdout || '', stderr: error.stderr || '' });
      }
    }
    environment ||= terminalDiscoveryEnvironment({ platform, env }).then(cleanEnvironment);
    const childEnv = await environment;
    if (!binaries.has(tool)) binaries.set(tool, resolveRunnerExecutable(platform === 'win32' ? `${tool}.exe` : tool, { platform, env: childEnv }));
    const binary = await binaries.get(tool);
    if (!binary || binary.kind !== 'native' || inside(cwd, await realpath(binary.path))) { binaries.delete(tool); throw problem(`${tool === 'git' ? 'Git' : 'GitHub CLI'} is not installed in a trusted system location.`, tool === 'git' ? 'git_not_installed' : 'gh_not_installed', 409); }
    try {
      const output = await exec(binary.path, args, { cwd, env: childEnv, encoding: 'utf8', timeout: 10_000, maxBuffer: 512_000, shell: false, windowsHide: true });
      return output.stdout;
    } catch (error) {
      throw Object.assign(new Error(`${tool === 'git' ? 'Git' : 'GitHub'} command did not complete.`), { exitCode: error.code, tool, commandFailed: true, stdout: error.stdout || '', stderr: error.stderr || '' });
    }
  }
  const git = (context, args) => command('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'alias.switch=', '-c', `core.hooksPath=${join(resolve(dataDir), 'git-hooks-disabled')}`, '-C', context.root, ...args], context.root);
  async function optionalGit(context, args, fallback = '') { try { return await git(context, args); } catch (error) { if (error.commandFailed) return fallback; throw error; } }
  function tableExists(name) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
  function active(workspaceId) {
    const binding = roots.binding(workspaceId);
    const related = binding ? db.prepare('SELECT DISTINCT workspace_id FROM projects WHERE local_path=?').all(binding.path).map(row => row.workspace_id) : [];
    return [...new Set([workspaceId, ...related])].some(id => activeSessionsFor(id)?.length > 0
      || tableExists('runs') && Boolean(db.prepare("SELECT 1 FROM runs WHERE workspace_id=? AND status IN ('queued','starting','running','needs_input','paused') LIMIT 1").get(id))
      || tableExists('workbench_terminals') && Boolean(db.prepare("SELECT 1 FROM workbench_terminals WHERE workspace_id=? AND status IN ('running','stopping') LIMIT 1").get(id)));
  }
  function assertNoMutation(workspaceId) {
    if (mutations.has(workspaceId) || mutatingRoots.has(roots.binding(workspaceId)?.root_identity)
      || db.prepare('SELECT local_path FROM projects WHERE workspace_id=?').all(workspaceId).some(row => mutatingPaths.has(row.local_path))) throw conflict('Wait for the branch change before starting a terminal.');
  }
  async function inspect(workspaceId, actor) {
    const directory = await roots.get(workspaceId, actor);
    if (!directory.binding) return { workspaceId, bound: false, isRepository: false, github: null, connected: false, branches: [], reason: 'directory_not_bound' };
    const context = await roots.rootFor(workspaceId, actor);
    const base = { workspaceId, bound: true, directory: context.root, projectName: safeText(context.project.name), bindingVersion: context.row.version, isRepository: false, connected: false, github: null, branches: [] };
    try {
      const metadata = await lstat(join(context.root, '.git'));
      if (metadata.isSymbolicLink() || !metadata.isDirectory() && (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > 4096)) throw problem('This Git metadata is linked or unsafe. Open the repository directly instead.', 'unsafe_git_metadata', 409);
    } catch (error) { if (error.code === 'ENOENT') return { ...base, reason: 'not_a_repository' }; throw error; }
    let top;
    try { top = (await git(context, ['rev-parse', '--show-toplevel'])).trim(); }
    catch (error) { if (error.code === 'git_not_installed') return { ...base, reason: 'git_not_installed' }; if (error.commandFailed) return { ...base, reason: 'not_a_repository' }; throw error; }
    if (await realpath(top) !== context.root) throw problem('Choose the Git repository root itself. A parent repository is not opened automatically.', 'git_root_mismatch', 409);
    const [head, branch, porcelain, branchText, remoteText, tracking] = await Promise.all([
      optionalGit(context, ['rev-parse', '--verify', 'HEAD']), optionalGit(context, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
      git(context, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=all']),
      git(context, ['for-each-ref', '--count=300', '--format=%(refname:short)%00%(objectname)%00%(subject)%00%(committerdate:iso-strict)%00%(upstream:short)%00%(upstream:track,nobracket)', 'refs/heads']),
      optionalGit(context, ['config', '--get-regexp', '^remote\\..*\\.url$']),
      optionalGit(context, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']),
    ]);
    const remotes = remoteText.split('\n').flatMap(line => {
      const match = line.match(/^remote\.(.+)\.url\s+(.+)$/); if (!match) return [];
      const repository = githubRepositoryFromRemote(match[2]);
      return repository ? [{ name: safeText(match[1], 100), ...repository }] : [];
    });
    const github = remotes.find(row => row.name === 'origin') || remotes[0] || null;
    const branchDetails = branchText.trim().split('\n').filter(Boolean).slice(0, 300).flatMap(line => {
      const [name, commit, subject, date, upstream, track = ''] = line.split('\0');
      if (!name || !/^[a-f0-9]{40,64}$/.test(commit || '')) return [];
      const ahead = /(?:^|, )ahead (\d+)(?:,|$)/.exec(track), behind = /(?:^|, )behind (\d+)(?:,|$)/.exec(track);
      return [{ name, commit, shortCommit: commit.slice(0, 8), subject: safeText(subject, 240), committedAt: Number.isFinite(Date.parse(date)) ? date : null, upstream: safeText(upstream, 240) || null,
        tracking: upstream && track !== 'gone' ? { ahead: Number(ahead?.[1] || 0), behind: Number(behind?.[1] || 0) } : null, upstreamGone: track === 'gone' }];
    });
    const branches = branchDetails.map(item => item.name);
    const records = await connections.load();
    const record = records.find(row => row.workspaceId === workspaceId);
    const connected = Boolean(github && record && record.projectId === context.row.project_id && record.root === context.root && record.rootIdentity === context.row.root_identity && record.rootVersion === context.row.version && record.slug === github.slug);
    const recordsStatus = porcelain.split('\0').filter(Boolean);
    const counts = { changed: recordsStatus.filter(row => row.length >= 3 && /^(?:\?\?|[ MARCUD?!]{2}) /.test(row)).length, staged: recordsStatus.filter(row => /^[MARCUD] /.test(row) || /^[MARCUD][MARCUD ]/.test(row)).length, untracked: recordsStatus.filter(row => row.startsWith('?? ')).length };
    const trackingCounts = tracking.trim().match(/^(\d+)\s+(\d+)$/);
    const connectionVersion = connected ? record.consentId || hash(JSON.stringify([record.workspaceId, record.connectedAt || '', record.rootVersion])) : null;
    const version = hash(JSON.stringify([context.row.version, head, branch, porcelain, branchText, github?.slug || null, connectionVersion]));
    return { ...base, isRepository: true, connected, github, version, connectionVersion, tabScope: hash(JSON.stringify([workspaceId, context.row.project_id, context.root, context.row.root_identity, github?.slug || null])), head: head.trim() || null, branch: branch.trim() || null, detached: !branch.trim(), branches, branchDetails, branchesLimited: branches.length >= 300,
      dirty: Boolean(porcelain), changes: counts, tracking: trackingCounts ? { ahead: Number(trackingCounts[1]), behind: Number(trackingCounts[2]) } : null,
      activeWork: Boolean(active(workspaceId)), account: { state: 'not_checked', authenticated: null }, reason: github ? connected ? null : 'connection_confirmation_required' : 'github_remote_missing' };
  }
  function checkExpected(state, input) {
    if (input.expected_version !== state.version || input.expected_binding_version !== state.bindingVersion) throw conflict('The repository or selected directory changed. Refresh before continuing.');
  }
  async function account(context) {
    try {
      await command('gh', ['auth', 'status', '--hostname', 'github.com'], context.root);
      const user = JSON.parse(await command('gh', ['api', '--hostname', 'github.com', 'user', '--jq', '{login: .login}'], context.root));
      return { state: 'checked', installed: true, authenticated: Boolean(user.login), login: safeText(user.login, 80), checkedAt: new Date().toISOString() };
    } catch (error) {
      return { state: 'checked', installed: error.code !== 'gh_not_installed', authenticated: null, login: null, reason: error.code === 'gh_not_installed' ? 'gh_not_installed' : 'gh_account_unverified', checkedAt: new Date().toISOString() };
    }
  }
  async function connect(workspaceId, actor, input) {
    if (input.confirmed !== true) throw problem('Confirm using this directory’s GitHub repository in Frondose.');
    return roots.withBoundRoot(workspaceId, actor, 'workbench.execute', async context => {
      const state = await inspect(workspaceId, actor); checkExpected(state, input);
      if (!state.github) throw problem('This directory does not have a supported GitHub remote. Follow the setup guide before connecting.', 'github_remote_missing', 409);
      const checkedAccount = await account(context);
      const fresh = await inspect(workspaceId, actor); checkExpected(fresh, input);
      await connections.update(workspaceId, { workspaceId, owner: 'local-owner', projectId: context.row.project_id, root: context.root, rootIdentity: context.row.root_identity, rootVersion: context.row.version, slug: state.github.slug, repositoryUrl: state.github.url, consentId: randomUUID(), connectedAt: new Date().toISOString() });
      return { ...await inspect(workspaceId, actor), account: checkedAccount };
    });
  }
  async function disconnect(workspaceId, actor) { await roots.get(workspaceId, actor); await connections.update(workspaceId, null); return inspect(workspaceId, actor); }
  async function switchBranch(workspaceId, actor, input) {
    if (input.confirmed !== true || input.drafts_confirmed !== true) throw problem('Save or discard editor drafts and confirm switching this branch.');
    if (typeof input.branch !== 'string' || input.branch.length > 250 || /^[\s-]/.test(input.branch) || /[\u0000-\u0020\u007f]/.test(input.branch)) throw problem('Choose an existing local branch.');
    return roots.withBoundRoot(workspaceId, actor, 'workbench.execute', async context => {
      mutations.add(workspaceId); mutatingRoots.add(context.row.root_identity); mutatingPaths.add(context.root);
      let switched = false;
      try {
        const state = await inspect(workspaceId, actor); checkExpected(state, input);
        if (!state.connected) throw problem('Connect this repository before switching branches.', 'github_not_connected', 409);
        if (!state.branches.includes(input.branch)) throw problem('Choose an existing local branch. New branches are not created automatically.');
        if (state.branch === input.branch) return state;
        if (active(workspaceId)) throw conflict('Stop active agents and terminals before switching branches. Their working directory must not change underneath them.');
        if (state.dirty) throw conflict('Commit or set aside changed and untracked files before switching branches. Frondose never stashes or discards them automatically.');
        const filters = await optionalGit(context, ['config', '--get-regexp', '^filter\\..*\\.(smudge|process)$']);
        if (filters.trim()) throw conflict('This checkout uses Git content filters. Switch branches in a terminal so you can review their execution.');
        await mkdir(join(resolve(dataDir), 'git-hooks-disabled'), { recursive: true, mode: 0o700 });
        if ((await lstat(join(resolve(dataDir), 'git-hooks-disabled'))).isSymbolicLink()) throw conflict('The private Git hook guard is unavailable. No branch was changed.');
        const fresh = await inspect(workspaceId, actor); checkExpected(fresh, input);
        if (active(workspaceId) || fresh.dirty) throw conflict('Work started or files changed while preparing the branch change. Refresh and try again.');
        try { await git(context, ['switch', '--no-guess', '--', input.branch]); }
        catch { throw conflict('Git could not switch branches. No reset, clean, stash or force operation was attempted. Inspect the repository in a terminal.'); }
        switched = true;
        // Rotate the directory epoch even if a different OS writer races Git.
        // Old file-editor versions can no longer save into the changed checkout.
        const linked = db.prepare('SELECT workspace_id,project_id,path,root_identity,version FROM directory_workspaces WHERE root_identity=?').all(context.row.root_identity);
        const epochs = new Map();
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const row of linked) {
            const version = randomUUID(); epochs.set(row.workspace_id, { previous: row.version, version });
            db.prepare('UPDATE directory_workspaces SET version=?,updated_at=? WHERE workspace_id=? AND version=?').run(version, new Date().toISOString(), row.workspace_id, row.version);
          }
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        // Other workspaces on this same physical checkout also need stale-save
        // protection. Update only still-valid consents, never resurrect a stale
        // directory connection as a side effect of the branch change.
        for (const row of await connections.load()) {
          const epoch = epochs.get(row.workspaceId);
          if (epoch && row.rootIdentity === context.row.root_identity && row.root === context.root && row.rootVersion === epoch.previous) await connections.update(row.workspaceId, { ...row, rootVersion: epoch.version });
        }
        const result = await inspect(workspaceId, actor);
        if (result.branch === input.branch) {
          try { await recordActivity({ workspaceId, kind: 'git.branch_changed', title: 'Git branch switched', entityId: context.project.id }); }
          catch { /* The verified branch change must not be reported as failed. */ }
        }
        return { ...result, branchChanged: true };
      } catch (error) {
        if (switched) throw problem('Git completed the branch change, but Frondose could not refresh all repository metadata. Refresh the directory before continuing; do not repeat the switch blindly.', 'branch_changed_refresh_required', 409);
        throw error;
      } finally { mutations.delete(workspaceId); mutatingRoots.delete(context.row.root_identity); mutatingPaths.delete(context.root); }
    });
  }
  async function pullRequests(workspaceId, actor, input) {
    if (input.confirmed !== true) throw problem('Choose Refresh pull requests to read GitHub.');
    const state = await inspect(workspaceId, actor); checkExpected(state, input);
    if (!state.connected) throw problem('Connect this directory’s GitHub repository first.', 'github_not_connected', 409);
    const context = await roots.rootFor(workspaceId, actor);
    const checkedAccount = await account(context);
    if (!checkedAccount.authenticated) throw problem(checkedAccount.installed ? 'The GitHub CLI account could not be verified. Check your network and gh auth status; sign in with gh auth login if needed, then try again.' : 'Install GitHub CLI, then sign in with gh auth login. Your Git branches still work locally.', checkedAccount.reason, 409);
    let raw;
    try { raw = JSON.parse(await command('gh', ['pr', 'list', '--repo', `github.com/${state.github.slug}`, '--state', 'open', '--limit', '20', '--json', 'number,title,url,headRefName,baseRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt'], context.root)); }
    catch { throw problem('Pull requests could not be read from GitHub. Check GitHub CLI access and try again.', 'github_read_failed', 502); }
    const fresh = await inspect(workspaceId, actor); checkExpected(fresh, input);
    const requests = (Array.isArray(raw) ? raw : []).slice(0, 20).flatMap(row => {
      if (!Number.isSafeInteger(row.number) || row.number < 1) return [];
      const checks = Array.isArray(row.statusCheckRollup) ? row.statusCheckRollup : [];
      return [{ number: row.number, title: safeText(row.title, 300), url: `${state.github.url}/pull/${row.number}`, head: safeText(row.headRefName, 160), base: safeText(row.baseRefName, 160), draft: row.isDraft === true,
        review: ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(row.reviewDecision) ? row.reviewDecision : null,
        checks: { total: checks.length, failed: checks.filter(check => ['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'CANCELLED'].includes(check.conclusion || check.state)).length, pending: checks.filter(check => ['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'REQUESTED'].includes(check.status || check.state)).length }, updatedAt: safeText(row.updatedAt, 40) }];
    });
    return { requests, limited: requests.length >= 20, repository: state.github, account: checkedAccount };
  }
  async function issues(workspaceId, actor, input) {
    if (input.confirmed !== true) throw problem('Choose Search issues to read GitHub.');
    const issueState = input.state ?? 'open', query = input.query ?? '', assignedToMe = input.assigned_to_me ?? false, limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || input.include_body !== undefined && typeof input.include_body !== 'boolean') throw problem('Use an issue limit between 1 and 100.');
    if (!['open', 'closed', 'all'].includes(issueState) || typeof query !== 'string' || query.length > 300 || /[\u0000-\u001f\u007f]/.test(query) || typeof assignedToMe !== 'boolean') throw problem('Choose a supported issue state and a search of up to 300 characters.');
    if (/(?:^|\s)-?(?:repo|org|user|owner|type|is):/i.test(query)) throw problem('Search within this connected repository. Repository, owner and issue-type qualifiers cannot change this source.');
    const state = await inspect(workspaceId, actor); checkExpected(state, input);
    if (!state.connected) throw problem('Connect this directory’s GitHub repository first.', 'github_not_connected', 409);
    const context = await roots.rootFor(workspaceId, actor), checkedAccount = await account(context);
    if (!checkedAccount.authenticated) throw problem(checkedAccount.installed ? 'The GitHub CLI account could not be verified. Check your network and gh auth status; sign in with gh auth login if needed, then try again.' : 'Install GitHub CLI, then sign in with gh auth login. Your Git branches still work locally.', checkedAccount.reason, 409);
    // An inherited GH_HOST must not redirect a github.com repository read.
    const args = ['issue', 'list', '--repo', `github.com/${state.github.slug}`, '--state', issueState, '--limit', String(limit), '--json', `number,title,state,assignees,labels,updatedAt${input.include_body ? ',body' : ''}`];
    if (query.trim()) args.push('--search', query.trim());
    if (assignedToMe) args.push('--assignee', '@me');
    let raw;
    try { raw = JSON.parse(await command('gh', args, context.root)); if (!Array.isArray(raw)) throw Error('Invalid issue list'); }
    catch { throw problem('Issues could not be read from GitHub. Check this account’s repository access and network, then retry.', 'github_read_failed', 502); }
    const fresh = await inspect(workspaceId, actor); checkExpected(fresh, input);
    const seen = new Set();
    const records = raw.slice(0, limit).flatMap(row => {
      if (!Number.isSafeInteger(row?.number) || row.number < 1 || seen.has(row.number)) return [];
      seen.add(row.number);
      return [{ number: row.number, title: safeText(row.title, 300), state: row.state === 'CLOSED' ? 'closed' : row.state === 'OPEN' ? 'open' : 'unknown', url: `${state.github.url}/issues/${row.number}`,
        assignees: (Array.isArray(row.assignees) ? row.assignees : []).slice(0, 10).map(person => safeText(person?.login, 80)).filter(Boolean),
        labels: (Array.isArray(row.labels) ? row.labels : []).slice(0, 10).map(label => safeText(label?.name, 80)).filter(Boolean), updatedAt: safeText(row.updatedAt, 40),
        ...(input.include_body ? { body: typeof row.body === 'string' ? row.body.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 12000) : '' } : {}) }];
    });
    return { issues: records, limited: raw.length >= limit, repository: state.github, account: checkedAccount, query: query.trim(), state: issueState, assignedToMe };
  }
  async function fileBlame(workspaceId, actor, input) {
    if (input.confirmed !== true) throw problem('Choose Blame to read committed file history.');
    const state = await inspect(workspaceId, actor); checkExpected(state, input);
    if (!state.connected) throw problem('Connect this directory’s GitHub repository first.', 'github_not_connected', 409);
    const file = await roots.file(workspaceId, actor, input.path, input.expected_binding_version);
    if (file.unsupported || typeof file.content !== 'string') throw problem('Blame is available for supported text files only.');
    const context = await roots.rootFor(workspaceId, actor);
    let output;
    try { output = await git(context, ['--no-pager', 'blame', '--line-porcelain', '--no-textconv', 'HEAD', '--', file.path]); }
    catch { throw problem('Committed history is unavailable for this file. Save and commit it first, or use Recent changes.', 'git_blame_unavailable', 409); }
    const fresh = await inspect(workspaceId, actor); checkExpected(fresh, input);
    const checkedFile = await roots.file(workspaceId, actor, input.path, input.expected_binding_version);
    if (checkedFile.version !== file.version) throw conflict('This file changed while its history was being read. Refresh and try again.');
    const lines = []; let item = null, limited = false;
    for (const text of String(output).split('\n')) {
      const header = /^([a-f0-9]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(text);
      if (header) item = { line: Number(header[3]), commit: header[1], author: '', authoredAt: null, summary: '', text: '' };
      else if (item && text.startsWith('author ')) item.author = safeText(text.slice(7), 120);
      else if (item && text.startsWith('author-time ')) { const time = Number(text.slice(12)) * 1000; if (Number.isFinite(time) && Math.abs(time) < 8.64e15) item.authoredAt = new Date(time).toISOString(); }
      else if (item && text.startsWith('summary ')) item.summary = safeText(text.slice(8), 300);
      else if (item && text.startsWith('\t')) { item.text = text.slice(1); lines.push(item); item = null; if (lines.length >= 5000) { limited = true; break; } }
    }
    return { path: file.path, head: state.head, lines, limited, source: 'local_git_history', fileVersion: file.version };
  }
  async function dispatch({ workspaceId, actor, action = '', method = 'GET', input = {} }) {
    if (action.startsWith('work/')) return repositoryWork.dispatch({workspaceId,actor,action:action.slice(5),method,input});
    if (!action && method === 'GET') return inspect(workspaceId, actor);
    if (action === 'connect' && method === 'POST') return connect(workspaceId, actor, input);
    if (action === 'disconnect' && method === 'POST') return disconnect(workspaceId, actor);
    if (action === 'branch' && method === 'POST') return switchBranch(workspaceId, actor, input);
    if (action === 'pull-requests' && method === 'POST') return pullRequests(workspaceId, actor, input);
    if (action === 'issues' && method === 'POST') return issues(workspaceId, actor, input);
    if (action === 'file-blame' && method === 'POST') return fileBlame(workspaceId, actor, input);
    if (['history', 'history-diff'].includes(action) && method === 'POST') return roots.withBoundRoot(workspaceId, actor, 'workbench.read', async context => {
      if (input.expected_binding_version !== context.row.version) throw conflict('The workspace directory changed. Reopen Versions.');
      const repository=await inspect(workspaceId,actor);
      if(!repository.isRepository)throw problem('Link the Git repository root before reading its history.');
      if (action === 'history') {
        const output = await git(context, ['log', '-50', '--no-decorate', '--format=%H%x1f%aI%x1f%s%x1e', '--']);
        const rows = output.split('\x1e').map(record => record.trim().split('\x1f')).filter(row => /^[a-f0-9]{40,64}$/.test(row[0])).map(([id, date, title]) => ({ id, date, title: safeText(title, 500) }));
        return { rows, limited: rows.length === 50 };
      }
      if (!/^[a-f0-9]{40,64}$/.test(input.commit || '')) throw problem('Choose a commit from history.');
      const path = directoryRelativePath(input.path);
      const patch = await git(context, ['show', '--no-ext-diff', '--no-textconv', '--format=medium', '--no-renames', input.commit, '--', path]);
      return { patch: patch.slice(0, 100_000), limited: patch.length > 100_000, path };
    });
    throw problem('This local repository action is unavailable.', 'not_found', 404);
  }
  const repositoryWork = createRepositoryWork({db,dataDir,roots,inspect,git,command,checkExpected,active,account,mutations,mutatingRoots,mutatingPaths,recordActivity});
  return { inspect, connect, disconnect, switchBranch, pullRequests, issues, fileBlame, dispatch, assertNoMutation, repositoryWork };
}

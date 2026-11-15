const text = (value, limit = 4096) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, limit) : '';

export function localGitApiPath(workspaceId, action = '') {
  return `/api/local-git${action ? `/${action}` : ''}?${new URLSearchParams({ workspace_id: workspaceId })}`;
}

export function localGithubReadFailure(error) {
  if (error?.code === 'gh_not_installed') return { title: 'GitHub source unavailable', message: 'GitHub CLI is not installed or cannot be found. Install gh, sign in with gh auth login, then retry. Local branches still work.' };
  if (error?.code === 'gh_account_unverified') return { title: 'GitHub account could not be checked', message: 'Check your network and gh auth status. If needed, sign in with gh auth login, then retry. Frondose has not changed your account.' };
  if (error?.code === 'local_git_conflict') return { title: 'Repository changed', message: 'Recheck this directory before reading GitHub work. Previous results have not been reused for the changed repository.' };
  return { title: 'GitHub work could not be loaded', message: 'Check your network and this account’s access to the repository, then retry. No GitHub issue or pull request was changed.' };
}

/** Content for a human-reviewed setup request, never an executable command. */
export function localGitSetupPrompt(state = {}) {
  const directory = text(state.directory), name = text(state.projectName, 200) || 'my Frondose workspace';
  const repo = text(state.github?.slug, 160);
  if (!directory) return 'Help me choose a specific project directory for Frondose. Explain the current folders first, then wait for my choice. Do not move files, initialize Git, or connect an account without asking me.';
  return [
    `Help me set up GitHub for ${JSON.stringify(name)} in the existing directory ${JSON.stringify(directory)}.`,
    state.isRepository ? 'This directory is already a Git working tree. Inspect its current branch, changes and remotes first.' : 'Frondose did not detect a Git working tree rooted at this directory. Check the directory before proposing git init.',
    repo ? `The detected GitHub repository is ${repo}. Preserve this remote unless I explicitly choose another.` : 'No supported github.com remote was detected. Ask me for the GitHub account/repository and whether it should be public or private; do not invent an owner or repository URL.',
    'If needed, guide me through installing Git/GitHub CLI and the interactive gh auth login flow. Never ask me to paste a token into chat.',
    'Explain and ask before initializing Git, adding/changing remotes, staging, committing, pushing, or creating a remote repository. Preserve all existing work, branches and credentials. Never reset, clean, force-push, or discard changes.',
    'After the remote and login are ready, tell me to return to Frondose and choose Connect to GitHub. Frondose will not create or publish a repository automatically.',
  ].join('\n\n');
}

/** Only canonical public GitHub URLs, never credential-bearing remote strings. */
export function githubRepositoryFromRemote(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  let owner, repo;
  const scp = value.match(/^git@github\.com:([^/]+)\/([^/]+)\/?$/i);
  if (scp) [, owner, repo] = scp;
  else {
    let url; try { url = new URL(value); } catch { return null; }
    if (url.hostname.toLowerCase() !== 'github.com' || !['https:', 'ssh:'].includes(url.protocol) || url.port || url.search || url.hash || url.password || url.protocol === 'ssh:' && url.username !== 'git') return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length !== 2) return null;
    [owner, repo] = parts;
  }
  repo = repo.replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || ['.', '..'].includes(repo)) return null;
  const slug = `${owner}/${repo}`;
  return { owner, repo, slug, url: `https://github.com/${slug}` };
}

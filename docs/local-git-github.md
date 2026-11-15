# Local Git and GitHub

The local desktop/browser workspace can inspect its explicitly linked project directory and optionally connect that directory’s existing **github.com** repository. This is separate from the paused legacy hosted/service connector catalog.

## Detection and connection

Opening a workspace reads local Git metadata only. It does not initialize Git, authenticate, fetch, contact GitHub, push, or create a repository. The selected directory must itself be the Git working-tree root; a parent repository is not silently adopted. Linked `.git` directories are refused; Git’s regular worktree metadata files are supported.

When setup reaches its final step, a linked directory with a supported GitHub remote can offer **Yes, connect** / **Not now**. Without a linked directory or GitHub remote, the optional offer is absent. The header remains a **Connect to GitHub** entry point. A missing/unsupported remote opens a guide with a customized, copyable AI setup prompt; that prompt cannot execute anything itself and never invents an owner, URL or visibility.

Explicit connection checks the installed GitHub CLI with `gh auth status` and a bounded account lookup. Frondose reuses the owner’s existing `gh` login, never reads or stores a token, never starts interactive sign-in automatically, and never treats installation as authentication. Connection to the local repository and GitHub account readiness are distinct: branch work can remain available if `gh` is missing or signed out. Pull-request reads require a working GitHub CLI login.

Repository consent is scoped to the local owner, workspace, project, canonical root identity/version and canonical GitHub repository. It lives in installation-private `local-git-connections.json`, not portable workspace exports or account credentials. Changed roots/remotes require explicit connection again. No new database schema is introduced.

## Branches and files

The header shows the current local branch and a dirty indicator. Its dialog shows existing local branches, changed/untracked item counts, and ahead/behind counts only when an upstream exists. No fetch or new tracking branch is created implicitly.

Switching a branch requires an explicit action, an unchanged repository snapshot, current local-owner/root permission and all editor drafts saved or discarded first. The server refuses dirty/untracked Git worktrees and active agents/terminals, including other workspaces sharing the checkout. Branch changes serialize with local file saves, reserve the root against terminal startup, disable checkout hooks and refuse configured content filters. Frondose does not stash, clean, reset, force, commit or push to make a switch succeed.

A successful switch rotates the file-editor directory epoch for all linked workspaces sharing the physical checkout. The UI refreshes Files and clean previews. Old or other-window drafts cannot save against the old epoch, including new Markdown drafts whose file does not yet exist. Existing unsaved drafts are retained on failure. External OS writers are not transactionally isolated by Frondose; repository state is rechecked and uncertain operations are not automatically replayed.

Repositories using custom smudge/process filters (including some Git LFS configurations) must switch from a terminal to review that configured execution. A regular Git installation with `git switch` support is required. Enterprise hosts and SSH host aliases are not claimed as supported GitHub remote identities in this release.

## GitHub work: Issues and pull requests

The repository dialog has keyboard-accessible Issues and PRs views. **Search
issues** explicitly reads at most 20 matching issues from the connected
repository through `gh issue list`, with Open/Closed/All, an optional search
query and Assigned to me. Results show returned titles, assignees, labels and
state. Search is passed as a discrete CLI argument, never a shell command.
Changing tabs or typing alone never contacts GitHub. Missing `gh`, an unverified
account or a failed read shows an actionable source state and Retry, without
exposing raw command output. Previous account checks do not certify later reads.

**Projects on GitHub** opens the repository's actual GitHub Projects page; native
GitHub Projects enumeration/editing is not implemented. This is not a connection
to every project in the account or a claim that the account has Projects access.

**Refresh pull requests** explicitly reads up to 20 open PRs with `gh`, showing real returned titles, source/target branches, draft/review state and check-result summaries. No background GitHub polling runs just because the header is visible. Links are canonical repository URLs; remote credential strings and arbitrary provider-returned URLs are not exposed. PR creation, comments, review submission, merge, branch deletion, fetch, commit and push are not part of this local UI.

## Source inspiration and verification

Orca likewise distinguishes GitHub remote identity and GitHub CLI authentication. Reviewed source: `stablyai/orca` revision `51dcef8258230ffea85a907130450b0ad676e22b`, `src/main/preflight/agent-detection.ts` and `src/main/github/github-repository-identity.ts`. Frondose’s service is a focused implementation for its owner/root/version/access boundaries, not a wholesale port or claim of complete Orca Git parity.

Primary references: [Orca source](https://github.com/stablyai/orca), [Orca GitHub troubleshooting](https://www.onorca.dev/docs/github-errors), [GitHub CLI authentication](https://cli.github.com/manual/gh_auth_login), [GitHub issue listing](https://cli.github.com/manual/gh_issue_list).

Tests use temporary repositories, private fixture stores and fake GitHub CLI responses. They cover explicit/no-network discovery, canonical remote parsing, owner/origin restrictions, consent scope/persistence, stale state, dirty/active branch protection, same-checkout races, disabled hooks/refused filters, stale editor epochs and bounded PR URLs. No user repository, GitHub login or real remote write is used by those tests. Native Windows/Linux live GitHub-account verification remains separate from these fixtures.

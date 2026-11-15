# GitHub issues as local Routes

Connect the workspace's selected directory using its GitHub button, then open
Settings → GitHub. The directory must already be a Git repository with a
github.com remote. The installed `gh` CLI keeps ownership of its own login;
Frondose does not copy tokens or create an account connection simply by detecting
a repository. GitHub settings remain unavailable until explicitly connected.

Save a destination Area and/or project, source state and optional search,
required labels, assigned-to-me filter, description and label-copy choices.
Projects use their own Area; archived or foreign-workspace destinations cannot
receive imports. The initial status is Backlog by default, never Done. A closed
GitHub issue is not evidence that its Route output has been reviewed or accepted.

Automatic import is **off by default**. Enable it and save to permit a bounded
GitHub CLI issue read every 5–60 minutes while the local Frondose server runs.
There is no cloud scheduler or hidden background agent. No check happens merely
by opening Settings or saving settings. Sync now explicitly performs one check.
An account/repository access check occurs each time before issue retrieval.

Each check reads at most the chosen 25, 50 or 100 matching latest issues. A
reached cap is reported: this is not a complete repository backfill. Use narrower
date/search filters to cover older issue ranges deliberately. Required label
names must all match. Descriptions are limited to 12,000 characters. Private
issue content is copied only when the configured check actually imports it into
this computer's local workspace; it is not uploaded elsewhere by this feature.

Imports are create-only. The workspace/repository/issue-number source key is
unique and retains the native issue URL. Further checks never overwrite local
title, description, status, labels or destination. Deleting an imported Route
does not recreate it on the next check: a source tombstone remains. Changing the
destination only affects new imports. No issues, pull requests or repositories
are written on GitHub; no Git fetch/push or agent execution is performed.

Directory selection, physical root, binding revision, repository, explicit
connection and destination permissions are checked again after awaited network
reads and before an atomic local import. Changing any of them suspends the old
configuration. Review and save the configuration again. Network errors preserve
existing Routes and back off to the configured interval. Restarting the local
server preserves saved opt-in settings and source deduplication. Full private
SQLite backups retain these installation records, but restored records cannot
bypass current root, connection and permission checks. They contain no
credentials. Portable workspace JSON exports do not currently include import
configuration or source tombstones. Restoring such an export into a new workspace
does not restore automation consent or promise deduplication against its imported
historical Routes; review before explicitly configuring another import source.

## Activation and platform boundaries

The service is part of Frondose's local backend, used identically by the browser
and desktop shell on macOS, Windows and Linux with Git and `gh` installed. Source
updates require a safe backend restart before the running server exposes new
endpoints. Do not restart a server with active terminals without the owner's
permission. Fixture tests use fake GitHub responses and disposable SQLite data;
they never probe an owner's account. Native runtime tests on Windows/Linux are
still required before claiming platform release certification.

## File Changes → Blame

Blame requires an explicit workspace GitHub connection but only reads **local
committed HEAD history**. It never calls GitHub, fetches history, runs textconv
or trusts arbitrary file paths. New/uncommitted-only files use Recent changes.
The response is bounded and identified as committed history, not live text or
GitHub-hosted blame. Current directory/file revisions are rechecked after read.

Endpoints (local edition only, current owner and same-origin protections):

- `GET /api/github-routes?workspace_id=…`: local status/config only.
- `POST /api/github-routes/settings`: explicit confirmed config with repository,
  binding and config-revision guards.
- `POST /api/github-routes/sync`: explicit one-shot import with config revision.
- `POST /api/local-git/file-blame`: explicit scoped committed file history with
  current Git and directory binding revisions.

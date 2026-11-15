# Local native CLI session history search

The October 26 request restores **opt-in local search**, not the retired Session
views page, provider website-chat import, or universal two-way chat sync. Codex
and Claude Code are the first supported file formats. Other CLIs still use their
own native session pickers/history commands; catalog detection is not history
support or provider authentication.

## Access and lifecycle

Open Session history search or Settings → Session history search. Both read only
the private access settings at first: no provider session files are scanned on
application startup, opening the dialog, changing workspace, or entering Settings.

Enable local history search explicitly, select a scope and press **Refresh
index**. The default scope is the linked workspace directory. Project scope uses
an existing server-owned project directory, never a browser-supplied path. The
separate **All local sessions** checkbox must be enabled before indexing histories
from unrelated directories. In scoped scans, provider session headers are read
locally to identify the recorded directory before indexing any matching visible
user/assistant text. An unavailable or changed directory does not fall back to
home or another project.

Search matches title and visible message text, with provider filtering and the
40 newest matches. Each result shows provider, searchable text-message count,
time, original directory and a bounded snippet. Refine the query for older
matches. Counts exclude tool-only, system, meta and reasoning records; they are
not token usage or task-completion evidence.

The enabled/all-directory choices are installation-private, in an owner-only
settings file outside portable workspace exports. The search content index is
bounded process memory, not an additional persisted transcript database. It is
not restored after server restart. **Clear local search index** and **Disable**
drop this server's cached references and invalidate old result tokens. Other API
instances discard old indexes when they next read the changed consent generation.
These controls never delete or
rewrite provider history. JavaScript memory release is not secure memory erasure.

## Supported files and bounds

- Codex: regular `rollout-…-<UUID>.jsonl` files in the configured absolute
  `CODEX_HOME/sessions` or default owner `.codex/sessions`; bounded year/month/day
  traversal. The parser understands session metadata, normal response messages,
  legacy message events and supported paginated completed-message events.
  Subagent/internal histories and reasoning records are excluded. Archived Codex
  sessions and external/custom database formats are not indexed.
- Claude Code: regular `<UUID>.jsonl` files directly inside project directories
  under configured absolute `CLAUDE_CONFIG_DIR/projects` or default owner
  `.claude/projects`. First recorded cwd is retained instead of later cwd drift;
  custom titles and visible user/assistant text are supported. Sidechain,
  subagent-folder, meta, API-blob, tool-only and thinking records are excluded.
- Both require a valid UUID native identity and an absolute recorded cwd.
  Malformed/unsupported entries, conflicting Claude identities, symlink roots or
  parent directories, symlink files and hard-linked transcripts are excluded.
  Only recognized transcript filename patterns are opened; credential, auth,
  configuration, SQLite and other arbitrary files are never transcript inputs.

Current limits are 8,000 directory entries, 600 candidate files per provider,
8 MB per source, 64 MB of source reads per refresh, 300 indexed sessions and
8 MB of searchable text per scope (96,000 characters per session). At most eight
scope indexes are retained in memory. Very large files, long records, unsupported
formats or reached bounds may be omitted; the interface reports a limited scan
rather than claiming complete provider history. Source changes/deletions are
checked before returning matches, and changed results require refresh.

## Exact native resume

The explicit **Resume** button opens the installed provider CLI without sending
a new user prompt. It passes an opaque server-owned result token, never a
browser-supplied session ID, command, environment, cwd or argv string. The server
rechecks enabled consent, local owner/workspace/project access, current canonical
root and binding epoch, provider identity, transcript inode/size/times and content
hash before permitting its validated native UUID as one discrete CLI argument.

Only a result whose original directory exactly matches the current linked
workspace directory can resume. Foreign/all-scope results remain searchable but
show **Link the session’s original directory…** and disable Resume until the
owner links that directory and refreshes. Searching does not grant folder
execution authority. Folderless native picker support remains separate.

Exact resumes through this server reserve provider/session identity until an
observed PTY exit or confirmed pre-spawn failure releases the lease. Uncertain
post-spawn cleanup does not silently release it. This does not reconcile another
independently launched CLI, another server process, or concurrent external writes.
The provider still owns login, saved context, session format and billing; native
resume is not a promise that every historical version/session can be reopened.

## Reuse and verification

Record selection adapts the pinned MIT Orca Codex/Claude scanner rules, with
Frondose-specific opt-in, memory limits, local API/access checks and exact-result
leases. It is not Orca's full AI Vault, SQLite/FTS index, remote/WSL scanner or
multi-provider history implementation. Provenance and source hashes are in
[the Orca notice](../third-party/orca/NOTICE.md).

Tests use only generated temporary JSONL files, private settings and fake roots
or terminal adapters. No user's history is indexed, no provider is authenticated,
and no real/paid inference is performed as coding QA. Native installed-provider
and Windows/Linux acceptance are separate from these fixtures.

References: [Codex CLI](https://learn.chatgpt.com/docs/codex/cli),
[Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference),
[pinned Orca Codex scanner](https://github.com/stablyai/orca/blob/51dcef8258230ffea85a907130450b0ad676e22b/src/main/ai-vault/session-scanner-codex-parser.ts),
[pinned Orca Claude scanner](https://github.com/stablyai/orca/blob/51dcef8258230ffea85a907130450b0ad676e22b/src/main/ai-vault/session-scanner-primary-parsers.ts).

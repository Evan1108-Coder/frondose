# Local connections and agent sessions

Rumbo stores workspace data locally. A live session sends the instruction and selected project context to its AI provider. A connection is never checked or signed in merely because you open Rumbo. Automated tests substitute processes and network responses; they do not use real Codex or Claude accounts.

## What works

| Connection | Sign-in | Available work |
| --- | --- | --- |
| Codex | Existing Codex CLI account or provider browser sign-in | Live analysis; optional edits inside the selected working folder; streamed messages, command results, file-change events and stop |
| Claude | Existing Claude Code account or provider browser sign-in | Live analysis with file-read and search tools; streamed messages and stop |
| GitHub | Existing GitHub CLI account, browser sign-in, or fine-grained personal access token | List accessible repositories, follow repository links and attach a repository URL to a project |
| Google Drive | Registered Google OAuth client and browser consent | List file metadata and open file links; no file-content download or editing |

## Codex

Install the official CLI (`npm install -g @openai/codex`) so `codex` is on the local server's PATH. In Connections, choose existing sign-in to explicitly check `codex login status`, or browser sign-in to start `codex login`. Rumbo never collects a ChatGPT password. Eligibility and limits come from the account authenticated in Codex; connecting does not import ChatGPT's conversation history. See the [official Codex CLI reference](https://developers.openai.com/codex/cli/reference/).

Start a live session after selecting a project folder and writing an instruction. Analysis is the default. Editing requires selecting `workspace-write`; it is unavailable when Rumbo's global agent setting forces read-only work. Rumbo disables additional writable roots, tool network access, hooks, connected apps, automatic subagents and discovered MCP servers for the run. It checks the MCP configuration locally first and fails clearly if it cannot verify it. Provider authentication and model requests still require network access. See the [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

## Claude

Install a current Claude Code release (`brew install --cask claude-code` on macOS). Rumbo requires a version supporting `--restricted` (2.1.248 or later); unsupported flags fail rather than silently removing restrictions. Existing sign-in calls `claude auth status`; browser sign-in starts `claude auth login`.

Rumbo uses print mode with bare/restricted startup, only `Read`, `Glob` and `Grep` tools, explicit MCP denial, and a 12-turn limit. Shell execution and editing are unavailable in this adapter. Your account must allow programmatic use; its allowance and billing can differ from interactive Claude usage. See [Claude's CLI reference](https://code.claude.com/docs/en/cli-reference) and [programmatic usage documentation](https://code.claude.com/docs/en/headless).

## GitHub

Install GitHub CLI (`brew install gh`) to use existing or browser sign-in. The browser option starts GitHub CLI's device authorization; any code and instructions appear in the connection's sign-in progress. Existing sign-in explicitly fetches the authenticated account. Alternatively, paste a fine-grained token limited to the repositories you need. Rumbo validates it before saving it. This version does not create branches, issues, commits or pull requests on your behalf. See [GitHub CLI sign-in](https://cli.github.com/manual/gh_auth_login) and [the repository-list API](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user).

## Google Drive

Google requires an OAuth app registration before Rumbo can offer its consent screen:

1. Create a Google Cloud project, enable the Google Drive API, and configure its consent screen. For a testing app, add your Google account as a test user.
2. Create a **Web application** OAuth client. Register exactly the callback shown in Rumbo's Connections setup, for example `http://127.0.0.1:4174/api/auth/google-drive/callback`. Hostname and port must match the running server.
3. Supply `RUMBO_GOOGLE_CLIENT_ID` and `RUMBO_GOOGLE_CLIENT_SECRET` in the server process environment, then restart that server. Keep these values out of Git. Variables with a `VITE_` prefix are unsuitable for secrets because they can be bundled into browser code.
4. Choose browser sign-in in Rumbo and complete Google's consent screen.

The requested scope is `drive.metadata.readonly`. It can list file names, types, modification times and links across the authorized account; it is not a selected-file content permission. Google may require verification for wider distribution. The implementation uses expiring, single-use OAuth state, PKCE, a local callback, and token refresh. See [Google's OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server) and [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Local behavior and limits

- A session's explicit working-folder choice overrides its linked project's folder, then the agent's default folder. Choose a specific project directory. Rumbo rejects filesystem root, your home folder and broad system directories. Each run displays the actual resolved working folder.
- Stopping sends termination to the local process group, then forces termination after three seconds if needed. Already completed edits are not rolled back. Sessions stop after 30 minutes; a follow-up is a new run.
- Disconnect forgets the connection in Rumbo. It does not log out another application's CLI or revoke the provider account globally. Stop active sessions separately. Google access can also be revoked in the account's third-party access settings.
- Optional GitHub tokens and Google access/refresh tokens are kept in `.rumbo/integrations.private.json`, with owner-only `0600` file permissions. This is not encrypted storage. They are excluded from bootstrap data and workspace exports; known credential strings are redacted from captured provider output.
- Live output, instructions, selected text attachments and results are local business data and can appear in a workspace export. Do not put secrets in prompts or project files just because the credentials store is private.
- Keep the server bound to loopback. There is no multi-user authentication layer or support for exposing this local server publicly.

## API shapes for the UI

Provider IDs are `codex`, `claude`, `github`, and `google-drive`.

| Request | Result |
| --- | --- |
| `GET /api/connections/setup` | `{ setups, accountSafe: true }`; capability descriptions only |
| `GET /api/connections/:provider/setup` | `{ setup, accountSafe: true }`; includes methods, missing configuration, docs, install command and cached connection |
| `POST /api/connections/:provider/connect` with `{ method, token? }` | `{ connection, authorizationUrl?, message? }`; methods are `existing`, `browser`, or GitHub-only `token` |
| `GET /api/connections/:provider/status` | `{ connection }`; cached status with optional `auth: { status, output, startedAt }` |
| `POST /api/connections/:provider/check` | `{ connection }`; explicitly validates sign-in |
| `POST /api/connections/:provider/disconnect` | `{ connection, message }` |
| `GET /api/connections/:provider/resources?pageToken=...` | `{ resources: [{ id, name, url, kind, updatedAt, ... }], nextPageToken }` for GitHub/Drive |

Connections use `not_connected`, `connecting`, or `connected`. Browser auth progress may be `running`, `complete`, `failed`, `expired`, or `cancelled`. Errors use `{ error: { code, message } }`; a setup problem must not be displayed as a successful connection.

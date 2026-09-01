# Rumbo

Rumbo is a local-first workspace for planning projects, holding project-aware chats, and watching AI workers operate with visible context and approval boundaries.

## Run the prototype

Requirements: Node.js 22.5 or newer (the local database uses Node's built-in SQLite module).

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4173/`. The development server binds only to the local machine. Prototype data is stored in `.rumbo/rumbo.sqlite`.

A new installation starts empty. The first screen asks for a workspace name; GitHub, Google Drive, Codex, and Claude remain disconnected until the user explicitly begins setup.

## What works now

- Create and switch isolated local workspaces.
- Create projects, work items, and chats; link chats to project work.
- Persist chat messages and settings in SQLite.
- Start safe simulated agent runs, inspect their event timeline and proposed file changes, approve or reject a permission request, and stop a run.
- Inspect GitHub, Google Drive, Codex, and Claude setup requirements without opening sign-in pages or checking a paid account.
- Detect the local GitHub, Codex, and Claude executables with version-only probes.
- Use responsive desktop, tablet, and phone layouts that fill the available viewport.

The UI uses Rumbo's own model: a Route visibly connects a work item to its intent, project conversation, assigned worker, and result. Internal database identifiers exist for reliable relationships, but Linear-style identifiers are not presented as the main organizing model.

## Connection boundary

The current prototype implements provider definitions, safe local detection, callback URL generation, required scopes, missing-credential reporting, and provider-specific policy text. It deliberately does **not** start OAuth or access a real account.

Live authorization still requires:

- GitHub: a GitHub App or OAuth app, with its client ID and secret supplied to the local server.
- Google Drive: a Google OAuth client, the narrow `drive.file` scope, and Google Picker for explicit file selection.
- Codex: Codex App Server, which owns its own ChatGPT sign-in. Rumbo must not collect ChatGPT credentials.
- Claude: an Anthropic API key or supported cloud credentials. A Claude consumer subscription cannot simply be reused as third-party OAuth.

Expected environment variable names are `RUMBO_GITHUB_CLIENT_ID`, `RUMBO_GITHUB_CLIENT_SECRET`, `RUMBO_GOOGLE_CLIENT_ID`, `RUMBO_GOOGLE_CLIENT_SECRET`, and `ANTHROPIC_API_KEY`. Secret values must remain server-side and should move to the macOS Keychain before live authorization is enabled.

## Verify

```bash
npm test
npm run build
```

The automated suite covers the clean first-install state, local persistence, linked mock runs and approvals, account-safe probes, provider setup descriptors, hostile-origin rejection, and the production build fallback behavior.

## Important prototype limits

- Provider runs are simulated; no model request is made and no usage is charged.
- OAuth initiation, callback exchange, token refresh, revocation, and Keychain storage are the next integration phase.
- File-tree browsing, real Git operations, and provider streaming are represented in the interface but are not yet connected to live adapters.
- New profiles use a neutral local placeholder until the user chooses an image.

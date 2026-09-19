# Rumbo

## Organize your workspace

- **Customize sidebar** is available in the workspace menu, sidebar footer, Settings → Appearance, and search. Reorder sections with accessible up/down controls, choose Always show / With activity / Hide, set count/dot/no badges, and choose row spacing. Save applies the layout; Cancel discards it; Reset layout preserves favorites and shortcut preferences. These preferences belong to this browser and workspace, not other teammates or devices.
- **Favorites** pin projects, teams, routes, chats, agents, memory, outputs, sessions, Workbenches, documents and saved views using the top-bar pin (or `F` when not typing). Favorites use current names and hide archived records. Individual sidebar items can be hidden and restored without archiving content.
- **Focus** collects pending permissions, blocked/review routes, failed sessions, running work, and ready routes. Filter by project or text. Marking a failure seen only affects your Focus list; it never changes or deletes the session. Approvals must still be reviewed individually.
- **Your agents** in the sidebar shows profiles and active-session counts. The roster includes Favorites and Working now filters. **Chat with agent** opens an existing direct workspace chat or creates one; it does not send a message, connect an account, or launch an agent.
- **Keyboard:** `Cmd/Ctrl K` opens search, `G` then a section letter navigates, `N` then `R/P/T/C/A/M/S` opens a route/project/team/chat/agent/memory/session form, `C` creates a route, `[` toggles navigation, `Shift B` customizes the sidebar, and `?` opens searchable shortcut help. Creation preserves the current project where appropriate. Letter keys are ignored while typing or inside dialogs, and can be disabled in shortcut help. Shortcuts never approve requests or start AI execution directly.

A local-first workspace for projects, conversations, and AI workers. A **Route** connects an intention to its project, chat, agent sessions, and outcome.

## Run locally

Requires Node.js 22.5 or newer. Use a current Node release for the built-in SQLite runtime.

```sh
npm install
npm run dev
```

Open [Rumbo](http://127.0.0.1:4174). The server binds to loopback only. A new installation starts with an empty workspace setup; existing local records are preserved during schema upgrades.

## What is implemented

See [product expansion status](docs/product-expansion-status.md) for the detailed implementation/limitations ledger. New connected workflows include project Workbench (files, Git, real terminals), Home, supervised work plans and repeat Routes, versioned outputs/review, immutable context, knowledge revisions, document and saved-view pages, and project timelines. **The full proposed roadmap is not finished, and this build is not a public multi-user service.**

- Floating sidebar, centered empty states, subtle main-area gradient, responsive layouts, dark/light/system themes, comfortable/compact density, interruptible disclosures, reduced motion, accessible dialogs, and keyboard navigation.
- Create and switch workspaces. Create, edit, search, archive, and restore projects, Routes, chats, agents, and memory notes.
- Full project spaces with a Markdown brief, team, lead, start/target dates, milestones, routes, documents, related conversations, activity, repository/folder links, and project memory.
- Teams with scoped projects and routes, editable documents, and a local people directory. People records do not create accounts, invitations, remote access, or simultaneous online editing.
- Route status, priority, due date, assigned agent, filters, sorting, list/board views, and drag-to-change status.
- Project-aware conversations with persistent drafts, chat/message search, pinning, text/image previews, copying, message-to-Route, message-to-memory, and Markdown export. The composer explicitly selects a local note or one agent recipient.
- General chat works without a linked folder. Choose project read-only or coding access when working with local files; those modes require a specific project or agent folder. General chat uses a disposable private CLI working directory with restricted tools, not your home or Rumbo's storage folder.
- Lucide interface icons use Morphicons for state transitions and restrained pointer feedback. Keyboard and reduced-motion preferences keep state changes immediate. Rumbo's logo and empty-state illustrations are unchanged.
- Direct agent sends use a persisted, idempotent turn with visible progress, stop, failure, and retry. Interrupted or failed replies can retry the original message without duplicating it. Uncertain network deliveries retain their send keys across navigation/reload.
- Searchable agent roster with a detail inspector, setup status, profile presets, editing, duplication, pause/resume, and recoverable archiving. Agent-linked session history uses stable IDs, not names.
- Agent instructions and default folders. Preview the selected project, route, chat, and working folder before starting work; choose whether to include chat and memory. See [agent behavior and verification](docs/agents-refresh.md).
- Live Codex sessions for analysis or project edits. Live Claude sessions for restricted read/search analysis. Stream events and responses into the local session history and linked chat; stop active work.
- Clearly labeled local simulations for testing session events, approval, denial, and stopping without contacting accounts.
- Inbox for outstanding decisions and session updates. Read state and notification preferences persist.
- Real connection setup, explicit sign-in checks, progress, disconnect, and resource browsing. See the provider table below.
- Profile/image settings, workspace editing, appearance, session defaults, JSON exports, archive restore, and diagnostics.
- No silent demo fallback: failed requests show errors, and rejected optimistic changes roll back.
- Rumbo-authored dropdowns, date picker, dialogs, confirmations, validation, and tooltips, with keyboard navigation and focus management. File selection and provider authorization retain their required browser/OS interfaces.

## Connections

| Provider     | Implemented path                                         | Scope                                                           |
| ------------ | -------------------------------------------------------- | --------------------------------------------------------------- |
| Codex        | Existing CLI sign-in or provider browser sign-in         | Analysis or edits inside a chosen project folder                |
| Claude       | Existing Claude Code sign-in or provider browser sign-in | Read/search analysis; requires a CLI supporting restricted mode |
| GitHub       | CLI account, browser sign-in, or fine-grained token      | Repository listing and project links                            |
| Google Drive | OAuth with a registered Google client                    | File metadata and links; no file contents or editing            |

[Connection setup and provider limitations](docs/connection-setup.md) documents prerequisites, environment variables, permissions, and billing boundaries. Google needs an OAuth application registration before its sign-in flow can run. User authorization and live provider compatibility must be verified with the account owner; automated tests do not contact real accounts or consume model usage.

## Local data and permissions

Workspace data is in `.rumbo/rumbo.sqlite`. Optional GitHub/Google credentials are in the private, owner-only `.rumbo/integrations.private.json`; they are not encrypted and do not enter exports or browser state. The local server denies static access to `.rumbo`, environment files, and key files.

Do not expose this server to a network: this version has no multi-user authentication layer. Live sessions send the chosen context to the selected provider. Live CLI sessions use permissions chosen before execution; they do not provide interactive per-command approvals. Stopping a session does not undo edits already made.

Archived records can be restored. Workspace JSON exports can be imported into a new workspace through Settings → Import & export. Imports remap content references, reset approvals and work-plan state, pause repeat schedules, and never restore credentials, active processes or local folder permissions. They are not full installation backups. Back up the `.rumbo` folder when the app is stopped to preserve the full installation.

## Verify

```sh
npm test
npm run build
```

Tests cover isolated SQLite persistence, cross-workspace validation, optimistic state and rollback, context selection, mocked provider processes and OAuth, stopping races, account-secret redaction, local host protection, and build packaging. Browser QA exercises the actual app using a separate temporary database.

The production build includes Sites-compatible static packaging, but the hosted worker does not provide the local SQLite/CLI runtime. The complete application currently runs through the local Vite server.

## Keyboard shortcuts

`Cmd/Ctrl + K` searches work, messages, documents, outputs, saved views and actions, with optional `type:`, `project:` and `status:` filters. `C` opens a new Route form. `Cmd/Ctrl [` and `Cmd/Ctrl ]` navigate in-app history without leaving the workspace. Press `G` followed by a section letter to navigate; `?` lists every current shortcut. Letter shortcuts are inactive while typing and can be disabled.

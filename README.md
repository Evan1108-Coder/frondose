# Rumbo

A local-first, solo-first AI work environment. Rumbo is evolving around **Intent → Route → Run → Output → Review → Memory**: give specialized agents controlled context, conduct persistent conversations, and review their work. Project management supports that lifecycle rather than requiring a human team.

This transition is incremental. See the [ordered implementation plan](docs/solo-ai-direction.md), [current product status](docs/product-expansion-status.md), and [schema and migration contract](docs/schema.md). Areas, shared provider connections with independent Agent Studio profiles, versioned Skills, reviewed run context, manually advanced multi-agent Workflows, an opt-in run-private native-tool bridge, and the Today command center are implemented foundations. Skill evaluation records exact case-bound provider artifacts with manual verdicts and same-input comparisons. Routes may explicitly require criterion-level evidence before exact-version output approval, retaining immutable accepted checklists. Broader reliability and automation expansion remain unfinished.

Workspace Settings supports an optional uploaded, square-cropped picture. Custom Route and project statuses can carry a chosen line icon without changing lifecycle behavior. The top header groups global Search (including settings and Docs), Focus, Settings, language status, and profile. The UI is currently fully available only in English; the language control explains that broader translations are not yet shipped. AI provider cards lead to provider-specific setup pages before any external authorization.

## Organize your workspace

- **Rumbo Agent** is the dedicated assistant entry point, with a first-use name/purpose/guidelines quiz and six-color visual identity. Existing conversations remain readable; setup gates new ones. Connection readiness, persistent conversations, a chat switcher, explicit model selection and Settings → Rumbo Agent remain available. Documents, Routes, projects, updates and Workbench can prepare a source-linked request; `/rumbo` prepares a draft, never runs a terminal command. Inspect exact context and explicitly send. Account model catalogs are not currently enumerable through the CLI bridge: provider defaults and configured IDs are labeled accordingly, not presented as verified account availability. Workspace actions remain human-reviewed proposals. See [Rumbo Agent setup and boundaries](docs/rumbo-agent-onboarding.md).

- **Today** separates human decisions, executing work, outputs awaiting review, proposed next actions and recent context. Area/Project filters apply to this read-only summary; snoozing remains a browser-personal preference. Failed runs, repeated recorded error codes, due knowledge reviews and outdated Workflow profile pins are inspectable without launching work. Following, Recent, Activity and check-ins remain available. New navigation labels retain existing stored links and sidebar customization.
- **Customize sidebar** is available in the workspace menu, sidebar footer, Settings → Appearance, and search. Reorder sections with accessible up/down controls, choose Always show / With activity / Hide, set count/dot/no badges, and choose row spacing. Save applies the layout; Cancel discards it; Reset layout preserves favorites and shortcut preferences. These preferences belong to this browser and workspace, not other teammates or devices.
- **Favorites** pin projects, Areas, routes, chats, agents, memory, outputs, sessions, Workbenches, documents and saved views using the top-bar pin (or `F` when not typing). Favorites use current names and hide archived records. Individual sidebar items can be hidden and restored without archiving content.
- **Focus** collects pending permissions, blocked/review routes, failed sessions, running work, and ready routes. Filter by project or text. Marking a failure seen only affects your Focus list; it never changes or deletes the session. Approvals must still be reviewed individually.
- **Your agents** in the sidebar shows profiles and active-session counts. The roster includes Favorites and Working now filters. **Chat with agent** opens an existing direct workspace chat or creates one; it does not send a message, connect an account, or launch an agent.
- **Keyboard:** `Cmd/Ctrl K` opens search, `G` then a section letter navigates, `N` then `R/P/T/C/A/M/S` opens a Route/project/Area/chat/agent/memory/session form (the Area shortcut retains its legacy `T` key), `C` creates a Route, `[` toggles navigation, `Shift B` customizes the sidebar, and `?` opens searchable shortcut help. Creation preserves the current project where appropriate. Letter keys are ignored while typing or inside dialogs, and can be disabled in shortcut help. Shortcuts never approve requests or start AI execution directly.

A local-first workspace for projects, conversations, and AI workers. A **Route** connects an intention to its project, chat, agent sessions, and outcome.

## Setup

Requires Node.js 22.16+ or 24+. The reviewed-action executor uses SQLite's transaction-state API; this pass was verified with Node 25.8.2.

```sh
npm install
npm run dev
```

Open [Rumbo](http://127.0.0.1:4174). The server binds to loopback only. A new installation starts with an empty workspace setup; existing local records are preserved during schema upgrades.

## Usage

See [product expansion status](docs/product-expansion-status.md) for the detailed implementation/limitations ledger. New connected workflows include project Workbench (files, Git, real terminals), Home, supervised work plans and repeat Routes, versioned outputs/review, immutable context, knowledge revisions, document and saved-view pages, and project timelines. **The full proposed roadmap is not finished, and this build is not a public multi-user service.**

- Floating sidebar with an extremely subtle navigation-only gradient, centered empty states, responsive layouts, dark/light/system themes, comfortable/compact density, interruptible disclosures, reduced motion, accessible dialogs, and keyboard navigation.
- Resizable workspace and Settings sidebars, edge hover-reveal after hiding, an optional full-width sidebar with an inert draggable/resizable page miniature, configurable header quick access, and a draggable edge-snapping dock for pins hidden from the header. See [sidebar sizing and motion](docs/sidebar-motion-and-sizing.md). Workbench arrival and linked-content previews are documented in [Workbench motion](docs/workbench-motion.md).
- Create and switch workspaces. Create, edit, search, archive, and restore projects, Routes, chats, agents, and memory notes.
- Full project spaces with a Markdown brief, Area, lead, start/target dates, milestones, routes, documents, related conversations, activity, repository/folder links, and project memory.
- Areas organize domains such as Product, Engineering, Research or Personal administration. Existing Team IDs, resources, ownership, history and access grants are preserved. Areas retain scoped projects, Routes, updates, resources and documents; Contacts is optional and existing directory entries are retained.
- Area settings save instructions, default agent selections, reusable Context Packs, read-tool preferences and a review-only policy. These are preparation defaults, not permission grants. Selected Area instructions and packs enter the Context Inspector for explicit review before execution.
- Route status, priority, due date, assigned agent, filters, sorting, list/board views, and drag-to-change status.
- Project-aware conversations with persistent drafts, chat/message search, pinning, text/image previews, copying, message-to-Route, message-to-memory, and Markdown export. The composer explicitly selects a local note or one agent recipient.
- General chat works without a linked folder. Choose project read-only or coding access when working with local files; those modes require a specific project or agent folder. General chat uses a disposable private CLI working directory with restricted tools, not your home or Rumbo's storage folder.
- Lucide interface icons use Morphicons for state transitions and restrained pointer feedback. Keyboard and reduced-motion preferences keep state changes immediate. Rumbo's logo is unchanged; empty states use distinct generated photographic artwork rather than interface glyphs.
- Direct agent sends use a persisted, idempotent turn with visible progress, stop, failure, and retry. Interrupted or failed replies can retry the original message without duplicating it. Uncertain network deliveries retain their send keys across navigation/reload.
- Searchable agent roster with a detail inspector, setup status, profile presets, editing, duplication, pause/resume, and recoverable archiving. Agent-linked session history uses stable IDs, not names.
- Agent Studio content history compares saved versions and restores selected instruction fields only after an exact-text preview and confirmation. Restoration creates a new version without changing provider accounts, models, folders, context or permissions. Skill definition comparison shares the same code appearance and does not transfer test evidence or publish anything.
- Recorded usage is available on run details, Agent Studio and Settings → Usage & limits, grouped by agent, project or Workflow. Provider token families remain separate, missing metrics stay unknown, and partial coverage is visible. Claude client cost estimates are labeled as estimates—not invoices. No account balance, remaining subscription percentage or spend-limit enforcement is claimed.
- Knowledge conflict review records exact approved entry pairs and a human rationale. Keep both or explicitly supersede one; past context remains unchanged. An optional literal same-title difference scan finds review candidates, not all semantic contradictions. Open reports never silently remove sources or authorize actions.
- Workbench checkpoints save bounded text-file snapshots in a linked Git repository. Preview selected files, explicitly confirm a restore, and inspect its recovery snapshot and per-file outcome. Newer edits, changed permissions/roots and active sessions block unsafe restores. Git history and the index are untouched. This is manual, per-file recovery—not an atomic repository backup or automatic agent rollback.
- Agent instructions and default folders. Preview the selected project, route, chat, and working folder before starting work; choose whether to include chat and memory. See [agent behavior and verification](docs/agents-refresh.md).
- Live Codex sessions for analysis or project edits. Live Claude sessions for restricted read/search analysis. Stream events and responses into the local session history and linked chat; stop active work.
- Runs can be renamed and starred or recoverably archived after stopping. Starred collects personal shortcuts across the workspace and is linked from Profile; sidebar tabs can be hidden and restored in Customize sidebar. Update and run-event icons have distinct Rumbo-authored glyphs in the shared Icons catalog, with personal per-workspace choices in Settings → Milestones & updates.
- Structured Route, Project and Chat templates can ask up to 24 custom questions and save their pinned answers with each created item. Settings → Field defaults pre-discovers safe text/search/typed input sites across creation, existing-item, Settings and repeated-row editors, plus active template text questions. Browser-personal primary values, global/per-field/per-value switches, numbered shortcuts and immediate undo preserve existing text; existing records and auto-saving Settings require an explicit shortcut. Credentials, sensitive forms and non-text controls remain excluded.
- Use Rumbo Agent for supported workspace-action proposals and review them explicitly; use Schedule on a conversation message or supported pending action proposal for later work. Settings → Scheduled messages & actions collects accessible schedules, with recorded results in Activity. Scheduling a reviewed action pins its exact target snapshot, not arbitrary future authority. The Playbooks multi-step builder and dispatchers are retired, with stored definitions and receipts preserved as inert history. Existing manual Workflows and preview-and-apply Route rules remain separate and unchanged. See [templates, field defaults and scheduled work](docs/templates-defaults-playbooks.md) and the in-app Docs articles.
- Reviewed live runs may explicitly opt into a private per-run MCP bridge. Read tools return only context captured in that run's approved manifest. Write tools create idempotent pending-review requests; permission requests never grant access, handoffs never start agents, memory remains draft, and submitted output remains review-needed. The bridge is revoked when the run stops or completes and has no browser invocation endpoint.
- Clearly labeled local simulations for testing session events, approval, denial, and stopping without contacting accounts.
- Inbox for outstanding decisions and session updates. Read state and notification preferences persist.
- Local Codex/Claude runner setup, plus explicit OpenRouter and configured Hugging Face browser authorization, account checks, model discovery, tests and disconnect. Non-AI Plugins remain paused. See the provider table below.
- Searchable slash commands in chat and Workbench. The registry includes Rumbo, agent, Git, and connection namespaces; only commands with a real handler are executable. Catalog-only and external connection commands are labeled as previews. Workbench Git/shell commands always open the existing machine/command review and confirmation dialog before execution; raw terminal input is never intercepted.
- Typed project and Route updates with threaded replies, recoverable archiving, and recorded `@agent` requests. An agent mention in an update does not contact or start that agent; users must review and launch agent work separately.
- Profile/image settings, workspace editing, appearance, session defaults, JSON exports, archive restore, and diagnostics.
- No silent demo fallback: failed requests show errors, and rejected optimistic changes roll back.
- Rumbo-authored dropdowns, date picker, dialogs, confirmations, validation, and tooltips, with keyboard navigation and focus management. File selection and provider authorization retain their required browser/OS interfaces.

## Connections

The sidebar's **AI connections** page offers 16 personal API-key providers plus OpenRouter/Hugging Face browser authorization and registered GitHub Copilot OAuth. Copilot uses the pinned official SDK with per-user tokens, fresh private empty sessions, no native/file tools and explicit model verification. Codex and Claude CLI accounts remain local-only; public mode never shares them. A guarded invite-only backend (`npm start`) is available behind HTTPS after owner/app setup, but no public deployment or live paid-account verification has been completed. Provider charges remain each user's responsibility. See [connection status, registrations and hosting prerequisites](docs/ai-connections.md).

The non-AI service marketplace below is preserved under **Settings → Plugins** but is paused. Existing records remain; new authorization, synchronization, imports and provider actions are disabled until explicitly re-enabled and verified.

The Plugin catalog describes planned adapters for GitHub, GitHub Actions, GitHub Packages, Google Drive, Docs, Sheets, Slides, Linear, Jira, Slack, Figma, and FigJam. Adapter code and fixture tests are retained, but their live account/resource/action paths are blocked in this release. Catalog controls and older records do not imply working authorization or synchronization.

See [workspace connector setup and exact supported operations](server/connectors/README.md). These adapters require operator-owned provider application registrations before a user can authorize an account. Their implemented action sets are intentionally explicit: this is not complete feature parity with each external product, a native Slides/Figma editor, or arbitrary two-way synchronization.

The active local runner and browser-account routes are separate:

| Provider | Implemented path | Current scope |
| --- | --- | --- |
| Codex | Existing local CLI sign-in | Reviewed analysis or project work on this machine; not public subscription OAuth |
| Claude Code | Existing local CLI sign-in | Restricted read/search analysis on this machine |
| OpenRouter | Browser authorization | Reviewed conversations/scheduled prompts and pending workspace-action proposals; explicit model, no native/file tools |
| Hugging Face Inference | Browser OAuth after operator setup | Same bounded conversation/action-proposal path; explicit model, no native/file tools |

[AI connections and navigation](docs/ai-connections-navigation.md) explains current routes, Plugin boundaries, header shortcuts and the floating dock. [Connection setup and provider limitations](docs/connection-setup.md) documents prerequisites and future Plugin boundaries. Live provider compatibility still needs account-owner verification; automated tests do not contact real accounts or consume model usage.

## Validation

Run `npm test`, `npm run build`, and `npm run test:sites` from the repository root. The [October 2026 checkpoint](docs/october-2026-checkpoint.md) records the current test counts, browser smoke checks, and known limits. Passing local tests does not verify account-specific AI models, provider billing, Plugin authorization, or public hosting.

## Local data and permissions

Workspace data is in `.rumbo/rumbo.sqlite`. Optional GitHub/Google credentials are in the private, owner-only `.rumbo/integrations.private.json`; they are not encrypted and do not enter exports or browser state. The local server denies static access to `.rumbo`, environment files, and key files.

Do not expose this development server to a network. Optional local account sign-in now uses salted scrypt passwords, opaque expiring sessions, revocation, and one-use invitation links. Workspace APIs enforce membership, four built-in ranks, custom permission roles, scoped/temporary grants, individual exceptions, and owner approval workflows. Custom roles do not create arbitrary new rank levels. Invitations are copied links, not delivered email; password recovery, public hosting, and production identity operations are not implemented.

New workspace OAuth credentials use AES-256-GCM encryption; the private encryption key is stored separately in `.rumbo/connections.key` (or supplied by the operator). Never publish this directory. Legacy credentials described above retain their existing separate storage and are not silently migrated. Workspace exports exclude credentials, governance/account data, and connection caches.

Live sessions send the chosen accessible context to the selected provider. An explicitly delegated connection can expose bounded cached context and reviewed action proposals to an allowed agent. Native tools additionally require an explicit Context Inspector opt-in, a connected profile, the active canonical run, its pinned profile and original sponsor, the captured source manifest, and current scope access. Both the original sponsor’s and reviewer’s current authority are checked before an approved write is applied. Live CLI project-file permissions remain separate and do not provide interactive per-command approvals. Stopping a session revokes its native bridge but does not undo edits already made by the provider process.

Archived records can be restored. Workspace JSON exports can be imported into a new workspace through Settings → Import & export. Imports remap content references, reset approvals and work-plan state, pause repeat schedules, and never restore credentials, active processes or local folder permissions. They are not full installation backups. Back up the `.rumbo` folder when the app is stopped to preserve the full installation.

The Areas migration is additive: storage keeps the legacy `teams` table and `team_id` references. Area settings accompany workspace export/import with reference remapping and review-only permission policy. Legacy Team-directory contacts are not deleted when hidden. See [schema and recovery guidance](docs/schema.md) before changing local data.

## Verify

```sh
npm test
npm run build
```

Tests cover isolated SQLite persistence, cross-workspace validation, optimistic state and rollback, context selection, mocked provider processes and OAuth, stopping races, account-secret redaction, local host protection, and build packaging. Browser QA exercises the actual app using a separate temporary database.

The production build includes Sites-compatible static packaging, but the hosted worker does not provide the local SQLite/CLI runtime. The complete application currently runs through the local Vite server.

## On-screen notifications

Errors and confirmations arrive at the top of the window with a short damped-spring animation. The × button dismisses them without closing a form or discarding its contents. Settings → Notifications → Display duration offers 3, 5, 8 or 12 seconds, or **Until dismissed**. This preference is browser-local, not a workspace setting. Timers pause on hover, keyboard focus and hidden tabs; Undo gets at least 10 seconds. OS and app reduced-motion preferences remove travel. Persistent server-failure state remains visible in the connection indicator after a notice is dismissed.

## Keyboard shortcuts

`Cmd/Ctrl + K` searches work, messages, documents, outputs, saved views and actions, with optional `type:`, `project:` and `status:` filters. `C` opens a new Route form. `Cmd/Ctrl [` and `Cmd/Ctrl ]` navigate in-app history without leaving the workspace. Press `G` followed by a section letter to navigate; `?` lists every current shortcut. Letter shortcuts are inactive while typing and can be disabled.

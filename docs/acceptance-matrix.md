# Talvori V1 acceptance matrix

Status: normative V1 release contract  
Product: local-first localhost application  
Primary form factor: desktop web, responsive down to a narrow browser  
External connections in V1: GitHub, Google Drive, Codex, Claude

## 1. Release definition

Talvori V1 is a small but complete workspace for organizing AI-assisted work. A person can create a workspace, organize projects and tasks, hold linked one-to-one or multi-agent chats, attach project context, start supervised agent work, answer approvals, and revisit all of it after restarting Talvori. The interface uses the compact, calm organization associated with Linear, but its object model, layouts, content, and agent workflows are Talvori's own.

The V1 hierarchy is:

```text
Talvori
└── Workspace (organizational boundary)
    ├── Projects
    │   ├── Tasks
    │   ├── Chats
    │   ├── Context and files
    │   └── Runs
    ├── Workspace chats
    ├── Agents
    ├── Connections
    └── Activity
```

An execution directory is called a **run environment**, not a workspace. This avoids confusing the user's organizational workspace with the folder or Git worktree in which an agent runs.

V1 is not accepted because screens exist. It is accepted only when the primary workflow is persistent, linked end to end, recoverable after ordinary failures, keyboard usable, and proven through the evidence in this document.

## 2. Evidence standard

Each matrix row names the minimum authoritative evidence required. A screenshot, source inspection, or passing build alone cannot prove interactive behavior.

| Code | Evidence type | Standard |
|---|---|---|
| `UT` | Unit/contract test | Deterministic test of a pure rule or injected adapter boundary with exact assertions |
| `IT` | Local integration test | Real local API, SQLite database, filesystem, Git repository, or child-process boundary in an isolated temporary directory |
| `E2E` | Browser end-to-end | Playwright drives the production UI against the real local server; assertions cover visible behavior |
| `VIS` | Visual evidence | Screenshots at the named viewport, reviewed against the Talvori tokens and layout rules |
| `A11Y` | Accessibility evidence | Automated accessibility scan plus keyboard/focus/manual checks where automation is insufficient |
| `SMOKE` | Release smoke | Clean temporary Talvori home, production build/server, no real credentials, full golden path plus recovery cases |
| `MANUAL-LIVE` | Explicit live-provider verification | Separate opt-in test using the owner's account; never part of automated V1 smoke |

General rules:

- Every fallible action must show pending, success, and persistent actionable failure states.
- E2E assertions must describe what the user sees or can do, not private component state.
- Tests use isolated temporary SQLite databases, repositories, files, and ports and clean them up.
- Browser tests may use deterministic clocks and IDs through injected adapters; production code must not contain smoke-only behavior.
- A row marked `MANUAL-LIVE` is **connection certification**, not permission to access an account during ordinary development or smoke testing.
- Requirement status is one of `Not started`, `In progress`, `Proven`, or `Deferred`. Only `Proven` satisfies V1.

## 3. Information architecture and visual system

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| IA-01 | Stable global shell | A compact left sidebar exposes workspace switcher, Inbox/Home, Projects, Tasks, Chats, Live work, Agents, and Settings without burying primary destinations in menus. | `E2E navigation.spec`: reach every destination; `VIS` at 1440×900 |
| IA-02 | Workspace scope is always visible | The selected workspace appears at the top of the sidebar; switching it updates scoped projects, tasks, chats, agents, and counts without leaking records from another workspace. | `IT` scoped queries; `E2E workspace-switching.spec` with two workspaces containing similarly named objects |
| IA-03 | Contextual navigation | Project, task, chat, agent, and run links open the correct canonical object; browser back/forward restores the prior location and selection. | `E2E deep-links-history.spec`, including reload on a detail URL |
| IA-04 | Command access | A command/search palette opens from the visible control and `Cmd/Ctrl+K`, searches core objects, and performs navigation with keyboard only. | `E2E command-palette.spec`; keyboard-only recording |
| IA-05 | List/detail organization | Dense collections use a list/table with a selected detail or inspector; settings use grouped list/detail sections. Information does not become a wall of independent cards. | `VIS` Projects, Tasks, Chats, Live work, Settings at 1440×900 and 1024×768 |
| IA-06 | Talvori visual identity | Neutral gray-to-gray-black palette, restrained status colors, thin borders, compact spacing, sentence-case labels, and one coherent icon family. No gradients, glowing AI effects, robot avatars, or direct copies of Linear assets. | Token/source audit; `VIS` of all primary routes |
| IA-07 | Theme | V1 provides a polished dark theme as the default. If light/system controls are present they must be complete and persistent; otherwise they are absent rather than decorative. | `E2E appearance-persistence.spec`; `VIS` default theme |
| IA-08 | Density and readability | Typical sidebar/list rows are compact, code/output uses monospace, long prose has a readable maximum width, and truncation exposes the full value by tooltip or detail view. | `VIS`; `E2E overflow-content.spec` with long names and messages |
| IA-09 | Status language | Task and run statuses use text plus icon/shape, not color alone. Task status and run lifecycle are never presented as the same state machine. | `UT status-mapping`; `A11Y`; `VIS` status matrix |
| IA-10 | Empty/loading/error states | Every primary route has a deliberate empty state, stable loading skeleton or progress state, and in-context error recovery. Loading does not cause major layout shifts. | `E2E route-states.spec` using delayed/error adapters; screenshot comparison |
| IA-11 | No dead controls | Every visible button, menu item, filter, tab, and shortcut works. Future functionality is omitted or explicitly labeled unavailable with an explanation. | Automated click/route inventory plus targeted `E2E`; manual release checklist |
| IA-12 | Favorites and recents | Users can favorite frequently used projects/chats and see recent objects; favorite state survives reload. | `E2E favorites-recents.spec`; SQLite assertion |

## 4. Workspaces, projects, tasks, and their links

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| ORG-01 | Workspace CRUD | Create, rename, switch, and archive a workspace. Required validation is visible; cancel does not mutate data; archive is recoverable. | `IT workspace-repository`; `E2E workspace-crud.spec` success/failure/reload |
| ORG-02 | Workspace overview | Overview shows active projects, tasks needing attention, active/recent runs, recent chats, and workspace activity with links to each source object. | Seeded `E2E workspace-overview.spec`; `VIS` |
| ORG-03 | Project CRUD | Create, edit, archive, and restore a project with name, goal, description, icon/color, status, dates, and optional local/GitHub/Drive context. | Schema/`IT`; `E2E project-crud.spec` |
| ORG-04 | Project views | Project detail exposes Overview, Tasks, Chats, Context, and Activity. Counts and recent items agree with canonical lists. | `E2E project-detail.spec`; query consistency `IT` |
| ORG-05 | Task CRUD | Create, edit, duplicate, archive/restore, and delete-with-confirmation a task with title, description, acceptance criteria, status, priority, labels, project, and agents. | `IT task-repository`; `E2E task-crud.spec`, including validation and destructive confirmation |
| ORG-06 | Task list and board | Tasks can be viewed as compact list and status board. Search, project/status/priority/agent filters, sorting, and clear-all produce correct results and useful zero-result state. | `UT filter/sort`; `E2E task-views.spec`; `VIS` both modes |
| ORG-07 | Task state | Supported V1 statuses are Backlog, Ready, In progress, Review, Blocked, Done, and Cancelled. Status changes appear in activity and survive restart. | Enum/schema `UT`; `E2E status-transitions.spec`; SQLite assertion |
| ORG-08 | Acceptance criteria | Criteria are individually checkable, reorderable, visible in the task detail and available to run context. Their completion state is not inferred from an agent's claim. | `E2E acceptance-criteria.spec`; run-context snapshot `IT` |
| ORG-09 | Task relationships | A task can link to its project, one primary chat, additional chats, assigned agents, runs, files, Drive items, GitHub resources, and result artifacts. Reciprocal surfaces navigate to the same records. | Relational integrity `IT`; `E2E task-links.spec` |
| ORG-10 | Task detail | Detail presents title/status/metadata, description, criteria, linked chat, agents, context, runs/results, and chronological activity without requiring unrelated routes for basic review. | `VIS`; `E2E task-detail.spec` |
| ORG-11 | Inbox/attention | Inbox groups needs-input approvals, failed runs, ready-for-review tasks/results, and relevant recent completions. Clearing one condition removes only that attention item. | Attention projection `UT/IT`; `E2E inbox.spec` |
| ORG-12 | Activity audit | Create/edit/status/link/assignment/archive actions generate human-readable entries with actor, time, object, and changed meaning. Activity is append-only through normal UI. | `IT activity-log`; `E2E activity.spec` |

## 5. Chats and connected work

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| CHAT-01 | Chat types | Create a general workspace chat, project chat, task chat, one-to-one agent chat, and multi-agent group chat. Every chat belongs to exactly one workspace. | Schema `UT`; `E2E chat-create-types.spec` |
| CHAT-02 | Link management | A chat may link/unlink a project and task from its header/inspector. Linking a task also exposes the chat from that task; unlinking does not delete either object. | Transaction/integrity `IT`; `E2E chat-links.spec` |
| CHAT-03 | Participant management | Add/remove agents from a chat. Removing an agent prevents new implicit routing but preserves its historical messages and runs. | `IT participant rules`; `E2E chat-participants.spec` |
| CHAT-04 | Message composer | Send multiline text, keyboard-submit with configurable behavior, attach supported local/context items, cancel an attachment, and retain an unsent draft per chat. | `E2E composer.spec`; reload/draft persistence assertion |
| CHAT-05 | Message identity | Every message visibly distinguishes user, agent, and system/run event with name, icon/mark, and timestamp. Agent-to-agent messages remain visible to the user. | `VIS`; `E2E message-identities.spec` |
| CHAT-06 | Mentions and routing | Typing `@` offers only eligible participants/connections; an `@agent` mention routes the message to that agent adapter and creates or continues a linked run. Plain messages do not accidentally start every participant. | Mention parser/router `UT`; fake-adapter `IT`; `E2E mentions.spec` |
| CHAT-07 | Agent-to-agent collaboration | A user can ask one agent to request/review another agent's work. The handoff records source run, destination run, supplied context, and visible messages without hidden autonomous loops. | Orchestration policy `UT`; two-fake-agent `IT/E2E collaboration.spec` |
| CHAT-08 | Reply, quote, edit, retry | Users can reply/quote. User messages may be edited before work begins; retry creates a new auditable attempt rather than rewriting completed history. | `E2E message-actions.spec`; history integrity `IT` |
| CHAT-09 | Convert and save | A message can become a task draft and can be saved to project/workspace memory after confirmation. Original message remains linked as provenance. | `E2E message-to-task-memory.spec`; relational `IT` |
| CHAT-10 | Search, pin, export | Search within chat, pin/unpin important messages, and export a complete Markdown transcript with participants, links, and timestamps. | Search/export `UT`; `E2E chat-tools.spec`; snapshot exported Markdown |
| CHAT-11 | Long-history behavior | Older messages load predictably, the visible reading position is preserved, duplicate/out-of-order stream events do not duplicate messages, and reconnect catches up from authoritative history. | Timeline reducer `UT`; disconnect/gap `IT`; `E2E chat-reconnect.spec` |
| CHAT-12 | Work events stay readable | Chat shows compact cards for started work, approvals, failures, and results. Verbose commands/tool output live in expandable run activity rather than flooding normal conversation. | `VIS`; fake long-output `E2E chat-run-events.spec` |
| CHAT-13 | Delete/archive semantics | Chats archive by default. Permanent delete requires confirmation, describes linked tasks/runs that remain, and never deletes those records implicitly. | Cascade-policy `IT`; `E2E chat-archive-delete.spec` |

## 6. Agents, live work, approvals, and results

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| RUN-01 | Agent directory | Agents view shows Codex, Claude, and deterministic Mock agents with connection status, capabilities, model/runtime label where known, current activity, and allowed workspaces. | Adapter snapshot `IT`; `E2E agents-directory.spec`; `VIS` |
| RUN-02 | Configured agent profiles | User can create an alias such as Builder or Reviewer backed by one connection, with default instructions and permission profile. Runtime and model remain explicit; profiles are not presented as human employees. | Schema `UT`; `E2E agent-profile.spec` |
| RUN-03 | Capability-aware controls | Unsupported model selection, resume, steering, attachments, permissions, or tools are disabled/absent with explanation. The app never claims feature parity across providers. | Capability matrix `UT`; adapter-contract `IT`; `E2E agent-capabilities.spec` |
| RUN-04 | Start work | From task or chat, choose agent/profile, context, run environment, and permission level, then start exactly one run despite double-click/retry. Originating task/chat/project links are stored. | Idempotency `IT`; fake-process `E2E run-start.spec` |
| RUN-05 | Run lifecycle | Normalized lifecycle supports Queued, Starting, Running, Needs input, Completed, Failed, Stopped, and Disconnected. Task status is updated by explicit product rules, not by reusing the run enum. | State-machine `UT`; lifecycle adapter `IT`; `E2E run-states.spec` |
| RUN-06 | Live work view | Compact list/table shows status, agent, workspace, project, task, source chat, current meaningful action, elapsed time, change count, and attention. Filters do not hide active attention unexpectedly. | `E2E live-work.spec`; `VIS` populated/empty/error |
| RUN-07 | Run detail | Detail exposes conversation, normalized activity, expandable raw output, context snapshot, permission profile, changes/artifacts, and final result. | Seeded `E2E run-detail.spec`; `VIS` |
| RUN-08 | Streaming correctness | Ordered events render once, batched deltas remain responsive, oversized command output is bounded/collapsible, and a sequence gap triggers authoritative catch-up. | Event reducer/load `UT`; WebSocket gap/reconnect `IT`; browser performance assertion |
| RUN-09 | Follow-up/steering | A follow-up sent during a run uses adapter steering only when supported. If unavailable, Talvori offers a clear queued/interrupt-and-continue choice; an ambiguous adapter error is surfaced and not resent silently. | Adapter behavior `UT/IT`; `E2E follow-up-fallback.spec` |
| RUN-10 | Stop behavior | Stop immediately shows pending, prevents duplicate stop operations, terminates the complete fake process tree, resolves pending approvals, and records Stopped. Timeout escalates and remains actionable. | Child-process-tree `IT` on supported OS; `E2E stop-run.spec` |
| RUN-11 | Approval request | Command, filesystem, external-action, and question approvals appear in chat/run/Inbox with agent, requested action, scope, risk/context, and Allow/Deny. Genuine multiple-choice requests are never auto-approved. | Approval normalization `UT`; fake adapter `IT`; `E2E approvals.spec` |
| RUN-12 | Approval decision | Decision is idempotent, timestamped, auditable, delivered to the exact pending request, and visibly handles already-resolved/disconnected failures. | Concurrency/idempotency `IT`; `E2E approval-race.spec` |
| RUN-13 | Permission profiles | V1 profiles are Observe, Workspace write, and Full access. UI displays provider-specific guarantees and paths; Full access requires explicit confirmation and is never the default. | Policy mapping `UT`; `E2E permissions.spec`; copy review |
| RUN-14 | Context snapshot | Run start stores the exact task brief, criteria, project rules/memory, selected files/Drive items/GitHub references, prior result, and permission settings supplied. Later edits do not rewrite old snapshots. | Immutable snapshot `IT`; `E2E context-snapshot.spec` |
| RUN-15 | Result/evidence | Completed run shows summary, files/artifacts, commands and exit codes, test evidence, unresolved questions, risks, model/runtime, duration, and criteria assessment. Missing evidence is shown as unknown, never inferred as passed. | Result projection `UT`; fake-agent `E2E evidence.spec` |
| RUN-16 | Continue/handoff/review | Continue same agent, hand off to another, or start read-only review; each creates a new linked run with explicit inherited context and preserves prior results. | Run graph `IT`; two-agent `E2E handoff.spec` |
| RUN-17 | Recovery | After server/browser restart, active fake runs reconcile to Running, Disconnected, Failed, or resumable truth; completed history is intact. No run remains falsely Running forever. | Managed-process reconciliation `IT`; restart `E2E run-recovery.spec` |
| RUN-18 | Archive/delete | Archive closes runtime and preserves history. Destructive deletion requires confirmation and handles child runs/artifacts by documented rules. | Lifecycle/cascade `IT`; `E2E run-archive.spec` |

## 7. Connection center and provider readiness

### Shared connection requirements

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| CON-01 | Connection center | Settings → Connections shows exactly GitHub, Google Drive, Codex, and Claude grouped as Services and AI agents, with Not connected, Connecting, Connected, Expired, Unavailable, and Error states. | `E2E connections-overview.spec`; `VIS` all states |
| CON-02 | Honest connection type | Cards state whether connection is browser OAuth, locally detected CLI, or provider-managed login. Talvori does not imply ChatGPT chat-history access or that ChatGPT API usage is included. | Copy/source audit; `E2E connection-copy.spec` |
| CON-03 | Account/resource scope | Connected card shows provider account identity when exposed, granted scopes/capabilities, selected workspace resources, last validation, and Reconnect/Manage/Disconnect. Secrets are never displayed. | Redacted fixture `E2E connection-detail.spec`; log scan |
| CON-04 | Workspace allowance | A connection can be enabled/disabled per Talvori workspace without deleting the underlying connection. Agents cannot use a disabled connection. | Authorization `IT`; `E2E workspace-connection-policy.spec` |
| CON-05 | Secrets boundary | OAuth tokens/API secrets are represented by opaque secret references and never stored in chat, run context, SQLite plaintext fields, client storage, URL query parameters, analytics, or logs. | Schema/source audit; token-canary `IT`; browser storage/log scan |
| CON-06 | Refresh/revoke | Expired credentials move to Expired with reconnect guidance. Disconnect revokes when supported, clears local secret reference, disables dependent actions, and preserves linked historical metadata. | Mock provider `IT`; `E2E disconnect-reconnect.spec` |
| CON-07 | Failure isolation | One unavailable connection does not break other connections or local organization features; partial failure is shown at the smallest relevant scope. | Four-adapter mixed-state `IT/E2E partial-connections.spec` |

### GitHub

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| GH-01 | OAuth-ready authorization | Connect launches the system/browser authorization route with unpredictable `state`, PKCE where supported, exact redirect validation, minimal documented scopes, and a one-time callback exchange. Cancellation and state mismatch are safe failures. | OAuth-state/PKCE `UT`; localhost fake-provider `IT`; `E2E github-oauth-mock.spec` |
| GH-02 | Repository selection | After mock authorization, list accessible repositories, search/select only intended repos, and link/unlink them to a project. Selection survives restart. | Fake API `IT`; `E2E github-repositories.spec`; SQLite assertion |
| GH-03 | Read surfaces | Linked project can display mock repository identity, default branch, recent branches/commits, issues, pull requests, and checks with links and empty/error states. | Connector contract `UT`; fake GitHub HTTP `IT`; `E2E github-read.spec` |
| GH-04 | Safe write actions | Issue/PR creation is draft-first and requires explicit user confirmation. V1 never merges, deletes, or pushes automatically. | Policy `UT`; fake write endpoint assertion; `E2E github-draft-action.spec` |
| GH-05 | Local fallback | If OAuth credentials are not configured, Connections explains that GitHub cloud linking is unavailable; local projects/tasks/chats remain usable. Optional authenticated `gh` detection must be labeled as local CLI mode, not OAuth. | Missing-config `E2E`; fake `gh` discovery `IT` if implemented |
| GH-06 | Live certification boundary | Production GitHub App/OAuth registration, callbacks, scopes, revocation, and selected-account behavior have a documented opt-in certification checklist separate from release smoke. | Checklist plus `MANUAL-LIVE` only after owner approval; never run automatically |

### Google Drive

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| GD-01 | OAuth-ready authorization | Connect uses browser authorization with state/PKCE, exact callback handling, minimal Drive scopes, consent denial handling, and no token in the browser-facing callback URL. | OAuth contract `UT`; localhost fake Google provider `IT`; `E2E drive-oauth-mock.spec` |
| GD-02 | File/folder picker | Search/browse deterministic mock Drive data, select individual files/folders, show type/owner/modified metadata, and link selection to workspace/project/task/chat context. | Fake Drive API `IT`; `E2E drive-picker.spec` |
| GD-03 | Context access | A linked Drive item supplies only selected, supported mock content/metadata to a run snapshot. Unsupported binary/oversized items explain the limitation instead of silently failing. | Content-policy `UT`; adapter `IT`; `E2E drive-context.spec` |
| GD-04 | Permission changes | Revoked file access, expired login, deleted file, API error, and offline network each produce distinct recoverable states without deleting the Talvori link/history. | Fake failure matrix `IT/E2E drive-errors.spec` |
| GD-05 | Missing developer config | Without Google client configuration, the Connect action presents concise setup-unavailable information and does not begin a broken redirect. | Config validation `UT`; `E2E drive-unconfigured.spec` |
| GD-06 | Live certification boundary | Google Cloud consent screen, test users, callback, minimal scopes, token refresh/revocation, and verification requirements are documented for later owner-run certification. | Checklist plus `MANUAL-LIVE`; excluded from smoke |

### Codex

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| CX-01 | Local discovery | Detect Codex on configured/default PATH, record executable/version/capabilities, and distinguish missing, found-but-unauthenticated, ready, and diagnostic error. Refresh is explicit. | Fake executable matrix `IT`; `E2E codex-discovery.spec` |
| CX-02 | Provider-managed auth | Talvori uses Codex CLI/App Server authentication and never copies ChatGPT credentials. UI may open official login/setup but does not promise ordinary ChatGPT chats/history or API entitlement. | Process argv/env/log audit; `E2E codex-auth-states.spec` with fake CLI |
| CX-03 | Adapter contract | App-server adapter covers initialize, catalog, thread start/resume, turn stream, follow-up/steer, approvals, interrupt, history hydration, completion/error, and close/process cleanup. | Fake app-server contract suite `IT`; no OpenAI network |
| CX-04 | Capability normalization | Codex plan/diff/command/file/usage/approval events map to Talvori events without losing raw diagnostic payload; unknown compatible events do not crash a run. | Fixture/unknown-event `UT`; contract suite |
| CX-05 | Existing account semantics | Connection copy says Codex uses the account already authenticated by Codex and provider limits apply. Talvori does not claim to own, transfer, or extend the subscription. | Copy review; visible assertion in `E2E` |
| CX-06 | Live certification boundary | Real login, available models, one harmless read-only prompt, stream, stop, resume, and quota/account display are verified only in an owner-approved manual session. | `MANUAL-LIVE` checklist; automation hard-disabled by default |

### Claude

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| CL-01 | Local discovery | Detect Claude Code on configured/default PATH, version, `auth status`, and supported capabilities; show missing, unauthenticated, ready, expired, and diagnostic error. | Fake CLI matrix `IT`; `E2E claude-discovery.spec` |
| CL-02 | Provider-managed auth | Talvori relies on Claude Code/Agent SDK authentication and never reads/stores account secrets. Reauthentication guidance explains that a new session may be required. | Process/env/log audit; fake-auth `E2E` |
| CL-03 | Adapter contract | Claude adapter covers catalog/modes, new/resumed query, streamed messages/tools, questions/permissions, follow-up, interrupt, missing-resume fallback, result/error, and complete process-tree cleanup. | Fake Claude SDK/CLI contract suite `IT`; no Anthropic network |
| CL-04 | Capability normalization | Claude plan/tool/file/usage/question/permission events normalize without presenting application permissions as an OS sandbox. Unsupported features are explicit. | Event fixtures `UT`; capability `E2E` |
| CL-05 | Existing account semantics | Copy says Claude uses the account/configuration managed by Claude Code and Anthropic determines plan, limits, and billing. Talvori makes no stronger subscription-credit promise. | Copy review; visible assertion in `E2E` |
| CL-06 | Live certification boundary | Real login, model listing, harmless read-only prompt, permission, interrupt, resume, and expired-login recovery are verified only after owner approval. | `MANUAL-LIVE` checklist; automation hard-disabled by default |

## 8. Local-first persistence, files, and security

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| LOC-01 | Local data ownership | Workspaces, projects, tasks, chats, messages, links, profiles, settings, runs, events, context snapshots, approvals, and artifacts persist in a local SQLite database controlled by the local server. | Migration/schema review; repository `IT`; restart `E2E` |
| LOC-02 | Durable writes | Multi-record operations use transactions. Server interruption cannot leave one-sided links, duplicated sends, half-created runs, or corrupt settings. | Fault-injection/transaction `IT` |
| LOC-03 | Migration and bootstrap | Clean start creates schema/default workspace safely; existing supported schema upgrades once; failed migration preserves/backs up prior data and shows recovery guidance. | Clean/migration/failure `IT`; bootstrap `E2E` |
| LOC-04 | Local server ownership | The local Node server owns durable state and child processes. Closing/reloading the browser does not end a run; stopping the server reconciles managed fake processes on restart. | Real process `IT`; browser-close/restart `E2E` |
| LOC-05 | Network boundary | Server binds to loopback by default, validates Host/Origin, uses authenticated mutating requests/WS sessions, and does not expose data through permissive CORS. | HTTP/WS security `IT` for hostile origin/host/no token |
| LOC-06 | File selection | Native/browser-supported folder/file selection resolves validated canonical paths through the local backend; UI displays granted roots and rejects traversal/out-of-scope access. | Temporary filesystem/path traversal `IT`; `E2E file-context.spec` |
| LOC-07 | Git/run environment | For Git projects, run config shows repository root/base branch/current status and can use an isolated temporary worktree. Uncommitted user work is never overwritten or discarded implicitly. | Temporary Git repo/worktree `IT`; dirty-repo `E2E` |
| LOC-08 | Secret redaction | Known token/credential canaries are redacted from UI events, exports, logs, error reports, and persisted raw payloads according to policy. | Canary `IT`; recursive test-home/log scan after `SMOKE` |
| LOC-09 | Data management | Settings shows local data path and offers export, backup, and destructive reset/delete actions with confirmation and dependency explanation. Export is readable and excludes secrets. | Export/import or backup `IT`; `E2E data-settings.spec`; archive inspection |
| LOC-10 | No hidden telemetry | V1 sends no Talvori analytics/telemetry. External network is used only by explicitly invoked connector/provider adapters. | Network-deny smoke; dependency/config audit |

## 9. Local account and settings completeness

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| SET-01 | No Talvori cloud account | V1 opens into local setup without sign-up. A local profile name/avatar preference is optional and clearly device-local. | Clean-start `E2E onboarding.spec` |
| SET-02 | Onboarding | First run explains local-first behavior, external-provider data boundaries, creates/chooses a workspace, and offers connection setup that can be skipped. Completion persists; onboarding can be revisited. | `E2E onboarding.spec` complete/skip/reload; `VIS` |
| SET-03 | General settings | Settings includes appearance, default workspace/start page, composer send behavior, notifications where supported, and confirmation preferences. Every exposed value persists and has Reset to default. | Settings schema `UT`; `E2E general-settings.spec` |
| SET-04 | Agent settings | Configure executable override, refresh/diagnose connection, default profile/model/mode when supported, default permission, and allowed workspaces for Codex/Claude. Invalid paths/settings fail in place. | Adapter/config `IT`; `E2E agent-settings.spec` |
| SET-05 | Connection settings | GitHub/Drive detail exposes configuration status, account/scope/resource management, reconnect, disconnect, and provider-specific help without exposing secrets. | `E2E connection-settings.spec` |
| SET-06 | Workspace settings | Rename/icon, default task statuses, project membership summary, enabled agents/connections, local context roots, and archive/danger zone are organized in predictable sections. | `E2E workspace-settings.spec`; `VIS` |
| SET-07 | Keyboard shortcuts | Discoverable shortcut reference reflects implemented shortcuts and detects conflicts; critical actions remain available without shortcuts. | Shortcut registry `UT`; keyboard-only `E2E` |
| SET-08 | About/diagnostics | Show Talvori version/build, local server/database status, sanitized diagnostics export, and links/copy for recovery. Diagnostics never include secrets or complete private document contents. | Diagnostic schema/redaction `UT`; `E2E diagnostics.spec` |
| SET-09 | Destructive action safety | Archive, disconnect, clear local data, remove context root, and permanent delete use differentiated confirmations and state exact impact/recovery. Repeated click cannot duplicate damage. | `E2E danger-zone.spec`; idempotency `IT` |

## 10. Error, disconnect, offline, and degraded states

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| ERR-01 | Local server disconnect | Loaded UI shows a persistent disconnected banner, disables unsafe mutations, keeps already loaded content readable, retries with bounded backoff, and reconciles after reconnect. | Server-kill/restart `E2E local-disconnect.spec` |
| ERR-02 | Internet offline | Local organization, search, editing, and history still work. GitHub/Drive display offline and retry; no local action is mislabeled failed because a connector is unavailable. | Network-blocked `E2E offline.spec` |
| ERR-03 | Provider unavailable | Missing/crashed/unauthenticated fake provider changes only its connection and affected run state. User can diagnose, retry, choose another agent explicitly, or keep local work. | Provider-crash `IT/E2E provider-unavailable.spec` |
| ERR-04 | OAuth denied/state mismatch | Denial, closed popup/tab, callback timeout, replayed code, and state mismatch produce safe errors, no Connected state, no stored secret, and a usable retry. | OAuth attack/failure `IT`; `E2E oauth-errors.spec` |
| ERR-05 | Rate limit/quota | Normalized rate-limit/quota error identifies the provider, preserves the task/chat/run, and offers provider-appropriate retry/later guidance without silently switching agents. | Fixture `UT`; fake adapter `E2E quota.spec` |
| ERR-06 | Validation/concurrency | Stale edit, duplicate message, double start, already-resolved approval, and archived target return explicit conflict behavior rather than corruption or silent loss. | Concurrency/idempotency `IT`; `E2E conflicts.spec` |
| ERR-07 | Partial data failure | Lists render usable successful data alongside scoped connector/project failures. A single bad record cannot blank the entire route. | Corrupt-record/failing-adapter `IT/E2E partial-failure.spec` |
| ERR-08 | Recovery copy | Errors state what happened, what was preserved, and the next safe action. Raw stack traces/codes are behind sanitized diagnostics, not primary UI. | Copy review; all failure screenshots |

## 11. Accessibility and responsive behavior

| ID | V1 requirement | Acceptance behavior | Required evidence |
|---|---|---|---|
| UX-01 | Semantic structure | One main landmark, named navigation, correct heading order, real buttons/links/forms, table semantics where applicable, and dialog labeling/focus trap. | Automated `A11Y` scan on every primary route; DOM assertions |
| UX-02 | Keyboard completeness | Workspace switching, global navigation, lists, board/task actions, chat, approvals, menus, dialogs, tabs, and settings are operable without a pointer. Escape closes transient surfaces and focus returns to trigger. | Keyboard-only `E2E keyboard.spec`; manual check |
| UX-03 | Focus visibility | Every interactive element has a clearly visible theme-appropriate focus indicator that is not clipped by overflow. | `VIS` focus-state sheet; manual keyboard review |
| UX-04 | Contrast and non-color cues | Text/controls meet WCAG AA contrast; state, priority, error, and connection health use labels/icons in addition to color. | Automated contrast scan plus manual token audit |
| UX-05 | Announcements | New messages, run/connection status changes, inline validation, approvals, and errors use appropriately scoped live regions without repeatedly announcing streaming token deltas. | Screen-reader-oriented DOM `UT/E2E`; manual VoiceOver spot check |
| UX-06 | Reduced motion | Reduced-motion preference removes nonessential transitions/pulses; no continuous decorative animation. | Media-query `E2E`; `VIS`/source audit |
| UX-07 | Desktop layout | At 1440×900 and 1280×800, sidebar, working content, and optional inspector are usable without horizontal page scroll; dense data remains legible. | `VIS` all primary routes at both sizes |
| UX-08 | Medium layout | At 1024×768, inspector becomes a drawer/collapsible panel and navigation remains accessible without covering the active control unexpectedly. | Responsive `E2E`; `VIS` primary routes |
| UX-09 | Narrow layout | At 768×900 and 390×844, navigation, list/detail, chat composer, dialogs, and approvals reflow to single-pane routes/drawers; no clipped controls or unusable hover-only actions. | Responsive `E2E narrow.spec`; `VIS` selected flows |
| UX-10 | Content stress | Long workspace/project/file names, long unbroken output, many agents, large counts, and 200-message histories do not overlap controls or destabilize layout. | Seeded stress `E2E`; screenshots/performance trace |

## 12. Safe release smoke suite

The smoke suite must run against the production build and actual local server. It must not use real GitHub, Google, OpenAI, Anthropic, Codex, or Claude credentials and must fail if an unexpected external network request occurs.

### Test environment

- Create a temporary `TALVORI_HOME`, SQLite database, file tree, and Git repository.
- Allocate an ephemeral loopback port; never assume the developer port is free.
- Put deterministic fake `codex` and `claude` executables first on the child-process `PATH`.
- Start localhost fake OAuth/API servers for GitHub and Google Drive.
- Configure connector client IDs/secrets as test-only fixture values held outside rendered state.
- Deny or record all non-loopback network access; fail the suite if any occurs.
- Use token canaries in fake auth and assert they never appear in browser storage, SQLite business tables, exports, logs, screenshots, or run context.
- Tear down the complete fake process tree and remove all temporary directories even after failure.

### Golden-path smoke

| Step | Required user-visible result | Authoritative assertion |
|---|---|---|
| S-01 | First run opens local onboarding | Production page mounts; no console/page errors; local server health is ready |
| S-02 | User creates Workspace A and Workspace B | Sidebar switcher shows both; scoped data does not leak between them |
| S-03 | User creates a project and links the temporary repository | Project overview and context show canonical local path/Git metadata |
| S-04 | User creates task with criteria, priority, labels, and agents | Task appears in list/board and project; reload preserves every field |
| S-05 | User creates a project group chat and links the task | Chat and task navigate reciprocally; participants are visible |
| S-06 | Mock GitHub OAuth connects and one fake repo is selected | Connected detail shows fake account/scopes/resource; state/PKCE callback was validated |
| S-07 | Mock Drive OAuth connects and one fake document is attached | File appears in project/chat/task context; only selected fixture content is available |
| S-08 | Fake Codex and Claude are detected | Agents page shows versions/capabilities/Ready without accessing real homes or networks |
| S-09 | `@codex` starts fake work from the task chat | Exactly one linked run appears in Live work with correct origin/context/permissions |
| S-10 | Fake run streams text, tools, command output, and a changed file | Chat stays readable; run timeline ordered; diff/artifact visible |
| S-11 | Fake run requests command approval | Approval appears in chat, run, and Inbox; Allow resolves exact request and is audited |
| S-12 | User asks `@claude` to review the first result | Second linked run inherits explicit diff/criteria context and shows agent-to-agent handoff visibly |
| S-13 | Both runs finish | Task enters Review by product rule; evidence shows commands, exit codes, files, risks, and criteria assessment |
| S-14 | User accepts result and saves a message as memory | Task becomes Done; activity and memory preserve provenance |
| S-15 | Browser reload and local server restart | Workspace/project/task/chat/messages/connections metadata/runs/evidence/settings restore without duplicates |
| S-16 | User exports the task/chat record | Export is readable, linked, complete, and contains no token canary |

### Recovery smoke

| Step | Injected condition | Required result |
|---|---|---|
| R-01 | OAuth consent denied | Connection remains Not connected; actionable retry; no secret/reference persisted |
| R-02 | OAuth callback has wrong/replayed state | Request is rejected and audited safely; app remains usable |
| R-03 | GitHub succeeds while Drive returns 500/offline | GitHub/local features work; Drive alone shows recoverable error |
| R-04 | Fake agent crashes during startup | Run becomes Failed with retry; orphan process count is zero |
| R-05 | Fake agent hangs after Stop | Stop escalates, kills process tree, and ends as Stopped/error with clear evidence |
| R-06 | WebSocket disconnects during event stream | Visible disconnect state; reconnect catches up exactly once from authoritative sequence |
| R-07 | User double-clicks send/start/approval | One message/run/decision is stored and shown |
| R-08 | Local server restarts with a recorded managed process | Reconciliation produces truthful state; no forever-Running row |
| R-09 | Internet access is blocked | All local CRUD/search/history/export works; only external connectors show offline |
| R-10 | Token canaries appear in fake raw payload/errors | Persisted/displayed/exported/logged values are redacted |

### Smoke pass artifacts

The release run must retain:

1. Production build log and exact commit identifier.
2. Unit/integration/E2E test summaries with zero unexpected skips.
3. Browser console and local-server logs, sanitized.
4. Screenshots of the golden-path primary routes at 1440×900 and narrow layout samples at 390×844.
5. Accessibility scan results and keyboard checklist.
6. External-network request ledger proving only loopback fixture traffic occurred.
7. Recursive canary scan result for the temporary Talvori home, export, logs, and browser storage.
8. Process cleanup result showing no fake provider process remains.

## 13. Explicit non-goals for V1

These are excluded from V1 and must not appear as active but nonfunctional product promises:

- Importing or mirroring ordinary ChatGPT chat history.
- A Talvori cloud account, team synchronization, billing, or enterprise roles.
- Linear, Slack, Jira, Notion, Figma, deployment, CRM, or marketplace integrations.
- Mobile/desktop packaging, remote relay, remote runners, or background cloud agents.
- Autonomous hidden multi-agent loops, schedules, heartbeats, or unattended external writes.
- Automatic Git push, merge, production deployment, issue/PR publication, or destructive provider actions.
- Full embedded IDE, terminal replacement, or arbitrary provider catalog.
- Live account tests during normal development, CI, browser smoke, or visual QA.

## 14. Research-derived design constraints

These constraints are informed by Paseo's current public architecture while keeping Talvori's product model distinct:

- A local daemon/server, not the browser tab, owns agent lifecycle and authoritative state: [Paseo architecture](https://github.com/getpaseo/paseo/blob/main/docs/architecture.md).
- Provider adapters wrap installed, provider-authenticated runtimes; capabilities and native settings differ: [Paseo providers](https://github.com/getpaseo/paseo/blob/main/docs/providers.md).
- Live streams provide immediacy, but bounded paged history is authoritative after reconnect: [Paseo timeline synchronization](https://github.com/getpaseo/paseo/blob/main/docs/timeline-sync.md).
- Worktrees are an execution isolation option, not Talvori's organizational workspace: [Paseo workspaces](https://github.com/getpaseo/paseo/blob/main/public-docs/workspaces.md).
- Provider credentials remain provider-managed and the local server must defend even a localhost boundary: [Paseo security](https://paseo.sh/docs/security).
- Fallible actions require visible pending, success, and recovery behavior; real UI flows need browser-level evidence: [Paseo testing](https://github.com/getpaseo/paseo/blob/main/docs/testing.md).
- Paseo is intentionally workspace-centric and removed its former shared chat-room feature; Talvori intentionally keeps durable linked chats as a first-class differentiator: [legacy compatibility schema](https://github.com/getpaseo/paseo/blob/main/packages/protocol/src/chat/types.ts).

## 15. Completion gate

Before declaring V1 complete, create a requirement-status copy of this matrix and attach the exact evidence for every row. V1 is not complete if any requirement is `Not started`, `In progress`, weakly inferred, or supported only by a screenshot/source inspection when the row requires behavioral evidence. The four `MANUAL-LIVE` connector certifications may remain explicitly pending until the owner authorizes account use, but the fake-provider contracts, safe connection states, and no-real-account smoke must all be `Proven`.

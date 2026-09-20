# Rumbo product expansion — implementation and limits

Updated September 19, 2026. This is a coverage ledger for the supplied product roadmap, not a statement that every roadmap item is finished. The app remains a **localhost development product**, now with optional local accounts and enforced workspace access. No real provider account was connected, paid agent invoked, or production workspace populated during QA.

## What you can use now

### Shared changes and reviews (September 20, 2026)

Workbench, project Changes, Routes, session/chat results, GitHub pull requests and document revision history share a file-aware comparison component. Library output and knowledge-version comparisons reuse it, and quoted Markdown patches are labeled as unverified text. Chat/document code blocks follow the same personal code appearance. File-type badges, unified/split layouts, expanded captured context, search, wrapping and whitespace filtering are supported.

Repository/document review snapshots persist exact versions, line comments and per-person reviewed-file state. Project views aggregate linked snapshots; copyable links retain the snapshot ID and recheck access. Local Git supports working, staged and two-ref comparisons without changing the checkout. Eligible future live runs attempt before/after capture of the linked default Git folder; concurrent edits can be included, so this is observation rather than authorship proof. Agent follow-ups save editable chat drafts and never launch an agent automatically.

GitHub supports PR patches, inline discussions, reviews and checks plus explicit Comment/Approve/Request changes submissions (including a selected line). Existing enabled-feature permissions and exact-action owner approvals apply. Stale heads are rejected; same browser-tab retries retain their request key. Real GitHub authorization and review submission remain **not live-verified**. Provider-provided absent context is not fabricated.

Limits: local/PR review previews are bounded to 200 files, approximately 2 MB total patch text and 300 KB per file. Private paths, symlinks, large and binary files are excluded or explained, not silently called fully reviewed. Large visible patches render in 1,000-row increments. Snapshots/comments persist in the database but are not yet included in workspace JSON export/import. Review markers are not approvals, Git merges, or Route completion. No public deployment is implied.

### Governance and Group 1 connections

Local account setup, password sign-in, session revocation, one-use copied invitation links, four management ranks, custom permission roles, individual grants/denies, team/project/connection scopes and expiry are implemented. Owner promotions and departures use owner-electorate approvals. Multi-owner destructive workspace actions and high-impact external actions require exact-target approvals. Delegated agents cannot approve requests, elevate privileges, see tokens, or act after their sponsor loses permission.

The marketplace includes fourteen entries: existing Codex/Claude runners and twelve SaaS adapters. OAuth registration is an operator prerequisite; the UI exposes it explicitly. Available provider-specific operations, OAuth requirements, and limitations are listed in `server/connectors/README.md`. Per-connection settings control selected resources, enabled actions, agent allowlists, cached imports, conflict handling, durable read jobs, scheduled reconciliation and supported signed webhooks. GitHub adds remote code browsing/comparison; Code & reviews adds shared personal code-display preferences.

Not complete: arbitrary custom management-rank levels; temporary rank promotions (temporary permission grants are implemented); email invitations and recovery; public deployment; general two-way field synchronization; full native Slides/Sheets/Figma editing; autonomous multi-step agent tools. Current agent actions are bounded, reviewed final-reply proposals. Provider account compatibility still needs live verification after operator registrations. Do not infer these missing features from the connection catalog.

### Workbench

Open Workbench from the sidebar or a project. A project without a folder still has a planning overview. Explicitly linked folders enable a scoped file tree, filename/content search, text preview, pins, Git status and diffs, branch/worktree inspection, and deliberate worktree creation. A worktree must belong to the project's repository; it does not switch the project's working folder silently.

Real xterm terminals use node-pty, with resize, input, stopping, retained output, and reload recovery. Saved commands and discovered package scripts require a confirmation before running. There is no background command execution merely from opening the page. The local preview checker validates an explicitly chosen localhost port; it does not deploy a project.

Settings inside each Workbench persist panel visibility, file wrapping, terminal font size and terminal count limit. Settings → Workbench explains the boundary and links to project environments.

**Important:** terminals run as the current OS user, not in a sandbox. Closing their panel is not stopping their process. Server restart ends live processes; saved history remains. Workbench has bounded output and basic sensitive-file/path protections, not an assurance that arbitrary shell commands are safe.

### Connected work and review

Route work agreements hold a human owner, required reviewer, expected output type, acceptance checklist, parent route and blocking dependencies. Parent/dependency cycles are rejected. Outputs link back to a route, project, source conversation or producing run.

Library has versioned outputs, comparison with the previous version, quote-anchored comments, resolution/reopening, named review decisions, and Markdown export. Approval requires the current version and linked acceptance criteria. A new version needs a new review. Requested changes create a linked revision Route with feedback; they do not dispatch an agent, merge Git changes or mark the original work complete automatically. Reviewer names are recorded attribution, **not authenticated signatures**.

Projects have direction/scope/success/exclusion fields, explained health, owned risks/questions, a retrospective and milestone acceptance criteria. The timeline uses real project dates, route due dates and milestone targets, lists undated work separately, and flags an unfinished dependency whose due date is later than the dependent route. It is a date map, not a forecast or an automatic scheduling engine.

### Context and conversations

Agent awareness now supplies up to 30 recent projects, routes, teams and document titles plus interface preferences and recent action outcomes on each eligible live reply. Context remains bounded and can be disabled in Settings → Agent awareness. It does not include credentials or automatically read document contents. Extremely long prompts can exhaust the context budget and omit awareness.

Completed replies can propose allowlisted preference updates, project/route/document edits, reversible archives and persistent memory creation. All requests require an authored human review dialog; unsupported actions, cross-workspace targets, archived parents, stale values, active-session changes and repeated decisions are rejected by the server. This is a final-reply proposal protocol, **not yet native interactive agent tools**. Provider compatibility is tested with injected responses only. Approval does not automatically start another paid run.

Approved memories are scoped by workspace, agent and optional project. Chat context and Agent awareness settings show their contents and provide confirmed forgetting. Disabling saved memory excludes them from subsequent prompts. Existing conversations are not erased. These new memory/action tables persist across restarts but are not yet included in workspace JSON export/import; database backups remain necessary to preserve them. Public multi-user authorization is still not implemented.

The conversation list resizes by dragging its right edge, folds below a threshold and automatically folds on narrow containers; a labeled button restores it. Chat context has padded sections, bounded scrolling and a fixed footer. Agent progress is separated when the provider marks commentary, folds after completion, and remains reopenable. Provider failures use short explanations with expandable diagnostics; a 403 still requires resolving provider access, not just changing UI.

Conversation additions include replies/threads, quotation, bookmarks, visible recipient and access mode, queued follow-up **drafts**, branch-from-message history, project moves with context warnings, context previews and immutable context selection, and message conversion to Routes/documents/outputs/memory. Branches and drafts never run agents automatically. General discussion needs no folder; coding still requires a chosen working location.

The send/retry pipeline is tested with injected provider implementations: duplicate protection, restart persistence, failed/empty replies, stops and strict context attachment validation. **Real Codex/Claude replies and current account compatibility still need the owner's test.**

Message actions now include explicit multi-selection, copy/export and cancellation. Hover or keyboard focus exposes React. The reaction picker has 253 distinct line icons (16 original Rumbo glyphs plus Lucide), 631 Unicode emojis, searchable categories, preset icon colors and custom hex tints. Reactions persist through reload and workspace export/import with scope checks. General-chat Codex launch overrides no longer recreate transportless MCP entries when user configuration is ignored; failed configuration and empty replies remain explicit errors. No global provider configuration was edited.

### Pictures, resources and visual feedback

Project and profile pictures accept PNG/JPEG/WebP upload or drag/drop, then a custom crop, zoom and reposition dialog. Saved pictures are bounded 512px thumbnails. Teams have a Resources overview section and a dedicated tab for files, images, audio/video, safe URLs, GitHub branch links and Rumbo references. Resources support search, editing, archive/restore and explicitly confirmed deletion after archive. File limits are 25 MB each and 250 MB per workspace. URL favicons are requested directly from the linked site's origin, not by the server.

Team sidebar children deep-link to each section. Navigation is darker than the canvas. A 57-composition catalog gives empty states distinct monochrome illustrations; shared Lucide/Morphicons glyphs have semantic pointer feedback, including decelerating gears and head-first arrows. Keyboard activation is immediate, and reduced-motion preferences cancel travel/morph feedback. The Home setup checklist has been removed.

Library knowledge distinguishes facts, decisions, preferences and instructions; supports draft/approved/superseded states, rationale and review dates; and can be archived/restored. Editing approved content resets approval. Revision history uses the recorded change log, including pre-edit text, and can restore text into an unsaved draft. History begins with change logging; it is not retroactively reconstructed or tamper-proof. Library snapshot backlinks show where the entry was captured. Restoring knowledge never rewrites frozen snapshots.

### Organization and coordination

- Home: attention/active/ready work, project grouping, snooze/bring-back, followed projects, recent places, activity and a check-in change count. Preferences are per browser/workspace.
- Coordination: persisted work plans, prerequisite gates, human/agent assignments, explicit session preparation, result/handoff records, pause/resume, queue, handoffs, requests, saved queries, goals and templates. Prepare opens a session form; users still review and launch it themselves. Linking a resulting run to a plan step is currently explicit, not automatic.
- Repeating Routes: persisted interval/date schedules, pause/resume, deliberate generation of a due occurrence, optimistic concurrency and request replay protection. **This is supervised recurrence, not a background scheduler.** It never schedules an AI run. Duplicate and split actions copy briefs/checklists into new unassigned Ready routes without losing the source.
- Sidebar: hide individual projects, teams, agents, chats and saved views; restore them in customization. Hiding is a personal presentation preference, not archive or permission control. Saved queries open directly from the sidebar.
- Favorites: projects, teams, routes, chats, agents, memory, outputs, runs, Workbench projects, documents and saved views. Not every resource type is pinnable yet.
- Search: workspace-wide content plus `type:`, `project:` and `status:` filters, excerpts and message deep links. Documents and saved views now have permanent in-app pages and links rather than editor-only access.
- Back/forward: a bounded, workspace-local in-app navigation history and `Cmd/Ctrl [` / `Cmd/Ctrl ]`. It resets when changing workspace or reloading and does not navigate outside Rumbo.

### Import, settings and safety

Operational pages are reachable outside Settings. Settings configures Home, coordination, output-review policy, Workbench and existing workspace resources. Consequential command execution and review decisions remain explicit.

Workspace export/restore includes the new workflow content, message bookmarks, validated reactions and project pictures. Imports validate and remap references inside a transaction and create a **new** workspace. Folder grants, credentials, active runs and terminal permissions are never restored. Outputs require fresh review, approved knowledge becomes draft, work plans and repeat schedules are paused, and completed/dispatched plan states are reset. Library snapshots retain their captured text; stale references require new review. Chat follow-up drafts, branch relationships and the full change-log/knowledge revision history are not restored. Team Resource uploads are not part of the workspace JSON archive; download those files individually. Imported message text is not reinterpreted as trusted current agent context.

## Remaining roadmap work

| Area | Still missing or partial |
| --- | --- |
| Onboarding | Use-case selection, an optional isolated example workspace and a first-work brief/context wizard. The prior Home setup checklist was removed at the owner's request. |
| Navigation | Favorites for every resource type, recently closed panels, saved per-panel scroll/width, and complete cross-object related menus. Native browser history exists independently of Rumbo's in-app history. |
| Home | Following objects other than projects, contextual question ownership, grouped notifications and richer per-project digests. The existing Inbox has read state; Home check-in counts are not a notification service. |
| Projects | A dependency-line timeline, consolidated resource/link management and a structured decision log tied to all affected work. Knowledge decisions and project documents provide part of this today. |
| Routes | Merge duplicates with reference migration, duplicate suggestions, nonblocking related-route links, automatic recurring creation, and scheduled reminders. |
| Chats | Source-linked generated summaries, edit-prompt-and-branch in one action, all desired two-pane layouts, and live-provider end-to-end verification. |
| Agents | Full workspace/team/project instruction inheritance and conflict detection, project overrides, instruction restoration UI, verified safe live test tasks and explicit provider fallback policies. |
| Coordination | Automatic plan/run binding, reviewer-agent dispatch, overlap/duplicate-work warnings, bounded retry/escalation and whole-workflow stop-impact preview. Existing pause prevents preparation; it does not terminate runs. |
| Knowledge | Team-specific scope, contradiction suggestions and complete cross-object backlinks. The current history viewer displays up to the API's latest 100 change records. |
| Outputs | Dedicated attachment/evidence storage, specialized code/image viewers, exact review-version deep links and controlled external sharing. Current output content is Markdown/text with provenance links. |
| Settings | Universal setting-level anchors/search, inherited values, resets for every section and historical configuration restoration. Some section resets and history already work. |
| Layout and errors | Remembered resizable split panels and contextual error-help panels. Responsive custom dialogs, keyboard/focus states and reduced motion are implemented. |
| Public service | Public identity operations/recovery, invitation email delivery, cross-device sync, hosted execution/local runner pairing, verified backups and billing. Local sign-in, copied invitation links, encrypted workspace credentials and enforced role permissions are implemented, not a production deployment. |

Public service work still needs a hosted identity/deployment service and a trusted execution architecture. Do not expose the current localhost API publicly. Governance memberships now enforce access; legacy team-directory names alone do not create accounts or grants.

## Verification

Reproducible checks live in:

- `npm test` — persistence, validation, scope, request replay, workflow review gates, context safety, import rollback, navigation, timeline and Workbench tests; provider adapters use injected implementations.
- `npm run build` — production client plus preserved Sites static packaging. Static hosting alone does not supply the local API/PTY runtime.
- `scripts/test-product-ui.mjs` — full app/settings rendering, Home, sidebar hiding, saved views/documents/history, plans, repeat routes, navigation, custom dialogs and desktop/320/390px checks.
- `scripts/test-workflow-ui.mjs` — route agreement → output → review → revision; knowledge → snapshot → chat note; knowledge restoration; strategy/milestone acceptance.
- `scripts/test-workbench-ui.mjs` — actual PTY and Git operations inside a disposable fixture, project roots, file pins, history, settings, mobile and folder-free planning.
- `scripts/test-settings-ui.mjs` — all settings editors, labels/statuses/templates/rules, persistence, archive/restore, content import and export, responsive/light-theme checks.

Browser scripts accept `RUMBO_PLAYWRIGHT_MODULE` when using an externally installed Playwright. Each script starts an isolated API/database/cache and removes only its own temporary fixture. None connects a real AI account.

Latest verification: 313 unit/API tests passed; production build and Sites packaging tests passed. Isolated browser checks covered the marketplace, member/custom-role creation, permission policies, scoped grants, agent delegation, sync settings, protected cache removal, local account setup/invitations/sign-in, code appearance persistence and mocked GitHub file/diff browsing at 1440×960 and 390×844. No framework or runtime errors were observed. The build retains a main-bundle size warning. Live provider account compatibility, public hosting and arbitrary external-product feature parity were not verified or claimed.

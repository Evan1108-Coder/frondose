# Frondose settings and organization — proposed product design

Status: historical proposal, partly implemented and superseded by later user decisions. September 19, 2026. See [implementation record](settings-implementation.md) for actual behavior, verification, and remaining work. The Local system navigation below was explicitly rejected and is not implemented.

## Purpose

Settings should configure how people organize, instruct, supervise, and reuse AI work. They are not a reason to add unrelated product modules. Success means a user can find a control, understand whom it affects, predict its effect, and reverse a change without losing work.

The supplied Linear screenshots are references for information hierarchy, a dedicated settings sidebar, grouped rows, restrained styling, and clear administration boundaries. Keep Frondose's terminology, brand, Lucide/Morphicons system, and local-first constraints.

## Existing foundation and important gaps

The current implementation has profile, workspace, appearance, notifications, data/export, archive, and diagnostics pages. It also has sidebar customization, shortcuts, favorites, Focus, agent profiles, project/team spaces, documents, memory, and connection setup surfaces.

Some settings shown on the workspace page currently use the installation-wide settings table. Do not label them workspace-specific until storage and consumers really enforce that scope. Sidebar customization is currently browser-local and workspace-specific; it must continue to say so. Local people records are not accounts or invited collaborators. JSON export is not currently a restorable backup. Existing integration code is not evidence that every provider has been verified with a real account.

## Settings shell

- Replace the normal work sidebar while in Settings. Top: Back to app, workspace selector, Search settings. Preserve the previous work route, selected entity, project scope, and scroll position on return. Direct settings links fall back to the user's home view.
- Grouped settings navigation, not one long unstructured list. A team subsection appears only after selecting a team.
- Main panel fills the viewport; the reading/form column is approximately 800–900px wide, with responsive padding. Long pages scroll independently of navigation. Mobile uses one authored navigation sheet, not two squeezed columns.
- Use current neutral dark surfaces, Inter, thin borders, 12px groups, 6px controls, restrained indigo primary actions, brightened hover/focus text, and Lucide icons. No decorative charts, purple panel fills, or repeated large cards.
- Every page has a title, one-line explanation, and a scope label: This browser, This installation, This workspace, or This team.
- Search indexes individual settings, descriptions, aliases, and integration entries. A result takes the user to and focuses the actual control. Searching “send key” should find Chat behavior, not merely the general Preferences page.
- Simple preferences autosave with a truthful Saving/Saved/error state and rollback on failure. Multi-field configuration, policy, templates, and destructive changes use explicit Save/Cancel and unsaved-change protection.
- Always explain disabled controls. Distinguish unsupported, unavailable, planned, and restricted. A disabled toggle must not imply enforcement exists.

## Information architecture

| Group | Pages | Scope |
| --- | --- | --- |
| Personal | Profile; Preferences; Appearance & accessibility; Notifications; Navigation & shortcuts | Local profile / this browser as labeled |
| Workspace | General; Teams & people; Routes & labels; Projects; Templates; Archive | Selected workspace |
| Agents & work | Agent profiles; Agent collections; Instructions & context; Session defaults; Approvals & safety; Handoffs | Workspace defaults; explicit project/agent overrides |
| Connected services | AI providers; Code & repositories; Communication; Google services; Other tools | Installation credentials, explicitly granted workspace resources |
| Local system | Storage & backups; Import & export; Activity & diagnostics; Usage | This installation, with workspace filters |

Don't expose every eventual page immediately. Ship pages when they have meaningful working content. Keep planned connections together in the service catalog rather than filling navigation with empty pages.

## Personal settings

### Profile

Retain local name, avatar, and optional email. Explicitly state that this is not an online account or authentication identity. Add a display-name preview. Do not offer password changes, sessions, or two-factor authentication until Frondose actually has a login system.

### Preferences

- Default home: Overview, Focus, Chats, Agents, or last open page. An explicit incoming URL always wins. Preserve existing launch behavior during migration.
- Chat send key: Enter or Cmd/Ctrl+Enter. The composer hint, newline behavior, keyboard help, and IME composition handling must agree.
- Week starts on Monday/Sunday, consumed by all date pickers.
- Date format and 12/24-hour time, consumed consistently by dates, activity, sessions, and tooltips. Store timestamps canonically; presentation settings don't rewrite history.
- Prefer a project-scoped list when navigating from a project. Don't silently attach a project to unrelated work.

### Appearance & accessibility

Retain dark/light/system, density, and reduced motion. Add tested standard/larger text sizes and always-underlined content links. Keep text resizing independent from density. Operating-system reduced motion wins over app animation preferences. Full motion and reduced motion must both preserve useful state feedback.

### Navigation & shortcuts

Use the current customization editor and searchable shortcut catalog. Include default home, favorite management (remove/reorder, show unavailable references), and a preview of sidebar density/badges. Letter-key shortcuts remain optional. Never attach a shortcut to immediate approval, account connection, or AI execution.

### Notifications

Separate notification events from delivery channels:

- Events: needs input, failed, completed, assigned Route ready for review, handoff ready.
- Initial delivery: in-app Inbox and unobtrusive toasts.
- Later: browser notifications after an explicit permission action; Slack only once implemented.
- Per-project noise controls and quiet hours can suppress interruptions, not hide pending approvals from Focus/Inbox.
- Mark unsupported channels Planned; no fake test notification successes.

## Workspace settings and the features behind them

### General

Name, description, workspace image, workspace purpose, default home recommendation, and archive/export controls. A cloud URL, data region, billing tier, or retention guarantee does not belong here while this is a local app. Workspace defaults should not overwrite individual personal preferences.

### Teams & people

A searchable team directory with project/Route/member counts, description, archive state, and links to the team space. Team detail has General, People, Agent collections, Templates, and Workflow defaults.

Keep local people records clearly labeled. Assignment and ownership metadata are useful now; invitations, login identities, role-based access, and collaboration are a separate future project. Never label a local team “private” unless a real access boundary exists.

### Routes & labels

Add a real label system: create, rename, merge, archive, and filter labels. Merging previews affected Routes before updating references. Add default priority and default assignee suggestions; suggested assignment never launches an agent.

Allow display names and ordering for lifecycle stages only after migrating consumers to stable semantic categories: backlog, ready, active, review, blocked, done. A renamed stage must still drive Focus, filters, progress, and automation correctly. Do not make provider session states freely editable.

### Projects

Default brief sections, suggested milestones, document templates, completion checklist, and archive behavior. A project completion checklist can require review and documentation without falsely claiming tests passed. Linked folder/repository remain project-level context, not global settings.

### Templates

One reusable library with types: Route, project brief, document, chat starter, and agent instructions. Support create, edit, duplicate, preview, archive, and “Use template.” Initial variables are simple explicit placeholders such as project name and goal; unresolved required fields are shown before use.

Applying a template copies a snapshot. Editing the template does not rewrite existing work. Importing a template never executes commands or grants permissions.

## Agent-centered features

### Agent collections

User-created groups such as Build, Research, and Review. An agent may belong to several collections. Collections offer saved filters and quick selection; they are not human teams and do not own accounts or grant permissions.

Settings manage names, membership, order, and default display. Roster filters, the sidebar, command search, and chat recipient selection consume these collections. Show which profiles are paused, disconnected, busy, or ready without conflating those states.

### Instruction presets and version history

Reusable agent instruction presets with a preview, explicit application, version history, and restore-as-a-new-version. Each run records the instruction version/snapshot it actually used. Changing instructions affects future sends, not a process already running.

Keep provider selection and model capabilities honest: only offer options the adapter can validate. Model choices are provider-specific. No made-up uniform capability list across providers.

### Context packs

A named reusable bundle of selected memory notes, documents, and approved text references—for example “Brand guidelines” or “Frontend conventions.” Choose a pack for a project or chat; inspect the exact included sources before sending.

Each source shows owner, scope, version/update time, and inclusion reason. Surface stale/deleted sources and truncation. Changing a shared pack affects future sends only. Secrets and whole local folders are not silently bundled. General chat remains folder-optional; access to local project files still needs an explicit folder and project-work mode.

### Session defaults and queue

Move concurrency out of ambiguously labeled workspace settings. Define a machine-wide hard maximum and optional lower workspace limits. Show queued/running capacity and the reason work waits.

Next feature: a manual queue with reorder, cancel-before-start, and explicit start/resume. Automatic queue draining is separately enabled and must stop on missing context, permissions, or authentication. No hidden retries after a failure or uncertain write.

Default chat mode remains General chat. Project execution remains explicit. A runtime/turn limit appears only when the runner can actually stop/enforce it. A queue, timeout, or retry setting must have a tested consumer before it is editable.

### Approvals & safety

Explain permitted operations separately: reading selected files, editing a linked folder, command execution, network/tool access, and external publication. Reflect the capabilities of the selected provider/adapter. If an adapter cannot enforce a boundary, do not offer a reassuring toggle for it; keep that capability unavailable or require a narrower mode.

Safety uses intersection, not last-setting-wins: installation limits ∩ workspace policy ∩ project scope ∩ session grant ∩ provider capability. A session cannot override a stricter policy. Check again at launch, fail closed if invalid, and show the effective permissions before starting.

Policy changes apply to future work by default. Show active sessions affected by a change and offer explicit stop/restart actions; do not imply an already-running process was instantly restricted. Never enable bulk approval as a convenience shortcut.

### Handoff packets

An explicit “Prepare handoff” action creates a reviewable package: goal, source session, result summary, changed-file references, decisions, open questions, and selected context. Choose a receiving agent and chat. The user reviews the packet before sending; receiving work never starts just because a packet was drafted.

Preserve source links and attribution. Missing/unavailable files stay visibly unresolved. First version allows an editable manual summary; AI-generated summaries require an explicit run and usage acknowledgement. No invisible agent-to-agent loop.

### Saved views

Save common filters such as “Review agents working on SourceLens” or “Blocked Routes assigned to Build.” Start with a small explicit filter schema: project, team, assignee, provider, status, label, sort. Make views available in sidebar favorites and command search. Saved views store queries, not duplicate records.

## Connections: design now, implementation later

Use one catalog in Settings and the existing Connections entry point. Both reach the same configuration, not separate stores. Preserve existing adapters and connection records; do not replace working surfaces with placeholders or start authentication while rendering Settings.

| Category | Catalog entries | Proposed future purpose |
| --- | --- | --- |
| AI providers | Codex / OpenAI, Claude | Select authenticated runners and inspect supported capabilities |
| Code | GitHub; GitLab later | Select repositories, link work, inspect changes, draft/review publication |
| Communication | Slack; Discord/Teams later | Deliberately share work updates, receive selected requests |
| Google services | Drive first; Calendar/Gmail later only if justified | Attach selected documents; optional scheduling or message workflows |
| Knowledge/tools | Notion; custom tools/MCP later | Explicitly selected context or capabilities |

“Google account” identifies an account; it does not mean access to every Google service. Service/resource grants must remain separate. Likewise, an account being connected must not grant every Frondose agent access to every repository or channel.

For unimplemented entries, show Planned, purpose, intended data direction, and “View planned capabilities.” Do not display a working-looking Connect button, collect tokens, open fake authorization pages, or allow an Enabled state. A connection plan can be browsed without being configured.

When an integration becomes real, show account identity, granted resources, allowed actions, affected workspaces, last check, errors, and disconnect behavior. Distinguish local disconnection from provider-side revocation. Publishing or sending externally remains a separate explicit action.

Don't imply a provider subscription automatically includes API usage. Authentication, entitlements, and billing must be verified for the actual integration when implemented.

## Local system

- **Storage & backups:** actual database/attachment size, location, and version; last successful backup; user-selected backup destination. Distinguish a readable export from a restorable backup. Exclude credentials by default. Verify backups before saying they succeeded.
- **Import & export:** versioned JSON format, preview, validation, ID-conflict strategy, explicit merge versus new-workspace import, and transactional rollback. No “restore” button until tested against a real exported archive.
- **Archive:** search/filter, dependency preview, restore, and clear separation of archive versus permanent deletion. No automatic destructive retention default.
- **Activity & diagnostics:** actionable local errors, adapter availability, app/database version, and a previewable redacted diagnostic export. A chronological record of configuration changes should not be described as a tamper-proof security audit.
- **Usage:** sessions, durations, outcomes, and provider-reported tokens when available. Missing data is Unknown, not zero. Estimated costs must be labeled estimates and name their assumptions. Do not advertise a hard spending cap until it can be enforced reliably.

## Scope and persistence design

| Setting family | Proposed storage/behavior |
| --- | --- |
| Browser display/navigation | Versioned browser preferences; optionally exportable separately; no secrets |
| Local profile | Installation-local identity; not a cloud account |
| Workspace/team configuration | SQLite records with explicit workspace/team ownership and validated references |
| Project/agent defaults | Explicit overrides, showing their inherited source |
| Installation safety/capacity | Server-enforced machine-level policy |
| Credentials | Existing server-side credential boundary; never browser preferences or normal exports |
| Run context and permissions | Immutable snapshot of what that run actually used |

Migrate current global settings deliberately: preserve installation-wide limits, migrate appearance without surprises, and don't silently copy supposed per-workspace policies into all workspaces. Display the actual scope during the transition.

## Build sequence and completion criteria

1. **Settings foundation:** dedicated shell, return-to-work behavior, searchable real controls, explicit scope, preserved old links, save/error/unsaved states. Add genuinely consumed home, send-key, text-size, and date-display preferences.
2. **Reusable organization:** labels, templates, agent collections, and saved views, each integrated into creation/search/filter/sidebar workflows. No disconnected management tables.
3. **Supervised agent work:** context packs, instruction versions, permission previews, manual queue, and handoff packets. Keep execution and external publication explicit.
4. **Connections and local resilience:** planned-service catalog first. Implement actual integrations in a separate authorized pass; add validated restore/backup before promising recovery.

For each setting, acceptance requires persisted value + validated scope + actual consumer + visible saved/error state + reset behavior + keyboard/mobile access + regression test. Reload and workspace-switch checks are mandatory. Reject mock-success controls. Test provider-dependent flows with injected adapters until the user explicitly authorizes real-account testing.

Do not prioritize billing, enterprise SSO, customer CRM, SLAs, fiscal calendars, public APIs, or a marketplace just to match the length of another product's Settings sidebar.

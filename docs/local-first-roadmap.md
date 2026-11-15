# Frondose: local-first product scope

## November 11 purpose-built tools

Generic embedded Apps, Open App and Open in Apps are retired. Older sections
below are historical, including the October 30 Apps implementation. Retained
legacy tab metadata does not execute the removed feature. Browser, Editor and
repository tools have independent entry points.

Implemented source adds a Coming Soon Plugins page, a scoped macOS native
helper for reviewed Computer Use and on-device Dictation, existing iOS/Android
device tooling controls, a restricted Docker development environment, Versions
with guarded checkpoints and local Git history, bounded Rich Previews, and
structured Codex/Claude conversations plus allowlisted external AI launching.
Computer Use grants are per workspace and conversation, expire, and never
approve an AI action automatically. Structured Claude requires a dedicated API
key; unmodified terminal and external applications keep their own sign-in.

Not included: an executable plugin marketplace, VM/full-OS emulation, automatic
SDK/image installation, iOS touch input, live device streaming, container ports
or interactive container PTYs, notebook execution, or automatic GitHub sync.
Native tool availability depends on the actual OS/toolchain and permissions.
New Docs and the November 11 development note describe those boundaries. They
do not claim installation, public publication or real-account certification.

## October 30 evening follow-up queue

- [x] Left-margin hover/selection note controls for Markdown/text and code lines.
- [x] Compact selected-text composer, exact current-source highlights and inline discussions; ambiguous generated text requires Source instead of guessing.
- [ ] Complete provider-aware direct comment dispatch: existing CLI ownership and explicit idle/empty-input review are implemented, with draft-only insertion and a new-CLI chooser. Universal provider busy telemetry and carrying a pending note through a new CLI launch remain unfinished.
- [x] Project folder across local workspaces, separate project/worktree hierarchy, bound-directory branch/commit/open-CLI facts and quick-access display options.
- [x] Distinct worktree navigation and guarded switching; branch-tab layouts remain default off and runtime tabs are retained.
- [x] Bottom status bar uses actual desktop memory/CPU, terminal count and port discovery. Unsupported provider quota/SSH state is deliberately absent.
- [x] Native Mac icon optical padding; original approved artwork and rollback source retained.
- [x] Latest matching installed release, release article tabs, standalone ordinary Docs/Settings and Help update check.
- [x] Spotlighted replayable feature tours, actual target movement and reduced-motion fallback.
- [x] Local Automations tab: templates/search/filter/runs, exact Route review, explicit schedule consent, pause/re-review and durable dispatch/missed/uncertain receipts. This is not provider-completion telemetry.
- [x] Visible file/browser/app refresh with draft protection and no PTY restart.
- [ ] Production host activation: new backend routes remain pending while the owner's two running terminals are protected. Windows/Linux native acceptance and public signed release/update hosting also remain pending.

Validation for this follow-up: 2,336 isolated regression tests passed. Rendered checks covered a 1,000-line code editor scroll round-trip and preserved inline draft, a cross-paragraph Markdown selection saved as Lines 3–7, current-source highlights, explicit note-to-existing-mock-CLI draft insertion without Enter, Project quick access with branch tabs off, an automation create/pause/manual-skip receipt, What’s New tabs/Docs navigation, Help update settings and a moving spotlight tour. At 390×844, document/body width remained 390px with the note rail below the document. No real provider prompt or external repository write was sent. Native Mac packaging/activation evidence is recorded separately in design-qa.md; a build is not Windows/Linux certification.

## October 30 recording-based repository work

New Repository tasks, Source control and Worktrees tabs adapt the supplied Orca
recordings and pinned upstream helpers. Source control offers exact local
working/staged diffs, inline saved-file notes, selected-path staging/unstaging,
reviewed commits and explicit connected-GitHub fetch/push/create-PR actions.
It never merges a PR, force-pushes, executes repository hooks or silently
stashes/resets files. Unsupported/private or conflicted content remains a
terminal-review boundary. Executable filters and transport URL rewrites block
these managed operations rather than running arbitrary helpers unnoticed.

New sibling worktrees check out an existing local base commit into a dedicated
`frondose/` branch. Local Routes and explicitly read GitHub issues can seed their
own checkout and copied local Route. Opening it creates/selects a directory-bound
workspace; it does not start AI. A separate reviewed exact Route launch supports
installed Codex/Claude CLIs with a durable non-replay receipt. The original
checkout and its running sessions stay unchanged. Managed removal rejects active
sessions, changed files and ignored files and retains the branch. Worktrees share
Git objects and OS-user authority, so they are not security sandboxes.

Markdown Preview selection opens a margin note, not a centered modal. Existing
notes stack beside their source; narrow panes move the rail below the document.
Diff notes sit directly under the line. Saved source/version anchors, replies,
reactions and explicit CLI context drag/copy reuse Frondose's comment system.
No AI joins or receives a comment automatically; no Enter is sent by a drag.

Remaining parity: Orca's autonomous task decomposition, orchestration CLI/MCP
tool bridge, provider-specific agent lifecycle monitoring and richer historical
old-side diff annotations are not implemented by these additions. CLI process
exit is not proof of task completion or acceptance. Real external fetch/push/PR
writes are not exercised in QA; only disposable local repositories and a fake
GitHub adapter are used. Mac build checks do not certify Windows/Linux runtimes.
The existing live owner host must not be restarted while its terminal sessions
are protected; new backend routes need a separately authorized safe activation.

Validation: the final full regression run passed 2,315 tests; the repository
suite subsequently passed all 18 cases, including fresh GitHub-issue task text
and Windows drive/separator/UNC identity handling. Another focused 69-test run
covered comment/draft and workspace guards. Vite production build and the final
ad-hoc Mac package's disposable PTY/isolated Chromium smoke checks passed.
Rendered checks at 1280×720 and 390×844 covered inline diff notes, selected-path
staging, a reviewed single mock-CLI Route launch, Route-to-worktree creation and
workspace/task copying, Markdown selection/margin notes, reload persistence,
replies/reactions and protected unsaved comments/replies. Browser console was
clear and the narrow note rail had no horizontal overflow. The native Mac menu
was observed after installation. The port-4174 host stayed PID 72576 and retained
two running terminal records; its new-feature unavailable state explicitly
explains the deferred backend activation. Private owner histories/accounts were
not exercised. Source push is withheld because the checkout contains extensive
pre-existing mixed changes; no unrelated files have been committed or pushed.

## October 30 app tabs and repository dashboard

Historical implementation, retired November 11: the generic Apps menu and
embedded-app setup below are no longer part of the current interface.

New tab now groups tools in an anchored Open App menu: the built-in text
editor, GitHub Dashboard, isolated Browser, installed VS Code web setup,
Apache Guacamole, Parallels RAS Web and a generic web console. Native-only
editors and desktop applications are not presented as embeddable windows.
VS Code setup validates its installed executable and refuses an already-open
native editor; it only prepares a loopback, token-protected command. It never
executes the command, downloads a runtime or accepts Microsoft license terms.
The user must complete that setup and provide the resulting local URL.

Remote desktops require an existing compatible HTTPS gateway. This is not
Parallels Desktop embedding, a new RDP/VNC server, or universal detection of
remote sessions in other applications. Managed app identities are unique
across native Frondose windows; runtime addresses are session-only and are
excluded from tab metadata, exports and field-default persistence.

The repository dashboard is a real tab with local file states, branches and
ahead/behind information. GitHub issue/PR/check reads require explicit opt-in;
repository/root/head changes invalidate old results. Polling pauses while the
view is hidden. Missing checks, authentication and failed reads remain
unknown/unavailable rather than being reported as success.

Latest validation: 2,298 regression tests passed, plus the standard production
build and isolated packaged Mac PTY/Chromium smoke checks. Desktop and narrow
dashboard/menu checks used disposable fixtures, not owner account data. The
Mac app was installed with a recoverable previous-bundle backup and reopened
against the original port-4174 host; both active terminal sessions were
preserved. Installed VS Code detection and the already-running refusal were
observed in the actual Mac window. Real VS Code web runtime and remote-gateway
login/session flows have not been certified, nor have native Windows/Linux
installers. Previously deferred server changes still require a separately
authorized safe restart; updating the desktop shell does not activate them.

Before public launch, finish and accept the Route-to-CLI-to-result/review
workflow, run full data backup/restore and interruption recovery drills, test
actual target-OS installers, and configure distribution/signing/update hosting.
Keep experimental remote apps, unsupported provider features and secure phone
access out of MVP promises until they pass their own end-to-end acceptance.

## October 28 context, editor and responsive-layout batch

Implemented in source and an isolated Mac/browser QA build:

- Fresh reviewed context drops from Workspace/the workspace identity, saved
  Areas/Projects/Routes/Documents navigation, saved file tabs and Explorer files.
  Explicit selected editor text includes file path, line range, saved version
  or an unsaved-text label. The drag payload carries a one-use local proof,
  not serialized private records. A center drop into a running AI CLI opens a
  preview; an edge drop from a tab retains split-view behavior. Insert requires
  bracketed paste and never presses Enter. Plain shells reject these drops.
- Selection/caret-aware Markdown source tools (bold, italic, heading, code,
  lists, quote and link), native source/preview, list continuation and exit,
  and preserved existing Save/Discard/Cancel/version checks. These are not a
  complete Google Docs rich-text editor or a language-server IDE.
- Explorer Unsaved files and clickable Markdown Outline. Timeline contains
  only disk versions observed in the current app session, not invented Git
  history or a durable revision archive.
- Actual split-pane geometry determines readable layout. Small panes use a
  focused-view selector without stopping their backing processes. Area lists
  become cards at narrow pane widths. The file editor toolbar reflows against
  pane width; entering a phone layout closes the desktop Explorer overlay
  without overwriting the saved desktop preference.
- Tool glossary labels are stacked above their descriptions, overriding the
  incompatible global definition-list layout. GitHub/Open in has a single
  bounded adaptive header row rather than wrapping into the tab strip.
- The Codex native picker uses `resume --all`; exact validated native session
  IDs remain exact resumes. An explicitly reopened resume tab retains its
  picker choice. Owner HOME/config paths are preserved, not cloned into a new
  account. Existing archived histories are not automatically unarchived.
- Unsupported/binary/large files have a warning and an explicit read-only
  64-KiB raw preview. Strict UTF-8 saves never overwrite an unsupported file;
  raw previews carry no save version/content authority. These backend changes
  require a safe host restart before they can work on an already-running host.

The full regression suite passed 2,154 tests. QA uses disposable data and a fake
Codex executable; no owner model prompt, login or private transcript scan was
performed. A passing Mac build is not native Windows/Linux certification.
The real host reported one active CLI; it has not been restarted to activate
new backend code. Frontend assets can be merged atomically while retaining old
hashed chunks, so existing windows and sessions are not invalidated.

Activation verified: the final frontend was merged into the existing
`dist-updater-client` host, preserving old hashed chunks and an index backup.
The Mac app was rebuilt in `dist-desktop-context`, passed ad-hoc signature,
packaged PTY and isolated Chromium lifecycle checks, and was installed at
`/Applications/Frondose.app`. The previous bundle is preserved at
`Projects Dev/Frondose Mac Backups/Frondose-0.1.0-before-context-20261028.app`.
Only the Mac window was relaunched; the original port-4174 host remained PID
72576 and still reported one active CLI afterwards. The live Mac glossary and
Explorer panels were observed. The Codex picker argv correction and raw-preview
endpoint are packaged but remain inactive on that old running host until a
separately authorized safe restart. No live private database migration occurred.

Implemented in the October 28 source follow-up and isolated fixtures, but not
activated on the existing running owner host: persisted saved-file selection
comments, replies, four supported reactions, resolve/reopen, a Comments page and
per-thread sidebar children, and thread/all-comments drag or copy to the reviewed
CLI handoff. Additive SQLite tables remain scoped to the authorized workspace,
project and physical directory identity. Anchors retain the saved file version,
exact quote, offsets and line range. Changed files are explicitly outdated; a
unique exact quote can be reattached only through an explicit action. Missing,
ambiguous, private or unreadable source files never silently grant an alternate
anchor or reveal their cached discussion text. Retry keys avoid duplicate writes
and optimistic thread versions preserve conflicting reply drafts for review.

Comments are saved against supported text files, not a general annotation layer
for every historical Documents record. Opening a comment's file currently opens
the correct root-scoped path; automatic cursor navigation to its saved line is
not yet implemented. A provider-native terminal is not an autonomous in-app
discussion participant: `@AI` text does not send messages or start work. General
rich text, full code-language services, document annotation parity and a
durable/Git-backed file timeline are not claimed. The new service requires a
separately authorized safe backend restart; the user's running CLIs remain
untouched, and fixture results do not certify that old-host activation.

## Current release and platform boundaries

- The packaged release configuration has no feed URL, download URL, Mac team
  identity or Windows publisher identity. The updater state machine, local-time
  Install tonight choice, Install now/progress UI and safety gates are tested
  with isolated adapters; there is no real public automatic release to install.
  The selected Mac icon and ad-hoc local builds do not substitute for publisher
  signing, update hosting, notarization or native installer validation.
- The local server listens on loopback. Secure phone pairing/remote access is
  still separate work; a responsive page does not make a sleeping or offline
  computer available. Running PTYs are not guaranteed to survive a server restart.
- Native Windows/Linux runtime execution and a working Windows EXE have not been
  certified on this Mac. Target-OS CI/build configuration and fixture tests are
  not substitutes for executing the actual installers on those systems.
- Embedded Chromium has its URL bar/history and separate local browser profile,
  but native permission requests and downloads remain denied until an explicit
  permission/download workflow exists. Open in the system browser is the current
  download fallback.
- Terminal inline graphics support bounded SIXEL/iTerm2 images, not Kitty
  graphics. Five built-in terminal themes plus bounded imports are available,
  rather than the reference application's full theme catalog. Session-history
  search and explicit native resume launch support Codex and Claude Code; other
  installed CLIs retain their own in-session commands where their provider offers
  them. Owner HOME/config paths are preserved without copying login data.
- The seven native integration adapters provide explicit, resource-selected,
  bounded reads. They do not implement every remote action from Orca: remote
  comments, issue creation, merging and pushing remain unavailable. Newly added
  GitHub issue-to-Route imports are a separate local opt-in, not remote write
  permission or complete native TUI-to-Route/progress/result linkage.

## October 27 installed workstation build: 0.1.0

The Mac application at `/Applications/Frondose.app` was updated to 0.1.0 with
the selected white-flower icon, including its native About window. Its ad-hoc
signature was verified. Packaged PTY and isolated Chromium lifecycle smoke
checks passed, and the final regression suite passed 2,142 tests with no
failures. This is not notarized or publicly publisher-signed distribution.

Verified through the rendered UI: the repeated terminal headings are removed,
tab-to-view splitting and detaching work, terminal display changes retain the
same process/output, Markdown close asks Save/Discard/Cancel, and session
management Cancel/confirmed stop works on a disposable QA session only. Help
closed six times with zero opacity reversals across 56 sampled exit frames.

The actual updater UI was exercised against the real scheduling model with an
isolated fake downloader/installer: Not now remained dismissed after reload;
Install tonight showed the local 22:00 schedule; cancellation cleared it;
Install now displayed 37% progress; Minimize retained compact progress. No real
installer or user session was affected. The installed app correctly reports
automatic updates as unconfigured, rather than announcing a fake release.

Native UI checks confirmed editor/external-terminal discovery, all seven
integration cards and provider-specific setup, system shell detection, terminal
preferences and current app version. Provider access/encryption adapters were
tested with fixture credentials, not the owner's live service accounts.

Deployment note: the previous Frondose host and Mac process were already absent
before this update; port 4174 was not listening. The existing SQLite database
was backed up including committed WAL contents, then a separate local host was
started using the same `.rumbo` store and the new isolated client build. No
running owner terminal was stopped, and interrupted histories were not replayed.
The old app bundle is recoverably retained in the Projects Dev Mac Backups
folder. Keep the separate host running: this is not a daemon or OS-login service.

Remaining external/release requirements are real release hosting and publisher
identity for public automatic installs, actual-account validation when the owner
chooses to connect, and native Windows/Linux execution. Windows cross-packaging
on this Mac correctly failed at node-pty's unsupported native cross-compilation;
the OS matrix now also builds installers on each target host. No working or
tested Windows EXE is claimed. Phone access and server-restart PTY continuity
remain separate work, not capabilities supplied by this Mac update.

## October 27 implementation status

The native updater UI/state machine, private release-specific deferrals and
local-time schedule, minimized progress, Settings fallback, renderer-draft proof
and expiring installation-wide write gate are implemented and tested in
isolated builds. They are not a published release feed or a verified public
Mac install. The current local build deliberately has no feed or publisher
identity and cannot announce a fictional update. Keep the user's running server
and terminal sessions intact. The installed app must be updated only after a
fresh safe handoff; a separately started development server is not silently
stopped by the native updater.

The cumulative workstation scope is:

- [x] Regression verification: Help closes on its second activation without a
  flash, and incoming-tab split previews use frozen geometry without blinking.
- [x] Appearance: app font/theme/zoom, terminal typography and real bounded
  Ghostty/Warp/YAML imports, previews/dividers, sidebar appearance and truthful
  status indicators. Do not expose fake provider quotas or unavailable hosts.
- [x] Installed external terminals: detect platform-supported iTerm2, Ghostty
  and other terminals; offer explicit external launch in the workspace folder,
  distinct from Frondose's embedded shell. Never launch merely on discovery.

- [x] Open In Apps: installed editor discovery, preset/custom entries, safe
  root-bound Open in actions, edit/remove and native-platform behavior. Orca's
  pinned presets are VS Code, Cursor and Zed. Keep Frondose's bundled logos;
  do not copy Orca's Google favicon-aggregator requests.
- [x] Integration connections and explicit reads: provider-specific library/detail/setup UI for
  GitHub, GitLab, Bitbucket, Azure DevOps, Gitea, Linear and Jira, based on the
  actual pinned IntegrationsPane source. Implement real supported credentials
  and resource access, with encrypted local secrets, explicit resource choice,
  bounded reads. Remote comments, issue creation, merging and pushing are not
  implemented by these adapters and are explicitly labeled unavailable; this
  is not full Orca action parity. Existing unrelated provider records and
  historical paused connectors remain intact; a catalog card is not a live
  connection or permission to reuse Orca's credentials/OAuth registrations.
- [x] Terminal settings from the supplied screenshots: shell, GPU fallback,
  contrast, supported/bounded inline graphics, scroll multipliers, clipboard and
  focus behavior, session management, scrollback, word separators and platform
  keyboard options. Retain fresh stop confirmations and distinguish unavailable
  daemon restart/continuity from working terminal features.

Pinned Orca source: revision `51dcef8258230ffea85a907130450b0ad676e22b`,
`src/renderer/src/components/settings/IntegrationsPane.tsx` and
`src/renderer/src/lib/open-in-app-catalog.tsx`. MIT notices remain in
`third-party/orca/NOTICE.md`.

## October 26 superseding CLI-first refresh

The later responsive correction makes **Docs a standalone screen**, like
Settings, with guarded return to the unchanged workspace tabs. Planning layouts
now reflow using actual available pane width, including a narrow desktop pane
between navigation and Files. Mobile Docs uses full-width collapsible navigation
and single-column content. Help lists at most three release entries and omits
introduction/tour shortcuts; sidebar customization exposes eleven retained local
pages with working Show/Hide and pins. These changes preserve historical data.

The local product now retires Today, Inbox, Workbench, Frondose personal agent,
Agents, AI Connections and Conversations from navigation, search, shortcuts,
creation and Settings. Historical data and compatibility backend endpoints are
preserved. Workspace opens the mixed-content New tab chooser: local shell,
Markdown, native desktop browser and detected direct AI CLI. Old named-agent view
metadata becomes a direct terminal view with the same process/layout identity;
it cannot reopen profile-based first-task creation. Earlier named-agent and
optional-API presentation items below are historical, not current release goals.

Implemented in this refresh: Chrome-style inset tab separators/rounded hover;
sliding selection, enter/exit chrome and popup motion with reduced-motion and
keyboard safeguards; fresh server-owned terminal-view status and explicit,
confirmed Stop & close versus view-only close; curated local Settings including
tab size/close buttons and real terminal font/active-pane limits; additional
Orca-derived bounded install/version-manager discovery; per-identity/workspace
update receipts. The far-right file explorer and standalone Settings remain.
No history, private database, workspace file or credential was deleted.

The terminal/browser services are not a complete Orca port. Native Windows/Linux
certification, process continuity across server restarts, signed installers,
browser permission/download flows, raw TUI-to-Route/result linkage and secure
phone access remain open. Detection is not authentication; explicit native
launch runs with the OS user’s privileges. Do not test using real provider
prompts/accounts or equate filesystem fixtures with live-provider certification.

This October 25 direction supersedes the hosted/team MVP plan. Frondose is a
single-owner work environment running on the owner's Mac, Windows or Linux
computer. The latest target is **one workspace bound to one project directory**,
not a human team or a container of unrelated working directories. The current
multi-project data is preserved behind an explicit owner-selected root binding;
no old folders or histories are automatically moved or flattened.

The product promise is: **Plan a project, assign work to your own AI agents,
follow their progress, and review the results—from one workspace, including
your phone.** Agent organization supports that workflow; it is not the product's
whole purpose. Phone access is a planned companion to the same local workspace,
not a promise that the computer can run agents while asleep or offline.

Local means the application server, workspace database, history and execution
live on that computer. Cloud provider requests still leave the computer when
explicitly sent. An offline model runtime is a separate connection capability;
Frondose does not promise offline inference for cloud subscriptions/APIs.

## Historical updater checklist, superseded by the October 27 status above

This October 26 planning checklist is retained for traceability. The UI and
safety model are now implemented; owner-provisioned release hosting and public
signing remain open. It is distinct from the existing What's new articles and
their per-workspace read receipts.

- [ ] Show a compact **bottom-left Frondose update prompt** when a real compatible
  application release is available, with **Not now**, **Install tonight** and
  **Install now**. Never announce a fictional available version or imply that a
  changelog entry is an installable release.
- [ ] Open an accessible progress dialog for the selected update. Include its
  release notes, truthful download/verification/install/restart states and a
  **Minimize** action. Minimizing keeps the real operation visible in compact
  status and allows reopening it; it must not report completion or discard an
  error. Preserve keyboard access, focus restoration and reduced motion.
- [ ] Add a Settings fallback to check for updates, review the available release,
  see progress/errors and install when supported. If automatic installation is
  unavailable for a development build or platform, explain that honestly and
  offer only an actual Frondose installer/manual-update route when configured.
- [ ] Persist deferrals, the selected release, tonight scheduling and in-progress
  state **per installation**, not per workspace/account or imported workspace
  backup. Reopening or changing a workspace must not reset the choice or repeat
  the same prompt. Tonight uses a visible local-time schedule; an asleep/offline
  computer cannot be promised to install at that exact time. Resume safely and
  offer a fresh choice rather than replaying an uncertain install.
- [ ] Supply Frondose-owned release hosting/feed, version/channel/platform
  metadata and the required package signing/verification configuration. Review
  each updater dependency and retain notices. Do not reuse Orca release feeds,
  update endpoints, publisher credentials, signing identities or cloud services.
  Missing signing/feed configuration remains an explicit release blocker.
- [ ] Before installation or restart, freshly recheck running/starting AI CLIs,
  other active terminals and unsaved/pending file, settings or update drafts.
  **Install now/tonight never silently stops work, discards drafts or restarts
  during active work**. Defer safely and request new explicit consent before any
  interruption; do not treat the earlier scheduling choice as permission to
  terminate a later session. Never automatically stash/reset workspace files.
- [ ] Test real packaged update availability, supported/unsupported builds,
  Not now/reopen, tonight/reschedule/cancel, minimized progress, failure/retry,
  interrupted downloads, invalid manifests/signatures, stale versions and the
  active-work/draft guards on macOS, Windows and Linux. Separate fixture tests
  from verified signed/native update installation and recovery.

This planning change performs no updater implementation, release-feed request,
download, installation, application restart or signing configuration change.

## Product decisions

- No required Frondose cloud account, public signup, memberships, invitations,
  human roles, shared-agent audiences, subscription billing or hosted admin UI.
- Preserve old member records, attribution, IDs, existing passwords and exports;
  do not delete data to simplify navigation. An existing local lock remains on.
- Keep file/tool permissions, current and historical source protection, exact
  context review, destructive confirmations and paid-work consent.
- Preserve API and supported provider authorization as optional owner-controlled
  outbound connections. Never borrow a developer's credentials.
- No existing CLI-history import or universal two-way sync. Keep Frondose history.
  The later October 26 request separately permits opt-in local Codex/Claude
  session title/content search and exact provider-native resume, not transcript
  import or the retired Session views. See [scope and limits](local-session-history-search.md).
- Reuse licensed Paseo/Orca components selectively after per-file/dependency,
  provenance and security review. Do not imply that an adapter transports all
  provider features, or that Git worktrees are a security sandbox.

## Directory workspaces and Orca style tabs

This later October 25 request supersedes the earlier generic tab/Conversations
plan and floating-sidebar design. The October 25 implementation now delivers the
local workbench foundation below, not the complete Orca feature set or whole
product backlog. The [Orca source review](orca-reuse-review.md) identifies reusable
subsystems and behavior that must be adapted rather than copied unchanged.

### Implemented checkpoint — October 25

- One explicit canonical directory per workspace, with a real availability/read
  check, reviewed mapping to an existing project, no inferred fallback folder,
  root-version protection, and guards against rebinding while work is active.
  Existing unrelated project records are preserved, not silently migrated.
- Shared neutral tabs for app pages, files, shells, direct AI CLIs, named agents
  and native browser views. Ordinary navigation replaces the active view. New,
  close/reopen, reorder, keyboard selection and bounded view restoration work
  without replaying commands. A separate session-view registry retains access.
  Settings is deliberately separate: it has its own screen/navigation, never
  replaces or adds a workspace tab, and Back to workspace restores the previous
  view. Unsaved file/settings guards still apply. Old persisted Settings tabs
  are discarded as view preferences, not as workspace data.
- Independently resizable/collapsible navigation and file explorer; bounded
  filename/content search; source editing, Markdown preview and versioned saves.
  Dirty navigation uses a tab-anchored Save/Discard/Cancel dialog. Failed saves,
  changed roots and stale disk versions retain the draft. New Markdown saves
  never overwrite an existing path. Draft text is in memory, not auto-recovered
  after a crash; browser close/reload warns before losing it.
- Real xterm/PTY input/output with Orca-derived recursive horizontal/vertical
  splits, resize/equalize and explicit Stop. Tab replacement does not stop work.
  CLI discovery uses a fixed 44-entry catalog; detection is not authentication.
  Ordinary local launch uses the CLI's own login, not another Frondose account
  selector. Named first tasks currently support Codex/Claude with exact reviewed
  Personalization, task/native/paid consent, stale-profile checks and durable
  no-replay receipts. Raw TUI sessions are **not** automatically canonical Route
  runs, reviewed Outputs, or verified task completion.
- A main-process Electron bridge and isolated Chromium guest, with navigation,
  state, bounds, hide/reopen and explicit close. Guest access to Frondose's Node
  APIs, arbitrary filesystem, media, popups and downloads is denied. A regular
  browser running localhost explains why embedded Chromium requires desktop;
  it does not substitute an iframe or claim to share the user's Chrome profile.
- A four-step workspace introduction, default detected CLI preference, appearance,
  optional GitHub status and opt-in notification setup; contextual right-corner
  tips, timer/motion controls and an anchored feature tour. Canonical run status
  notifications work; arbitrary raw TUI completion is not inferred.
- Retired local Conversations navigation, with a read-only historical reader;
  neutral Area icons/tabs preserve old IDs and inert color preferences. Compact
  navigation is flush with the frame; the main pane is inset and rounded.
- Native desktop staging/build/smoke scripts and a Mac/Windows/Linux CI matrix.
  The Mac unsigned unpacked app has been built and native PTY/Chromium-smoked.
  Windows/Linux native execution and distribution certification remain pending.

Still open: the complete Orca daemon/GPU/history/add-on dependency closure,
daemon/server restart continuity, full browser design/selection tools and reviewed
permission/download workflows, explicit old-project migration UX, arbitrary
named-provider task parity, full task-to-native-session/result linkage, signed
installers/updates, and the phone companion. No public port, cloud relay, automatic
GitHub authorization or model sign-in was introduced to simulate completion.

### Workspace and layout

- [x] Bind each workspace to one owner-selected canonical project directory.
  Ordinary folders work without Git; Git-only features require a repository.
  Related worktrees are explicitly managed derivatives, not unrelated roots.
  Display root availability and never substitute the home folder, Frondose's
  private storage or its own checkout when the root is missing.
- [ ] Design a reviewed migration for existing multi-project workspaces. Preserve
  workspace/project IDs, Routes, outputs, reviews, documents, sessions and history.
  Let the owner choose root/mappings; never automatically move folders, split
  records, flatten content or delete old chats. Back up before schema migration.
- [x] Keep Frondose destinations in the left navigation, but remove the inset
  floating-sidebar frame. Use the supplied Linear reference: navigation sits in
  the app frame and the **main work surface** is the inset, rounded/floating pane.
- [x] Put an optional file explorer between navigation and the main work surface.
  Include tree expansion, filename/content search, refresh and useful options.
  Give navigation and explorer independently draggable boundaries, persisted
  widths, drag-to-collapse, explicit restore and keyboard equivalents. Reflow
  predictably when either is hidden; never hide both ways to restore navigation.
- [ ] Make typography and spacing consistently smaller and more compact across
  pages, Settings, popups, lists, tabs and toolbars. Use shared density tokens,
  not an indiscriminate browser zoom; retain legibility, touch targets, text zoom
  and a comfortable display option. Tabs stay neutral with no Area color feature.

### Replace the current tab by default

- [x] Use one typed app tab model for Frondose pages, files, terminals, named agent
  sessions, direct AI CLI sessions and browser pages. A normal sidebar/file click
  replaces the **active tab**, regardless of its current content type. Creating
  another tab is explicit through New tab or an equivalent deliberate command;
  normal clicks must not continually accumulate tabs.
- [ ] Replace a view without silently stopping or forgetting its running terminal,
  agent or browser session. Backing sessions need their own registry, visible
  running-work access and explicit Stop/Close-session actions. Separately design
  confirmation for closing a running session; do not inherit Orca's provider-kill
  on tab close as an accidental consequence of navigation.
- [x] Before replacing/closing a dirty file, show an accessible anchored dialog
  with an arrow pointing at that file's tab: Save changes, Discard and Cancel.
  Cmd+S on macOS / Ctrl+S elsewhere saves the same active draft. Continue the
  queued navigation only after a successful save or deliberate discard; a save
  error, external disk conflict or changed target keeps the draft and tab intact.
- [ ] Preserve per-tab draft, selection, scroll and navigation state where useful;
  restore workspace tab order/selection without replaying commands or launching
  models. Reuse only live, correctly owned runtime sessions after reconnect.

### New tab chooser

- [x] **Terminal:** open the selected supported local shell in the workspace root,
  with real PTY lifecycle, resize, input and output. Shell launch is explicit.
- [x] **Markdown file:** create a local `.md` draft with a real filename/location
  and guarded disk save; offer Source and rendered Markdown Preview for existing
  and new files. The two modes share the draft rather than separate stale copies.
- [x] **Browser:** open a real embedded Chromium page through the desktop host or
  reviewed local browser service. Do not promise existing Google Chrome tabs,
  cookies, history or profiles. A normal website iframe is not this feature.
- [ ] **Agent session:** select a connected named Frondose agent and its supported
  bound CLI/runtime. Grey this option out with an explanation when none is ready.
  Preserve the agent's personalization, task linkage, identity and run/result
  records. If several configured CLI choices apply, expose nested choices on
  hover and by click/keyboard/touch; hover alone never launches work.
- [ ] **AI CLI:** offer detected providers such as Claude Code and Codex directly,
  with configured variants in accessible nested menus. Launch their actual CLI
  without making the owner type its command. This is a raw provider identity,
  distinct from a personalized named agent, not ordinary provider website chat.
  This chooser is CLI-first/CLI-only; existing API credentials/history must not
  be deleted as a side effect of redesigning it.
- [x] Retire the current Conversations/Chats navigation and duplicated custom
  chat surface in favor of these session tabs. Preserve old histories readably
  through an archive/compatibility reader until an explicit migration exists.
  Do not turn stored chats into invented native CLI history or universal sync.

### Reuse the complete terminal and browser subsystems

- [ ] Port the reviewed Orca terminal feature set with its dependency closure:
  xterm.js rendering/add-ons, horizontal/vertical recursive splits, focus and
  resizing, search/selection/clipboard/IME, output backpressure, saved scrollback,
  reconnect, daemon/process ownership and platform cleanup. A single copied
  Terminal component does not satisfy this task. Keep native modules, required
  patches, notices and relevant tests together; verify Mac/Windows/Linux builds.
- [ ] Adapt CLI metadata, executable aliases, platform filtering, PATH/known
  install-directory discovery and launch planning. Installed does not mean
  logged in or model-entitled; the CLI uses its own login and handles sign-in
  when needed. Do not put a redundant Frondose OAuth/account dropdown in front
  of ordinary local CLI launch. Shell-profile PATH hydration executes user
  startup configuration, so it needs a separate trusted-host decision from
  read-only discovery. No automatic installation or paid startup prompt.
- [ ] Port browser tabs together with host ownership, session/profile isolation,
  navigation, popups, permission/download policies and cleanup. Add visual
  selection/design tools with bounded reviewed page context separately. Remote
  browser access needs the actual frame/input transport, not database syncing.
- [ ] Introduce a Frondose runtime bridge rather than importing Orca's entire
  application state or leaving `window.api` calls unimplemented. Keep Frondose's
  project planning, Routes, agents, progress and result-review workflow as the
  product layer. Replace product identity and review each included dependency;
  do not inherit Orca cloud login/relay/push/update endpoints or registrations.

Acceptance covers root migration, spaces/Unicode/Windows paths, missing folders,
symlink escape, content-search bounds, dirty-file navigation and failed saves,
split removal/resize, explicit process stopping, host reconnect/crash recovery,
no command replay on tab restoration, CLI missing/login errors, browser isolation,
phone reconnect, keyboard/touch use and reduced motion. A native terminal starts
in the project directory but runs with OS-user permissions; that is not a sandbox.

## October 25 evening additions — implementation and remaining work

These items capture Evan's eight supplied Orca references and accompanying
direction. The later request authorizes implementation. Checked items and the
checkpoint above describe this slice; unchecked composite items still have
remaining work. Account authorization, OS grants and paid provider acceptance
remain explicit user actions.

### First-workspace setup

- [ ] Show a short welcome/setup flow on first entry to a workspace, with step
  progress, Back/Continue, skip, saved progress and a way to replay it in Settings.
  Reuse installation-wide appearance and permission state rather than repeatedly
  prompting for the same OS permission in each workspace.
- [ ] Let the owner choose a default agent from detected local runtimes and browse
  the remaining supported connections. Distinguish installed, authenticated and
  model-ready states. Selecting a default does not activate an account, inherit
  another workspace's binding, launch work or enable unrestricted execution.
  Keep review-required execution as the default; any broader tool policy needs
  a separate explicit choice, not the reference's enabled Yolo setting.
- [x] Offer System/Dark/Light appearance with useful previews and later editing.
- [ ] Offer optional GitHub setup: actual CLI/connection status, an appropriate
  setup link, re-check and Skip. Never silently install `gh`, authorize GitHub or
  advertise unimplemented issue/PR operations as working.
  The current introduction provides the official guide and skip; a native CLI
  status/re-check control remains to be added.
- [ ] Offer optional notification setup: explicit permission action, real
  platform permission flow where supported, accurate allowed/denied/unavailable
  status, a user-triggered test, sound choice where supported and later settings.
  Agent-completed and needs-input notifications open the relevant work. Browser
  notifications and packaged desktop notifications need separate verification;
  do not imitate a system prompt inside an app dialog.
- [ ] End with adding/choosing a project and, when needed, its local folder.
  Request file access only for a relevant explicit operation. Use the real
  platform picker/permission mechanism, explain denials and support retry;
  never require blanket Full Disk Access as the default setup path.

### Contextual tips, status and guided introductions

- [ ] Keep existing status/messages at the top. Put a separate contextual tips
  stack in the right-hand corner (proposed default: bottom-right), with responsive
  positioning that does not cover the composer, primary controls or open dialogs.
- [ ] Add folder/permission tips at relevant moments. Update or resolve them from
  verifiable access results, never from simply closing a prompt or assuming that
  a folder selection grants all future filesystem access. Stop asking once
  access is confirmed; permit dismissal after resolution and explain states the
  current browser/native host cannot observe.
- [ ] Give tips Close and Don't show again, plus Settings for enabled categories,
  duration (including until dismissed) and motion. Use bounded, interruptible
  spring/momentum entry and exit; honor app/OS reduced motion, pause timers during
  hover/focus/hidden tabs, and retain important unresolved state after dismissal.
- [ ] Add short introductions for important real features: anchored coachmarks
  move between their target controls, with progress, Next/Back, Skip/Close and
  replay. Keep them inside the viewport, preserve keyboard/focus access, wait for
  an available target and never execute the highlighted action automatically.
  The request to fly around means purposeful target-to-target movement, not a
  continuously wandering tooltip.

### Tabbed work environment and neutral Areas

- [ ] Follow the newer directory/tab specification above: normal navigation
  replaces the active mixed-content tab; New tab is explicit; CLI/agent sessions
  replace the current Conversations surface. Keep small confirmations/pickers
  as overlays, plus keyboard access and workspace-scoped session restoration.
- [ ] Preserve drafts, navigation/scroll position and stable entity references
  when switching tabs. Closing a tab is not deleting its record or cancelling
  running work; confirm unsaved loss and keep active jobs visible elsewhere.
  Bound background resources and restore views without automatically launching
  agents, terminals or paid requests.
- [x] Remove Area color customization and Area-derived tab/navigation tint.
  Render tabs neutrally; audit Area icon/illustration overrides for the same
  simplification. Preserve Area IDs/content and old color values as inert
  compatibility data, not active styling. Keep unrelated semantic status colors,
  code highlighting, provider branding and the global theme/accent intact.

### Local workspace with a phone companion

- [ ] Keep the end-to-end project workflow central: plan/brief → assign scoped
  work to a chosen personal agent → observe real progress and requests → inspect
  evidence/results → accept or request changes. A chat, profile or completed
  process alone is not completed project work.
- [ ] Build phone access to that same owner-controlled workspace: explicit secure
  pairing, encrypted transport, authentication, reconnect, revocation and clear
  host-awake/asleep/offline states. Support progress/results and reviewed actions,
  not a separate empty phone workspace. Do not expose a public listening port,
  add human memberships or promise offline-host execution to achieve this.

Acceptance for this batch includes temporary-data tests, first/repeated entry,
skip/replay, missing/denied permissions, permission-state changes, draft-safe
tabs, active jobs after tab closure, small screens, keyboard navigation and
reduced motion. Native notification/file permission behavior must be checked
on each supported packaged platform; fixtures alone cannot certify it.

## Complete local product backlog

Status distinguishes existing foundations from completed end-to-end products.
Nothing below is removed merely because it is lower priority.

| Capability | Starting point / remaining work |
| --- | --- |
| Local-only single-owner application | Added: normal start/dev entry points enforce local mode; hosted startup fails; invitation/member/role mutations are unavailable; preserve compatibility services internally. |
| Simplified settings/navigation | Added: hide members, Contacts, roles, access requests, billing and hosted app/API administration; retain tool permissions and optional local lock. |
| Automatic runtime detection | Added: read-only executable inventory without installing, authenticating or inference; expose unknown login/model status honestly. |
| Simple local provider setup | Added: direct Codex/Claude local-login activation in agent creation without a redundant account selector. Other protocols still need their reviewed helper setup and real compatibility tests. |
| Desktop installation and launch | Added: one-command local launcher with optional browser opening and port-conflict handling. Added Electron host, staged package scripts and native Mac smoke. Needed: Windows/Linux native verification, signed/notarized distributions where applicable, safe update/rollback and optional autostart. Certificates require owner provisioning. |
| Provider capability negotiation | Foundations exist; finish per-runtime models, reasoning/modes, tools, permission requests, images, interruptions and readiness. Validate vendors individually. |
| Session tabs and historical conversations | New direction: retire the old Conversations UI in favor of named agent/direct CLI sessions within the shared tab model. Preserve the existing persistent history, drafts and source scopes in a compatibility reader; migrate explicitly, not by deleting data or claiming provider-native history. |
| Project/task → execution → review | Existing Routes/runs/outputs/review; finish a simple guided end-to-end flow and source-linked results. |
| Local file workbench | Existing bounded files/editor/terminals/Git; expand practical editing, file previews, quick-open and terminal lifecycle. |
| Parallel worktrees | Existing worktree primitives; finish task-bound isolation, environment setup, port ownership, compare/merge and safe cleanup. |
| Visual code review | Existing snapshot comments and follow-up drafts; finish batched revision loops and clear stale-diff handling. |
| Browser verification | Added isolated native Chromium views; still needed: local browser runtime, isolated/user-approved browser profiles, click/fill/screenshot/console tools and evidence linked to agent work. |
| Visual page feedback | Needed: page-element selection, bounded DOM/styles/screenshot capture, annotations and explicit send-to-agent. |
| Bounded multi-agent delegation | Needed: durable parent/child tasks, task-scoped authority, bounded concurrency/cost/run counts, report-back, cancellation propagation and loop prevention. Existing handoffs are not dispatch. |
| Local scheduling | Existing schedules/event subscriptions; finish appropriate fresh-context consent, heartbeat continuation and visible asleep/missed/uncertain behavior. No work while its host is off. |
| Local notifications | Implemented opt-in setup and canonical-run notices; still needed: explicit opt-in native completion/needs-input notices and notification navigation, without claiming cloud push or delivery while the host is off. |
| Usage and account visibility | Existing reported usage; add supported account limits/reset times and owner-controlled execution budgets. Unknown metrics stay unknown; no quota bypass. |
| GitHub and optional external services | Retained connectors are paused. Re-enable selected capabilities only after provider configuration, review and live verification; no automatic external writes. |
| Backups and recovery | Existing exports/checkpoints; finish scheduled local consistent database backups, restore preview/drills and recovery from app/process interruptions. Keep secrets separate. |
| Search/context/memory | Existing lexical retrieval and approved memory; improve scoped retrieval without silently exposing private drafts/credentials or treating notes as authority. |
| Extension system | Needed if demand justifies it: trusted local MCP/tool configuration and a reviewed extension boundary; arbitrary plugin execution is not a sandbox. |
| Optional voice | Needed later: on-device dictation/TTS and explicit optional cloud speech. Not required to use the local core. |
| Personal phone/second-device companion | Part of the intended product, delivered in a separate explicit opt-in phase: authenticated pairing, encrypted transport, the same local workspace, remote UI/reconnect/revocation and clear host availability. No public port exposure by default. Execution host must remain online. |
| Quality and platform compatibility | Continuous: temporary fixtures, real per-provider acceptance, Windows/macOS/Linux tests, keyboard/a11y/reduced motion, crash recovery and resource bounds. |

## Not part of this edition

Public SaaS hosting, human membership/role workflows, enterprise SSO/SCIM,
operator-funded shared inference, a billing/subscription system, customer-support
intake and copying every Linear enterprise feature. Internal access records remain
for preservation and safety, not as user-facing team administration.

## Verification boundary

Tests use isolated databases and fake provider processes/network responses.
Do not sign in to real providers or run paid tests as a coding side effect.
Installer signing, external app authorization and live model acceptance need
their owner's explicit actions; successful fixtures do not replace them.

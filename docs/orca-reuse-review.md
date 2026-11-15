# Orca source reuse for local Frondose

Frondose now selectively adapts Orca tab ordering, terminal split-tree algorithms,
CLI metadata/startup strategy and browser guest policy within its local desktop
refresh. Frondose's planning, Routes, personal agents, progress and result review
remain the product layer. This is not the complete Orca application, terminal
daemon, browser or mobile stack.

## Implemented refresh and current limits

| Area | Implemented in Frondose | Still separate or unfinished |
| --- | --- | --- |
| Workspace and tabs | Explicit directory binding preserves existing records; mixed app/file/terminal/browser/session views use replace-current navigation, New tab, restoration and guarded dirty-file changes. | Broad migration of unrelated old project roots is not automatic. Restoring a tab is not execution authority. |
| File explorer and Markdown | Adjacent resizable explorer, bounded filename/content search, shared source/preview draft and conflict-aware explicit saves. | This is not Orca's entire Monaco/Rich Editor/file-workbench implementation. |
| Terminal | Real xterm/PTY service, adapted recursive horizontal/vertical split algorithms, resize/equalize/focus, saved view layout and explicit launch/stop. | No complete Orca pane-manager/add-on suite or independent persistent daemon. Process execution ends on server/OS shutdown; stored history is not process survival. |
| Local AI | Fixed server-side CLI catalog, filesystem discovery and native launch; reviewed named-agent first tasks for Codex/Claude using immutable profile checks and separate paid-work consent. | Discovery is not login/entitlement. Other CLIs are direct terminal identities; no universal structured tool/progress/response events or website-chat sync. |
| Browser | Electron-owned isolated Chromium views, typed trusted-app IPC, separate workspace cookie partitions and view hide/explicit close. | Ordinary web mode cannot embed the native browser. Downloads, popups/media grants, Design Mode, CDP tooling and remote frame/input transport are not included. |
| Setup and notices | Skippable/resumable/replayable setup, real explicit notification tests, local tips/tours and opt-in canonical-run status notices. | Native permission/delivery may remain OS-controlled/unknown; arbitrary raw CLI reply completion is not inferred. |
| Packaging | No-spaces private staging, production-only native rebuilds, source/native-input guards, Mac unpacked build and actual packaged PTY/Chromium fixture smoke. | Unsigned artifacts; Windows/Linux matrix is authored but not a completed native certification. |
| Phone | The same local host remains the intended workspace/execution owner. | Secure pairing, encrypted transport, reconnect/revocation and remote browser streaming are not implemented in this refresh. |

The source-file hashes and exact adaptations are recorded in
[the Orca notice ledger](../third-party/orca/NOTICE.md). The comparison below
describes upstream architecture and distinguishes it from the selective current
implementation.

## Source snapshot and review scope

The source snapshot is [stablyai/orca at
51dcef8258230ffea85a907130450b0ad676e22b](https://github.com/stablyai/orca/tree/51dcef8258230ffea85a907130450b0ad676e22b),
inspected October 25, 2026. It contains 39,381 tracked files, including tests,
assets, native code, build tooling and mobile/cloud code. Repository-wide tree
inventory and focused source tracing covered the requested tab, editor, terminal,
CLI-discovery, browser and phone dependency boundaries. This is not an every-line
review, a completed dependency-license audit or a security certification. The
original survey was read-only. The later refresh adapts the selected files in
the notice ledger; isolated tests run Frondose's implementation and do not use
real provider accounts or private workspace records.

| Source area | Role in the application |
| --- | --- |
| `src/renderer` | React interface, tabs, split layouts, terminal emulator, file/editor/browser presentation and application stores. |
| `src/main` | Electron host, PTYs/daemon, runtime RPC, filesystem/Git, provider launch, browser guests, persistence, platform services and external integrations. |
| `src/preload` and `src/shared` | Privileged renderer bridge, typed requests, tab/session/workspace contracts and reusable algorithms. |
| `src/cli`, `src/packages`, `src/wsl-guest` | Command-line control, process-host/runtime packages and WSL execution. |
| `mobile` and `cloud` | Companion app, authenticated transport, relay and other hosted infrastructure; these are not supplied by copying the desktop UI. |
| `native`, `config`, `tests`, `resources` | Platform bindings, dependency patches, builds/signing/updates, test infrastructure, bundled assets and notices. |

## What can be reused and what must change

### Terminal and splits

The inspected renderer uses **xterm.js**, with WebGL and other add-ons. Orca's
Ghostty configuration support is not evidence that the terminal is the native
Ghostty engine. The terminal experience spans a real process backend and renderer:

- `src/renderer/src/components/Terminal.tsx`, `TerminalSurface.tsx` and
  `TerminalSplitWorkspaceSurfaces.tsx` compose terminal surfaces.
- `src/renderer/src/lib/pane-manager/pane-dom-creation.ts` constructs xterm and its
  add-ons; adjacent WebGL loaders handle rendering lifetime/recovery.
- `src/shared/workspace-layout/terminal-pane-tree.ts` and
  `src/main/runtime/headless-terminal-split-layout.ts` implement recursive split
  topology and its persistence.
- `src/main/providers/pty-provider-contract.ts` and `local-pty-provider.ts` connect
  the UI/runtime to actual terminals.
- `src/main/daemon/pty-subprocess/native-pty-spawn.ts` uses `node-pty`, with
  platform-specific process/security handling. `pty-subprocess/shell-launch-plan.ts`
  handles shell selection, including Windows/WSL differences.
- `src/main/daemon/history-manager.ts`, daemon adapters and checkpoint persistence
  own scrollback/reconnect. The out-of-process daemon can survive some client/app
  lifecycle changes; neither saved history nor reconnect guarantees that a live
  process survives an OS restart.

Port this as a complete reviewed subsystem, including IME/input, clipboard,
selection/search, resize, backpressure, process ownership, required native patches,
cleanup and tests. `Terminal.tsx` alone cannot provide those features. Native
terminals run as the OS user; their starting directory does not confine them.

Orca's `store/terminals/terminal-tab-close.ts` and
`terminal-tab-close-providers.ts` can retire/kill a terminal provider on explicit
tab close. Frondose must distinguish replacing/hiding a view from stopping its
backing session, with explicit confirmation for a true session stop.

### Local CLI detection and launch

`src/main/preflight/installed-agent-detection.ts` resolves known agent commands;
`agent-command-detection.ts` checks PATH and bounded standard installation
directories. `src/shared/tui-agent-detection-commands.ts` and `tui-agent-config.ts`
define aliases, requirements, platform support, command arguments and differing
prompt-delivery/readiness behavior. `useDetectedAgents.ts` shares inventory state
across the interface. Runtime launch planning is in
`src/main/runtime/runtime-agent-terminal-startup.ts` and its terminal/session
creation modules.

This is **discovery and launch, not automatic provider authentication**. A native
CLI uses its own existing login/configuration; missing sign-in or model access
remains a provider setup issue. Frondose need not add its own OAuth screen before
launching an already usable local CLI. It must not claim that detection proves a
subscription, entitlement or successful inference.

There is a relevant side effect: `src/main/ipc/agent-detection-shell-path.ts` calls
`startup/hydrate-shell-path.ts`, which can run a profile-loading user shell to
recover PATH entries missing from GUI launch. That executes shell startup files.
Reuse known-directory discovery first; profile hydration needs an explicit
trusted-host decision rather than being described as filesystem-only inventory.

Direct AI tabs and named agent sessions should both use the actual chosen CLI,
but named agents additionally retain Frondose personalization and task/result
identity. A provider-terminal UI does not automatically expose structured progress,
tool approvals or response events for every CLI; negotiate those capabilities.

### Tabs and files

Renderer-relative paths in this section are based at `src/renderer/src/`.

`src/shared/tab-types.ts` separates tab identity from content and supports mixed
content plus split groups. It also includes a tab color field; do not retain that
as active Frondose styling. `components/tab-bar/tab-create-menu-options.ts` and
`tab-agent-launch-options.ts` cover terminal/browser/Markdown and detected agent
choices. `components/right-sidebar/FileExplorerViewSwitch.tsx` supplies the
Names/Contents switch in the supplied reference.

Orca does **not** universally replace the current mixed-content tab.
`store/slices/editor/actions/open-file-apply.ts` reuses an existing path or an
eligible preview in the same owner/group; `open-file-mutations.ts` promotes an
edited preview to a permanent tab. Frondose's requested behavior needs a central
navigation operation that replaces the active tab across app pages, files and
sessions, while retaining backing-session identity.

`components/editor/EditorViewToggle.tsx` offers Source, Rich Editor and Preview.
The source and rendered views depend on shared file buffers and disk identity.
`editor-save-disk-precondition.ts` protects normal saves against changed disk
baselines. `use-terminal-editor-close-dialog-actions.ts` waits for save success;
failed or stale saves do not close the file. Adapt that behavior to Frondose's
arrow-to-tab Save changes/Discard/Cancel dialog and Cmd/Ctrl+S handling. The arrow
dialog itself is a Frondose addition, not existing Orca behavior.

Orca's explorer is on the right, and its generic resize hook clamps minimum
width. Moving it between Frondose navigation/main content and adding independent
drag-to-collapse boundaries requires a new layout composition. Preserve accessible
resize controls, persisted widths and reliable restore actions.

### Browser and visual feedback

`components/browser-pane/host-guest/browser-page-webview.ts` creates Electron
`webview` guests. `src/main/window/createMainWindow.ts` enables the host/preload;
`main-window-webview-security.ts` sanitizes guest settings, pins partitions and
disables Node integration for pages. `src/main/ipc/browser.ts` checks trusted
sender and guest ownership. These are necessary boundaries, not optional styling.

This is embedded **Chromium**, not automatic access to installed Google Chrome,
its current tabs or its login profile. The current Frondose regular website cannot
gain that capability by pasting the JSX or adding an iframe. It needs a desktop
host or a local browser service with its own rendering and input transport.

Browser sessions retain separate cookie/profile partitions and permission,
download/navigation policies. Design Mode uses privileged page selection,
bounded DOM/style extraction and a captured/cropped screenshot through
`browser-manager-grab.ts`, `grab-guest-element-context-script.ts`,
`grab-guest-content-script.ts` and `browser-grab-screenshot.ts`. Adapt it as reviewed
context preparation, never as webpage-provided authority to launch an agent.

### Phone transport and product services

Orca's phone access uses a desktop-hosted authenticated WebSocket RPC layer,
device identity, revocation/reconnect and remote streams. Browser pages can use
hidden Electron BrowserWindows (`offscreen-browser-backend.ts`) and CDP frames
(`browser-screencast-stream.ts`), with a corresponding mobile frame protocol.
That is runtime transport, not just copying a database to a phone.

`runtime-rpc-mobile-pairing.ts` distinguishes automatic relay-plus-local pairing
from local-only pairing, and explicitly enables networking when requested.
Frondose needs its own secure pairing path and clear asleep/offline states.
Local/VPN access can be an explicit first phase; anywhere access needs a reviewed
transport/infrastructure choice, not inherited promises about Orca's services.

Do not carry over the defaults for `login.onorca.dev`, `relay.onorca.dev` or
`push.onorca.dev`, Orca OAuth client identifiers, update feeds, signing identities
or push registrations. Telemetry exists but its source gates transmission on
official build identity/key and consent; do not claim every fork automatically
transmits. Keep Frondose's policy explicit and disable unrelated transport paths.

## License and attribution

The [root MIT license](https://github.com/stablyai/orca/blob/51dcef8258230ffea85a907130450b0ad676e22b/LICENSE)
allows copying, modification and distribution subject to retaining its copyright
and permission notice for copies/substantial portions. The copyright is
2026 Lovecast Inc. MIT does not supply service credentials, official endorsement
or signing certificates.

Separate dependencies/assets have their own notices, including
`resources/licenses/ripgrep/`, `resources/licenses/shadcn/LICENSE-MIT`, Monaco
grammar notices and font OFL files. Before vendoring each subsystem, record its
source commit, copied files, required patches/dependencies, modifications and
attribution in a Frondose third-party notice ledger. Do not assume a root license
audits every dependency or authorizes using provider/Orca branding as our identity.

## Integration continuation

### November 14 source review: Browser Import and Chat UI

Reviewed Orca main at [d7c6ab18526ba](https://github.com/stablyai/orca/tree/d7c6ab18526ba6173b5d701b936c3d3371fd8b12).
The implementation retains Frondose's trusted-main-frame and workspace boundaries.
No real browser data was used for development or validation.

- **Browser data:** `src/main/browser/cookies/` detects local profiles and reads
  cookies in the main process. The Chromium path snapshots SQLite and its WAL,
  resolves platform-protected keys when necessary, skips non-transplantable
  and unrepresentable cookies, then writes to a nominated browser session.
  Cookie-file import is a separate path. `src/main/browser-passwords/` imports
  saved logins into an OS-backed encrypted vault; it is not needed for cookie
  import. Neither of those paths is a bookmark/history migration.
- **Chat UI:** `src/main/codex/app-server/codex-app-server-connection.ts`
  owns the Codex app-server connection, and
  `src/main/claude/claude-stream-json-connection.ts` owns the Claude Agent SDK
  transport around Claude Code. The shared renderer provides rich turns,
  approvals, composer controls, changed-file reviews and supported explicit
  continuations. It does not embed the official provider apps.
- **Fit for Frondose:** Start with an explicit, local import from a chosen source
  and selected sites, into a reviewed workspace Browser destination. Use
  synthetic profiles for tests. Keep cookie values out of renderer IPC, logs,
  exports and AI context; do not automatically request broad permissions or
  touch saved passwords. Implement the chat changes over the existing Codex
  and Claude Code conversation backend rather than replacing terminal panes
  or inventing a desktop-app embedding. Preserve existing drafts, provider
  approvals, runtime ownership and Claude's current explicit API-key boundary
  until a separately validated account option exists. Keep official app
  launching a separate choice. Cover the selected flows in Browser and
  AI Sessions Docs and in the dated notes for the build that implements them.

- **Implemented import boundary:** Import browser data accepts explicitly
  selected site cookies from macOS Chromium-family profiles, Firefox and
  readable Safari storage, plus bounded desktop cookie files. The preview
  sends domain counts only. Frondose writes matching entries without clearing a
  whole existing domain. No saved-password vault, bookmark/history migration,
  off-host transfer or native Linux/Windows profile decryption is included.
- **Implemented AI boundary:** AI Sessions provides clear Chat, Terminal and
  Desktop apps modes. Codex and Claude Code share the structured UI; additional
  agents need a supported protocol adapter to join it. Terminal and official
  app launch remain available without pretending they expose chat transcripts.

1. Finish broader compatibility migration and end-to-end project/task/result
   workflows around the implemented directory binding and mixed-content tabs.
2. Extend terminal functionality only with the necessary process/history/native
   dependency closure, then validate real supported shells on all three systems.
   An independent daemon requires its own ownership/reconnect/crash design.
3. Verify supported named-agent protocols against owner-authorized real accounts;
   add each additional provider's capabilities without silently dropping its
   personalization or promising universal progress/permission semantics.
4. Add reviewed browser permission/download/profile workflows and visual tools,
   then implement secure own-device phone transport separately.
5. Run the authored Windows/Linux jobs, installer acceptance, keyboard/touch,
   reduced-motion and crash-recovery checks. Provision signing/notarization and
   release infrastructure before treating these as public distribution builds.

`src/components/workspace/WorkspaceSurface.jsx` now hosts the mixed-content tabs.
`server/directory-workspace.mjs` binds filesystem operations to the selected root,
while `server/workbench-service.mjs` retains actual PTY/session ownership and
`desktop/` supplies native browser views. Legacy Workbench and conversation data
remain compatible; retiring a primary navigation surface does not delete history.

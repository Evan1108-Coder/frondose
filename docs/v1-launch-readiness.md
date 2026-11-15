# Frondose v1 launch readiness — November 1

## Release scope

Ship a local-first desktop workspace: one project directory, planning Routes,
files and review notes, native terminals/AI CLIs, browser tabs, source control,
worktrees and explicitly scheduled local work. Start with a Mac beta. Do not
market cloud hosting, always-on phone access, universal native-app embedding or
full Orca/Paseo parity as finished features.

## This request batch

- Onboarding Checklist is the first Settings entry for a workspace. Four small
  steps observe a directory, default CLI, first Route and native Browser use;
  optional skips are labelled. Completion produces a bottom-left celebration.
  On a later Settings visit it sparkles away once and remains retired on this
  device. Workspaces have separate progress. Reduced-motion users get no sparkle.
- CLI Agents settings lists detected tools, chooses a default and saves reviewed
  literal executable/argument overrides for future explicit new sessions. No
  setting change runs a command. Owner/revision validation prevents foreign or
  stale writes. Existing sessions, native Resume and schedules stay unchanged.
- Orca-derived install lookup now includes configured version managers and the
  Windows fnm layout. Frondose also checks real Codex/ChatGPT bundle executables
  on Mac. Discovery is not sign-in, entitlement or model verification.
- Browser entry searches ordinary words and preserves URLs/localhost. It rejects
  local paths, unsafe schemes and embedded credentials rather than searching
  them. Guest navigation still uses strict URL validation.
- Whole saved comment cards and their handles support scoped drag context.
  Interactive controls remain usable, including cards inside a code editor.
  Draft insertion never sends Enter. Desktop Copy context has a trusted bounded
  write-only clipboard bridge; denied web writes provide manual selection.
- Directory dialog footers own padding and wrapping. Settings shares the normal
  sidebar's saved width. Docs folders use the shared animated Collapse component.
- Field Defaults now discovers 231 source inputs, including newly eligible
  names, task prose and search fields. It still excludes commands, source buffers,
  credentials, account/permission/schedule values, addresses and previews.
- New in-app setup documentation and pinned MIT reuse notices are included.

## Evidence and limits

The full isolated suite passed 2,385 tests before the final small editor-ancestor
drag guard; all 13 focused release-polish tests passed after that guard. Fixtures
cover Windows/Mac/Linux command plans, not real Windows/Linux installations.
The production frontend builds. Separate UI checks observed checklist progress,
completion toast, next-entry retirement, CLI default/command saving, successful
web comment copying and the corrected padded directory dialog. No real model
prompt, login or external GitHub write was used as a test.

The installed Mac activation and package smoke result are recorded separately in
the cumulative request audit. The installed Mac app now visibly renders the local test page and passes link,
Back, Forward and Reload checks. The typed word hello became a Google search,
not an invalid host; Google's regional redirect timed out on this network, so
successful search-result loading is not claimed. The new native Settings pages
render, the saved sidebar width matches, and Codex is detected in the actual app.
Native clipboard clicking, other websites and phone-sized views still need direct
acceptance. The Mac locked before the final saved-comment copy test. Plan-usage
telemetry also intermittently reports unavailable; this is not CLI-install detection.

## Must finish before public v1

1. Run the installed-app acceptance matrix: fresh workspace → directory → Codex
   discovery → new/resumed CLI → scrolling/splits → file edits/conflict → comments
   → context handoff → reopen. Use both clean setup and an upgraded local store.
2. Verify real Browser paint, search, localhost, back/forward/reload, tab switching,
   failed URLs and isolation in the installed package. Test actual clipboard
   copy and the denied-web fallback without granting guests new permissions.
3. Finish responsive/accessibility acceptance across narrow split panes, minimum
   desktop size and phone widths: dialogs, Settings, Docs, menus, focus/keyboard,
   reduced motion, long filenames and text. Fix evidence-backed issues; do not
   claim that source assertions prove all layouts are perfect.
4. Validate backup/export AND restore on a disposable installation, failed saves,
   crashes and migrations. Never overwrite dirty drafts or replay native work.
5. Test long-running terminal output/input latency and resource cleanup; document
   when Frondose/computer must remain running. Do not equate PTY dispatch with
   agent completion or infer idle from silence.
6. Produce and exercise real Windows and Linux installers on those systems before
   claiming support. Mac x64 acceptance is not Apple Silicon or Linux certification.
7. Choose distribution, versioning and release ownership. Public trusted Mac
   auto-updates need a publisher signing/notarization and hosted release feed.
   Windows likewise needs tested packages and an appropriate trust/update plan.
   Local builds must say when automatic updates are unconfigured.
8. Audit loopback/auth/lock boundaries, file traversal/symlinks, command arguments,
   credential storage, guest origins, update signatures and dependency licenses.
9. Align public/in-app docs and screenshots with the chosen release scope. Keep
   unsupported features visibly unavailable; disclose CLI permissions/provider
   charges, local storage and backup limits. Replace preview contact/download
   destinations before advertising working support or distribution.
10. Run a small external beta and resolve data-loss, startup, navigation and
    accessibility blockers before broader launch. Keep a reproducible bug list
    with package version, platform and screenshots/recordings.

## Keep out of v1 unless separately completed

- Always-on phone/SSH/cloud execution while this host is asleep.
- Arbitrary desktop apps (including Parallels) embedded as if they were web apps.
- Automatic website chat-history sync and universal provider account OAuth.
- Unattended multi-agent orchestration, universal busy/idle detection, and automatic
  transfer of a pending comment into a newly created CLI.
- Google Docs parity, every terminal graphics protocol and every source language.
- Human members/roles, billing and retired agent-profile/AI-connections navigation.

For the requirement-by-requirement history and superseded choices, use
[the cumulative audit](current-request-audit.md). This is a launch gate list,
not a statement that all earlier requests are already accepted.

### Final repeat-run note

The final-source full rerun passed 2,383 of 2,385 tests and hit two unchanged
15-second request timeouts in legacy Frondose-agent API fixtures. Both failed
cases passed independently (878 ms and 1,282 ms) without changing their limits
or assertions. The preceding full run passed all 2,385; all 13 focused tests
passed after the last drag guard. This is recorded as timing instability, not
hidden as an always-green final repeat. Stabilize release-CI resource concurrency
and repeat this matrix before claiming public launch readiness.

### Native clipboard follow-up — November 1

After the user unlocked the Mac, the installed app opened the existing saved
CHANGELOG.md note. Refreshing and raising the native window restored input;
Copy context changed to Copied context in the accessibility tree, without a
clipboard-permission error. The editor remained Saved with no unsaved files;
no comment was edited and no CLI was started. This supersedes the earlier
locked-Mac clipboard check blocker. Clipboard bytes were not independently read
back; the screen-capture frame remained stale, so the AX confirmation, not the
unchanged screenshot, is the evidence for the successful action.

### November 1 evening sidebar, allowance and Comments correction

Settings used 40px rows because its ColorableNavItem parent and spans both had
vertical padding. It now matches main navigation's 32px rows and saved width,
with a 32px search field and shorter section gaps. Measured in the isolated
1280x720 preview: both rails 224px, all measured rows 32px, no page overflow.
Installed Mac preserves the actual owner's 246px navigation width.

Codex raw usedPercent remains unchanged. Presentation defaults to Remaining,
with matching visible left label, bar fill and accessibility value. Appearance
offers Used/Remaining. Regression: 55% used becomes 45% left. The installed Mac
read 44% left on the later live check; this is live account-wide data, not a
hardcoded value. Empty Comments now has one padded empty state, no unusable
handoff buttons and no empty discussion column. Populated fixture discussions
retain visible Send, Drag and Copy actions with wrapping gaps.

Validation: 89 focused tests passed; production client build passed (existing
large-chunk/dynamic-import warnings remain); isolated packaged Mac PTY/Chromium
smoke passed. CUA visual checks covered Settings, empty/populated Comments and
the preference interaction, with no preview console warnings/errors. The
installed app was backed up, updated and relaunched only after fresh checks
showed all project terminals stopped, no home-scope terminals and no unsaved
file. Native Settings, empty Comments and remaining quota were then observed.
No user files/comments were edited and no CLI prompt was submitted. Mobile
viewport and native Windows/Linux were not rerun for this small correction.
The checkout remains heavily pre-dirty, so unrelated changes were not bundled
into a direct Git push. This receipt covers these three corrections, not every
historical launch-readiness item.

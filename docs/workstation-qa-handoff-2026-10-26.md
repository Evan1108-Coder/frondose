# Frondose local workstation — QA handoff

October 26, 2026, final v5 source/build checkpoint. This is a local development
handoff, not a public release or full Orca-port certification.

## Delivery state

The new Mac x86_64 application is staged separately at
`dist-desktop-next/mac/Frondose.app`. The existing application/data locations were
not replaced. The real `127.0.0.1:4174` server was deliberately **not restarted**
to preserve its two user-owned terminal sessions. Consequently, that running
backend has not been upgraded in place; adopting the new backend requires a
controlled handoff after the user decides how to handle those sessions.

## Implemented in this batch

- Explicit Terminal/AI CLI chooser clicks open directly without a runtime form.
  Bound workspaces use their validated directory; folderless workspaces use a
  separate server-owned OS-home terminal scope, without creating a project or
  granting home file/Git access. Restore/refresh/hover never launch work.
- Ordered terminal input/output transport, scrollback, Scroll to latest, split
  panes and scoped Quick Commands. Stop/close, pending work and unsaved-file
  guards remain. See [native CLI boundaries](native-cli-sessions.md).
- Browser-style named/refreshable/vertical tabs, up to eight resizable grouped
  views, drag previews and pane docking with stable live-pane identity. Settings
  and Docs remain standalone; mobile content and controls reflow.
- Isolated Chromium views and corrected local-address handling; optional local
  Git/GitHub inspection with guarded branch changes. No automatic stash, reset,
  repository initialization or push. See [Git/GitHub](local-git-github.md).
- Opt-in, bounded local **Codex and Claude Code** history search and validated
  exact native resume. No provider website import, universal history support or
  two-way transcript synchronization. See [history search](local-session-history-search.md).
- What's New release presentation/read state, retained Help resources, compact
  terminal settings and notification handling. Ad-hoc signing or API success
  alone is not proof that a user-visible OS notification banner appeared.

Source entry points: `server/workbench-service.mjs`,
`src/components/workspace/TerminalWorkspace.jsx`,
`src/components/workspace/WorkspaceSurface.jsx`, `src/lib/workspace-tabs.js`,
`src/lib/workspace-view-layout.js`, `src/lib/browser-address.js`,
`server/local-session-history.mjs`, `server/local-git.mjs`,
`src/components/HelpMenu.jsx` and `src/components/ReleaseReader.jsx`.

## Verified evidence

- **2,094/2,094 tests passed**, zero failures/skips/cancellations, in 105.5 seconds:
  `/private/tmp/frondose-full-final-v5.log`. Command: Node `--test
  --test-concurrency=4 tests/*.test.mjs`. `git diff --check` also passed.
- Client build passed (13.98s):
  `/private/tmp/frondose-workstation-v5-build.log`. The large-chunk warning
  remains; passing the build does not remove that optimization work.
- Private-staging Mac package passed:
  `/private/tmp/frondose-workstation-v5-package.log`. Native dependencies were
  rebuilt in staging, not in the checkout; private workspace data was not a
  packaging input.
- Isolated packaged Mac smoke passed a real native PTY and a Chromium guest
  open/hide-without-destruction/explicit-close flow:
  `/private/tmp/frondose-workstation-v5-smoke.log` (`FRONDOSE_PACKAGED_PTY_OK`,
  `FRONDOSE_DESKTOP_SMOKE_OK`). This was separate from the real server/sessions.
- Read-only `codesign --verify --deep --strict --verbose=2` passed for the staged
  app. `/private/tmp/frondose-workstation-v5-signature-check.log` records
  `Signature=adhoc`, identifier `app.frondose.desktop`, and no TeamIdentifier.
  This is **not Developer ID signing or notarization**; notarization was skipped.
- Twenty sequential fake-CLI HTTP echoes measured p50 **16.985ms**, p95
  **21.924ms**, maximum 22.681ms:
  `/private/tmp/frondose-transport-benchmark.json`. Boundary: loopback input POST
  start to matching fixture text available through output GET, excluding startup.
  This is **not keyboard-to-screen/render latency**, xterm batching, real-provider
  inference or an end-to-end performance guarantee. Only the benchmark-created
  fake session was gracefully exited, with exit code 0.

Fixture screenshot captures (temporary local files, not a complete device matrix):

- `/private/tmp/frondose-eight-views-final.png`
- `/private/tmp/frondose-github-issues-final.png`
- `/private/tmp/frondose-history-search-final.png`
- `/private/tmp/frondose-mobile-docs-final.png`
- `/private/tmp/frondose-mobile-views-final.png`

## Remaining acceptance/release work

Actual provider sign-in, paid inference and real-account historical-session
acceptance remain untested; QA used generated histories and fake providers.
Windows/Linux native-machine/package validation and Mac ARM acceptance remain
separate from cross-platform source/fixture coverage. No blanket OS/provider or
notification-banner certification is implied.

The native updater is **queued, not implemented**. It still needs Frondose-owned
release hosting/feed, platform/version metadata, signing/verification configuration,
safe download/install/recovery and fresh active-work/draft guards before any
restart. What's New articles are not installable releases. The full requirements
are in [the updater queue](local-first-roadmap.md#queued-after-the-current-workstation-batch--native-app-updates).

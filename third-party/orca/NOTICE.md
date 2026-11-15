# Orca reuse provenance

Frondose selectively adapts code and command metadata from
[stablyai/orca](https://github.com/stablyai/orca), copyright (c) 2026 Lovecast Inc.,
under the MIT license. The complete upstream notice and permission terms are
retained in [LICENSE](LICENSE), and the browser adaptation also carries a copy in
`desktop/ORCA-LICENSE.txt`. Frondose is not an official Orca distribution and this
reuse is not a complete terminal, browser, daemon or application port.

## Pinned source

### October 30 repository work and inline review adaptation

Additional inspected revision: `00de405c5c0cffea06c2beb6eb0a0038b5d53fe6`.
The existing MIT license is unchanged. Frondose translates the deterministic
review-card stacking and line-range ordering helpers into
`src/lib/repository-work.js`. `MarkdownReviewNotes.jsx` adapts the nonmodal
margin-composer interaction rather than copying Orca's Tiptap application.
The Git staging, commit and worktree handlers inform Frondose's corresponding
workflows; Frondose implements its own directory authority, stale snapshots,
private-path checks, exact local Route launch ledger and explicit confirmations.
These additions do not port Orca's autonomous orchestration CLI or MCP bridge.

Original source SHA-256 values at this additional revision:

```text
9846c6da0729a1653c04d120bafb6aaf938ebbb41c4c76c51508d08b3feb4327  src/renderer/src/components/editor/rich-markdown-review-note-layout.ts
e4e1a3011a01d185db9c9062e2eaacce36198c056e9b21dd4905304170ac3951  src/renderer/src/components/diff-comments/diff-comment-line-range.ts
d0413dc99256d38c27458c3a0809e8a7df42d01c84f82c4253bf91ad130d9cfe  src/renderer/src/components/editor/MarkdownPreviewAnnotationComposer.tsx
cb6f14334d35c99b7d23ded8cdb1567f23738bd9b9bb03adaa5db2fda3dab6a9  src/main/git/source-control/staging.ts
cbbdc96d7db24627d67eda33d9c07af8646e709962caf6b33f016d9b39b7e83c  src/main/git/source-control/commit-changes.ts
dc5fe78add92c99de2b963f68dc5146067b589bc165382005689e97d420ba862  src/main/git/worktree-add.ts
```

The October 30 evening automation lifecycle also references the preflight,
reserved-dispatch and honest completion distinctions in
`src/main/automations/headless-dispatch-runner.ts` (SHA-256 `3380f1317010357de71fa5ace7be041e426316662eaaa849c377cd2faf00a476`).
Frondose implements its own SQLite Route schedules/receipts; it does not reuse
Orca identities, remote workers or session-reuse authority. A live PTY remains
"dispatched", never inferred to be AI-complete.

### Earlier tab, terminal and browser adaptations

Repository: `https://github.com/stablyai/orca`

Revision: `51dcef8258230ffea85a907130450b0ad676e22b`

The following SHA-256 values identify the original source files at that revision,
not the modified Frondose targets. They can be checked against an independently
obtained checkout; no build needs to execute or fetch upstream code.

```text
ce2caaa99ae05a589eb9505b034f789b584f19b1c2f8a295d0d861679824456f  src/shared/tab-types.ts
f440946e0e50679db9290a56ef4b0fec5fcd83a888ce31b7f06348d11fdc5fe4  src/shared/workspace-layout/tab-order.ts
85af57a3f1b783822b146e586ded6c63a6d83b30f4db9ca8927ddd2cbd0e8eb1  src/shared/workspace-layout/terminal-pane-tree.ts
a17c3061d5b28e3d45a807604342654e5e8a05c64a8bc8c70081e67fda5bbbbc  src/shared/tui-agent-config.ts
1769a86a0cfcf1708da9953e0230b6be7d6a477465e3eb7e51a64ab39eca75c2  src/shared/tui-agent-startup.ts
b010ac1ea3248a377dafda571a09995c4d3b103d748dc38c70979fa19d763f1b  src/main/window/main-window-webview-security.ts
cec3312fdfd03bb566917abe6a9b6a702b644c271eefec7075a364d0ed3280a5  src/shared/browser-guest-web-preferences.ts
f2fc5da77d06ff593e867ce5907ffc006daacf487ea65ecba2d96ec26a06ecbe  src/shared/node-cli-command-resolution.ts
0635cf902acdea8f75f0fc306d61d08e3fe583df967d0de62051d35523b663e7  src/shared/system-cli-install-dirs.ts
d19922edb378e7fb3c908dc4779a1a214d19d5a26b9fc111ee11344cc5574c70  src/shared/cli-runtime-pairing-inputs.ts
d9a66ed19ba049f84bbac7ce723e9fd95092f15cd8eba15ee70bcefc29f86c4f  src/main/ai-vault/session-scanner-primary-parsers.ts
2f7c4151d457492300222c89a9973c75e648d8b5bb994cc336e1e1bdf712e538  src/main/ai-vault/session-scanner-codex-parser.ts
1595888cd293cb0522bc35982cbabde465f1f16e1eadbc2879f9bf0242ba89e5  src/main/ai-vault/session-scanner-codex-message-records.ts
ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3  LICENSE
```

## Adaptation ledger

### Mixed content tabs

Frondose target: `src/lib/workspace-tabs.js`

Sources: `src/shared/tab-types.ts` and
`src/shared/workspace-layout/tab-order.ts`.

Reused portions: mixed-content tab/content identity concepts, order deduplication
and pinned-partition-aware insertion. Frondose adds its own app-page types,
universal active-tab replacement, bounded/versioned browser persistence,
restoration validation, explicit New tab, view-only close/reopen and removal of
active tab-color fields. Orca's full Zustand stores, preview replacement rules
and provider retirement on close are not copied unchanged.

### Terminal split tree

Frondose target: `src/lib/terminal-splits.js`

Source: `src/shared/workspace-layout/terminal-pane-tree.ts`.

Reused portions: recursive leaf traversal, containment, insertion/removal and
equalization algorithms. Frondose converts the selected TypeScript algorithms to
JavaScript, validates restored IDs, clamps editable split ratios, bounds depth
and visible panes, and keeps leaf removal separate from stopping a PTY. The
surrounding `TerminalWorkspace.jsx` integrates these algorithms with Frondose's
existing xterm/PTY API; it is not Orca's entire Terminal component or daemon.

### CLI metadata and reviewed startup

Frondose target: `server/terminal-launch-plan.mjs`

Sources: `src/shared/tui-agent-config.ts` and the argv-prompt startup strategy in
`src/shared/tui-agent-startup.ts`.

Reused portions: provider labels, executable aliases, required commands and
selected fixed launch arguments, plus the distinction between provider-specific
prompt delivery modes. Frondose resolves installed commands on the server,
strips unrelated provider/operator environment variables, does not install
packages or hydrate shell profiles, and deliberately omits pre-trust and
approval-bypass flags. Reviewed first tasks are limited to native Codex/Claude
executables, with arbitrary task text passed as a separate argument rather than
a shell-composed command; unsupported Windows batch shims fail closed. The exact
Frondose profile/task rendering in `src/lib/native-agent-session.js` is Frondose
code. Detection does not authenticate a provider or establish model entitlement.

### Browser guest policy

Frondose target: `desktop/browser-policy.cjs`

Sources: `src/main/window/main-window-webview-security.ts` and
`src/shared/browser-guest-web-preferences.ts`.

Reused portions: hardened guest preferences, including no Node integration,
context isolation, sandboxing, web security, no insecure mixed content and
fullscreen-resize containment. Frondose owns `WebContentsView` guests in its main
process instead of accepting renderer-supplied Electron webview preferences or
preloads. It adds fixed-loopback application trust, typed IPC operations,
workspace-separated cookie partitions, bounded URL/view validation and explicit
guest hide/close semantics. This does not port Orca's whole browser manager,
Design Mode, CDP tools, remote screencast, profile management or mobile transport.

### Local CLI installation discovery

Frondose target: `server/terminal-install-discovery.mjs`, integrated by
`server/terminal-launch-plan.mjs`.

Sources: `src/shared/node-cli-command-resolution.ts`,
`src/shared/system-cli-install-dirs.ts`, and
`src/shared/cli-runtime-pairing-inputs.ts`.

Reused portions: conventional CLI install-directory ordering, nvm default alias
resolution/version ordering, and native executable versus sibling-Node runtime
pairing. Frondose uses bounded asynchronous filesystem reads, inherited absolute
PATH precedence and Windows case-insensitive environment handling. It excludes
relative/cwd search and never executes shell startup files, installs software,
authenticates a provider or launches a model during detection. Directory scanning
is shared across a catalog refresh rather than repeated for every provider.

## Dependencies and product identity

### Native CLI session history record selection

Frondose target: `server/local-session-history.mjs`.

Sources: `src/main/ai-vault/session-scanner-primary-parsers.ts`,
`src/main/ai-vault/session-scanner-codex-parser.ts` and
`src/main/ai-vault/session-scanner-codex-message-records.ts` at the pinned revision.

Adapted portions: first native session metadata/origin cwd, custom-title
precedence, normal versus paginated/legacy Codex message selection, and visible
user/assistant text-record classification. Frondose deliberately excludes native
tools, thinking/reasoning, system/API blobs and internal/sidechain transcripts.
The surrounding bounded JSONL reads, private opt-in settings, RAM-only index,
root/symlink/source-version checks, opaque result identities, exact resume leases
and search UI are Frondose implementations. Orca's full AI Vault/SQLite FTS,
remote/WSL scanning, transcript enrichment, provider catalog and shell-composed
resume commands are not copied or advertised as complete.

Orca's MIT terms do not replace licenses for Electron/Chromium, xterm.js,
node-pty, fonts, icons, provider marks or other dependencies. Their own notices
and distribution obligations remain separate. Frondose does not claim that a
dependency was written by Orca or Frondose merely because it is used by both.

No Orca cloud login, relay, push, updater endpoint, signing identity or service
credential is included by this adaptation. Orca and third-party product names
identify their respective software; they do not imply endorsement or transfer
trademark rights. Frondose uses its own product identity and the owner-approved
Frondose artwork.

### October 31 Codex account-allowance adaptation

At revision `00de405c5c0cffea06c2beb6eb0a0038b5d53fe6`, Frondose adapts the
read-only app-server initialization/rateLimits request sequence and bounded
window normalization into `server/codex-quota.mjs` and
`src/lib/provider-quota.js`. Sources: `src/main/rate-limits/codex-rpc-rate-limit-probe.ts`,
`src/main/rate-limits/codex-rate-limit-window-mapper.ts`,
`src/main/rate-limits/codex-rate-limit-window-classification.ts` and
`src/main/codex-cli/codex-read-only-app-server-args.ts`.
Frondose does not copy raw credential/backend HTTP fallback, reset-credit
actions, account management or Orca IPC. It uses its existing guarded transport,
filesystem-only discovery, local account paths, private probe directory and
owned-child cleanup. Real window lengths are retained; missing data is unknown.

Original SHA-256 values:

```text
6e55fec774bb84b499a37b1010d920b70dc85ec25ad08f23619206945f9208c8  src/main/rate-limits/codex-rpc-rate-limit-probe.ts
0c85c06806dd690eeecf27557c6caa1a3b270ee07302a1cf06e0c6a6beebc13d  src/main/rate-limits/codex-rate-limit-window-mapper.ts
f8798af2e47021070b164f979462b39c5c5b6ba8bbd30855fe8bb16beee1ef23  src/main/rate-limits/codex-rate-limit-window-classification.ts
8a154388bfcf01b3517828cf29f77c73d3ed60f0cffd7119554433bb0f8576dc  src/main/codex-cli/codex-read-only-app-server-args.ts
```

## November 1 detection, address entry and CLI settings

Inspected/adapted revision: `00de405c5c0cffea06c2beb6eb0a0038b5d53fe6`.
Frondose reuses the filesystem-only install-directory/version-manager approach
and browser address-versus-search classification. The CLI settings page uses
Orca's catalog/default/command concepts with Frondose's own workspace storage,
revision validation and interface. It does not copy the full settings application,
privileged launch presets, remote worker authority or account login.
Known ChatGPT/Codex app-bundle fallback and the onboarding checklist are Frondose
extensions, not claimed upstream code. Native guest URL validation stays strict.

Original upstream SHA-256 values:

```text
d3da4bc4b0690b1dc9f8d49cf150bdac174c68443ce98115ddad6f5f92e6b1d9  src/shared/system-cli-install-dirs.ts
ffa2515ed310d8172f181b55f5be96b5e6666a221d3404c2fdf29ebbdeade92b  src/shared/node-cli-command-resolution.ts
876fa1b374ed647072d306be1b92b5ddab463c8dfc0d16bc1ed1c10cda6073cd  src/shared/fnm-default-alias-dirs.ts
14965da28a70299ee586181804c09e4a4b6d6ace56b825dfa7c2d98648d505a5  src/shared/browser-url.ts
daea88d8fbe887b04526e2e404b5886d7c0b5dedc73d3e43405f18be937a3beb  src/renderer/src/components/settings/AgentLaunchSettingsSection.tsx
fb5fd7b84267fec9fd1e43b2106bfbacc6007fe2f382fd49464530dfb5424b94  src/renderer/src/components/settings/AgentLaunchSettingsCatalog.tsx
```


## November 2 block-writing adaptation

Pinned revision: `00de405c5c0cffea06c2beb6eb0a0038b5d53fe6`. The MIT notice remains in LICENSE. `src/lib/rich-markdown.js` adapts the bounded case-insensitive slash-command filter below. `RichMarkdownEditor.jsx` follows Orca’s stable Tiptap extension/editor-instance pattern, with Frondose-specific block controls, explicit saves and unsupported-syntax Source fallback. This is not the complete Orca rich editor or a claim of lossless rich editing for every Markdown dialect.

- `src/renderer/src/components/editor/rich-markdown-slash-command-filter.ts` SHA-256 `d7b78ce500575eb26ae99cc1b033742185b893736e089cbda46b46c6ec6f0b23`
- `src/renderer/src/components/editor/useRichMarkdownEditorInstance.ts` SHA-256 `90322b05f4156d0ac3cb7fed896658acb3148d9d84ea9e8f11ca3e9e45f26a8e`

## November 7 editor and popup refinement

Pinned revision: `00de405c5c0cffea06c2beb6eb0a0038b5d53fe6`. The MIT license remains unchanged. The rich-editor refinement additionally follows the initialization/programmatic-write guards in `src/renderer/src/components/editor/rich-markdown-editor-config.ts`, guarded due-save concepts in `src/renderer/src/components/editor/editor-autosave.ts`, `editor-autosave-due-records.ts` and `editor-autosave-holds.ts`, and the neutral presentation of `src/renderer/src/components/ui/dialog.tsx` and `button.tsx`. Frondose supplies its own debounce, file/document concurrency checks, checklist storage, resource authority and context menus. This is selective adaptation, not the complete Orca editor or browser/terminal implementation.

## November 7 direct drops and Quick Commands

Pinned revision: `00de405c5c0cffea06c2beb6eb0a0038b5d53fe6`. `src/lib/quick-command-search.js` adapts the bounded stable label/body ranking and normalization from `src/renderer/src/lib/terminal-quick-command-search.ts`. `terminal-drop-input.js` follows the captured-destination and path-only principles in `src/renderer/src/components/terminal-pane/terminal-drop-handler.ts` and the multiline protections in `terminal-agent-paste-bracketing.ts`. The Quick Commands footer and command/prompt distinction were reviewed in `TerminalQuickCommandDialogFooter.tsx` and `src/shared/terminal-quick-command-types.ts`. Frondose retains its own workspace/project persistence, direct draft insertion, current-root authorization and explicit Run/Send gates; this is not a port of Orca remote-host or agent-launch authority. Original MIT license preserved.
## November 14 browser import and AI sessions

Reviewed revision `d7c6ab18526ba6173b5d701b936c3d3371fd8b12`. The bounded Safari
decoder in `desktop/browser-import.cjs` adapts the layout described in
`src/main/browser/cookies/sources/browser-cookie-safari-parser.ts` (MIT,
copyright 2026 Lovecast Inc.). Chromium source discovery, platform key access
and profile-isolated imports were reviewed. Frondose implements its own
preview, confirmations, IPC and destination validation. No upstream vault,
remote transfer, or account access code is included. AI session mode choices
were reviewed against the native Chat UI; the existing Frondose transports
and shared chat component remain in use.

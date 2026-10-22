# AI connections and computer runner verification

Checkpoint: October 22, 2026. This is an implementation/evidence record, not a
live-provider, every-OS, production-hosting or security certification.

## What is implemented

Frondose keeps three distinct routes: personal API credentials (16 providers),
provider-supported account authorization, and an explicitly authorized personal
computer. Public users bring their own supported account/allowance; they never
borrow the Frondose server operator's Codex or Claude login. Creating a profile,
saving settings, pairing a computer, discovering a command or opening Docs does
not send a model prompt.

The computer route now goes beyond the earlier discovery-only checkpoint:

1. Name a computer and create a short-lived, single-claim pairing code.
2. Run the developer helper on that computer and approve that exact claim in
   Frondose. Treat the code and helper credential as secrets.
3. Explicitly authorize runtime IDs and execution limits **locally**. Native
   tools, package execution and member sharing are separate opt-ins.
4. Bind a named profile to that computer/runtime, choose its audience and limits,
   then explicitly enable it. A saved disabled/unselected computer binding blocks
   live execution; it cannot silently fall back to an installation account.
5. Keep the helper running and the computer awake/online. Inspect exact context
   and explicitly send a request. All current permission layers still apply.

The helper requires Node 22.17+ or 24+. The Windows 22.16 file-identity problem
was not worked around by weakening private-file, link or exact inode checks.
There is no signed or packaged end-user installer in this checkpoint.

The developer commands are `node scripts/frondose-runner.mjs pair --server
<the configured Frondose origin>`, `authorize --providers <runtime IDs>`, `run`,
`status`, `disable` and `disconnect`. `authorize` asks for local confirmation;
review the complete command before running it. For project work, the owner maps
`--project project_id=/absolute/folder` on that computer. These are instructions
for the account owner's verification, not commands executed by this record.

## Authority and trust boundaries

| Layer | Required boundary |
| --- | --- |
| Computer | Owner-scoped pairing plus local runtime allowlist; separate tool/package/member consent and concurrency limit |
| Profile | Explicit binding/enabled state, private/selected-member/workspace audience, native-tool preference and per-profile limit |
| Workspace | Current authenticated membership and execution/use grants, not display names or a browser-supplied actor ID |
| Reviewed sources | Requester **and** computer owner must retain required current/historical source access; late revoked replies are discarded |
| Project | Stable project ID resolves through the owner's local physical-folder mapping, not browser commands, environment or cwd |
| Provider | The user's supported authentication, eligible model, account terms, quotas and billing remain provider-controlled |

Native runtimes execute as the computer's OS user. Frondose is not a tenant
sandbox, and denying client-mediated permission requests does not isolate a
runtime's internal file, shell, network, hook or extension tools. Native-capable
runtimes that cannot provide restricted General chat require an authorized,
reviewed Build/project request. Retries do not acquire fresh edit permission
implicitly. Separate named profiles preserve identity and Frondose conversation
grouping; they do not split a provider account's billing or transfer subscription
rights.

Disable, disconnect and re-pair do not transfer local consent. Disconnect removes
Frondose's connection, not provider-wide grants, installed software or files.
Stopping work does not undo edits or prove that a remote service reversed an
effect. Bounded process-family cleanup is awaited before a project lock is
released; an unconfirmed cleanup quarantines the working root. An uncertain
paid invocation is never automatically replayed.

Claude's existing direct restricted path now uses `--safe-mode` while preserving
its provider-supported sign-in. The optional **server-native Frondose MCP
bridge** is different: its stricter bare path requires an explicitly configured
operator API key and fails clearly when that authentication is unavailable. The
paired computer's restricted Claude route does not inherit that server bridge.

## Evidence and its limits

- All 47 pinned computer-catalog identities have native/ACP dispatch fixtures.
  Shared protocol support is not 47 authenticated accounts, 47 real model replies
  or proof that every vendor binary works on macOS, Windows and Linux.
- Isolated subprocess fixtures exercise the helper/runtime boundary, event
  handling, cancellation and process cleanup. A Node fixture process is not a
  real provider runtime, even when it emits realistic protocol frames.
- The independent security review identified two confirmed ACP issues: sanitize
  the complete accumulated reply, and await owned process cleanup. Both were
  corrected with regression coverage. This does not amount to a comprehensive
  production security certification.
- The authenticated shared-actor HTTP regression pass reported 30 passing cases,
  including independent profile/local-sharing gates, requester/owner grants,
  current/historical source revocation and suppressed late completion. These use
  temporary accounts/databases and fake runtimes, not shared real subscriptions.
- The final local changed-tree suite passed **1,607/1,607 tests**. Production
  build, Sites packaging checks and documentation/inventory checks also passed.
  The six OS/Node CI jobs are recorded separately after actual remote execution;
  local fixture results are not inferred OS/provider certification.

Relevant executable evidence lives in `tests/runner-runtime.test.mjs`,
`tests/runner-runtime-events.test.mjs`, `tests/runner-runtime-cleanup.test.mjs`,
`tests/runner-acp-runtime.test.mjs`, `tests/runner-execution-helper.test.mjs`,
`tests/runner-execution-api.test.mjs`,
`tests/runner-execution-sharing-api.test.mjs`, `tests/runner-jobs.test.mjs` and
`tests/computer-agent-controls.test.mjs`. API/OAuth evidence and public-mode
boundaries remain documented in [AI connections](ai-connections.md); adapter
provenance and licenses are in [Paseo reuse](paseo-reuse.md).

## User-facing documentation and visual evidence

The in-app catalog adds 69 guides: 47 computer runtime guides, 16 API credential
guides, three supported account-authorization guides and three computer
setup/permissions/history guides. They are searchable and linked from AI
connections and profile controls, with registry-bound identities, distinct
article icons, pinned launch/source references, billing and history limits.
`tests/docs-ai-connections.test.mjs` checks guide/catalog coverage, references,
search/export content and consent boundaries; this documentation pass reran it
successfully (3/3 tests). A documentation-coverage test does
not establish the current accuracy or acceptance of every external provider.

The finish pass retains the incumbent neutral layered surfaces, Inter hierarchy,
restrained indigo actions, real provider marks and shared controls from
`DESIGN.md` and `.impeccable/design.json`. No replacement visual world was
approved; neither normative artifact was regenerated. Computer/profile inline
links gained persistent underlines, and Docs declares the real dimensions of
the new computer screenshots.

Current desktop dark/light and mobile review captures are
`.impeccable/review/current-{computers,agent-settings,runtime-guide}-{dark,light,mobile}.png`.
They document rendered fixture states, not live account access. Field Defaults
was additionally captured in `/tmp/frondose-field-default-picker-desktop.png`,
`/tmp/frondose-field-default-picker-mobile.png` and
`/tmp/frondose-field-defaults-mobile-light.png`; temporary captures are local QA,
not durable release artifacts.

The four shipping raster files are
`public/docs/computer-{connections,agent-settings}-{dark,light}.png`. Each was
checked as **1440 × 980**, with embedded `impeccable:prompt` provenance describing
a real Playwright Chromium app capture on October 22 from isolated localhost
port 4175, a disposable example workspace and explicit transport fixtures. They
are not generated mockups, real customer data or paid-inference screenshots.

The surface brief's discovery-only `STORY` is stale relative to October 22
`AGENTS.md`; it is recorded as drift, not silently rewritten as a product
decision. Preexisting monospace/design-detector advisories are not approval to
replace existing typography. The independent finish reviewer scored both fixes
resolved and returned **ship for the reviewed UI scope** after the refreshed
captures. That verdict does not certify uncaptured states or real provider use.

## Field Defaults completion boundary

Safe fields support pointer/touch **Saved values**, Alt+Down picker opening,
numbered shortcuts, explicit Undo insertion and immediate keyboard undo.
Selecting a value replaces the complete field, not just its selection. Per-field
reset restores the shared fallback where applicable; configured-only filtering
and confirmed clear-all remain available. Cross-tab preference changes refresh
preferences without replacing an occupied draft. Primary values may fill empty
new drafts/searches, not empty existing records or auto-saving settings.

Account/connection selectors, provider permissions, payment/security/password
fields, credentials, temporary pairing/recovery codes and read-only controls are
excluded. Saved defaults do not send messages, change access or authorize work.
The isolated browser checks are implemented in
`scripts/test-field-defaults-ui.mjs`, with source/inventory coverage in
`tests/field-defaults.test.mjs` and `tests/field-inventory.test.mjs`.

## What a willing account owner must verify next

For a computer route, install the desired runtime on **your own computer** and
complete its official login. Pair and approve the helper, review local
`authorize` flags and any project mappings, enable the intended profile, and keep
the helper awake/online. Explicitly review and permit a small test request that
may consume paid allowance. Record the actual OS/runtime version, account route,
selected model, complete reply, cancellation and any observed effects. Do not
use the developer's account or treat discovery as a successful test.

For an API route, create the proper personal key in the provider console, enter
it only into the supported encrypted connection flow, select an entitled model
and explicitly approve the possibly billed test. A saved key/catalog is not
verification. For supported OAuth, the operator must first configure the
registered client and exact callback on the intended server whenever that route
requires it; each user then authorizes their own account. Operator client secrets
and encryption keys belong in server secret storage, **never in chat**, profile
instructions, browser variables or Git. Users do not each register Frondose's
shared OAuth application.

Native history import/resume/fork, native mid-turn steering, complete provider-UI
parity, a signed installer, and public hosting are not delivered by this
checkpoint. Provider approval, live account/OS testing, production operations and
any stronger tenant isolation remain separate engineering/release work. Owning a
domain or supplying keys does not finish those implementations. No account
login, paid provider request, external account mutation, public deployment or
live-database mutation was performed to write this record.

# Paseo reuse and runner provider catalog

This is implementation evidence, not a claim that every provider is released.

## Release checkpoint

| Part | Status |
| --- | --- |
| Existing personal API/OAuth connections | Preserved; not replaced by the computer helper |
| 47-entry provider catalog and license provenance | Implemented, pinned; individual adapters and OS combinations remain unverified |
| Pair → claim → browser approval → inventory → revoke | Implemented; scoped to a workspace and its computer owner |
| Named-agent computer, sharing and session preferences | Persisted as disabled preparation, private by default; saving blocks live use of that profile |
| Remove preparation | Explicit owner-confirmed operation returns to the previous connection; credentials and audit are retained |
| ACP v1 transport and canonical provider events | Internal, fixture-tested building blocks; not exposed as a remote execution endpoint |
| Multi-user job relay, concurrency enforcement, persistent sessions | Not implemented/released; stored limits are not runtime enforcement |
| History import/resume, native tool approvals, provider-specific controls | Not implemented for this new runner path |
| Windows/macOS/Linux CI | Matrix configured for Node 22.16 and 24; inspect the actual workflow result before claiming native-platform verification |
| Packaged helper installer, service/autostart, public hosting | Not provided by this checkpoint |

No new account, key or purchase is required to test pairing/discovery locally.
Later provider acceptance tests require the corresponding installed runtime and
the user's own supported login or API access. Secrets must stay in the provider
login or local/server secret storage, never in chats or committed files.

## Pinned source and permission

Frondose reuses catalog data from [Paseo](https://github.com/getpaseo/paseo) at
revision `c70a6cfb9ea29c87df52b6b6c574775b0d3b169c`. That revision's root license
is Apache 2.0, with Copyright (c) 2025-present Mohamed Boudra. The complete license,
attribution/modification record and an unmodified catalog snapshot are retained
under `third-party/paseo/`. No upstream root NOTICE was present.

`src/lib/runner-provider-catalog.js` adapts actual catalog data, not a manually
invented list. The pinned in-app source contains **39 ACP catalog entries**. The
protocol manifest contains six native identities (including disabled-by-default
OMP). Antigravity and Muse are bundled provider plugins; Hoplite is also bundled
but already occurs in the catalog. Their union is **47 distinct provider IDs**.
The older documentation list is not the canonical count.

Only this selected code/data is incorporated here. Other Paseo files, dependencies
and community plugins require their own license/security review before reuse.
Apache permission is not provider authentication, subscription-sharing permission,
trademark permission or proof of plugin compatibility.

## Discovery and cross-platform process foundation

`server/runner-process.mjs` resolves installed binaries using filesystem checks.
It does not execute version probes, installers, provider login or inference.
It ignores empty/relative PATH entries. Windows resolution recognizes approved
PATHEXT executable/batch extensions and case-insensitive environment variable keys.

The macOS, Linux and Windows process-preparation code keeps discrete argv and
`shell: false`. Windows `.cmd` and `.bat` shims use explicit `cmd.exe /d /s /v:off /c`
dispatch with a deliberately restricted argument alphabet. Values containing
expansion syntax, quotes or shell metacharacters are rejected. Arbitrary prompts
must be sent through protocol stdin, not a batch argument. Native executables
receive literal arguments without the cmd layer. This is a process-launch
foundation, not an operating-system sandbox or execution authorization system.

Some upstream templates use `npx -y` or `uvx`, which can fetch and execute packages.
Cataloguing them does not authorize that operation. Entries explicitly require a
separate installation approval. Discovering npx/uvx reports `launcher_only`, never
an installed provider or signed-in account. Discovery returns no account identity
or model entitlement.

## What is and is not proven

The catalog marks all individual macOS/Windows/Linux provider combinations
**unverified**. Node process support on those systems does not prove a particular
third-party CLI is available there. Other operating systems fail closed until a
dedicated implementation is provided. Mobile browsers are controllers; they do
not run these desktop/server CLIs.

Catalog presence does not enable a runtime adapter. Existing local Codex, Claude
and Copilot routes are identified separately; all additional adapters must pass
transport, permission, isolation and history tests before release. The Antigravity
catalog notice preserves the upstream full-access-only limitation rather than
silently enabling a bypass. User/workspace sharing requires separate grants and
provider-permitted use; it never exposes the host account credentials.

Fixture tests validate catalog coverage/provenance, no-execution discovery,
POSIX filesystem behavior, Windows path/shim preparation and real local Node
stdin/stdout. They do **not** constitute live provider testing or native Windows
acceptance testing on this Mac. No real AI accounts, sign-ins or paid calls are
used by those tests.

## Discovery-only helper

`scripts/frondose-runner.mjs` is a source-checkout helper for Node 22.16 or newer,
not a signed installer or released remote execution service. Run it explicitly:

```sh
node scripts/frondose-runner.mjs pair --server https://frondose.com
node scripts/frondose-runner.mjs status
node scripts/frondose-runner.mjs run --once
node scripts/frondose-runner.mjs run
node scripts/frondose-runner.mjs disconnect
```

Pairing reads the code through a hidden stdin prompt, never a command argument or
environment variable. It stores the returned helper credential, then stops; the
owner must approve the individual computer in Frondose and explicitly run the
helper. `run` sends provider IDs and filesystem discovery states only, not local
paths, provider credentials or account information. It never launches an AI
runtime, executes a plugin, installs packages, or authenticates to a provider.
The server response cannot enable execution in this helper version.

HTTPS is required except explicit loopback HTTP development origins. Redirects,
URL credentials, non-root paths, queries and fragments are rejected. Requests
have a 20-second timeout and a 1 MiB response limit. The helper supports graceful
cancellation, browser-approval waiting, bounded transient backoff, and stops on
authentication/revocation failures rather than retrying indefinitely.

Credentials are atomically published without overwriting an existing pairing.
The application directory is created with mode 0700 and its config with 0600;
symlink ancestors, symlink config files and hardlinks are refused. Defaults are
macOS Application Support, Windows LOCALAPPDATA, and Linux XDG_DATA_HOME (or
`~/.local/share`), with an absolute `FRONDOSE_RUNNER_HOME` override. Windows uses
the per-user application's inherited ACL: Node mode bits are not a Windows ACL
audit. Do not point the override at a shared, synchronized or public directory.

`disconnect` forgets this computer's local credential only. Revoke the computer
through Frondose's browser controls to invalidate its server registration. The
helper does not invent a credential-based remote revoke API.

## UI verification and design-system fit

The October 21, 2026 finish review returned **SHIP** for the scoped discovery
and disabled agent-preparation extension, with no blocking finding. This is not
approval to release remote execution or a claim of live compatibility across the
47 catalog entries.

`ComputerConnections` extends the existing AI Connections page;
`AgentRunnerSettings` extends the named-agent detail. Source and screenshot review
confirm the incumbent neutral surfaces, restrained indigo actions, typography,
semantic theme tokens, and shared buttons, fields, selects and dialogs remain in
use. Pairing, browser approval, discovery, authentication and execution are
explicitly distinguished. Desktop controls remain bounded; narrow layouts stack
controls and wrap helper commands rather than expanding the page.

The four retained dark-theme captures are
`.impeccable/review/runner-desktop.png`, `runner-mobile.png`,
`runner-agent-desktop.png` and `runner-agent-mobile.png` in that same directory.
The checkpoint reports 20 passing UI interaction checks, including a 320px narrow
layout, 1,416 passing automated tests, and a passing production build. One detector
pass found zero primary findings and four advisory findings for compact 13px copy,
consistent with the incumbent connection surface. These checks used no paid AI
accounts and do not establish native-OS execution or live-provider acceptance.
The below-fold footer and light theme were not independently visually verified;
screen-reader behavior was not independently tested by this finish review.

`DESIGN.md`, `.impeccable/design.json` and the surface brief are preserved. Existing
documentation drift remains reported, not repaired: `DESIGN.md` is newer than the
sidecar's generation timestamp, compact-copy guidance differs from the local
surface, and the sidecar has no tonal-ramp metadata required by the current
document playbook. This ordinary extension does not redefine the visual system.

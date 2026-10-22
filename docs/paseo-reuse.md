# Paseo reuse and computer AI connections

This is an implementation and operator guide, not a claim that every provider,
account, model, OS or external plugin has passed live acceptance testing.

## Source, license and coverage

Frondose adapts selected code/data from [Paseo](https://github.com/getpaseo/paseo)
revision `c70a6cfb9ea29c87df52b6b6c574775b0d3b169c`. Its root license is
Apache-2.0, Copyright (c) 2025-present Mohamed Boudra. The full license,
attribution/modification record and unmodified catalog snapshot are retained in
`third-party/paseo/`. No upstream root NOTICE was present.

The pinned catalog contains 39 ACP entries, six distinct native identities and
two distinct bundled provider plugins: **47 identities in total**. Hoplite is
already counted in the ACP list. OMP is not enabled by upstream by default.
`src/lib/runner-provider-catalog.js` retains the source revision, launch template,
protocol, pinned package version where available, installation reference and
individual security notices. Other community plugins and dependencies require
their own license/security review. Permission to reuse code is not permission
to redistribute a provider subscription, use a trademark as our own, or execute
untrusted plugins for workspace members.

## Three independent connection routes

| Route | Where credentials live | Execution host |
| --- | --- | --- |
| API key | Encrypted actor/workspace-scoped server storage | Frondose's allowlisted API adapter |
| Supported browser authorization | Encrypted actor/workspace-scoped server storage | Provider-specific supported API/SDK path |
| Paired computer | Provider-owned login/config on the computer; private helper credential locally | The owner's explicitly authorized Mac, Windows or Linux computer |

The computer route does not borrow the public server owner's CLI login. A
profile is a named identity, not another provider account. Several profiles may
use the same runtime/account and keep separate instructions and conversations.
They still share the underlying account's limits and provider terms.

## Install and pair the source helper

Use Node **22.17+ or 24+** and a Frondose source checkout on the execution
computer. The helper supports macOS, Windows and Linux; a provider CLI can have
narrower OS/architecture requirements. Mobile browsers control an available host
but do not execute desktop CLIs themselves.

In Frondose → AI connections → Connect a computer, create a name and pairing code.
Then run on that computer:

```sh
node scripts/frondose-runner.mjs pair --server https://frondose.com
node scripts/frondose-runner.mjs status
```

`https://frondose.com` is the intended origin, not a claim that hosting is already
deployed. For a local server use its exact loopback URL. Enter the code privately
at the helper prompt, not as a command-line argument, environment variable or
chat message. Return to the browser and approve the exact computer you claimed.
Pairing codes expire and are single-use; the browser cannot remotely turn on OS
execution. Pairing and local authorization are separate steps.

There is not yet a signed packaged installer or automatic background service.
The helper and server must remain running and the computer awake and online.

## Authorize execution locally

Install the intended provider runtimes and use their own supported sign-in. An
inventory entry means only that a command was found. It does not verify identity,
model entitlement, provider billing or tool safety.

For example, to allow installed Codex and Claude with two concurrent requests:

```sh
node scripts/frondose-runner.mjs authorize --providers codex,claude --max-concurrent 2
node scripts/frondose-runner.mjs run
```

The owner can additionally opt in to these permissions; none is implied merely
by pairing:

| Option | Meaning |
| --- | --- |
| `--allow-native-tools` | The selected runtimes may use their own tools, subject to profile/request/project checks |
| `--allow-shared` | Explicitly permitted workspace members may request work; current grants and profile audience still apply |
| `--allow-package-downloads` | Permit catalogued package-launcher execution that can download third-party code |
| `--project project_id=/absolute/folder` | Map an allowed Frondose project to its actual absolute folder on this computer |
| `--max-concurrent 1` through `8` | Local ceiling; server and per-agent ceilings still apply |

Use the folder syntax appropriate to the execution OS. For Windows, quote the
whole project mapping when its absolute drive path contains spaces. Do not point
a project at the home directory, the helper credential directory or unrelated
private data. A project record's folder on a different server is not automatically
the folder on this computer.

`npx -y` and `uvx` templates can fetch and execute packages. Merely finding their
launcher reports `launcher_only`, not an installed authenticated provider.
Discovery never installs software, signs in or sends a model request. Prefer
reviewed manual installation; inspect package provenance before approving
downloads. A pinned top-level version is not a complete dependency trust audit.

To disable execution or forget local pairing:

```sh
node scripts/frondose-runner.mjs disable
node scripts/frondose-runner.mjs disconnect
```

`disable` removes local execution consent. `disconnect` forgets local helper
credentials; use the browser's Disconnect computer action to revoke its server
registration too. Neither command uninstalls providers, globally signs them out
or rolls back completed work.

## Bind the profile and choose its audience

In Your Agents, create a profile with the desired runtime/provider. Open its
Computer connection section, select the confirmed computer and matching runtime,
choose private/selected-member/workspace access, select a concurrency limit and
explicitly enable the binding. Native tools have a separate profile opt-in. The
computer's local policy must allow the selected runtime, members, packages and
tools before the binding can execute.

Frondose's personal agent has the same explicit path in its own Setup tab:
choose a computer runtime, prepare its canonical profile, bind/enable the computer
and then save the AI selection. Creating or saving a profile never sends a prompt.
The personal agent does not borrow another named profile's credentials.

Every dispatch requires active membership, current agent/run/connection grants,
an allowed audience, an active connection owner and the computer's local policy.
A profile's provider and bound runtime must agree. Concurrency is the bounded
intersection of server, computer and agent limits, not a billing/spend guarantee.
An explicitly disabled, disconnected or denied computer binding never silently
falls back to another account. Removing the binding is a separate owner-confirmed
operation that can restore a prior explicitly configured account path.

## Execution, tools and history boundaries

The helper relays jobs over its authenticated server connection and starts the
selected catalogued protocol adapter. Public progress, response text, tools,
permissions and terminal status enter Frondose's canonical run/event records.
Unknown events remain bounded evidence. Private model reasoning is not invented
or displayed as a transcript.

**Native execution uses the OS user's privileges, not an OS/tenant sandbox.**
Denying client-mediated filesystem/terminal requests does not constrain tools a
provider runtime executes internally. Review local extensions, hooks, MCP servers
and credentials. Generic native-tool runtimes require explicit authorized project
access; Codex/Claude can use their restricted General chat paths. Antigravity's
upstream full-access-only behavior must never be presented as read-only. Do not
use a shared privileged OS account for untrusted workspace members; isolate the
host/account when stronger separation is needed.

Conversation grouping retains Frondose identity/provenance. Reviewed turns use
freshly compiled exact context rather than silently resuming opaque provider
history. CLI history import/resume/fork and universal two-way synchronization are
not released by this work. Claude Code does not import Claude.ai chats; Codex does
not import ordinary ChatGPT conversations. The same distinction applies to other
providers' desktop/web histories. Provider-native UI feature parity cannot be
inferred from a functioning wire protocol.

Stop, cancellation, disconnect and membership changes are rechecked at dispatch
and result handling. An interrupted/uncertain effect is not automatically replayed.
Stopping cannot undo files, external calls or provider-side jobs already accepted.

## Credential/process handling

HTTPS is required except explicit loopback HTTP development origins. Redirects,
URL credentials, non-root paths, queries and fragments are rejected. Requests
have bounded time/output, cancellation and transient retry backoff. Revoked or
invalid credentials stop rather than falling back to anonymous owner identity.

Helper files are stored atomically in a private application directory; symlink
ancestors, symlink credential files and hardlinks are refused. macOS uses
Application Support, Windows LOCALAPPDATA and Linux XDG_DATA_HOME (otherwise
`~/.local/share`), with an absolute `FRONDOSE_RUNNER_HOME` override. Windows inherits
the user's ACL; POSIX mode bits are not a Windows ACL audit. Never use a shared or
public directory. Exact BigInt file identity checks require Node 22.17+: real
Windows tests exposed a Node 22.16/libuv metadata bug, and Frondose did not weaken
the check to work around it.

Executable resolution ignores empty/relative PATH entries. POSIX/native launches
use discrete arguments with `shell:false`. Windows command shims use a restricted
argument alphabet under explicit `cmd.exe`; arbitrary prompt text travels through
protocol input, not shell interpolation. These are launch safeguards, not process
isolation.

## Documentation and evidence

The in-app handbook includes one provider-specific guide for each of the 47
runtime IDs, one for each of the 16 API providers, supported account-authorization
guides and computer setup/permissions/history guides. Each uses the shared registry
for commands and provenance, provider links, distinct searchable article icons
and contextual links from settings. Unknown provider marks use honest text
monograms rather than fabricated company logos. The real app screenshots are
examples, not claims of a logged-in provider account.

Automated transport, policy, lifecycle, race and platform tests use temporary
databases and injected provider processes. The Windows/macOS/Linux Node matrix
checks Frondose's implementation. It does not verify every vendor binary/account
on those systems. No paid inference or real account is used by automated tests.
Before claiming a provider is live-verified, a willing account owner must install,
authenticate and explicitly send a reviewed request for the exact model/OS/tool
mode. Keep those acceptance results distinct from fixture and CI evidence.

Signed installers/autostart, unrestricted public signup/hosting, universal native
history import and arbitrary community-plugin execution remain separate release
work. See [AI connections](ai-connections.md) for server/OAuth setup and current
hosted-route limitations.

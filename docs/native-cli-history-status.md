# Native CLI history: current scope and historical research

The later October 26 request supersedes the October 24 no-history direction:
Frondose now has an opt-in local Codex/Claude session-history search slice and
exact provider-native resume with opaque server-validated results. See
[Local native CLI session history search](local-session-history-search.md) for
supported formats, consent, bounds and fixture/native verification limits.
Website-chat import, universal two-way sync, cross-provider conversion and the
retired Session views remain out of scope. The older statements below describe
the former connection-library checkpoint, not the current CLI-first UI.

October 28 native-terminal correction: the ordinary Codex picker now launches
`codex resume --all`, rather than hiding sessions from other working
directories. Exact result IDs still use the validated provider-native session
ID. Claude retains its native `--resume` picker. Frondose preserves the owner's
HOME and supported provider configuration variables; it does not manufacture a
new provider account or copy credentials. Picker support depends on the
installed CLI version. This source change needs a safe backend restart on an
already-running host; it does not modify the user's running process. No actual
owner transcript content was read to test it.

## Historical October 24 checkpoint

As of the October 24, 2026 user decision, native CLI chat-history listing,
import, continuation and synchronization are **out of scope**. Do not build or
advertise them as part of the connection library or promise them for a later
release. Frondose-owned conversations and existing data remain intact. The
research below is retained as historical audit provenance, not a delivery plan.

Frondose separates personalized agents (`identity_kind=agent`) from direct provider identities (`identity_kind=provider`). Creation is explicit, does not authorize an account or start a session, and does not read native history. The type is immutable after saving. Legacy profiles remain personalized agents. Both kinds currently use Frondose-owned conversations.

## Historical research: what Paseo does

Audited Apache-2.0 Paseo revision `c70a6cfb9ea29c87df52b6b6c574775b0d3b169c` against upstream `12e7a448f0f1a40cb78857cf1e29b385f71670ba` on October 22, 2026.

| Provider | Native import / continuation |
| --- | --- |
| Claude Code | Lists project JSONL sessions and resumes a native session ID. |
| Codex | Lists/reads native threads and uses `thread/resume`. |
| OpenCode | Delegates to its legacy or v2 runtime. |
| Pi and OMP | Lists session files and continues their native handles. |
| Other ACP agents | Conditional on advertised list/load/resume capabilities. Not guaranteed for the catalog. |
| Antigravity | No history replay after daemon restart in its documented adapter. |

Source: [shared import implementation](https://github.com/getpaseo/paseo/blob/c70a6cfb9ea29c87df52b6b6c574775b0d3b169c/packages/server/src/server/agent/provider-session-import.ts), [Claude adapter](https://github.com/getpaseo/paseo/blob/c70a6cfb9ea29c87df52b6b6c574775b0d3b169c/packages/server/src/server/agent/providers/claude/agent.ts), [Codex adapter](https://github.com/getpaseo/paseo/blob/c70a6cfb9ea29c87df52b6b6c574775b0d3b169c/packages/server/src/server/agent/providers/codex-app-server-agent.ts), [ACP capability gates](https://github.com/getpaseo/paseo/blob/c70a6cfb9ea29c87df52b6b6c574775b0d3b169c/packages/server/src/server/agent/providers/acp-agent.ts).

Continuing the same native session is not transcript export or universal live two-way synchronization. Independent concurrent CLI writers are not generally reconciled. This does not import ChatGPT/Claude website histories.

## Frondose boundary

Native history listing, import, ID continuation and external-history refresh remain unavailable. Runtime capabilities continue to report `resume:false` and `historyImport:false`; adding a provider identity does not change those flags. No sync button or completed-sync claim is presented.

The October 22 audit identified prerequisites that would matter only if a future,
separately authorized change of scope were requested: computer-owner history
consent, bounded provider/account/project descriptors, explicit transcript
selection and sharing review, opaque actor/workspace/computer/provider/native-session
bindings, persistent session IDs, exclusive native-session execution, and tests
for stale external history and revoked access. These are historical risk notes,
not remaining release tasks. Reading private local transcripts must not silently
publish them to a shared workspace. Native model context would also need to be
accounted for in context review.

The audited upstream Claude revision excludes non-user/non-assistant records because `api-request-blob` entries can contain system context. Its historical [parser safeguard](https://github.com/getpaseo/paseo/blob/12e7a448f0f1a40cb78857cf1e29b385f71670ba/packages/server/src/server/agent/providers/claude/agent.ts#L6401) remains relevant evidence if import is ever separately reconsidered; it is not a claim about current upstream behavior.

Personalized agents do not receive native import/resume bindings. However, strict absence from a CLI's native storage is not guaranteed for every ACP implementation: `session/new` may persist even without an import UI. Provider-tested ephemeral support or isolated storage is required before promising complete native-history isolation. Do not confuse Frondose's no-import/no-resume policy with universal native storage suppression.

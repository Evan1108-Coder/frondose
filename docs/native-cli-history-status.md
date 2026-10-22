# Native CLI history: current boundary

Frondose separates personalized agents (`identity_kind=agent`) from direct provider identities (`identity_kind=provider`). Creation is explicit, does not authorize an account or start a session, and does not read native history. The type is immutable after saving. Legacy profiles remain personalized agents. Both kinds currently use Frondose-owned conversations.

## What Paseo actually does

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

## Not implemented in Frondose

Native history listing, import, ID continuation and external-history refresh remain unavailable. Runtime capabilities continue to report `resume:false` and `historyImport:false`; adding a provider identity does not change those flags. No sync button or completed-sync claim is presented.

Before release, this needs separately authorized computer-owner history requests, bounded provider/account/project descriptors, explicit transcript selection and sharing review, opaque actor/workspace/computer/provider/native-session bindings, persistent session IDs, exclusive native-session execution, and tests for stale external history and revoked access. Reading private local transcripts must not silently publish them to a shared workspace. Native model context must be accounted for in context review.

Current upstream Claude excludes non-user/non-assistant records because `api-request-blob` entries can contain system context. Any importer must retain this [parser safeguard](https://github.com/getpaseo/paseo/blob/12e7a448f0f1a40cb78857cf1e29b385f71670ba/packages/server/src/server/agent/providers/claude/agent.ts#L6401).

Personalized agents do not receive native import/resume bindings. However, strict absence from a CLI's native storage is not guaranteed for every ACP implementation: `session/new` may persist even without an import UI. Provider-tested ephemeral support or isolated storage is required before promising complete native-history isolation. Do not confuse Frondose's no-import/no-resume policy with universal native storage suppression.

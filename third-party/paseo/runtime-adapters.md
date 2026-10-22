# Personal-runner protocol references

Frondose's bounded JavaScript runtime drivers were written with reference to Paseo,
Copyright (c) 2025-present Mohamed Boudra, Apache-2.0, pinned revision
`c70a6cfb9ea29c87df52b6b6c574775b0d3b169c`.
The upstream license is retained in this directory. All named plugin files below
are part of that repository's Apache-2.0 scope; no separate license file or
package dependency is copied from those directories.

Reviewed sources:

- `packages/server/src/server/agent/providers/pi/cli-runtime.ts`, `runtime.ts`,
  `rpc-types.ts`: Pi JSONL command/response and event contracts.
- `packages/server/src/server/agent/providers/omp/cli-runtime.ts`, `runtime.ts`,
  `protocol-session.ts`: OMP JSONL v1 protocol and ready handshake.
- `plugins/antigravity-provider/server/internal/process.ts`, `wire.ts`:
  Antigravity init, prompt, result and step-update shapes. Frondose does not copy
  upstream's dangerous permission-bypass flag. Interactive permissions remain
  unavailable and tool-dependent requests may fail or hit their deadline.
- `plugins/muse-provider/server/connection.ts`, `session.ts`, `wire.ts`:
  MSP initialization, session/start, turn/start, item and completion contracts.

Modifications: fresh reviewed turns only; local owner/runtime/native-tool consent;
catalog-only executable selection; bounded output, time, queue and text; no
automatic inference retry; no native history import, extension bridge or host MCP
configuration; denied client capability requests; redacted observed activity;
no attribution of raw model reasoning as private thoughts or permissions.

Codex implementation additionally follows official app-server documentation:
https://developers.openai.com/codex/app-server . OpenCode uses its documented ACP
subprocess instead of exposing the upstream HTTP server:
https://docs.opencode.ai/docs/acp/ . Installed vendor binaries remain separately
licensed and subject to their own supported OS, accounts and usage terms.

Claude Code follows https://code.claude.com/docs/en/cli-reference and intentionally
uses `--safe-mode` rather than `--bare`: bare mode ignores OAuth/keychain login.
Safe/restricted modes still obey managed policy, including policy hooks; they are
not an OS sandbox. Unsupported flags on older CLIs fail without a permissive retry.

Frondose does not redistribute the vendor binaries or claim live-account
verification. Explicit native-tool consent gives an agent OS-user capabilities,
not a tenant sandbox. Windows/Linux CI transport tests are not vendor certification.

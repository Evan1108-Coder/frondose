# Native CLI sessions and Quick Commands

Frondose opens the installed provider CLI as an ordinary interactive terminal in
the linked workspace folder, or the server's OS home if no folder is linked.
The CLI owns its login, session picker,
chat history, model availability, tool permissions and billing. Frondose does not
translate that history into its own chat database or import chats from provider
websites.

## Open and resume

- Choose Terminal or an installed CLI from New tab → AI CLI. That explicit click
  launches directly, without a second runtime form or execution-confirmation
  popup. Opening the chooser, hovering, restoring tabs and discovery never launch
  a process. The process runs as the OS user and can edit files/use the network;
  the working folder is not a sandbox. Legacy reviewed personalized first tasks
  retain their separate prompt/paid-use review and never acquire a home fallback.
- Codex and Claude Code expose **Resume existing chat**. This launches the
  provider's native picker with `codex resume` or `claude --resume`; no prompt is
  supplied. Other CLIs keep their native history/resume commands inside the CLI.
- Standard owner `HOME`/`USERPROFILE` and explicit absolute `CODEX_HOME`,
  `CLAUDE_CONFIG_DIR` and XDG config/data/state paths are preserved. Frondose API
  secrets and operator API keys are not inherited by the process.
- Reattaching, refreshing, moving or restoring an already saved terminal view
  never starts or restarts a process or replays a prompt. Only a fresh explicit
  New tab/Open/Resume action can launch one.
  Closing a view and stopping the process remain different actions.
- Existing saved sessions are available only where the installed CLI itself can
  discover and resume them. This is not a promise of every provider's historical
  format or cross-provider conversion.

References: [Claude CLI reference](https://code.claude.com/docs/en/cli-reference),
[Codex CLI reference](https://developers.openai.com/codex/cli/reference).

## Folderless workspace terminals

With no linked directory, a separate installation-local workspace terminal host
uses the process owner's canonical OS home. Frondose does not create a fake
project, change any project's folder, or create a file-explorer/Git binding to
home. Home selection comes from the server, never from a browser-supplied cwd,
environment, executable or arguments. A missing, replaced, or filesystem-root
home is rejected; a stale linked folder is not silently replaced with home.

Workspace-host APIs allow terminal transport, owned stop/status, display settings
and Quick Commands only. They do not permit file/Git/worktree/checkpoint actions
or personalized-agent launches. The records are local to that workspace and are
not portable folder authority. Existing project terminal rows remain separate.

If a folder is linked later, existing home terminals keep running in their
original directory. A new explicit pane in that workspace host starts in the
currently validated linked folder. Pending/running workspace-host terminals join
the same branch-switch, directory-rebind and app-close guards as project ones.

This mirrors the separation in Orca's reviewed
[PTY default-cwd selection](https://github.com/stablyai/orca/blob/51dcef8258230ffea85a907130450b0ad676e22b/src/main/providers/pty-default-cwd.ts)
and [direct floating-terminal creation](https://github.com/stablyai/orca/blob/51dcef8258230ffea85a907130450b0ad676e22b/src/renderer/src/lib/floating-workspace-tab-creation.ts).

## Terminal responsiveness

Keyboard input is sent in ordered 4ms batches without resetting a typing-burst
timer. Input is bounded and large text is split without breaking Unicode pairs;
an uncertain failed write is not replayed. Output is available immediately from
a bounded 250,000-character live buffer. Database persistence is coalesced in
40ms batches and flushed on process exit and orderly server close. An abrupt
machine/server crash may lose the final unflushed display-output batch; the
provider's own conversation persistence is independent.

Active output reads wake on data, with a 40ms short wait rather than the previous
fixed 300ms poll. The short ceiling avoids monopolizing the HTTP connection pool
when several panes are visible. Actual latency still depends on the computer,
CLI and network. No paid/provider inference was used for fixture tests.

The terminal retains 10,000 rendered scrollback lines and a **Scroll to latest**
control while reading earlier output. Full-screen CLI applications may manage
their own alternate-screen scrolling, according to the provider's interface.

Automated local PTY/transport fixtures cover ordering, wake reads, raw `/resume`
input and bounded buffers. They do not establish a universal latency bound or
certify every provider/OS. Provider login and history must already exist for the
current OS user; Windows/Linux native-machine acceptance remains separate from
cross-platform source and fixture tests.

Terminal completion notifications require saved opt-in and OS/browser permission.
They only follow an observed live running-to-ended/error transition, never
restored history, and do not assert that the provider completed its task.

## Quick Commands

Quick Commands are saved per project, or per workspace for its folderless host,
searchable, editable, and explicitly
deleted. **Insert** places a single-line command without pressing Enter; **Run**
executes it in the selected shell. In an AI CLI, **Send** submits the displayed
text to that CLI and can consume provider usage. Multiline insertion is disabled
because line breaks can execute a shell command; multiline Run/Send remains an
explicit reviewed action. Saving/searching a command never executes it.

The interaction is inspired by [Orca's Quick Command
types](https://github.com/stablyai/orca/blob/51dcef8258230ffea85a907130450b0ad676e22b/src/shared/terminal-quick-command-types.ts).
This implementation uses Frondose's local scoped command stores rather than
copying Orca's full global/repository prompt-host system.

## How Paseo differs

Paseo retains provider-native session identities with its agent records. Its
history hydration can use a temporary Codex app-server to read stored threads,
or ACP `session/load` replay, then release the temporary process. Interactive
resume is a separate lifecycle operation. Frondose's direct PTY design delegates
resume to the CLI instead of building a second structured-chat interface.

Sources: [Paseo agent lifecycle](https://github.com/getpaseo/paseo/blob/main/docs/agent-lifecycle.md),
[provider session files](https://github.com/getpaseo/paseo/blob/main/docs/development.md).

## Orca CLI catalog reviewed on October 26, 2026

The reviewed Orca source has 45 launch presets, including modes and regional
variants, not 45 independent AI providers:

- Claude, Claude Agent Teams, OpenClaude, Codex, Grok, GitHub Copilot, OpenCode 2,
  OpenCode, MiMo Code, Ante, Trae, Muse, DeepSeek Harness, Qoder CLI, Qoder CLI
  China, ZCode, Pi, OMP, Prime Agent, Gemini, Antigravity, Aider, Goose, Amp,
  Kilocode, Kiro, Charm (crush), Auggie, Autohand Code, Cline, Codebuff, Freebuff,
  Command Code, Continue, Cursor, Droid, Kimi, Mistral Vibe, Qwen Code, Rovo Dev,
  Hermes, Devin, OpenClaw, CodeBuddy and Jcode.

Source: Orca's [primary catalog](https://github.com/stablyai/orca/blob/51dcef8258230ffea85a907130450b0ad676e22b/src/renderer/src/lib/agent-catalog-entries-primary.ts)
and [secondary catalog](https://github.com/stablyai/orca/blob/51dcef8258230ffea85a907130450b0ad676e22b/src/renderer/src/lib/agent-catalog-entries-secondary.ts).
A generic terminal can also run other installed CLIs. A preset is not a login,
subscription entitlement, history importer, or assurance that the provider's
latest version works on every operating system.

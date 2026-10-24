# Agent connections library

Your Agents opens a searchable library: real connected identities first, three
featured providers (Codex, Claude Code and OpenRouter), then grouped Coding
agents and Models & API providers. Featured choices are editorial, not usage or
popularity rankings. Manage agents retains the roster; existing agent links and
histories remain available. Product previews are illustrative, not live sessions.

## Catalog and readiness

The library derives from `EXECUTION_PROVIDERS`: 62 unique execution IDs from
47 computer-runtime entries and 16 API providers, with one overlapping Gemini
ID. Codex, Claude Code and GitHub Copilot are included in the runtime entries.
These counts describe registry coverage, not verified accounts.
Existing provider-specific Docs guides remain the setup reference; this library
does not duplicate them.

Connection choices come from `agentConnectionMethods`: API key only for an API
registry entry; browser authorization only for a provider flagged for it, or
GitHub authorization for Copilot; Computer (CLI) only for a registered runtime.
Catalog presence and method availability never imply installed software,
authorization, model entitlement or live verification. Connected tiles use saved,
permission-filtered readiness, not a background provider probe. A connected
account without an explicitly created identity is not a connected identity tile.

Browser authorization still needs its real operator setup where applicable:
Hugging Face and GitHub Copilot require configured app registrations; OpenRouter
uses its implemented PKCE route without an operator OAuth client. All require
the user’s own access and allowance. See [AI connection launch checklist](ai-connection-launch-checklist.md)
for deployment and live-account acceptance gates; this UI does not complete them.

## Explicit identity creation

On a provider detail, Connect provider creates a direct provider identity;
Create Agent Connection creates a personalized identity with a name and
Personalization. Both first open the reviewed AgentEditor with the selected
provider, identity kind and supported method. Neither account connection nor
reading a detail silently creates a profile or starts AI. Identity kind remains
immutable after saving; separate identities do not merge conversation histories.

Saving Computer (CLI) without an account binding opens the saved identity’s
Computer connection section. Pairing, installed/authenticated runtime, current
profile access, local owner authorization and any project/native-tool consent
remain separate requirements. Browser controls do not grant local consent,
install runtimes or bypass server/helper guards. No CLI history is imported,
resumed or synchronized; that work is out of scope by the October 24 decision.

## Composer @ behavior

An actively typed @ token at a word boundary opens choices for ready, unarchived
direct provider profiles in the current workspace, not every catalog provider or
personalized agent. Selecting in an unbound conversation prepares that draft’s
recipient and removes the typed token; selecting its already bound provider does
the same without changing the responder. Access resets to conversation-only,
native tools turn off, and model/reasoning choices clear for review. The user
must still inspect and send explicitly.

If the conversation already has a different responder, selection offers a
confirmation to open the chosen provider’s own conversation. The original draft,
files, selected context and reply remain in place; the target’s existing draft
is not overwritten. Confirmation rechecks readiness and opens the latest
nonarchived, non-project/non-Route conversation for that identity, or explicitly
creates one if absent. Nothing is copied or sent automatically. Unconfirmed
delivery blocks selection; failed draft persistence blocks leaving the original;
uncertain creation is not blindly retried. One immutable bound responder and the
existing server permission/context guards remain in force.

## Evidence boundaries

Registry and selection contracts are covered by
`tests/agent-connections-library.test.mjs` and `tests/provider-mentions.test.mjs`.
Sizing/motion and release receipts have separate focused suites. Isolated tests
and saved UI captures establish implementation evidence, not provider-account,
operating-system or temporal-animation certification. The historical native
history audit is retained in [Native CLI history](native-cli-history-status.md).

# Active work, steering and agent handoffs

Conversations remain the place to talk. **Active work** (the existing Runs
destination) shows canonical run status, public progress messages, observed
commands/output, file activity, native-tool records and review requests.
Tool activity appears only when the connected runtime actually reports it.
Talvori does not invent a transcript for providers that return only a final
answer, and it does not expose private model reasoning as a “thinking” log.

## Steering without blocking a conversation

While a run is busy, a steering message can be recorded for its agent. It is
stored in the durable coordination ledger, not sent invisibly to the current
provider turn. Open **Review next-turn draft**, review the attached message
and currently selected access in Conversations, then send the next turn when
ready. Recording or preparing a message does not call an AI provider.

The current Codex app-server adapter uses a fresh ephemeral thread for every
reviewed turn. It supports Stop but does not expose live mid-turn steering.
The CLI, API and Copilot paths likewise do not expose a reviewed steering
capability in Talvori. The interface therefore says **queued next turn**, not
“steering delivered” or “agent is following the new instruction.” Stopping
and sending a new turn are distinct actions; Stop does not undo prior effects.

## Cross-conversation communication

A handoff chooses both an accessible conversation and a named agent. The
same agent ID represents the same profile across conversations, but identity
alone never grants access to another chat or its sources.

An agent can propose this typed final-reply action:

Automatic application of the handoff draft requires the explicit capability-2
low-risk policy. Existing Route/self-link opt-ins and older captured reviews
remain capability 1; they cannot silently gain this cross-conversation authority.
Settings → Agent awareness offers the explicit upgrade. Neither version grants
paid dispatch, live mid-turn injection, or external sending.

```json
{
  "type": "coordination.handoff",
  "target_chat_id": "exact-accessible-conversation-id",
  "target_agent_id": "exact-agent-id",
  "content": "A bounded task or result for the recipient."
}
```

This action records an attributed canonical handoff, **not a paid child run**.
It is eligible for the existing per-account, per-workspace low-risk policy
only when that policy was explicitly enabled and pinned to the source turn.
Otherwise the ordinary action-review flow applies. Even an automatically
recorded handoff needs a fresh reviewed next turn before provider dispatch.
It cannot create a delegation loop, silently resume a native history, change
tools or bypass destructive/external/paid-work approval.

Personal Talvori conversations retain their bound participant identity.
Ordinary multi-agent conversations require an explicit recipient; there is
no assumption that the first agent in a list is the intended one.

## Privacy and delivery guarantees

- Each record preserves the union of the source run’s captured/current
  access and the destination conversation/agent’s captured/current access.
  Moving a document or chat does not erase its historical boundary.
- Only the authenticated record sponsor can prepare its next-turn draft.
  Other readers need access to every source and destination to see it.
- The immutable draft is a server-owned context snapshot. Browser recovery
  retains its IDs, not copied protected text. The source run’s raw prompt,
  private runtime protocol, authorization nonce and native tools are not copied.
- A stable request ID records one exact message. Reusing it with different
  text or recipients fails. Uncertain delivery is not blindly retried.
- Records are limited to 50 per source run. Each message is at most 10,000
  characters and 12 KB. This is a coordination ledger, not unlimited dispatch.
- Broad run events contain only the coordination receipt ID and kind, not
  protected message text or destination identity.
- Preparing a draft means **prepared, not sent**. No automatic consumption,
  provider continuation or successful recipient response is implied.
- Coordination records are not portable execution authority and are excluded
  from workspace JSON export/import. They survive normal server restarts in
  the installation database; they are not an off-app notification service.

## API

| Endpoint | Effect |
| --- | --- |
| `GET /api/runs/:runId/coordination` | Authorized items and explicit capability flags |
| `POST /api/runs/:runId/coordination` | Record `{request_id,kind,content,target_chat_id?,target_agent_id?}` |
| `POST /api/runs/:runId/coordination/:itemId/prepare` | Prepare an ID-addressed protected draft; accepts `{}` only |

`kind` is `steer` or `handoff`. Steering keeps the source conversation and
agent. Handoffs require both target IDs. Returned capability flags explicitly
state `native_steer: false` and `auto_dispatch: false`.

## Remaining engineering

True in-flight steering needs adapter-specific turn mutation with immutable
context amendment receipts, current source revocation, interruption races and
uncertain-delivery reconciliation. Autonomous paid delegation additionally
needs an explicit task-scoped budget/dispatch limit, sponsor authority,
read-only child context, loop/cancellation propagation and durable receipts.
Those are not enabled by this release. No account registration from the user
can replace those implementation requirements.

## Verification

Temporary SQLite and HTTP fixtures cover immutable/idempotent receipts,
protected snapshot preparation and a fresh Context Inspector round-trip,
source and destination revocation/moves, personal identity binding,
attribution, malicious fields, old unverifiable runs and no duplicate/paid
dispatch. Provider calls are forbidden in these tests. Browser fixtures mock
all APIs; they do not create runs or coordination records in the real workspace.

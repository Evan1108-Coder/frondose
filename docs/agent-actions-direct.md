# Bounded direct workspace actions

Talvori supports an explicit, actor/workspace-specific low-risk action policy.
This is not provider tool access, a general auto-approval switch, or permission
to spend money. Existing historical runs default to review-only.

## Policy API

`GET /api/agent-awareness?workspace_id=...` includes `low_risk_actions` with
`enabled`, `version`, `actor_id`, and `workspace_id`.

`POST /api/agent-awareness` accepts exactly
`{workspace_id, low_risk_actions: boolean}` for this policy operation. It uses
the authenticated current actor, requires current `agents.write` access, and
never accepts another actor ID. Each policy update increments its version;
revoking and re-enabling cannot revive authority captured in an older turn.
The existing `{workspace_id, enabled}` awareness switch remains separate.

## Direct allowlist and receipts

- `record.create` for `tasks`, with absent, `backlog`, or `ready` status.
- `agent.self_link` with `resource: teams|projects|tasks` and an exact target ID.
  The immutable canonical completed run supplies the agent ID. Agent IDs in the
  action input are rejected.

All other actions remain pending for human review, including record edits,
archive, settings, memory, notes and external connection actions. Unsupported
actions (including immediate paid launches) are rejected. `schedule.create` and
`schedule.update` are pending intents only, never direct scheduling authority.

The exact inspected prompt describes the opt-in policy. Its version, actor and
workspace are pinned in `manifest.direct_action_policy`. Completion rechecks
the captured nonce, current awareness switch, exact current policy version,
authenticated run sponsor, current captured-source access, current target and
parent access, canonical run and active agent, and stale target snapshots.
Workspace text, model output and documents never supply authority.

Requests and successful direct local writes share one database transaction.
Only successful writes become `applied`, with durable result metadata
`authorization: actor_low_risk_policy`. Duplicate final-reply capture does not
execute actions twice. A failed batch rolls back its local writes and receipts;
it never reports partially applied actions. The model's prose is not evidence
that a mutation succeeded; receipts are the authoritative result.

## Agent links

`GET /api/agent-links?workspace_id=...` returns
`{links: [{workspace_id, agent_id, target_type, target_id}]}`.

`POST /api/agent-links` accepts exactly
`{workspace_id, agent_id, target_type: area|project|route, target_id}` and returns
`{result: {workspace_id, agent_id, target_type, target_id}}`.

This explicit human operation and agent self-link use the same validator,
permission requirements and atomic append-only implementation. Both agent and
target must be active in the same workspace. Current target read/write,
agent read/write and parent read access are required. Listing requires current
read access to the workspace, agent, target and parents. Archived, stale or
inaccessible links are omitted. Repeated linking is idempotent. No unlink,
removal, permission change, provider launch or overwrite endpoint is added.

Areas preserve `area_settings.default_agent_ids_json`; Routes preserve
`tasks.assignee_agent_ids_json`. Projects use the many-to-many
`agent_project_links` table. Membership does not change an agent's default
project, context defaults, version, instructions, provider account or grants.
Links are selections/associations only; they never grant execution access.
Shared profiles (`workspace_id IS NULL`) cannot be assigned through this API.
They return `409 workspace_profile_required` with guidance to create a workspace
profile in Agent Studio. No profile is silently copied, re-scoped or promoted.
This keeps ordinary Area settings GET/PATCH and content-only restore valid.

`GET /api/agent-awareness` includes current permission-filtered `context.agent_links`.
Reviewed run context includes only this run's agent associations whose targets
are already captured readable sources; links do not expand the reviewed source
set or unlock a project's documents. The manifest records these in `agent_links`.

## Scheduling and limits

Existing scheduled prompts/actions still require their exact human-reviewed
prompt/model/context or action and existing durable scheduling checks. An
action block cannot schedule paid inference or infer consent from a request to
create a Route. A model may propose exactly:

```json
{"type":"schedule.create","chat_id":"existing chat ID","content":"exact proposed prompt","model":"explicit provider model ID","run_at":"2026-11-01T01:00:00.000Z","timezone":"Asia/Shanghai","recurrence":"daily"}
```

The source run determines the agent ID. The proposal always stays pending.
`POST /api/agent-actions/:id/prepare-schedule` with `{workspace_id}` only returns
`{result:{action_request_id,workspace_id,chat_id,agent_id,content,model,run_at,timezone,recurrence}}`
after rechecking canonical source and target permissions and structural snapshots.
This does not launch, approve, schedule or consume anything. Ordinary action
approval and scheduling this as `kind: action` are blocked.

The UI must create a NEW exact context inspection for the canonical agent,
proposed content and explicit model, then show explicit message schedule
confirmation (including time, recurrence and context). Recurrence is `none`
(the default), `daily`, or `weekly`, never an arbitrary timer or a repeated
action approval. The existing `kind: message`
schedule API accepts `payload.action_request_id` for this conversion; it checks
the exact content/model/agent/chat and proposed recurrence, rechecks source access,
and consumes the pending intent atomically with the durable schedule receipt.
The intent becomes `scheduled`, not `applied`, only after actual schedule creation.
Original source access is rechecked when listing/delivering the resulting schedule.

Confirming a repeating agent prompt authorizes a separate provider invocation
at each due time until paused or cancelled. Each invocation rechecks current
access, profile/model/account readiness and the original captured sources.
It reuses exactly the saved context; new conversation messages, changing Route
state and future workspace edits are **not** automatically read. The server
must be running. Missed occurrences and uncertain interrupted dispatches are
recorded, not blindly retried. Local notes do not contact a provider.

### Manage schedules through a conversation

When workspace context is enabled, a reviewed prompt can include up to 15
accessible active/paused schedule summaries belonging only to its authenticated
sponsor. Managers do not receive other users' schedules through this context.
The prompt contains exact IDs, versions, titles, state, next due instant, time
zone and recurrence, not an unbounded schedule/prompt dump. Their historical
and current source boundaries travel with later run/output context; revoking
an original private source also hides dependent schedule metadata captures.

An agent may propose:

```json
{"type":"schedule.update","schedule_id":"exact listed ID","version":1,"state":"paused"}
```

Use `active` to resume, `paused` to pause future occurrences, and `cancelled` to
permanently stop future occurrences. To change timing, include both a precise
UTC `run_at` and an IANA `timezone`; the exact instant is retained even during a
daylight-saving repeated hour. The proposal cannot edit prompt, model, recipient
or recurrence. Those require a new message/context review, not an overwrite.

Every change remains pending, including with the low-risk policy enabled.
The human reviews the exact existing schedule/version and proposed timing/state,
then selects **Confirm schedule change**. Both the source sponsor and reviewer
must be its creator with current original-source access. A stale version fails
without consuming the pending receipt. The canonical scheduler change and the
proposal receipt commit atomically; retrying cannot apply the change twice.
Schedule-management proposals cannot themselves be delayed as scheduled actions.
Pausing/cancelling does not terminate a run that was already dispatched.

No autonomous event watcher, automatic next-turn/task delegation, recurring
action approval, background tool loop or paid-account verification is added here. Native MCP
write tools remain review-only; this direct slice is the final-reply protocol.

Project memberships are exported as content-only `agent_project_links` tuples
`{workspace_id,project_id,agent_id}` with readable references only. Import validates
every tuple, rejects authority fields/foreign or missing references/duplicates,
and remaps IDs atomically into the new workspace. Imported profiles remain
unbound/read-only; membership never restores credentials or authority. Per-actor
direct policy, pending proposals and schedule execution authority are not portable.
Automated tests use isolated databases and injected provider fixtures, not real
provider accounts or the user's workspace.

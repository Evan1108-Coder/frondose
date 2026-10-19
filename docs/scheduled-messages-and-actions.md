# Messages and agent actions, now or later

The Playbooks workflow builder has been removed. Describe a change in an agent conversation and review the proposed action in that conversation. You can approve it immediately or select **Schedule** for a future time. Messages have their own Schedule button beside Send or Save note.

## Supported agent actions

| Item | Actions and fields |
| --- | --- |
| Route | Create, rename, change description/stage/priority/due date, create a sub-route, recoverably archive |
| Project | Create, rename, change description/goal/stage/start or target date, recoverably archive |
| Document | Create, rename, replace content, recoverably archive |
| Milestone | Create, rename, change description/stage/target date, recoverably archive |
| Conversation | Create, rename, pin/unpin, add a local note, recoverably archive |
| Agent memory | Save a scoped memory from the source agent’s completed reply |
| Presentation preferences | Propose supported theme, density, text, motion and general interface preferences |

The agent receives a typed catalog with required fields and stable workspace IDs in its reviewed prompt. The final response can contain up to five proposed actions. Every proposal is validated and saved for human review. The review shows item names and field changes; raw action details remain expandable. Approval rechecks both the original run sponsor and reviewer, the source context, target scope, and current target values. A reviewed receipt and the write commit together. Duplicate decisions do not repeat the write.

These actions work for active Codex and Claude Code runs and for explicit chat models through connected OpenRouter or configured Hugging Face accounts. API models receive the same reviewed Talvori prompt/action catalog, but no project-file or native MCP tools. A provider can still reject a model, rate-limit the request, or consume its account’s usage. OpenRouter/Hugging Face completion tokens are recorded as provider-reported events, not an account balance or billing ledger. Plugin actions remain unavailable while Plugins are paused. No action changes credentials, grants permissions, permanently deletes records, or approves another agent’s proposal.

## Schedule a message

1. Open a conversation and write the message.
2. Choose a note or connected agent as recipient. For an agent, use Discuss and review the exact context first.
3. Choose Schedule, set a date, clock time and IANA time zone, then choose no repeat, daily or weekly.
4. Confirm the schedule. The draft clears after the saved schedule is confirmed.

An agent schedule saves the exact context reviewed at scheduling time. Later messages, memories or workspace changes are not silently included. Recurrences reuse that reviewed context. To use newer context, cancel the schedule and prepare a new message. Changes to the profile/model/scope that invalidate the reviewed execution options fail the occurrence and require a new review.

Current and historical context permissions are checked again when queued work is viewed or dispatched. Canonical chat context attachments carry their captured source scopes; moving a source does not discard its old restriction. Legacy attachments without source lineage must be selected again. Ordinary user text attachments remain supported. The scheduler does not give an agent automatic approval to apply proposals in its eventual reply.

A note schedule saves text and its supported attachments locally in the chosen conversation. It does not contact a model. Image attachments are not part of this scheduled-message path.

## Schedule an action

Review a pending agent proposal, choose Schedule and **Approve and schedule**. That approval applies once to the exact proposal and captured target state. If the target, its parent scope, permissions or source run changes before the due time, the occurrence fails without applying the change. The proposal returns to pending review. Actions cannot repeat the same approval; a recurring agent prompt can propose fresh changes for review instead.

## Manage schedules and activity

Settings → Scheduled messages & actions lists accessible schedules and recent occurrences. Change time, pause/resume or cancel upcoming work. Cancelled schedules retain their history and never undo a delivered message or applied action. Cancelling an already started provider run requires the run’s Stop control.

The occurrence records completed, running, failed, missed or interrupted outcomes with links to the canonical message/run. Related conversation or project Activity also records schedule changes and delivery/action outcomes. Shared Activity does not reveal a queued message’s text before delivery. Only the person who scheduled a job can change its authorization; appropriately privileged members can inspect accessible records.

## Clock and delivery behavior

- The Talvori server must be running. An occurrence more than two minutes late is recorded as missed. Repeating schedules advance to the next future occurrence instead of sending a backlog.
- The chosen IANA zone determines daily/weekly wall-clock time. Nonexistent times during a clock change are rejected for an explicit appointment; repeating jobs skip that nonexistent local occurrence. An ambiguous repeated clock time uses its first occurrence.
- An occurrence is claimed durably before dispatch. Local action writes and their completed receipt are atomic. Canonical chat turn IDs prevent another send during recovery.
- After a server interruption, a recorded canonical message/run can be reconciled. An unknown delivery is marked interrupted and is not retried automatically. Check its activity before creating another schedule.
- Scheduled work and its private context snapshots are not included in the portable workspace JSON export. Preserve database backups for operational history. This local scheduler is not a public multi-instance job queue.

Tests use isolated databases, fake provider HTTP/process responses, controlled clocks and source/permission changes. They do not contact real accounts. See `tests/scheduled-work-*.test.mjs`, `tests/agent-actions-catalog.test.mjs`, and `tests/ai-connection-execution.test.mjs`.

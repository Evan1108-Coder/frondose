# Event-triggered work

Event triggers run a reviewed agent request when Talvori records one of three
supported local events: a Route is created, a Route is updated, or an update or
reply is published. They are not external Plugin watchers, browser-page-open
triggers, or a general-purpose workflow builder.

## Create a trigger

1. Connect an AI account, verify it using the connection's explicit test, and
   create a conversation with a profile bound to that account.
2. Open **Talvori → Scheduled** or **Settings → Scheduled messages & actions**.
   Choose **New event trigger** in Event-triggered work.
3. Name the trigger and select an existing connected agent conversation.
4. Choose a supported event and scope: this workspace, one Area, one project,
   or one Route. Only accessible records are offered.
5. Write the exact request and choose a minimum time between runs, from 5 to
   1,440 minutes. Events arriving during the cooldown are skipped, not queued.
6. Choose **Review context**, then **Inspect context**. Read the exact captured
   Talvori prompt and choose **Use this context**.
7. Confirm recurring provider usage and the bounded future event metadata.
   Choose **Enable event trigger**. Opening the editor, typing, and inspecting
   context do not contact an AI or enable a trigger.

The original prompt and reviewed context remain a fixed snapshot. Each run
additionally receives only the triggering event's type, source type, source ID,
and recorded time. Future body text, titles, status values, new conversation
messages, and other workspace changes are not silently appended. Source access
is checked again before dispatch, and each occurrence captures its own immutable
prompt. This is not fresh-state workspace monitoring.

## Limits and activity

- At most five active triggers per account in a workspace.
- At most 12 dispatches in a rolling 24-hour window per trigger.
- At least five minutes between dispatches, and at most one in-flight run per
  Talvori server across all event triggers. Matching events received while that
  worker is busy are skipped, not queued. These are dispatch limits, not a
  monetary spending cap.
- Recorded matching events, skips, failures, and run links appear in **Event
  activity**. Receipts and prompts remain subject to current access checks.
- **Pause trigger** prevents new dispatches. **Resume trigger** rechecks current
  authority and the saved execution configuration.
- **Cancel trigger** requires confirmation. Cancelling stops future work; it
  does not stop a provider run that has already started or erase receipts.

Each provider dispatch may be billable. Trigger consent does not approve the
agent's response actions, grant native tools, or bypass workspace permissions.
An unavailable connection cannot be selected to enable new work. A profile,
model, account, or source-access change can prevent future execution; reconnect
and create freshly reviewed work rather than silently changing its authority.

Talvori's persistent server must remain running and online. It can operate
continuously on suitable hosting, but the browser tab itself is not a server.
Missed events are not backfilled, interrupted or uncertain executions are not
blindly retried, and no off-app notification delivery is implied.

Subscriptions, saved recurring authorization, routing evidence and delivery
receipts are operational database records, not portable workspace JSON
authority. Keep consistent private database backups if these records matter;
importing a workspace never enables its old subscriptions.

The initial event catalog includes human-created/edited Routes and newly
published updates or replies on projects, Routes, Requests, documents, outputs,
milestones and chats. Editing an already published update is not publication.
Reaction changes and opening a page are not event triggers yet. Agent-origin
changes, approved agent proposals, scheduled work and unattributed historical
records cannot trigger this worker. Routing uses immutable project/Area scope
captured with each change, not the source's later location. A Request without a
single linked Route/project matches workspace triggers only; ambiguous legacy
multi-project Requests are not silently assigned to a project or Area.

Each live occurrence adds only `event_type`, `source_type`, `source_id` and
`occurred_at`, as untrusted reference data before the saved instruction. Its
immutable run context retains the event source and historical scope permissions.
The original subscription review remains unchanged. Revoking a source hides
dependent receipt metadata as well as the resulting prompt/run. An unavailable
source or failed provider run pauses the subscription. Resuming a changed agent
profile requires a new exact review, not silent adoption of the new profile.
Recorded events older than 15 minutes are marked missed; startup and resume
start from the current event cursor, without a backlog of paid dispatches.

## Verification

Automated UI-helper tests cover connection readiness, exact account binding,
workspace isolation, prohibited native/file authority, bounded cooldowns,
inspection expiry, explicit consent, and stable retry identity. Mocked-browser
checks cover creation, an uncertain save followed by the same-identity retry,
stale-read-safe pause/resume, cancellation confirmation, recorded skip activity,
access-revocation cleanup, disconnected controls, and desktop/mobile rendering.
Those checks do not certify live provider inference or a production host.

Backend service and full HTTP integration tests also exercise canonical
`launchRun`/chat-turn delivery with injected provider processes, immutable context
capture, reserved one-use previews, current/historical source permission loss,
two queued Route moves, published Requests, disconnection, profile changes,
worker concurrency, cooldown skips, the rolling dispatch cap, restart recovery,
uncertain dispatches, and timer operation with no open browser page. No test uses
a real provider account or incurs provider charges.

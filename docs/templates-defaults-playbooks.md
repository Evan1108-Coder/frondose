# Templates, field defaults, and Playbooks

This guide describes the implemented features in Rumbo. It does not imply that Rumbo can run every conceivable action or contact services that are not connected.

## Structured templates

Route, project, and conversation templates live in Settings. A template can carry the ordinary starting content plus up to 24 custom questions. Each question has a stable identifier, a label, and a text, long-text, or choice control. You can make a question required, set a placeholder, and provide a starting answer. Choice questions need explicit choices. When using a template, answer its questions in the creation dialog. Rumbo saves those answers with the created item, so changing the template later does not silently rewrite existing work.

Templates create workspace content only. They do not contact an AI provider, start a run, schedule an action, or grant access. A chat template's opening note is saved as template content; it is not sent to an agent. Review the created item before treating its answers as an approved specification.

Template answers are ordinary workspace content, not a secure secret vault. Do not make questions for passwords, API keys, payment details, or other credentials.

## Field defaults

Open Settings → Field defaults to find the supported named input fields. Search by page or field name. The current inventory covers 107 tagged, non-sensitive creation inputs across new work items, Settings resources, Areas, documents, milestones, and draft Skills, plus active custom template text questions. Defaults are personal to this browser and workspace, not shared with teammates or synced across devices. Each field can have up to nine named values and one primary value. The feature is on by default, but an individual field or value can be switched off. A default is inserted only into a blank, eligible new-item field; editing existing content is not silently replaced.

When the cursor is in a configured field, Command/Ctrl+1–9 chooses a numbered value and replaces the field's current text. Browser tab shortcuts may intercept those keys. Alt+Shift+1–9 is the dependable alternative. Command/Ctrl+Z immediately restores the text replaced by a default; after further typing, normal browser undo behavior applies. Do not rely on this as a substitute for saving a draft.

Only fields listed on the settings page are supported. Custom template text and long-text questions appear while their templates are active; choice questions are not defaultable. Sensitive fields, credentials, passwords, API keys, search boxes, and unrelated controls are excluded. Keep secrets out of defaults even when a generic text field accepts them. Browser storage can be cleared, so defaults are convenience text, not a backup.

Date defaults must be real dates in `YYYY-MM-DD` format. Invalid dates and values rejected by the destination control (for example, a number outside that control's range) remain saved for editing but are not inserted. If browser storage is unavailable or full, Settings reports that saving failed.

### Eligible-field audit

The 107 named static fields are backed by tagged creation controls, not a claim that every input on the site is defaultable. The audited surfaces include new workspace/project/Route/conversation/agent forms; updates, outputs, context, knowledge, Area resources and repeat Routes; Settings resource creation; new Areas, documents and milestones; and draft Skills. Active template text questions are additional dynamic fields. The field-inventory test compares Settings resource definitions with the shared resource catalog and checks that new text/date controls in the audited resource and workspace editors cannot be added without a default tag.

Search/filter inputs, passwords, tokens, payment details, contact details, person identifiers, file controls, choice/checkbox controls, and fields editing an existing item are intentionally outside automatic insertion. Other dynamic or review-specific editors—including repeated plan/workflow steps, Skill examples and test cases, permission/approval decisions, and provider settings—are not covered yet. A field absent from Settings should not be described as supported. Neither template answers nor browser-stored defaults are safe places for secrets.

## Playbooks

Playbooks are reusable sequences of safe Rumbo actions. In the Playbooks tab, create a playbook, choose a trigger, add one or more steps, review their settings, then save. The available action catalog is deliberately finite and shown in the editor. There are currently 13 executable local actions:

| Area | Available actions |
| --- | --- |
| Routes | Create a backlog draft, change priority, rename |
| Projects | Create a planned draft, set goal, set target date |
| Milestones | Create a planned Project milestone with an optional target date |
| Documents | Create a Project document |
| Conversations | Create an empty chat, rename, pin, unpin, add a local note |

These are real local writes, not simulated cards. A local conversation note is **not** a message sent to an AI provider. The current catalog does not call AI providers, edit files, mark external mail read, or change the browser tab. Plugin actions are cataloged separately as Coming soon and cannot be added to or run from a Playbook while service connections are paused. Agent execution is likewise unavailable here because it needs reviewed context and execution-specific permissions. The action editor shows selectors for active Project, Route and conversation targets, choice menus for bounded values, and a date input; dates must be real `YYYY-MM-DD` calendar dates.

Triggers are a Run button, opening Inbox, or a time on selected weekdays in an IANA time zone. A scheduled trigger runs only while the local Rumbo server is running; a missed time while it is down is not replayed. An Inbox-open trigger requires a signed-in workspace user who can manage automations. Disable a playbook to stop future triggers without deleting its history. Archive it to remove it from active lists.

Each run has a status and per-step receipts. A completed run means the configured writes completed; it does not mean an AI reviewed their content. If a step fails, earlier completed steps are not rolled back. Repeating the same request key does not replay it. A run interrupted by a server restart is recorded as interrupted and is not automatically retried. Review receipts before manually running again to avoid duplicate drafts.

Playbooks require the `automations.manage` permission; each step also rechecks its own write permission and target scope. Existing-item changes also recheck read access and reject archived or cross-workspace targets. Successful writes enter Rumbo's change history with Playbook attribution. Saved playbooks do not grant new permissions. The current workspace JSON export/import does not include Playbooks or their run receipts. Preserve database backups before migrations and do not treat a JSON export as a complete operational backup.

## Current boundaries

- Existing Route automation rules in Settings remain manually previewed and applied; they are not Playbooks and have not been deleted.
- Existing agent Workflows remain a separate orchestration interface. A Playbook does not launch an agent or replace approval review.
- The action catalog must grow one implemented, permission-checked action at a time. Listing hundreds of hypothetical actions would make the UI misleading.
- Publicly hosted, multi-instance scheduling requires a durable queue/worker and deployment-specific guarantees. The current scheduler is tied to one running local server process.

For implementation and tests, see `server/playbooks-service.mjs`, `server/structured-templates.mjs`, `src/lib/field-defaults.js`, and their corresponding `tests/` files.

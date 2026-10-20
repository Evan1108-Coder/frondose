# Templates, field defaults, and scheduled work

This guide describes the implemented features in Frondose. It does not imply that Frondose can run every conceivable action or contact services that are not connected.

## Structured templates

Route, project, and conversation templates live in Settings. A template can carry the ordinary starting content plus up to 24 custom questions. Each question has a stable identifier, a label, and a text, long-text, or choice control. You can make a question required, set a placeholder, and provide a starting answer. Choice questions need explicit choices. When using a template, answer its questions in the creation dialog. Frondose saves those answers with the created item, so changing the template later does not silently rewrite existing work.

Templates create workspace content only. They do not contact an AI provider, start a run, schedule an action, or grant access. A chat template's opening note is saved as template content; it is not sent to an agent. Review the created item before treating its answers as an approved specification.

Template answers are ordinary workspace content, not a secure secret vault. Do not make questions for passwords, API keys, payment details, or other credentials.

## Field defaults

Open Settings → Field defaults to search safe input fields by page, dialog, field name, or stable field key. The catalog includes creation and existing-item editors, search/filter inputs, ordinary Settings fields, repeated row editors, and active custom template text questions. Source discovery builds the catalog before those pages have been visited; mounted runtime controls provide a semantic fallback. Defaults are personal to this browser and workspace, not shared or synced across devices. Each field has up to nine named values and one primary value. Global, per-field and per-value switches are independent.

When the cursor is in a configured field, Command/Ctrl+1–9 chooses a numbered value and replaces the field's current text. Browser tab shortcuts may intercept those keys. Alt+Shift+1–9 is the dependable alternative. Command/Ctrl+Z immediately restores the text replaced by a default; after further typing, normal browser undo behavior applies. Do not rely on this as a substitute for saving a draft.

Safe text, search, textarea, email, URL, telephone, number, date, time and datetime-local inputs are covered, including authored DateField and SearchField controls. Active template text/long-text questions have template-and-field identities; custom choice questions are not defaultable. Passwords, passcodes, one-time codes, API keys, access/refresh/verification tokens, private keys, credentials, card/payment/account-number fields, and inputs inside sensitive authentication/security/payment forms are excluded. File, hidden, checkbox, radio, range/color-picker, disabled and read-only controls are not text-default destinations. Field Defaults' own editors are excluded to prevent recursive filling. First-use onboarding before a workspace exists has no workspace-specific defaults; normal new-workspace forms inside the app are covered. Never put secrets into an otherwise ordinary text default. Browser storage can be cleared: defaults are convenience text, not a backup.

Primary values fill only blank new-form/composer fields and safe search inputs. Existing saved text is preserved. Existing-item fields and auto-saving Settings fields can still use explicit numbered shortcuts, but discovery does not call their onChange or silently save a preference. Shortcuts follow the destination's normal edit behavior; undo restores the previous text, not an already submitted record or other side effects.

Dates must be real dates in `YYYY-MM-DD` format; time and datetime-local values use native ISO input formats. Malformed email/URL/numeric values and native min/max/step/pattern/length violations are not inserted. Invalid values remain editable in Settings. Missing/full browser storage reports a failed save, not success.

### Eligible-field audit

The shared source analyzer instruments every native text input/textarea and shared DateField/SearchField call site in the source tree, and builds the same searchable catalog for development and production. Displayed names come from product headings, popup titles, nested labels and template row captions; shared controls have explicit product scopes such as Appearance, Workbench commands and Scheduled messages. Display-only metadata changes do not re-key saved values. Stable identities derive from the source file, component, form/section context, label and value expression; inserting a sibling or reordering repeated rows does not renumber fields. Repeated rows share defaults for their semantic column, not a row index. Existing explicit keys remain compatible. Shared-component entries supply a fallback across dynamic variants when no more-specific field entry is configured; a specific field entry, including a disabled/empty one, always wins. Active template IDs keep custom questions separate.

The full-source coverage test checks every input site for instrumentation or an explicit exclusion, plus semantic identity stability, sensitive neighboring fields and the resource catalog. Browser regression tests exercise real React controlled and native/uncontrolled inputs, authored search/date controls, explicit edits, immediate undo, range/step/pattern/length constraints, Settings search and pre-discovery. Unsupported/sensitive controls are excluded intentionally; removed Playbooks never add new inventory entries. New runtime-only controls outside normal JSX use the semantic fallback and become searchable when mounted.

Each saved preset is bounded to 4,000 characters; the destination's format and length limits still apply. Terminal stream helpers are excluded so presets never intercept raw shell input. Workbench command-editor fields remain searchable and retain their ordinary reviewed launch flow.

## Reviewed actions and scheduled messages

Use Frondose to describe a supported workspace change, then inspect and explicitly approve its proposed action. Proposals do not gain authority from being written by an agent, saved as instructions, or mentioned in a schedule. Current permission, target-scope and stale-state checks still apply. This is the ordinary agent-proposal path, not a new standalone action builder.

Use a conversation's Schedule entry point to prepare a later local note or agent prompt. A supported pending agent-action proposal also offers Schedule: explicitly review the exact proposed action and target snapshot before choosing its time. Settings → Scheduled messages & actions brings accessible schedules together for inspection and management, and recorded results appear in Activity. Check the exact message or action, intended agent, context, time and execution limits. A message schedule does not grant arbitrary action permissions; proposals from any later agent response still require their normal review. External Plugin actions remain paused.

## Retired Playbooks records

The multi-step Playbooks builder and its navigation destination have been removed. Older `#/playbooks` links lead to Settings → Scheduled messages & actions. Browser-personal navigation normalization drops the retired tab from sidebar placements, pins and header shortcuts while retaining unrelated preferences.

Existing Playbook definitions, immutable versions, runs and step receipts remain in the local database as inert historical records. The former manual, Inbox-open and timer dispatch paths are disabled. Opening Inbox or restarting the server does not resume them. Their earlier completed actions are not undone, and this retirement does not erase change attribution.

Workspace JSON export/import does not contain those historical records. Preserve a consistent database backup; do not treat the JSON export as a complete operational backup.

## Current boundaries

- Existing Route automation rules in Settings remain manually previewed and applied; they are separate and have not been deleted.
- Existing agent Workflows remain a separate, manually advanced orchestration interface.
- Listing an action or external service is not evidence that it is executable. Supported agent proposals retain their existing review and permission gates.
- Local scheduling is not a publicly hosted durable queue; do not assume operation while the local server is down or multi-instance delivery guarantees.

For templates and defaults, see `server/structured-templates.mjs`, `src/lib/field-defaults.js`, and their corresponding `tests/` files. The legacy Playbook schema is retained for historical data; its service and UI have been removed. See [scheduled messages and agent actions](scheduled-messages-and-actions.md) for the active replacement.

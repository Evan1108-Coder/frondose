# What Talvori can know about your workspace

Talvori uses the connected AI you choose. It is not a separate model, an
omniscient observer, or a person. On an explicit send, Talvori compiles a bounded,
permission-checked snapshot. The exact supplied text and its source limits remain
visible in the run's captured context. Opening a tab or adding a reaction does not
silently send your workspace to an AI.

## Included information

With **workspace context** enabled, the snapshot can include:

| Information | Per-inspection selection limit | What is supplied |
| --- | ---: | --- |
| Areas | 12 | Readable names and descriptions |
| Projects | 20 | Briefs, goals, status and progress |
| Routes | 30 | Briefs, status, priority, progress and parent IDs |
| Documents | 12 | Titles and parent IDs, not full bodies |
| Conversations | 12 | Titles and parent IDs, not other messages |
| Milestones | 12 | Titles, status, dates and project IDs |
| Labels, statuses and templates | 8 per supported kind | Names, bounded descriptions and template structure |
| Custom emoji catalog | 40 active items | Names, stable IDs and usable shortcodes; never image blobs |
| Safe server settings | Allowlisted sections only | Appearance, general preferences, notification toggles, privacy reporting choices, run-count/event-retention defaults, code wrapping and the current workspace's assistant appearance/context preferences |

Supported configuration kinds are Route/project labels, Route/project statuses,
and Route/project/conversation templates. Template question labels/types/required
flags are supplied; instance answers and default field values are not.

The manifest records readable counts, selected counts, omitted counts, selection
limits and actual character truncation. All sections share the existing bounded
context budget; a table's selection limit is not a promise that every selected
character fits. Other content can be added through the existing explicit Context
Pack, document, memory or past-message selection flows. Saved memories and
approved knowledge retain their existing selection and source-access rules.

### Reactions and emoji

With **conversation history** enabled, the selected current conversation's latest
20 readable messages and up to 24 saved reactions per selected message are
available. Reactions on the persisted current message are included too when it is
readable. Built-in reaction IDs resolve to their names and Unicode emoji; custom
reactions resolve only to metadata in the same workspace. A reaction to another
message is not included just because it exists in the collaboration record.

Explicitly selecting a past message also snapshots that message's reactions.
Later reaction edits do not rewrite the reviewed snapshot. Archived custom emoji
used in existing reactions remain described as archived, without advertising a
usable shortcode; they do not appear in the active emoji catalog.

The agent can use ordinary Unicode emoji and listed active `:custom-shortcodes:`
in replies. Existing message rendering handles these; no uploaded HTML, SVG,
external image URL or image blob is inserted into the model context. This does
not add an autonomous reaction-writing tool. Reactions are expression, never
approval, instructions, permission grants or evidence that work is complete.

### Natural conversation

Shared guidance asks the AI to match the user's language and requested style,
answer directly, use emoji when useful rather than in every answer, and be clear
about missing information. It must not pretend to be human, invent experiences,
claim to watch everything continuously, or claim actions succeeded without a
canonical result. Custom user/profile guidance remains editable and is not
rewritten to obtain this behavior.

## Privacy and authorization boundaries

- Server settings currently belong to the local owner under Talvori's existing
  settings access model. Other accounts do not receive that owner's settings or
  personal communication instructions. Settings-derived replies preserve the
  same private boundary when reused as history, memory or retrieved context.
- Settings reads are a typed field allowlist, not a dump of the settings table.
  Unknown keys, arbitrary nested values, credentials, access tokens, capability
  secrets, native-tool grants and approval-policy grants are excluded.
- Browser-local sidebar choices, Field Defaults and their values, unsent drafts,
  bookmarks/read receipts, private account details and other workspace assistant
  preferences are not included. The server cannot infer browser-only state.
- Each included message, parent scope, configuration item and emoji keeps its
  canonical source identity. Historical and current permissions are checked
  again when captured context, dependent replies, retrieved snapshots or derived
  memory are accessed. Moving a source cannot erase its old permission boundary.
- Turning off workspace/history context omits the corresponding additions.
  Merely knowing a setting, seeing a reaction, or reading a saved instruction
  grants no action authority and cannot approve a paid run or destructive action.

This is broad, bounded workspace awareness—not literal access to everything.
Always-on event-triggered execution is a separate explicitly reviewed capability;
an awareness snapshot does not itself register a watcher or authorize future work.

## Verification

`tests/agent-workspace-context.test.mjs` covers allowlist leakage, actor redaction,
emoji archival and foreign-workspace isolation, private collaboration exclusion,
exact-context determinism, omission budgets, historical reaction ACLs, immutable
past-message snapshots and private settings lineage. The additional HTTP
regression in `tests/context-security.test.mjs` checks that a second signed-in
account cannot read the owner's personal instructions through a new preview or
captured run. These tests use isolated fixtures and no paid provider calls.

# October 2026 implementation checkpoint

This checkpoint records the current October 8 action, scheduling and input-default systems, followed by the earlier October 5–6 verification. For operating details, see [scheduled messages and agent actions](scheduled-messages-and-actions.md), [Templates and defaults](templates-defaults-playbooks.md), [AI connection navigation](ai-connections-navigation.md), [Frondose setup](frondose-agent-onboarding.md), [sidebar sizing](sidebar-motion-and-sizing.md) and [Workbench motion](workbench-motion.md).

## Working scope

| Surface | Implemented | Boundary |
| --- | --- | --- |
| Templates | Route, Project and Chat custom questions save scoped answers with created items. | Other editors do not yet have the same question-builder. |
| Field Defaults | All safe text input sites use shared source discovery and runtime fallback, including search, existing-item editors, repeated rows and template text questions; settings names are pre-discovered. | Sensitive/security/payment fields and non-text, read-only/disabled controls are excluded. Existing text changes only by explicit preset selection; first setup before a workspace exists has no workspace presets. |
| Scheduled work / retired Playbooks | Typed local create/edit/archive actions, notes, memory and presentation preferences use review. Notes and reviewed agent prompts can repeat daily/weekly; approved actions can run once later, with receipts and Activity. | The server must run at the due time. Missed/unknown deliveries are recorded without blind retry; Plugins remain paused. Old Playbook records stay inert; manual Workflows and Route rules remain separate. |
| AI Connections | Codex/Claude local runners and explicit-model OpenRouter/configured Hugging Face conversations support reviewed local actions and scheduled prompts. Actor/workspace readiness survives polling and mutation refreshes. | Browser API providers have no native/file tools or CLI usage ledger. Copilot remains unavailable. Real account billing/compatibility has not been tested. |
| Frondose | First-use name, color, purpose and guidelines; blue is default; guidance enters versioned profile instructions and exact context review; prior conversations remain readable. | New use needs a connected supported account; API providers require an explicit model. Setup itself does not sign in or launch work. |
| Navigation and motion | Configurable header shortcuts and pinned-tab dock; main/Settings rail resize, hide, hover peek and extreme-width mini-page; page, dialog and Workbench arrival cues; bounded link hover preview. | Not every popup has a bespoke exit animation. Terminal canvas rows are not individually animated, and link previews never fetch a remote screenshot. |

The current design follows Paseo's useful browser-client/local-runner separation, but Frondose is not a fork or complete drop-in replacement. CLI sign-in is required on the machine running the local server for its Codex/Claude execution paths. Browser sign-in to OpenRouter or Hugging Face is not interchangeable with that runner.

## October 8 verification

Final verification: **1,009/1,009** isolated Node tests passed, **4/4** Sites packaging tests passed, and the production build passed. Real React preset regressions and desktop/mobile browser checks passed, including first-use setup, explicit browser model selection, reviewed scheduling and completed action receipts. Screenshots use disposable QA data. The build retains its existing large-chunk warning.

The active October 8 implementation is covered by the full isolated Node suite, real React input-default regressions, mocked provider HTTP/process tests and desktop/mobile schedule UI checks. These include no duplicate scheduled sends, restart recovery, time-zone/DST behavior, target/source revocation, reviewed action writes, native-input constraints, preset replacement/undo and actor-specific AI readiness through polling. Real provider accounts and billing were not used. See [scheduled work](scheduled-messages-and-actions.md) for operation and [default fields](templates-defaults-playbooks.md) for coverage and exclusions.

## Historical October 5–6 verification

- The full isolated Node suite passed: **939/939** tests. The separate Sites packaging suite passed **4/4** tests. The production build passed with a pre-existing large-chunk warning.
- In the local browser, AI Connections listed the five distinct provider routes; Local filtering and provider search narrowed the list; opening OpenRouter showed its detail before any authorization.
- Desktop Frondose displayed the blue orb in the sidebar, header and composer. The full-screen onboarding layout is covered by API/React build checks but was not exercised against a disposable new workspace in this browser session; no real provider call was made.
- Desktop main and Settings sidebar preview modes opened via wide drag/End, offered Move/Resize/Open controls, and restored the prior normal width. A 390×844 AI connection detail remained readable. The pinned dock was checked in horizontal and left-edge vertical states; its default bottom position was restored after the test.
- No test claimed that hundreds of external actions, all input fields, all languages, live billing, or hosted multi-user execution work.

## Safe next milestones

Keep agent actions behind their existing review, permission, target-scope, stale-state and idempotency checks. Expand Templates and Field Defaults surface by surface. Plugin actions require their actual service connection to be re-enabled and verified. Broader language support needs reviewed end-to-end translations rather than a decorative selector. Public-hosted AI execution needs identity and per-user runner isolation before it can honestly use a visitor's account.

# October 2026 implementation checkpoint

This checkpoint records the behavior verified for the Templates, Field Defaults, Playbooks, AI Connections and interface-motion pass. It is a release ledger, not a claim that the proposed end-state is complete. For operating details, see [Templates, defaults and Playbooks](templates-defaults-playbooks.md), [AI connection navigation](ai-connections-navigation.md), [Rumbo Agent setup](rumbo-agent-onboarding.md), [sidebar sizing](sidebar-motion-and-sizing.md) and [Workbench motion](workbench-motion.md).

## Working scope

| Surface | Implemented | Boundary |
| --- | --- | --- |
| Templates | Route, Project and Chat custom questions save scoped answers with created items. | Other editors do not yet have the same question-builder. |
| Field Defaults | 107 audited non-sensitive creation fields plus active template text questions; per-field enablement, multiple values, numbered shortcuts and undo. | Not every input: dynamic row editors, search, choice/file controls, credentials and existing-item edits are excluded. |
| Playbooks | 13 permission-checked local actions; manual, Inbox-open and local-server weekday/time-zone triggers; versioned definitions, receipts and idempotency. | No AI execution, external Plugin action, email operation, arbitrary browser tab change, catch-up scheduling or complete export/import. The catalog deliberately does not advertise imagined actions as runnable. |
| AI Connections | Compact searchable/filterable list; provider detail appears before authorization; OpenRouter and operator-configured Hugging Face account routes remain separate from local Codex/Claude runners. | The two browser account routes do not power Rumbo Agent. Copilot is not connected. Real accounts and billing were not used in automated tests. |
| Rumbo Agent | First-use name, color, purpose and guidelines; blue is default; guidance enters versioned profile instructions and exact context review; prior conversations remain readable. | New Agent use still needs a ready local provider runner; setup itself does not sign in or launch work. |
| Navigation and motion | Configurable header shortcuts and pinned-tab dock; main/Settings rail resize, hide, hover peek and extreme-width mini-page; page, dialog and Workbench arrival cues; bounded link hover preview. | Not every popup has a bespoke exit animation. Terminal canvas rows are not individually animated, and link previews never fetch a remote screenshot. |

The current design follows Paseo's useful browser-client/local-runner separation, but Rumbo is not a fork or complete drop-in replacement. CLI sign-in is required on the machine running the local server for its Codex/Claude execution paths. Browser sign-in to OpenRouter or Hugging Face is not interchangeable with that runner.

## Verification

- The full isolated Node suite passed: **939/939** tests. The separate Sites packaging suite passed **4/4** tests. The production build passed with a pre-existing large-chunk warning.
- In the local browser, AI Connections listed the five distinct provider routes; Local filtering and provider search narrowed the list; opening OpenRouter showed its detail before any authorization.
- Desktop Rumbo Agent displayed the blue orb in the sidebar, header and composer. The full-screen onboarding layout is covered by API/React build checks but was not exercised against a disposable new workspace in this browser session; no real provider call was made.
- Desktop main and Settings sidebar preview modes opened via wide drag/End, offered Move/Resize/Open controls, and restored the prior normal width. A 390×844 AI connection detail remained readable. The pinned dock was checked in horizontal and left-edge vertical states; its default bottom position was restored after the test.
- No test claimed that hundreds of external actions, all input fields, all languages, live billing, or hosted multi-user execution work.

## Safe next milestones

Add an action only with a permission model, target scope, idempotency behavior and test. Then expand Templates and Field Defaults surface by surface. Plugin actions require their actual service connection to be re-enabled and verified. Broader language support needs reviewed end-to-end translations rather than a decorative selector. Public-hosted AI execution needs identity and per-user runner isolation before it can honestly use a visitor's account.

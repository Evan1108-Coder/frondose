# Conversation and reader extension

October 20, 2026. This is an Operate / Read extension of the established Frondose interface, not a replacement visual world. The system snapshot is in `DESIGN.md`; the surface contract is in `.impeccable/surfaces/src-views-chats-jsx.md`.

## What stayed, what changed

| Established system retained | Surface-specific extension |
| --- | --- |
| Inter, neutral dark/light theme tokens, selective indigo actions | Fit-content right-aligned human messages using the user-pinned dark neutral (`#2c2c2c`) |
| Inset sidebar, real provider marks, thin outline controls | Left-aligned agent identity and readable rich prose in the centered reading lane |
| Existing conversation history, replies, reactions, selection, bookmarks, attachments, context, and reviewed actions | Compact observed work status links to Active work instead of expanding execution details into the conversation |
| Explicit connection identity, setup/readiness, permissions, and approvals | A full-viewport temporary Docs reader returns to its origin without adding a permanent sidebar/recent item |
| Existing keyboard and reduced-motion implementation | Narrow conversation controls wrap while code/tables keep local horizontal scrollers |

Frondose's own tab remains the place for its identity, explicit AI binding, setup, Activity, and Scheduled work. Conversations is the chat surface. The reader and message alignment do not establish a global prohibition on other valid Frondose screen compositions.

## Evidence and finish decision

The initial finish disposition was **fix**, limited to these three findings:

1. Preserve useful mobile reading space above the composer.
2. Remove the topbar control/text collision at (320px).
3. Contain the provider mark inside the padded (36px) mobile avatar frame.

The refreshed finish verdict is **ship for those three fixes only**. The (390px) and (320px) captures show agent prose above the compact approximately (171px) composer, with controls on two rows. The (320px) topbar separates its controls, avatar, and status indicator. The (36px) mobile identity frame visibly contains the smaller provider mark. No material regression was identified in the refreshed (320px), (390px), and (768px) captures.

Local evidence:

- `/tmp/frondose-conversation-desktop.png`
- `/tmp/frondose-conversation-mobile.png`
- `/tmp/frondose-conversation-320.png`
- `/tmp/frondose-conversation-768.png`
- `/tmp/frondose-reader-mobile.png`
- `/tmp/frondose-conversation-redesign-qa.json`

The browser fixture reports checks for neutral user bubbles, rich text/math/table/code, compact work status, observed code comparisons, no full execution logs, queued follow-ups without a provider call, protected handoff drafts, reader return preserving the draft, overflow, and single focus treatment. These fixture checks and screenshots are not evidence that every public provider was live-account verified. Native software-keyboard behavior was not tested. Automated regression, production-build, and Sites checks are separate validation evidence; this document intentionally does not freeze their changing test totals.

## Asset boundary

No new shipping raster was introduced by this extension. The generated concept stayed outside the repository and was used only to critique structure. Its invented domain, demonstration content, layout branding, and imagery were not shipped. Existing Frondose identity assets, provider marks, and the existing empty-art system remain the product assets; this task does not re-author their provenance.

## Documentation source and known drift

The design snapshot was extracted from `src/styles.css`, `src/ui.jsx`, `src/components/motion.css`, `src/components/global-toolbar.css`, the loaded sidebar/navigation overrides, and the conversation/reader/identity/document styles. The frontmatter owns primitives. The schema-version-2 sidecar adds observed motion, component-specific breakpoints, and self-contained previews; it contains no duplicated primitive arrays or synthesized tonal ramps.

Two incumbent differences were observed and left unchanged:

- Older instructions specify (18px) sidebar glyphs, while the later loaded `organization.css` rules set ordinary navigation SVGs to (16px). The documented token capture describes the effective CSS, not an unapproved reconciliation.
- Older guidance rejects page entrance motion, while `motion.css` currently defines a one-time keyed route entrance. The snapshot records that behavior and its reduced-motion/keyboard overrides without recommending more entrance animation.

Base sidebar sizes and row rules are also superseded by later loaded component styles. The documentation uses the effective sidebar/navigation values rather than treating an earlier declaration as the final computed design. No source, instruction, or unrelated documentation was changed in this documentation pass.

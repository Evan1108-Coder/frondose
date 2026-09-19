# Settings implementation — September 19, 2026

This is the implementation record, not a claim that the whole public service is finished. The older product blueprint is a proposal; the user's subsequent request superseded its Local system navigation and expanded the page set.

## Shipped in this pass

43 searchable settings destinations, plus team detail pages. Settings replaces the work sidebar. Neutral surfaces, restrained indigo actions, shared Lucide/Morphicons, custom dialogs/selects, responsive navigation, light/dark themes, and distinct table, workflow, library, directory, and usage layouts.

| Area | Working behavior |
| --- | --- |
| Preferences | Home view, chat send key, calendar week start; persisted and consumed |
| Appearance | Theme, density, larger content text, link underlining, motion, existing sidebar and shortcut editors |
| Profile | Existing name/avatar/email editor; not a public login |
| Notifications | Existing in-app completion/failure controls; approvals remain visible |
| Code & reviews | Code wrapping and a review-record library |
| Personalization | Instructions included in future live-session context; not a permission grant |
| Route/project labels | Create/edit/archive/restore, groups, colors, label assignment, list filtering, merge with reference updates |
| Route/project statuses | Custom names/colors linked to stable lifecycle categories; in-use statuses cannot be removed or recategorized |
| Templates | Route, project, and chat templates instantiate real content; project templates create milestones; chat templates create notes, never agent runs |
| Collections | Persistent agent groups and profile navigation |
| Presets | Versioned instruction records, explicit application to workspace-owned agent profiles |
| Context packs | Document/memory selection, assembled-text preview and explicit copy; no automatic injection |
| Execution & queue | Ordered work briefs; prepare a session for review, not automatic queue draining |
| Handoffs | Editable handoff briefs, receiving-agent references and manual state tracking |
| Automations | Preview and explicitly apply route-stage rules with stale-preview protection; no scheduler |
| Saved views | Persisted route queries and links to matching work |
| Requests | Triage records with idempotent conversion to a linked route |
| Goals | Project-linked outcomes with progress derived from completed routes |
| Reviews/updates | Editable deliverables, feedback, decisions and project health notes; no automatic approval or publication |
| Emojis | Named Unicode library and clipboard action; no image-emoji upload |
| Workspace/teams/members/documents/agents | Existing editors and space navigation integrated into searchable directories; document and instruction edit history |
| Usage | Recorded session counts, date range, live-versus-simulation filter and daily chart; unknown cost is not displayed as zero |
| Archive/history | Reversible resource archives, revision inspection and change-log export |
| Import/export | Downloadable JSON and validated transactional import into a new workspace; remaps IDs and removes folder access, credentials, execution and personal settings |

## Explicit boundaries and remaining work

- Public login, invitations, enforced member roles, MFA/SSO, authorized third-party applications, API keys/webhooks, payments and billing are **not implemented**. Their pages explain requirements; they do not expose fake enabled switches.
- New Slack/Google identity/other service entries are **planned**. Existing connection adapters remain accessible, but no AI accounts were connected or used in this pass.
- This is still a single-instance prototype. Display preferences and personal instructions use its existing settings store, not multi-user account storage. Execution limits apply to the running instance.
- Team-specific workflow overrides, real-time collaborative editing, background rules, hard spend caps, notification quiet hours/digests, advanced template variables, revision restoration, and context-pack selection in the composer remain future work.
- Saved views now have direct pages, sidebar entries, favorites, and hide/restore controls. Collections are not wired into every agent picker. Handoffs and review decisions are supervised records, not autonomous agent coordination. See `product-expansion-status.md` for the later connected-work additions and remaining gaps.
- The change log is workspace edit history, not a tamper-proof security audit. Import does not replay session history or restore the prior change log.

## Verification

- `npm test`: 155 passing tests, including 12 settings/resource tests.
- `npm run build`: successful production build and Sites packaging.
- `scripts/test-settings-ui.mjs`: isolated Playwright suite with a temporary database and forbidden provider calls. Set `RUMBO_PLAYWRIGHT_MODULE` to an installed Playwright module if it is not a project dependency.
- Browser round 1: all 43 pages render; labels, custom workflow, template use, request conversion, unsaved changes, reload persistence, 320/390px widths and light mode.
- Browser round 2: all 19 resource editors, archive/restore, label merge, rule preview/application, real downloaded export and content import.
- Browser checks assert no console errors and zero agent sessions. They do not prove live-provider behavior or production multi-user security.

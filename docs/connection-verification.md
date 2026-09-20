# Connection verification record

Checkpoint started September 20, 2026. This records evidence, not a claim that a provider is production-ready.

Repository: `/Users/EvanLu/Rumbo`, `master`, `Evan1108-Coder/rumbo`.
Work record: [WEB-12](https://linear.app/rumbo-dev/issue/WEB-12/harden-group-1-connection-authorization-sync-settings-and-illustrated).

## Scope

Group 1 has the fourteen entries below. The existing Linear project has four completion milestones, but the Group 2–4 provider lists are empty and no corresponding registry exists in the repository. Those lists must be recovered or explicitly delegated before claiming all-group coverage. No milestone is complete.

## Evidence levels

Configuration, opening authorization, completing token exchange, verifying account identity, reading a selected resource, and executing an approved write are separate checks. A provider login page is not evidence of a working integration. Fixture tests do not establish live authorization or actual provider acceptance. Reads do not establish write permission.

The running local server's safe catalog endpoint was inspected on September 20. All six workspace OAuth client-ID/client-secret pairs were absent. No secrets were printed or copied. The following live limitations are therefore concrete setup blockers, not a generic requirement to launch publicly.

| Connection | Local evidence | Live workspace status / next prerequisite |
| --- | --- | --- |
| Codex | Official CLI installed; cached Rumbo state connected | No real run or automated account probe performed; repository policy forbids using this account in automated tests |
| Claude Code | Official CLI installed; cached Rumbo state not connected | User-owned CLI sign-in required; no real-account automated tests |
| GitHub | Existing `gh api user` authenticated; Rumbo's explicit existing-account connect returned connected; Rumbo repository read returned HTTP 200 and 24 resources | Machine CLI access works; workspace OAuth requires Rumbo GitHub app credentials and consent; no OAuth resource/write verification |
| GitHub Actions | Adapter and consent fixture coverage | Same GitHub registration; repository Actions permission and approved workflow operation required |
| GitHub Packages | Adapter and consent fixture coverage | Same GitHub registration; package authority including applicable package scope required |
| Google Drive | Adapter and consent fixture coverage | Google registration, enabled Drive API, test-user consent, then selected-file read |
| Google Docs | Adapter and consent fixture coverage | Same Google registration; Docs API and document permissions |
| Google Sheets | Adapter and consent fixture coverage | Same Google registration; Sheets API and spreadsheet permissions |
| Google Slides | Adapter and consent fixture coverage | Same Google registration; Slides API and presentation permissions |
| Linear | Adapter and consent fixture coverage | Rumbo Linear OAuth registration and consent; Codex's separate Linear connection does not register Rumbo |
| Jira Cloud | Adapter and consent fixture coverage | Atlassian 3LO registration, exact callback, authorized site/project |
| Slack | Adapter and consent fixture coverage; HTTP callback explicitly rejected | Slack app registration plus an operator-controlled HTTPS callback path; then installation and channel membership |
| Figma | Adapter and consent fixture coverage | Figma app registration and registered external callback; draft/private eligibility or public app approval as applicable |
| FigJam | Adapter and consent fixture coverage | Same Figma app requirements; explicitly selected board file |

Each workspace connector now exposes exact configuration requirements, requested scopes, registration link, and callback when valid. Account checks are explicit and separate from selected-resource reads. No unauthenticated placeholder URL was opened and counted as a successful OAuth test.

## Local versus public distribution

- GitHub and Linear document loopback OAuth callbacks. Google testing can use registered local callbacks and configured test users. These can be tested before Rumbo launches publicly.
- Google broad Drive scopes can require verification and, depending on how restricted data is handled, a security assessment before general distribution. Test-mode refresh-token expiry is not the same as production readiness.
- Slack requires HTTPS redirect infrastructure; a full public product launch is not the same prerequisite. Merely setting a callback environment variable does not provision a secure callback service.
- Figma draft/private/public app states govern who can authorize. Its current documentation requires an external callback and public apps undergo review.
- Jira owner testing, shared-app distribution, and app approval are distinct. Asking every customer to create an OAuth app or paste an API token is not an appropriate public fallback.
- This local server remains loopback-only. Do not expose it publicly to satisfy callback requirements. Production identity, callback hosting, deployment, and operator registrations need their own secure setup.

## Checkpoint checks

- Automated suite: 409/409 passed, including 17 refresh/concurrency fixtures covering all six OAuth families and Figma/FigJam shared-account races. These are isolated fixtures, not live provider acceptance tests.
- Production build passed. Vite reports an existing main-bundle size warning (741 KB minified).
- Rendered checks passed for desktop and 390px mobile layouts, selected-resource removal, saved Sheets ranges, query-bound pagination, safe action retry states, package ecosystems, explicit identity checks, and illustrated provider guides. No console errors were observed in these checks.
- Figma/FigJam token operations are serialized within one server process. A multi-instance production deployment needs shared coordination; old credentials without account/app/scope provenance require reauthorization before safe sharing.

## Live checks still required

Actual consent/token exchange, live selected-resource reads, live approved writes, real renewal/revocation, organization policies and rate limits remain unverified for the workspace OAuth connections. Operator configuration and user consent must precede those checks. Connection disconnect in Rumbo removes its local credential; it does not claim to revoke a provider-wide grant. No external provider messages, issues, workflow jobs, spreadsheets, slides, or comments were created by this test pass.

See [operator setup](connection-setup.md) and the fourteen in-app provider guides for exact supported operations and limits.

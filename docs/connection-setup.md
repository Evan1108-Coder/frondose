# Connection setup and verification

In-app Docs has an illustrated guide for every one of the 14 catalog entries, plus synchronization, conflicts, recovery, governance and shared review. Registration, opening an authorization website, token exchange, identity verification and a successful resource operation are distinct stages. Do not report one as proof of the next.

## Machine accounts versus workspace connections

Machine accounts belong to installed command-line tools. Codex and Claude Code use their official sign-in flows. The older GitHub CLI/token and metadata-only Drive endpoints remain separate compatibility paths. A machine account is not automatically a workspace-wide platform grant. Never scrape CLI credential files or place their contents in workspace records.

The workspace connection platform (`server/connection-platform.mjs`) encrypts tokens with AES-256-GCM and enforces selected resources, workspace/team/project scope, enabled features, protected-action approval and write idempotency. Operator client secrets remain server-side and credentials are excluded from ordinary workspace exports. Legacy machine-connection storage has a different security model; do not describe all account storage as encrypted workspace OAuth storage.

| OAuth family | Workspace entries | Environment prefix |
| --- | --- | --- |
| GitHub | GitHub, Actions, Packages | `RUMBO_GITHUB` |
| Google | Drive, Docs, Sheets, Slides | `RUMBO_GOOGLE` |
| Linear | Linear | `RUMBO_LINEAR` |
| Atlassian | Jira | `RUMBO_JIRA` |
| Slack | Slack | `RUMBO_SLACK` |
| Figma | Figma, FigJam | `RUMBO_FIGMA` |

Configure each prefix's `_CLIENT_ID` and `_CLIENT_SECRET` outside Git. Never use `VITE_` for secrets: those values can enter browser bundles. Set `RUMBO_CONNECTION_CALLBACK_URL` to the exact provider-registered callback. Its default is `http://127.0.0.1:4174/api/connection-platform/oauth/callback`, which is **not accepted by every provider**. Inspect readiness and scopes before opening authorization. Do not expose an unprotected development server to make redirects work.

## Registration and local testing

### GitHub, Actions and Packages

Register Rumbo's OAuth app and callback. GitHub supports loopback development redirects; public launch is not required. Organization restrictions, SSO and repository permissions still apply. Existing CLI sign-in remains a machine-account alternative, not automatic workspace OAuth. See [GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

GitHub reads selected repository issues, pull requests, commits and source, and supports explicit issue/pull creation, comments and reviews. Actions reads workflow/run/job references and supports reviewed dispatch, rerun and cancellation. Packages reads package metadata and active versions: choose an ecosystem/package name and expect repository-linked results, not every package owned by an organization. Package metadata documents OAuth/classic tokens with `read:packages`; do not assume all fine-grained tokens support it. See [workflow endpoints](https://docs.github.com/en/rest/actions/workflows) and [package endpoints](https://docs.github.com/en/rest/packages/packages).

### Google Drive, Docs, Sheets and Slides

Create Google's OAuth client/consent screen, enable Drive discovery and each product API, and add development test users. Registered localhost callbacks work before public launch. External testing refresh tokens for these scopes expire after seven days. Broad Drive read/metadata scopes are restricted: public verification and, for server storage/transmission, a security assessment can apply. Narrow `drive.file` access needs a matching explicit-file-selection workflow; it cannot silently replace broad discovery. See [web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [token lifetime](https://developers.google.com/identity/protocols/oauth2) and [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Drive reads selected-item metadata or immediate folder children, not arbitrary file bodies or recursive folders. Docs reads structure and supports create/append. Sheets reads an exact bounded A1 range (default `A1:Z200`, maximum 20,000 cells), creates workbooks, appends rows and updates reviewed cell ranges with RAW values. Slides reads presentation structure, creates presentations, and adds blank or title-and-body text slides. These are not complete editor replacements; read ranges and write destinations are separate. Queued jobs snapshot their read options rather than adopting later setting changes.

### Linear

Register a Rumbo OAuth app with its callback; localhost development is documented. OAuth access/refresh tokens expire and rotate. Select external Linear teams separately from Rumbo visibility scope. Read issues/projects and explicitly create/update/comment. Native imports retain provenance and conflicts but are not unrestricted two-way sync. See [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication).

### Jira Cloud

Register the operator-owned Atlassian 3LO app and exact callback. New apps are creator-private until sharing is enabled; unapproved shared apps show a warning. Discover sites, then projects, preserving the `site ID:project key` identity. Read transitions for a scoped issue and apply an available transition explicitly; stale transitions or those needing additional fields are rejected. Required custom fields can exceed the adapter's create-issue fields. Do not collect customer API tokens or require customers to register personal 3LO apps as a public fallback: Atlassian disallows those patterns. See [Atlassian 3LO requirements](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/).

### Slack

Register the app's bot scopes and an **HTTPS** OAuth callback. Ordinary HTTP localhost is invalid. An accepted HTTPS development endpoint and test workspace can support testing before launch without exposing an unprotected Rumbo server. Invite the bot to selected channels; personal visibility is not bot membership. See [OAuth installation](https://docs.slack.dev/authentication/installing-with-oauth/).

Read selected channel Messages or a Thread using its parent message timestamp (`thread_ts`), then send reviewed channel/thread messages separately. Both read kinds request 15 messages per page and use cursor pagination. Bot tokens need the appropriate public/private channel history scopes and membership; this connection does not assume personal-user visibility. New commercially distributed non-Marketplace apps can be limited to one request per minute for both history and replies. Honor retry timing. Signed events need separate operator webhook configuration. See [history limits](https://docs.slack.dev/reference/methods/conversations.history/) and [thread replies/scopes](https://docs.slack.dev/reference/methods/conversations.replies/).

### Figma and FigJam

Configure the operator's Figma OAuth app. Draft supports creator/admin tests, private publication supports its associated organization/team, and public OAuth publication requires Figma review. Use a provider-accepted callback rather than assuming a universal localhost exception. Select files/boards by URL or `file:key`; universal team/project enumeration is not available to public OAuth apps. See [Figma OAuth](https://developers.figma.com/docs/rest-api/oauth-apps/).

Read file information, comments, versions or up to 50 explicitly selected nodes. File/node reads can be pinned to a version ID. Explicit comments are supported; arbitrary node/board editing is not. Figma keeps one access token per app/user; refresh invalidates an older token, so independently held Figma/FigJam grants can require reconnection. Personal tokens are documented for personal tooling, not a replacement for Rumbo's public app review. See [authentication alternatives](https://developers.figma.com/docs/rest-api/authentication/).

## Codex and Claude Code

Install the official runner on the server machine and let it own sign-in. Codex supports ChatGPT and API-key authentication, with distinct billing/policy boundaries. Keep local execution out of untrusted public environments. See [Codex authentication](https://learn.chatgpt.com/docs/auth).

Claude uses its unmodified CLI and provider-owned authentication. Rumbo's adapter is restricted file-read/search analysis, not general editing or shell execution. Unsupported restrictions fail visibly. Never collect/intermediate Claude.ai session tokens; users use their own authorized credentials. See [Claude authentication](https://code.claude.com/docs/en/authentication) and [credential/hosting rules](https://code.claude.com/docs/en/legal-and-compliance).

Runs start explicitly. General chat can run without a project folder; file access requires a chosen folder. Stop does not undo completed edits. Shared review records observed changes on supported runs, not sole agent authorship. Preparing a follow-up is a draft, not a new run.

## Verification checklist

1. Confirm registration, callback scheme/path, enabled APIs and scopes without exposing secrets.
2. Record whether authorization opens; separately test cancellation, expiry, state mismatch and replay.
3. Complete consent only with an authorized test account. Verify token exchange and actual identity.
4. Select a disposable resource, read it, verify source identity and payload, and check pagination/bounds.
5. Test denied resources and roles: provider permissions, selected resources and Rumbo permissions must all apply.
6. Test writes only on explicitly approved disposable targets; verify the provider-side result. Never blindly retry uncertain delivery.
7. Verify refresh, revoked access, reconnect and disconnect. Keep tokens out of logs, browser errors and exports.
8. Record fixture tests separately from live-provider checks. Automated tests must not invoke real Codex/Claude accounts or paid runs.

Without configured operator apps and user consent, fixture tests validate contracts but cannot certify real login. Report missing registration, callback infrastructure, provider review and account permissions separately; most are not inherently blocked on Rumbo's public launch.

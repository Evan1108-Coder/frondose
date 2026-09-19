# Connection platform operator notes

This module performs real provider API requests when its OAuth application is configured. Tests inject an HTTP transport; no test connects an actual account.

## Configuration

Configure server-side `RUMBO_{FAMILY}_CLIENT_ID` and `RUMBO_{FAMILY}_CLIENT_SECRET`, where FAMILY is `GITHUB`, `GOOGLE`, `LINEAR`, `JIRA`, `SLACK`, or `FIGMA`. Register `RUMBO_CONNECTION_CALLBACK_URL` exactly with each provider. The development default is `http://127.0.0.1:4174/api/connection-platform/oauth/callback`. Production must use HTTPS. Values never belong in frontend environment variables.

`RUMBO_CONNECTION_ENCRYPTION_KEY` is an optional base64-encoded 32-byte AES-256 key. Without it the local service creates a mode-0600 `connections.key` in its private data directory. Tokens are AES-GCM encrypted in a separate database table, authenticated against their connection ID, excluded from catalog and connection responses. The local key file is development storage, not a hosted vault or OS keychain. A hosted operator must supply and back up a protected key separately from database backups. Losing it requires reconnecting accounts.

Codex and Claude continue through the established runner/account system. Their catalog entries open that system and do not create fictitious OAuth connections.

## Provider behavior

| Provider | Read/sync | Writes |
| --- | --- | --- |
| GitHub | repositories, issues, pull requests, commits, repository tree/text files, branches, comparisons | issue creation, comments, pull request creation |
| GitHub Actions | workflow runs and definitions | dispatch workflows, cancel runs |
| GitHub Packages | packages linked to a selected repository, selected ecosystem | none |
| Google Drive | file discovery and metadata | create folder |
| Google Docs | document content including tabs | create document, append text |
| Google Sheets | bounded workbook cell range | create spreadsheet, append RAW values |
| Google Slides | presentation content | create presentation, add blank slide |
| Linear | teams, issues, projects | create/update issue, comment |
| Jira | accessible sites/projects, issues via enhanced JQL search | create issue, comment |
| Slack | app-member channels and messages | send message or thread reply |
| Figma/FigJam | explicitly selected file URL/key, bounded file tree, comments, versions | comment |

Public Figma OAuth apps cannot enumerate team folders; explicit file URLs avoid that unsupported capability. Arbitrary Figma canvas editing requires a plugin/MCP integration, not these REST endpoints. GitHub uses OAuth app authorization; GitHub App installation is not implemented here. Google product-specific scopes permit edits to authorized documents, spreadsheets and presentations; Drive discovery requests read access while file creation uses `drive.file`.

All adapters use fixed official hosts, reject redirects, cap responses at 8 MB, and emit sanitized errors. Selected resource scope and enabled features gate operations. Provider errors are never substituted with sample data.

## Native imports and conflicts

Cached objects retain provider, external ID, resource, source URL, provider update time and sync time. Import can create a native Route, project or scoped document. The mapping preserves its target ID across imports. Only title and text fields are synchronized; external statuses, users and custom fields are not guessed. Local edits plus external changes produce a conflict. Resolution checks the exact local hash before applying. Remote deletion never deletes native Rumbo work. Source deletions are not automatically reconciled; cached objects remain historical snapshots until removed.

`sync_mode=link` stores metadata and provenance without a content body. `sync_mode=cache` persists the bounded provider response. Neither mode claims full two-way synchronization. Provider writes are explicit actions; externally uncertain write results are never automatically retried.

Disconnect retains cached history by default. Clearing it requires `connections.delete_cache`, an exact protected approval, and a stable request idempotency key. Pending purges leave credentials and cached objects intact. The approved purge removes usable credentials and cached provenance/mapping records atomically; native Rumbo Routes, projects and documents remain. Approval binds the connection revision so a changed connection requires a new request.

## Scheduled sync and webhooks

The durable SQLite queue processes one job per worker tick while the Rumbo server is running. Failed reads retry up to five times with exponential delay. Pending reads resume after restart. The explicit reconciliation policy can run every 5, 15, 30, 60, 360 or 1440 minutes. A disabled server does not run background jobs. Enabling automatic native updates refreshes only existing imports and preserves conflict checks.

For signed webhook intake configure `RUMBO_GITHUB_WEBHOOK_SECRET`, `RUMBO_LINEAR_WEBHOOK_SECRET`, or `RUMBO_SLACK_WEBHOOK_SECRET`, then enable that connection's webhook policy. Use its returned webhook URL in the provider. Webhook subscription creation in provider consoles is not automated. Other providers use scheduled/manual reconciliation.

Only `/api/connection-platform/webhooks/:id` may bypass normal session/CSRF handling. Pass untouched UTF-8 body and request headers to the platform handler. GitHub HMAC-SHA256, Linear HMAC plus fresh webhook timestamp, and Slack v0 timestamped signatures are verified before JSON data is acted on. Deliveries are deduplicated; events enqueue reads of selected resources. The actor who enabled the policy is reauthorized on each job, so revoked access stops work.

## Authorization integration

The constructor requires `authorize({actor,workspace_id,permission,scope_type,scope_id,connection_id})`. It must throw or return `false`/`{allowed:false}` on denial. Actor identity comes from the authenticated server session, never request JSON. Job actor references must be resolved against current membership by this callback.

`requireApproval({actor,connection,action,input,risk,idempotency_key})` must return `true` or `{approved:true}` only for a persisted approval of this exact operation. Otherwise it returns a proposal. Browser-provided approval flags are ignored. Permission, feature and resource checks run again after approval. Action idempotency binds the actor, action and input. The host must make approval consumption and execution ownership consistent to avoid multiple approvers starting duplicate effects.

Agent delegation is off by default (`agent_access:false`, `allowed_agent_ids:[]`). Enabling it requires connection-management permission and an explicit active agent allowlist. `agentContext(workspaceId,agentId,sponsor)` returns only selected resource context and action schemas permitted for the current sponsor. `executeForAgent(id,body,{agent_id,sponsor})` rechecks the grant and current agent status, executes under the sponsor's current authority, and records both identities. The application should invoke this from its reviewed agent-action bridge, never accept a browser-provided sponsor identity or provider-returned approval.

## API references checked during implementation

- [GitHub OAuth authorization and PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub webhook verification](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Google OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication)
- [Linear GraphQL](https://linear.app/developers/graphql)
- [Linear webhooks](https://linear.app/developers/webhooks)
- [Atlassian OAuth](https://developer.atlassian.com/cloud/jira/software/oauth-2-3lo-apps/)
- [Jira REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)
- [Slack OAuth token exchange](https://api.slack.com/methods/oauth.v2.access)
- [Slack request verification](https://api.slack.com/docs/verifying-requests-from-slack)
- [Figma OAuth](https://developers.figma.com/docs/rest-api/oauth-apps/)
- [Figma public OAuth folder restriction](https://developers.figma.com/docs/rest-api/folders-endpoints/)

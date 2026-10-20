# AI connections: implemented paths and setup

Frondose distinguishes a provider account from an agent profile. One account can serve multiple profiles, but an agent's instructions, context, tools and run approvals are separate. Browser-account credentials belong to the current user and workspace; a shared profile never grants another user that account. The local development server remains loopback-only. The explicit public server mode below is a separate, invite-only deployment path, not permission to expose Vite or reuse operator CLI accounts.

| Provider | End-user route | Frondose state | Who pays for model usage |
| --- | --- | --- | --- |
| OpenRouter | Browser PKCE or API key | Encrypted credentials, catalog/test, reviewed conversations and scheduled messages, final-reply action proposals | User's OpenRouter credits |
| Hugging Face Inference | OAuth with `inference-api` after operator registration, or personal API token with Inference Providers permission | Encrypted credentials, catalog/test, reviewed conversations and scheduled messages, final-reply action proposals; API token works without OAuth app setup | User's Hugging Face allowance/credits |
| GitHub Copilot | GitHub OAuth + official server SDK; local ACP alternative | Implemented: encrypted per-user OAuth, refresh, isolated SDK runtime, explicit model test, reviewed streaming chat, scheduled messages and pending actions. App registration and live verification remain | User's eligible Copilot access/limits |
| Codex and Claude Code | Existing locally signed-in runner | Implemented for local machine only, not a hosted visitor OAuth account | User's existing provider account, subject to its terms/limits |
| OpenAI, Anthropic, Gemini, xAI, Mistral, DeepSeek, Groq, Together, Fireworks, Cohere, Perplexity, Moonshot/Kimi, Alibaba/Qwen, Z.ai/GLM | Personal API key | Implemented with model discovery/configuration, explicit inference test, reviewed conversations, scheduled messages and final-reply action proposals | API key owner |

## Public browser connections: operator setup (October 18)

The public connection implementations do not require the developer to own every provider subscription. Each signed-in Frondose user supplies their own authorization and model allowance. **Implemented does not mean live-certified**: provider contracts, isolated HTTP/chat/action/scheduling flows and browser controls are tested without real accounts. Actual app approval, real OAuth callbacks and paid inference still need account-owner verification on the chosen domain.

| Route | What the Frondose operator must do | What each user needs |
| --- | --- | --- |
| OpenRouter browser authorization | No Frondose OAuth app registration; configure the exact public origin and route `/api/ai-connections/openrouter/callback/<attempt>` to the backend | OpenRouter account and any required credits |
| Hugging Face OAuth | Create an app at [Applications](https://huggingface.co/settings/applications), register `https://YOUR_DOMAIN/api/ai-connections/huggingface/callback`, enable `openid profile inference-api`, set `FRONDOSE_HF_CLIENT_ID` and optional confidential-client `FRONDOSE_HF_CLIENT_SECRET` | Hugging Face account with inference access/allowance |
| GitHub Copilot OAuth | Register a GitHub App or OAuth App, homepage `https://YOUR_DOMAIN`, callback `https://YOUR_DOMAIN/api/ai-connections/copilot/callback`; set `FRONDOSE_GITHUB_CLIENT_ID` and `FRONDOSE_GITHUB_CLIENT_SECRET` | GitHub account **with active eligible Copilot access**; GitHub membership alone does not provide inference |
| All 16 API-key routes | No Frondose OAuth registration; run the encrypted backend and configure billing/retention notices | Personal provider key, permitted model IDs, credits and any required region/workspace settings |
| Hosted ChatGPT-plan login | Apply through [OpenAI’s Sign in with ChatGPT interest form](https://openai.com/form/sign-in-with-chatgpt-interest/); remote/paid hosting requires OpenAI’s approval path | Eligible ChatGPT plan after approval/integration; meanwhile use the separate OpenAI API route |
| Hosted Claude subscription login | Not offered without Anthropic approval; the [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) restricts third-party claude.ai login offerings | Use a personal Anthropic API key instead; a Claude subscription is not API credit |

For GitHub, follow the [official Copilot SaaS OAuth guide](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth). OAuth Apps are the simpler registration; GitHub Apps are recommended by GitHub for finer permissions. Use user authorization, not an installation token or the operator’s token. Frondose requests `read:user offline_access` for OAuth Apps and no repository scope. For GitHub Apps, configure the provider-required user permissions and expiring user tokens in the registration; OAuth scopes do not override App permissions. Organization restrictions can still block a user. Frondose’s GitHub Plugin remains paused and unrelated. Revoke grants through GitHub’s account settings when needed; Disconnect deletes Frondose’s stored credential and cancels owned work, but does not revoke the provider grant remotely.

GitHub sign-in uses actor/workspace-bound ten-minute one-use state and S256 PKCE. The server exchanges the code, confirms the GitHub account, and encrypts access/refresh tokens. Refresh uses a compare-and-swap against the current credential; disconnected/replaced accounts cannot be resurrected. Authorization stores `configured`; only an explicitly requested, complete model reply enables `connected`. No subscription check is faked. A user without Copilot can use the other API connections instead.

The pinned official `@github/copilot-sdk` runtime is a backend dependency, not a CLI each visitor must install. Every operation has a fresh private temporary home, explicit user token and `useLoggedInUser: false`, empty mode and no native/file/shell/MCP tools, skills or project discovery. No operator shell credential is inherited. Model catalogs are explicit; reviewed sends and scheduled prompts use the same canonical context/run/action ledger. Each turn starts a fresh session rather than retaining hidden provider history. SDK clients are stopped on completion/cancellation; uncertain prompts are never replayed. Limits are two concurrent operations per user/workspace and eight per backend process. This is logical application isolation, **not an OS sandbox or a completed multi-tenant security audit**. Account billing/usage metering remains incomplete.

### Running the backend on a public origin

This adds a production asset/API entry point (`npm start`) and a guarded **invite-only beta mode**, not an actual hosted deployment. The existing Sites artifact is still a static preview and does not run this backend. Vite must never be exposed publicly. Use one persistent Node backend on a supported runtime (`^22.16` or `>=24`), behind an HTTPS reverse proxy, with private writable database storage. Multiple replicas/shared SQLite and zero-trust tenant workers are not implemented.

1. On the intended server, build with `npm ci` and `npm run build`. Use a **new, private** data directory, not a public asset directory or an export of the developer’s workspace/accounts.
2. With that data directory and stable encryption key configured, start in `FRONDOSE_DEPLOYMENT_MODE=local` on loopback. Access it through a trusted local connection/SSH tunnel, create the intended workspace and complete **Set up your account**. Stop the backend. Public mode refuses to start without this password identity; no anonymous development-owner fallback is allowed. Invitations use existing membership controls and manually shared invitation links, not email delivery. There is no self-signup or password recovery service yet.
3. Keep server-only settings in a protected environment file outside the repo; never use a `VITE_` prefix for secrets:

   ```dotenv
   FRONDOSE_DEPLOYMENT_MODE=public
   FRONDOSE_PUBLIC_BASE_URL=https://YOUR_DOMAIN
   FRONDOSE_TRUST_LOOPBACK_PROXY=1
   FRONDOSE_DATA_DIR=/srv/frondose/private-data
   FRONDOSE_CONNECTION_ENCRYPTION_KEY=<stable base64 encoding of exactly 32 random bytes>
   FRONDOSE_GITHUB_CLIENT_ID=<registered app client ID>
   FRONDOSE_GITHUB_CLIENT_SECRET=<registered app secret>
   FRONDOSE_HF_CLIENT_ID=<registered HF app client ID>
   # FRONDOSE_HF_CLIENT_SECRET=<only for confidential clients>
   PORT=4174
   ```

   Generate the encryption key in your own secret manager. Back it up separately from encrypted data and reuse it across restarts; losing/changing it makes saved credentials unreadable. Never send it in chat or commit it. To migrate existing local encrypted data, securely retain its existing `connections.key` as the same base64 secret; do not generate a replacement and assume old credentials will decrypt.
4. Start with the environment loaded, for example `node --env-file=/srv/frondose/server.env server/start.mjs`. `npm start` uses the process environment; it does not load Vite’s `.env.local`. The backend listens only on `127.0.0.1:4174`. Configure a same-machine TLS reverse proxy to forward **all** paths to it. Preserve the configured public `Host`, overwrite `X-Forwarded-Proto` with `https` and overwrite `X-Forwarded-For` with a single verified client IP; never trust a visitor-supplied forwarded header. Set TLS/HSTS, request/concurrency limits and access-log query redaction at the proxy. Do not expose its loopback port directly. An external proxy needs a separate explicitly reviewed trust configuration, not a wildcard bypass.
5. Public API requests require the exact HTTPS host and same-origin mutations. Login/accept attempts are rate-limited and cookies are HttpOnly, SameSite=Lax and Secure. Workbench host files/PTYs, change reviews and shared CLI account-management endpoints are disabled. Browser/API model execution cannot fall back to machine Codex/Claude accounts. Non-AI Plugins stay paused.
6. Register exact callback URLs, restart with provider configuration, and verify with a willing non-production account: sign in, authorize, load a catalog, explicitly test one model, inspect/send one chat, check a proposal stays pending, disconnect and confirm a second user cannot use the first user’s connection. Test denial, expired login, provider revocation and proxy headers. Opening a page must not spend credits.

Before an unrestricted public launch, finish provider live verification, independent security review, hardened tenant workers if native tools are added, recovery/abuse controls, monitoring, backups/restore drills, retention/privacy notices and load tests. These are release gates, not tasks app registration silently completes. Public mode is not enabled on Evan’s current localhost.

### What Paseo does—and what is still not built here

[Paseo’s supported-provider list](https://github.com/getpaseo/paseo/blob/main/public-docs/supported-providers.md) lists coding-agent transports such as Codex, Claude, OpenCode, Pi, Antigravity and Muse plus ACP agents. That is not a catalog of universally available browser OAuth model APIs. Frondose borrows the browser → server → isolated runtime pattern, while keeping its own reviewed context, scheduling and pending-action permissions.

OpenCode/Pi/OMP/Muse, Cursor/Kimi and other generic ACP adapters, personal remote-runner pairing, persistent native history import/resume and approved hosted ChatGPT/Claude subscription login remain unimplemented. They must not be advertised as working public connections. Antigravity’s documented full-access-only mode is unsuitable for a shared public host. API access to their underlying model families already uses the separate provider catalog; it does not make those agent runtimes interchangeable.

### Hosted verification evidence

No public domain has been selected yet. Keep `FRONDOSE_PUBLIC_BASE_URL` configurable; no domain is required to continue isolated implementation or protocol testing. Production callback registration, HTTPS deployment and real-account verification remain blocked until a domain/host and the relevant operator app registrations are available. API-key routes do not need an operator OAuth app, but live inference still needs the key owner’s explicit test and usable allowance. Never send secrets in chat.

OpenRouter/Hugging Face callbacks now claim state before exchanging a code, preventing duplicate exchanges. Disconnect, replacing a key, starting a newer sign-in, revoking access or shutting down the service invalidates an in-flight callback; a late response cannot restore authorization. Hugging Face binds new attempts and credentials to the configured app ID; older pending attempts require restarting sign-in. Existing saved credentials remain readable.

Across all 16 API routes, disconnect/replacement/service shutdown aborts the owned active requests. Credentials and current workspace authority are rechecked before accepting a reply or recording a model test, and a disconnect during catalog discovery prevents a subsequent inference test using the old key. Late provider replies are suppressed, not retried or treated as permission to apply actions. Aborting locally cannot guarantee that the provider has not already accepted or billed a request; it does not undo completed work or revoke the remote grant. `tests/ai-connection-races.test.mjs` exercises these races using isolated fake transports, not live accounts.

`tests/copilot-hosted.test.mjs` covers PKCE/identity/origin/replay/denial, encrypted persistence, refresh concurrency, disconnect races, exact-prompt SDK execution, zero native tools, secret redaction, delayed startup, late timeout replies and current-credential checks. `tests/public-ai-deployment.test.mjs` covers fail-closed configuration, HTTPS/proxy/Origin guards, Secure sessions, public callback/model-test/chat/action/scheduling integration and static-file containment. Provider traffic and SDK inference are fixtures, not real paid-account verification. Browser smoke testing covers catalog → details → missing registration/authorized state → explicit model test and disconnect, including mobile layout.

The actual pinned SDK runtime also completed `start` and `ping` in a temporary empty home with a deliberately invalid fixture token and blocked outbound proxy. No model prompt, real credential or provider allowance was used. This verifies installed binary compatibility, not GitHub sign-in or inference entitlement.

## API-key usage

There are 16 API providers in the shared catalog, plus Codex/Claude local runners and Copilot's local ACP route. Choose **AI connections → provider → Add API key**. The password field is excluded from Field Defaults. A key is kept only in encrypted server storage, bound to actor and Frondose workspace. Keys never enter profiles or workspace exports. One connection method is active per provider, actor and workspace; replacing it resets the prior test and cancels pending OAuth. Existing OAuth credentials remain compatible.

Saving makes no network request and records `configured`, not `connected`. **Test a model** loads the catalog (or configured IDs) and asks explicitly before potentially billed inference. Only a complete, nonempty model reply marks an API-key connection connected. A catalog check alone never does. A configured model ID is not proof of access. A successfully tested key can be used from Frondose or agent profiles with an explicit model. The ordinary exact-context review, current-account checks, cancellation, bounded responses and pending-action review still apply. API providers currently return a final text reply rather than streaming tokens or running native/file tools.

| Provider | Wire protocol | Catalog/configuration |
| --- | --- | --- |
| OpenRouter | Chat completions | User-filtered models |
| Hugging Face | Router chat completions | Router models; personal inference token |
| OpenAI | Responses | Models API |
| Anthropic | Messages | Models API |
| Gemini | Generate Content | Models supporting `generateContent`; thought text excluded |
| xAI, Mistral, DeepSeek, Groq | Chat completions | Provider models API |
| Together | Chat completions | Native array catalog, filtered to chat models |
| Fireworks | Chat completions | Enter model/deployment IDs from Fireworks |
| Cohere | v2 Chat | v1 model listing, filtered to nondeprecated chat models |
| Perplexity | Agent API | Enter Agent API model IDs; legacy Sonar names are not Agent API IDs |
| Moonshot/Kimi | Chat completions | Models API; Global/China endpoint selection |
| Alibaba/Qwen | Chat completions | Enter model IDs, region and the provider workspace ID from Model Studio's endpoint |
| Z.ai/GLM | Chat completions | Enter API model IDs; Global/BigModel region selection |

Endpoints are built from an allowlisted provider/region registry, never an arbitrary caller URL. Provider errors are sanitized; credentials are redacted from callbacks. Replacing/disconnecting a key before dispatch prevents the old credential from being sent. Rotation during a model test cannot certify the replacement key. Stop/timeout settles a run once; uncertain inference is not automatically retried.

`tests/model-api-connections.test.mjs` verifies all 16 providers with isolated databases and injected, provider-shaped HTTP responses, including full HTTP → profile → reviewed chat → run → pending-action flows, and native OpenAI scheduled execution. Additional tests cover malformed credentials, region/hostname injection, incomplete replies, failed authorization, key replacement and OAuth cancellation. These are contract/integration tests, **not live paid-account verification**. No real provider credential was used for this implementation; the explicit in-app test is still required for each person's actual account/model.

## Non-API AI connection inventory

| Connection | Current status / next work |
| --- | --- |
| Codex local runner | Existing CLI plus opt-in stdio app-server transport with streamed events, bounded ephemeral threads, cancellation and denied interactive approvals; opaque native-thread resume is intentionally not used |
| Claude local runner | Existing restricted CLI analysis; session-aware Agent SDK adapter remains to implement, subject to provider authentication/branding requirements |
| OpenRouter browser authorization | Existing PKCE flow; live-account verification remains |
| Hugging Face browser authorization | Existing OAuth flow; operator app registration and live-account verification remain |
| GitHub Copilot browser authorization | Implemented GitHub App/OAuth App code flow and per-user official SDK runtime; operator registration and live verification required |
| GitHub Copilot local ACP | Implemented device sign-in, ACP handshake/model discovery, explicit verification, reviewed streaming chat/scheduling, scoped account homes and cancellation; real-account inference still needs user verification |
| OpenCode | Planned runtime adapter; not implemented |
| Pi | Planned RPC adapter; not implemented |
| OMP | Planned RPC adapter; not implemented |
| Antigravity | Planned CLI/plugin adapter; not implemented |
| Muse Code | Planned MSP adapter; not implemented |
| Other ACP agents, including Cursor/Kimi | Future generic ACP adapter plus individual compatibility/auth tests; not implemented |
| ChatGPT-plan OAuth | Separate eligibility-dependent path; not implemented or registered for Frondose. Official docs distinguish OSS/local use from paid/remote hosting. |

These planned adapters do not appear as working connections. API access to a model family does not install its coding-agent runtime. Paseo's provider architecture is a reference, not evidence that an unimplemented Frondose adapter works. See [Paseo providers](https://github.com/getpaseo/paseo/blob/main/docs/providers.md), [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), and [Copilot ACP](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server).

Non-AI connections remain called **Plugins** and remain paused: GitHub, GitHub Actions, GitHub Packages, Google Drive, Google Docs, Google Sheets, Google Slides, Linear, Jira, Slack, Figma and FigJam. Their stored catalog/adapters do not mean authorization or actions are released. This API-key change does not enable them.

OpenRouter's user authorization requires no operator API key. The user chooses **Connect OpenRouter**, signs in at OpenRouter, and is returned to Frondose. Frondose binds the ten-minute attempt to the current signed-in actor, workspace and callback origin. It stores the returned key encrypted and checks `/api/v1/key`. **Check authorization** makes a read-only provider request. **Choose model to test** loads the user-filtered catalog; **Send test request** makes a separate small inference call that can cost credits. Reviewed conversation sends and scheduled agent prompts also make potentially billed inference calls. Removing the connection deletes Frondose's copy; users who want remote invalidation must revoke that key at OpenRouter.

The operator prerequisites and public beta deployment procedure are documented above. Local ACP and shared Codex/Claude machine accounts remain local-only; their existence does not satisfy public-provider authorization or live verification.

## Copilot local account: browser-first setup

1. Install official GitHub Copilot CLI on the machine running Frondose (`npm install -g @github/copilot`). This is not the retired `gh copilot` extension. Frondose itself never downloads or installs a runtime automatically.
2. Open **AI connections → GitHub Copilot**. Choose **Sign in with GitHub**. Copy the one-time code shown by the CLI into the official GitHub device sign-in page linked there. Frondose polls only its local sign-in state; opening the catalog never starts login or a model request.
3. Choose **Check local runtime** to negotiate ACP v1 and create an empty native session. This checks protocol/auth readiness but does not send a prompt or certify a model.
4. Choose **Choose a model to test**. Select a runtime-advertised model, or Provider default if none is advertised, and explicitly send the short test. A complete, nonempty inference response is required before Frondose marks the connection connected. Your Copilot allowance may be used.
5. In Frondose or a Copilot agent profile, use General chat, inspect context and send. Text attachments use the existing bounded context compiler. Images are not forwarded as ACP vision content. Scheduled prompts use the same reviewed context and current account.

The server owns stdio ACP; there is no exposed Copilot port. Account directories are under private server storage and keyed by a hash of actor/workspace identity. Frondose does not import another application's GitHub credentials or inherit shell API keys/auto-approval flags. Copilot owns the actual account credential storage (including any OS credential-store behavior). Account homes are logically separated, not separate OS users or a certified multi-tenant sandbox. Never expose this local server publicly.

Tools are disabled at launch, built-in MCP is disabled, filesystem/terminal client capabilities are false, and all incoming permission/capability requests are denied. No generic arbitrary command, arbitrary ACP executable, file bridge, or external Plugin execution endpoint is offered. Private transient working directories keep project configurations out of the session. Configured account files remain provider-owned; disconnect removes Frondose's binding, cancels its work/sign-in, and does not log the provider out globally. Provider-created session/log files may remain in that private directory; workspace JSON exports do not include them.

Model discovery is explicit and supports both legacy ACP model metadata and current model config options. An advertised model is not proof of entitlement. Empty/truncated/error replies fail. Stop, disconnect, timeout, and server shutdown terminate only the owned process group; uncertain prompts are never resent. ACP progress events are streamed into the canonical run ledger; native usage/billing accounting is not yet integrated.

## Codex session bridge

After using the normal Codex runner sign-in, choose **Enable Codex session bridge** on its detail page. This selects `codex app-server --listen stdio://` for future reviewed runs. **Use existing sign-in** in Manage runner selects the original CLI transport again. Neither selection sends an inference prompt. The bridge initializes once, starts an ephemeral native thread with the selected sandbox/never-approve policy, sends the exact reviewed prompt in `turn/start`, handles final items/terminal status, and closes the owned process. Existing inherited-MCP disabling, feature restrictions, validated native Frondose bridge and project permissions remain in force.

Unlike Paseo's general-purpose native-session browser, Frondose intentionally starts a fresh native session for every reviewed turn. The selected conversation history comes from Frondose's permission-checked context compiler. Blindly resuming an old provider thread could retain documents whose current access was revoked or content the user did not inspect. Persistent provider resume, external CLI session import, remote personal-runner pairing, and active-turn steering are not implemented.

### Verification evidence and remaining gates

`tests/local-agent-bridges.test.mjs` covers ACP initialization, model configuration, one-shot inference, HTTP profile/chat/context/run/action/schedule integration, identity isolation, denied tools, Unicode/chunked framing, empty/error replies, absent executables, output limits, cancellation, disconnect races, deadlines and app-server outcomes. All execution fixtures use temporary databases and injected processes. Real Codex/Claude accounts are never used.

Additionally, the installed Codex binary completed initialization, unauthenticated `account/read` and ephemeral `thread/start` with isolated empty HOME/CODEX_HOME; no prompt was sent. Official Copilot CLI **1.0.98**, downloaded only to the npm tool cache for this check, accepted the exact restricted launch arguments, negotiated ACP v1, and rejected `session/new` with the expected “Authentication required” response in an empty isolated account home. This caught and corrected incompatible `--stdio`/wildcard-deny assumptions before release. These binary checks do not certify live sign-in, provider terms, model entitlement, paid inference or tools. To finish live verification, a willing user with eligible access must install/sign in to the desired runtime and use its explicit test or reviewed conversation; the developer's personal account is not required and never powers other users. Hugging Face OAuth still needs operator registration. Anthropic's SDK documentation restricts third-party claude.ai-login offerings without approval; Frondose's existing local-runner path is not a claim of hosted subscription OAuth eligibility.

## Reviewed browser-account execution

OpenRouter and configured Hugging Face profiles can now send reviewed conversation requests, including scheduled agent prompts, through a bounded non-streaming chat-completion adapter. Load the provider catalog explicitly and select a model; execution itself does not secretly check the account or fetch a model list. The provider remains the final authority on model eligibility. Each request forwards the exact compiled Frondose prompt and final-reply action catalog using the current actor's encrypted credential. Workspace actions returned by the model are pending proposals, not permission to mutate data. Applying or scheduling a supported proposal requires explicit human review and the existing target, scope and stale-state checks.

Browser accounts have no native MCP bridge, terminal, project-file tools or project-editing execution. Local Codex/Claude runners remain the separate path for their permitted project work. The API adapter performs one completion request with timeout and cancellation; uncertain delivery is not retried automatically and no fallback account/provider is used. An expired Hugging Face credential can use its existing refresh token, but disconnect or credential replacement during refresh prevents execution. Truncated, empty or malformed final replies fail rather than being used as action proposals.

API usage is not integrated into the existing CLI metering ledger or a billing/allowance service. Missing usage is unknown, not zero. Check the provider for charges and limits. Transport, action-proposal and scheduled-message tests use injected HTTP responses and temporary databases. **No real OpenRouter/Hugging Face account, paid inference or live OAuth compatibility has been verified.** Manual multi-agent Workflows are a separate historical feature; this change does not certify every orchestration surface against browser providers.

## Browser-first conversations and the Paseo pattern

Frondose's browser owns the conversation UI, draft, history, run controls and human review. The local server owns the execution process. A user does not have to type in a CLI to chat, but the current Codex and Claude Code paths still need a signed-in CLI installed **on the machine running the Frondose server**. If Frondose is hosted elsewhere, a visitor's locally installed CLI is not automatically available to that host. This is the same useful separation of browser client and local runner that inspired the Paseo direction, customized here to keep Frondose's workspace context, approval boundary and run provenance.

The agent path records chats, turns, context inspections, runs, events, approvals and explicit retries in Frondose. Local runners start a bounded process; browser accounts send a bounded completion request. Neither path currently resumes a provider-native thread or pairs the browser with a remote personal runner. Browser-provider send, stop, failure and action/schedule permission paths are covered by isolated fixtures, not real-account certification.

Remaining production work includes real-account verification, streaming/resumable output, provider-usage integration, billing transparency and hosted user/runtime isolation. A project-editing agent remains a different mode requiring a trusted runner and folder permissions. Public access additionally needs the production identity and hosting work above; changing the current loopback host check alone is unsafe.

Primary references: [OpenRouter PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth), [OpenRouter chat completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request), [Hugging Face inference router](https://huggingface.co/docs/inference-providers/index), [Hugging Face OAuth scopes](https://huggingface.co/docs/hub/oauth), [GitHub Copilot SaaS OAuth](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth), [GitHub Copilot server deployment](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/backend-services).

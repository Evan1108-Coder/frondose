# AI connections: implemented paths and setup

Rumbo distinguishes a provider account from an agent profile. One account can serve multiple profiles, but an agent's instructions, context, tools and run approvals are separate. Browser-account credentials belong to the current user and workspace; a shared profile never grants another user that account. The local development server is loopback-only and must not be exposed publicly.

| Provider | End-user route | Rumbo state | Who pays for model usage |
| --- | --- | --- | --- |
| OpenRouter | Browser PKCE or API key | Encrypted credentials, catalog/test, reviewed conversations and scheduled messages, final-reply action proposals | User's OpenRouter credits |
| Hugging Face Inference | OAuth with `inference-api` after operator registration, or personal API token with Inference Providers permission | Encrypted credentials, catalog/test, reviewed conversations and scheduled messages, final-reply action proposals; API token works without OAuth app setup | User's Hugging Face allowance/credits |
| GitHub Copilot | Local Copilot CLI device authorization + ACP | Implemented: private actor/workspace account directory, explicit model test, streamed reviewed conversations, scheduled messages and pending Rumbo actions. Hosted GitHub App/SDK OAuth remains unimplemented | User's Copilot subscription/limits |
| Codex and Claude Code | Existing locally signed-in runner | Implemented for local machine only, not a hosted visitor OAuth account | User's existing provider account, subject to its terms/limits |
| OpenAI, Anthropic, Gemini, xAI, Mistral, DeepSeek, Groq, Together, Fireworks, Cohere, Perplexity, Moonshot/Kimi, Alibaba/Qwen, Z.ai/GLM | Personal API key | Implemented with model discovery/configuration, explicit inference test, reviewed conversations, scheduled messages and final-reply action proposals | API key owner |

## API-key setup (October 18)

There are 16 API providers in the shared catalog, plus Codex/Claude local runners and Copilot's local ACP route. Choose **AI connections → provider → Add API key**. The password field is excluded from Field Defaults. A key is kept only in encrypted server storage, bound to actor and Rumbo workspace. Keys never enter profiles or workspace exports. One connection method is active per provider, actor and workspace; replacing it resets the prior test and cancels pending OAuth. Existing OAuth credentials remain compatible.

Saving makes no network request and records `configured`, not `connected`. **Test a model** loads the catalog (or configured IDs) and asks explicitly before potentially billed inference. Only a complete, nonempty model reply marks an API-key connection connected. A catalog check alone never does. A configured model ID is not proof of access. A successfully tested key can be used from Rumbo Agent or agent profiles with an explicit model. The ordinary exact-context review, current-account checks, cancellation, bounded responses and pending-action review still apply. API providers currently return a final text reply rather than streaming tokens or running native/file tools.

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
| GitHub Copilot browser authorization | Planned OAuth/GitHub App plus per-user SDK runtime; not implemented |
| GitHub Copilot local ACP | Implemented device sign-in, ACP handshake/model discovery, explicit verification, reviewed streaming chat/scheduling, scoped account homes and cancellation; real-account inference still needs user verification |
| OpenCode | Planned runtime adapter; not implemented |
| Pi | Planned RPC adapter; not implemented |
| OMP | Planned RPC adapter; not implemented |
| Antigravity | Planned CLI/plugin adapter; not implemented |
| Muse Code | Planned MSP adapter; not implemented |
| Other ACP agents, including Cursor/Kimi | Future generic ACP adapter plus individual compatibility/auth tests; not implemented |
| ChatGPT-plan OAuth | Separate eligibility-dependent path; not implemented or registered for Rumbo. Official docs distinguish OSS/local use from paid/remote hosting. |

These planned adapters do not appear as working connections. API access to a model family does not install its coding-agent runtime. Paseo's provider architecture is a reference, not evidence that an unimplemented Rumbo adapter works. See [Paseo providers](https://github.com/getpaseo/paseo/blob/main/docs/providers.md), [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), and [Copilot ACP](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server).

Non-AI connections remain called **Plugins** and remain paused: GitHub, GitHub Actions, GitHub Packages, Google Drive, Google Docs, Google Sheets, Google Slides, Linear, Jira, Slack, Figma and FigJam. Their stored catalog/adapters do not mean authorization or actions are released. This API-key change does not enable them.

OpenRouter's user authorization requires no operator API key. The user chooses **Connect OpenRouter**, signs in at OpenRouter, and is returned to Rumbo. Rumbo binds the ten-minute attempt to the current signed-in actor, workspace and callback origin. It stores the returned key encrypted and checks `/api/v1/key`. **Check authorization** makes a read-only provider request. **Choose model to test** loads the user-filtered catalog; **Send test request** makes a separate small inference call that can cost credits. Reviewed conversation sends and scheduled agent prompts also make potentially billed inference calls. Removing the connection deletes Rumbo's copy; users who want remote invalidation must revoke that key at OpenRouter.

For public deployment, Rumbo needs a production identity/session service, HTTPS origin and callback routing, secret-key management and isolated provider token storage, production monitoring, and an end-to-end test with an owner-approved non-production account. Set `RUMBO_PUBLIC_BASE_URL` to the exact HTTPS origin after the public server's current loopback-only host policy is replaced by a separately reviewed deployment policy. Do not change the loopback policy merely to make this prototype reachable. Hugging Face additionally needs an OAuth app with the exact `https://<origin>/api/ai-connections/huggingface/callback` redirect and `inference-api` scope; set its client ID as `RUMBO_HF_CLIENT_ID` and, if using a confidential client, its secret as `RUMBO_HF_CLIENT_SECRET` in server-only configuration. The browser never receives this secret. Hosted Copilot OAuth still needs a GitHub OAuth/GitHub App and server-side Copilot SDK runtime. The implemented local ACP route instead uses Copilot CLI's own device authorization, without registering a Rumbo GitHub App.

## Copilot local account: browser-first setup

1. Install official GitHub Copilot CLI on the machine running Rumbo (`npm install -g @github/copilot`). This is not the retired `gh copilot` extension. Rumbo itself never downloads or installs a runtime automatically.
2. Open **AI connections → GitHub Copilot**. Choose **Sign in with GitHub**. Copy the one-time code shown by the CLI into the official GitHub device sign-in page linked there. Rumbo polls only its local sign-in state; opening the catalog never starts login or a model request.
3. Choose **Check local runtime** to negotiate ACP v1 and create an empty native session. This checks protocol/auth readiness but does not send a prompt or certify a model.
4. Choose **Choose a model to test**. Select a runtime-advertised model, or Provider default if none is advertised, and explicitly send the short test. A complete, nonempty inference response is required before Rumbo marks the connection connected. Your Copilot allowance may be used.
5. In Rumbo Agent or a Copilot agent profile, use General chat, inspect context and send. Text attachments use the existing bounded context compiler. Images are not forwarded as ACP vision content. Scheduled prompts use the same reviewed context and current account.

The server owns stdio ACP; there is no exposed Copilot port. Account directories are under private server storage and keyed by a hash of actor/workspace identity. Rumbo does not import another application's GitHub credentials or inherit shell API keys/auto-approval flags. Copilot owns the actual account credential storage (including any OS credential-store behavior). Account homes are logically separated, not separate OS users or a certified multi-tenant sandbox. Never expose this local server publicly.

Tools are disabled at launch, built-in MCP is disabled, filesystem/terminal client capabilities are false, and all incoming permission/capability requests are denied. No generic arbitrary command, arbitrary ACP executable, file bridge, or external Plugin execution endpoint is offered. Private transient working directories keep project configurations out of the session. Configured account files remain provider-owned; disconnect removes Rumbo's binding, cancels its work/sign-in, and does not log the provider out globally. Provider-created session/log files may remain in that private directory; workspace JSON exports do not include them.

Model discovery is explicit and supports both legacy ACP model metadata and current model config options. An advertised model is not proof of entitlement. Empty/truncated/error replies fail. Stop, disconnect, timeout, and server shutdown terminate only the owned process group; uncertain prompts are never resent. ACP progress events are streamed into the canonical run ledger; native usage/billing accounting is not yet integrated.

## Codex session bridge

After using the normal Codex runner sign-in, choose **Enable Codex session bridge** on its detail page. This selects `codex app-server --listen stdio://` for future reviewed runs. **Use existing sign-in** in Manage runner selects the original CLI transport again. Neither selection sends an inference prompt. The bridge initializes once, starts an ephemeral native thread with the selected sandbox/never-approve policy, sends the exact reviewed prompt in `turn/start`, handles final items/terminal status, and closes the owned process. Existing inherited-MCP disabling, feature restrictions, validated native Rumbo bridge and project permissions remain in force.

Unlike Paseo's general-purpose native-session browser, Rumbo intentionally starts a fresh native session for every reviewed turn. The selected conversation history comes from Rumbo's permission-checked context compiler. Blindly resuming an old provider thread could retain documents whose current access was revoked or content the user did not inspect. Persistent provider resume, external CLI session import, remote personal-runner pairing, and active-turn steering are not implemented.

### Verification evidence and remaining gates

`tests/local-agent-bridges.test.mjs` covers ACP initialization, model configuration, one-shot inference, HTTP profile/chat/context/run/action/schedule integration, identity isolation, denied tools, Unicode/chunked framing, empty/error replies, absent executables, output limits, cancellation, disconnect races, deadlines and app-server outcomes. All execution fixtures use temporary databases and injected processes. Real Codex/Claude accounts are never used.

Additionally, the installed Codex binary completed initialization, unauthenticated `account/read` and ephemeral `thread/start` with isolated empty HOME/CODEX_HOME; no prompt was sent. Official Copilot CLI **1.0.98**, downloaded only to the npm tool cache for this check, accepted the exact restricted launch arguments, negotiated ACP v1, and rejected `session/new` with the expected “Authentication required” response in an empty isolated account home. This caught and corrected incompatible `--stdio`/wildcard-deny assumptions before release. These binary checks do not certify live sign-in, provider terms, model entitlement, paid inference or tools. To finish live verification, a willing user with eligible access must install/sign in to the desired runtime and use its explicit test or reviewed conversation; the developer's personal account is not required and never powers other users. Hugging Face OAuth still needs operator registration. Anthropic's SDK documentation restricts third-party claude.ai-login offerings without approval; Rumbo's existing local-runner path is not a claim of hosted subscription OAuth eligibility.

## Reviewed browser-account execution

OpenRouter and configured Hugging Face profiles can now send reviewed conversation requests, including scheduled agent prompts, through a bounded non-streaming chat-completion adapter. Load the provider catalog explicitly and select a model; execution itself does not secretly check the account or fetch a model list. The provider remains the final authority on model eligibility. Each request forwards the exact compiled Rumbo prompt and final-reply action catalog using the current actor's encrypted credential. Workspace actions returned by the model are pending proposals, not permission to mutate data. Applying or scheduling a supported proposal requires explicit human review and the existing target, scope and stale-state checks.

Browser accounts have no native MCP bridge, terminal, project-file tools or project-editing execution. Local Codex/Claude runners remain the separate path for their permitted project work. The API adapter performs one completion request with timeout and cancellation; uncertain delivery is not retried automatically and no fallback account/provider is used. An expired Hugging Face credential can use its existing refresh token, but disconnect or credential replacement during refresh prevents execution. Truncated, empty or malformed final replies fail rather than being used as action proposals.

API usage is not integrated into the existing CLI metering ledger or a billing/allowance service. Missing usage is unknown, not zero. Check the provider for charges and limits. Transport, action-proposal and scheduled-message tests use injected HTTP responses and temporary databases. **No real OpenRouter/Hugging Face account, paid inference or live OAuth compatibility has been verified.** Manual multi-agent Workflows are a separate historical feature; this change does not certify every orchestration surface against browser providers.

## Browser-first conversations and the Paseo pattern

Rumbo's browser owns the conversation UI, draft, history, run controls and human review. The local server owns the execution process. A user does not have to type in a CLI to chat, but the current Codex and Claude Code paths still need a signed-in CLI installed **on the machine running the Rumbo server**. If Rumbo is hosted elsewhere, a visitor's locally installed CLI is not automatically available to that host. This is the same useful separation of browser client and local runner that inspired the Paseo direction, customized here to keep Rumbo's workspace context, approval boundary and run provenance.

The agent path records chats, turns, context inspections, runs, events, approvals and explicit retries in Rumbo. Local runners start a bounded process; browser accounts send a bounded completion request. Neither path currently resumes a provider-native thread or pairs the browser with a remote personal runner. Browser-provider send, stop, failure and action/schedule permission paths are covered by isolated fixtures, not real-account certification.

Remaining production work includes real-account verification, streaming/resumable output, provider-usage integration, billing transparency and hosted user/runtime isolation. A project-editing agent remains a different mode requiring a trusted runner and folder permissions. Public access additionally needs the production identity and hosting work above; changing the current loopback host check alone is unsafe.

Primary references: [OpenRouter PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth), [OpenRouter chat completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request), [Hugging Face inference router](https://huggingface.co/docs/inference-providers/index), [Hugging Face OAuth scopes](https://huggingface.co/docs/hub/oauth), [GitHub Copilot SaaS OAuth](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth), [GitHub Copilot server deployment](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/backend-services).

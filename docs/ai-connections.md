# AI connections: implemented paths and setup

Rumbo distinguishes a provider account from an agent profile. One account can serve multiple profiles, but an agent's instructions, context, tools and run approvals are separate. Browser-account credentials belong to the current user and workspace; a shared profile never grants another user that account. The local development server is loopback-only and must not be exposed publicly.

| Provider | End-user route | Rumbo state | Who pays for model usage |
| --- | --- | --- | --- |
| OpenRouter | Browser PKCE or API key | Encrypted credentials, catalog/test, reviewed conversations and scheduled messages, final-reply action proposals | User's OpenRouter credits |
| Hugging Face Inference | OAuth with `inference-api` after operator registration, or personal API token with Inference Providers permission | Encrypted credentials, catalog/test, reviewed conversations and scheduled messages, final-reply action proposals; API token works without OAuth app setup | User's Hugging Face allowance/credits |
| GitHub Copilot | GitHub OAuth user token to server-side Copilot SDK | Planned; OAuth app, isolated hosted SDK runtime and user-subscription check still needed | User's Copilot subscription/limits |
| Codex and Claude Code | Existing locally signed-in runner | Implemented for local machine only, not a hosted visitor OAuth account | User's existing provider account, subject to its terms/limits |
| OpenAI, Anthropic, Gemini, xAI, Mistral, DeepSeek, Groq, Together, Fireworks, Cohere, Perplexity, Moonshot/Kimi, Alibaba/Qwen, Z.ai/GLM | Personal API key | Implemented with model discovery/configuration, explicit inference test, reviewed conversations, scheduled messages and final-reply action proposals | API key owner |

## API-key setup (October 18)

There are 16 API providers in the shared catalog, plus Codex/Claude local runners and the planned Copilot entry. Choose **AI connections → provider → Add API key**. The password field is excluded from Field Defaults. A key is kept only in encrypted server storage, bound to actor and Rumbo workspace. Keys never enter profiles or workspace exports. One connection method is active per provider, actor and workspace; replacing it resets the prior test and cancels pending OAuth. Existing OAuth credentials remain compatible.

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
| Codex local runner | Existing one-shot CLI; persistent app-server sessions, streaming and resume remain to implement |
| Claude local runner | Existing restricted CLI analysis; session-aware Agent SDK adapter remains to implement, subject to provider authentication/branding requirements |
| OpenRouter browser authorization | Existing PKCE flow; live-account verification remains |
| Hugging Face browser authorization | Existing OAuth flow; operator app registration and live-account verification remain |
| GitHub Copilot browser authorization | Planned OAuth/GitHub App plus per-user SDK runtime; not implemented |
| GitHub Copilot local ACP | Planned Paseo-style runtime adapter; not implemented |
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

For public deployment, Rumbo needs a production identity/session service, HTTPS origin and callback routing, secret-key management and isolated provider token storage, production monitoring, and an end-to-end test with an owner-approved non-production account. Set `RUMBO_PUBLIC_BASE_URL` to the exact HTTPS origin after the public server's current loopback-only host policy is replaced by a separately reviewed deployment policy. Do not change the loopback policy merely to make this prototype reachable. Hugging Face additionally needs an OAuth app with the exact `https://<origin>/api/ai-connections/huggingface/callback` redirect and `inference-api` scope; set its client ID as `RUMBO_HF_CLIENT_ID` and, if using a confidential client, its secret as `RUMBO_HF_CLIENT_SECRET` in server-only configuration. The browser never receives this secret. GitHub Copilot additionally needs a GitHub OAuth/GitHub App and server-side Copilot SDK runtime, with each user having an eligible subscription.

## Reviewed browser-account execution

OpenRouter and configured Hugging Face profiles can now send reviewed conversation requests, including scheduled agent prompts, through a bounded non-streaming chat-completion adapter. Load the provider catalog explicitly and select a model; execution itself does not secretly check the account or fetch a model list. The provider remains the final authority on model eligibility. Each request forwards the exact compiled Rumbo prompt and final-reply action catalog using the current actor's encrypted credential. Workspace actions returned by the model are pending proposals, not permission to mutate data. Applying or scheduling a supported proposal requires explicit human review and the existing target, scope and stale-state checks.

Browser accounts have no native MCP bridge, terminal, project-file tools or project-editing execution. Local Codex/Claude runners remain the separate path for their permitted project work. The API adapter performs one completion request with timeout and cancellation; uncertain delivery is not retried automatically and no fallback account/provider is used. An expired Hugging Face credential can use its existing refresh token, but disconnect or credential replacement during refresh prevents execution. Truncated, empty or malformed final replies fail rather than being used as action proposals.

API usage is not integrated into the existing CLI metering ledger or a billing/allowance service. Missing usage is unknown, not zero. Check the provider for charges and limits. Transport, action-proposal and scheduled-message tests use injected HTTP responses and temporary databases. **No real OpenRouter/Hugging Face account, paid inference or live OAuth compatibility has been verified.** Manual multi-agent Workflows are a separate historical feature; this change does not certify every orchestration surface against browser providers.

## Browser-first conversations and the Paseo pattern

Rumbo's browser owns the conversation UI, draft, history, run controls and human review. The local server owns the execution process. A user does not have to type in a CLI to chat, but the current Codex and Claude Code paths still need a signed-in CLI installed **on the machine running the Rumbo server**. If Rumbo is hosted elsewhere, a visitor's locally installed CLI is not automatically available to that host. This is the same useful separation of browser client and local runner that inspired the Paseo direction, customized here to keep Rumbo's workspace context, approval boundary and run provenance.

The agent path records chats, turns, context inspections, runs, events, approvals and explicit retries in Rumbo. Local runners start a bounded process; browser accounts send a bounded completion request. Neither path currently resumes a provider-native thread or pairs the browser with a remote personal runner. Browser-provider send, stop, failure and action/schedule permission paths are covered by isolated fixtures, not real-account certification.

Remaining production work includes real-account verification, streaming/resumable output, provider-usage integration, billing transparency and hosted user/runtime isolation. A project-editing agent remains a different mode requiring a trusted runner and folder permissions. Public access additionally needs the production identity and hosting work above; changing the current loopback host check alone is unsafe.

Primary references: [OpenRouter PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth), [OpenRouter chat completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request), [Hugging Face inference router](https://huggingface.co/docs/inference-providers/index), [Hugging Face OAuth scopes](https://huggingface.co/docs/hub/oauth), [GitHub Copilot SaaS OAuth](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth), [GitHub Copilot server deployment](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/backend-services).

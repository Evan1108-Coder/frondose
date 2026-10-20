# AI connection launch checklist

Repository and official-documentation audit: October 20, 2026.

This covers Talvori's current **19 provider identities**: 16 API providers,
GitHub Copilot, Codex and Claude Code. It also records the previously identified
Paseo-style runtime gaps. It does not mean every AI service or authentication
method in existence is supported.

**Public users must use their own connections. Evan's CLI login or personal
subscription must never power visitors' requests.** Talvori already implements
the 16 API-key routes and three browser-authorization routes below. Implemented,
configured, successfully tested with a real account, and publicly deployed are
four different milestones. Fixture tests do not establish the last two.

## What Evan needs to provide or arrange

| Item | Exact deliverable | Why it is needed |
| --- | --- | --- |
| Public origin | The final HTTPS origin, DNS control and TLS, such as `https://app.example.com` | Callback registrations and same-origin security use this exact origin. No production domain is recorded yet. |
| Always-on backend | A hosting account/server, deployment access through an approved secure channel, a persistent private volume, HTTPS reverse proxy, and outbound access to the supported providers | The static Sites preview cannot run AI connections or the scheduler. Current production code supports one persistent Node backend, not interchangeable serverless replicas sharing SQLite. |
| Server secrets | A stable secret-manager-backed `TALVORI_CONNECTION_ENCRYPTION_KEY` containing base64-encoded 32 random bytes, retained across deploys and backed up separately | Saved user credentials are encrypted with this key. Never send it in chat or commit it. Losing it makes those credentials unreadable. |
| Hugging Face registration | Create a **Talvori** OAuth app at [HF Applications](https://huggingface.co/settings/applications), register `https://YOUR_DOMAIN/api/ai-connections/huggingface/callback`, allow `openid profile inference-api`, supply `TALVORI_HF_CLIENT_ID`; supply `TALVORI_HF_CLIENT_SECRET` only for a confidential client | The OAuth implementation exists, but it cannot register Talvori on the operator's behalf. A public PKCE client does not require a secret. Exact redirect matching and inference scope are documented by [Hugging Face](https://huggingface.co/docs/hub/oauth). |
| GitHub registration for Copilot | Create a **Talvori** GitHub App or OAuth App, homepage `https://YOUR_DOMAIN`, callback `https://YOUR_DOMAIN/api/ai-connections/copilot/callback`; securely configure `TALVORI_GITHUB_CLIENT_ID` and `TALVORI_GITHUB_CLIENT_SECRET` | GitHub's [SaaS OAuth integration](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth) uses a registered app and each user's authorization. A normal GitHub account is enough to administer the registration; Evan does not need to buy Copilot for all visitors. |
| Hosted ChatGPT-plan permission | Apply through the interest/waitlist link in [OpenAI's official integration guide](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt), obtain approval for Talvori's remotely hosted product and the applicable integration details | This route is not implemented. The open-source/local dynamic-registration flow is not authorization to offer a remotely hosted service. A ChatGPT subscription, API key or domain alone cannot remove this restriction. |
| Hosted Claude-subscription permission | Obtain Anthropic's written approval and supported integration details for offering claude.ai authentication in Talvori | This route is not implemented. Anthropic's [Agent SDK documentation](https://code.claude.com/docs/en/agent-sdk/overview) prohibits third-party products from offering claude.ai login/rate limits without prior approval. The separate Anthropic API route already exists. |
| Real-account acceptance testers | Willing account owners covering each released method, with working allowance and an explicitly approved small testing budget; authorize or enter keys **in Talvori**, not in chat | We can test fake transports independently, but cannot honestly certify actual login, entitlement, inference, billing errors or revocation without live acceptance testing. Testers need not all be Evan. |
| Launch operations | Initial owner account, approved invite-only beta users, hosting region, retention/support details and backup/restore ownership | Public mode requires a provisioned password identity. Open signup, email delivery/recovery, independent security review and production monitoring are not completed just by registering OAuth apps. |

For the current bring-your-own-key model, **no operator API key and no operator
OAuth registration is required for any of the 16 API routes**. Each user supplies
their own key and pays their provider. Operator-funded shared inference would be
a different feature requiring billing, abuse and spend controls; it is not the
current implementation.

App names, logos, homepage and support/privacy links displayed on provider-hosted
consent screens must also be updated in the real HF/GitHub registrations. A code
rebrand cannot edit those account settings.

## Implemented API routes: exact user requirements

All rows below have encrypted per-user/per-workspace key storage, explicit model
testing and reviewed final-text execution in code. **Every row still needs
real-account acceptance evidence before being called live-verified.** Usable
model access, allowance, regional availability and organization policy remain
provider-controlled; a model appearing in a catalog does not prove entitlement.

| Provider | What its user enters or authorizes | Model/configuration detail | Primary setup reference |
| --- | --- | --- | --- |
| OpenRouter | OpenRouter API key, or browser authorization in the next section | User-filtered model catalog; own credits/allowance | [OpenRouter authentication](https://openrouter.ai/docs/guides/overview/auth/oauth) |
| Hugging Face Inference | Personal token permitting Inference Providers, or registered OAuth | Router-supported model, relevant gated-model access if required, own allowance | [Inference Providers](https://huggingface.co/docs/inference-providers/index) |
| OpenAI API | OpenAI Platform API key with permitted model access and API allowance | Responses API; API billing is separate from ChatGPT-plan access | [OpenAI quickstart](https://developers.openai.com/api/docs/quickstart) |
| Anthropic API | Claude Platform API key and usable API allowance | Messages API; Claude subscription login is not this route | [Claude API overview](https://platform.claude.com/docs/en/api/overview) |
| Google Gemini API | Google AI Studio/Cloud Gemini key permitted for the Generative Language API | Select a model supporting `generateContent`; key/project quota applies | [Gemini key setup](https://ai.google.dev/gemini-api/docs/api-key) |
| xAI | xAI API key with model access/allowance | Provider model catalog and chat completions | [xAI quickstart](https://docs.x.ai/developers/quickstart) |
| Mistral | Mistral Studio API key and usable model allowance | Provider model catalog and chat completions | [Mistral first request](https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request) |
| DeepSeek | DeepSeek API key and usable allowance | Provider model catalog and chat completions | [DeepSeek first request](https://api-docs.deepseek.com/) |
| Groq | Groq API key and usable quota | Provider model catalog and OpenAI-compatible chat completions | [Groq API compatibility](https://console.groq.com/docs/openai) |
| Together AI | Together API key and usable allowance | Catalog is filtered to chat models | [Together compatibility](https://docs.together.ai/docs/inference/openai-compatibility) |
| Fireworks AI | Fireworks API key, model/deployment ID and usable allowance | Enter permitted IDs explicitly; Talvori does not assume universal model discovery | [Fireworks text models](https://docs.fireworks.ai/guides/querying-text-models) |
| Cohere | Cohere API key permitted for the intended use and model | v2 Chat, nondeprecated chat-model catalog | [Cohere Chat](https://docs.cohere.com/docs/chat-api) |
| Perplexity | Perplexity API key and **Agent API** model ID | `/v1/agent`; legacy Sonar IDs are not automatically Agent API IDs | [Perplexity Agent API](https://docs.perplexity.ai/docs/agent-api/quickstart) |
| Moonshot / Kimi | Moonshot API key and matching Global/China region | Region-specific endpoint and model catalog; Kimi Code CLI is a different runtime | [Kimi chat API](https://platform.kimi.ai/docs/api/chat) |
| Alibaba / Qwen | Model Studio API key, region, provider workspace ID and model IDs | Key, workspace endpoint and model must agree; Talvori uses workspace-dedicated endpoints | [Model Studio regions](https://help.aliyun.com/en/model-studio/regions/) |
| Z.ai / GLM | Standard API key, model IDs and matching Global/BigModel region | Current route uses the standard API endpoint, not the separate Coding Plan endpoint | [Z.ai quickstart](https://docs.z.ai/guides/overview/quick-start) |

These adapters currently supply reviewed text, not every provider capability.
Vision/file APIs, voice, provider-native tools, general tool loops, streaming for
all API providers, complete usage/billing reconciliation and resumable output
remain engineering work. Saving a key or reading a catalog does not send a test
prompt; only an explicitly confirmed successful nonempty reply verifies it.

## Implemented public browser authorization

| Route | Operator setup | Each public user needs | Remaining evidence |
| --- | --- | --- | --- |
| OpenRouter PKCE | Public backend/origin; no operator OAuth client or API key. Forward `/api/ai-connections/openrouter/callback/<attempt>` to the backend. | Their own OpenRouter sign-in, authorization and usable model allowance | Real callback, explicit inference, denial/revocation and two-user isolation on the actual host |
| Hugging Face OAuth | HF registration and environment values above | Their own HF sign-in, inference permission, usable allowance and any model-specific access | Real grant/refresh/revocation and model execution after registration |
| GitHub Copilot OAuth + official SDK | GitHub registration above; backend must run the pinned SDK/CLI dependency | Their own GitHub sign-in **and eligible active Copilot access**; organization restrictions may also apply | Real OAuth, actual SDK model access/inference, refresh/revocation and cross-user isolation |

OpenRouter documents a user-controlled key flow without a developer client
secret. See [OpenRouter PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth).
Copilot uses each signed-in user's entitlement, not the site's operator account;
GitHub documents both [OAuth](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth)
and [backend deployment](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/backend-services).
Ordinary GitHub membership alone is not proof that SDK inference is available.

## Local and missing runtime paths are not public OAuth

| Path | What exists or is missing | What is actually needed |
| --- | --- | --- |
| Codex local CLI / app-server | Implemented on the machine running Talvori; blocked as a shared host account in public mode | For a public visitor to use their own computer: implement authenticated personal-runner pairing, lifecycle/revocation and private worker isolation. For hosted subscription access: obtain the separate OpenAI approval above, then implement its approved flow. A visitor installing Codex does not connect it to Talvori's server. |
| Claude local CLI | Restricted existing local execution; no released hosted claude.ai authorization or session-aware Agent SDK adapter | Implement the adapter, safe tools/config boundary and tenancy. Use API authentication, or obtain Anthropic's prior approval for subscription login; do not reuse operator login. |
| Copilot local ACP | Implemented device sign-in and reviewed local runtime execution | Keep local-only, or add authenticated personal-runner pairing. Hosted users can instead use the already-coded OAuth/SDK path. |
| OpenCode | Runtime adapter not implemented | Implement its protocol, per-user credential/config isolation, cancellation, tool boundary and compatibility tests. No Talvori-specific operator OAuth registration is established by the current audit. |
| Pi / OMP | RPC adapters not implemented | Implement and test each actual runtime; isolate account/config/tools. Underlying model API keys already use the separate API table, not an implied Pi connection. |
| Muse Code | MSP adapter not implemented | Obtain a supported runtime distribution/access path and verify its auth/hosting terms, then implement transport and isolation. No supported Talvori public OAuth contract is established. |
| Cursor, Kimi Code and other ACP agents | Generic ACP runtime selection and individual adapters/compatibility are not released | Implement allowlisted adapters and validate each agent's supported sign-in, tools and hosted usage. ACP transport compatibility alone does not grant account access or public-hosting permission. |
| Antigravity | Not implemented/released | Do not install an unrestricted shared public runner. Paseo documents full-access-only execution without interactive approvals. A release needs a safe isolated execution design and provider-supported authentication/usage; the existing Gemini API route is separate. |

This is our engineering backlog, **not a request for Evan to buy all those
subscriptions**. Until an adapter and its safe public architecture exist, a key
or provider account alone cannot finish it. Paseo's [provider inventory](https://github.com/getpaseo/paseo/blob/main/public-docs/supported-providers.md)
documents runtimes installed/authenticated on its daemon host; it does not
provide a universal hosted OAuth API that Talvori can simply enable.

## Engineering and deployment gates that remain ours

1. Deploy the production backend using the exact origin, stable encryption key,
   persistent private storage and trusted loopback TLS proxy. Do not expose Vite
   or upload the developer's database/accounts. See the operational procedure in
   [AI connections](ai-connections.md#running-the-backend-on-a-public-origin).
2. Complete each approved runtime/advanced capability as a separate verified
   vertical slice. Do not relabel a local CLI as a public subscription login.
3. Complete production identity recovery/email and abuse controls before an
   unrestricted signup launch; current public mode is invite-only. Review
   credential retention, deletion, privacy notices and incident procedures.
4. Run security/load tests and backup/restore drills on the intended host.
   Application-level private homes are not an OS tenant sandbox. Current hosted
   Copilot denies native/file/shell/MCP tools; adding such tools needs hardened
   isolated workers, not just a new toggle.
5. Record live evidence per method: account owner, provider/method, permitted
   model, timestamp, actual callback origin, success/failure and sanitized
   provider request ID where available. Never store tokens in an evidence log.
6. For each released method test authorize/save, discovery/configured IDs,
   explicit inference, reviewed chat, stop/timeout, disconnect/revocation,
   credential replacement, scheduling, permission revocation and isolation
   between two Talvori users/workspaces. Repeated uncertain requests must not
   be silently resent. Confirm billing notices; absence of a usage report is
   unknown usage, not zero cost.

## Repository evidence and verification boundary

The catalog is `src/lib/ai-provider-catalog.js`; request/response adapters are
`server/model-api-adapters.mjs`; encrypted authorization lives in
`server/ai-connections-service.mjs` and `server/copilot-oauth-service.mjs`;
`server/copilot-hosted-runtime.mjs` owns the hosted SDK; public host/Origin/key
guards live in `server/deployment-policy.mjs`.

Relevant isolated suites are `tests/model-api-connections.test.mjs`,
`tests/ai-connection-races.test.mjs`, `tests/copilot-hosted.test.mjs`,
`tests/local-agent-bridges.test.mjs` and `tests/public-ai-deployment.test.mjs`.
They inject transports/runtimes and use temporary databases. They are evidence
that Talvori's contracts and permission boundaries are tested, **not evidence
that all provider accounts/models or a production deployment work**. This audit
made no live account changes, used no credentials and sent no inference prompt.

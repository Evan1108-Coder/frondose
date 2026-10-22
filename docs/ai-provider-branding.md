# AI provider names and artwork

Reviewed October 22, 2026. Coverage is 47 computer-runner identities and 16 API
identities, or 62 distinct execution IDs because Gemini is in both catalogs.
Every execution ID resolves to bundled artwork through `serviceBrand`; none
uses Frondose-generated initials. Artwork does not certify an installed
runtime, authentication, entitlement, compatibility, or provider endorsement.

## What changed

Provider-owned pages were checked rather than title-casing machine IDs. The
intentional lowercase names **goose**, **crow-cli**, and **fast-agent** remain.
Corrected display names are CodeBuddy Code, Codewhale, Deep Agents, Grok Build,
Hermes Agent, GitHub Copilot CLI, Google Antigravity, and Kilo Code CLI.
The API catalog also follows the provider's **Z.AI** capitalization.
`runner-provider-names.js` records the correction sources. The untouched
Paseo label remains `upstreamTitle`; IDs, command templates, package versions,
and installation links are unchanged.

Codex now has its product mark rather than the OpenAI company mark. Anthropic
API now has Anthropic's mark rather than Claude's spark; Claude Code keeps the
Claude product identity. The `xai` API ID is displayed as **Grok API** with the
Grok mark. Its official pages currently use inconsistent corporate names
(SpaceXSI in the heading and SpaceXAI LLC in the footer), so Frondose does not
guess a corporate rename. See the [official brand page](https://x.ai/legal/brand-guidelines).

Paseo's old CodeWhale badge is just the 深 character. It is replaced with the
actual blue whale from the [provider's MIT-licensed repository](https://github.com/codewhale-hq/CodeWhale/blob/0ab0d4ac297249ad379192074a250c792d312beb/web/app/icon.svg).
Dirac's δ and VT Code's VT/terminal artwork are intentionally text-containing
marks distributed by the agent publishers through the ACP registry; they are
not Frondose's former dynamically generated letter fallback.

## Runner source and name review

The asset manifest is `src/lib/runner-brand-assets.json`: every file has a
source URL, immutable Git revision, original SHA-256, bundled SHA-256, license,
and transformation notice. 46 files come from the pinned Apache-2.0 Paseo tree;
Codewhale comes from its MIT repository. 45 are monochrome `currentColor`
silhouettes rendered as CSS masks; Kiro and Codewhale retain original colors
as ordinary images. Static native Svg/Path components are converted without
evaluating downloaded JavaScript. SVG is never injected into page HTML.

The [ACP registry](https://github.com/agentclientprotocol/registry/tree/528db5c8e8647e4332336f31edd1733fa6247e6a)
was cross-checked for publisher-submitted names/artwork. It is an interoperability
catalog, not proof that a company has issued a separate trademark license.
Paseo-only entries are identified below. For unchanged names the primary page
is supporting evidence, not a claim that every page's marketing heading is
identical to the pinned release's name.

| ID | Display name | Primary name reference / limitation |
| --- | --- | --- |
| claude | Claude Code | [Claude Code docs](https://code.claude.com/docs/en/setup) |
| codex | Codex | [OpenAI Codex CLI](https://developers.openai.com/codex/cli/); direct HTTP fetch returned 403, official search corroborated |
| copilot | GitHub Copilot CLI | [GitHub installation docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) |
| opencode | OpenCode | [OpenCode docs](https://opencode.ai/docs/) |
| pi | Pi | [Pi](https://pi.dev/) |
| omp | Oh My Pi | [Maintainer repository](https://github.com/can1357/oh-my-pi); known package/project name, current README also uses omp |
| antigravity | Google Antigravity | [Google Antigravity](https://antigravity.google/), Google-authored ACP registry entry |
| muse | Muse Code | [Paseo plugin documentation](https://github.com/getpaseo/paseo/blob/c70a6cfb9ea29c87df52b6b6c574775b0d3b169c/public-docs/muse-code.md); bundled-plugin identity |
| agoragentic-acp | Agoragentic | [Provider](https://agoragentic.com/), ACP registry |
| amp-acp | Amp | [Adapter maintainer](https://github.com/tao12345666333/amp-acp); third-party ACP adapter for Amp |
| auggie | Auggie CLI | [Augment Code](https://www.augmentcode.com/), ACP registry |
| autohand | Autohand Code | [Provider CLI](https://autohand.ai/cli/), ACP registry |
| cline | Cline | [Cline CLI](https://cline.bot/cli), ACP registry |
| codebuddy-code | CodeBuddy Code | [Tencent CodeBuddy](https://www.codebuddy.cn/cli/); corrected internal B capitalization |
| codewhale | Codewhale | [Provider README](https://github.com/codewhale-hq/CodeWhale/blob/0ab0d4ac297249ad379192074a250c792d312beb/README.md); Paseo-only catalog entry |
| cortex-code | Cortex Code | [Snowflake docs](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-cli); **current heading is CoCo CLI**, old pinned runtime name retained, not a new-version compatibility claim |
| corust-agent | Corust Agent | [Maintainer releases](https://github.com/rustingai/corust-agent-release/releases), ACP registry |
| crow-cli | crow-cli | [Provider's CLI docs](https://crow-ai.dev/docs/zed/), ACP registry; lowercase is intentional, Crow ADE is a separate editor name |
| cursor | Cursor | [Cursor docs](https://cursor.com/docs), ACP registry |
| deepagents | Deep Agents | [LangChain docs](https://docs.langchain.com/oss/javascript/deepagents/overview) |
| devin | Devin CLI | [Cognition CLI docs](https://docs.devin.ai/cli), ACP registry uses short name Devin |
| dimcode | DimCode | [Provider ACP docs](https://dimcode.dev/docs/acp.html); **current site title is DimAgent**, pinned DimCode release identity retained |
| dirac | Dirac | [Provider](https://dirac.run/), [publisher δ icon](https://github.com/dirac-run/dirac/blob/441c5766c0b6f57f6ec2f9abd0e3745709d603b5/agent-registry/dirac/icon.svg) |
| factory-droid | Factory Droid | [Factory terminal](https://factory.com/product/cli), ACP registry |
| fast-agent | fast-agent | [Provider ACP docs](https://fast-agent.ai/acp/), ACP registry |
| gemini | Gemini CLI | [Google Gemini CLI](https://geminicli.com/), ACP registry |
| gjc | Gajae Code | [Provider](https://gajae-code.com/); Paseo-only catalog entry |
| glm-acp-agent | GLM Agent | [Adapter maintainer](https://github.com/stefandevo/glm-acp-agent), ACP registry label; third-party GLM adapter, not a Z.AI-owned CLI |
| goose | goose | [Block project](https://block.github.io/goose/), ACP registry; lowercase is intentional |
| grok | Grok Build | [Provider Build docs](https://docs.x.ai/build/overview), ACP registry |
| hermes | Hermes Agent | [Nous Research docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp); Paseo-only catalog entry |
| hoplite | Hoplite | [Provider CLI docs](https://hoplite.sh/docs/cli); Paseo bundled-plugin/catalog identity |
| junie | Junie | [JetBrains docs](https://junie.jetbrains.com/docs/junie-cli-acp.html); direct HTTP returned 403, JetBrains repository/ACP registry corroborated |
| kilo | Kilo Code CLI | [Provider CLI docs](https://kilo.ai/docs/code-with-ai/platforms/cli) |
| kiro | Kiro CLI | [Provider ACP docs](https://kiro.dev/docs/cli/acp/); Paseo asset retains purple/white/black |
| kimi | Kimi Code CLI | [Moonshot AI repository](https://github.com/MoonshotAI/kimi-code); ACP's older kimi-cli entry uses Kimi CLI |
| minimax-code | MiniMax Code | [Provider](https://agent.minimax.io/), ACP registry; site currently markets MiniMax Agent |
| minion-code | Minion Code | [Maintainer](https://github.com/femto/minion-code), ACP registry |
| mistral-vibe | Mistral Vibe | [Mistral repository](https://github.com/mistralai/mistral-vibe), ACP registry |
| nova | Nova | [Compass AI](https://www.compassap.ai/nova/), ACP registry |
| poolside | Poolside | [Provider CLI docs](https://docs.poolside.ai/cli/pool), ACP registry |
| qoder | Qoder CLI | [Provider](https://qoder.com/), ACP registry |
| qwen-code | Qwen Code | [Qwen docs](https://qwenlm.github.io/qwen-code-docs/en/users/overview/), ACP registry |
| sigit | siGit Code | [Maintainer](https://github.com/getsigit/sigit), ACP registry |
| stakpak | Stakpak | [Provider](https://stakpak.dev/), ACP registry |
| traecli | TRAE CLI | [Provider docs](https://docs.trae.cn/cli_get-started-with-trae-cli); HTTP 400 during review, pinned Paseo identity retained; not independently recertified |
| vtcode | VT Code | [Maintainer docs](https://github.com/vinhnx/VTCode/blob/main/docs/guides/zed-acp.md), [publisher registry icon](https://github.com/agentclientprotocol/registry/blob/528db5c8e8647e4332336f31edd1733fa6247e6a/vtcode/icon.svg) |

## API identities

All 16 API IDs resolve through the existing shared logo registry, with the
Codex/Anthropic identity separation noted above. Sources are SVG Logos via
`@iconify-icons/logos@2.0.1` (CC0-1.0), Simple Icons for OpenRouter (CC0-1.0),
and six Lobe Icons SVGs (MIT, bundled license). These are distributed brand
artwork, not newly drawn substitutes. See `docs/service-logo-assets.md` and
`public/brand/services/SOURCES.md`. The 16 actual rendered API assets also have
a hash/version/source manifest at `third-party/ai-brands/api-assets.json`;
`scripts/audit-api-brand-assets.mjs --verify-upstream` checks these against their
immutable distribution URLs.

| API ID | Provider/product reference |
| --- | --- |
| openrouter | [OpenRouter](https://openrouter.ai/docs/guides/overview/auth/oauth) |
| huggingface | [Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers/index) |
| openai | [OpenAI API](https://developers.openai.com/api/docs/quickstart); direct HTTP 403 |
| anthropic | [Anthropic / Claude API](https://platform.claude.com/docs/en/api/overview); regional redirect during direct fetch |
| gemini | [Gemini API](https://ai.google.dev/api) |
| xai | [Grok API](https://docs.x.ai/developers/rest-api-reference/inference) |
| mistral | [Mistral API](https://docs.mistral.ai/api) |
| deepseek | [DeepSeek API](https://api-docs.deepseek.com/) |
| groq | [Groq](https://console.groq.com/docs/openai); direct HTTP 403 |
| together | [Together AI](https://docs.together.ai/docs/inference/openai-compatibility) |
| fireworks | [Fireworks AI](https://docs.fireworks.ai/guides/querying-text-models) |
| cohere | [Cohere](https://docs.cohere.com/docs/chat-api) |
| perplexity | [Perplexity](https://docs.perplexity.ai/docs/agent-api/quickstart) |
| moonshot | [Kimi / Moonshot AI](https://platform.kimi.ai/docs/api/chat) |
| qwen | [Alibaba Cloud Model Studio / Qwen](https://help.aliyun.com/en/model-studio/qwen-api-reference/) |
| zai | [Z.AI / GLM](https://docs.z.ai/guides/overview/quick-start) |

## Limitations and verification

No missing runtime artwork remains. This is source/identity and static-safety
verification, not independent confirmation that each vendor approved Frondose's
specific trademark use. Apache, MIT, and CC0 distribution notices do not grant
endorsement, service access, or universal trademark permission. Vendor brand
guidelines may impose additional conditions. The catalog's old release pins
are deliberately not upgraded by a branding change.

`tests/runner-brand-assets.test.mjs` checks full execution coverage, immutable
asset hashes, script/external-reference rejection, retained multicolor art,
licenses, official-name overrides, and absence of initials generation.
`scripts/vendor-runner-brand-assets.mjs` reproducibly downloads the exact pinned
assets and refuses unreviewed SVG markup. Runtime never downloads provider SVG.

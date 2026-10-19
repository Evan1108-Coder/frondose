# Talvori rebrand

Talvori replaces Rumbo throughout the current product. The rebrand preserves
existing features, data and connection authority. The accompanying October 19
interaction changes are described separately below; they do not grant new
provider, file or external-action access.

## Brand assets

- `public/brand/talvori-symbol.png`: transparent generated master T symbol.
- `public/brand/talvori-symbol.webp`: small, lossless UI asset.
- `public/brand/talvori-app-icon.png`: 512 × 512 transparent app/consent icon.
- `public/brand/talvori-wordmark-dark.svg` and `talvori-wordmark-light.svg`:
  transparent wordmarks for dark and light backgrounds.
- The React wordmark uses the bundled UI typeface and theme foreground instead
  of the previous opaque dark raster. The assistant retains its six orb colors
  and interaction behavior, with the Talvori monogram overlaid.

Run `node scripts/generate-brand-assets.mjs` after rebuilding the lossless
symbol variant to refresh SVG wordmarks and legacy icon aliases. The archived
Rumbo design exploration is historical provenance, not active artwork.

## Provider-hosted authorization: operator checklist

Code cannot rename an OAuth application registered on somebody else's website.
Before public verification, create/update the real provider registrations:

| Provider | Registration branding | Callback |
| --- | --- | --- |
| GitHub Copilot | App name **Talvori**; upload `talvori-app-icon.png`; homepage is the actual public Talvori origin; check the owning account/organization name separately | `/api/ai-connections/copilot/callback` |
| Hugging Face | App name **Talvori**; use the Talvori icon where the registration supports one; inference permissions remain unchanged | `/api/ai-connections/huggingface/callback` |
| OpenRouter | Check the app identity shown during the actual PKCE flow against the public Talvori callback origin; do not add unsupported branding parameters | `/api/ai-connections/openrouter/callback/<attempt>` |
| Paused non-AI Plugins | Update each provider's application/consent branding before that integration is released; this rebrand does not enable them | Provider-specific existing callback paths |

The existing Codex/Claude/Copilot local login pages belong to those providers.
Talvori cannot relabel their products or replace their logos. Its own runtime
client title and MCP server name are Talvori. A GitHub repository rename does
not update any OAuth registration. No remote consent page is certified as
Talvori-branded until the actual registration and flow have been inspected.

Use server-only `TALVORI_GITHUB_CLIENT_ID`, `TALVORI_GITHUB_CLIENT_SECRET`,
`TALVORI_HF_CLIENT_ID` and, for a confidential HF app,
`TALVORI_HF_CLIENT_SECRET`. Never put secrets in frontend environment variables.

## Compatibility and existing data

- New configuration names begin `TALVORI_`; `RUMBO_` aliases continue working.
  A specified new value wins, including an explicitly empty value. App-ID
  rotation remains live and invalidates stale OAuth attempts/credentials.
- New installations use `.talvori/talvori.sqlite`. Existing installations keep
  their `.rumbo/rumbo.sqlite` database and encryption key; no data folder move
  or credential re-encryption is required. Both private directories are denied
  by the development server and excluded from Git.
- Exact built-in workspace names `Rumbo` / `Rumbo Studio` and built-in assistant
  default name `Rumbo Agent` become `Talvori` once. Before changes,
  a consistent SQLite backup is created under the private `backups` directory.
  Assistant profile changes create a new version; historical snapshots are not
  rewritten. Custom names, guidance, messages and documents stay unchanged.
- Browser storage keys, Field Default identities, entity IDs, source bindings,
  permission/tool IDs and guidance delimiters retain their existing stable
  identities. All 209 pre-discovered field keys are preserved.
- Public assistant links use `#/talvori-agent`; old links remain valid.
  `/api/talvori-agent` and the legacy endpoint share the same access checks.
- `/talvori` is the displayed slash command; `/rumbo` remains an alias.
- New session cookies use `talvori_session`; valid old sessions still resolve.
- New exports use `talvori.workspace`; both old and new version-1 archives are
  accepted with the same content-only import and export permission checks.
- New agent replies request `talvori-actions`; legacy `rumbo-actions` replies
  are still parsed with the same nonce, permission and human-review rules.

## Verification

`tests/talvori-rebrand.test.mjs` covers environment compatibility and rotation,
public-mode safety, database reopening, migration backups/idempotency/profile
history, old/new links and API routes, session cookies, field identities, and
installed-app metadata. Run the full suite after building so the Sites packaging
test sees a complete build. Browser smoke checks must include desktop/mobile,
both themes, new and legacy assistant links, AI details, help and setup screens.

## October 19 conversation update

The assistant is now called **Talvori**, without an Agent suffix. Chat and
Inspect have one Chat mode; explicit Send captures exact server context.
Elevated tools retain explicit review. Profile selection replaces composer
provider/model selection. Conversation overflow and agent-produced pending
schedule intents lead to explicit schedule confirmation. See
[direct actions and scheduling boundaries](agent-actions-direct.md).

# Writing-first editors and personal identity

Creation/editing dialogs inherit a wide, neutral Frondose shell inspired by the
user's Linear reference. The header offers expand/restore without remounting the
form. Title and description lead; ordinary properties wrap horizontally. On
narrow screens properties wrap and the dialog scrolls within the viewport.
Specialized confirmation, crop, permission and provider-review flows retain their
own controls and safeguards rather than pretending to be issue composers.

Routes offer Create more: after a successful save the title and description are
cleared, property choices are retained, and no agent starts. Cancelling a dirty
draft still offers Keep editing or Discard changes. Project picture, brief,
working folder and repository remain in Project details & picture.

File controls are real, not universal placeholders. Existing image-enabled
editors accept picker or drag/drop, validate PNG/JPEG/WebP, open the existing crop
dialog, and save the bounded thumbnail. Dropping on another part of one of these
dialogs forwards to its actual upload control. Area resource file editors retain
their bounded persisted file upload. Routes and ordinary documents do not yet
have generic binary attachment storage; no misleading paperclip is added there.

## Agents and provider identities

The authored AgentEditor has two explicit creation types: Create agent
(`identity_kind=agent`) and Connect AI provider (`identity_kind=provider`). The
saved type cannot be switched. Existing profiles remain personalized agents;
neither type creates a provider account or starts work. Your Agents and AI
Providers are separate roster views.

Personalized creation asks for name, description, provider, connection method,
account connection, optional picture and Personalization. Purpose presets,
role, working-folder, execution-policy and context-preference questions are not
part of this form. Existing stored settings are retained, not erased by hiding
their old controls. Personalization is the UI label for saved `instructions`;
it is guidance, not execution authority. Direct provider identities omit the
custom name, description, picture and Personalization fields and use the
provider's name and mark instead.

Connection methods come from the selected provider's catalog support, not a
universal three-choice menu: API key where available, supported browser/GitHub
authorization where available, and Computer (CLI) for cataloged runners. The
account list is filtered to that method. Catalog presence is not verification
of an account, model entitlement, or live OS/provider compatibility. Browser/API
profiles with a selected connection require an explicit chat model; Load models
requests that provider's catalog. Connect / manage opens AI connections, subject
to the unsaved-draft confirmation when the form is dirty.

New conversations require exactly one responding agent. Once bound it cannot
be changed; another agent needs another conversation. Legacy participant IDs
and message history are retained, and editing a legacy title does not silently
select a future responder. This is not multi-agent dispatch.

Both identity types currently use Frondose-owned conversations. Native CLI
history listing/import, persistent native-session continuation and refresh are
not implemented. A provider identity does not enable them or expose ordinary
ChatGPT/Claude website history. See [Native CLI history status](native-cli-history-status.md)
for the provider-specific research and remaining release requirements.

## Contact us

Open the question-mark menu and choose Contact us to see and copy the current
email address. Send feedback, bug reports, or general questions from your email
app. Frondose does not send the message or upload files.

For a bug report, choose **Go to support logs**, select the date it happened,
and use **Copy day** or **Download day**. Review the excerpt before sharing it.
The support log keeps up to 30 days of dated action labels and statuses on this
computer. It omits names, paths, credentials, prompts, and file or terminal
contents. It cannot capture every click, actions outside Frondose, or raw crash
output. Chat can add a reviewed day to a draft with **Add support log**;
automations still use the separately approved recent workspace activity.

## Names and pictures

Settings → Profile has three distinct fields:

- Username: an optional, case-insensitively unique handle on this installation.
  Choose 3–32 ASCII letters/numbers/dots/underscores/hyphens, beginning with a
  letter or number. Existing users keep an empty handle until they choose one.
  Changing it never changes identity IDs, login email, permissions or history.
- Display name (You): an optional private label shown in your own profile
  affordance and your messages. Empty means use the shared display name.
- Display name: shared identity used for new authored work and member listings.
  Historical recorded author names are not rewritten.

Profiles are keyed by the server-resolved actor, never a supplied member ID.
The private label is omitted from member listings, identity responses, workspace
archives and AI context. It is not a nickname other members can retrieve. Profile
contact email is separate from the email used for login. Photos cover their
complete circular frame; project/workspace pictures retain their own shape.

## Verification

`tests/personal-profile.test.mjs` covers two signed-in accounts, unique handles,
cross-account spoof attempts, input validation and private-name exclusion from
directory/auth/export projections. Existing access and identity tests remain.

Browser QA uses an isolated temporary database, never live workspace test
records or provider calls. It covers creation/property selection, Create more,
expand/restore, dirty-close/keep/discard, image picker/drop/crop, persistence,
profile reload and exact avatar-frame dimensions. Screenshots inspect dark/light
desktop, 390px and 320px layouts. Playwright is used because the Browser plugin is
not available in this environment. These checks do not certify every specialized
dialog or browser/OS combination.

The current simplified AgentEditor also passes the isolated browser flow:
personalized and direct-provider identities persist with distinct types,
OpenRouter offers API/browser authorization without a CLI option, provider
search has a measured 12px gap, and 390px/320px layouts do not overflow.
Conversation QA verifies one responding identity plus local notes, and blocks
an archived bound agent without substitution. Contact us previews without
creating a run. Current screenshots and an independent finish review cover
these changes; this is not live-provider or all-platform certification.

The final integrated automated suite passed 1,640 tests; Sites packaging passed
four additional checks. Browser checks created no provider runs.
The final archive regression includes deleting a real profile, exporting and
importing its conversation, preserving one fresh unavailable identity for both
the responder and historical participant references. A removed profile-folder
question no longer leaves a dead chat action: project linking opens the existing
reviewed Move conversation flow.

The requested Linear work-record update could not be delivered because the
connected Linear app requires reauthentication. No remote issue was closed or
marked complete.

## Design-system comparison and provenance

The popup extension keeps Inter, semantic theme colors, one focused text-entry
border and the existing dialog motion/accessibility machinery. Its wide writing
panel, expand/restore behavior, compact wrapping properties and local rounded
primary action are surface anatomy, not replacement global tokens. `DESIGN.md`
and `.impeccable/design.json` are preserved rather than regenerated.

The explicit October 22 logo choice is recorded in `PRODUCT.md` and `AGENTS.md`:
the user-approved generated frond replaces the historical F mark. The active
raster source/unknown-generation details are recorded in
[`public/brand/ASSETS.json`](../public/brand/ASSETS.json); the original generation
prompt is unavailable and is not reconstructed.

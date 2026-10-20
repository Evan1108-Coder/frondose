# Choose Talvori’s AI connection

Talvori does not automatically use the first connected AI account. On first
visit, choose **Create my agent** in its own tab. The vertical setup form
contains identity, AI connection, model, and context preferences. Select a
verified account under **AI connection**, complete purpose and guidelines,
and save setup. You can save its identity without selecting an account; it
cannot start AI work until a verified connection is explicitly selected.
The same preferences are available in Settings → Talvori. An older saved Codex
default does not count as an explicit selection: choose and save it once.

Only verified, ready accounts are offered for a new selection. A selected
account that disconnects remains identified as needing reconnection; Talvori
never silently switches to a different account. Clear the selection with
**Not selected**. This does not disconnect the provider or delete profiles,
conversations, scheduled definitions, or history. Existing personal-agent
launches—including scheduled dispatch—must still match the saved selection.
Ordinary agent profiles keep their independent, explicitly selected accounts.

The Talvori tab contains identity, connection and context preferences plus
Activity and Scheduled. Conversations is the single place to chat. Opening
Talvori never creates a conversation or starts AI work. **Open conversation**
opens existing work when possible; **New conversation** explicitly creates a
new draft. Source/mention entry points keep their exact addressed agent and
source IDs. A draft is not sent until the person explicitly sends it.

## Workspace independence

New workspaces start without local Codex/Claude activation, even when the CLI
is signed in or another workspace already uses it. Open AI connections in the
new workspace and explicitly connect/check the existing local login. This
does not sign the machine out or start inference. Then select that connection
in Talvori's setup. Local-account disconnect removes only the current
workspace's activation; other workspaces and the CLI session remain intact.
Legacy installation-wide API calls without a workspace retain their explicit
installation-wide behavior for existing workspaces, not future ones. The
current browser always sends its workspace for these operations.

The migration preserves actual existing profile bindings, not global connected
badges in empty workspaces. Activation is stored separately from portable
workspace content and ordinary Settings; imports never restore it. API/OAuth
accounts remain scoped to the authenticated user and workspace. Shared host
CLI accounts remain disabled in public deployment mode.

## Agent identity and pictures

**Your Agents** contains specialized profiles, not the canonical personal
Talvori profile. Personal profiles remain in conversations, memberships and
history; old profile links lead to the Talvori tab. Filtering uses server-derived
identity, never the display name: naming an ordinary agent “Talvori” does not
hide it. **Your Agents** → select an agent → Edit allows a name and optional picture. Use
Choose image or drag one PNG, JPEG or WebP onto the image field, then crop and
save. The crop is a bounded 512-pixel raster; stored data is limited to 250 KB.
SVG files and external picture URLs are not accepted. Remove returns to the
provider mark or Talvori orb. The underlying provider and connection remain
visible separately: a custom picture does not change the execution account.

Profile picture/name edits create a new immutable profile version. Existing
run versions and manually authored instructions remain intact. Portable agent
definition copies continue to omit connection authority and profile pictures;
full content-only workspace archives retain the validated image without
restoring account credentials or run authority.

Provider marks are contained within their avatar rather than filling its
outer circle. Sidebar icon slots use their own fixed size so expanding or
collapsing the sidebar cannot crop the larger avatar geometry.
